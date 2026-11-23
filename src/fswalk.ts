import {type Dirent, promises as fs} from "node:fs";

export interface Stat {
  size: number;
  mtime: number | null;
    atime: number | null;
  kind: "file" | "dir" | "symlink";
  directoryId?: string;
}

export function isPermissionError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === "EACCES" || code === "EPERM";
}

export async function lstatSafe(p: string): Promise<Stat | null> {
  try {
    const st = await fs.lstat(p);
    const kind = st.isSymbolicLink() ? "symlink" : st.isDirectory() ? "dir" : "file";
      const directoryId = kind === "dir" && st.dev > 0 && st.ino > 0 && Number.isSafeInteger(st.ino) && Number.isSafeInteger(st.dev)
        ? `${st.dev}:${st.ino}` : undefined;
      return {size: st.size, mtime: st.mtimeMs, atime: st.atimeMs, kind, directoryId};
  } catch {
    return null;
  }
}

export async function readdirSafe(p: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(p, { withFileTypes: true });
  } catch {
    return [];
  }
}

export async function directoryIdentity(p: string, st: Stat): Promise<string> {
  if (st.directoryId) return st.directoryId;
  // Some network filesystems omit usable inode numbers.
  try { return await fs.realpath(p); }
  catch { return p; }
}

export async function* readDirectorySafe(p: string): AsyncGenerator<Dirent> {
  let dir;
  try { dir = await fs.opendir(p); }
  catch { return; }
  try {
    for await (const entry of dir) yield entry;
  } catch {
    // Match readdirSafe's treatment of vanished or inaccessible directories.
  }
}
