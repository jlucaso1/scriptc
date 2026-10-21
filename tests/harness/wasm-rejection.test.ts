import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { compile } from "@scriptc/compiler";

const exec = promisify(execFile);

test.each(["release", "dev"] as const)(
  "native WASM errors distinguish rejected modules from unseen bytes (%s)",
  async (optimization) => {
    const outDir = await mkdtemp(join(tmpdir(), "scriptc-wasm-rejection-"));
    try {
      const entry = join(outDir, "main.ts");
      await writeFile(
        entry,
        `
const simd = Buffer.from("AGFzbQEAAAABBAFgAAADAgEACgkBBwBBAP0PGgs=", "base64");
const invalid = Buffer.from("AGFzbQEAAAABBQFgAAF/AwIBAAoEAQIACw==", "base64");
const malformed = Buffer.from("AGFzbQEAAAAB", "base64");
const empty = Buffer.from("AGFzbQEAAAA=", "base64");
const unseen = Buffer.from(process.env["WASM_UNSEEN"]!, "base64");
for (const bytes of [simd, malformed, invalid, unseen]) {
  console.log("validate", WebAssembly.validate(bytes));
  try {
    new WebAssembly.Module(bytes);
    console.log("unexpected success");
  } catch (error) {
    if (!(error instanceof WebAssembly.CompileError)) throw error;
    if (error instanceof Error) console.log(error.name, error.message);
  }
}
console.log("fallback", WebAssembly.validate(empty), new WebAssembly.Module(empty) instanceof WebAssembly.Module);
try { await WebAssembly.compile(simd); } catch (error) {
  if (!(error instanceof WebAssembly.CompileError)) throw error;
  if (error instanceof Error) console.log("compile", error.name, error.message);
}
try { await WebAssembly.instantiate(simd); } catch (error) {
  if (!(error instanceof WebAssembly.CompileError)) throw error;
  if (error instanceof Error) console.log("instantiate", error.name, error.message);
}
`,
      );
      const result = await compile(entry, {
        backend: "llvm",
        optimization,
        sanitize: process.env["SCRIPTC_SAN"] === "1",
        outDir,
        outPath: join(outDir, process.platform === "win32" ? "program.exe" : "program"),
      });
      expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
      if (!result.ok) return;
      const { stdout, stderr } = await exec(result.binaryPath, [], {
        env: { ...process.env, WASM_UNSEEN: "AGFzbQEAAAABBAFgAAADAgEACgkBBwBBAf0PGgs=" },
      });
      expect(stderr).toBe("");
      const lines = stdout.trim().split("\n");
      expect(lines).toHaveLength(11);
      expect(lines[0]).toBe("validate false");
      expect(lines[1]).toContain(
        "CompileError WebAssembly.Module(): this module was found during the build but was not translated: unsupported features: simd",
      );
      expect(lines[2]).toBe("validate false");
      expect(lines[3]).toContain(
        "CompileError WebAssembly.Module(): this module was found during the build but was not translated: malformed module:",
      );
      expect(lines[4]).toBe("validate false");
      expect(lines[5]).toContain(
        "CompileError WebAssembly.Module(): this module was found during the build but was not translated: invalid module:",
      );
      expect(lines[6]).toBe("validate false");
      expect(lines[7]).toContain("cannot compile modules whose bytes it did not see");
      expect(lines[8]).toBe("fallback true true");
      expect(lines[9]).toContain(
        "compile CompileError WebAssembly.compile(): this module was found during the build but was not translated: unsupported features: simd",
      );
      expect(lines[10]).toContain(
        "instantiate CompileError WebAssembly.instantiate(): this module was found during the build but was not translated: unsupported features: simd",
      );
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  },
);
