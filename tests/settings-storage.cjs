"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { prepareSettingsPath } = require("../settings-storage.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "windowtabs-storage-test-"));
try {
  const pluginData = path.join(root, "plugin");
  const appData = path.join(root, "appdata");
  const legacy = path.join(appData, "WindowTabs", "WindowTabsSettings.json");
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, "{\"legacy\":true}\n");
  const target = prepareSettingsPath(pluginData, appData);
  assert.equal(target, path.join(pluginData, "settings", "WindowTabsSettings.json"));
  assert.equal(fs.readFileSync(target, "utf8"), "{\"legacy\":true}\n");
  fs.writeFileSync(legacy, "{\"legacy\":false}\n");
  prepareSettingsPath(pluginData, appData);
  assert.equal(fs.readFileSync(target, "utf8"), "{\"legacy\":true}\n");
  console.log("settings storage tests passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
