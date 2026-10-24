# WebAssembly SIMD128 AOT translation

The instruction denominator for [#1679](https://github.com/vercel-labs/scriptc/issues/1679) is the 236 standard SIMD128 instructions listed in `wasm-simd-opcodes.json`. Their decoding, stack typing and LLVM lowering were implemented in fork PR 6. The cloud continuation adds vector globals and function-reference/import/export paths. Historical measurements for the earlier implementation remain in PR 6 and git history; they are not validation of the continuation.

## Scope and completion criteria

| Area | Required behavior |
| --- | --- |
| Types and decoding | v128 parameters, results, locals, globals, indexed blocks and operand/control stacks; reject reserved opcodes, wrong operand types, invalid lanes/shuffles and excessive memory alignment |
| Native values | All 128 bits survive direct calls, indirect calls, multivalue returns, imported/re-exported functions and shared globals across instances |
| Globals | v128.const and global.get initializers; mutable and immutable cells; WASM imports and exports preserve identity and high bits |
| Memory | Actual access width, unsigned addresses/offsets, unaligned accesses, last-valid and out-of-bounds accesses, dropped loads and no partial writes on trapping stores |
| Integer operations | Wrapping, masked shifts, signed/unsigned comparisons, reductions, widening, narrowing, saturation and dot-product overflow |
| Floating-point operations | Raw bits for movement and operand selection; signed zero, quiet arithmetic NaNs, rounding ties and saturating conversions; no fast-math flags |
| JavaScript interface | v128 has no JavaScript representation. A vector function can be exported, referenced or imported by another WASM instance, but calling it from JS throws TypeError before argument conversion or execution. Calling a JS import with any vector parameter/result also throws before invoking the callback. Exported vector globals can be linked to WASM; their JS getters/setters and WebAssembly-typed valueOf throw |
| Native targets | Existing LLVM target policy, without a new ISA requirement. Actual target execution and cross-target object emission are reported separately |
| Runtime | Rebuild native packs after changing the versioned runtime contract; preserve existing sanitizer, trap and audit gates |

`binary.ts` now admits standard SIMD128 as a translatable feature, rather than refusing valid modules merely because they contain vector globals or externally referenced vector signatures. Relaxed SIMD is reported separately as `relaxed-simd` and remains unsupported. It is a separate family of 20 instructions in current Core 3.0, beyond the original SIMD128 proposal and the issue's original reproduction. This change does not claim full Core 3.0 SIMD coverage or add that extension by assumption. See the current [numeric semantics](https://webassembly.github.io/spec/core/exec/numerics.html) and [JS interface](https://webassembly.github.io/spec/js-api/index.html), consulted 2026-10-23.

## Architecture

LLVM values use `<16 x i8>`, with bitcasts for other lane shapes. Internal native signatures carry vectors directly. Runtime ABI version 3 keeps one i64 slot per scalar and uses two adjacent i64 slots per v128, including mixed parameters and multivalue results. Vector slot loads/stores specify alignment 8. Global cells reserve two adjacent 64-bit value halves before their ownership metadata. Globals use alignment 8 too. Scalar-only module descriptor versions change with this runtime contract; old packs must not be paired with the new compiler.

Referenced vector functions receive native call thunks even when they already have export thunks. Vector imports of WASM functions call those native thunks directly, preserving the active trap guard. Imports backed by JavaScript callables refuse at invocation. The JS export-call path checks the whole signature before converting any argument. No JS object or typed array is used as a nonstandard v128 representation. The existing generic Global API divergence remains: valueOf on an untyped receiver and generic primitive conversion do not consistently dispatch the Global method. That pre-existing scalar/global conversion limitation is documented on the limitations page; this does not claim to complete the whole WebAssembly JS API.

SIMD memory operations are volatile so unused loads still trap and LLVM does not widen accesses. Stores check the entire specified access range before writing, including in guarded-memory mode, because legalization can split a vector store. All access alignments are 1. Integer shifts mask their counts before lowering. Saturating arithmetic widens before clamping. Float arithmetic quiets NaNs within the permitted result class; movement and pseudo-min/max preserve the required operand bits.

## Reproducible evidence

`tests/wasm-spec/gen-simd-data.mjs` generates the existing 750 adversarial differential modules covering every standard opcode. `gen-simd-abi.mjs` assembles readable `simd-abi.wat` fixtures using WABT 1.0.37. Their corpus exercises mixed vector/scalar slots, shared mutable/immutable globals, indirect calls, table references, re-export/import chains and normative JS TypeErrors, including callback non-invocation.

`gen-simd-official.mjs` consumes the 58 SIMD files in WebAssembly/spec tag wg-2.0, commit `fffc6e12fa454e475455a7b58d3b5dc343980c10`, with WABT 1.0.37. It retains all 24,335 executable actions and 669 binary invalid/malformed modules. WAT text-parser rejections are outside the binary compiler's scope. Wrappers call the original functions through WASM imports and compare raw result bits or the exact permitted NaN class inside WASM; only scalar pass/fail results reach JS. Trap assertions require WebAssembly.RuntimeError, and the differential harness compares each trap message byte for byte with Node. No action sampling or NaN-case exclusion is used. The full official actions pass under Node 24.22.0. Native results are recorded separately in `results/1679-cloud/` as they complete.

The bridge generator checks the exact `@oxidezap/whatsapp-rust-bridge@0.26.0` WASM SHA-256, `7f563e4853e056a3063d3d82d7e3ee94004efa6ad267185040eca32fef1897b4`. The reduced driver implements three verified byte-array callbacks and throws on unexpected host calls. Its SHA-256 export is tested for sizes 0, 3, 64, 1024 and 65536 against V8 and an independent SHA-256 implementation. That evidence does not establish full package/glue or protocol compatibility. No authenticated WhatsApp session or real user data is involved.

The project's existing wasm32-wasi consumer restriction remains. Cross-emitted ARM, macOS and Windows objects do not establish native execution on those targets. New validation results must identify the exact head, toolchain, target and lane; OOM, interrupted and skipped work never counts as pass.
