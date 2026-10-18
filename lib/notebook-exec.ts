import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { CommandResult } from "./cli-process";

interface NotebookShape {
  cells?: Array<Record<string, unknown>>;
}

export interface NotebookRunResult {
  success: boolean;
  output: string;
  error?: string;
  content?: string;
}

export interface CellRunResult {
  success: boolean;
  output: string;
  error?: string;
  outputs?: Array<Record<string, unknown>>;
  executionCount?: number | null;
}

type Runner = (temporaryPath: string, temporaryDir: string) => Promise<CommandResult>;

function parseNotebook(json: string): NotebookShape | undefined {
  try {
    const value = JSON.parse(json) as unknown;
    return value && typeof value === "object" && Array.isArray((value as NotebookShape).cells) ? value as NotebookShape : undefined;
  } catch {
    return undefined;
  }
}

async function writeTemporaryNotebook(notebook: NotebookShape, cells: Array<Record<string, unknown>>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ousia-notebook-"));
  const file = path.join(directory, "notebook.ipynb");
  await fs.writeFile(file, JSON.stringify({ ...notebook, cells }, null, 2), "utf8");
  return { directory, file };
}

/** Executes every cell of the provided notebook and returns the updated JSON. */
export async function executeNotebook(notebookJson: string, run: Runner): Promise<NotebookRunResult> {
  const notebook = parseNotebook(notebookJson);
  if (!notebook) return { success: false, output: "", error: "Invalid notebook." };
  const { directory, file } = await writeTemporaryNotebook(notebook, notebook.cells ?? []);
  try {
    const result = await run(file, directory);
    if (!result.success) return { success: false, output: result.output, error: result.error };
    const content = await fs.readFile(file, "utf8");
    return { success: true, output: result.output, content };
  } catch (error) {
    return { success: false, output: "", error: error instanceof Error ? error.message : "Notebook execution failed." };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

/**
 * Runs one cell by executing a temporary notebook containing every cell up to
 * and including the target, so earlier definitions are in scope. Returns that
 * cell's outputs.
 */
export async function executeNotebookCell(notebookJson: string, cellIndex: number, run: Runner): Promise<CellRunResult> {
  const notebook = parseNotebook(notebookJson);
  if (!notebook) return { success: false, output: "", error: "Invalid notebook." };
  const cells = notebook.cells ?? [];
  if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= cells.length) {
    return { success: false, output: "", error: "Cell not found." };
  }
  const { directory, file } = await writeTemporaryNotebook(notebook, cells.slice(0, cellIndex + 1));
  try {
    const result = await run(file, directory);
    if (!result.success) return { success: false, output: result.output, error: result.error };
    const executed = JSON.parse(await fs.readFile(file, "utf8")) as NotebookShape;
    const target = executed.cells?.[cellIndex] ?? {};
    return {
      success: true,
      output: result.output,
      outputs: (target.outputs as Array<Record<string, unknown>> | undefined) ?? [],
      executionCount: (target.execution_count as number | null | undefined) ?? null,
    };
  } catch (error) {
    return { success: false, output: "", error: error instanceof Error ? error.message : "Cell execution failed." };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
