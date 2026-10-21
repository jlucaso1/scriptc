import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { compile } from "@scriptc/compiler";

const exec = promisify(execFile);

// ASan owns libc interposition in the sanitized lane. The differential corpus
// covers the promise wrappers there without the preload shim.
test.skipIf(process.platform !== "linux" || process.env["SCRIPTC_SAN"] === "1")(
  "fs.promises.rm retries EBUSY and rejects after the retry budget",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "scriptc-rm-retry-"));
    try {
      const entry = join(dir, "main.ts");
      await writeFile(
        entry,
        `
        import { writeFileSync, existsSync } from "node:fs";
        import { rm } from "node:fs/promises";
        const path = process.env["RM_TARGET"]!;
        writeFileSync(path, "keep");
        try {
          const pending = process.env["RM_RECURSIVE"] === "0"
            ? rm(path, { recursive: false, maxRetries: 2, retryDelay: 0 })
            : rm(path, { recursive: true, maxRetries: 2, retryDelay: 0 });
          console.log("promise returned");
          await pending;
          console.log("removed", !existsSync(path));
        } catch (error) {
          if (error instanceof Error) {
            const err = error as NodeJS.ErrnoException;
            console.log("rejected", err.code, err.syscall === "unlink", err.path === path, existsSync(path));
          }
        }
      `,
      );
      const result = await compile(entry, {
        backend: "llvm",
        outDir: dir,
        outPath: join(dir, "program"),
      });
      expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
      if (!result.ok) return;
      const shim = join(dir, "busy.c");
      const library = join(dir, "busy.so");
      await writeFile(
        shim,
        `
        #define _GNU_SOURCE
        #include <dlfcn.h>
        #include <errno.h>
        #include <stdio.h>
        #include <stdlib.h>
        #include <string.h>
        static int attempts;
        int unlink(const char *path) {
          static int (*real_unlink)(const char *);
          if (!real_unlink) real_unlink = dlsym(RTLD_NEXT, "unlink");
          const char *target = getenv("RM_TARGET");
          if (target && strcmp(path, target) == 0) {
            attempts++;
            if (attempts <= atoi(getenv("RM_BUSY_COUNT"))) { const char *kind = getenv("RM_NONRETRYABLE"); errno = kind && strcmp(kind, "1") == 0 ? EACCES : EBUSY; return -1; }
          }
          return real_unlink(path);
        }
        __attribute__((destructor)) static void report(void) { fprintf(stderr, "attempts=%d\\n", attempts); }
      `,
      );
      await exec("clang", ["-shared", "-fPIC", shim, "-ldl", "-o", library]);
      for (const [busy, recursive, nonretryable, attempts, expected] of [
        ["2", "1", "", "3", "removed true"],
        ["3", "1", "", "3", "rejected EBUSY true true true"],
        ["2", "0", "", "3", "removed true"],
        ["2", "1", "1", "1", "rejected EACCES true true true"],
      ]) {
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          LD_PRELOAD: library,
          RM_TARGET: join(dir, "target"),
          RM_BUSY_COUNT: busy,
          RM_RECURSIVE: recursive,
          RM_NONRETRYABLE: nonretryable,
        };
        for (const command of [
          [process.execPath, [entry]],
          [result.binaryPath, []],
        ] as const) {
          const { stdout, stderr } = await exec(command[0], [...command[1]], { env });
          expect(stdout).toBe(`promise returned\n${expected}\n`);
          expect(stderr).toBe(`attempts=${attempts}\n`);
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
