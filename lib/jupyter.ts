import { runCommand, type CommandResult } from "./cli-process";

/** Override with JUPYTER_BIN when the Jupyter CLI is not on the server's PATH. */
const JUPYTER_BINARY = process.env.JUPYTER_BIN?.trim() || "jupyter";

export async function jupyterVersion(): Promise<string | undefined> {
  const result = await runCommand(JUPYTER_BINARY, ["--version"], { timeoutMs: 20_000 });
  if (!result.success) return undefined;
  const match = result.output.match(/nbconvert\s*:\s*([\d.]+)/i) ?? result.output.match(/ipykernel\s*:\s*([\d.]+)/i);
  return match?.[1];
}

/** Executes every code cell in place against the local default kernel. */
export function runJupyterNotebook(absolutePath: string, cwd: string, timeoutSeconds: number): Promise<CommandResult> {
  return runCommand(
    JUPYTER_BINARY,
    ["nbconvert", "--to", "notebook", "--execute", "--inplace", `--ExecutePreprocessor.timeout=${timeoutSeconds}`, absolutePath],
    { cwd, timeoutMs: (timeoutSeconds + 90) * 1000 },
  );
}
