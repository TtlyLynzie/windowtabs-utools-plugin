(function () {
  "use strict";

  const api = window.windowTabs;
  if (!api) {
    document.body.innerHTML = "<p style='padding:24px'>preload.js 未加载，无法连接 WindowTabs。</p>";
    return;
  }

  const elements = {
    badge: document.getElementById("statusBadge"),
    statusText: document.getElementById("statusText"),
    legacyHint: document.getElementById("legacyHint"),
    coreVersion: document.getElementById("coreVersion"),
    corePid: document.getElementById("corePid"),
    groupCount: document.getElementById("groupCount"),
    protocolVersion: document.getElementById("protocolVersion"),
    errorText: document.getElementById("errorText"),
    diagnostics: document.getElementById("diagnosticsOutput"),
    start: document.getElementById("startButton"),
    restart: document.getElementById("restartButton"),
    stop: document.getElementById("stopButton"),
    settings: document.getElementById("settingsButton"),
    refresh: document.getElementById("refreshButton"),
    copyDiagnostics: document.getElementById("copyDiagnosticsButton"),
    loadConfig: document.getElementById("loadConfigButton"),
    saveConfig: document.getElementById("saveConfigButton"),
    configStatus: document.getElementById("configStatus"),
    config: {
      enableTabbingByDefault: document.getElementById("enableTabbingByDefault"),
      hideInactiveTabs: document.getElementById("hideInactiveTabs"),
      enableTabPreview: document.getElementById("enableTabPreview"),
      groupTaskbarButtons: document.getElementById("groupTaskbarButtons"),
      tabPreviewDelay: document.getElementById("tabPreviewDelay"),
      tabPreviewSize: document.getElementById("tabPreviewSize")
    }
  };

  const labels = {
    READY: "运行中",
    STARTING: "启动中",
    STOPPING: "停止中",
    INSTALLED_STOPPED: "未运行",
    NOT_INSTALLED: "未安装",
    UNSUPPORTED_PLATFORM: "平台不支持",
    DEGRADED: "连接异常",
    UPDATING: "更新中",
    LEGACY_RUNNING: "兼容模式"
  };

  let busy = false;
  let currentState = "DEGRADED";

  function updateActionAvailability() {
    const disabled = busy;
    elements.start.disabled = disabled || ["READY", "STARTING", "LEGACY_RUNNING", "UNSUPPORTED_PLATFORM"].includes(currentState);
    elements.stop.disabled = disabled || !["READY", "LEGACY_RUNNING"].includes(currentState);
    elements.restart.disabled = disabled || ["STARTING", "STOPPING", "UNSUPPORTED_PLATFORM"].includes(currentState);
    elements.settings.disabled = disabled || currentState !== "READY";
    elements.refresh.disabled = disabled;
    elements.loadConfig.disabled = disabled || currentState !== "READY";
    elements.saveConfig.disabled = disabled || currentState !== "READY";
  }

  function setBusy(value) {
    busy = value;
    updateActionAvailability();
  }

  function showError(error) {
    if (!error) {
      elements.errorText.hidden = true;
      elements.errorText.textContent = "";
      return;
    }
    const code = error.code ? `[${error.code}] ` : "";
    elements.errorText.textContent = `${code}${error.message || String(error)}`;
    elements.errorText.hidden = false;
  }

  function renderStatus(status) {
    const state = status.state || "DEGRADED";
    currentState = state;
    const label = labels[state] || state;
    elements.badge.textContent = label;
    elements.badge.className = `status-badge status-${state.toLowerCase().replaceAll("_", "-")}`;
    elements.statusText.textContent = status.message || label;
    elements.legacyHint.hidden = state !== "LEGACY_RUNNING";
    elements.coreVersion.textContent = status.coreVersion || "—";
    elements.corePid.textContent = status.pid || "—";
    elements.groupCount.textContent = status.groupCount ?? "—";
    elements.protocolVersion.textContent = status.protocol ?? "—";
    if (status.error) showError(status.error); else showError(null);
    updateActionAvailability();
  }

  async function refresh(options = {}) {
    const silent = Boolean(options.silent);
    if (!silent) setBusy(true);
    try {
      const status = await api.getStatus();
      renderStatus(status);
      const diagnostics = await api.getDiagnostics();
      elements.diagnostics.textContent = JSON.stringify(diagnostics, null, 2);
      if (!silent && status.state === "READY") await loadConfig();
    } catch (error) {
      showError(error);
    } finally {
      if (!silent) setBusy(false);
    }
  }

  function setConfigStatus(text, isError = false) {
    elements.configStatus.textContent = text || "";
    elements.configStatus.classList.toggle("config-error", isError);
  }

  function renderConfig(config) {
    const readBool = (key, fallback = false) => Boolean(config?.[key] ?? fallback);
    elements.config.enableTabbingByDefault.checked = readBool("EnableTabbingByDefault");
    elements.config.hideInactiveTabs.checked = readBool("HideInactiveTabs");
    elements.config.enableTabPreview.checked = readBool("EnableTabPreview", true);
    elements.config.groupTaskbarButtons.checked = readBool("GroupTaskbarButtons");
    elements.config.tabPreviewDelay.value = Number(config?.TabPreviewDelay ?? 500);
    elements.config.tabPreviewSize.value = Number(config?.TabPreviewSize ?? 320);
  }

  async function loadConfig() {
    try {
      const config = await api.getConfig();
      renderConfig(config);
      setConfigStatus("设置已读取");
    } catch (error) {
      setConfigStatus(error.message || "读取设置失败", true);
      showError(error);
    }
  }

  async function saveConfig() {
    setBusy(true);
    setConfigStatus("正在应用…");
    try {
      const delay = Math.max(0, Math.min(10000, Number(elements.config.tabPreviewDelay.value) || 0));
      const size = Math.max(80, Math.min(1200, Number(elements.config.tabPreviewSize.value) || 320));
      const result = await api.updateConfig({
        EnableTabbingByDefault: elements.config.enableTabbingByDefault.checked,
        HideInactiveTabs: elements.config.hideInactiveTabs.checked,
        EnableTabPreview: elements.config.enableTabPreview.checked,
        GroupTaskbarButtons: elements.config.groupTaskbarButtons.checked,
        TabPreviewDelay: delay,
        TabPreviewSize: size
      });
      renderConfig(result);
      setConfigStatus("已应用");
      showError(null);
    } catch (error) {
      setConfigStatus(error.message || "应用设置失败", true);
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function run(action) {
    setBusy(true);
    showError(null);
    try {
      const status = await action();
      renderStatus(status);
      const diagnostics = await api.getDiagnostics();
      elements.diagnostics.textContent = JSON.stringify(diagnostics, null, 2);
    } catch (error) {
      showError(error);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  elements.start.addEventListener("click", () => run(() => api.start()));
  elements.restart.addEventListener("click", () => run(() => api.restart()));
  elements.stop.addEventListener("click", () => run(() => api.stop()));
  elements.settings.addEventListener("click", () => run(() => api.openSettings()));
  elements.refresh.addEventListener("click", refresh);
  elements.loadConfig.addEventListener("click", loadConfig);
  elements.saveConfig.addEventListener("click", saveConfig);
  elements.copyDiagnostics.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(elements.diagnostics.textContent);
      elements.copyDiagnostics.textContent = "已复制";
      setTimeout(() => { elements.copyDiagnostics.textContent = "复制诊断"; }, 1200);
    } catch (error) {
      showError(error);
    }
  });

  api.onEvent((event) => {
    if (event.event === "stateChanged" && event.payload) renderStatus(event.payload);
    if (event.event === "error") showError(event.payload);
  });

  const pollTimer = setInterval(() => {
    if (!busy) refresh({ silent: true });
  }, 5000);
  window.addEventListener("unload", () => clearInterval(pollTimer), { once: true });

  refresh();
})();
