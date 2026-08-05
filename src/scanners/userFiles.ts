import crypto from "node:crypto";
import path from "node:path";
import {createReadStream} from "node:fs";

import {checkPathAllowed} from "../security.js";
import {lstatSafe, readdirSafe} from "../fswalk.js";
import {toItem} from "./common.js";
import type {Category, ScanContext, ScanItem} from "./types.js";

const home = (ctx: ScanContext, ...parts: string[]) => path.join(ctx.home, ...parts);

async function walkFiles(root: string, signal: AbortSignal, out: string[] = []): Promise<string[]> {
  if (signal.aborted) return out;
  const stat = await lstatSafe(root);
  if (!stat || stat.kind === "symlink") return out;
  if (stat.kind === "file") {
    out.push(root);
    return out;
  }
  for (const entry of await readdirSafe(root)) {
    await walkFiles(path.join(root, entry.name), signal, out);
  }
  return out;
}

function isOldEnough(mtime: number | null, cutoffMs: number): boolean {
  return mtime !== null && mtime <= cutoffMs;
}

async function fingerprint(file: string): Promise<string | null> {
  try {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(file, { highWaterMark: 1024 * 1024 });
    for await (const chunk of stream) hash.update(chunk as Buffer);
    return hash.digest("hex");
  } catch {
    return null;
  }
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
  description: "Large files scattered through your home folder.",
  warning: "Check whether the file is still needed before deleting it.",
  scan: async (ctx) => {
    const minBytes = ctx.options.largeFileMinMB * 1024 * 1024;
    const roots = [home(ctx, "Desktop"), home(ctx, "Documents"), home(ctx, "Downloads")];
    const files = (await Promise.all(roots.map((root) => walkFiles(root, ctx.signal)))).flat();
    const items: ScanItem[] = [];
    for (const file of files) {
      if (!checkPathAllowed(file, ctx.options.whitelist).allowed) continue;
      const st = await lstatSafe(file);
      if (!st || st.kind !== "file" || st.size < minBytes) continue;
      items.push(toItem(file, "file", st.size, st.mtime, st.atime));
    }
    return items.sort((a, b) => b.size - a.size);
  },
};

export const duplicates: Category = {
  id: "duplicates",
  label: "Duplicate files",
  group: "risky",
  description: "Potential duplicate files in common user folders.",
  warning: "This is a conservative name-and-size duplicate pass, not a byte-for-byte dedupe tool.",
  scan: async (ctx) => {
    const roots = [home(ctx, "Desktop"), home(ctx, "Documents"), home(ctx, "Downloads")];
    const files = (await Promise.all(roots.map((root) => walkFiles(root, ctx.signal)))).flat();
    const candidates: { item: ScanItem; file: string }[] = [];
    for (const file of files) {
      if (!checkPathAllowed(file, ctx.options.whitelist).allowed) continue;
      const st = await lstatSafe(file);
      if (!st || st.kind !== "file" || st.size < ctx.options.duplicatesMinMB * 1024 * 1024) continue;
      candidates.push({ item: toItem(file, "file", st.size, st.mtime, st.atime), file });
    }

    const buckets = new Map<string, ScanItem[]>();
    for (const { item, file } of candidates) {
      const hash = await fingerprint(file);
      if (!hash) continue;
      const key = `${item.size}:${hash}`;
      const group = buckets.get(key) ?? [];
      group.push({
        ...item,
        groupKey: key,
        groupLabel: `${path.basename(file)} · ${hash.slice(0, 8)}`,
      });
      buckets.set(key, group);
    }

    return [...buckets.values()]
      .filter((group) => group.length > 1)
      .flat()
      .sort((a, b) => b.size - a.size);
  },
};
