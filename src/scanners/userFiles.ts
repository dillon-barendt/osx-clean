import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import {createReadStream, promises as fsp, type Dirent} from "node:fs";

import {checkPathAllowed, isWhitelisted} from "../security.js";
import {directoryIdentity, lstatSafe, readDirectorySafe, readdirSafe, type Stat} from "../fswalk.js";
import {toItem} from "./common.js";
import type {Category, ScanContext, ScanItem} from "./types.js";

const home = (ctx: ScanContext, ...parts: string[]) => path.join(ctx.home, ...parts);

export const DEFAULT_SKIP_DIR_NAMES = new Set([
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    ".Trash",
    ".Trashes",
    ".Spotlight-V100",
    ".fseventsd",
    ".DocumentRevisions-V100",
    ".TemporaryItems",
    ".AppleDouble",
    ".vol",
    ".cache",
    ".npm",
    ".cargo",
    ".rustup",
    ".gradle",
    ".m2",
    ".bun",
    ".deno",
    ".cocoapods",
    ".swiftpm",
    ".venv",
    ".virtualenvs",
]);

export interface DiscoveredFile {
    item: ScanItem;
    file: string;
}

function normalizeRoot(p: string): string {
    const normalized = path.normalize(p);
    return normalized === path.parse(normalized).root ? normalized : normalized.replace(/\/$/, "");
}

function rateLimitedProgress(callback?: (value: string) => void): (value: string) => void {
    let next = 0;
    return (value) => {
        const now = performance.now();
        if (now < next) return;
        next = now + 100;
        callback?.(value);
    };
}

export async function discoverScanRoots(
    ctx: ScanContext,
    opts: { volumesDir?: string; usersDir?: string } = {},
): Promise<string[]> {
    if (ctx.signal.aborted) return [];
    const roots: string[] = [];
    const seen = new Set<string>();
    const directoryRoots = new Set<string>();

    const addRoot = (p: string, directory = false) => {
        const norm = normalizeRoot(p);
        if (directory) directoryRoots.add(norm);
        if (!seen.has(norm)) {
            seen.add(norm);
            roots.push(norm);
        }
    };

    // 1. Home directory scan:
    // Discover every user folder and file directly in ctx.home
    try {
        const homeEntries = await readdirSafe(ctx.home);
        for (const entry of homeEntries) {
            if (ctx.signal.aborted) return [];
            if (
                entry.name === ".DS_Store" ||
                entry.name === ".Trash" ||
                entry.name === ".git" ||
                entry.isSymbolicLink()
            ) {
                continue;
            }
            const full = path.join(ctx.home, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "Library") {
                    // Discover CloudStorage (Proton Drive, Google Drive, OneDrive, Dropbox, Box)
                    const cs = path.join(full, "CloudStorage");
                    for (const cse of await readdirSafe(cs)) {
                        if (ctx.signal.aborted) return [];
                        if (cse.isDirectory() && !cse.isSymbolicLink()) {
                            addRoot(path.join(cs, cse.name), true);
                        }
                    }
                    // Discover Mobile Documents (iCloud Drive)
                    const md = path.join(full, "Mobile Documents");
                    for (const mde of await readdirSafe(md)) {
                        if (ctx.signal.aborted) return [];
                        if (mde.isDirectory() && !mde.isSymbolicLink()) {
                            addRoot(path.join(md, mde.name), true);
                        }
                    }
                    continue;
                }

                // Skip package/tool cache dot-directories
                if (entry.name.startsWith(".") && DEFAULT_SKIP_DIR_NAMES.has(entry.name)) {
                    continue;
                }

                addRoot(full, true);
            } else if (entry.isFile()) {
                addRoot(full);
            }
        }
    } catch {
    }

    // 2. Mounted Volumes: /Volumes/* (Mountain Duck, Google Drive, Proton Drive, external drives, USBs)
    const volumesDir = opts.volumesDir ?? (ctx.home === os.homedir() ? "/Volumes" : null);
    if (volumesDir && !ctx.signal.aborted) {
        try {
            const volEntries = await readdirSafe(volumesDir);
            for (const entry of volEntries) {
                if (ctx.signal.aborted) return [];
                if (entry.name === "Recovery" || entry.name === ".DS_Store") continue;
                const full = path.join(volumesDir, entry.name);
                if (entry.isSymbolicLink()) {
                    const st = await lstatSafe(full);
                    if (!st) continue;
                    try {
                        const target = await fsp.realpath(full);
                        if (target === "/" || target === "") continue;
                    } catch {
                        continue;
                    }
                }
                addRoot(full, entry.isDirectory());
            }
        } catch {
        }
    }

    // 3. Multi-User & Shared Folders: /Users/Shared and other user profiles
    const usersDir = opts.usersDir ?? (ctx.home === os.homedir() ? "/Users" : null);
    if (usersDir && !ctx.signal.aborted) {
        try {
            const usersEntries = await readdirSafe(usersDir);
            for (const entry of usersEntries) {
                if (ctx.signal.aborted) return [];
                if (
                    entry.name === ".localized" ||
                    entry.name === "Guest" ||
                    entry.name === ".DS_Store" ||
                    entry.isSymbolicLink()
                ) {
                    continue;
                }
                const full = path.join(usersDir, entry.name);
                if (full === ctx.home) continue;
                addRoot(full, entry.isDirectory());
            }
        } catch {
        }
    }

    // Fallback if no roots found
    if (roots.length === 0) {
        addRoot(ctx.home, true);
    }

    const unique: string[] = [];
    const directories = new Set<string>();
    for (const root of roots) {
        if (ctx.signal.aborted) break;
        if (directoryRoots.has(root) && !isWhitelisted(root, ctx.options.whitelist)) {
            const st = await lstatSafe(root);
            if (st?.kind === "dir") {
                const key = await directoryIdentity(root, st);
                if (directories.has(key)) continue;
                directories.add(key);
            }
        }
        unique.push(root);
    }
    return unique;
}

