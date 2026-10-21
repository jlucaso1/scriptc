import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { compile } from "@scriptc/compiler";

const exec = promisify(execFile);

// Root bypasses directory access checks. Exercise the host's ordinary user
// rather than changing credentials or weakening the permission assertion.
test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "fs.promises.rm removes unreadable empty directories without retry options",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "scriptc-rm-permissions-"));
    const target = join(dir, "target");
    try {
      const entry = join(dir, "main.ts");
      // Keep this program free of application arrays and synchronous fs calls:
      // the promise wrapper must link everything its recursive walk needs.
      await writeFile(
        entry,
        `
        import { rm } from "node:fs/promises";
        const path = process.env["RM_TARGET"]!;
        try {
          const pending = process.env["RM_FORCE"] === "1"
            ? rm(path, { recursive: true, force: true })
            : rm(path, { recursive: true });
          console.log("promise returned");
          await pending;
          console.log("removed");
        } catch (error) {
          if (error instanceof Error) {
            const err = error as NodeJS.ErrnoException;
            console.log("rejected", err.code, err.syscall);
          }
        }
      `,
      );
      const result = await compile(entry, {
        backend: "llvm",
        outDir: dir,
        outPath: join(dir, "program"),
        sanitize: process.env["SCRIPTC_SAN"] === "1",
      });
      expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
      if (!result.ok) return;
      for (const nonempty of [false, true]) {
        for (const force of [false, true]) {
          for (const [command, args] of [
            [process.execPath, [entry]],
            [result.binaryPath, []],
          ] as const) {
            await mkdir(target);
            if (nonempty) await writeFile(join(target, "child"), "keep");
            await chmod(target, 0);
            try {
              const { stdout, stderr } = await exec(command, [...args], {
                env: { ...process.env, RM_TARGET: target, RM_FORCE: force ? "1" : "0" },
              });
              expect(stderr).toBe("");
              expect(stdout, `${command}: nonempty=${nonempty}, force=${force}`).toBe(
                `promise returned\n${nonempty ? "rejected EACCES scandir" : "removed"}\n`,
              );
              if (nonempty) expect((await stat(target)).isDirectory()).toBe(true);
              else await expect(stat(target)).rejects.toMatchObject({ code: "ENOENT" });
            } finally {
              await chmod(target, 0o700).catch((error: NodeJS.ErrnoException) => {
                if (error.code !== "ENOENT") throw error;
              });
              await rm(target, { recursive: true, force: true });
            }
          }
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  120_000,
);
