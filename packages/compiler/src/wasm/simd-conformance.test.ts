import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { analyzeWasm } from "./binary.js";
import { translateWasmModule } from "./translate.js";

const abi = JSON.parse(
  readFileSync(
    new URL("../../../../tests/wasm-spec/corpus/simd-abi.json", import.meta.url),
    "utf8",
  ),
) as Record<string, string>;
const negative = JSON.parse(
  readFileSync(
    new URL("../../../../tests/wasm-spec/corpus/simd-official-negative.json", import.meta.url),
    "utf8",
  ),
) as { name: string; type: string; base64: string }[];
const v8Validate = (bytes: Uint8Array): boolean =>
  (
    globalThis as unknown as { WebAssembly: { validate(bytes: Uint8Array): boolean } }
  ).WebAssembly.validate(bytes);
const sha = new Uint8Array(32);
describe("SIMD native value boundaries", () => {
  test.each(Object.entries(abi))("validates and lowers %s", (_name, base64) => {
    const bytes = Buffer.from(base64, "base64");
    expect(v8Validate(bytes)).toBe(true);
    expect(analyzeWasm(bytes).status).toBe("valid");
    for (const boundsChecks of [false, true])
      expect(() => translateWasmModule(bytes, sha, { boundsChecks })).not.toThrow();
  });
  test("seeded boundary mutations never admit modules V8 rejects", () => {
    const originals = Object.values(abi).map((base64) => Buffer.from(base64, "base64"));
    let seed = 0x1679ab1;
    const random = (limit: number): number => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) % limit;
    };
    for (let i = 0; i < 2000; i++) {
      const bytes = Uint8Array.from(originals[random(originals.length)]!);
      bytes[random(bytes.length)] = random(256);
      const result = analyzeWasm(bytes);
      const valid = v8Validate(bytes);
      if (result.status === "valid") expect(valid, `mutation ${i}`).toBe(true);
      if (result.status === "invalid" || result.status === "malformed")
        expect(valid, `mutation ${i}`).toBe(false);
    }
  });
});
describe("official SIMD invalid modules", () => {
  test.each(negative)("rejects $name", (fixture) => {
    const bytes = Buffer.from(fixture.base64, "base64");
    expect(v8Validate(bytes)).toBe(false);
    expect(["invalid", "malformed"]).toContain(analyzeWasm(bytes).status);
  });
});