export async function walkFilesFast(
    roots: string[],
    opts: {
        minBytes?: number;
        whitelist?: string[];
        signal?: AbortSignal;
        onProgress?: (dir: string) => void;
        concurrency?: number;
        skipDirs?: Set<string>;
    } = {},
): Promise<DiscoveredFile[]> {
    const results: DiscoveredFile[] = [];
    await scanFiles(roots, opts, (item) => { results.push({ item, file: item.path }); });
    return results;
}

type WalkOptions = NonNullable<Parameters<typeof walkFilesFast>[1]>;

async function scanFiles(roots: string[], opts: WalkOptions, onFile: (item: ScanItem) => void): Promise<void> {
    const whitelist = opts.whitelist ?? [];
    const signal = opts.signal;
    const skipDirs = opts.skipDirs ?? DEFAULT_SKIP_DIR_NAMES;
    const rootPaths = new Set(roots.map(normalizeRoot));
    const visited = new Set<string>();
    const emittedRoots = new Set<string>();
    const progress = rateLimitedProgress(opts.onProgress);

    async function* files(): AsyncGenerator<{ file: string; st?: Stat }> {
        for (const root of rootPaths) {
            if (signal?.aborted) return;
            const st = await lstatSafe(root);
            if (!st || st.kind === "symlink") continue;
            if (st.kind === "file") {
                if (!emittedRoots.has(root) && checkPathAllowed(root, whitelist).allowed) {
                    emittedRoots.add(root);
                    yield { file: root, st };
                }
                continue;
            }
            const stack: { dir: string; entries: AsyncGenerator<Dirent> }[] = [];
            async function enter(dir: string, stat?: Stat): Promise<void> {
                if (signal?.aborted || isWhitelisted(dir, whitelist)) return;
                const current = stat ?? await lstatSafe(dir);
                if (current?.kind !== "dir") return;
                const key = await directoryIdentity(dir, current);
                if (visited.has(key)) return;
                visited.add(key);
                progress(dir);
                if (!signal?.aborted) stack.push({ dir, entries: readDirectorySafe(dir) });
            }
            await enter(root, st);
            try {
                while (stack.length && !signal?.aborted) {
                    const frame = stack[stack.length - 1]!;
                    const next = await frame.entries.next();
                    if (next.done) { stack.pop(); continue; }
                    const entry = next.value;
                    if (entry.name === ".DS_Store" || entry.isSymbolicLink() || skipDirs.has(entry.name)) continue;
                    const full = path.join(frame.dir, entry.name);
                    if (entry.isDirectory()) {
                        await enter(full);
                    } else if (entry.isFile() && !emittedRoots.has(full) && checkPathAllowed(full, whitelist).allowed) {
                        if (rootPaths.has(full)) emittedRoots.add(full);
                        yield { file: full };
                    }
                }
            } finally {
                for (const frame of stack.reverse()) await frame.entries.return(undefined);
            }
        }
    }

    await pool(files(), opts.concurrency ?? 8, signal, async ({ file, st }) => {
        const current = st ?? await lstatSafe(file);
        if (!signal?.aborted && current?.kind === "file" && current.size >= (opts.minBytes ?? 0)) {
            onFile(toItem(file, "file", current.size, current.mtime, current.atime));
        }
    });
}

