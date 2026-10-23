import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

import { discoverScanRoots, duplicates, largeFiles } from "../dist/scanners/userFiles.js";
import { checkPathAllowed, validateForDeletion } from "../dist/security.js";
import { deletePermanently, moveToTrash } from "../dist/trash.js";

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

test("duplicate scanner handles nested directories, multi-KB prefix collisions, and groups by size", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "osx-clean-dup-advanced-"));
  await fs.mkdir(path.join(root, "Documents/nested/deep"), { recursive: true });
  await fs.mkdir(path.join(root, "Desktop/sub"), { recursive: true });
  await fs.mkdir(path.join(root, "Downloads"), { recursive: true });

  // Group 1: 32 KB duplicates
  const bigData1 = "X".repeat(16384) + "1".repeat(16384);
  const bigData2 = "X".repeat(16384) + "2".repeat(16384); // same prefix, different suffix
  await fs.writeFile(path.join(root, "Documents/nested/deep/big1.bin"), bigData1);
  await fs.writeFile(path.join(root, "Desktop/sub/big2.bin"), bigData1);
  await fs.writeFile(path.join(root, "Downloads/big_diff_suffix.bin"), bigData2);

  // Group 2: Small duplicates (10 bytes)
  await fs.writeFile(path.join(root, "Documents/small1.txt"), "hello world");
  await fs.writeFile(path.join(root, "Downloads/small2.txt"), "hello world");

  // Unique size file
  await fs.writeFile(path.join(root, "Desktop/unique.txt"), "just a unique file");

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

    assert.equal(results.length, 4);
    // Larger files (32KB) come first
    assert.equal(path.basename(results[0].path).startsWith("big"), true);
    assert.equal(path.basename(results[1].path).startsWith("big"), true);
    assert.equal(results[0].groupKey, results[1].groupKey);

    // Smaller files come second
    assert.equal(path.basename(results[2].path).startsWith("small"), true);
    assert.equal(path.basename(results[3].path).startsWith("small"), true);
    assert.equal(results[2].groupKey, results[3].groupKey);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("duplicate scanner respects abort signal", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "osx-clean-dup-abort-"));
  await fs.mkdir(path.join(root, "Documents"), { recursive: true });
  await fs.writeFile(path.join(root, "Documents/a.txt"), "content");

  const controller = new AbortController();
  controller.abort();

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
      signal: controller.signal,
    });

    assert.deepEqual(results, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("largeFiles scanner uses fast walking and sorts by size", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "osx-clean-largefiles-"));
  await fs.mkdir(path.join(root, "Documents/sub"), { recursive: true });
  await fs.mkdir(path.join(root, "Desktop"), { recursive: true });
  await fs.mkdir(path.join(root, "Downloads"), { recursive: true });

  const mb = 1024 * 1024;
  await fs.writeFile(path.join(root, "Desktop/large1.bin"), Buffer.alloc(2 * mb));
  await fs.writeFile(path.join(root, "Documents/sub/large2.bin"), Buffer.alloc(4 * mb));
  await fs.writeFile(path.join(root, "Downloads/small.bin"), Buffer.alloc(100));

  try {
    const results = await largeFiles.scan({
      home: root,
      options: {
        downloadsDaysOld: 30,
        recentlyAccessedDays: 7,
        largeFileMinMB: 1, // 1 MB
        largeFolderMinMB: 300,
        duplicatesMinMB: 0,
        minItemMB: 0,
        whitelist: [],
      },
      onProgress: () => {},
      signal: new AbortController().signal,
    });

    assert.equal(results.length, 2);
    assert.equal(path.basename(results[0].path), "large2.bin");
    assert.equal(path.basename(results[1].path), "large1.bin");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("discoverScanRoots discovers custom folders, CloudStorage, and mounted volumes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "osx-clean-roots-"));
  const mockVols = await fs.mkdtemp(path.join(os.tmpdir(), "osx-clean-mockvols-"));
  const mockUsers = await fs.mkdtemp(path.join(os.tmpdir(), "osx-clean-mockusers-"));

  // 1. Home custom project and cloud directories
  await fs.mkdir(path.join(root, "03-Projects/my-app"), { recursive: true });
  await fs.mkdir(path.join(root, "Library/CloudStorage/ProtonDrive-user@proton.me-folder/Docs"), {
    recursive: true,
  });
  await fs.mkdir(path.join(root, "Library/CloudStorage/GoogleDrive-user@gmail.com/Drive"), {
    recursive: true,
  });
  await fs.mkdir(path.join(root, "Library/Mobile Documents/com~apple~CloudDocs/Notes"), {
    recursive: true,
  });
  // Package cache directory that should be skipped
  await fs.mkdir(path.join(root, ".cache/pip"), { recursive: true });

  // 2. Mounted volume directory
  await fs.mkdir(path.join(mockVols, "MountainDuck-S3"), { recursive: true });
  await fs.mkdir(path.join(mockVols, "Recovery"), { recursive: true }); // should be skipped

  // 3. Shared user folder
  await fs.mkdir(path.join(mockUsers, "Shared/PublicData"), { recursive: true });

  try {
    const scanRoots = await discoverScanRoots(
      {
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
      },
      {
        volumesDir: mockVols,
        usersDir: mockUsers,
      },
    );

    assert.equal(scanRoots.some((r) => r.includes("03-Projects")), true);
    assert.equal(scanRoots.some((r) => r.includes("ProtonDrive-user@proton.me-folder")), true);
    assert.equal(scanRoots.some((r) => r.includes("GoogleDrive-user@gmail.com")), true);
    assert.equal(scanRoots.some((r) => r.includes("com~apple~CloudDocs")), true);
    assert.equal(scanRoots.some((r) => r.includes("MountainDuck-S3")), true);
    assert.equal(scanRoots.some((r) => r.includes("Recovery")), false);
    assert.equal(scanRoots.some((r) => r.includes(".cache")), false);
    assert.equal(scanRoots.some((r) => r.includes("Shared")), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(mockVols, { recursive: true, force: true });
    await fs.rm(mockUsers, { recursive: true, force: true });
  }
});

test("duplicate scanner detects duplicates across custom project folders and cloud storage", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "osx-clean-dup-cloud-"));
  await fs.mkdir(path.join(root, "03-Projects/sub"), { recursive: true });
  await fs.mkdir(path.join(root, "Library/CloudStorage/ProtonDrive-user-folder/Files"), {
    recursive: true,
  });

  const content = "exact content synchronized across cloud storage and local project";
  await fs.writeFile(path.join(root, "03-Projects/sub/project-report.pdf"), content, "utf8");
  await fs.writeFile(
    path.join(root, "Library/CloudStorage/ProtonDrive-user-folder/Files/cloud-report.pdf"),
    content,
    "utf8",
  );

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

    assert.equal(results.length, 2);
    const names = results.map((r) => path.basename(r.path)).sort();
    assert.deepEqual(names, ["cloud-report.pdf", "project-report.pdf"]);
    assert.equal(results[0].groupKey, results[1].groupKey);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("security validation permits mounted volumes and cloud paths while protecting volume roots", () => {
  assert.equal(checkPathAllowed("/Volumes/GoogleDrive/My Drive/Report.pdf").allowed, true);
  assert.equal(checkPathAllowed("/Volumes/ProtonDrive/Files/Photo.jpg").allowed, true);
  assert.equal(checkPathAllowed("/Volumes/MountainDuck/Docs/Data.zip").allowed, true);
  assert.equal(checkPathAllowed("/Users/Shared/SharedVideo.mp4").allowed, true);
  assert.equal(checkPathAllowed("/Volumes/Recovery").allowed, false);
  assert.equal(checkPathAllowed("/Volumes").allowed, false);
  assert.equal(checkPathAllowed("/Users/Shared").allowed, false);
  assert.equal(checkPathAllowed("/System/Library/CoreServices/Finder.app").allowed, false);
  assert.equal(checkPathAllowed("/bin/bash").allowed, false);
  assert.equal(checkPathAllowed("/usr/bin/python3").allowed, false);
  assert.equal(checkPathAllowed("/Applications").allowed, false);
  assert.equal(checkPathAllowed("/Applications/Slack.app").allowed, true);
});

