import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { runCommand } from "./cli-process";

function venvPython() {
  return path.resolve(process.cwd(), ".ousia", "pdf-venv", "bin", "python");
}

function bridgeScript() {
  return path.resolve(process.cwd(), "scripts", "pdf", "pdf_to_text.py");
}

/** Override with PDF_PYTHON when the PyMuPDF interpreter lives elsewhere. */
export function pdfPython() {
  return process.env.PDF_PYTHON?.trim() || venvPython();
}

let cachedAvailability: boolean | undefined;

export async function pdfTextAvailable(): Promise<boolean> {
  if (cachedAvailability !== undefined) return cachedAvailability;
  const result = await runCommand(pdfPython(), ["-c", "import pymupdf"], { timeoutMs: 30_000 });
  cachedAvailability = result.success;
  return cachedAvailability;
}

export async function extractPdfText(absolutePath: string): Promise<{ success: boolean; text?: string; error?: string }> {
  if (!(await pdfTextAvailable())) {
    return { success: false, error: "PDF text extraction is not installed. Run `bash scripts/pdf/install.sh`." };
  }
  const outputPath = path.join(os.tmpdir(), `ousia-pdf-${randomUUID()}.txt`);
  try {
    const result = await runCommand(pdfPython(), [bridgeScript(), "--input", absolutePath, "--out", outputPath], { timeoutMs: 180_000 });
    if (!result.success) return { success: false, error: result.error };
    const text = await fs.readFile(outputPath, "utf8").catch(() => undefined);
    if (text === undefined) return { success: false, error: "PDF text extraction produced no output." };
    return { success: true, text };
  } finally {
    await fs.rm(outputPath, { force: true });
  }
}
