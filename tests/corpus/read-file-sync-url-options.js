import { readFileSync } from "node:fs";

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
