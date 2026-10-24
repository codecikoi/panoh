import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { log } from "@madat/core";

const CANDIDATES = [
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

export function chromiumPath(): string | undefined {
  const configured = process.env.CHROMIUM_PATH;
  if (configured) return configured;
  return CANDIDATES.find((p) => existsSync(p));
}

/**
 * Prints self-contained HTML to PDF with headless Chromium, one short-lived process per report.
 * The page has no scripts and no network access (CSP in the HTML plus the flags below).
 */
export async function htmlToPdf(html: string, timeoutMs = 60_000): Promise<Buffer> {
  const bin = chromiumPath();
  if (!bin) throw new Error("Chromium not found: install it or set CHROMIUM_PATH");
  const dir = await mkdtemp(path.join(tmpdir(), "madat-report-"));
  const input = path.join(dir, "report.html");
  const output = path.join(dir, "report.pdf");
  try {
    await writeFile(input, html);
    const args = [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-component-update",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--mute-audio",
      "--proxy-server=127.0.0.1:9", // nothing on the page may reach the network
      "--proxy-bypass-list=<-loopback>",
      `--user-data-dir=${path.join(dir, "profile")}`,
      "--no-pdf-header-footer",
      "--run-all-compositor-stages-before-draw",
      "--virtual-time-budget=5000",
      `--print-to-pdf=${output}`,
      `file://${input}`,
    ];
    await new Promise<void>((resolve, reject) => {
      const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-2000);
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Chromium timed out"));
      }, timeoutMs);
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else {
          log.warn("chromium failed", { code, stderr });
          reject(new Error(`Chromium exited with code ${code}`));
        }
      });
    });
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
