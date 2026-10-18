"use server";

import path from "node:path";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/session";
import { extractPdfText, pdfTextAvailable } from "@/lib/pdf";
import { listAgentWorkspaceFilesRecursive, projectFolder, writeAgentWorkspaceFile } from "@/lib/workspace-files";

export async function getPdfImportStatus() {
  await requireUser();
  return { available: await pdfTextAvailable() };
}

export async function listProjectPdfs(projectId: string) {
  const user = await requireUser();
  const files = await listAgentWorkspaceFilesRecursive(user.id, projectId, 5_000);
  return files
    .filter((entry) => !entry.isDir && entry.name.toLowerCase().endsWith(".pdf"))
    .map((entry) => ({ name: entry.name, path: entry.path }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export async function convertPdfToText(projectId: string, pdfPath: string) {
  const user = await requireUser();
  if (!/\.pdf$/i.test(pdfPath)) return { success: false as const, error: "Choose a PDF file." };
  const root = await projectFolder(user.id, projectId);
  const absolute = path.resolve(root, pdfPath);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    return { success: false as const, error: "Invalid PDF path." };
  }
  const result = await extractPdfText(absolute);
  if (!result.success) return { success: false as const, error: result.error };
  const text = result.text ?? "";
  const textPath = `${pdfPath}.txt`;
  await writeAgentWorkspaceFile(user.id, projectId, textPath, text);
  revalidatePath(`/${projectId}`);
  return { success: true as const, textPath, name: textPath.split("/").at(-1) || textPath, characters: text.length };
}
