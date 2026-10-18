import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CommandResult {
  success: boolean;
  output: string;
  error?: string;
}

/** Runs a local command, capturing combined output and mapping ENOENT to a hint. */
export async function runCommand(binary: string, args: string[], options: { timeoutMs?: number; cwd?: string } = {}): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(binary, args, {
      timeout: options.timeoutMs ?? 120_000,
      cwd: options.cwd,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { success: true, output: [stdout, stderr].filter(Boolean).join("\n").trim() };
  } catch (error) {
    const value = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (value.code === "ENOENT") return { success: false, output: "", error: `\`${binary}\` was not found on this computer.` };
    const output = [value.stdout, value.stderr].filter(Boolean).join("\n").trim();
    return { success: false, output, error: output || (error instanceof Error ? error.message : `\`${binary}\` failed.`) };
  }
}
