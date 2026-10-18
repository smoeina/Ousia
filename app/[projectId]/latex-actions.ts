"use server";

import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { requireUser } from "@/lib/auth/session";

function compileError(error: unknown) {
  if (error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT") {
    return "Install Tectonic to compile LaTeX locally.";
  }
  const stderr = error && typeof error === "object" && "stderr" in error ? String((error as { stderr?: string }).stderr ?? "") : "";
  const detail = stderr.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("error") || line.startsWith("!")).slice(0, 8).join("\n");
  return detail || (error instanceof Error ? error.message : "LaTeX compilation failed.");
}

export async function renderLatexDocument(source: string) {
  await requireUser();
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "ousia-latex-"));
  try {
    const sourcePath = path.join(temporary, "main.tex");
    await fs.writeFile(sourcePath, source, "utf8");
    await promisify(execFile)("tectonic", ["--outdir", temporary, sourcePath], {
      timeout: 120_000,
      cwd: temporary,
      maxBuffer: 8 * 1024 * 1024,
    });
    const pdf = await fs.readFile(path.join(temporary, "main.pdf"));
    return { success: true as const, content: Buffer.from(pdf).toString("base64") };
  } catch (error) {
    console.error("[latex-preview] compilation failed", error);
    return { success: false as const, error: compileError(error) };
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
