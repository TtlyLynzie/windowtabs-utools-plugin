"use strict";
const assert = require("assert");
const net = require("net");
const os = require("os");
const path = require("path");
const { PipeClient } = require("./load-preload.cjs")();

async function withPeer(reply, test) {
  const name = `wt-test-${process.pid}-${Math.random().toString(16).slice(2)}`;
  const address = process.platform === "win32" ? `\\\\.\\pipe\\${name}` : path.join(os.tmpdir(), name);
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = "";
    socket.on("data", chunk => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const request = JSON.parse(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        reply(socket, request);
      }
    });
  });
  await new Promise(resolve => server.listen(address, resolve));
  const client = new PipeClient(address);
  try { await test(client); }
  finally {
    client.close();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
}

async function main() {
  await withPeer((socket, request) => {
    assert.equal(typeof request.id, "string");
    const line = JSON.stringify({ id: request.id, ok: true, result: { method: request.method } });
    // BOM + split UTF-8 frames use the same parsing path as Windows pipes.
    socket.write("\uFEFF" + line.slice(0, 8));
    setTimeout(() => socket.write(line.slice(8) + "\n"), 5);
  }, async client => {
    assert.equal((await client.request("hello")).method, "hello");
  });

  // Regression: v9 native core returned JSON.stringify(request.id) as its ID.
  await withPeer((socket, request) => {
    socket.write(JSON.stringify({ id: JSON.stringify(request.id), ok: true, result: { running: true } }) + "\n");
  }, async client => {
    assert.equal((await client.request("status", {}, 100)).running, true);
    assert.equal(client.legacyResponseIdCount, 1);
  });

  await withPeer(socket => {
    socket.write(JSON.stringify({ id: "unrelated", ok: true, result: {} }) + "\n");
  }, async client => {
    await assert.rejects(client.request("getConfig", {}, 100), error => {
      assert.equal(error.code, "REQUEST_TIMEOUT");
      assert.equal(error.details.method, "getConfig");
      assert.ok(JSON.parse(JSON.stringify(error)).message.includes("getConfig"));
      return true;
    });
    assert.equal(client.pending.size, 0);
    assert.ok(client.trace.some(entry => entry.event === "unmatchedResponse"));
  });

  await withPeer((socket, request) => {
    const delay = request.method === "first" ? 20 : 0;
    setTimeout(() => socket.write(JSON.stringify({ id: request.id, ok: true, result: request.method }) + "\n"), delay);
  }, async client => {
    assert.deepEqual(await Promise.all([client.request("first"), client.request("second")]), ["first", "second"]);
  });
  console.log("production preload transport regression tests passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
