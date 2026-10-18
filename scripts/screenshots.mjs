// Regenerates the README screenshots from a running app.
//   node scripts/screenshots.mjs
//   OUSIA_URL=http://127.0.0.1:3000 OUSIA_PROJECT=<slug> node scripts/screenshots.mjs
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const base = process.env.OUSIA_URL || "http://127.0.0.1:3000";
const project = process.env.OUSIA_PROJECT || "JTs2KUWQ24";
const executablePath = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const out = "docs/screenshots";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();

await page.goto(`${base}/workspace`, { waitUntil: "networkidle" });
await page.screenshot({ path: `${out}/workspace.png` });

await page.goto(`${base}/${project}?file=research-draft.md`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/project-workspace.png` });

await page.click('[aria-label="New File"]');
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/plus-menu.png` });

await browser.close();
console.log(`screenshots written to ${out}`);
