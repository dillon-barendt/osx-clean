import assert from "node:assert/strict";
import nativeFs, { promises as fs } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { discoverScanRoots, walkFilesFast, duplicates } from "../dist/scanners/userFiles.js";
import { DEFAULT_OPTIONS } from "../dist/scanners/types.js";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "osx-clean-performance-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

function context(home, extra = {}) {
  return {
    home, options: { ...DEFAULT_OPTIONS, duplicatesMinMB: 0, whitelist: [] },
    signal: new AbortController().signal, onProgress: () => {}, ...extra,
  };
}

test("overlapping and normalized roots produce each file once, including explicit file roots", async (t) => {
  const root = await fixture(t);
  const child = path.join(root, "nested");
  await fs.mkdir(child);
  const file = path.join(child, "file.txt");
  await fs.writeFile(file, "content");
  const roots = [root, `${root}/`, path.join(root, "nested", ".."), child, file, file];
  const found = await walkFilesFast(roots);
  assert.deepEqual(found.map((c) => c.file), [file]);
});

test("physical directory aliases are visited once but distinct hard-linked files remain visible", async (t) => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, "actual/sub"), { recursive: true });
  await fs.symlink(path.join(root, "actual"), path.join(root, "alias"));
  const first = path.join(root, "actual/sub/a.txt");
  await fs.writeFile(first, "matching");
  await fs.link(first, path.join(root, "actual/sub/b.txt"));
  // A valid alias through a parent symlink must not duplicate the directory.
  const aliased = await walkFilesFast([path.join(root, "actual/sub"), path.join(root, "alias/sub")]);
  assert.equal(aliased.length, 2);
  assert.deepEqual(aliased.map((c) => path.basename(c.file)).sort(), ["a.txt", "b.txt"]);
});

test("explicit roots inside skipped directories remain scannable; exclusions and symlinks stay intact", async (t) => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, "node_modules"));
  await fs.mkdir(path.join(root, "excluded"));
  await fs.writeFile(path.join(root, "node_modules/explicit.txt"), "content");
  await fs.writeFile(path.join(root, "excluded/hidden.txt"), "content");
  await fs.writeFile(path.join(root, "keep.txt"), "content");
  await fs.writeFile(path.join(root, "omit.txt"), "content");
  await fs.symlink(root, path.join(root, "loop"));
  const found = await walkFilesFast([root, path.join(root, "node_modules")], {
    whitelist: [path.join(root, "excluded"), "omit.txt"],
  });
  assert.deepEqual(found.map((c) => path.basename(c.file)).sort(), ["explicit.txt", "keep.txt"]);
});

test("root discovery deduplicates aliases from independent sources", async (t) => {
  const root = await fixture(t);
  const home = path.join(root, "home");
  const volumes = path.join(root, "volumes");
  await fs.mkdir(path.join(home, "projects"), { recursive: true });
  await fs.mkdir(volumes);
  // Alias the source parent: the discovered root itself is still a directory.
  await fs.symlink(home, path.join(root, "users-alias"));
  const roots = await discoverScanRoots(context(home), {
    usersDir: path.join(root, "users-alias"), volumesDir: volumes,
  });
  const canonical = await Promise.all(roots.map((p) => fs.realpath(p)));
  assert.equal(new Set(canonical).size, canonical.length);
});

test("unusable device/inode values fall back to real paths without merging distinct roots", async (t) => {
  const root = await fixture(t);
  for (const name of ["one", "two"]) {
    await fs.mkdir(path.join(root, name));
    await fs.writeFile(path.join(root, name, `${name}.txt`), "content");
  }
  const original = fs.lstat;
  t.mock.method(fs, "lstat", async (...args) => {
    const stat = await original(...args);
    stat.dev = 0;
    stat.ino = 1;
    return stat;
  });
  const found = await walkFilesFast([path.join(root, "one"), path.join(root, "two")]);
  assert.deepEqual(found.map((f) => f.item.name).sort(), ["one.txt", "two.txt"]);
});

test("wide directories bound in-flight stats and coalesce progress updates", async (t) => {
  const root = await fixture(t);
  for (let i = 0; i < 256; i++) await fs.writeFile(path.join(root, `${i}.txt`), "data");
  const original = fs.lstat;
  let active = 0;
  let peak = 0;
  let calls = 0;
  t.mock.method(fs, "lstat", async (...args) => {
    active++;
    peak = Math.max(peak, active);
    calls++;
    try { await delay(1); return await original(...args); }
    finally { active--; }
  });
  let progress = 0;
  const found = await walkFilesFast(Array(8).fill(root), { onProgress: () => progress++ });
  console.log(`SCAN_WORK: files=${found.length} stats=${calls} peak=${peak} progress=${progress}`);
  assert.equal(found.length, 256);
  assert.ok(peak <= 8, `in-flight stats: ${peak}`);
  assert.ok(calls <= 258, `repeated stats: ${calls}`);
  assert.ok(progress <= 3, `progress callbacks: ${progress}`);
});

test("slow filesystem work reduces concurrency instead of keeping a saturated pool", async (t) => {
  const root = await fixture(t);
  for (let i = 0; i < 16; i++) await fs.writeFile(path.join(root, `${i}.txt`), "data");
  const original = fs.lstat;
  let active = 0;
  const starts = [];
  t.mock.method(fs, "lstat", async (...args) => {
    starts.push(++active);
    try { await delay(30); return await original(...args); }
    finally { active--; }
  });
  assert.equal((await walkFilesFast([root])).length, 16);
  assert.ok(Math.max(...starts) <= 2);
  assert.ok(starts.slice(11).every((count) => count === 1), starts.join(","));
});

