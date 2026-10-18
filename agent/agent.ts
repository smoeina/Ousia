import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { chatgpt } from "eve/models/openai";
import { defineAgent, defineDynamic } from "eve";
import { timedModelFetch } from "./lib/model-timeout";
import {
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  OPENCODE_GO_BASE_URL,
  OPENCODE_ZEN_BASE_URL,
  readAiProviderConfig,
  resolveProviderApiKey,
  type AiProviderId,
} from "../lib/ai-providers";

type ModelSelection = { provider: AiProviderId; modelId: string; contextWindow?: number };

// Per-turn selection arrives on the request headers (x-model-provider / x-model-id
// / x-model-context-window-tokens), mapped onto session auth by proxy-auth. When a
// turn carries no explicit choice the stored default (then the env config) applies.
function requestedSelection(ctx: { session: { auth: { current?: { attributes?: Record<string, unknown> } | null } } }): ModelSelection | undefined {
  const attributes = (ctx.session.auth.current?.attributes ?? {}) as Record<string, unknown>;
  const provider = attributes.modelProvider;
  const modelId = typeof attributes.modelId === "string" ? attributes.modelId.trim() : "";
  const contextWindow = Number(attributes.modelContextWindowTokens);
  if ((provider === "openrouter" || provider === "opencode" || provider === "opencode-go" || provider === "chatgpt") && modelId) {
    return { provider, modelId, ...(Number.isSafeInteger(contextWindow) && contextWindow > 0 ? { contextWindow } : {}) };
  }
  return undefined;
}

export default defineAgent({
  model: defineDynamic({
    events: {
      "step.started": async (_event, ctx) => {
        const fetch = timedModelFetch();
        const config = await readAiProviderConfig();
        const requested = requestedSelection(ctx);
        const provider = requested?.provider ?? config.defaultModel?.provider ?? "openrouter";
        const modelId = requested?.modelId ?? config.defaultModel?.id ?? process.env.OPENROUTER_MODEL_ID?.trim();
        if (!modelId) throw new Error("No chat model is configured. Connect a provider in AI Providers settings.");
        const envContextWindow = Number(process.env.OPENROUTER_MODEL_CONTEXT_WINDOW_TOKENS);
        const contextWindow = requested?.contextWindow ?? config.defaultModel?.contextWindow ?? (Number.isSafeInteger(envContextWindow) && envContextWindow > 0 ? envContextWindow : DEFAULT_CONTEXT_WINDOW_TOKENS);

        if (provider === "chatgpt") {
          return { model: chatgpt(modelId), modelContextWindowTokens: contextWindow };
        }
        if (provider === "opencode" || provider === "opencode-go") {
          const apiKey = await resolveProviderApiKey(provider, config);
          if (!apiKey) throw new Error(`${provider === "opencode-go" ? "OpenCode Go" : "OpenCode Zen"} is not connected. Add an API key in AI Providers settings.`);
          // The OpenCode gateways require a stable per-conversation session id for
          // routing/prompt caching, and prefer a client-owned user agent. Both are
          // pinned at the fetch layer because the AI SDK overrides its user agent.
          const gateway = createOpenAICompatible({
            name: provider,
            baseURL: provider === "opencode-go" ? OPENCODE_GO_BASE_URL : OPENCODE_ZEN_BASE_URL,
            apiKey,
            fetch: timedModelFetch({ "x-opencode-session": ctx.session.id, "user-agent": "ousia/0.1" }),
          });
          return { model: gateway.chatModel(modelId), modelContextWindowTokens: contextWindow };
        }
        const apiKey = await resolveProviderApiKey("openrouter", config);
        if (!apiKey) throw new Error("OpenRouter is not connected. Add an API key in AI Providers settings.");
        const openrouter = createOpenRouter({ apiKey, fetch });
        return { model: openrouter(modelId), modelContextWindowTokens: contextWindow };
      },
    },
  }),
  reasoning: "medium",
  limits: {
    // Input consumption re-bills the full context every model call, so it grows
    // far faster than context size; 5M keeps the continuation prompt out of
    // legitimate long runs while still stopping defective ones. Output must be
    // sized alongside it: approving either window resets both, so a tight
    // output cap resurfaces the dialog once input approvals become rare.
    maxInputTokensPerSession: 5_000_000,
    maxOutputTokensPerSession: 200_000,
  },
  build: {
    // Keep the sandbox/storage SDKs external instead of bundling them.
    externalDependencies: ["better-sqlite3", "sharp"],
  },
});
