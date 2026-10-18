import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { runCommand } from "./cli-process";

export interface FindpapersPaper {
  [key: string]: unknown;
}

export interface FindpapersInput {
  query: string;
  databases?: string[];
  since?: string;
  until?: string;
  limit?: number;
  openAccessOnly?: boolean;
}

function venvPython() {
  return path.resolve(process.cwd(), ".ousia", "findpapers-venv", "bin", "python");
}

function bridgeScript() {
  return path.resolve(process.cwd(), "scripts", "findpapers", "search.py");
}

/** Override with FINDPAPERS_PYTHON when the interpreter lives elsewhere. */
export function findpapersPython() {
  return process.env.FINDPAPERS_PYTHON?.trim() || venvPython();
}

let cachedAvailability: boolean | undefined;

export async function findpapersAvailable(): Promise<boolean> {
  if (cachedAvailability !== undefined) return cachedAvailability;
  const result = await runCommand(findpapersPython(), ["-c", "import findpapers"], { timeoutMs: 30_000 });
  cachedAvailability = result.success;
  return cachedAvailability;
}

/** Runs the findpapers bridge; returns the raw paper dicts or an error. */
export async function searchFindpapers(input: FindpapersInput): Promise<{ success: boolean; papers: FindpapersPaper[]; error?: string }> {
  if (!(await findpapersAvailable())) return { success: false, papers: [], error: "findpapers is not installed." };
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ousia-findpapers-"));
  const payloadPath = path.join(directory, "payload.json");
  const outPath = path.join(directory, "result.json");
  try {
    const payload = {
      ...input,
      enrichment: [],
      apiKeys: {
        openalex: process.env.OPENALEX_API_KEY,
        pubmed: process.env.NCBI_API_KEY,
        semantic_scholar: process.env.SEMANTIC_SCHOLAR_API_KEY,
        ieee: process.env.IEEE_API_KEY,
        scopus: process.env.SCOPUS_API_KEY,
        wos: process.env.WOS_API_KEY,
      },
      email: process.env.CROSSREF_MAILTO,
    };
    await fs.writeFile(payloadPath, JSON.stringify(payload), "utf8");
    const result = await runCommand(findpapersPython(), [bridgeScript(), "--payload", payloadPath, "--out", outPath], { timeoutMs: 150_000 });
    const raw = await fs.readFile(outPath, "utf8").catch(() => "");
    if (!raw) return { success: false, papers: [], error: result.success ? "findpapers produced no output." : result.error };
    const parsed = JSON.parse(raw) as { papers?: FindpapersPaper[]; error?: string };
    if (parsed.error) return { success: false, papers: [], error: parsed.error };
    return { success: true, papers: Array.isArray(parsed.papers) ? parsed.papers : [] };
  } catch (error) {
    return { success: false, papers: [], error: error instanceof Error ? error.message : "findpapers search failed." };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
