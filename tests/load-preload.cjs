"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createRequire } = require("module");

// Execute the shipped preload itself; do not duplicate the transport in tests.
module.exports = function loadPreload(root = path.resolve(__dirname, "..")) {
  const filename = path.join(root, "preload.js");
  const sandbox = {
    require: createRequire(filename), __dirname: root, process, Buffer,
    setTimeout, clearTimeout, console, window: {}, global: {}, module: { exports: {} }
  };
  vm.runInNewContext(fs.readFileSync(filename, "utf8") +
    "\nmodule.exports = { PipeClient, HelperManager, validateIntegratedParams };", sandbox, { filename });
  return sandbox.module.exports;
};
