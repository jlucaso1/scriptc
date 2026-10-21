import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { analyze } from "../src/index.js";

for (const options of [
  "{}",
  "{ recursive: true, force: true }",
  "{ maxRetries: 2, retryDelay: 1 }",
]) {
  test(`fs.promises.rm lowers ${options}`, () => {
    const dir = mkdtempSync(join(tmpdir(), "scriptc-rm-options-"));
    try {
      const entry = join(dir, "main.ts");
      writeFileSync(
        entry,
        `import { rm } from "node:fs/promises"; await rm("missing", ${options});`,
      );
      expect(analyze(entry, {}).coverage.diagnostics).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (const options of [
  "{ recursive: Boolean(1) }",
  "{ force: Boolean(1) }",
  "{ ...{ force: true } }",
  "{ 'maxRetries': 2, 'retryDelay': 1 }",
  "{ unknown: true }",
]) {
  test(`fs.promises.rm keeps its options refusal for ${options}`, () => {
    const dir = mkdtempSync(join(tmpdir(), "scriptc-rm-options-"));
    try {
      const entry = join(dir, "main.ts");
      writeFileSync(
        entry,
        `import { rm } from "node:fs/promises"; await rm("missing", ${options});`,
      );
      expect(
        analyze(entry, {}).coverage.diagnostics.some(
          (d) => d.code === (options === "{ unknown: true }" ? "SC0001" : "SC2020"),
        ),
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
