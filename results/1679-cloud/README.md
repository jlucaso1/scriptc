# Cloud validation snapshot before fork CI

Implementation started from fork PR 6 at `78fe11a77aaf71260ecbf2274062899405c96b3d`, in an isolated worktree. Local implementation commit `df1118de7` corresponds to remote commit `5fc8e87c70a4ccced60d23e0b9b7f750d83728a1`. Local official-suite commit `9aa898490` corresponds to remote commit `4a1e45fab050d96f07f321c738bbc4f673f924ba`; their shared tree is `bfc4cf930261f66a1583018d07d9473a54ee676c`. The continuation preserves the original ten commits and does not touch the PR 1741 branch. The upstream WASM history was inspected at main `47636f2fa5ec2c58b5088473b38ef902b8f73338`; no competing SIMD translation implementation was found in the issue/PR search.

This is a validation snapshot, not a full gate or whole-package compatibility claim. The coverage matrix is in `coverage.md`; current support boundaries are in `internal/compatibility/wasm-simd.md`.

## Completed implementation checks

- 1,521 focused WASM tests pass, including 669 official binary negative modules, 4,000 SIMD instruction mutations and 2,000 additional vector-boundary mutations against V8.
- Every executable action in the 58 official SIMD 2.0 files is retained: 24,335 actions, without sampling or excluded NaN actions. All pass in Node 24.22.0 and native Linux x64, in release/dev modes, both plain and ASan/RC-audit lanes.
- The selected plain run passes 121 tests. The broader sanitized WebAssembly run passes 153 tests, including scalar WebAssembly regression corpus. Their thousands of out-of-filter cases are skipped, not passed.
- Final adversarial ABI cases also pass separately in both lanes and both LLVM modes. They check scalar argument non-coercion, result-only vector function non-execution, high global bits, mixed slots, table references, import/re-export chains, immutable globals and exact JS errors.
- LLVM 22.1.8 emits rooted objects for 753 distinct modules, for five triples under both bounds policies. ARM, macOS and Windows objects were not executed. The existing wasm32-wasi consumer restriction remains.
- The Linux x64 glibc runtime pack was rebuilt through the official script with Zig 0.16.0: seven flavors and four vendor archives. Building those flavors is not an execution claim for each flavor or another platform.
- Workspace build, lint, formatting, manifest generation, local Node compatibility drift check and baseline completeness pass. All 59 new fixture baselines have zero diagnostics; the four affected parity batches pass.
- The docs gate passes, including all 25 HTTP route tests.
- Regenerating all official corpus files produces identical SHA-256 manifests.

The stricter official trap-message output revision compares each RuntimeError message byte for byte through the differential harness. The plain repetition passes 116 tests; the sanitized repetition, full canonical zero-cost gate and published-head CI are tracked separately as they complete. No pending, interrupted or skipped result counts as pass here. The initial full baseline re-record was interrupted before the focused recording and four parity batches were completed; it is not claimed as a full parity sweep.

## Bridge consumer

The exact `@oxidezap/whatsapp-rust-bridge@0.26.0` artifact is 6,316,375 bytes with SHA-256 `7f563e4853e056a3063d3d82d7e3ee94004efa6ad267185040eca32fef1897b4`. The reduced driver exercises its SHA-256 export at sizes 0, 3, 64, 1024 and 65536, with synthetic bytes only. Node, plain native and sanitized native outputs are byte-identical, SHA-256 `3495219d481d9579b9928bd831fe59973386df514c9ec848cd155afa333b1f15`. Each digest is also checked against Node's independent crypto implementation. Unexpected host calls throw; no authenticated session or real user data is used.

The actual package's host-loaded glue also executes a synthetic SHA-256 case under Node. With its normal dependencies installed, scriptc coverage stops before WASM translation at independent gates: missing `ReadableByteStreamController`/`WritableStream` types and SC2013 for shipped minified JavaScript. Those gates remain enabled. FinalizationRegistry support and other PRs were not reopened. The reduced driver does not prove full bridge/glue or baileyrs compatibility.

## Toolchain and publication

The container has a 16 GiB memory limit and a four-CPU quota; host memory reporting shows 17 GiB. Native checks use Node 24.22.0, LLVM 22.1.8 and Zig 0.16.0. The LLVM helper was rebuilt at package version 0.4.1; the pre-existing 0.4.0 helper correctly refused with SC3003 before that rebuild. Initial native ABI validation also found a valueOf error-message difference, which was fixed and revalidated. Neither initial failure is counted as pass.

Official fixtures use WebAssembly/spec `wg-2.0`, commit `fffc6e12fa454e475455a7b58d3b5dc343980c10`. The WABT 1.0.37 Linux release archive has SHA-256 `cfc675dc9b663d9adc8c75d982c1ba29f661448a2e026a67e71fe3f76a3e09f3`; its version banner is `1.0.36 (git~1.0.37)`, which the generators check explicitly.

No Vercel Sandbox credentials are available. GitHub CLI's token is invalid; the connected GitHub app confirms admin permission for the fork and can write Git objects. A 4 MB tree request was interrupted without a response; a subsequent authenticated read returned 404 and the branch remained unchanged. Sending smaller batches through the same connector produced the exact expected tree hashes. Publication uses an expected-head lease and preserves the draft PR; no merge, upstream publication, bot request or credential change is authorized here.

Raw outputs retained in this snapshot: [focused tests](evidence/focused.txt), [plain lane](evidence/plain.txt), [sanitized lane](evidence/sanitized.txt), [final ABI plain](evidence/abi-plain.txt), [final ABI sanitized](evidence/abi-sanitized.txt), [exact trap messages](evidence/trap-messages-plain.txt), [object emission](evidence/objects.txt), [docs gate](evidence/docs.txt), [runtime build](evidence/runtime.txt), and [parity batches](evidence/parity.txt).
