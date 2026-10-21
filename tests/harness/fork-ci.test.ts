import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { expect, test } from "vitest";

const read = (name: string) =>
  load(
    readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), "utf8"),
  ) as any;
const fork = read("fork-native");
const full = read("ci");
const branches = [
  "fix/wasm-known-rejection",
  "fix/read-file-sync-url",
  "fix/fs-promises-rm-options",
];
const evaluate = (expression: string, github: object) =>
  Function(
    "github",
    "contains",
    "fromJSON",
    "always",
    `return (${expression.replace(/^\$\{\{ | \}\}$/g, "")})`,
  )(
    github,
    (items: string[], item: string) => items.includes(item),
    JSON.parse,
    () => true,
  );

test("fork jobs are restricted to the three same-repository branches", () => {
  for (const repository of ["jlucaso1/scriptc", "vercel-labs/scriptc", "other/scriptc"])
    for (const ref_name of [...branches, "main", "unrelated"])
      for (const event_name of ["push", "pull_request"]) {
        const github = {
          repository,
          ref_name,
          head_ref: event_name === "pull_request" ? ref_name : "",
          event_name,
          event: { pull_request: { head: { repo: { full_name: repository } } } },
        };
        const selected = repository === "jlucaso1/scriptc" && branches.includes(ref_name);
        expect(evaluate(fork.jobs.native.if, github)).toBe(selected);
        expect(evaluate(fork.jobs.wasm_windows.if, github)).toBe(
          selected && ref_name === branches[0],
        );
        expect(evaluate(full.jobs.validation_scope.if, github)).toBe(!selected);
        expect(evaluate(full.jobs.test.if, github)).toBe(!selected);
        github.event.pull_request.head.repo.full_name = "outside/scriptc";
        if (event_name === "pull_request")
          expect(evaluate(fork.jobs.native.if, github)).toBe(false);
      }
});

test("fork workflow uses read-only hosted runners and tests native success paths", () => {
  expect(fork.permissions).toEqual({ contents: "read" });
  expect(Object.keys(fork.on).sort()).toEqual(["pull_request", "push"]);
  expect(fork.on.push.branches).toEqual(branches);
  expect(fork.jobs.native.strategy.matrix.flavor).toEqual(["plain", "san"]);
  for (const job of Object.values(fork.jobs) as any[]) {
    expect(["ubuntu-24.04", "windows-2022"]).toContain(job["runs-on"]);
    const checkout = job.steps.find((step: any) => step.uses === "actions/checkout@v4");
    expect(checkout.with["persist-credentials"]).toBe(false);
    expect(checkout.with.ref).toBe("${{ github.event.pull_request.head.sha || github.sha }}");
    expect(JSON.stringify(job)).not.toMatch(
      /secrets\.|pull_request_target|vercel\.com|self-hosted/,
    );
  }
  const commands = JSON.stringify(fork.jobs.native.steps);
  expect(commands).toContain("tests/harness/llvm-differential.test.ts");
  expect(commands).toContain("tests/harness/differential.test.ts");
  expect(commands).toContain("pnpm -r build");
  expect(JSON.stringify(fork.jobs.wasm_windows.steps)).toContain(
    "tests/harness/wasm-rejection.test.ts",
  );
});
