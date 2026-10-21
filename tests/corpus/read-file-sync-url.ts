import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "scriptc-read-url-"));
try {
  const path = join(dir, "hello space 水 %.txt");
  writeFileSync(path, "Hello 水!");
  const url = pathToFileURL(path);
  console.log("bytes", readFileSync(url).toString("hex"));
  console.log("null", readFileSync(url, null).toString("hex"));
  console.log("undefined", readFileSync(url, undefined).toString("hex"));
  console.log("record-null", readFileSync(url, { encoding: null }).toString("hex"));
  console.log("empty", readFileSync(url, "").toString("hex"));
  console.log("utf8", readFileSync(url, "utf8"));
  console.log("record", readFileSync(url, { encoding: "hex" }));
  console.log("latin1", readFileSync(url, "latin1"));
  console.log("base64", readFileSync(url, "base64"));
  let order = "";
  function source(value: URL): URL { order += "path;"; return value; }
  function encoding(): BufferEncoding { order += "encoding;"; return "utf8"; }
  console.log("ordered", readFileSync(source(url), encoding()), order);
  order = "";
  const mutable = new URL("https://example.com/invalid");
  function replacePath(): BufferEncoding { order += "encoding;"; mutable.href = url.href; return "hex"; }
  console.log("mutated", readFileSync(source(mutable), replacePath()), order);
  for (const value of [
    "https://example.com/invalid",
    "file://remote/path",
    "file:///invalid%2fpath",
    "file:///invalid%FFpath",
    "file:///invalid%path",
  ]) {
    const invalid = new URL(value);
    order = "";
    try { readFileSync(source(invalid), encoding()); }
    catch (error) {
      if (error instanceof Error) console.log("error", error.name, error.message, order);
    }
    order = "";
    try { readFileSync(source(invalid), { encoding: encoding() }); }
    catch (error) {
      if (error instanceof Error) console.log("record-error", error.name, error.message, order);
    }
    try { readFileSync(invalid); }
    catch (error) {
      if (error instanceof Error) console.log("bytes-error", error.name, error.message);
    }
  }
  order = "";
  function failEncoding(): BufferEncoding { order += "throw;"; throw new Error("encoding operand"); }
  try { readFileSync(source(new URL("https://example.com/invalid")), failEncoding()); }
  catch (error) {
    if (error instanceof Error) console.log("operand-error", error.message, order);
  }
  const badEncoding: string = "invalid-encoding";
  for (const value of [url.href, "https://example.com/invalid"]) {
    try { readFileSync(new URL(value), badEncoding); }
    catch (error) {
      if (error instanceof Error) console.log("encoding-error", error.name, error.message);
    }
  }
  const missing = pathToFileURL(join(dir, "missing"));
  try { readFileSync(missing, "utf8"); }
  catch (error) {
    if (error instanceof Error) console.log("missing", error.message.startsWith("ENOENT:"));
  }
  console.log("recovery", readFileSync(url, "utf8"));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
