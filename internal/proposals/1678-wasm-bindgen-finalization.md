# wasm-bindgen ownership and finalization

Partial compatibility work for [#1678](https://github.com/vercel-labs/scriptc/issues/1678), stacked on the existing Node-island infrastructure. The byte-array adapter and executable integration test implement the narrow Node-owned boundary described below. They do not implement native `FinalizationRegistry` or resolve full client compatibility; preserve the native SC2020 diagnostic and JavaScript runtime fence.

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
- [#1686](https://github.com/vercel-labs/scriptc/pull/1686) adds `@scriptc/node` calls with a JSON-copy boundary. It was merged into `ni/1-libnode-loader`, not main. Its API is not available on the main commit originally investigated; it is available in this internal PR's explicit stacked review base.
- [#1684](https://github.com/vercel-labs/scriptc/pull/1684) supplies pinned libnode packs, and [#1696](https://github.com/vercel-labs/scriptc/pull/1696) integrates Node's event loop. Both remain open.
- [#1691](https://github.com/vercel-labs/scriptc/pull/1691) detects would-be islands in report-only mode. It does not make an ordinary package import execute in Node.

The #1685 review identified that even a synchronous island call can leave referenced timers or I/O. The reviewed fix keeps Node's event loop running. An adapter must preserve that liveness contract; returning JSON does not imply that island work has finished. Finalizer registrations themselves must not be treated as referenced work that keeps the process alive indefinitely.

A narrow SHA256 adapter can accept an array of input bytes, validate each integer is in `[0, 255]`, construct its `Uint8Array` inside Node, and return an array of digest bytes. A `Uint8Array` must not be declared directly as a JSON boundary type. This could establish a first supported operation after the island stack lands. A full WhatsApp client needs persistent identity and callbacks; that is outside the JSON-only API and this proposal.

Do not silently rewrite the import, hide SC2020, or claim that configuration flags already enable an executable island. If explicit native ownership is desired instead, require an opt-in binding API with a complete disposal proof for every owned wrapper and closure. A successful hash call is insufficient evidence for that proof.

## Implemented partial path

`examples/wasm-bindgen-node` provides an ESM adapter for the exact published consumer. The adapter accepts byte arrays, validates every element, calls SHA256 in Node, and returns a copied digest array. It honors the package's import-only export rather than bypassing its public entry.

`tests/harness/wasm-bindgen-node-island.test.ts` compares a compiled native caller against Node. The reduced ownership fixture keeps real registries, class wrappers, mutable closures, tokens, and a counted WASM allocator entirely in Node. It checks explicit release after successful and throwing operations, concurrent async calls interleaved with sync calls, module-initialization failure/retry, shared tokens, invalid registration, and refusal of native callbacks, class handles, and typed arrays at the JSON boundary. The real-consumer check is opt-in and fails if its requested installation is missing. Neither test claims eventual finalization or Rust leak freedom.

The internal PR is based on a snapshot of upstream hosted-loop commit `eaefbdf44`, so its diff contains only this issue's adapter, tests, fixtures, and investigation. The upstream infrastructure remains a prerequisite rather than being copied into the patch.

## Remaining acceptance work

1. Land and validate the existing Node-island infrastructure. This internal PR depends on it; it does not duplicate that implementation or make it available on main.
2. Validate a real stateful consumer with destructor-level evidence or an enabled Rust memory profiler. The counted WASM fixture proves its own class/closure ownership pattern, not ownership of every Rust resource in the published client.
3. Exercise collector-driven cleanup separately without requiring a callback count, deadline, or shutdown callback. The explicit-disposal checks intentionally make no finalizer scheduling claim.
4. Complete the plain and sanitized project gates on the stacked revision. Review existing upstream-stack failures separately from changes introduced here. Preserve native callback and non-JSON handle refusals until their own boundary contract exists.
5. Treat native FinalizationRegistry as a separate language/collector proposal. Define cleanup-job roots, safe callback context, immortal/region-owned targets, token identities, and worker ownership before removing the fence.

## Evidence and limits

The investigation used isolated branches/worktrees and inspected the issue, main, duplicate PR search, the PRs above, their available reviews, native weak-disposal hooks, and ProgramLifetime. Native runtime and diagnostic behavior are unchanged. The initial main-based refusal and ownership-policy tests passed 4/4 in both configurations. The stacked focused run passed 12/12 tests in plain and sanitizer configurations, covering release and dev builds: three native registry refusals, the compiler ownership policy, four JSON boundary refusals, counted WASM ownership in both optimization modes, and the installed published consumer in both modes. The sanitizer run enabled ASan and the runtime reference-count audit. The plain run used the matching prebuilt runtime artifact from upstream CI run 39671135375; its native-package build passed although the overall upstream run failed other tests. The example also built and ran through the CLI with `--libnode=beside`. The host run preserved ASan's documented fiber warning; it did not disable leak detection or change host security settings. The sandbox could not perform LeakSanitizer's process inspection, so the native tests ran on the authorized host.

The compiler/oracle uses Node 24.22.0; the hosted-loop branch's checksum-pinned development pack is libnode 24.22.1. The small differential checks are not a same-version full parity claim. The consumer's allocation profiler is disabled, and its zero counters are not leak evidence. No native FinalizationRegistry implementation, full client lifecycle, or Baileyrs compatibility is claimed. Downloaded npm packages, native packs, and experimental artifacts stay outside the PR.
