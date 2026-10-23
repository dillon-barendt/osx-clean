import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const execFileAsync = promisify(execFile);

const TRASH_SCRIPT = fileURLToPath(new URL("../scripts/trash-items.js", import.meta.url));

export interface ItemResult {
  path: string;
  ok: boolean;
  error?: string;
}

async function unlockPath(p: string): Promise<void> {
    try {
        await execFileAsync("chflags", ["nouchg,nouappnd", p]);
    } catch {
    }
    try {
        const st = await fs.lstat(p);
        const mode = st.mode & 0o777;
        if ((mode & 0o200) === 0) {
            await fs.chmod(p, mode | 0o200);
        }
    } catch {
    }
}

export async function moveToTrash(paths: string[]): Promise<ItemResult[]> {
  if (paths.length === 0) return [];

    // Unlock user immutable/append flags and ensure permissions before moving to trash
    await Promise.all(paths.map(unlockPath));

  const tmpFile = path.join(os.tmpdir(), `osx-clean-${crypto.randomUUID()}.json`);
  await fs.writeFile(tmpFile, JSON.stringify(paths), "utf8");
  try {
    const { stdout } = await execFileAsync(
      "osascript",
      ["-l", "JavaScript", TRASH_SCRIPT, tmpFile],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    return JSON.parse(stdout) as ItemResult[];
  } finally {
    await fs.rm(tmpFile, { force: true });
  }
}

export async function deletePermanently(paths: string[]): Promise<ItemResult[]> {
  return Promise.all(
    paths.map(async (p): Promise<ItemResult> => {
      try {
          try {
              await execFileAsync("chflags", ["-R", "nouchg,nouappnd", p]);
          } catch {
          }
          try {
              const st = await fs.lstat(p);
              const mode = st.mode & 0o777;
              if ((mode & 0o200) === 0) {
                  await fs.chmod(p, mode | 0o200);
              }
          } catch {
          }
        await fs.rm(p, { recursive: true, force: true });
        return { path: p, ok: true };
      } catch (err) {
        return { path: p, ok: false, error: (err as Error).message };
      }
    }),
  );
}
