"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const net = require("net");
const crypto = require("crypto");
const { spawn } = require("child_process");

const PLUGIN_ROOT = __dirname;
const PROTOCOL_VERSION = 1;
const REQUEST_TIMEOUT_MS = 2000;
const START_TIMEOUT_MS = 5000;
const STOP_TIMEOUT_MS = 3000;
const LEGACY_GRACE_MS = 900;
const MAX_FRAME_BYTES = 1024 * 1024;
const NATIVE_PLATFORM = "win32";

function makeError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function getPluginDataPath() {
  if (global.utools && typeof utools.getPluginLocalDataPath === "function") {
    return utools.getPluginLocalDataPath();
  }
  return path.join(os.tmpdir(), "windowtabs-utools-plugin");
}

function getPipeName() {
  if (process.env.WINDOWTABS_PIPE_NAME) return process.env.WINDOWTABS_PIPE_NAME;
  const identity = `${os.userInfo().username}|${getPluginDataPath()}`;
  return `\\\\.\\pipe\\windowtabs-${hash(identity)}`;
}

function fileExists(filePath) {
  try { return fs.existsSync(filePath); } catch (_) { return false; }
}

function copyTreeSync(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyTreeSync(path.join(source, entry), path.join(target, entry));
    }
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(temporary, filePath);
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch (_) { return fallback; }
}

