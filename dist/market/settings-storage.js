"use strict";

const fs = require("fs");
const path = require("path");

function exists(filePath) {
  try { return fs.existsSync(filePath); } catch (_) { return false; }
}

function prepareSettingsPath(pluginDataPath, appDataPath) {
  const settingsPath = path.join(pluginDataPath, "settings", "WindowTabsSettings.json");
  if (exists(settingsPath) || exists(settingsPath.replace(/\.json$/, ".txt"))) return settingsPath;

  // Migrate once by copying. Never delete or overwrite a standalone user's file.
  const legacyRoot = path.join(appDataPath || pluginDataPath, "WindowTabs");
  for (const ext of ["json", "txt"]) {
    const source = path.join(legacyRoot, `WindowTabsSettings.${ext}`);
    if (!exists(source)) continue;
    const target = settingsPath.replace(/\.json$/, `.${ext}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    break;
  }
  return settingsPath;
}

module.exports = { prepareSettingsPath };
