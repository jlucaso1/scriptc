import {run} from "../../wasm-spec/simd-official-runner.mjs";
import {modules, tests} from "./data.mjs";
run(modules, tests);
