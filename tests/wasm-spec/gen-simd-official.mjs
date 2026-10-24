// WebAssembly/spec wg-2.0 fffc6e12fa454e475455a7b58d3b5dc343980c10.
// Regenerate with: node tests/wasm-spec/gen-simd-official.mjs <test/core/simd> <wabt-1.0.37/bin>
// WABT 1.0.37 tools assemble wrappers; no vector crosses the JavaScript boundary.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseWasmModule } from "../../packages/compiler/dist/wasm/module.js";

const [spec, tools] = process.argv.slice(2);
if (!spec || !tools) throw new Error("expected SIMD spec directory and WABT bin directory");
const revision = execFileSync("git", ["-C", spec, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
if (revision !== "fffc6e12fa454e475455a7b58d3b5dc343980c10")
  throw new Error("expected WebAssembly/spec wg-2.0 revision");
if (execFileSync(join(tools, "wat2wasm"), ["--version"], { encoding: "utf8" }).trim() !== "1.0.36 (git~1.0.37)")
  throw new Error("expected WABT 1.0.37 release banner");
const root = resolve(import.meta.dirname, "../..");
const temp = mkdtempSync(join(tmpdir(), "simd-official-"));
const typeName = (t) => ({ 127: "i32", 126: "i64", 125: "f32", 124: "f64", 123: "v128" })[t];
const q = (s) => JSON.stringify(s);
const literal = (v) => {
  if (v.type === "v128") {
    const lane = v.lane_type;
    const bits = Number(lane.slice(1));
    return `v128.const i${bits}x${128 / bits} ${v.value.join(" ")}`;
  }
  if (v.type === "f32" || v.type === "f64") {
    const bits = v.type.slice(1);
    return `i${bits}.const ${v.value} ${v.type}.reinterpret_i${bits}`;
  }
  return `${v.type}.const ${v.value}`;
};
function testBits(read, bits, want) {
  if (want === "nan:canonical")
    return `${read} i${bits}.const ${bits === 32 ? "2147483647" : "9223372036854775807"} i${bits}.and i${bits}.const ${bits === 32 ? "2143289344" : "9221120237041090560"} i${bits}.eq`;
  if (want === "nan:arithmetic")
    return `${read} i${bits}.const ${bits === 32 ? "2143289344" : "9221120237041090560"} i${bits}.and i${bits}.const ${bits === 32 ? "2143289344" : "9221120237041090560"} i${bits}.eq`;
  return `${read} i${bits}.const ${want} i${bits}.eq`;
}
function compare(local, want) {
  if (want.type === "v128") {
    const bits = Number(want.lane_type.slice(1));
    if (!want.value.some((v) => v.startsWith("nan:")))
      return `local.get ${local} ${literal(want)} i8x16.eq i8x16.all_true`;
    return (
      want.value
        .map((v, i) =>
          testBits(`local.get ${local} i${bits}x${128 / bits}.extract_lane ${i}`, bits, v),
        )
        .join(" ") + " i32.and".repeat(want.value.length - 1)
    );
  }
  if (want.type === "f32" || want.type === "f64") {
    const bits = Number(want.type.slice(1));
    return testBits(`local.get ${local} i${bits}.reinterpret_${want.type}`, bits, want.value);
  }
  return `local.get ${local} ${literal(want)} ${want.type}.eq`;
}
let total = 0,
  negatives = [];
try {
  for (const file of readdirSync(spec)
    .filter((f) => f.endsWith(".wast"))
    .sort()) {
    const json = join(temp, "case.json");
    execFileSync(join(tools, "wast2json"), [join(spec, file), "-o", json]);
    const commands = JSON.parse(readFileSync(json, "utf8")).commands;
    const groups = [];
    let current = null;
    for (const command of commands) {
      if (command.type === "module") {
        current = { bytes: readFileSync(join(temp, command.filename)), actions: [], register: [] };
        groups.push(current);
      } else if (command.type === "register") {
        current.register.push(command.as);
      } else if (command.type === "assert_invalid" || command.type === "assert_malformed") {
        if (command.module_type === "binary")
          negatives.push({
            name: `${file}:${command.line}`,
            type: command.type,
            base64: readFileSync(join(temp, command.filename)).toString("base64"),
          });
      } else if (["assert_return", "assert_trap", "action"].includes(command.type)) {
        if (!current || command.action.type !== "invoke" || command.action.module)
          throw new Error(`unhandled action ${file}:${command.line}`);
        current.actions.push(command);
      } else throw new Error(`unhandled command ${command.type} ${file}:${command.line}`);
    }
    const modules = [],
      tests = [];
    for (const group of groups) {
      const parsed = parseWasmModule(group.bytes);
      const exports = new Map(
        parsed.exports
          .filter((e) => e.kind === 0)
          .map((e) => [e.name, parsed.types[parsed.funcTypes[e.index]]]),
      );
      const imports = new Map();
      const funcs = [];
      for (const command of group.actions) {
        const action = command.action,
          ft = exports.get(action.field);
        if (!ft) throw new Error(`missing function ${action.field}`);
        if (!imports.has(action.field)) imports.set(action.field, { index: imports.size, ft });
        const index = funcs.length;
        const call =
          action.args.map(literal).join(" ") + ` call $f${imports.get(action.field).index}`;
        let code = ft.results.map((t, i) => `(local $r${i} ${typeName(t)})`).join(" ") + " " + call;
        code += ft.results.map((_, i) => ` local.set $r${ft.results.length - i - 1}`).join("");
        if (command.type === "assert_return") {
          if (command.expected.length !== ft.results.length)
            throw new Error("result arity mismatch");
          code +=
            " i32.const 1 " +
            command.expected.map((v, i) => compare(`$r${i}`, v) + " i32.and").join(" ");
        } else code += " i32.const 1";
        funcs.push(`(func (export "t${index}") (result i32) ${code})`);
        tests.push([
          modules.length,
          index,
          command.type === "assert_trap",
          `${file}:${command.line}`,
        ]);
        total++;
      }
      if (!funcs.length) {
        modules.push([group.bytes.toString("base64"), null, group.register]);
        continue;
      }
      const wat = `(module ${[...imports].map(([name, { index, ft }]) => `(import "m" ${q(name)} (func $f${index} ${ft.params.length ? `(param ${ft.params.map(typeName).join(" ")})` : ""} ${ft.results.length ? `(result ${ft.results.map(typeName).join(" ")})` : ""}))`).join(" ")} ${funcs.join("\n")})`;
      writeFileSync(join(temp, "wrapper.wat"), wat);
      execFileSync(join(tools, "wat2wasm"), [
        join(temp, "wrapper.wat"),
        "-o",
        join(temp, "wrapper.wasm"),
      ]);
      modules.push([
        group.bytes.toString("base64"),
        readFileSync(join(temp, "wrapper.wasm")).toString("base64"),
        group.register,
      ]);
    }
    const dir = join(
      root,
      "tests/corpus",
      `webassembly-official-${file.slice(0, -5).replaceAll("_", "-")}`,
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "data.mjs"),
      `// Generated from WebAssembly/spec wg-2.0, Apache-2.0; see gen-simd-official.mjs.\nexport const modules = ${JSON.stringify(modules)};\nexport const tests = ${JSON.stringify(tests)};\n`,
    );
    writeFileSync(
      join(dir, "main.mjs"),
      `import {run} from "../../wasm-spec/simd-official-runner.mjs";\nimport {modules, tests} from "./data.mjs";\nrun(modules, tests);\n`,
    );
  }
  writeFileSync(
    join(root, "tests/wasm-spec/corpus/simd-official-negative.json"),
    JSON.stringify(negatives) + "\n",
  );
  console.log(JSON.stringify({ actions: total, negative: negatives.length }));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
