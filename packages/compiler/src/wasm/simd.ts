/** Integer SIMD metadata shared by stack validation and LLVM lowering. */
export interface SimdIntegerOp {
  bits: number;
  kind: "compare" | "all-true" | "bitmask" | "shift" | "unary" | "binary";
  operation: string;
}

export function simdIntegerOp(sub: number): SimdIntegerOp | null {
  if (sub >= 0x23 && sub <= 0x40) {
    const index = sub - 0x23;
    const conditions = ["eq", "ne", "slt", "ult", "sgt", "ugt", "sle", "ule", "sge", "uge"];
    return {
      bits: 8 << Math.floor(index / 10),
      kind: "compare",
      operation: conditions[index % 10]!,
    };
  }
  if (sub >= 0xd6 && sub <= 0xdb) {
    const conditions = ["eq", "ne", "slt", "sgt", "sle", "sge"];
    return { bits: 64, kind: "compare", operation: conditions[sub - 0xd6]! };
  }
  for (let group = 0; group < 4; group++) {
    if (sub === 0x63 + 0x20 * group) return { bits: 8 << group, kind: "all-true", operation: "" };
    if (sub === 0x64 + 0x20 * group) return { bits: 8 << group, kind: "bitmask", operation: "" };
  }
  for (let group = 0; group < 4; group++) {
    const bits = 8 << group;
    const shift = sub - (0x6b + 0x20 * group);
    if (shift >= 0 && shift < 3)
      return { bits, kind: "shift", operation: ["shl", "ashr", "lshr"][shift]! };
    if (sub === 0x60 + 0x20 * group) return { bits, kind: "unary", operation: "abs" };
    if (sub === 0x61 + 0x20 * group) return { bits, kind: "unary", operation: "neg" };
    if (sub === 0x6e + 0x20 * group) return { bits, kind: "binary", operation: "add" };
    if (sub === 0x71 + 0x20 * group) return { bits, kind: "binary", operation: "sub" };
    if (group > 0 && sub === 0x75 + 0x20 * group) return { bits, kind: "binary", operation: "mul" };
    const minmax = sub - (0x76 + 0x20 * group);
    if (group < 3 && minmax >= 0 && minmax < 4)
      return { bits, kind: "binary", operation: ["min_s", "min_u", "max_s", "max_u"][minmax]! };
  }
  return null;
}
