const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

// Like wasm-bindgen, registry construction precedes WASM initialization.
// All targets, tokens, closures and WASM pointers stay in this Node module.
let wasm;
let unregisters = 0;
const objects = new FinalizationRegistry(pointer => wasm.release(pointer, 1));
const closures = new FinalizationRegistry(state => wasm.release(state.a, 1));
wasm = new WebAssembly.Instance(new WebAssembly.Module(
  readFileSync(join(__dirname, "resources.wasm")),
)).exports;

class Owned {
  constructor() {
    this.pointer = wasm.allocate();
    objects.register(this, this.pointer, this);
  }
  free() {
    if (this.pointer === 0) throw new Error("already disposed");
    const pointer = this.pointer;
    this.pointer = 0;
    assert.equal(objects.unregister(this), true);
    assert.equal(objects.unregister(this), false);
    unregisters++;
    wasm.release(pointer, 0);
  }
}
Owned.prototype[Symbol.dispose] = Owned.prototype.free;

// Reduced from wasm-bindgen's mutable closure wrapper. Calling the wrapper
// temporarily borrows its Rust state; dropping its owning reference releases
// it and removes the finalizer. An invocation is not an owning drop.
function mutableClosure(invoke) {
  const state = { a: wasm.allocate(), b: 0, cnt: 1 };
  const callback = (...args) => {
    state.cnt++;
    const pointer = state.a;
    state.a = 0;
    try { return invoke(pointer, state.b, ...args); }
    finally { state.a = pointer; callback._wbg_cb_unref(); }
  };
  callback._wbg_cb_unref = () => {
    if (--state.cnt === 0) {
      wasm.release(state.a, 0);
      state.a = 0;
      assert.equal(closures.unregister(state), true);
      assert.equal(closures.unregister(state), false);
      unregisters++;
    }
  };
  closures.register(callback, state, state);
  return callback;
}

function failure() {
  const error = new RangeError("operation failed");
  error.code = "ERR_WASM_OPERATION";
  throw error;
}

exports.sync = () => {
  const resource = new Owned();
  const callback = mutableClosure(() => 42);
  try { assert.equal(callback(), 42); }
  finally { callback._wbg_cb_unref(); resource[Symbol.dispose](); }
  assert.throws(() => resource.free(), /already disposed/);
  return "sync disposed";
};

exports.async = async shouldThrow => {
  const resource = new Owned();
  const callback = mutableClosure(() => { if (shouldThrow) failure(); return 42; });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(callback(), 42);
    return "async disposed";
  } finally { callback._wbg_cb_unref(); resource.free(); }
};

exports.throwSync = () => {
  const resource = new Owned();
  const callback = mutableClosure(failure);
  try { callback(); }
  finally { callback._wbg_cb_unref(); resource.free(); }
};

exports.validation = () => {
  assert.throws(() => wasm.release(0, 0), WebAssembly.RuntimeError);
  const registry = new FinalizationRegistry(() => { throw new Error("unexpected cleanup"); });
  const token = {};
  const target = {};
  registry.register(target, 1, token);
  registry.register({}, 2, token);
  assert.equal(registry.unregister(token), true);
  assert.equal(registry.unregister(token), false);
  assert.equal(registry.unregister({}), false);
  assert.throws(() => registry.register(target, target), TypeError);
  assert.throws(() => registry.register(1, 1), TypeError);
  assert.throws(() => registry.register(target, 1, 1), TypeError);
  assert.throws(() => registry.unregister(1), TypeError);
  assert.throws(() => new FinalizationRegistry(1), TypeError);
  return "validated";
};

exports.snapshot = () => JSON.stringify({
  allocated: wasm.allocated.value,
  released: wasm.released.value,
  finalized: wasm.finalized.value,
  unregisters,
});
