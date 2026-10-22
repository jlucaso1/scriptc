import { sha256 as wasmSha256 } from "@oxidezap/whatsapp-rust-bridge";

// The generated binding, its registries and its WASM instance load in Node.
// Only copied byte arrays cross the @scriptc/node boundary. This ESM adapter
// also honors the package's import-only public export.
export function sha256(bytes) {
  if (!Array.isArray(bytes)) throw new RangeError("expected an array of bytes");
  for (const byte of bytes) {
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new RangeError("expected an array of bytes");
    }
  }
  return Array.from(wasmSha256(new Uint8Array(bytes)));
}
