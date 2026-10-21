import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compile } from "../src/index.js";

test("readFileSync accepts typed URL paths across Buffer and encoding overloads", async () => {
  const directory = mkdtempSync(join(tmpdir(), "scriptc-fs-read-url-"));
  try {
    const entry = join(directory, "main.ts");
    writeFileSync(
      entry,
      `import { readFileSync } from "node:fs";
const path = new URL("file:///fixture");
console.log(readFileSync(path).length);
console.log(readFileSync(path, null).toString("hex"));
console.log(readFileSync(path, undefined).toString("hex"));
console.log(readFileSync(path, { encoding: null }).toString("hex"));
console.log(readFileSync(path, "").toString("hex"));
console.log(readFileSync(path, "utf8"));
console.log(readFileSync(path, { encoding: "hex" }));
let encoding: BufferEncoding = "hex";
console.log(readFileSync(path, encoding));
`,
    );
    const result = await compile(entry, {
      outDir: directory,
      outPath: join(directory, "program.ir"),
      outputKind: "ir",
    });
    expect(result.ok, JSON.stringify(result.ok ? [] : result.diagnostics)).toBe(true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("readFileSync URL paths retain the refusal for unsupported flag options", async () => {
  const directory = mkdtempSync(join(tmpdir(), "scriptc-fs-read-url-flags-"));
  try {
    const entry = join(directory, "main.ts");
    writeFileSync(
      entry,
      `import { readFileSync } from "node:fs";
console.log(readFileSync(new URL("file:///fixture"), { encoding: "utf8", flag: "w" }));
`,
    );
    const result = await compile(entry, {
      outDir: directory,
      outPath: join(directory, "program.ir"),
      outputKind: "ir",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected unsupported read options to fail");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "SC9001")).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
