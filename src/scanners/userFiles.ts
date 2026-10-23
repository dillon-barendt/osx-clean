import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import {createReadStream, promises as fsp} from "node:fs";

import {checkPathAllowed, isWhitelisted} from "../security.js";
import {lstatSafe, readdirSafe} from "../fswalk.js";
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

export async function discoverScanRoots(
    ctx: ScanContext,
    opts: { volumesDir?: string; usersDir?: string } = {},
): Promise<string[]> {
    const roots: string[] = [];
    const seen = new Set<string>();

    const addRoot = (p: string) => {
        const norm = path.normalize(p);
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
                        if (cse.isDirectory() && !cse.isSymbolicLink()) {
                            addRoot(path.join(cs, cse.name));
                        }
                    }
                    // Discover Mobile Documents (iCloud Drive)
                    const md = path.join(full, "Mobile Documents");
                    for (const mde of await readdirSafe(md)) {
                        if (mde.isDirectory() && !mde.isSymbolicLink()) {
                            addRoot(path.join(md, mde.name));
                        }
                    }
                    continue;
                }

                // Skip package/tool cache dot-directories
                if (entry.name.startsWith(".") && DEFAULT_SKIP_DIR_NAMES.has(entry.name)) {
                    continue;
                }

                addRoot(full);
            } else if (entry.isFile()) {
                addRoot(full);
            }
        }
    } catch {
    }

    // 2. Mounted Volumes: /Volumes/* (Mountain Duck, Google Drive, Proton Drive, external drives, USBs)
    const volumesDir = opts.volumesDir ?? (ctx.home === os.homedir() ? "/Volumes" : null);
    if (volumesDir) {
        try {
            const volEntries = await readdirSafe(volumesDir);
            for (const entry of volEntries) {
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
                addRoot(full);
            }
        } catch {
        }
    }

    // 3. Multi-User & Shared Folders: /Users/Shared and other user profiles
    const usersDir = opts.usersDir ?? (ctx.home === os.homedir() ? "/Users" : null);
    if (usersDir) {
        try {
            const usersEntries = await readdirSafe(usersDir);
            for (const entry of usersEntries) {
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
                addRoot(full);
            }
        } catch {
        }
    }

    // Fallback if no roots found
    if (roots.length === 0) {
        roots.push(ctx.home);
    }

    return roots;
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
    const minBytes = opts.minBytes ?? 0;
    const whitelist = opts.whitelist ?? [];
    const signal = opts.signal;
    const concurrency = opts.concurrency ?? 32;
    const skipDirs = opts.skipDirs ?? DEFAULT_SKIP_DIR_NAMES;

    const results: DiscoveredFile[] = [];
    const dirQueue: string[] = [];

    for (const root of roots) {
        if (signal?.aborted) return results;
        const st = await lstatSafe(root);
        if (!st || st.kind === "symlink") continue;
        if (st.kind === "file") {
            if (st.size >= minBytes && checkPathAllowed(root, whitelist).allowed) {
                results.push({item: toItem(root, "file", st.size, st.mtime, st.atime), file: root});
            }
        } else if (st.kind === "dir") {
            if (!isWhitelisted(root, whitelist)) {
                dirQueue.push(root);
            }
        }
    }

    if (dirQueue.length === 0) return results;

    let activeWorkers = 0;

    return new Promise((resolve) => {
        function dispatch() {
            if (signal?.aborted) return resolve(results);
            if (dirQueue.length === 0 && activeWorkers === 0) return resolve(results);

            while (dirQueue.length > 0 && activeWorkers < concurrency) {
                const dir = dirQueue.shift()!;
                activeWorkers++;
                opts.onProgress?.(dir);

                readdirSafe(dir)
                    .then(async (entries) => {
                        if (signal?.aborted) return;
                        const filesToStat: string[] = [];

                        for (const entry of entries) {
                            if (entry.name === ".DS_Store" || entry.isSymbolicLink()) continue;
                            if (skipDirs.has(entry.name)) continue;
                            const full = path.join(dir, entry.name);
                            if (isWhitelisted(full, whitelist)) continue;

                            if (entry.isDirectory()) {
                                dirQueue.push(full);
                            } else if (entry.isFile()) {
                                filesToStat.push(full);
                            }
                        }

                        if (filesToStat.length > 0) {
                            await Promise.all(
                                filesToStat.map(async (file) => {
                                    if (signal?.aborted) return;
                                    const st = await lstatSafe(file);
                                    if (
                                        st &&
                                        st.kind === "file" &&
                                        st.size >= minBytes &&
                                        checkPathAllowed(file, whitelist).allowed
                                    ) {
                                        results.push({
                                            item: toItem(file, "file", st.size, st.mtime, st.atime),
                                            file,
                                        });
                                    }
                                }),
                            );
                        }
                    })
                    .catch(() => {
                    })
                    .finally(() => {
                        activeWorkers--;
                        dispatch();
                    });
            }
        }

        dispatch();
    });
}

function isOldEnough(mtime: number | null, cutoffMs: number): boolean {
  return mtime !== null && mtime <= cutoffMs;
}

const PREFIX_BYTES = 16384;

