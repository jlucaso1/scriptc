// Object emission is not native execution. Requires a built compiler and LLVM 22.1.8.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { translateWasmModule } from "../../packages/compiler/dist/wasm/translate.js";
const [clang, output] = process.argv.slice(2);
if (!clang || !output) throw new Error("expected clang path and output directory");
mkdirSync(output, { recursive: true });
const fixtures = JSON.parse(
  readFileSync(new URL("./corpus/simd-data.json", import.meta.url), "utf8"),
).map((f) => f.base64);
fixtures.push(
  ...Object.values(
    JSON.parse(readFileSync(new URL("./corpus/simd-abi.json", import.meta.url), "utf8")),
  ),
);
const unique = new Map(
  fixtures.map((base64) => {
    const bytes = Buffer.from(base64, "base64");
    return [createHash("sha256").update(bytes).digest("hex"), bytes];
  }),
);
const targets = [
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
  "x86_64-pc-windows-msvc",
];
for (const boundsChecks of [false, true]) {
  const decls = new Set(),
    text = [],
    roots = [];
  for (const [sha, bytes] of unique) {
    const translated = translateWasmModule(bytes, Buffer.from(sha, "hex"), { boundsChecks });
    for (const declaration of translated.decls) decls.add(declaration);
    text.push(...translated.text);
    roots.push(`ptr ${translated.descriptor}`);
  }
  text.push(`@simd_roots = constant [${roots.length} x ptr] [${roots.join(", ")}]`);
  const ir = join(output, `simd-${boundsChecks ? "checked" : "guarded"}.ll`);
  writeFileSync(ir, [...decls, ...text].join("\n") + "\n");
  for (const target of targets) {
    const object = join(output, `${target}-${boundsChecks ? "checked" : "guarded"}.o`);
    execFileSync(clang, ["-target", target, "-x", "ir", "-O0", "-c", ir, "-o", object], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log(
      JSON.stringify({
        target,
        boundsChecks,
        modules: unique.size,
        objectBytes: statSync(object).size,
      }),
    );
  }
}
