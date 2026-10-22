/** Integer SIMD metadata shared by stack validation and LLVM lowering. */
export interface SimdIntegerOp {
  bits: number;
  kind:
    | "compare"
    | "all-true"
    | "bitmask"
    | "shift"
    | "unary"
    | "binary"
    | "extend"
    | "extmul"
    | "pairwise"
    | "dot"
    | "saturating"
    | "average"
    | "narrow"
    | "popcnt";
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
  for (let group = 0; group < 3; group++) {
    const bits = 16 << group;
    const extend = sub - (0x87 + 0x20 * group);
    if (extend >= 0 && extend < 4)
      return { bits, kind: "extend", operation: ["low_s", "high_s", "low_u", "high_u"][extend]! };
    const multiply = sub - (0x9c + 0x20 * group);
    if (multiply >= 0 && multiply < 4)
      return { bits, kind: "extmul", operation: ["low_s", "high_s", "low_u", "high_u"][multiply]! };
  }
  if (sub >= 0x7c && sub <= 0x7f)
    return { bits: sub < 0x7e ? 16 : 32, kind: "pairwise", operation: sub % 2 === 0 ? "s" : "u" };
  if (sub === 0xba) return { bits: 32, kind: "dot", operation: "s" };
  for (let group = 0; group < 2; group++) {
    const bits = 8 << group;
    const add = sub - (0x6f + 0x20 * group);
    const subtract = sub - (0x72 + 0x20 * group);
    if (add >= 0 && add < 2)
      return { bits, kind: "saturating", operation: add === 0 ? "add_s" : "add_u" };
    if (subtract >= 0 && subtract < 2)
      return { bits, kind: "saturating", operation: subtract === 0 ? "sub_s" : "sub_u" };
    if (sub === 0x7b + 0x20 * group) return { bits, kind: "average", operation: "" };
    const narrow = sub - (0x65 + 0x20 * group);
    if (narrow >= 0 && narrow < 2)
      return { bits, kind: "narrow", operation: narrow === 0 ? "s" : "u" };
  }
  if (sub === 0x82) return { bits: 16, kind: "saturating", operation: "q15" };
  if (sub === 0x62) return { bits: 8, kind: "popcnt", operation: "" };
  return null;
}
