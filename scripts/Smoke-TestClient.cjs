"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { createHash } = require("crypto");
const loadPreload = require("../tests/load-preload.cjs");

async function main() {
  assert.equal(process.platform, "win32", "Run the real-core smoke on Windows");
  const root = path.resolve(process.argv[2] || path.join(__dirname, "../dist/market"));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "helper/current.json"), "utf8").replace(/^\uFEFF/, ""));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "wt-client-smoke-"));
  const coreDirectory = path.join(temporary, "core");
  fs.cpSync(path.dirname(path.join(root, "helper", manifest.path)), coreDirectory, { recursive: true });
  const pipeName = `\\\\.\\pipe\\windowtabs-client-smoke-${process.pid}-${Date.now()}`;
  const settingsPath = path.join(temporary, "WindowTabsSettings.json");
  const { PipeClient } = loadPreload(root);
  const client = new PipeClient(pipeName);
  const child = spawn(path.join(coreDirectory, "WindowTabs.exe"),
    [`--windowtabs-ipc-pipe=${pipeName}`, `--windowtabs-settings=${settingsPath}`], {
    cwd: coreDirectory, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", data => { output = (output + data).slice(-8000); });
  child.stderr.on("data", data => { output = (output + data).slice(-8000); });
  let spawnError;
  child.on("error", error => { spawnError = error; });
  const exited = new Promise(resolve => child.once("exit", resolve));
  try {
    const deadline = Date.now() + 20000;
    while (true) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`Core exited before connect: ${child.exitCode}`);
      try { await client.connect(500); break; }
      catch (error) {
        if (Date.now() >= deadline) throw error;
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }
    const hello = await client.request("hello");
    assert.equal(hello.protocolVersion, 1);
    assert.equal(hello.coreVersion, manifest.version);
    assert.equal(hello.buildId, manifest.buildId);
    assert.ok(hello.capabilities.includes("integrated-settings-v1"));
    assert.equal(hello.pid, child.pid, "Must connect to the core started by this test");
    assert.equal((await client.request("status")).running, true);
    const schema = JSON.parse(fs.readFileSync(path.join(root, "settings-schema.json"), "utf8"));
    const schemaSha256 = createHash("sha256").update(fs.readFileSync(path.join(root, "settings-schema.json"))).digest("hex");
    const initial = await client.request("settingsSnapshot", {}, 8000);
    assert.equal(initial.contractVersion, 1);
    assert.deepEqual(Object.keys(initial.values).sort(), schema.fields.map(field => field.path).sort());
    const target = schema.fields.find(field => field.path === "EnableDarkMode");
    const before = initial.values[target.path], changed = !before;
    const applied = await client.request("settingsApply", { changes: [{path:target.path,before,value:changed}] }, 8000);
    assert.equal(applied.values[target.path], changed, "setting must be read back after save");
    await assert.rejects(client.request("settingsApply", { changes: [{path:target.path,before,value:before}] }, 8000), error => error.code === "SETTINGS_CONFLICT");
    await assert.rejects(client.request("settingsApply", { changes: [{path:"TabPreviewDelay",before:applied.values.TabPreviewDelay,value:-1}] }, 8000), error => error.code === "INVALID_SETTING");
    const restored = await client.request("settingsApply", { changes: [{path:target.path,before:changed,value:before}] }, 8000);
    assert.equal(restored.values[target.path], before);
    assert.ok(fs.existsSync(settingsPath), "isolated settings must be written");
    const apps = await client.request("applications", {}, 8000);
    assert.ok(Array.isArray(apps.apps));
    const testApp = path.join(temporary, "WindowTabsSmokeApp.exe");
    let updatedApps = await client.request("applicationUpdate", {path:testApp,enabled:true,autoGroup:true,category:7}, 8000);
    const sameWindowsPath = (left, right) =>
      path.win32.normalize(left).toLowerCase() === path.win32.normalize(right).toLowerCase();
    let testRule = updatedApps.apps.find(app => sameWindowsPath(app.path, testApp));
    assert.ok(testRule && testRule.enabled && testRule.autoGroup && testRule.category === 7, "application rule must round-trip");
    updatedApps = await client.request("applicationUpdate", {path:testApp,remove:true}, 8000);
    assert.equal(updatedApps.apps.some(app => sameWindowsPath(app.path, testApp)), false, "test application rule must be removable");
    const afterApps = await client.request("settingsSnapshot", {}, 8000);
    const theme = { name:"Runtime smoke theme" };
    for (const field of schema.fields.filter(field => field.type === "color")) {
      const name = field.path.slice("TabAppearance.tab".length);
      const key = name[0].toLowerCase() + name.slice(1);
      theme[key] = (parseInt(initial.values[field.path], 16) | 0xff000000);
    }
    const themed = await client.request("themesUpdate", {items:[theme],revision:afterApps.revision}, 8000);
    assert.equal(themed.customThemes.length, 1, "custom theme must round-trip");
    const themesCleared = await client.request("themesUpdate", {items:[],revision:themed.revision}, 8000);
    assert.equal(themesCleared.customThemes.length, 0);
    const workspaces = await client.request("workspaces", {}, 8000);
    assert.ok(Array.isArray(workspaces.items));
    const workspaceReadback = await client.request("workspaceUpdate", {items:workspaces.items,revision:workspaces.revision}, 8000);
    assert.deepEqual(workspaceReadback.items, workspaces.items, "workspace definitions must round-trip");
    const storage = await client.request("storageInfo", {}, 8000);
    assert.ok(sameWindowsPath(fs.realpathSync.native(storage.path), fs.realpathSync.native(settingsPath)),
      "storage must resolve to the isolated settings file");
    await assert.rejects(client.request("notAnIpcMethod"), error => error.code === "INVALID_REQUEST");
    assert.equal((await client.request("shutdown", {}, 5000)).accepted, true);
    assert.equal(client.legacyResponseIdCount, 0, "New builds must echo exact IDs; legacy fallback may not hide a native regression");
    let timer;
    try {
      await Promise.race([exited, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Core failed to exit after shutdown")), 10000);
      })]);
    } finally { clearTimeout(timer); }
    const proof = { passed:true, suite:"integrated-settings-v1", buildId:manifest.buildId,
      sha256:manifest.sha256, schemaSha256, testedAt:new Date().toISOString() };
    if (process.argv[3]) fs.writeFileSync(path.resolve(process.argv[3]), JSON.stringify(proof, null, 2)+"\n");
    console.log(`Integrated settings runtime passed: ${manifest.patchId} (${manifest.sha256})`);
  } catch (error) {
    console.error("IPC trace:", JSON.stringify(client.trace));
    console.error("Core output:", output);
    throw error;
  } finally {
    client.close();
    if (child.exitCode === null) {
      child.kill();
      await exited;
    }
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
