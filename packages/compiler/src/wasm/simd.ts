/** Integer SIMD metadata shared by stack validation and LLVM lowering. */
export interface SimdIntegerOp {
  bits: number;
  kind: "compare" | "all-true" | "bitmask";
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
  return null;
}
