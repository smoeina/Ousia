"use server";

import { requireUser } from "@/lib/auth/session";
import { executeNotebook, executeNotebookCell } from "@/lib/notebook-exec";
import { projectFolder } from "@/lib/workspace-files";
import { jupyterVersion, runJupyterNotebook } from "@/lib/jupyter";

function clampTimeout(timeoutSeconds: number) {
  return Math.min(Math.max(Math.round(timeoutSeconds), 30), 1800);
}

export async function getJupyterStatus() {
  await requireUser();
  const version = await jupyterVersion();
  return { installed: Boolean(version), version };
}

export async function runNotebookCellLocal(projectId: string, cellIndex: number, notebookJson: string, timeoutSeconds = 600) {
  const user = await requireUser();
  const root = await projectFolder(user.id, projectId);
  return await executeNotebookCell(notebookJson, cellIndex, (temporaryPath) => runJupyterNotebook(temporaryPath, root, clampTimeout(timeoutSeconds)));
}

export async function runNotebookLocal(projectId: string, notebookJson: string, timeoutSeconds = 600) {
  const user = await requireUser();
  const root = await projectFolder(user.id, projectId);
  return await executeNotebook(notebookJson, (temporaryPath) => runJupyterNotebook(temporaryPath, root, clampTimeout(timeoutSeconds)));
}
