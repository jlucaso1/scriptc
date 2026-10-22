import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { analyze, compile } from "@scriptc/compiler";
import { libnodePack } from "./libnode.js";

const exec = promisify(execFile);
const root = join(import.meta.dirname, "../..");
const fixture = join(root, "tests/fixtures/node-island-wasm-bindgen/main.ts");
const sanitize = process.env["SCRIPTC_SAN"] === "1";
const pack = libnodePack();

test.each([
  [
    "a returned callback",
    'const callback = callSync<() => number>("./adapter.cjs", "callback"); console.log(callback());',
  ],
  ["a native callback", 'callSync("./adapter.cjs", "callback", () => 1);'],
  ["a typed array", 'callSync("./adapter.cjs", "bytes", new Uint8Array([1]));'],
  [
    "a class instance",
    'class Owned { value = 1; } callSync("./adapter.cjs", "handle", new Owned());',
  ],
])("the JSON boundary refuses %s", (_name, source) => {
  // Keep the scratch module below the workspace so @scriptc/node resolves.
  const parent = join(root, "node_modules/.cache/scriptc-tests");
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, "wasm-bindgen-boundary-"));
  try {
    const entry = join(dir, "main.ts");
    writeFileSync(entry, `import { callSync } from "@scriptc/node";\n${source}\n`);
    const { coverage } = analyze(entry);
    expect(coverage.diagnostics).toContainEqual(
      expect.objectContaining({ hint: expect.stringContaining("only JSON data") }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function compare(
  entry: string,
  name: string,
  optimization: "release" | "dev",
): Promise<string> {
  const outDir = join(
    root,
    "node_modules/.cache/scriptc-tests/wasm-bindgen-node-island",
    name,
    optimization,
    sanitize ? "san" : "plain",
  );
  mkdirSync(outDir, { recursive: true });
  const built = await compile(entry, {
    outDir,
    outPath: join(outDir, "program"),
    sanitize,
    optimization,
  });
  if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));
  // This deadline detects a hung call or event loop, not finalizer timing.
  const node = await exec(process.execPath, [entry], { encoding: "utf8", timeout: 20_000 });
  const native = await exec(built.binaryPath, [], { encoding: "utf8", timeout: 20_000 });
  expect(node.stderr).toBe("");
  expect(native.stdout).toBe(node.stdout);
  // Preserve raw stderr. Only the documented ASan fiber warning is allowed.
  if (sanitize) {
    expect(native.stderr).toMatch(
      /^$|^==\d+==WARNING: ASan doesn't fully support makecontext\/swapcontext functions and may produce false positives in some cases!\n$/,
    );
  } else expect(native.stderr).toBe("");
  return node.stdout;
}

describe.skipIf(pack === null)("wasm-bindgen ownership inside a Node island", () => {
  test.each(["release", "dev"] as const)(
    "%s: initializes WASM, disposes classes and closures, and completes interleaved sync/async calls",
    async (optimization) => {
      expect(await compare(fixture, "ownership", optimization)).toBe(
        'init failed true binding initialization failed\ninit failed true binding initialization failed\nvalidated\nsync disposed\ntrue ERR_WASM_OPERATION operation failed\nsync disposed\nasync disposed,async disposed\ntrue ERR_WASM_OPERATION operation failed\n{"allocated":12,"released":12,"finalized":0,"unregisters":12}\n',
      );
    },
  );

  // Optional consumer installation is explicit; when requested, a missing
  // package fails rather than being mistaken for a passing compatibility test.
  test
    .skipIf(process.env["SCRIPTC_WASM_BINDGEN_CONSUMER"] !== "1")
    .each(["release", "dev"] as const)(
    "%s: runs the published consumer through the byte-array adapter",
    async (optimization) => {
      const output = await compare(
        join(root, "examples/wasm-bindgen-node/main.ts"),
        "consumer",
        optimization,
      );
      expect(output).toBe(
        "32 186,120,22,191,143,1,207,234,65,65,64,222,93,174,34,35,176,3,97,163,150,23,122,156,180,16,255,97,242,0,21,173\ntrue expected an array of bytes\n",
      );
    },
  );
});
