// Each wrapper compares raw bits or the spec's permitted NaN class inside WASM.
// Vectors never pass through JavaScript values.
export function run(modules, tests) {
  const imports = {};
  const instances = modules.map((pair) => {
    const source = new WebAssembly.Instance(
      new WebAssembly.Module(Buffer.from(pair[0], "base64")),
      imports,
    );
    for (const name of pair[2]) imports[name] = source.exports;
    if (pair[1] === null) return source;
    return new WebAssembly.Instance(new WebAssembly.Module(Buffer.from(pair[1], "base64")), {
      m: source.exports,
    });
  });
  for (const test of tests) {
    let trapped = false;
    let value = 0;
    try {
      value = instances[test[0]].exports["t" + test[1]]();
    } catch (error) {
      if (!(error instanceof WebAssembly.RuntimeError)) throw error;
      trapped = true;
    }
    if (test[2] ? !trapped : trapped || value !== 1)
      throw new Error("SIMD assertion failed at " + test[3]);
  }
  console.log("passed", tests.length);
}
