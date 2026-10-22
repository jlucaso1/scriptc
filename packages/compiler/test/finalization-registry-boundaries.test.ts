import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { analyze } from "../src/index.js";

// Keep the ownership boundary explicit until a collector and cleanup-job
// contract exists. Successful module initialization alone is not support.
test.each([
  [
    "construction",
    "main.ts",
    `const registry = new FinalizationRegistry<number>(value => console.log(value));
registry.register({}, 1);
console.log("ok");`,
  ],
  ["constructor value", "main.ts", "const Registry = FinalizationRegistry; console.log(Registry);"],
  [
    "JavaScript initialization",
    "main.js",
    `const registry = new FinalizationRegistry(value => console.log(value));
registry.register({}, 1);
console.log("ok");`,
  ],
] as const)("keeps finalization fenced for %s", (_name, file, source) => {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-finalization-boundary-"));
  try {
    const entry = join(dir, file);
    writeFileSync(entry, source);
    const { coverage } = analyze(entry);
    const diagnostics = file === "main.js" ? (coverage.runtimeFences ?? []) : coverage.diagnostics;
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: "SC2020",
        message: expect.stringContaining("FinalizationRegistry"),
      }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
