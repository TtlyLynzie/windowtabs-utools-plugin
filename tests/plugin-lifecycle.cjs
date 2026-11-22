"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
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

async function testCleanupScope(root) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "windowtabs-plugin-cleanup-"));
  const helperRoot = path.join(dataRoot, "helper");
  fs.mkdirSync(helperRoot);
  fs.writeFileSync(path.join(helperRoot, "WindowTabs.exe"), "fixture");
  const filename = path.join(root, "preload.js");
  const utools = { getPluginLocalDataPath: () => dataRoot };
  const sandbox = { require: createRequire(filename), __dirname: root, process, Buffer,
    setTimeout, clearTimeout, console, window: {}, global: { utools }, utools, module: { exports: {} } };
  try {
    vm.runInNewContext(fs.readFileSync(filename, "utf8") + "\nmodule.exports = manager;", sandbox, { filename });
    const manager = sandbox.module.exports;
    manager.getManagedRecord = () => null;
    const guarded = await manager.cleanupManagedFiles({ onlyIfStopped: true });
    assert.equal(guarded.helperFilesRemoved, false);
    assert.equal(fs.existsSync(helperRoot), true);
    const explicit = await manager.cleanupManagedFiles({ onlyIfStopped: true, allowNoRecord: true });
    assert.equal(explicit.helperFilesRemoved, true);
    assert.equal(fs.existsSync(helperRoot), false);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

async function testHelperUpgradeAndRollback() {
  const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "windowtabs-plugin-versions-"));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "windowtabs-plugin-data-"));
  const bundledRoot = path.join(pluginRoot, "helper");
  const localRoot = path.join(dataRoot, "helper");
  fs.mkdirSync(bundledRoot, { recursive: true });
  for (const name of ["preload.js", "lifecycle-state.js", "settings-storage.js"]) {
    fs.copyFileSync(path.join(__dirname, "..", name), path.join(pluginRoot, name));
  }

  const writeBundle = (buildId, content) => {
    const versionDir = path.join(bundledRoot, buildId);
    fs.mkdirSync(versionDir, { recursive: true });
    fs.writeFileSync(path.join(versionDir, "WindowTabs.exe"), content);
    fs.writeFileSync(path.join(bundledRoot, "current.json"), JSON.stringify({
      version: buildId,
      buildId,
      path: `${buildId}/WindowTabs.exe`,
      sha256: require("crypto").createHash("sha256").update(content).digest("hex")
    }));
  };

  const fakeProcess = { platform: "win32", env: process.env, pid: process.pid };
  const filename = path.join(pluginRoot, "preload.js");
  const sandbox = {
    require: createRequire(filename), __dirname: pluginRoot, process: fakeProcess, Buffer,
    setTimeout, clearTimeout, console, window: {},
    global: { utools: { getPluginLocalDataPath: () => dataRoot } },
    utools: { getPluginLocalDataPath: () => dataRoot }, module: { exports: {} }
  };
  try {
    vm.runInNewContext(fs.readFileSync(filename, "utf8") + "\nmodule.exports = manager;", sandbox, { filename });
    const manager = sandbox.module.exports;

    writeBundle("ss_2026.11.22-upstream-integrated-v13", "core-v13");
    let selected = manager.resolveHelper();
    assert.equal(fs.readFileSync(selected, "utf8"), "core-v13");
    assert.equal(manager.helperManifest.buildId, "ss_2026.11.22-upstream-integrated-v13");
    assert.equal(JSON.parse(fs.readFileSync(path.join(localRoot, "current.json"), "utf8")).buildId,
      "ss_2026.11.22-upstream-integrated-v13");

    writeBundle("ss_2026.11.22-upstream-integrated-v14", "core-v14");
    selected = manager.resolveHelper();
    assert.equal(fs.readFileSync(selected, "utf8"), "core-v14");
    assert.equal(manager.helperManifest.buildId, "ss_2026.11.22-upstream-integrated-v14");
    assert.equal(JSON.parse(fs.readFileSync(path.join(localRoot, "current.json"), "utf8")).buildId,
      "ss_2026.11.22-upstream-integrated-v14");

    writeBundle("ss_2026.11.22-upstream-integrated-v13", "core-v13");
    selected = manager.resolveHelper();
    assert.equal(fs.readFileSync(selected, "utf8"), "core-v13");
    assert.equal(manager.helperManifest.buildId, "ss_2026.11.22-upstream-integrated-v13");
    assert.equal(JSON.parse(fs.readFileSync(path.join(localRoot, "current.json"), "utf8")).buildId,
      "ss_2026.11.22-upstream-integrated-v13");
  } finally {
    fs.rmSync(pluginRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

(async () => {
  const root = path.resolve(__dirname, "..");
  await test(root);
  await testDoesNotKillExternalPid(root);
  await testCleanupScope(root);
  await testHelperUpgradeAndRollback();
  console.log("plugin lifecycle and helper upgrade/rollback tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
