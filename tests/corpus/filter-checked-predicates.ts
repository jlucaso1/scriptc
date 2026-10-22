// Written predicates retain tuple storage. Scalar reads validate the field,
// and writes through the filtered result still reach the original tuple.
const entries: [string, unknown][] = [["a", 1], ["b", "skip"], ["c", 3]];
const visits: string[] = [];
const numbers = entries.filter((entry, index, array): entry is [string, number] => {
  visits.push(`${index}:${array === entries}`);
  return typeof entry[1] === "number";
});
console.log(visits.join(","));
console.log(numbers.map(([key, value]) => `${key}:${value + 1}`).join(","));
const first = numbers[0];
const alias = numbers;
first[1] = 7;
console.log(entries[0]![1], alias[0]![1], first === entries[0]);
entries[0]![1] = 9;
console.log(first[1] + 1);
numbers[0] = ["new", 11];
console.log(entries[0]![0], numbers[0]![0], first[0]);

function numeric(entry: [string, unknown]): entry is [string, number];
function numeric(entry: [string, unknown]): boolean {
  return typeof entry[1] === "number";
}
console.log(entries.filter(numeric).map((entry: [string, number]) => entry[1]).join(","));

export function select(input: [string, unknown][]): [string, number][] {
  return input.filter((entry): entry is [string, number] => typeof entry[1] === "number");
}
const selected = select(entries);
console.log(selected.length, selected[0] === entries[0]);
selected[0]![1] = 13;
console.log(entries[0]![1]);

const optional: ([string, unknown] | null | undefined)[] = [null, ["x", 4], undefined, ["y", false]];
const present = optional.filter((entry): entry is [string, number] =>
  entry !== null && entry !== undefined && typeof entry[1] === "number");
console.log(present.map((entry) => entry[1] * 2).join(","), present[0] === optional[1]);

const mixed: (string | number | null | undefined)[] = ["one", 2, null, undefined, "three"];
const nonnull = mixed.filter((value): value is string | number => value != null);
console.log(nonnull.length);
function text(value: string | number | null | undefined): value is string {
  return typeof value === "string";
}
console.log(mixed.filter(text).join(","));
console.log(mixed.filter((value): value is number => typeof value === "number").join(","));

const sparse: (string | null | undefined)[] = ["a", undefined, null, "b"];
sparse.length = 6;
let count = 0;
const strings = sparse.filter((value): value is string => {
  count++;
  return value !== null && value !== undefined;
});
console.log(strings.join(","), count);

const changing: [string, unknown][] = [["before", 1]];
const original = changing[0]!;
const retained = changing.filter((entry, index, array): entry is [string, number] => {
  console.log(entry === original, index, array === changing);
  array[0] = ["after", 2];
  array.push(["later", 3]);
  return typeof entry[1] === "number";
});
console.log(retained.length, retained[0] === original, retained[0]![0], changing.length);

// Existing inferred predicates keep their native single-arm path.
const inferred: (string | undefined)[] = ["kept", undefined];
console.log(inferred.filter((value) => value !== undefined).join(","));

const readonlyValues: readonly (string | number)[] = ["text", 5];
console.log(readonlyValues.filter((value): value is string => typeof value === "string").join(","));
const fixed: [string | number, string | number] = ["fixed", 6];
console.log(fixed.filter((value): value is number => typeof value === "number").join(","));

function positive(value: number | undefined): value is number;
function positive(value: unknown): value is number;
function positive(value: unknown): boolean {
  return typeof value === "number" && value > 0;
}
const values: (number | undefined)[] = [undefined, 0, 2];
console.log(values.filter(positive).join(","));

const choose = (input: [string, unknown][]): [string, number][] =>
  input.filter((entry): entry is [string, number] => typeof entry[1] === "number");
const chosen = choose(entries);
console.log(chosen[0] === entries[0], chosen.map((entry) => entry[1]).join(","));

// Reduced record sanitization: entries keep their tuple identity while
// fromEntries constructs a fresh record from the checked numeric fields.
const input: Record<string, unknown> = { accepted: 2, rejected: "text" };
const numericEntries = Object.entries(input).filter((entry): entry is [string, number] =>
  typeof entry[1] === "number");
const result = Object.fromEntries(numericEntries);
console.log(result.accepted + 1, Object.keys(result).join(","));

[chosen[0]![1]] = [17];
console.log(entries[0]![1]);
for (const entry of chosen) entry[1] = entry[1] + 1;
console.log(entries[0]![1], entries[2]![1]);
