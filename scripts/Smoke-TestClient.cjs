"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const loadPreload = require("../tests/load-preload.cjs");

async function main() {
  assert.equal(process.platform, "win32", "Run the real-core smoke on Windows");
  const root = path.resolve(process.argv[2] || path.join(__dirname, "../dist/market"));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "helper/current.json"), "utf8").replace(/^\uFEFF/, ""));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "wt-client-smoke-"));
  const coreDirectory = path.join(temporary, "core");
  fs.cpSync(path.dirname(path.join(root, "helper", manifest.path)), coreDirectory, { recursive: true });
  const pipeName = `\\\\.\\pipe\\windowtabs-client-smoke-${process.pid}-${Date.now()}`;
  const { PipeClient } = loadPreload(root);
  const client = new PipeClient(pipeName);
  const child = spawn(path.join(coreDirectory, "WindowTabs.exe"), [`--windowtabs-ipc-pipe=${pipeName}`], {
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
    assert.equal(hello.pid, child.pid, "Must connect to the core started by this test");
    assert.equal((await client.request("status")).running, true);
    const config = await client.request("getConfig", {}, 8000);
    assert.equal(typeof config.RunAtStartup, "boolean");
    // Empty patch exercises the settings write route without changing preferences.
    const updated = await client.request("updateConfig", { patch: {} }, 8000);
    assert.deepEqual(updated, config);
    await assert.rejects(client.request("notAnIpcMethod"), error => error.code === "INVALID_REQUEST");
    assert.equal((await client.request("shutdown", {}, 5000)).accepted, true);
    assert.equal(client.legacyResponseIdCount, 0, "New builds must echo exact IDs; legacy fallback may not hide a native regression");
    let timer;
    try {
      await Promise.race([exited, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Core failed to exit after shutdown")), 10000);
      })]);
    } finally { clearTimeout(timer); }
    console.log(`Packaged production preload + Windows core passed: ${manifest.patchId} (${manifest.sha256})`);
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
