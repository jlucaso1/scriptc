import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compile, compileLibrary } from "../src/index.js";

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

test("dynamic URL-read options refuse unsupported fields before filesystem effects", async () => {
  const directory = mkdtempSync(join(tmpdir(), "scriptc-fs-read-url-dynamic-"));
  try {
    const entry = join(directory, "main.mjs");
    writeFileSync(
      entry,
      `import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
const existing = process.argv[2];
const missing = process.argv[3];
writeFileSync(existing, "kept");
/** @param {unknown} options */
function attempt(options, path) {
  try { readFileSync(pathToFileURL(path), options); console.log("unexpected success"); }
  catch (error) { console.log(error.code, error.message); }
}
attempt({ encoding: "utf8", flag: "wx" }, existing);
attempt({ encoding: "utf8", flag: "w" }, existing);
attempt({ encoding: "utf8", flag: "w" }, missing);
attempt(Object.create({ flag: "wx" }), existing);
attempt(Object.defineProperty({}, "flag", { value: "wx" }), existing);
let lateReads = 0;
const late = { get encoding() { lateReads++; Object.defineProperty(this, "flag", { value: "w" }); return "utf8"; } };
attempt(late, existing);
console.log("late reads", lateReads);
attempt({ buffer: Buffer.alloc(1) }, existing);
attempt({ signal: { aborted: false } }, existing);
let hasCalls = 0;
let encodingReads = 0;
const proxy = new Proxy({ get encoding() { encodingReads++; return "utf8"; } }, { has() { hasCalls++; return false; } });
attempt(proxy, existing);
attempt(proxy, missing);
console.log("proxy hooks", hasCalls, encodingReads);
console.log(readFileSync(existing, "utf8"), existsSync(missing));
`,
    );
    const result = await compile(entry, {
      sanitize: process.env["SCRIPTC_SAN"] === "1",
      outDir: directory,
      outPath: join(directory, "program"),
    });
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;
    const child = spawnSync(
      result.binaryPath,
      [join(directory, "existing"), join(directory, "missing")],
      { encoding: "utf8" },
    );
    expect(child.status).toBe(0);
    expect(child.stderr).toBe("");
    expect(child.stdout).toBe(
      "SC2020 readFileSync URL option 'flag' has no native lowering\n".repeat(6) +
        "late reads 3\n" +
        "SC2020 readFileSync URL option 'buffer' has no native lowering\n" +
        "SC2020 readFileSync URL option 'signal' has no native lowering\n" +
        "SC2020 readFileSync URL proxy options have no native lowering\n".repeat(2) +
        "proxy hooks 0 0\n" +
        "kept false\n",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("library URL reads refuse before producing an unusable archive", async () => {
  const directory = mkdtempSync(join(tmpdir(), "scriptc-fs-url-library-"));
  try {
    const entry = join(directory, "entry.ts");
    writeFileSync(
      entry,
      'import { readFileSync } from "node:fs"; export function result(): number { return readFileSync(new URL("file:///fixture"), "utf8").length; }',
    );
    const profilePath = join(directory, "profile.json");
    writeFileSync(
      profilePath,
      JSON.stringify({
        profile_format: 1,
        name: "url-read",
        entry: "entry.ts",
        emission: "llvm",
        abi: {
          prefix: "url_",
          init_symbol: "url_init",
          sink_register_symbol: "url_sink",
          collect_symbol: "url_collect",
        },
        exports: [{ export: "result", symbol: "url_result", params: [], returns: "f64" }],
      }),
    );
    const outDir = join(directory, "out");
    const result = await compileLibrary({ profilePath, outDir });
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SC4005",
          message: expect.stringContaining("URL-path readFileSync"),
        }),
      ]),
    );
    expect(existsSync(join(outDir, "entry.lib.a"))).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
