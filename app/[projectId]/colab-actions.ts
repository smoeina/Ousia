"use server";

import { requireUser } from "@/lib/auth/session";
import { executeNotebook, executeNotebookCell } from "@/lib/notebook-exec";
import { projectFolder } from "@/lib/workspace-files";
import {
  COLAB_ACCELERATORS,
  cancelColabLogin,
  colabSessionUrl,
  colabVersion,
  execColabNotebook,
  isColabAuthenticated,
  listColabSessions,
  startColabLogin,
  startColabSession,
  stopColabSession,
  submitColabLoginCode,
  type ColabAccelerator,
} from "@/lib/colab";

function clampTimeout(timeoutSeconds: number) {
  return Math.min(Math.max(Math.round(timeoutSeconds), 30), 1800);
}

export async function getColabStatus() {
  await requireUser();
  const version = await colabVersion();
  return { installed: Boolean(version), version, authenticated: version ? await isColabAuthenticated() : false };
}

export async function connectColab() {
  await requireUser();
  return await startColabLogin();
}

export async function submitColabCode(id: string, code: string) {
  await requireUser();
  if (!id || !code.trim()) return { success: false as const, output: "", error: "Enter the authorization code." };
  return await submitColabLoginCode(id, code.trim());
}

export async function cancelColab(id: string) {
  await requireUser();
  return cancelColabLogin(id);
}

export async function listColab() {
  await requireUser();
  return await listColabSessions();
}

export async function startSession(accelerator: string, highMem: boolean) {
  await requireUser();
  if (!COLAB_ACCELERATORS.includes(accelerator as ColabAccelerator)) {
    return { success: false as const, output: "", error: "Unsupported accelerator." };
  }
  return await startColabSession(accelerator as ColabAccelerator, highMem);
}

export async function stopSession() {
  await requireUser();
  return await stopColabSession();
}

export async function sessionUrl() {
  await requireUser();
  return await colabSessionUrl();
}

export async function runNotebookCellColab(projectId: string, cellIndex: number, notebookJson: string, timeoutSeconds = 600) {
  const user = await requireUser();
  const root = await projectFolder(user.id, projectId);
  return await executeNotebookCell(notebookJson, cellIndex, (temporaryPath) => execColabNotebook(temporaryPath, root, clampTimeout(timeoutSeconds)));
}

export async function runNotebook(projectId: string, notebookJson: string, timeoutSeconds = 600) {
  const user = await requireUser();
  const root = await projectFolder(user.id, projectId);
  return await executeNotebook(notebookJson, (temporaryPath) => execColabNotebook(temporaryPath, root, clampTimeout(timeoutSeconds)));
}
