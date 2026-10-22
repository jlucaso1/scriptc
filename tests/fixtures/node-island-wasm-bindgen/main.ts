import { call, callSync } from "@scriptc/node";

for (let attempt = 0; attempt < 2; attempt++) {
  try {
    callSync("./bad-init.cjs", "unused");
  } catch (error) {
    console.log("init failed", error instanceof SyntaxError, (error as Error).message);
  }
}
console.log(callSync<string>("./adapter.cjs", "validation"));
console.log(callSync<string>("./adapter.cjs", "sync"));
try {
  callSync("./adapter.cjs", "throwSync");
} catch (error) {
  console.log(error instanceof RangeError, (error as NodeJS.ErrnoException).code, (error as Error).message);
}
const pending = [
  call<string>("./adapter.cjs", "async", false),
  call<string>("./adapter.cjs", "async", false),
];
console.log(callSync<string>("./adapter.cjs", "sync"));
console.log((await Promise.all(pending)).join(","));
try {
  await call<string>("./adapter.cjs", "async", true);
} catch (error) {
  console.log(error instanceof RangeError, (error as NodeJS.ErrnoException).code, (error as Error).message);
}
console.log(callSync<string>("./adapter.cjs", "snapshot"));