class PipeClient {
  constructor(pipeName) {
    this.pipeName = pipeName;
    this.socket = null;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.connecting = null;
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isConnected() {
    return Boolean(this.socket && !this.socket.destroyed);
  }

  connect(timeoutMs = REQUEST_TIMEOUT_MS) {
    if (this.isConnected()) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      let settled = false;
      const socket = net.createConnection(this.pipeName);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(makeError("PIPE_UNAVAILABLE", "无法连接 WindowTabs 命名管道"));
      }, timeoutMs);

      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve();
      };

      socket.setEncoding("utf8");
      socket.on("connect", () => {
        this.socket = socket;
        finish();
      });
      socket.on("data", (chunk) => this.handleData(chunk));
      socket.on("error", (error) => {
        if (!settled) finish(makeError("PIPE_UNAVAILABLE", error.message));
        this.handleDisconnect(error);
      });
      socket.on("close", () => {
        if (!settled) finish(makeError("PIPE_UNAVAILABLE", "WindowTabs 命名管道已关闭"));
        this.handleDisconnect();
      });
    }).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  handleData(chunk) {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer, "utf8") > MAX_FRAME_BYTES) {
      this.handleDisconnect(makeError("FRAME_TOO_LARGE", "WindowTabs IPC 响应超过大小限制"));
      return;
    }
    let newline;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch (_) { continue; }
      if (message.type === "event") {
        for (const listener of this.listeners) {
          try { listener({ event: message.event, payload: message.payload }); } catch (_) {}
        }
        continue;
      }
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.ok === false || message.error) {
        const error = makeError(
          message.error?.code || "CORE_ERROR",
          message.error?.message || "WindowTabs 核心返回错误",
          message.error?.details
        );
        pending.reject(error);
      } else {
        pending.resolve(message.result);
      }
    }
  }

  handleDisconnect(reason) {
    if (this.socket && !this.socket.destroyed) this.socket.destroy();
    this.socket = null;
    this.buffer = "";
    const disconnectError = reason?.code
      ? reason
      : makeError("PIPE_UNAVAILABLE", reason?.message || "WindowTabs 命名管道已断开");
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(disconnectError);
      this.pending.delete(id);
    }
  }

  async request(method, params = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    await this.connect(timeoutMs);
    const id = `req-${Date.now()}-${this.nextId++}`;
    const message = JSON.stringify({ id, version: PROTOCOL_VERSION, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(makeError("REQUEST_TIMEOUT", `WindowTabs 请求超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.write(message); } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(makeError("PIPE_UNAVAILABLE", error.message));
      }
    });
  }

  close() {
    this.connecting = null;
    this.handleDisconnect();
  }
}

class HelperManager {
  constructor() {
    this.pipeName = getPipeName();
    this.pipe = new PipeClient(this.pipeName);
    this.child = null;
    this.helperManifest = null;
    this.startPromise = null;
    this.stopPromise = null;
    this.restartPromise = null;
    this.logLines = [];
    this.state = "INSTALLED_STOPPED";
    this.lastStatus = {
      state: this.state,
      message: "WindowTabs 尚未运行",
      protocol: PROTOCOL_VERSION,
      groupCount: 0
    };
    this.capabilities = [];
    this.listeners = new Set();
    this.pipe.onEvent((event) => this.emit(event.event, event.payload));
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event, payload) {
    if (event === "stateChanged" && payload) {
      if (payload.state) this.state = payload.state;
      this.lastStatus = payload;
    }
    for (const listener of this.listeners) {
      try { listener({ event, payload }); } catch (_) {}
    }
  }

  appendLog(value) {
    const lines = String(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return;
    this.logLines.push(...lines);
    if (this.logLines.length > 100) this.logLines.splice(0, this.logLines.length - 100);
    this.emit("log", lines.join("\n"));
  }

  setState(state, patch = {}) {
    this.state = state;
    this.lastStatus = {
      ...this.lastStatus,
      ...patch,
      state,
      protocol: PROTOCOL_VERSION
    };
    this.emit("stateChanged", this.lastStatus);
  }

  isChildAlive() {
    if (!this.child || this.child.exitCode !== null || this.child.signalCode !== null) return false;
    if (this.child.killed) return false;
    return true;
  }

  resolveHelper() {
    this.helperManifest = null;
    const override = process.env.WINDOWTABS_HELPER_PATH;
    if (override && fileExists(override)) return override;
    if (process.platform !== "win32") return null;

    const helperRoots = [
      path.join(getPluginDataPath(), "helper")
    ];
    for (const helperRoot of helperRoots) {
      const current = readJson(path.join(helperRoot, "current.json"));
      if (current?.path) {
        const currentPath = path.isAbsolute(current.path)
          ? current.path
          : path.join(helperRoot, current.path);
        if (fileExists(currentPath)) {
          this.helperManifest = current;
          return currentPath;
        }
      }
      if (current?.version) {
        const versionPath = path.join(helperRoot, current.version, "WindowTabs.exe");
        if (fileExists(versionPath)) {
          this.helperManifest = current;
          return versionPath;
        }
      }
    }

    // A uTools plugin may be unpacked in a location that is not writable.
    // Materialize the bundled, versioned helper into the plugin data directory
    // before launching it, while retaining a bundled-path fallback for dev mode.
    const bundledRoot = path.join(PLUGIN_ROOT, "helper");
    const bundledManifestPath = path.join(bundledRoot, "current.json");
    const bundledManifest = readJson(bundledManifestPath);
    if (bundledManifest?.path) {
      const bundledPath = path.isAbsolute(bundledManifest.path)
        ? bundledManifest.path
        : path.join(bundledRoot, bundledManifest.path);
      if (fileExists(bundledPath)) {
        this.helperManifest = bundledManifest;
        const versionDir = path.basename(path.dirname(bundledPath));
        const localRoot = path.join(getPluginDataPath(), "helper");
        const localVersionDir = path.join(localRoot, versionDir);
        const localPath = path.join(localVersionDir, path.basename(bundledPath));
        try {
          if (!fileExists(localPath) || (bundledManifest.sha256 &&
              crypto.createHash("sha256").update(fs.readFileSync(localPath)).digest("hex").toLowerCase() !== String(bundledManifest.sha256).toLowerCase())) {
            copyTreeSync(path.dirname(bundledPath), localVersionDir);
          }
          writeJsonAtomic(path.join(localRoot, "current.json"), bundledManifest);
          return localPath;
        } catch (_) {
          // The bundled location is still a valid fallback in development.
          return bundledPath;
        }
      }
    }

    const bundled = path.join(PLUGIN_ROOT, "helper", "WindowTabs.exe");
    return fileExists(bundled) ? bundled : null;
  }

  verifyHelper(helperPath) {
    const expected = this.helperManifest?.sha256;
    if (!expected || expected === "pending-local-build") return;
    const actual = crypto.createHash("sha256").update(fs.readFileSync(helperPath)).digest("hex");
    if (actual.toLowerCase() !== String(expected).toLowerCase()) {
      throw makeError("HELPER_INTEGRITY", "WindowTabs helper 校验失败，请重新安装插件");
    }
  }

  isNativePlatform() {
    return process.platform === NATIVE_PLATFORM || Boolean(process.env.WINDOWTABS_HELPER_PATH);
  }

  async getStatus() {
    if (!this.isNativePlatform()) {
      this.setState("UNSUPPORTED_PLATFORM", {
        message: "WindowTabs 原生核心仅支持 Windows",
        error: null
      });
      return this.lastStatus;
    }
    if (this.state === "LEGACY_RUNNING" && this.isChildAlive()) {
      return this.lastStatus;
    }
    try {
      const hello = await this.pipe.request("hello");
      if (Number(hello?.protocolVersion) !== PROTOCOL_VERSION) {
        throw makeError("PROTOCOL_MISMATCH", "WindowTabs IPC 协议版本不兼容", hello);
      }
      this.capabilities = Array.isArray(hello.capabilities) ? hello.capabilities : [];
      const result = await this.pipe.request("status");
      this.setState("READY", { ...result, capabilities: this.capabilities, message: "WindowTabs 正在运行" });
      return this.lastStatus;
    } catch (error) {
      if (error.code === "PIPE_UNAVAILABLE") {
        if (this.isChildAlive()) {
          this.setState("LEGACY_RUNNING", {
            message: "WindowTabs 已启动（兼容模式，状态控制由系统托盘提供）",
            pid: this.child.pid,
            coreVersion: this.helperManifest?.version || "legacy",
            error: null
          });
        } else if (this.resolveHelper()) this.setState("INSTALLED_STOPPED", { message: "WindowTabs 尚未运行", error: null });
        else this.setState("NOT_INSTALLED", { message: "未找到 WindowTabs helper", error });
      } else {
        this.setState("DEGRADED", { message: "WindowTabs 连接异常", error });
      }
      return this.lastStatus;
    }
  }

  async waitForReady(timeoutMs = START_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
      try {
        const hello = await this.pipe.request("hello", {}, 800);
        if (Number(hello?.protocolVersion) !== PROTOCOL_VERSION) {
          throw makeError("PROTOCOL_MISMATCH", "WindowTabs IPC 协议版本不兼容", hello);
        }
        this.capabilities = Array.isArray(hello.capabilities) ? hello.capabilities : [];
        const result = await this.pipe.request("status", {}, 800);
        this.setState("READY", { ...result, capabilities: this.capabilities, message: "WindowTabs 正在运行", error: null });
        return this.lastStatus;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 180));
      }
    }
    throw lastError || makeError("CORE_NOT_READY", "WindowTabs 未在规定时间内完成启动");
  }

  async start() {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async startInternal() {
    if (!this.isNativePlatform()) {
      throw makeError("UNSUPPORTED_PLATFORM", "WindowTabs 原生核心仅支持 Windows");
    }
    const current = await this.getStatus();
    if (current.state === "READY" || current.state === "LEGACY_RUNNING") return current;
    const helperPath = this.resolveHelper();
    if (!helperPath) throw makeError("NOT_INSTALLED", "未找到 WindowTabs.exe，请将原生核心放入 helper 目录");
    this.verifyHelper(helperPath);

    this.setState("STARTING", { message: "正在启动 WindowTabs", error: null });
    try {
      const helperArgs = [`--windowtabs-ipc-pipe=${this.pipeName}`];
      const command = helperPath.toLowerCase().endsWith(".js") ? process.execPath : helperPath;
      const commandArgs = helperPath.toLowerCase().endsWith(".js")
        ? [helperPath, ...helperArgs]
        : helperArgs;
      this.child = spawn(command, commandArgs, {
        cwd: path.dirname(helperPath),
        detached: true,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      this.child.stdout?.on("data", (chunk) => this.appendLog(chunk));
      this.child.stderr?.on("data", (chunk) => this.appendLog(chunk));
      this.child.on("error", (error) => {
        this.setState("DEGRADED", { message: "WindowTabs 启动失败", error: makeError("CORE_START_FAILED", error.message) });
      });
      this.child.on("exit", (code, signal) => {
        this.child = null;
        if (this.state !== "STOPPING") {
          this.setState("DEGRADED", { message: `WindowTabs 已退出（code=${code ?? "-"}, signal=${signal ?? "-"}）`, error: makeError("CORE_CRASHED", "WindowTabs 核心已退出") });
          this.emit("error", this.lastStatus.error);
        }
      });
      this.child.unref();
      try {
        return await this.waitForReady();
      } catch (error) {
        // Older WindowTabs builds do not know the IPC argument. Keep them
        // usable from uTools and expose a clear degraded/legacy state instead
        // of treating a successfully running tray process as a failed start.
        if (this.isChildAlive()) {
          await new Promise((resolve) => setTimeout(resolve, LEGACY_GRACE_MS));
          if (this.isChildAlive() && !this.pipe.isConnected()) {
            this.setState("LEGACY_RUNNING", {
              message: "WindowTabs 已启动（兼容模式，状态控制由系统托盘提供）",
              pid: this.child.pid,
              coreVersion: this.helperManifest?.version || "legacy",
              error: {
                code: "IPC_UNAVAILABLE",
                message: "当前 WindowTabs 版本未启用 uTools IPC；可通过系统托盘使用完整功能"
              }
            });
            return this.lastStatus;
          }
        }
        throw error;
      }
    } catch (error) {
      this.setState("DEGRADED", { message: "WindowTabs 启动超时", error });
      throw error;
    }
  }

  waitForChildExit(child, timeoutMs = STOP_TIMEOUT_MS) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeListener("exit", onExit);
        resolve(value);
      };
      const onExit = () => finish(true);
      const timer = setTimeout(() => finish(false), timeoutMs);
      child.once("exit", onExit);
    });
  }

  async stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.stopInternal();
    try {
      return await this.stopPromise;
    } finally {
      this.stopPromise = null;
    }
  }

  async stopInternal() {
    const current = await this.getStatus();
    if (current.state === "LEGACY_RUNNING") {
      this.setState("STOPPING", { message: "正在停止 WindowTabs", error: null });
      const child = this.child;
      try {
        if (child && this.isChildAlive()) {
          child.kill();
          if (!(await this.waitForChildExit(child))) {
            throw makeError("CORE_STOP_TIMEOUT", "WindowTabs 进程未在规定时间内退出");
          }
        }
        this.pipe.close();
        this.child = null;
        this.setState("INSTALLED_STOPPED", { message: "WindowTabs 已停止", pid: null, groupCount: 0, error: null });
        return this.lastStatus;
      } catch (error) {
        this.setState("DEGRADED", { message: "WindowTabs 停止失败", error });
        throw error;
      }
    }
    if (current.state !== "READY") {
      this.setState("INSTALLED_STOPPED", { message: "WindowTabs 尚未运行", error: null });
      return this.lastStatus;
    }
    this.setState("STOPPING", { message: "正在停止 WindowTabs", error: null });
    try {
      const child = this.child;
      await this.pipe.request("shutdown", {}, STOP_TIMEOUT_MS);
      this.pipe.close();
      if (child && !(await this.waitForChildExit(child))) {
        throw makeError("CORE_STOP_TIMEOUT", "WindowTabs 进程未在规定时间内退出");
      }
      this.child = null;
      this.setState("INSTALLED_STOPPED", { message: "WindowTabs 已停止", pid: null, groupCount: 0, error: null });
      return this.lastStatus;
    } catch (error) {
      this.setState("DEGRADED", { message: "WindowTabs 停止失败", error });
      throw error;
    }
  }

  async restart() {
    if (this.restartPromise) return this.restartPromise;
    this.restartPromise = this.restartInternal();
    try {
      return await this.restartPromise;
    } finally {
      this.restartPromise = null;
    }
  }

  async restartInternal() {
    await this.stop().catch(() => {});
    return await this.start();
  }

  async openSettings() {
    const current = await this.getStatus();
    if (current.state !== "READY") await this.start();
    if (this.state === "LEGACY_RUNNING") {
      throw makeError(
        "IPC_UNAVAILABLE",
        "当前 WindowTabs 版本未启用 IPC，请通过系统托盘菜单打开设置"
      );
    }
    await this.pipe.request("openSettings");
    return this.lastStatus;
  }

  async requireIpc() {
    const current = await this.getStatus();
    if (current.state !== "READY") await this.start();
    if (this.state === "LEGACY_RUNNING") {
      throw makeError("IPC_UNAVAILABLE", "当前 WindowTabs 版本未启用 uTools IPC");
    }
  }

  async getConfig() {
    await this.requireIpc();
    return await this.pipe.request("getConfig");
  }

  async updateConfig(patch) {
    await this.requireIpc();
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw makeError("INVALID_CONFIG", "配置更新必须是对象");
    }
    return await this.pipe.request("updateConfig", { patch });
  }

  async getDiagnostics() {
    const helperPath = this.resolveHelper();
    return {
      state: this.state,
      pipeName: this.pipeName,
      helperPath,
      helperExists: Boolean(helperPath),
      childPid: this.child?.pid || null,
      childAlive: this.isChildAlive(),
      recentLogs: this.logLines.slice(-30),
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      uToolsVersion: global.utools && typeof global.utools.getAppVersion === "function"
        ? global.utools.getAppVersion()
        : null,
      lastStatus: this.lastStatus
    };
  }

  dispose() {
    this.pipe.close();
  }
}

const manager = new HelperManager();

function expose() {
  window.windowTabs = {
    getStatus: () => manager.getStatus(),
    start: () => manager.start(),
    stop: () => manager.stop(),
    restart: () => manager.restart(),
    openSettings: () => manager.openSettings(),
    getConfig: () => manager.getConfig(),
    updateConfig: (patch) => manager.updateConfig(patch),
    getDiagnostics: () => manager.getDiagnostics(),
    onEvent: (listener) => manager.onEvent(listener)
  };
}

expose();

if (global.utools && typeof utools.onPluginEnter === "function") {
  utools.onPluginEnter(async ({ code }) => {
    try {
      if (code === "windowtabs") await manager.start();
      if (code === "windowtabs-settings") await manager.openSettings();
    } catch (error) {
      manager.emit("error", error);
    }
  });
}

if (global.utools && typeof utools.onPluginOut === "function") {
  utools.onPluginOut((isKill) => {
    if (isKill) manager.dispose();
  });
}

