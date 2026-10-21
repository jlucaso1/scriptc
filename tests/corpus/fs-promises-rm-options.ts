import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "scriptc-rm-"));
try {
  const missing = join(dir, "missing");
  await rm(missing, { force: true });
  await rm(missing, { recursive: true, force: true });
  await rm(missing, { force: true, maxRetries: 1 });
  await rm(missing, { force: true, retryDelay: 0 });
  const file = join(dir, "file");
  writeFileSync(file, "data");
  const result = await rm(file, {});
  console.log("file", existsSync(file), result === undefined);
  writeFileSync(file, "one argument");
  await rm(file);
  console.log("plain", existsSync(file));
  const tree = join(dir, "tree");
  mkdirSync(join(tree, "child"), { recursive: true });
  writeFileSync(join(tree, "child", "data"), "data");
  writeFileSync(join(tree, "second"), "data");
  mkdirSync(join(tree, "empty"));
  await rm(tree, { recursive: true, force: true, maxRetries: 2, retryDelay: 1 });
  console.log("tree", existsSync(tree));
  mkdirSync(tree);
  try {
    const pending = rm(tree, { force: true });
    console.log("returned promise");
    await pending;
  } catch (error) {
    if (error instanceof Error) console.log("directory rejected", error.message.includes("EISDIR"));
  }
  try {
    const pending = rm(missing, { recursive: true, maxRetries: 1, retryDelay: 0 });
    console.log("returned retry promise");
    await pending;
  } catch (error) {
    if (error instanceof Error) console.log("missing rejected", (error as NodeJS.ErrnoException).code);
  }
  for (const value of [-1, 1.5, NaN, Infinity, 4294967296]) {
    writeFileSync(file, "keep");
    try {
      const pending = rm(file, { force: true, maxRetries: value });
      console.log("returned invalid retries promise");
      await pending;
    } catch (error) {
      if (error instanceof Error) console.log(error.name, (error as NodeJS.ErrnoException).code, error.message, existsSync(file));
    }
  }
  for (const value of [-1, 1.5, NaN, Infinity, 2147483648]) {
    try {
      const pending = rm(file, { force: true, retryDelay: value });
      console.log("returned invalid delay promise");
      await pending;
    } catch (error) {
      if (error instanceof Error) console.log(error.name, (error as NodeJS.ErrnoException).code, error.message, existsSync(file));
    }
  }
  try {
    const pending = rm("bad\0path", { maxRetries: -1, retryDelay: -1 });
    console.log("returned invalid path promise");
    await pending;
  } catch (error) {
    if (error instanceof Error) console.log(error.name, (error as NodeJS.ErrnoException).code, error.message);
  }
  const order: string[] = [];
  function path(): string { order.push("path"); return missing; }
  function retries(): number { order.push("retries"); return 1; }
  function delay(): number { order.push("delay"); return 0; }
  await rm(path(), { recursive: true, force: true, retryDelay: delay(), maxRetries: retries() });
  console.log(order.join(","));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
