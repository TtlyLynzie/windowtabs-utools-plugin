import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(process.argv[2] || new URL("..", import.meta.url).pathname);
const manifestPath = resolve(root, "helper/current.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""));
const helperPath = resolve(dirname(manifestPath), manifest.path);

if (!manifest.version || !manifest.buildId || !manifest.path || !manifest.protocol || manifest.ipc !== true || manifest.supportsIpc !== true) {
  throw new Error("helper/current.json 缺少版本身份、协议或 IPC 标记");
}
if (!existsSync(helperPath)) {
  throw new Error(`找不到 WindowTabs 核心：${helperPath}`);
}
if (manifest.sha256 && manifest.sha256 !== "pending-local-build") {
  const actual = createHash("sha256").update(readFileSync(helperPath)).digest("hex");
  if (actual.toLowerCase() !== String(manifest.sha256).toLowerCase()) {
    throw new Error(`WindowTabs 核心 SHA-256 不匹配：${helperPath}`);
  }
}
console.log(`helper valid: ${manifest.version} (${helperPath})`);
