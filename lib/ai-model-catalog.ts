import {
  CHATGPT_MODELS,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  OPENCODE_GO_BASE_URL,
  OPENCODE_ZEN_BASE_URL,
  OPENROUTER_MODELS_URL,
  readAiProviderConfig,
  resolveProviderApiKey,
  type AiProviderId,
} from "./ai-providers";

export interface AiModelOption {
  provider: AiProviderId;
  id: string;
  label: string;
  contextWindow: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
let cache: { at: number; models: AiModelOption[] } | undefined;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

async function fetchJson(url: string, apiKey?: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`${url} responded ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function openRouterModels(apiKey: string | undefined): Promise<AiModelOption[]> {
  if (!apiKey) return [];
  const payload = asRecord(await fetchJson(OPENROUTER_MODELS_URL, apiKey));
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const models: AiModelOption[] = [];
  for (const entry of data) {
    const record = asRecord(entry);
    const id = typeof record?.id === "string" ? record.id : undefined;
    if (!id) continue;
    const parameters = Array.isArray(record?.supported_parameters) ? record.supported_parameters : [];
    if (!parameters.includes("tools")) continue;
    const contextWindow = typeof record?.context_length === "number" && record.context_length > 0 ? record.context_length : DEFAULT_CONTEXT_WINDOW_TOKENS;
    const name = typeof record?.name === "string" && record.name.trim() ? record.name.trim() : id;
    models.push({ provider: "openrouter", id, label: name, contextWindow });
  }
  models.sort((a, b) => a.label.localeCompare(b.label));
  return models;
}

async function openCodeModels(provider: "opencode" | "opencode-go", baseUrl: string, apiKey: string | undefined): Promise<AiModelOption[]> {
  if (!apiKey) return [];
  const payload = asRecord(await fetchJson(`${baseUrl}/models`, apiKey));
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const models: AiModelOption[] = [];
  for (const entry of data) {
    const record = asRecord(entry);
    const id = typeof record?.id === "string" ? record.id : undefined;
    if (!id || id.includes("embedding")) continue;
    models.push({ provider, id, label: id, contextWindow: DEFAULT_CONTEXT_WINDOW_TOKENS });
  }
  models.sort((a, b) => a.label.localeCompare(b.label));
  return models;
}

function chatGptModels(): AiModelOption[] {
  return CHATGPT_MODELS.map((model) => ({ provider: "chatgpt" as const, id: model.id, label: model.label, contextWindow: model.contextWindow }));
}

/** Best-effort catalog; a provider without credentials contributes nothing. */
export async function listAiModels({ refresh = false }: { refresh?: boolean } = {}): Promise<AiModelOption[]> {
  if (!refresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.models;
  const config = await readAiProviderConfig();
  const [openrouter, opencode, opencodeGo] = await Promise.all([
    openRouterModels(await resolveProviderApiKey("openrouter", config)).catch(() => []),
    openCodeModels("opencode", OPENCODE_ZEN_BASE_URL, await resolveProviderApiKey("opencode", config)).catch(() => []),
    openCodeModels("opencode-go", OPENCODE_GO_BASE_URL, await resolveProviderApiKey("opencode-go", config)).catch(() => []),
  ]);
  const models = [...chatGptModels(), ...opencode, ...opencodeGo, ...openrouter];
  cache = { at: Date.now(), models };
  return models;
}

export function invalidateAiModelCache() {
  cache = undefined;
}
