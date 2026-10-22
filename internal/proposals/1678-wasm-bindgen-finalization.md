# wasm-bindgen ownership and finalization

Proposal for [#1678](https://github.com/vercel-labs/scriptc/issues/1678). This does not implement native `FinalizationRegistry` or resolve the issue. Preserve the existing SC2020 diagnostic and JavaScript runtime fence until the ownership boundary below is implemented and tested.

## Reproduction and current scope

At upstream main `eca0cab8a23c41b6d86e157cd97aad659cdc5d8e`, the issue's TypeScript reproduction still reports SC2020 for the registry type, constructor, and `register`. The constructor hint recommends explicit release. Reading the constructor as a value is also fenced. In JavaScript, the constructor is a runtime fence rather than supported native code. `packages/compiler/test/finalization-registry-boundaries.test.ts` pins these boundaries. These tests pass on the unmodified compiler; they demonstrate the unresolved refusal, not a before/after compatibility fix.

The exact published `@oxidezap/whatsapp-rust-bridge@0.26.0` tarball has npm SHA-1 `d3a52730ef50a266b0b1b2be94fa794dfb7274fa`. Its `dist/index.js` imports `bridge.js` before reading the WASM file and calling `initSync`. The generated bindings eagerly create five registries, including registrations for Rust objects and captured closure state. In particular:

- A wrapper registers itself as both target and unregister token, with its Rust pointer as the held value.
- `__destroy_into_raw()` clears the pointer and unregisters the wrapper. Explicit `free()` then calls the WASM destructor with the explicit-disposal flag `0`.
- The registry callback calls the destructor with the finalization flag `1`. The closure registry calls `__wbindgen_export5` with the held closure state.
- The generated fallback for environments without `FinalizationRegistry` has empty methods. Its existence does not establish that a long-running consumer releases every Rust allocation or closure explicitly.

Importing the actual published entry and hashing `abc` succeeds under the repository-pinned Node 24.22.0, returning `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`. This is evidence for initialization and one stateless operation under Node only. It does not demonstrate native execution, client lifecycle correctness, or application compatibility.

## Architectural constraint

The [ECMAScript FinalizationRegistry specification](https://tc39.es/ecma262/multipage/managing-memory.html#sec-finalization-registry-objects) defines registration, unregister, and cleanup jobs. Cleanup is optional and has no guaranteed deadline. The design below also requires resource ownership evidence specific to wasm-bindgen.

[The memory limitation](../../docs/content/limitations/weak-collections-and-memory.mdx) describes reference counting and collection points for cycles. `scr_rc_destroy` owns nested disposal; `scr_cyc_free_inline` calls the weak-observer hook while tearing down allocations. `scr_json.c` implements weak collection entries with borrowed key identities and strongly held values. Those hooks remove internal entries; they are not a context for invoking arbitrary user code.

[ProgramLifetime](../../docs/content/docs/contracts.mdx#programlifetime) deliberately permits instances that are never reclaimed. `contracts/check.ts` explicitly relies on static code having no `WeakRef` or `FinalizationRegistry`. Native finalization would need to revisit this policy, lifetime regions, optimized temporary lifetimes, published graphs, and worker teardown. The absence of a required GC deadline in JavaScript does not by itself prove that any particular native lifetime or callback policy preserves the language contract.

Reference counting could support a separately designed finalization facility. The current hooks alone do not provide the ECMAScript registry contract. A native implementation would need all of the following before removing the fence:

- Strong retention and tracing of the cleanup callback and each held value while their registry is reachable. A held value can indirectly refer to its target, preventing collection; treating that edge as weak would be incorrect.
- Weak target and unregister-token identities, including target-as-token without retaining the target. Tokens can name multiple registrations, and unregistering one token must remove every matching cell and return the correct boolean. Address reuse must not match stale registrations. Supported weakly holdable symbols also need an explicit scope.
- Validation of callable cleanup callbacks, weakly holdable targets and tokens, and target/held-value identity. Failing construction or registration must not create live entries.
- Dead-cell detection for ordinary releases and cycles. Registry disposal must remove registrations and release held state without running their cleanup callbacks.
- A cleanup-job queue that takes ownership of held values before deallocation, then runs user callbacks after collector and destructor invariants are restored. It must handle throws, recursive collection, callback registration/unregistration, async context, and worker ownership. An inline call from the weak-dispose hook is unsafe.
- A policy for immortal and region-owned instances and for cycles involving callbacks, held values, and the registry. Tests must verify retention and reclamation without assuming an exact collection time.

An empty registry, retaining every target, running every callback at process exit, or invoking callbacks during reference-count teardown does not satisfy this design. Allowing the constructor alone would only move the failure and could conceal leaked Rust state or duplicate disposal.

## Proposed ownership boundary

Keep the wasm-bindgen module, its WASM instance, wrappers, registry tokens, and closures entirely inside a Node island. Node/V8 then owns registry reachability and cleanup jobs in one execution context. Native code calls a small adapter that accepts and returns copied JSON data. Stateful operations must explicitly dispose their Rust resources inside the adapter, including exceptional paths; finalization remains a fallback with no deadline. No wrapper, closure, callback, registry, or raw pointer crosses the boundary.

This builds on existing work rather than adding a second JavaScript runtime path:

- [#1685](https://github.com/vercel-labs/scriptc/pull/1685) loads libnode and enters calls through a Node callback scope. It remains open as of this investigation.
- [#1686](https://github.com/vercel-labs/scriptc/pull/1686) adds `@scriptc/node` calls with a JSON-copy boundary. It was merged into `ni/1-libnode-loader`, not main. Its API is not available in the base checkout for this proposal.
- [#1684](https://github.com/vercel-labs/scriptc/pull/1684) supplies pinned libnode packs, and [#1696](https://github.com/vercel-labs/scriptc/pull/1696) integrates Node's event loop. Both remain open.
- [#1691](https://github.com/vercel-labs/scriptc/pull/1691) detects would-be islands in report-only mode. It does not make an ordinary package import execute in Node.

The #1685 review identified that even a synchronous island call can leave referenced timers or I/O. The reviewed fix keeps Node's event loop running. An adapter must preserve that liveness contract; returning JSON does not imply that island work has finished. Finalizer registrations themselves must not be treated as referenced work that keeps the process alive indefinitely.

A narrow SHA256 adapter can accept an array of input bytes, validate each integer is in `[0, 255]`, construct its `Uint8Array` inside Node, and return an array of digest bytes. A `Uint8Array` must not be declared directly as a JSON boundary type. This could establish a first supported operation after the island stack lands. A full WhatsApp client needs persistent identity and callbacks; that is outside the JSON-only API and this proposal.

Do not silently rewrite the import, hide SC2020, or claim that configuration flags already enable an executable island. If explicit native ownership is desired instead, require an opt-in binding API with a complete disposal proof for every owned wrapper and closure. A successful hash call is insufficient evidence for that proof.

## Acceptance work

1. Land the existing island loader/API and validate against the pinned libnode pack. Keep this issue open until the reduced consumer passes as a compiled executable.
2. Add a reduced wasm-bindgen module that constructs a registry before creating a minimal WASM instance. Verify initialization through the explicit island adapter. Cover module initialization failure and repeated calls, and ensure no native registry lowering is introduced.
3. Test constructor and registration validation, shared unregister tokens, unknown and repeated unregister, target-as-token, explicit disposal, and disposal after an exception. Check resource counters for explicit release and no second release after unregister. Use Node as the oracle.
4. Exercise actual collector-driven cleanup separately in an isolated Node process with resource counters. Report observations and limits; never require finalization before a fixed timeout or at process exit. Check callbacks run outside a collector/destructor stack, preserve held state, and cannot resurrect a freed native address.
5. Run the exact published consumer import and reduced SHA256 adapter under the compiled island path. Keep network connections and full client creation out of this smoke test. Add stateful lifecycle evidence before making any broader claim.
6. Run the plain and sanitized project lanes, relevant island ordering/liveness tests, cache-hit and pack-version checks, and the zero-cost gate for island-free code. Exercise leak and double-free detection on explicit resource lifecycles; sanitizers do not prove V8 finalizer timing or complete Rust ownership.

## Evidence and limits

The investigation used an isolated branch/worktree and inspected the issue, current main, duplicate PR search, the PRs above, their available reviews, the native weak-disposal hooks, and the ProgramLifetime contract. No native runtime or diagnostic behavior was changed. The added refusal tests and the existing compiler weak-collection ownership-policy test pass, 4/4, in both plain and `SCRIPTC_SAN=1` configurations on Node 24.22.0. These frontend-only tests run without a native build and do not exercise ASan or native resource cleanup. Lint, formatting, and whitespace checks pass. No full native or sanitizer suite result is claimed for an unimplemented feature. The reduced Node 24.22.0 lifecycle experiment covers shared-token unregister, invalid operands, minimal WASM initialization, and explicit disposal without forcing GC. Experimental scripts and the downloaded package stay outside the PR.
