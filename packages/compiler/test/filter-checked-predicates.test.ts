import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { analyze, compile } from "../src/index.js";

async function run(source: string): Promise<ReturnType<typeof spawnSync>> {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-filter-checked-"));
  try {
    const entry = join(dir, "main.ts");
    writeFileSync(entry, source);
    const built = await compile(entry, {
      outDir: dir,
      outPath: join(dir, "program"),
      sanitize: process.env["SCRIPTC_SAN"] === "1",
    });
    if (!built.ok) throw new Error(built.diagnostics.map((d) => d.message).join("\n"));
    return spawnSync(built.binaryPath, [], { timeout: 30_000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test.skipIf(process.platform === "win32")("callback aliases keep the stored tuple", async () => {
  const result = await run(`
const source: [string, string | number][] = [["a", 1]];
const narrowed = source.filter((entry): entry is [string, number] => typeof entry[1] === "number");
narrowed.forEach(entry => { const alias = entry; const again = alias; again[1] = 7; });
console.log(source[0]![1]);
narrowed.forEach(entry => {
  const alias = entry;
  source[0]![1] = "changed";
  try { console.log(alias[1] + 1); } catch (error) { console.log(error instanceof TypeError); }
});
`);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout.toString()).toBe("7\ntrue\n");
  expect(result.stderr.toString()).toBe("");
});

test.skipIf(process.platform === "win32")(
  "destructuring array writes use tuple storage",
  async () => {
    const result = await run(`
const source: [string, unknown][] = [["a", 1]];
const narrowed = source.filter((entry): entry is [string, number] => typeof entry[1] === "number");
[narrowed[0]] = [["replacement", 2]];
console.log(narrowed[0]![0], narrowed[0]![1], source[0]![0]);
const events: string[] = [];
function value(): number { events.push("value"); return 3; }
function index(): number { events.push("index"); return 0; }
[narrowed[index()]] = [["assigned", value()]];
console.log(narrowed[0]![1], events.join(","));
`);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout.toString()).toBe("replacement 2 a\n3 value,index\n");
    expect(result.stderr.toString()).toBe("");
  },
);

test.skipIf(process.platform === "win32")(
  "tuple predicates validate reads after an alias changes the field",
  async () => {
    const result = await run(`
const source: [string, unknown][] = [["a", 1]];
const narrowed = source.filter((entry): entry is [string, number] => typeof entry[1] === "number");
const entry = narrowed[0]!;
entry[1] = 7;
console.log(source[0]![1], entry === source[0]);
source[0]![1] = "changed";
console.log(typeof entry[1]);
try { console.log(entry[1] + 1); } catch (error) { console.log(error instanceof TypeError); }
`);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout.toString()).toBe("7 true\nstring\ntrue\n");
    expect(result.stderr.toString()).toBe("");
  },
);

test.skipIf(process.platform === "win32")(
  "lying predicates cannot reinterpret union or tuple payloads",
  async () => {
    const result = await run(`
const tuples: [string, unknown][] = [["a", "wrong"]];
const retained = tuples.filter((entry): entry is [string, number] => true);
console.log(retained.length, retained[0] === tuples[0]);
console.log(typeof retained[0]![1]);
try { console.log(retained[0]![1] + 1); } catch (error) { console.log(error instanceof TypeError); }
const values: (string | number | undefined)[] = ["a", 2, undefined];
try { console.log(values.filter((value): value is string => true).length); }
catch (error) { console.log(error instanceof TypeError); }
try { console.log(values.filter((value): value is string | number => true).length); }
catch (error) { console.log(error instanceof TypeError); }
`);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout.toString()).toBe("1 true\nstring\ntrue\ntrue\ntrue\n");
    expect(result.stderr.toString()).toBe("");
  },
);

