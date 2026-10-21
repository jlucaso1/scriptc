import { expect, test } from "vitest";
import { IR_VERSION } from "../ir/serialize.js";
import { VOID, type IrModule } from "../ir/ir.js";
import { executableLinkFeatures } from "./executable-features.js";

const loc = { file: "rm.ts", start: 0, end: 0 };

test("rm options do not change the link identity of other programs", () => {
  const mod: IrModule = {
    irVersion: IR_VERSION,
    sourceFile: loc.file,
    entry: "main",
    functions: [{ name: "main", params: [], locals: [], returnType: VOID, body: [], loc }],
  };
  expect(executableLinkFeatures(mod)).not.toHaveProperty("fsRmOptions");
  mod.functions[0]!.body.push({
    kind: "exprStmt",
    loc,
    expr: { kind: "libCall", fn: "fsp.rmOpts", args: [], type: VOID, loc },
  });
  expect(executableLinkFeatures(mod).fsRmOptions).toBe(true);
});
