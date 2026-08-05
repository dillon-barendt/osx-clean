import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { duplicates } from "../dist/scanners/userFiles.js";
import { checkPathAllowed, validateForDeletion } from "../dist/security.js";

test("duplicate scanner describes content-hash matching", () => {
  assert.match(duplicates.description, /exact/i);
  assert.match(duplicates.warning ?? "", /SHA-256/i);
});

test("deletion rules protect temp roots but allow scanned children", async () => {
  const tempRoots = [
    "/tmp",
    "/private/tmp",
    "/var/tmp",
    "/private/var/tmp",
    "/var/folders",
    "/private/var/folders",
  ];
  assert.deepEqual(
    tempRoots.map((root) => checkPathAllowed(root).allowed),
    tempRoots.map(() => false),
  );

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "osx-clean-security-"));
  const file = path.join(root, "scanned.txt");
  await fs.writeFile(file, "reviewed by the scanner", "utf8");

  try {
    assert.equal((await validateForDeletion(file, new Set([file]))).allowed, true);
    assert.equal((await validateForDeletion(file, new Set())).allowed, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("duplicate scanner excludes same-size files with different contents", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "osx-clean-duplicates-"));
  await Promise.all(
    ["Desktop", "Documents", "Downloads"].map((dir) =>
      fs.mkdir(path.join(root, dir), { recursive: true }),
    ),
  );

  const matching = "same bytes, verified by sha256";
  const different = "different".padEnd(matching.length, "!");
  await fs.writeFile(path.join(root, "Desktop", "first.txt"), matching, "utf8");
  await fs.writeFile(path.join(root, "Documents", "second.txt"), matching, "utf8");
  await fs.writeFile(path.join(root, "Downloads", "same-size-different.txt"), different, "utf8");

  try {
    const results = await duplicates.scan({
      home: root,
      options: {
        downloadsDaysOld: 30,
        recentlyAccessedDays: 7,
        largeFileMinMB: 200,
        largeFolderMinMB: 300,
        duplicatesMinMB: 0,
        minItemMB: 0,
        whitelist: [],
      },
      onProgress: () => {},
      signal: new AbortController().signal,
    });

    assert.deepEqual(
      results.map((item) => path.basename(item.path)).sort(),
      ["first.txt", "second.txt"],
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
