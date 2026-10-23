// String-literal RHS keys are supported; other CallPrinter forms keep their fences.
function unsupported(table: any, key: string): void {
  const { first } = table[key + "suffix"];
  const { second } = table?.["a.b"];
  const { third } = table[`a.b`];
  console.log(first, second, third);
}
unsupported({}, "a");
