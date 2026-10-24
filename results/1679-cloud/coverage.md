# SIMD AOT completion criteria

Starting point: fork PR 6 at 78fe11a77aaf71260ecbf2274062899405c96b3d. Historical validation in the PR is not validation of this checkout. The issue requests SIMD translation rather than diagnostic changes. No competing upstream SIMD translation PR was found in the current GitHub PR search. No .agents/skills directory exists in this checkout or in /workspace/.agents.

| Stage | Completion criterion | Starting implementation | Required evidence |
| --- | --- | --- | --- |
| Decode and validate | All SIMD128 instructions and value placements retain operand/control typing; invalid opcodes, lanes, shuffles, alignments and const expressions reject | 236 instructions, vector globals and public signatures refused | Negative tests and V8 mutations |
| IR and lowering | LLVM operations implement all required bit, integer, float, saturating and conversion semantics without poison or fast-math assumptions | Standard instruction lowering exists | Official suite, adversarial raw-bit and differential tests |
| Storage | v128 locals, stack, branches, globals and initialization preserve all 128 bits | Globals missing | Mutable/immutable/imported/exported globals, high-half checks |
| Calls and references | Direct, indirect and cross-instance calls carry mixed scalar/vector multivalue signatures | Private direct calls only | Re-export/import chains, tables, wrong-signature traps |
| JS interface | JS cannot materialize v128. Export calls and JS import invocations with vector signatures throw TypeError; exported vector globals can be linked to WASM while JS value access throws | Whole modules refused | Differential JS error and WASM-link tests, without exposing vectors to JS |
| Memory | Exact widths, alignment 1 accesses, last-valid and overflowing offsets, complete store checks before side effects | Implemented | Plain guarded and sanitized explicit-bounds execution |
| Native code and runtime | Versioned vector slot ABI; runtime flavors rebuilt; no new CPU requirement | 64-bit scalar slot/cell ABI | Actual Linux x64 AOT execution, cross-target object checks reported separately |
| Scalar regressions | No non-WASM changes; scalar behavior preserved | Historical checks only | Focused scalar/spec corpus, zero-cost gate and repository gates |
| Consumer | Exact pinned bridge artifact works through exercised exports; independent glue blockers stay identified | Reduced SHA-256 driver only | Fresh bridge differential execution; full glue assessment without accounts or user data |
| Relaxed SIMD | Scope follows current spec and issue; never silently include in a 236-opcode claim | Explicitly unsupported | Evaluate current Core 3.0 semantics separately before deciding implementation scope |

Execution evidence will distinguish pass, fail, skipped and resource interruption. Cross-emission is not target execution. Linux x64 is the native execution target available in this environment. WebAssembly-as-consumer on wasm32-wasi remains an existing project restriction, not a SIMD implementation claim.

Normative references: https://webassembly.github.io/spec/core/exec/numerics.html and https://webassembly.github.io/spec/js-api/index.html, consulted 2026-10-23. Relaxed SIMD has separate instructions in Core 3.0 and must be named explicitly in the final scope.