test.skipIf(process.platform === "win32")(
  "union-backed tuple fields validate fresh reads and preserve typeof",
  async () => {
    const result = await run(`
const source: [string, string | number][] = [["a", 1]];
const narrowed = source.filter((entry): entry is [string, number] => typeof entry[1] === "number");
source[0]![1] = "changed";
console.log(typeof (narrowed[0]![1]));
try { console.log(narrowed[0]![1] + 1); } catch (error) { console.log(error instanceof TypeError); }
`);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout.toString()).toBe("string\ntrue\n");
    expect(result.stderr.toString()).toBe("");
  },
);

test.each([
  [
    "reference field refinement",
    `const entries: [string, unknown][] = [["a", [1]]];
console.log(entries.filter((entry): entry is [string, number[]] => Array.isArray(entry[1])).length);`,
  ],
  [
    "void predicate",
    `const values = [1, 2]; const predicate: (value: number) => void = value => value;
console.log(values.filter(predicate).length);`,
  ],
  ...[
    "narrowed[0] = replacement;",
    "[narrowed[0]] = [replacement];",
    "narrowed.push(replacement);",
    "function mutate(entry: [string, number]): void { entry[1] = 7; } narrowed.forEach(entry => mutate(entry));",
    'const assigned = ([narrowed[0]] = [["value", 2]]); console.log(assigned[0]);',
  ].map((assignment) => [
    `existing tuple layout conversion (${assignment})`,
    `const source: [string, unknown][] = [["a", 1]];
const narrowed = source.filter((entry): entry is [string, number] => true);
const replacement: [string, number] = ["b", 2];
${assignment}`,
  ]),
])("%s preserves its unsupported diagnostic", (_name, source) => {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-filter-refused-"));
  try {
    const entry = join(dir, "main.ts");
    writeFileSync(entry, source);
    const { coverage } = analyze(entry, {});
    expect(coverage.preflightFailed, JSON.stringify(coverage.diagnostics)).toBe(false);
    expect(coverage.diagnostics).toContainEqual(expect.objectContaining({ code: "SC1090" }));
    expect(coverage.diagnostics.some((d) => d.code === "SC9001")).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an invalid predicate annotation still fails TypeScript preflight", () => {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-filter-preflight-"));
  try {
    const entry = join(dir, "main.ts");
    writeFileSync(
      entry,
      `const values = [1]; console.log(values.filter((value): value is string => true));`,
    );
    const { coverage } = analyze(entry, {});
    expect(coverage.preflightFailed).toBe(true);
    expect(coverage.diagnostics).toContainEqual(expect.objectContaining({ code: "SC0001" }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tuple increment keeps its existing diagnostic", () => {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-filter-increment-"));
  try {
    const entry = join(dir, "main.ts");
    writeFileSync(
      entry,
      `const source: [string, unknown][] = [["a", 1]];
const narrowed = source.filter((entry): entry is [string, number] => true);
narrowed[0]![1]++;`,
    );
    const { coverage } = analyze(entry, {});
    expect(coverage.diagnostics).toContainEqual(expect.objectContaining({ code: "SC1045" }));
    expect(coverage.diagnostics.some((d) => d.code === "SC9001")).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.each([false, true])(
  "storage probes preserve deferred diagnostics (reached: %s)",
  (reached) => {
    const dir = mkdtempSync(join(tmpdir(), "scriptc-filter-deferred-"));
    try {
      const entry = join(dir, "main.ts");
      writeFileSync(
        entry,
        `interface Outer { dyn: { value: WeakRef<object> } }
function unsupported(value: Outer): Outer { return value; }
function unused(value: Outer): Outer { return unsupported(value); }
const entries: [string, unknown][] = [["a", 1]];
console.log(entries.filter((entry): entry is [string, number] => typeof entry[1] === "number")[0]![1]);
${reached ? "console.log(unsupported);" : ""}`,
      );
      const { coverage } = analyze(entry, {});
      expect(coverage.preflightFailed, JSON.stringify(coverage.diagnostics)).toBe(false);
      if (reached)
        expect(coverage.diagnostics).toContainEqual(expect.objectContaining({ code: "SC2009" }));
      else expect(coverage.diagnostics).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
