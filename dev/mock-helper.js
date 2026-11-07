"use strict";

const net = require("net");
const os = require("os");
const path = require("path");

const arg = process.argv.find((value) => value.startsWith("--windowtabs-ipc-pipe="));
const pipeName = arg
  ? arg.slice("--windowtabs-ipc-pipe=".length)
  : process.env.WINDOWTABS_PIPE_NAME || path.join(os.tmpdir(), "windowtabs-mock.sock");

let server;
let groupCount = 2;
let revision = 1;
const config = {
  schemaVersion: 1,
  autoGrouping: true,
  tabEdge: "top",
  enableCtrlNumberHotKey: true,
  enableAltNumberHotKey: false,
  theme: "system"
};

function reply(socket, id, result, error) {
  socket.write(JSON.stringify(error ? { id, ok: false, error } : { id, ok: true, result }) + "\n");
}

function handle(socket, message) {
  const { id, method, params = {} } = message;
  if (method === "hello") {
    return reply(socket, id, {
      coreVersion: "mock-0.1.0",
      protocolVersion: 1,
      capabilities: ["status", "config", "settings"]
    });
  }
  if (method === "status") {
    return reply(socket, id, {
      running: true,
      coreVersion: "mock-0.1.0",
      pid: process.pid,
      groupCount,
      protocol: 1,
      revision,
      message: "Mock WindowTabs 正在运行"
    });
  }
  if (method === "getConfig") return reply(socket, id, { ...config, revision });
  if (method === "updateConfig") {
    if (params.revision && params.revision !== revision) {
      return reply(socket, id, null, { code: "REVISION_CONFLICT", message: "配置版本已变化" });
    }
    Object.assign(config, params.patch || {});
    revision += 1;
    return reply(socket, id, { ...config, revision });
  }
  if (method === "openSettings") return reply(socket, id, { opened: true });
  if (method === "restart") return reply(socket, id, { restarting: true });
  if (method === "stop" || method === "shutdown") {
    reply(socket, id, { stopping: true });
    setTimeout(() => server.close(() => process.exit(0)), 30);
    return;
  }
  return reply(socket, id, null, { code: "UNSUPPORTED", message: `Mock helper 不支持 ${method}` });
}

server = net.createServer((socket) => {
  socket.setEncoding("utf8");
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      try { handle(socket, JSON.parse(line)); } catch (error) {
        socket.write(JSON.stringify({ ok: false, error: { code: "BAD_REQUEST", message: error.message } }) + "\n");
      }
    }
  });
});

server.listen(pipeName, () => {
  process.stdout.write(`mock helper ready: ${pipeName}\n`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