function isOldEnough(mtime: number | null, cutoffMs: number): boolean {
  return mtime !== null && mtime <= cutoffMs;
}

const PREFIX_BYTES = 16384;

async function prefixFingerprint(
    file: string,
    fileSize: number,
    signal?: AbortSignal,
    position = 0,
): Promise<string | null> {
    let fh: fsp.FileHandle | null = null;
  try {
      if (signal?.aborted) return null;
      fh = await fsp.open(file, "r");
      const readLen = Math.min(PREFIX_BYTES, fileSize - position);
      const buf = Buffer.allocUnsafe(readLen);
      let offset = 0;
      while (offset < readLen) {
          if (signal?.aborted) return null;
          const { bytesRead } = await fh.read(buf, offset, readLen - offset, position + offset);
          if (bytesRead === 0) return null;
          offset += bytesRead;
      }
      if (signal?.aborted || (await fh.stat()).size !== fileSize) return null;
      const hash = crypto.createHash("sha256").update(buf).digest("hex");
      return hash;
  } catch {
    return null;
  } finally {
      if (fh) await fh.close().catch(() => {
      });
  }
}

async function fingerprint(file: string, expectedSize: number, signal?: AbortSignal): Promise<string | null> {
    if (signal?.aborted) return null;
    try {
        const hash = crypto.createHash("sha256");
        let bytes = 0;
        const stream = createReadStream(file, { highWaterMark: 64 * 1024, signal });
        for await (const chunk of stream) {
            bytes += chunk.length;
            hash.update(chunk);
        }
        return !signal?.aborted && bytes === expectedSize ? hash.digest("hex") : null;
    } catch {
        return null;
    }
}

async function pool<T>(
    items: Iterable<T> | AsyncIterable<T>,
    concurrency: number,
    signal: AbortSignal | undefined,
    fn: (item: T) => Promise<void>,
): Promise<void> {
    const maximum = Number.isFinite(concurrency) ? Math.max(1, Math.min(8, Math.floor(concurrency))) : 8;
    let limit = Math.min(2, maximum);
    let elapsed = 0;
    let samples = 0;
    let failure: unknown;
    let failed = false;
    let notify: (() => void) | undefined;
    const pending = new Set<Promise<void>>();
    async function* source() { yield* items; }
    const iterator = source();
    try {
        while (!signal?.aborted && !failed) {
            while (pending.size >= limit) await new Promise<void>((resolve) => { notify = resolve; });
            if (signal?.aborted || failed) break;
            const next = await iterator.next();
            if (next.done || signal?.aborted) break;
            const start = performance.now();
            const task = fn(next.value).catch((error: unknown) => {
                failed = true;
                failure = error;
            }).finally(() => {
                pending.delete(task);
                notify?.();
                notify = undefined;
                elapsed += performance.now() - start;
                if (++samples === 8) {
                    const average = elapsed / samples;
                    if (average > 25) limit = Math.max(1, Math.floor(limit / 2));
                    else if (average < 8) limit = Math.min(maximum, limit + 1);
                    elapsed = 0;
                    samples = 0;
                }
            });
            pending.add(task);
        }
    } finally {
        await iterator.return();
        await Promise.all(pending);
    }
    if (failed) throw failure;
}

export const oldDownloads: Category = {
  id: "old-downloads",
  label: "Old downloads",
  group: "safe",
  description: "Files in Downloads that have not been modified recently.",
  scan: async (ctx) => {
    const dir = home(ctx, "Downloads");
    const cutoff = Date.now() - ctx.options.downloadsDaysOld * 24 * 60 * 60 * 1000;
    const recentlyAccessedCutoff =
      Date.now() - ctx.options.recentlyAccessedDays * 24 * 60 * 60 * 1000;
    const items: ScanItem[] = [];
    for (const entry of await readdirSafe(dir)) {
      const full = path.join(dir, entry.name);
      if (entry.name === ".DS_Store" || !checkPathAllowed(full, ctx.options.whitelist).allowed) {
        continue;
      }
      const st = await lstatSafe(full);
      if (!st || st.kind === "symlink") continue;
      if (!isOldEnough(st.mtime, cutoff)) continue;
      if (st.atime !== null && st.atime > recentlyAccessedCutoff) continue;
      const size = st.kind === "dir" ? 0 : st.size;
      items.push(toItem(full, st.kind, size, st.mtime, st.atime));
    }
    return items.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
  },
};