test("short prefix reads are completed before accepting small files as exact duplicates", async (t) => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, "Documents"));
  for (const [name, content] of [["first", "abaaaa"], ["copy", "abaaaa"], ["different", "abbbbb"]]) {
    await fs.writeFile(path.join(root, "Documents", name), content);
  }
  const original = fs.open;
  t.mock.method(fs, "open", async (...args) => {
    const handle = await original(...args);
    const read = handle.read.bind(handle);
    t.mock.method(handle, "read", (buffer, offset, length, position) => read(buffer, offset, Math.min(length, 2), position));
    return handle;
  });
  const found = await duplicates.scan(context(root));
  assert.deepEqual(found.map((f) => f.name).sort(), ["copy", "first"]);
});

test("hashing keeps prefix handles bounded and excludes files with different prefixes", async (t) => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, "Documents"));
  for (let i = 0; i < 32; i++) {
    await fs.writeFile(path.join(root, "Documents", `${i}.bin`), Buffer.alloc(32 * 1024, i));
  }
  const original = fs.open;
  let active = 0;
  let peak = 0;
  let readBytes = 0;
  t.mock.method(fs, "open", async (...args) => {
    const handle = await original(...args);
    peak = Math.max(peak, ++active);
    const close = handle.close.bind(handle);
    const read = handle.read.bind(handle);
    t.mock.method(handle, "read", async (...readArgs) => {
      const result = await read(...readArgs);
      readBytes += result.bytesRead;
      return result;
    });
    t.mock.method(handle, "close", async () => {
      try { await close(); }
      finally { active--; }
    });
    return handle;
  });
  assert.deepEqual(await duplicates.scan(context(root)), []);
  assert.equal(active, 0);
  assert.ok(peak <= 4, `open prefix handles: ${peak}`);
  assert.equal(readBytes, 32 * 16 * 1024);
});

test("a tail sample trims common-header files but full hashes still reject middle-content collisions", async (t) => {
  const root = await fixture(t);
  const dir = path.join(root, "Documents");
  await fs.mkdir(dir);
  for (let i = 0; i < 16; i++) {
    const data = Buffer.alloc(1024 * 1024, 65);
    data.fill(i < 3 ? 1 : i, data.length - 16384);
    if (i === 2) data.fill(2, 16384, data.length - 16384);
    await fs.writeFile(path.join(dir, `${i}.bin`), data);
  }
  const original = nativeFs.createReadStream;
  const streamed = [];
  let fullBytes = 0;
  t.mock.method(nativeFs, "createReadStream", (file, options) => {
    streamed.push(path.basename(file));
    assert.ok(options.highWaterMark <= 64 * 1024);
    const stream = original(file, options);
    stream.on("data", (chunk) => { fullBytes += chunk.length; });
    return stream;
  });
  syncBuiltinESMExports();
  try {
    const found = await duplicates.scan(context(root));
    assert.deepEqual(found.map((f) => f.name).sort(), ["0.bin", "1.bin"]);
    console.log(`HASH_WORK: fullStreams=${streamed.length} fullBytes=${fullBytes}`);
    assert.deepEqual(streamed.sort(), ["0.bin", "1.bin", "2.bin"]);
    assert.equal(fullBytes, 3 * 1024 * 1024);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("cancellation drains pending work and stops progress after returning", async (t) => {
  const root = await fixture(t);
  for (let i = 0; i < 64; i++) await fs.writeFile(path.join(root, `${i}.txt`), "data");
  const controller = new AbortController();
  const original = fs.lstat;
  let active = 0;
  t.mock.method(fs, "lstat", async (...args) => {
    active++;
    try { await delay(2); return await original(...args); }
    finally { active--; }
  });
  let progress = 0;
  await walkFilesFast([root], { signal: controller.signal, onProgress: () => {
    progress++;
    controller.abort();
  } });
  assert.equal(active, 0);
  const atReturn = progress;
  await delay(10);
  assert.equal(progress, atReturn);
});

test("duplicate hashing rejects same-prefix collisions and handles empty and small files", async (t) => {
  const root = await fixture(t);
  const dir = path.join(root, "Documents");
  await fs.mkdir(dir);
  const prefix = Buffer.alloc(16 * 1024, 65);
  const contents = new Map([
    ["a.bin", Buffer.concat([prefix, Buffer.alloc(2048, 1)])],
    ["b.bin", Buffer.concat([prefix, Buffer.alloc(2048, 1)])],
    ["collision.bin", Buffer.concat([prefix, Buffer.alloc(2048, 2)])],
    ["different-prefix.bin", Buffer.alloc(18 * 1024, 3)],
    ["empty-a", Buffer.alloc(0)], ["empty-b", Buffer.alloc(0)],
    ["small-a", Buffer.from("same")], ["small-b", Buffer.from("same")],
    ["unique-size", Buffer.alloc(7)],
  ]);
  for (const [name, content] of contents) await fs.writeFile(path.join(dir, name), content);
  let progress = 0;
  const found = await duplicates.scan(context(root, { onProgress: () => progress++ }));
  assert.deepEqual(found.map((f) => f.name).sort(), ["a.bin", "b.bin", "empty-a", "empty-b", "small-a", "small-b"]);
  assert.ok(found.every((f) => f.groupKey && /^[0-9]+:[a-f0-9]{64}$/.test(f.groupKey)));
  assert.ok(progress <= 4, `progress callbacks: ${progress}`);
});
