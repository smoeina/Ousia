import { promises as fs } from "node:fs";
import path from "node:path";

export type AiProviderId = "openrouter" | "opencode" | "opencode-go" | "chatgpt";

export interface AiModelSelection {
  provider: AiProviderId;
  id: string;
  contextWindow?: number;
}

export interface AiProviderConfig {
  openrouterApiKey?: string;
  opencodeApiKey?: string;
  opencodeGoApiKey?: string;
  defaultModel?: AiModelSelection;
}

/** The bundled OpenCode Zen gateway, OpenAI-compatible chat completions. */
export const OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1";

/** The OpenCode Go subscription gateway, same OpenAI-compatible shape. */
export const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";

export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;

/**
 * ChatGPT subscription models served by the local Codex sign-in. Availability
 * is enforced by the Codex backend per account at call time.
 */
export const CHATGPT_MODELS: readonly { id: string; label: string; contextWindow: number }[] = [
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", contextWindow: 272_000 },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", contextWindow: 272_000 },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", contextWindow: 272_000 },
  { id: "gpt-5.5", label: "GPT-5.5", contextWindow: 272_000 },
  { id: "gpt-5.4", label: "GPT-5.4", contextWindow: 272_000 },
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", contextWindow: 272_000 },
  { id: "gpt-5.2-codex", label: "GPT-5.2 Codex", contextWindow: 272_000 },
  { id: "gpt-5.1-codex", label: "GPT-5.1 Codex", contextWindow: 272_000 },
  { id: "gpt-5-codex", label: "GPT-5 Codex", contextWindow: 272_000 },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", contextWindow: 272_000 },
  { id: "gpt-5-nano", label: "GPT-5 Nano", contextWindow: 272_000 },
];

export const AI_PROVIDER_LABELS: Record<AiProviderId, string> = {
  openrouter: "OpenRouter",
  opencode: "OpenCode Zen",
  "opencode-go": "OpenCode Go",
  chatgpt: "ChatGPT (Codex)",
};

function configPath() {
  return path.resolve(process.cwd(), ".ousia/providers.json");
}

function cleanKey(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function parseModelSelection(value: unknown): AiModelSelection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const provider = record.provider;
  const id = record.id;
  if (provider !== "openrouter" && provider !== "opencode" && provider !== "opencode-go" && provider !== "chatgpt") return undefined;
  if (typeof id !== "string" || !id.trim()) return undefined;
  const contextWindow = typeof record.contextWindow === "number" && Number.isSafeInteger(record.contextWindow) && record.contextWindow > 0
    ? record.contextWindow
    : undefined;
  return { provider, id: id.trim(), ...(contextWindow ? { contextWindow } : {}) };
}

export async function readAiProviderConfig(): Promise<AiProviderConfig> {
  try {
    const parsed = JSON.parse(await fs.readFile(configPath(), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const record = parsed as Record<string, unknown>;
    return {
      ...(cleanKey(record.openrouterApiKey) ? { openrouterApiKey: cleanKey(record.openrouterApiKey) } : {}),
      ...(cleanKey(record.opencodeApiKey) ? { opencodeApiKey: cleanKey(record.opencodeApiKey) } : {}),
      ...(cleanKey(record.opencodeGoApiKey) ? { opencodeGoApiKey: cleanKey(record.opencodeGoApiKey) } : {}),
      ...(parseModelSelection(record.defaultModel) ? { defaultModel: parseModelSelection(record.defaultModel) } : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function writeAiProviderConfig(config: AiProviderConfig) {
  const file = configPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, file);
}

/** Stored key wins so the in-app connection overrides an env fallback. */
export async function resolveProviderApiKey(provider: "openrouter" | "opencode" | "opencode-go", config?: AiProviderConfig) {
  const resolved = config ?? (await readAiProviderConfig());
  if (provider === "openrouter") return resolved.openrouterApiKey ?? cleanKey(process.env.OPENROUTER_API_KEY);
  if (provider === "opencode-go") return resolved.opencodeGoApiKey ?? cleanKey(process.env.OPENCODE_GO_API_KEY);
  return resolved.opencodeApiKey ?? cleanKey(process.env.OPENCODE_API_KEY) ?? cleanKey(process.env.OPENCODE_ZEN_API_KEY);
}

export function maskSecret(value: string | undefined) {
  if (!value) return undefined;
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}
