// A binding can fail after registry construction but before its WASM loads.
const registry = new FinalizationRegistry(() => {});
void registry;
throw new SyntaxError("binding initialization failed");
