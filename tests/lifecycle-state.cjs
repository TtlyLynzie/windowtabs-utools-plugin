"use strict";

const assert = require("assert");
const { LifecycleState } = require("../lifecycle-state.js");

const lifecycle = new LifecycleState("INSTALLED_STOPPED", { message: "idle", protocol: 1 });
assert.equal(lifecycle.state, "INSTALLED_STOPPED");
assert.deepEqual(lifecycle.transition("STARTING", { message: "starting" }), {
  state: "STARTING", message: "starting", protocol: 1
});
lifecycle.replace({ state: "READY", message: "ready", groupCount: 2 });
assert.equal(lifecycle.state, "READY");
assert.deepEqual(lifecycle.snapshot(), { state: "READY", message: "ready", groupCount: 2 });
const copy = lifecycle.snapshot();
copy.state = "BROKEN";
assert.equal(lifecycle.state, "READY");
console.log("lifecycle state tests passed");
