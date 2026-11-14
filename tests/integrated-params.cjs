"use strict";
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const loadPreload = require("./load-preload.cjs");

function check(root) {
  const { validateIntegratedParams } = loadPreload(root);
  assert.deepEqual(validateIntegratedParams("setEnabled", { enabled: true }), { enabled: true });
  assert.deepEqual(validateIntegratedParams("settingsSnapshot", {}), {});
  assert.throws(() => validateIntegratedParams("setEnabled", { enabled: "yes" }), /布尔值/);
  assert.throws(() => validateIntegratedParams("settingsSnapshot", { extra: true }), /不支持参数字段/);
  assert.throws(() => validateIntegratedParams("applicationUpdate", { path: "x", enabled: true }), /布尔值/);
  assert.throws(() => validateIntegratedParams("workspaceRestore", { index: -1, revision: "r" }), /超出范围/);
  assert.throws(() => validateIntegratedParams("themesUpdate", { items: [], revision: "r", extra: 1 }), /不支持参数字段/);
  assert.throws(() => validateIntegratedParams("settingsApply", { changes: [{ path: "x", before: null, value: "x", extra: 1 }] }), /不支持参数字段/);
  assert.throws(() => validateIntegratedParams("storageTransfer", { toPortable: true, move: true, revision: "r".repeat(129) }), /参数无效/);
  const deep = {}; let cursor = deep;
  for (let i = 0; i < 9; i += 1) { cursor.next = {}; cursor = cursor.next; }
  assert.throws(() => validateIntegratedParams("settingsSnapshot", deep), /嵌套层级/);
}

check(path.resolve(__dirname, ".."));
const market = path.resolve(__dirname, "../dist/market");
if (fs.existsSync(path.join(market, "preload.js"))) check(market);
console.log("integrated parameter validation tests passed");