export const largeFiles: Category = {
  id: "large-files",
  label: "Large files",
  group: "moderate",
    description: "Large files scattered across user storage, mounted disks, and cloud drives.",
  warning: "Check whether the file is still needed before deleting it.",
  scan: async (ctx) => {
    const minBytes = ctx.options.largeFileMinMB * 1024 * 1024;
      const roots = await discoverScanRoots(ctx);
      const candidates = await walkFilesFast(roots, {
          minBytes,
          whitelist: ctx.options.whitelist,
          signal: ctx.signal,
          onProgress: ctx.onProgress,
      });
      return candidates.map((c) => c.item).sort((a, b) => b.size - a.size);
  },
};

export const duplicates: Category = {
  id: "duplicates",
  label: "Duplicate files",
  group: "risky",
    description: "Exact duplicate files across user storage, mounted disks, and cloud drives.",
  warning: "Matches file size and SHA-256 content; review every copy before removing it.",
  scan: async (ctx) => {
      const minBytes = ctx.options.duplicatesMinMB * 1024 * 1024;
      const roots = await discoverScanRoots(ctx);
      const progress = rateLimitedProgress(ctx.onProgress);
      const sizeBuckets = new Map<number, ScanItem | ScanItem[]>();
      await scanFiles(roots, {
          minBytes,
          whitelist: ctx.options.whitelist,
          signal: ctx.signal,
          onProgress: progress,
      }, (item) => {
          const previous = sizeBuckets.get(item.size);
          if (!previous) sizeBuckets.set(item.size, item);
          else if (Array.isArray(previous)) previous.push(item);
          else sizeBuckets.set(item.size, [previous, item]);
      });

      for (const [size, bucket] of sizeBuckets) {
          if (!Array.isArray(bucket)) sizeBuckets.delete(size);
      }

      const results: ScanItem[] = [];
      const addGroup = (items: ScanItem[], size: number, hash: string) => {
          if (items.length < 2) return;
          const groupKey = `${size}:${hash}`;
          for (const item of items) results.push({
              ...item, groupKey, groupLabel: `${item.name} · ${hash.slice(0, 8)}`,
          });
      };
      for (const [size, bucket] of sizeBuckets) {
          sizeBuckets.delete(size);
          if (ctx.signal.aborted) return [];
          if (!Array.isArray(bucket)) continue;
          const prefixes = new Map<string, ScanItem[]>();
          await pool(bucket, 4, ctx.signal, async (item) => {
              progress(item.path);
              const prefix = await prefixFingerprint(item.path, size, ctx.signal);
              if (!prefix) return;
              const group = prefixes.get(prefix);
              if (group) group.push(item);
              else prefixes.set(prefix, [item]);
          });
          bucket.length = 0;
          for (const [prefix, items] of prefixes) {
              prefixes.delete(prefix);
              if (ctx.signal.aborted) return [];
              if (items.length < 2) continue;
              if (size <= PREFIX_BYTES) {
                  addGroup(items, size, prefix);
                  continue;
              }
              const tails = new Map<string, ScanItem[]>();
              if (size > 2 * PREFIX_BYTES) {
                  // Common headers are cheap to match; a tail sample can avoid a full read.
                  await pool(items, 4, ctx.signal, async (item) => {
                      progress(item.path);
                      const tail = await prefixFingerprint(item.path, size, ctx.signal, size - PREFIX_BYTES);
                      if (!tail) return;
                      const group = tails.get(tail);
                      if (group) group.push(item);
                      else tails.set(tail, [item]);
                  });
                  items.length = 0;
              } else {
                  tails.set("", items);
              }
              for (const [tail, matches] of tails) {
                  tails.delete(tail);
                  if (ctx.signal.aborted) return [];
                  if (matches.length < 2) continue;
                  const hashes = new Map<string, ScanItem[]>();
                  await pool(matches, 4, ctx.signal, async (item) => {
                      progress(item.path);
                      const hash = await fingerprint(item.path, size, ctx.signal);
                      if (!hash) return;
                      const group = hashes.get(hash);
                      if (group) group.push(item);
                      else hashes.set(hash, [item]);
                  });
                  matches.length = 0;
                  for (const [hash, group] of hashes) addGroup(group, size, hash);
              }
          }
      }

      return ctx.signal.aborted ? [] : results.sort((a, b) => b.size - a.size);
  },
};
