/* The WebAssembly modules discovered by a program (IrModule.wasmModules):
 * each supported module's translation (wasm/translate.ts), rejection reasons, and
 * the registries the runtime searches (scr_wasm_abi.h). The
 * translations join the program module, so the native helper optimizes,
 * partitions and caches them with it. Programs that do not use the
 * WebAssembly API carry no wasmModules and emit nothing here. */
import { llvmBytes, wtf8Bytes } from "../literals.js";
import type { IrModule } from "../../ir/ir.js";
import { decodeBase64 } from "../../wasm/base64.js";
import { translateWasmModule, WasmTranslateError } from "../../wasm/translate.js";

function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/** Whether translated memories check bounds explicitly instead of relying
 * on guard pages and the runtime's fault handler: sanitizer builds (whose
 * runtime owns SIGSEGV), 32-bit targets, and Windows, which has no
 * fault handler yet. */
export function wasmBoundsChecks(options: {
  sanitize: boolean;
  pointerBits: 32 | 64;
  targetTriple: string;
}): boolean {
  if (options.sanitize || options.pointerBits === 32) return true;
  const target = options.targetTriple || process.platform;
  return /windows|mingw|cygwin|win32|msvc/.test(target);
}

/** The top-level lines of every translated module plus the registry.
 * `declared` holds the declarations the module already carries; runtime
 * entry points it lacks are declared here. A module the translator
 * cannot translate enters a separate rejection registry, so loading it
 * reports the known reason without treating it as executable code. */
export function emitWasmModules(
  mod: IrModule,
  declared: ReadonlySet<string>,
  boundsChecks: boolean,
): string[] {
  const modules = mod.wasmModules;
  if (modules === undefined) return [];
  const out: string[] = [];
  const decls = new Set(declared);
  const descriptors: string[] = [];
  const rejections: string[] = [];
  const reject = (sha256: string, size: number, reason: string): void => {
    const symbol = `@sc_wasm_rejection_${rejections.length}`;
    const reasonBytes = wtf8Bytes(reason);
    out.push(
      `${symbol} = private constant [${reasonBytes.length + 1} x i8] c"${llvmBytes(reasonBytes)}"`,
    );
    const hash: string[] = [];
    for (const byte of hexBytes(sha256)) hash.push(`i8 ${byte}`);
    rejections.push(
      `{ [32 x i8], i64, ptr } { [32 x i8] [${hash.join(", ")}], i64 ${size}, ptr ${symbol} }`,
    );
  };
  for (const module of modules) {
    const bytes = decodeBase64(module.bytes);
    if (bytes === null) continue;
    if (module.rejectionReason !== undefined) {
      reject(module.sha256, bytes.length, module.rejectionReason);
      continue;
    }
    let translation;
    try {
      translation = translateWasmModule(bytes, hexBytes(module.sha256), {
        boundsChecks,
        customSections: mod.wasmCustomSections === true,
      });
    } catch (error) {
      if (error instanceof WasmTranslateError) {
        reject(module.sha256, bytes.length, `translation failed: ${error.message}`);
        continue;
      }
      throw error;
    }
    for (const decl of translation.decls) {
      if (decls.has(decl)) continue;
      decls.add(decl);
      out.push(decl);
    }
    for (const part of translation.text) out.push(part);
    descriptors.push(translation.descriptor);
  }
  if (descriptors.length === 0) {
    out.push(`@scr_wasm_registry = constant { i64, ptr } { i64 0, ptr null }`);
  } else {
    out.push(
      `@sc_wasm_registry_modules = private constant [${descriptors.length} x ptr] [${descriptors.map((d) => `ptr ${d}`).join(", ")}]`,
      `@scr_wasm_registry = constant { i64, ptr } { i64 ${descriptors.length}, ptr @sc_wasm_registry_modules }`,
    );
  }
  if (rejections.length === 0) {
    out.push(`@scr_wasm_rejections = constant { i64, ptr } { i64 0, ptr null }`);
  } else {
    out.push(
      `@sc_wasm_rejected_modules = private constant [${rejections.length} x { [32 x i8], i64, ptr }] [${rejections.join(", ")}]`,
      `@scr_wasm_rejections = constant { i64, ptr } { i64 ${rejections.length}, ptr @sc_wasm_rejected_modules }`,
    );
  }
  out.push("");
  return out;
}
