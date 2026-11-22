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
  manager.dispose = () => { calls.push("dispose"); };
  manager.stopForKill = () => { calls.push("stopForKill"); return Promise.resolve(); };
  onOut(false);
  onOut(true);
  assert.deepEqual(calls, ["dispose", "stopForKill"]);
  assert.equal(manager.lastStatus.state, "INSTALLED_STOPPED");
  assert.equal(manager.exitPromise, undefined);
}

async function testDoesNotKillExternalPid(root) {
  const filename = path.join(root, "preload.js");
  const sandbox = { require: createRequire(filename), __dirname: root, process, Buffer,
    setTimeout, clearTimeout, console, window: {}, global: { utools: {} }, utools: {}, module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(filename, "utf8") + "\nmodule.exports = manager;", sandbox, { filename });
  const manager = sandbox.module.exports;
  const calls = [];
  manager.getStatus = async () => ({ state: "LEGACY_RUNNING", pid: 2468 });
  manager.getManagedRecord = () => null;
  manager.waitForProcessExit = async () => false;
  manager.terminateProcessByPid = async pid => { calls.push(pid); return true; };
  await assert.rejects(() => manager.stop(), /非插件托管/);
  assert.deepEqual(calls, []);
}

(async () => {
  const root = path.resolve(__dirname, "..");
  await test(root);
  await testDoesNotKillExternalPid(root);
  console.log("plugin exit lifecycle tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