async function prefixFingerprint(
    file: string,
    fileSize: number,
    bytes = PREFIX_BYTES,
): Promise<{ hash: string; isFull: boolean } | null> {
    let fh: fsp.FileHandle | null = null;
  try {
      fh = await fsp.open(file, "r");
      const readLen = Math.min(bytes, fileSize);
      const buf = Buffer.allocUnsafe(readLen);
      const {bytesRead} = await fh.read(buf, 0, readLen, 0);
      const hash = crypto.createHash("sha256").update(buf.subarray(0, bytesRead)).digest("hex");
      return {hash, isFull: fileSize <= bytes};
  } catch {
    return null;
  } finally {
      if (fh) await fh.close().catch(() => {
      });
  }
}

async function fingerprint(file: string, signal?: AbortSignal): Promise<string | null> {
    if (signal?.aborted) return null;
    return new Promise((resolve) => {
        let resolved = false;
        const hash = crypto.createHash("sha256");
        const stream = createReadStream(file, {highWaterMark: 1024 * 1024});

        const onAbort = () => {
            if (!resolved) {
                resolved = true;
                stream.destroy();
                resolve(null);
            }
        };
        signal?.addEventListener("abort", onAbort, {once: true});

        stream.on("data", (chunk) => {
            hash.update(chunk);
        });
        stream.on("end", () => {
            if (!resolved) {
                resolved = true;
                signal?.removeEventListener("abort", onAbort);
                resolve(hash.digest("hex"));
            }
        });
        stream.on("error", () => {
            if (!resolved) {
                resolved = true;
                signal?.removeEventListener("abort", onAbort);
                resolve(null);
            }
        });
    });
}

async function pool<T, R>(
    items: T[],
    concurrency: number,
    signal: AbortSignal | undefined,
    fn: (item: T) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;
    const workers = Array.from({length: Math.min(concurrency, items.length)}, async () => {
        while (cursor < items.length) {
            if (signal?.aborted) break;
            const idx = cursor++;
            const item = items[idx];
            if (item !== undefined) {
                results[idx] = await fn(item);
            }
        }
    });
    await Promise.all(workers);
    return results;
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
      const candidates = await walkFilesFast(roots, {
          minBytes,
          whitelist: ctx.options.whitelist,
          signal: ctx.signal,
          onProgress: ctx.onProgress,
      });

      if (ctx.signal.aborted || candidates.length === 0) return [];

      // Step 1: Bucket by exact file size
      const sizeBuckets = new Map<number, DiscoveredFile[]>();
      for (const c of candidates) {
          const list = sizeBuckets.get(c.item.size);
          if (list) list.push(c);
          else sizeBuckets.set(c.item.size, [c]);
      }

      const potentialDupes: DiscoveredFile[] = [];
      for (const list of sizeBuckets.values()) {
          if (list.length > 1) potentialDupes.push(...list);
      }
      if (potentialDupes.length === 0) return [];

      // Step 2: Compute prefix hashes in parallel for files sharing sizes
      const prefixResults = await pool(potentialDupes, 16, ctx.signal, async (c) => {
          ctx.onProgress(c.file);
          const res = await prefixFingerprint(c.file, c.item.size);
          return {c, ...res};
      });

      if (ctx.signal.aborted) return [];

      // Group by size + prefixHash
      const prefixBuckets = new Map<string, typeof prefixResults>();
      for (const item of prefixResults) {
          if (!item.hash) continue;
          const key = `${item.c.item.size}:${item.hash}`;
          const list = prefixBuckets.get(key) ?? [];
          list.push(item);
          prefixBuckets.set(key, list);
      }

      const needFullHash: DiscoveredFile[] = [];
      const finalHashed: { c: DiscoveredFile; fullHash: string }[] = [];

      for (const list of prefixBuckets.values()) {
          if (list.length <= 1) continue;
          for (const item of list) {
              if (item.isFull && item.hash) {
                  finalHashed.push({c: item.c, fullHash: item.hash});
              } else {
                  needFullHash.push(item.c);
              }
          }
    }

      // Step 3: Compute full SHA-256 hash in parallel for candidates requiring full pass
      if (needFullHash.length > 0 && !ctx.signal.aborted) {
          const fullResults = await pool(needFullHash, 8, ctx.signal, async (c) => {
              ctx.onProgress(c.file);
              const fullHash = await fingerprint(c.file, ctx.signal);
              return {c, fullHash};
          });
          for (const item of fullResults) {
              if (item.fullHash) {
                  finalHashed.push({c: item.c, fullHash: item.fullHash});
              }
          }
      }

      if (ctx.signal.aborted) return [];

      // Step 4: Final grouping by size + full SHA-256 content hash
      const finalBuckets = new Map<string, ScanItem[]>();
      for (const {c, fullHash} of finalHashed) {
          const key = `${c.item.size}:${fullHash}`;
          const group = finalBuckets.get(key) ?? [];
      group.push({
          ...c.item,
        groupKey: key,
          groupLabel: `${path.basename(c.file)} · ${fullHash.slice(0, 8)}`,
      });
          finalBuckets.set(key, group);
    }

      const duplicateGroups = [...finalBuckets.values()]
      .filter((group) => group.length > 1)
          .sort((a, b) => (b[0]?.size ?? 0) - (a[0]?.size ?? 0));

      return duplicateGroups.flat();
  },
};
