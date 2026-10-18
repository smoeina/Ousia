import { spawn, execFile, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Override with COLAB_CLI_PATH when the CLI is not on the server's PATH. */
const COLAB_BINARY = process.env.COLAB_CLI_PATH?.trim() || "colab";

export const COLAB_SESSION_NAME = "ousia";

export const COLAB_ACCELERATORS = ["CPU", "T4", "L4", "G4", "A100", "H100"] as const;
export type ColabAccelerator = (typeof COLAB_ACCELERATORS)[number];

export interface ColabResult {
  success: boolean;
  output: string;
  error?: string;
}

function tokenPath() {
  return path.join(os.homedir(), ".config", "colab-cli", "token.json");
}

function combined(error: unknown) {
  const value = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
  return [value.stdout, value.stderr].filter(Boolean).join("\n").trim();
}

export async function runColab(args: string[], options: { timeoutMs?: number; cwd?: string } = {}): Promise<ColabResult> {
  try {
    const { stdout, stderr } = await execFileAsync(COLAB_BINARY, args, {
      timeout: options.timeoutMs ?? 120_000,
      cwd: options.cwd,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { success: true, output: [stdout, stderr].filter(Boolean).join("\n").trim() };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { success: false, output: "", error: "The Colab CLI is not installed. Run `uv tool install google-colab-cli`." };
    }
    const output = combined(error);
    return { success: false, output, error: output || (error instanceof Error ? error.message : "Colab command failed.") };
  }
}

export async function colabVersion(): Promise<string | undefined> {
  const result = await runColab(["version"], { timeoutMs: 15_000 });
  if (!result.success) return undefined;
  return result.output.match(/\d+\.\d+\.\d+/)?.[0];
}

export async function isColabAuthenticated(): Promise<boolean> {
  try {
    await fs.access(tokenPath());
    return true;
  } catch {
    return false;
  }
}

interface PendingLogin {
  child: ChildProcessWithoutNullStreams;
  output: string;
}

const pendingLogins = new Map<string, PendingLogin>();

/**
 * Starts `colab whoami`, which prints a Google OAuth URL and then waits for a
 * pasted authorization code on stdin. We surface the URL and keep the process
 * alive until the code is submitted.
 */
export async function startColabLogin(): Promise<{ id: string; url: string } | { error: string }> {
  const child = spawn(COLAB_BINARY, ["whoami"], { stdio: ["pipe", "pipe", "pipe"] });
  const id = randomUUID();
  let output = "";
  return await new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ error: "Timed out waiting for the Google sign-in URL." });
    }, 20_000);
    const finish = (value: { id: string; url: string } | { error: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const url = output.match(/https:\/\/accounts\.google\.com\/[^\s]+/)?.[0];
      if (url) {
        pendingLogins.set(id, { child, output });
        finish({ id, url });
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") finish({ error: "The Colab CLI is not installed. Run `uv tool install google-colab-cli`." });
      else finish({ error: "Could not start the Colab sign-in." });
    });
    child.once("exit", () => finish({ error: output.trim() || "The sign-in process ended before showing a URL." }));
  });
}

export function cancelColabLogin(id: string) {
  const entry = pendingLogins.get(id);
  if (!entry) return false;
  entry.child.kill();
  pendingLogins.delete(id);
  return true;
}

export async function submitColabLoginCode(id: string, code: string): Promise<ColabResult> {
  const entry = pendingLogins.get(id);
  if (!entry) return { success: false, output: "", error: "The sign-in session expired. Start again." };
  const { child } = entry;
  let output = entry.output;
  return await new Promise((resolve) => {
    let done = false;
    const finish = (result: ColabResult) => {
      if (done) return;
      done = true;
      pendingLogins.delete(id);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ success: false, output: output.trim(), error: "Timed out exchanging the authorization code." });
    }, 30_000);
    child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      const text = output.trim();
      finish(exitCode === 0 ? { success: true, output: text } : { success: false, output: text, error: text || "Google sign-in failed." });
    });
    child.stdin?.write(`${code}\n`);
  });
}

export function listColabSessions() {
  return runColab(["sessions"], { timeoutMs: 30_000 });
}

export async function startColabSession(accelerator: ColabAccelerator, highMem: boolean) {
  const args = ["new", "-s", COLAB_SESSION_NAME];
  if (accelerator !== "CPU") args.push("--gpu", accelerator);
  if (highMem) args.push("--high-mem");
  return await runColab(args, { timeoutMs: 5 * 60_000 });
}

export function stopColabSession() {
  return runColab(["stop", "-s", COLAB_SESSION_NAME], { timeoutMs: 60_000 });
}

export function colabSessionUrl() {
  return runColab(["url", "-s", COLAB_SESSION_NAME], { timeoutMs: 30_000 });
}

export function execColabNotebook(absolutePath: string, cwd: string, timeoutSeconds: number) {
  return runColab(["exec", "-s", COLAB_SESSION_NAME, "-f", absolutePath, "--timeout", String(timeoutSeconds)], {
    timeoutMs: (timeoutSeconds + 90) * 1000,
    cwd,
  });
}

