# WebAssembly SIMD translation, first stage

This is partial implementation work for [#1679](https://github.com/vercel-labs/scriptc/issues/1679), not a claim of complete SIMD support. The denominator is the 236 instructions in the standardized [SIMD128 binary encoding](https://github.com/WebAssembly/simd/blob/main/proposals/simd/BinarySIMD.md). `wasm-simd-opcodes.json` lists every standardized opcode and whether this stage translates it. Relaxed SIMD is a separate proposal and remains unsupported.

## Coverage

| SIMD subopcode after `0xfd` | Instructions | Translation |
| --- | --- | --- |
| `0x00`–`0x0b` | Full loads/stores, extending loads, splat loads | Implemented |
| `0x0c`–`0x0e` | Constants, shuffle, swizzle | Implemented |
| `0x0f`–`0x22` | All six splats and all extract/replace lane variants | Implemented |
| `0x4d`–`0x53` | Not, and, andnot, or, xor, bitselect, any_true | Implemented |
| `0x54`–`0x5d` | Lane loads/stores, load32_zero, load64_zero | Implemented |
| Other standardized subopcodes | Comparisons, integer arithmetic, shifts, saturation, narrowing, widening, rounding, float arithmetic, conversions | Unsupported |
| `0x100`–`0x113` | Relaxed SIMD | Unsupported |

There are 52 implemented opcodes and 184 unimplemented standardized opcodes. `v128` locals, direct block results and selection work. All function types containing `v128`, including internal function types and indexed block signatures, and all `v128` globals remain unsupported because the runtime's thunks and global cells use 64-bit scalar slots. No vector reaches that ABI. This restriction is conservative; relaxing it for internal functions requires separating native signatures from JavaScript/import/table thunks.

`isTranslatableFeature("simd")` remains false because the proposal as a whole is unsupported. `analyzeWasm` admits a particular SIMD module only if its instructions and value uses fit the implemented subset. Encountering an unsupported SIMD opcode keeps the existing `unsupported: ["simd"]` refusal. This does not replace #1660's diagnostics with a support claim, and it does not enable the Rust WASM artifact mentioned in the issue.

## Architecture and semantics

`binary.ts` type-checks the implemented SIMD instructions on the normal operand/control stack. It checks memory indices, natural alignment limits, extract/replace lane bounds and all 16 shuffle indices. SIMD no longer disables typing merely because a local is `v128`. Remaining proposals keep their previous scan-only treatment; their report is not full validation of those proposals.

`module.ts` reads `v128` block result types and skips SIMD immediates in constant-expression, dead-code and call-graph scans. This prevents constant/shuffle bytes from being mistaken for calls or control opcodes.

`translate.ts` represents vector values as LLVM `<16 x i8>`, bitcasting only when another lane shape is needed. Existing local/block storage and scalar function return paths remain in use. A separate translator ABI check rejects vector signatures and globals even if a caller bypasses `analyzeWasm`. No runtime layout or runtime pack changes are needed for this subset.

Lane zero is the low-address lane on the project's supported little-endian targets. Narrow splats and replacements truncate; signed extracts sign-extend; unsigned extracts zero-extend. Extending loads use their specified signedness. Shuffle indices select from the concatenated pair of inputs. Swizzle masks the LLVM extraction index to avoid poison and explicitly produces zero for every original index at least 16. Bitselect chooses individual bits, not whole lanes.

SIMD memory accesses use the existing unsigned 32-bit address plus unsigned offset calculation in 64 bits. Access width is the actual width, including eight bytes for extending loads and the scalar width for lane/zero/splat loads. Unaligned accesses use LLVM alignment 1. Bounds-check builds check before the access; guard-page builds use the existing runtime trap handler for loads. SIMD stores check their entire range explicitly in both modes so LLVM legalization into smaller stores cannot leave partial writes before a trap. SIMD memory operations are volatile so a dropped or otherwise unused vector load still traps and LLVM cannot widen an access. This preserves observable memory effects at the expense of some optimization opportunities.

Float splats and lane movement preserve bit patterns, including negative zero and quiet NaN payloads. This stage performs no vector floating-point arithmetic, so it makes no NaN propagation, min/max, rounding, or conversion claim. Future float arithmetic must implement WebAssembly's NaN allowances and signed-zero rules rather than assuming LLVM fast-math semantics. Future shifts must mask counts modulo the lane width; integer saturation and narrowing must clamp with the correct signedness rather than wrap. All those instructions currently refuse.

LLVM legalizes the vector operations for the selected target under its existing target policy. No host CPU feature detection, `-march=native`, SSSE3/AVX requirement, or ARM-specific runtime dependency is added. Object emission is checked for x86_64 Linux, ARM64 Linux, macOS on both architectures and Windows x64, with both bounds policies. Object emission on ARM is not an executed ARM conformance result. The project's wasm32-wasi consumer restriction is unchanged.

## Evidence and next stages

`tests/wasm-spec/gen-simd-data.mjs` generates the minimal binary fixtures in `tests/wasm-spec/corpus/simd-data.json` and the differential corpus `tests/corpus/webassembly-simd-data/main.mjs`. It needs no assembler. The corpus compares scalar results, raw memory bytes, stdout, stderr and exit status against Node. It covers every implemented opcode, signed/unsigned lane extraction, dynamic narrow splats, mixed-source shuffle, out-of-range swizzle, NaN bits, memory alignment, last-valid accesses, out-of-bounds accesses, offset overflow, dropped loads, unused locals and dead-code immediates. Unit tests also cover invalid lanes/shuffles/alignment, unsupported arithmetic/vector ABI, and 4,000 seeded mutations against V8. These are focused cases, not the full official SIMD conformance suite.

The next stages are internal vector signatures and vector global storage with explicit JavaScript boundary errors; integer comparisons/arithmetic/shifts/saturation/conversions; float operations and conversions with their NaN and signed-zero rules; and the official SIMD execution suite plus a reduced real package consumer. The issue remains open until the standardized instruction set and required ABI behavior are covered. The bridge package is not claimed compatible by this stage.

## Local validation record

The issue's original 29-byte module was tested with the base WASM decoder/parser/translator from `eca0cab8a` and with this patch, using the same current runtime. The base executable prints `false`, then throws the named untranslated-SIMD `CompileError` and exits 1. The patched executable prints `true` and `ok`, then exits 0. Separately, 881 scalar spec modules produce byte-identical translator output and declarations on base and patch with both bounds policies. This is a focused scalar-output comparison, not the repository's full zero-cost gate.

On Linux x86_64 with Node 24.22.0, LLVM helper 22.1.8 and a runtime pack rebuilt with the laptop's Zig 0.17.0, the WASM unit/spec suites pass 127 tests, including 4,000 new mutations and the existing scalar mutation corpus. All 34 WebAssembly corpus cases pass across the differential suite and release/dev LLVM suite in both the plain and ASan/RC-audit lanes. The final store-check revision of the SIMD corpus passes again in both suites and both lanes. The compiler-to-IR self-hosting check completed without diagnostics before the final store-check refinement; native bootstrap remains untested. The preflight/order batch containing the new corpus and baseline completeness check pass. Lint, formatting and the documentation gate pass, including 25 route tests. LLVM 22.1.8 verifies and emits objects for all 63 generated modules on the five target triples above in both bounds modes; those cross-target objects were not executed.

The `@oxidezap/whatsapp-rust-bridge@0.26.0` WASM artifact is 6,316,375 bytes, SHA-256 `7f563e4853e056a3063d3d82d7e3ee94004efa6ad267185040eca32fef1897b4`. V8 accepts it. It uses 57 distinct standard SIMD opcodes, 29 of which remain outside this patch, plus one vector function type. `analyzeWasm` correctly keeps it `unsupported` with `simd`; examples include `i32x4.add`, `i32x4.shl`, `i32x4.dot_i16x8_s` and `i64x2.add`. This is a real-artifact coverage check, not a successful bridge execution or a compatibility claim.

The full Sandbox gate is blocked by an expired Vercel CLI session. No credentials were changed and no Sandbox was created. The runtime build did not use the repository-pinned Zig 0.16.0. The complete local fallback suites, the full zero-cost gate, the pinned runtime-toolchain gate and native self-hosting remain outstanding; focused tests do not replace them. The draft remains internal to the fork and does not close #1679.
