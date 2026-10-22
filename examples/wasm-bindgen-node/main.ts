import { callSync } from "@scriptc/node";

const digest = callSync<number[]>("./adapter.mjs", "sha256", [97, 98, 99]);
console.log(digest.length, digest.join(","));
try {
  callSync<number[]>("./adapter.mjs", "sha256", [256]);
} catch (error) {
  console.log(error instanceof RangeError, (error as Error).message);
}
