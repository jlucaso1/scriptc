import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const url = new URL("https://example.com/invalid");
const cyclic = {};
cyclic.encoding = cyclic;
let calls = 0;
const throwing = new Error("encoding getter");
for (const options of [
  null, undefined, "", "utf8", "invalid-encoding", "buffer",
  { encoding: null }, { encoding: undefined }, { encoding: 0 },
  { encoding: false }, { encoding: NaN }, { encoding: true },
  { encoding: 7 }, { encoding: {} }, { encoding: { encoding: "utf8" } },
  cyclic, [], {}, false, 0,
  { get encoding() { calls++; return "utf8"; } },
  { get encoding() { calls++; throw throwing; } },
]) {
  try { readFileSync(url, options); }
  catch (error) { console.log(error.name, error.code); }
}
console.log("dynamic-getters", calls);
calls = 0;
const options = { get encoding() { calls++; return "utf8"; } };
try { readFileSync(url, options); }
catch (error) { console.log("getter", calls, error.code); }


const directory = mkdtempSync(join(tmpdir(), "scriptc-read-url-options-"));
try {
  const file = directory + "/bytes";
  const empty = directory + "/empty";
  writeFileSync(file, "hello");
  writeFileSync(empty, "");
  for (const path of [file, empty]) {
    for (const mode of ["prefer-value", "fallback", "throw-value", "throw-string", "invalid"]) {
      let reads = 0;
      let hooks = "";
      const final = {
        valueOf() { hooks += "v"; if (mode === "throw-value") throw new Error("value hook"); return mode === "fallback" || mode === "throw-string" ? {} : mode === "invalid" ? "bad-encoding" : "hex"; },
        toString() { hooks += "s"; if (mode === "throw-string") throw new Error("string hook"); return "utf8"; },
      };
      const options = { get encoding() { reads++; return reads < 6 ? "hex" : final; } };
      try { console.log("hooks", path === empty, mode, readFileSync(pathToFileURL(path), options), reads, hooks); }
      catch (error) { console.log("hook-error", path === empty, mode, error.message, reads, hooks); }
    }
    for (const last of ["", undefined, "utf8", "hex", "invalid-encoding"]) {
      let reads = 0;
      const options = { get encoding() { reads++; return reads < 6 ? "hex" : last; } };
      try { console.log("last", path === empty, last, readFileSync(pathToFileURL(path), options), reads); }
      catch (error) { console.log("last-error", path === empty, last, error.code, reads); }
    }
  }
} finally { rmSync(directory, { recursive: true, force: true }); }
