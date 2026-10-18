import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const root = process.cwd();
dotenv.config({ path: path.join(root, ".env.local") });
dotenv.config({ path: path.join(root, ".env") });
const dataDir = path.join(root, ".ousia");
mkdirSync(dataDir, { recursive: true });
const env = {
  ...process.env,
  NODE_ENV: "production",
  LOCAL_DB_PATH: process.env.LOCAL_DB_PATH || path.join(dataDir, "ousia.sqlite"),
  AGENT_URL: process.env.AGENT_URL || "http://127.0.0.1:2000",
};
const bin = (name) => path.join(root, "node_modules", ".bin", name);
function run(name, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin(name), args, { cwd: root, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code) => (code === 0 ? resolve() : reject(new Error(`${name} exited with ${code}`))));
  });
}
await run("drizzle-kit", ["migrate"]);

// Bind the UI to all interfaces inside containers; loopback by default locally.
const uiHost = process.env.UI_HOST || "127.0.0.1";
const uiPort = process.env.PORT || "3000";
const children = [
  spawn(bin("next"), ["start", "--hostname", uiHost, "--port", uiPort], { cwd: root, env, stdio: "inherit" }),
  spawn(bin("eve"), ["start", "--host", "127.0.0.1", "--port", "2000"], { cwd: root, env, stdio: "inherit" }),
];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
for (const child of children) {
  child.once("error", (error) => { console.error(error); stop(); process.exitCode = 1; });
  child.once("exit", (code) => { if (!stopping) { console.error(`Local server exited (${code})`); stop(); process.exitCode = code || 1; } });
}
