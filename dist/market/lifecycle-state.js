"use strict";

class LifecycleState {
  constructor(initialState, initialStatus = {}) {
    this.currentState = initialState;
    this.currentStatus = { ...initialStatus, state: initialState };
  }

  get state() {
    return this.currentState;
  }

  snapshot() {
    return { ...this.currentStatus };
  }

  transition(state, patch = {}) {
    this.currentState = state;
    this.currentStatus = { ...this.currentStatus, ...patch, state };
    return this.snapshot();
  }

  replace(status) {
    if (!status || typeof status !== "object") return this.snapshot();
    if (status.state) this.currentState = status.state;
    this.currentStatus = { ...status, state: this.currentState };
    return this.snapshot();
  }
}

module.exports = { LifecycleState };
