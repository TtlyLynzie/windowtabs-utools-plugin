"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createRequire } = require("module");

async function test(root) {
  const filename = path.join(root, "preload.js");
  let onOut;
  const utools = { onPluginOut: callback => { onOut = callback; } };
  const sandbox = { require: createRequire(filename), __dirname: root, process, Buffer,
    setTimeout, clearTimeout, console, window: {}, global: { utools }, utools, module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(filename, "utf8") + "\nmodule.exports = manager;", sandbox, { filename });
  const manager = sandbox.module.exports;
  const calls = [];
  manager.stop = async () => { calls.push("stop"); };
  manager.dispose = () => { calls.push("dispose"); };
  onOut(false);
  onOut(true);
  assert.deepEqual(calls, ["dispose", "dispose"]);
  assert.equal(manager.exitPromise, undefined);
}

(async () => {
  await test(path.resolve(__dirname, ".."));
  console.log("plugin exit lifecycle tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
