import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import type { IrModule, IrWasmModule } from "../../ir/ir.js";
import { emitWasmModules } from "./wasm-modules.js";

function module(bytes: string, rejectionReason?: string): IrWasmModule {
  return {
    sha256: createHash("sha256").update(Buffer.from(bytes, "base64")).digest("hex"),
    bytes,
    ...(rejectionReason === undefined ? {} : { rejectionReason }),
  };
}

function emit(wasmModules?: IrWasmModule[]): string {
  return emitWasmModules({ wasmModules } as IrModule, new Set(), false).join("\n");
}

describe("WASM rejection registry", () => {
  test("emits nothing for programs that do not use WebAssembly", () => {
    expect(emit()).toBe("");
  });

  test("keeps rejected bytes out of the executable registry and escapes reasons", () => {
    const output = emit([
      module("AGFzbQEAAAABBAFgAAADAgEACgkBBwBBAP0PGgs=", 'unsupported features: simd "x"\\\né'),
    ]);
    expect(output).toContain("@scr_wasm_registry = constant { i64, ptr } { i64 0, ptr null }");
    expect(output).toContain(
      "@scr_wasm_rejections = constant { i64, ptr } { i64 1, ptr @sc_wasm_rejected_modules }",
    );
    expect(output).toContain("i64 29, ptr @sc_wasm_rejection_0");
    expect(output).toContain("simd \\22x\\22\\5C\\0A\\C3\\A9\\00");
    expect(output).not.toContain("define internal");
  });

  test("retains translated descriptors alongside rejected modules", () => {
    const output = emit([
      module("AGFzbQEAAAA="),
      module("AGFzbQEAAAAB", "malformed module: unexpected end"),
    ]);
    expect(output).toContain(
      "@scr_wasm_registry = constant { i64, ptr } { i64 1, ptr @sc_wasm_registry_modules }",
    );
    expect(output).toContain("malformed module: unexpected end\\00");
    expect(output).toContain(
      "@scr_wasm_rejections = constant { i64, ptr } { i64 1, ptr @sc_wasm_rejected_modules }",
    );
  });

  test("retains translator failures even when no discovery reason was supplied", () => {
    const output = emit([module("AGFzbQEAAAABBAFgAAADAgEACgkBBwBBAP0PGgs=")]);
    expect(output).toContain("translation failed:");
    expect(output).toContain("@scr_wasm_registry = constant { i64, ptr } { i64 0, ptr null }");
    expect(output).toContain(
      "@scr_wasm_rejections = constant { i64, ptr } { i64 1, ptr @sc_wasm_rejected_modules }",
    );
  });
});
