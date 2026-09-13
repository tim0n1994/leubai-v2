// Container-only supervisor. The application itself keeps its loopback listener.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

if (process.env.LEUBAI_AUTH_DISABLED === "1") {
  throw new Error("Authentication cannot be disabled in the public container.");
}
const dataDir = process.env.LEUBAI_DATA_DIR || "/app/.leubai-local";
await mkdir(dataDir, { recursive: true, mode: 0o700 });
const env = {
  ...process.env,
  NODE_ENV: "production",
  LEUBAI_HOST: "127.0.0.1",
  LEUBAI_PORT: "5200",
  LEUBAI_AUTH_DB: process.env.LEUBAI_AUTH_DB || join(dataDir, "auth.sqlite"),
  LEUBAI_SETTINGS_FILE: process.env.LEUBAI_SETTINGS_FILE || join(dataDir, "llm-settings.json"),
};
if (!env.LEUBAI_AUTH_SECRET && !env.JWT_SECRET) {
  const secretFile = join(dataDir, "auth-secret");
  try {
    await writeFile(secretFile, randomBytes(48).toString("hex"), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  env.LEUBAI_AUTH_SECRET = await readFile(secretFile, "utf8");
}
if (!env.LEUBAI_PUBLIC_ORIGIN) {
  console.warn("[leubai] Set LEUBAI_PUBLIC_ORIGIN to the exact HTTPS application origin; public API requests stay blocked until configured.");
}
const children = [
  spawn(process.execPath, ["server/start.mjs"], { env, stdio: "inherit" }),
  spawn("nginx", ["-c", "/app/deploy/modelscope-nginx.conf", "-g", "daemon off;"], { stdio: "inherit" }),
];
let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  const timer = setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
  }, 5000);
  Promise.all(children.map((child) => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once("exit", resolve);
  }))).then(() => { clearTimeout(timer); process.exit(code); });
}
for (const child of children) {
  child.once("error", (error) => { console.error(error.message); shutdown(1); });
  child.once("exit", () => shutdown(1));
}
process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
