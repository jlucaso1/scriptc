# wasm-bindgen through a Node island

This example depends on the pending Node-island stack, including upstream [#1685](https://github.com/vercel-labs/scriptc/pull/1685) and [#1696](https://github.com/vercel-labs/scriptc/pull/1696). It does not work on main before that stack lands and does not add native `FinalizationRegistry` support. The internal review base records the tested stack commit.

`main.ts` compiles to native code. It calls `adapter.mjs` through `@scriptc/node`; the adapter, the published binding, its finalization registries, and its WASM instance execute inside the same in-process Node environment. The ESM adapter respects the consumer's import-only package export. A CommonJS `require("@oxidezap/whatsapp-rust-bridge")` does not resolve that public export.

Only copied arrays of byte numbers cross this example's boundary. The adapter validates input bytes and returns a copied digest array. WASM pointers, class instances, closure state, unregister tokens, and callbacks stay inside Node. Typed arrays and native callbacks are not supported boundary values. The executable still needs the adapter, its npm dependency, and a compatible libnode pack at runtime; bundling libnode does not bundle these JavaScript files.

From the repository root, install the exact published consumer without install scripts:

```sh
npm install --ignore-scripts --package-lock=false --prefix examples/wasm-bindgen-node
```

With the Node-island stack's libnode pack selected by `SCRIPTC_LIBNODE` and the repository's Node/toolchain requirements installed, run the focused integration test and the consumer check:

```sh
SCRIPTC_TEST_WORKERS=1 SCRIPTC_SAN=1 SCRIPTC_WASM_BINDGEN_CONSUMER=1 pnpm exec vitest run tests/harness/wasm-bindgen-node-island.test.ts
```

The same installed example can be compiled and run directly with a compatible native runtime pack and `SCRIPTC_LIBNODE` selected:

```sh
pnpm scriptc build examples/wasm-bindgen-node/main.ts --libnode=beside -o node_modules/.cache/scriptc-tests/wasm-bindgen-example
node_modules/.cache/scriptc-tests/wasm-bindgen-example
```

The consumer check is explicitly opt-in because it needs that separate npm installation. Requesting it without installing the package fails the test. Both the ownership fixture and the optional consumer check cover release and dev builds. The ownership fixture runs in the libnode-enabled project CI lanes without downloading the consumer.

The ownership fixture constructs real registries before a small WASM module initializes. Its test-only WASM allocator counts explicit allocations/releases and traps on invalid releases. Reduced class and mutable-closure wrappers follow wasm-bindgen's register, token, owning-reference, and unregister pattern. Synchronous operations, concurrent async operations, and thrown errors dispose their owned state in `finally` blocks. The test checks active WASM counters, error copying, initialization failure/retry, and the JSON callback boundary. Its timeout detects a hung event loop, not delayed finalization.

The published consumer test establishes import, SHA256 of `abc`, and invalid-byte error propagation through a compiled caller. It does not establish full client ownership or Baileyrs compatibility. The published package's allocation profiler is disabled; its zero counters are not leak evidence. The reduced ownership fixture is not a Rust allocator test. No test requires a finalizer to run before a deadline or at process exit.

The fixture binary can be regenerated from its adjacent WAT source with `wasm-tools parse tests/fixtures/node-island-wasm-bindgen/resources.wat -o tests/fixtures/node-island-wasm-bindgen/resources.wasm`. The checked-in binary keeps that development tool out of the test runtime requirements.
