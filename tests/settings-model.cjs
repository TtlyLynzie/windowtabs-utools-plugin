"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const M = require("../settings-model.js");
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "../settings-schema.json"), "utf8"));
const values = Object.fromEntries(schema.fields.map(field => [field.path, field.default]));
const snap = () => ({ contractVersion: 1, values: structuredClone(values), revision: "one", presets: [], customThemes: [] });

{
  const draft = new M.Draft(schema, snap());
  draft.set("EnableCtrlNumberHotKey", true);
  assert.equal(draft.values.EnableAltNumberHotKey, false);
  draft.set("EnableAltNumberHotKey", true);
  assert.equal(draft.values.EnableCtrlNumberHotKey, false);
}
{
  const draft = new M.Draft(schema, snap());
  draft.set("HotKeys.nextTab", 0x241);
  draft.set("HotKeys.prevTab", 0x241);
  assert.throws(() => draft.validate(), /相同快捷键/);
}
{
  const draft = new M.Draft(schema, snap());
  const inherited = schema.fields.find(field => field.inherit);
  draft.set(inherited.path, null);
  assert.equal(draft.changes().find(change => change.path === inherited.path)?.value, null);
  const saved = snap(); saved.revision = "two"; saved.values[inherited.path] = null;
  draft.reset(saved);
  assert.equal(draft.changes().length, 0);
}
{
  const draft = new M.Draft(schema, snap());
  const original = structuredClone(draft.values);
  draft.set("EnableDarkMode", !original.EnableDarkMode);
  assert.notDeepEqual(draft.values, original);
  assert.deepEqual(draft.base, original, "editing must not mutate before-values");
}
console.log("settings model tests passed");
