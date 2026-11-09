import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(decodeURIComponent(new URL("..", import.meta.url).pathname));
const html = readFileSync(resolve(root, "index.html"), "utf8");
const renderer = readFileSync(resolve(root, "renderer.js"), "utf8");
const preload = readFileSync(resolve(root, "preload.js"), "utf8");
const manifest = JSON.parse(readFileSync(resolve(root, "plugin.json"), "utf8"));

for (const id of ["navigation", "connection", "content", "savebar", "dialog", "importFile"]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `index.html 缺少 ${id}`);
}
assert.equal(manifest.main, "index.html");
assert.equal(manifest.preload, "preload.js");
assert.ok(manifest.features.some((feature) => feature.code === "windowtabs"));
assert.match(html, /settings-model\.js/);
assert.match(renderer, /settingsSnapshot/);
assert.match(renderer, /workspaceRestoreStatus/);
assert.doesNotMatch(renderer, /openSettings/);
assert.match(preload, /JSON\.parse\(line\.replace\(\/\^\\uFEFF\//, "preload.js must tolerate a UTF-8 BOM");

const require = createRequire(import.meta.url);
const M = require(resolve(root, "settings-model.js"));
const schema = JSON.parse(readFileSync(resolve(root, "settings-schema.json"), "utf8"));
assert.equal(schema.contractVersion, 1);
const values = Object.fromEntries(schema.fields.map(field => [field.path, field.default]));
const snapshot = { contractVersion: schema.contractVersion, values, revision: "r1", presets: [], customThemes: [] };
const draft = new M.Draft(schema, snapshot);
draft.set("EnableCtrlNumberHotKey", true);
draft.set("EnableAltNumberHotKey", true);
assert.equal(draft.values.EnableCtrlNumberHotKey, false, "number-key modes remain mutually exclusive");
assert.throws(() => new M.Draft(schema, { ...snapshot, values: {} }), /设置内容不完整/);
const firstColor = schema.fields.find(field => field.type === "color");
assert.throws(() => draft.set(firstColor.path, "not-a-color"), /值不正确/);
draft.set(firstColor.path, "AABBCC");
assert.deepEqual(draft.changes().find(change => change.path === firstColor.path), {
  path: firstColor.path, before: firstColor.default, value: "AABBCC"
});
console.log("source smoke test passed");
