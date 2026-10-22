// Inferred multi-arm narrowing keeps its refusal. Written predicates and
// predicate values now use checked extraction instead of being refused.
// The successful calls below also guard against diagnostic cascades.
const xs: (string | number | undefined)[] = ["a", 1, undefined];

// Multi-arm narrowing: string | number is not a single arm.
const defined = xs.filter((x) => x !== undefined);
console.log(defined.length);

// A hand-written predicate on an inline callback.
const ys: (string | undefined)[] = ["a", undefined];
const strings = ys.filter((x): x is string => typeof x === "string");
console.log(strings.length);

// A predicate VALUE (declared function with a written predicate).
function isString(x: string | undefined): x is string {
  return typeof x === "string";
}
const viaValue = ys.filter(isString);
console.log(viaValue.length);
