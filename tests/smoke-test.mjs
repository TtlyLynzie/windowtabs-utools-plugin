import assert from "assert";
import { readFileSync } from "fs";
import { resolve } from "path";

const root = resolve(decodeURIComponent(new URL("..", import.meta.url).pathname));
const html = readFileSync(resolve(root, "index.html"), "utf8");
const renderer = readFileSync(resolve(root, "renderer.js"), "utf8");
const preload = readFileSync(resolve(root, "preload.js"), "utf8");
const manifest = JSON.parse(readFileSync(resolve(root, "plugin.json"), "utf8"));

for (const id of ["statusBadge", "startButton", "resetConfigButton", "diagnosticsOutput", "helperVersion"]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `index.html 缺少 ${id}`);
}
assert.equal(manifest.main, "index.html");
assert.equal(manifest.preload, "preload.js");
assert.ok(manifest.features.some((feature) => feature.code === "windowtabs"));
assert.match(renderer, /RunAtStartup/);
assert.match(renderer, /window\.confirm/);
assert.match(preload, /JSON\.parse\(line\.replace\(\/\^\\uFEFF\//, "preload.js must tolerate a UTF-8 BOM");
console.log("source smoke test passed");
