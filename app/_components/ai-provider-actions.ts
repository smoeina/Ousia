"use server";

import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

import { requireUser } from "@/lib/auth/session";
import {
  AI_PROVIDER_LABELS,
  maskSecret,
  parseModelSelection,
  readAiProviderConfig,
  writeAiProviderConfig,
  type AiModelSelection,
  type AiProviderId,
} from "@/lib/ai-providers";
import { invalidateAiModelCache, listAiModels, type AiModelOption } from "@/lib/ai-model-catalog";

export interface AiProviderStatus {
  id: AiProviderId;
  label: string;
  configured: boolean;
  maskedKey?: string;
  connected?: boolean;
  detail?: string;
}

export interface AiProviderSettings {
  providers: AiProviderStatus[];
  defaultModel?: AiModelSelection;
}

type KeyProvider = "openrouter" | "opencode" | "opencode-go";

function codexLoginLogPath() {
  return path.resolve(process.cwd(), ".ousia/codex-login.log");
}

async function chatGptStatus(): Promise<{ connected: boolean; detail: string }> {
  return await new Promise((resolve) => {
    const child = spawn("codex", ["login", "status"], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.once("error", () => { clearTimeout(timer); resolve({ connected: false, detail: "Install the Codex CLI to sign in with ChatGPT." }); });
    child.once("close", (code) => {
      clearTimeout(timer);
      const text = output.trim();
      const connected = code === 0 && /logged in/i.test(text) && !/not logged in/i.test(text);
      resolve({ connected, detail: text.split("\n").filter(Boolean).slice(-1)[0] ?? (connected ? "Connected" : "Not connected") });
    });
  });
}

export async function getAiProviderSettings(): Promise<AiProviderSettings> {
  await requireUser();
  const config = await readAiProviderConfig();
  const chatgpt = await chatGptStatus();
  return {
    providers: [
      { id: "openrouter", label: AI_PROVIDER_LABELS.openrouter, configured: Boolean(config.openrouterApiKey), maskedKey: maskSecret(config.openrouterApiKey) },
      { id: "opencode", label: AI_PROVIDER_LABELS.opencode, configured: Boolean(config.opencodeApiKey), maskedKey: maskSecret(config.opencodeApiKey) },
      { id: "opencode-go", label: AI_PROVIDER_LABELS["opencode-go"], configured: Boolean(config.opencodeGoApiKey), maskedKey: maskSecret(config.opencodeGoApiKey) },
      { id: "chatgpt", label: AI_PROVIDER_LABELS.chatgpt, configured: chatgpt.connected, connected: chatgpt.connected, detail: chatgpt.detail },
    ],
    defaultModel: config.defaultModel,
  };
}

export async function saveAiProviderKey(provider: KeyProvider, apiKey: string) {
  await requireUser();
  const trimmed = apiKey.trim();
  if (!trimmed) return { success: false as const, error: "Enter an API key." };
  const config = await readAiProviderConfig();
  if (provider === "openrouter") config.openrouterApiKey = trimmed;
  else if (provider === "opencode") config.opencodeApiKey = trimmed;
  else if (provider === "opencode-go") config.opencodeGoApiKey = trimmed;
  else return { success: false as const, error: "Unsupported provider." };
  await writeAiProviderConfig(config);
  invalidateAiModelCache();
  return { success: true as const };
}

export async function clearAiProviderKey(provider: KeyProvider) {
  await requireUser();
  const config = await readAiProviderConfig();
  if (provider === "openrouter") delete config.openrouterApiKey;
  else if (provider === "opencode") delete config.opencodeApiKey;
  else if (provider === "opencode-go") delete config.opencodeGoApiKey;
  else return { success: false as const, error: "Unsupported provider." };
  await writeAiProviderConfig(config);
  invalidateAiModelCache();
  return { success: true as const };
}

export async function setDefaultAiModel(selection: AiModelSelection | undefined) {
  await requireUser();
  const config = await readAiProviderConfig();
  const parsed = parseModelSelection(selection);
  if (parsed) config.defaultModel = parsed;
  else delete config.defaultModel;
  await writeAiProviderConfig(config);
  return { success: true as const, defaultModel: parsed };
}

export async function getAiModelCatalog(): Promise<AiModelOption[]> {
  await requireUser();
  return await listAiModels();
}

export async function connectChatGpt() {
  await requireUser();
  const current = await chatGptStatus();
  if (current.connected) return { success: true as const, connected: true as const, detail: current.detail };

  const logPath = codexLoginLogPath();
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const fd = openSync(logPath, "w", 0o600);
  try {
    const child = spawn("codex", ["login", "--device-auth"], { detached: true, stdio: ["ignore", fd, fd] });
    child.unref();
  } catch {
    closeSync(fd);
    return { success: false as const, error: "Could not start the Codex sign-in. Install the Codex CLI and try again." };
  }
  closeSync(fd);

  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const log = (await fs.readFile(logPath, "utf8").catch(() => "")).replace(/\u001b\[[0-9;]*m/g, "");
  const url = log.match(/https:\/\/[^\s]+/)?.[0];
  const code = log.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4,6})\b/)?.[1];
  if (!url || !code) return { success: false as const, error: "The sign-in prompt did not start. Try again." };
  return { success: true as const, connected: false as const, url, code };
}

export async function getChatGptConnectionStatus() {
  await requireUser();
  const status = await chatGptStatus();
  return { success: true as const, connected: status.connected, detail: status.detail };
}
