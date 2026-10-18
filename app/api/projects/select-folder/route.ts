import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import { getUser } from "@/lib/auth/session";
const execFileAsync = promisify(execFile);
export const runtime = "nodejs";

const PROMPT = "Choose a Ousia project folder";

class PickerError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function chooseMac() {
  const { stdout } = await execFileAsync("osascript", ["-e", `POSIX path of (choose folder with prompt "${PROMPT}")`], { timeout: 120000 });
  return stdout.trim();
}

async function chooseLinux() {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) throw new PickerError("Enter an absolute folder path on this computer", 501);
  try {
    const { stdout } = await execFileAsync("zenity", ["--file-selection", "--directory", "--title", PROMPT], { timeout: 120000 });
    return stdout.trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    const { stdout } = await execFileAsync("kdialog", ["--getexistingdirectory", process.env.HOME ?? ".", "--title", PROMPT], { timeout: 120000 });
    return stdout.trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    throw new PickerError("No folder picker is available; enter an absolute folder path", 501);
  }
}

export async function POST() {
  if (!(await getUser())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    if (process.platform === "darwin") return Response.json({ folderPath: await fs.realpath(await chooseMac()) });
    if (process.platform === "linux") return Response.json({ folderPath: await fs.realpath(await chooseLinux()) });
    return Response.json({ error: "Enter an absolute folder path on this computer" }, { status: 501 });
  } catch (error) {
    const status = error instanceof PickerError ? error.status : 400;
    return Response.json({ error: error instanceof Error ? error.message : "Folder selection cancelled" }, { status });
  }
}