test("moveToTrash safely handles locked files and special character filenames", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "osx-clean-trash-locked-"));
  const testFile1 = path.join(root, "test_locked__tags[locked].png");
  const testFile2 = path.join(root, "test_readonly__tags[special].txt");

  await fs.writeFile(testFile1, "locked file content");
  await fs.writeFile(testFile2, "read-only file content");

  // Lock file1 with immutable flag and set file2 to read-only
  try {
    await execFileAsync("chflags", ["uchg", testFile1]);
  } catch {}
  await fs.chmod(testFile2, 0o400);

  try {
    const results = await moveToTrash([testFile1, testFile2]);
    assert.equal(results.length, 2);
    assert.equal(results[0].ok, true);
    assert.equal(results[1].ok, true);

    const exists1 = await fs.stat(testFile1).then(() => true).catch(() => false);
    const exists2 = await fs.stat(testFile2).then(() => true).catch(() => false);
    assert.equal(exists1, false);
    assert.equal(exists2, false);
  } finally {
    try {
      await execFileAsync("chflags", ["nouchg", testFile1]);
    } catch {}
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("deletePermanently safely handles locked and read-only files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "osx-clean-del-locked-"));
  const testFile1 = path.join(root, "perm_locked.bin");
  const testFile2 = path.join(root, "perm_readonly.bin");

  await fs.writeFile(testFile1, "perm locked file");
  await fs.writeFile(testFile2, "perm readonly file");

  try {
    await execFileAsync("chflags", ["uchg", testFile1]);
  } catch {}
  await fs.chmod(testFile2, 0o400);

  try {
    const results = await deletePermanently([testFile1, testFile2]);
    assert.equal(results.length, 2);
    assert.equal(results[0].ok, true);
    assert.equal(results[1].ok, true);

    const exists1 = await fs.stat(testFile1).then(() => true).catch(() => false);
    const exists2 = await fs.stat(testFile2).then(() => true).catch(() => false);
    assert.equal(exists1, false);
    assert.equal(exists2, false);
  } finally {
    try {
      await execFileAsync("chflags", ["nouchg", testFile1]);
    } catch {}
    await fs.rm(root, { recursive: true, force: true });
  }
});
