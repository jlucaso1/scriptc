// String-literal RHS reads share the existing checked-dynamic destructuring path.
const events: any = {
  "a.b": { value: 1, nested: { count: 2 }, list: [3, 4, 5], extra: 6 },
  "a\nb": { value: 7 },
  'a"b': { value: 8 },
  "a\\b": { value: 9 },
  "": { value: 10 },
};
const { value } = events["a.b"];
console.log(value);
const { value: renamed, missing = 11, nested: { count }, ...rest } = events['a.b'];
console.log(renamed, missing, count, JSON.stringify(rest));
const { list: [head, absent = 12, ...tail] } = events["a.b"];
console.log(head, absent, tail);
const { value: newline } = events["a\nb"];
const { value: quote } = events['a"b'];
const { value: slash } = events["a\\b"];
const { value: unicode } = events["\u0061.b"];
const { value: empty } = events[""];
console.log(newline, quote, slash, unicode, empty);

let calls = 0;
let defaults = 0;
function source(): any {
  calls++;
  console.log("source", calls);
  return events;
}
function fallback(): number {
  defaults++;
  console.log("default", defaults);
  return 13;
}
const { value: found = fallback(), missing: filled = fallback(), extra } = source()["a.b"];
console.log(found, filled, extra, calls, defaults);

// Read the RHS once, then evaluate getters and lazy defaults in binding order.
const observed: any = {};
Object.defineProperty(observed, "first", { get() { console.log("get first"); return 14; } });
Object.defineProperty(observed, "missing", { get() { console.log("get missing"); return undefined; } });
Object.defineProperty(observed, "last", { get() { console.log("get last"); return 15; } });
const outer: any = {};
Object.defineProperty(outer, "payload", { get() { console.log("get payload"); return observed; } });
const { first: observedFirst, missing: observedDefault = fallback(), last: observedLast } = outer["payload"];
console.log(observedFirst, observedDefault, observedLast, defaults);

// Assignment uses the same source spelling helper as declarations.
let assigned: any;
({ value: assigned } = events["a.b"]);
console.log("assigned", assigned);

// A reduced event dispatcher consumer: nested payloads from an untyped table.
function dispatch(table: any): void {
  const { nested: { count = 0 }, list: [first, ...remaining] } = table["a.b"];
  console.log("dispatch", count, first, remaining);
}
dispatch(events);

// Error spelling uses decoded string text, including punctuation and escapes.
const absentSource: any = {};
for (const attempt of [
  () => { const { value } = absentSource["a.b"]; console.log(value); },
  () => { const { value } = absentSource["a\nb"]; console.log(value); },
  () => { const { value } = absentSource['a"b']; console.log(value); },
  () => { const { value } = absentSource["a\\b"]; console.log(value); },
  () => { const { value } = absentSource["\u0061"]; console.log(value); },
  () => { const {} = absentSource[""]; },
  () => { ({ value: assigned } = absentSource["a.b"]); },
  () => { const { value } = source()["not.found"]; console.log(value); },
]) {
  try { attempt(); } catch (e) { console.log(e instanceof TypeError, (e as Error).message); }
}
