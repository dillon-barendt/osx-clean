# Scanner performance

The filesystem and duplicate-scanning patch keeps existing category thresholds,
path restrictions, whitelist semantics, skip names, result fields, and exact
SHA-256 duplicate verification. Deletion and API code are unchanged.

## Changes

- Normalize duplicate root paths and deduplicate discovered directory aliases by
  device/inode, falling back to real paths when a filesystem has no usable inode.
- Track visited directories across roots. Parent/child roots remain valid, and
  an explicit root inside an otherwise skipped directory is still scanned.
  Aliases use one representative path; separate hard-linked files remain visible.
- Stream directory entries using `opendir` and an iterative depth-first stack.
  Do not queue every descendant directory or create a promise for every file.
- Start with two file workers, increase to at most eight on fast operations,
  and reduce concurrency on slow operations. Hashing uses the same pool with a
  ceiling of four. Explicit walker concurrency is clamped to 1–8.
- Check each candidate's path policy once before file stats. Excluded directories
  are pruned before traversal. Visited tracking avoids a separate file-wide
  path-decision cache.
- Rate-limit scanner progress to at most one callback per 100 ms.
- Build size buckets directly during discovery, release unique-size metadata
  before hashing, and process one size bucket/prefix group at a time. Do not retain
  parallel full-scan candidate, prefix-result, and full-hash-result arrays.
- Compare the first 16 KiB, then (for matching candidates larger than 32 KiB)
  the last 16 KiB before full hashing. Samples only eliminate candidates; matching
  samples still require a full SHA-256 digest. Files up to 16 KiB are read in full
  during the prefix pass, including retries after short reads.
- Reduce full-read buffers from 1 MiB to 64 KiB. Cancellation drains pending work
  and closes directory iterators/streams before returning.

The public `walkFilesFast()` API still returns an array. Result memory and the
visited-directory set therefore grow with scan size; directory handles and entry
buffers follow DFS depth. This patch bounds pending work, rather than promising
constant total memory. True duplicates still require reading all their bytes.
Tail sampling adds a small read for matching large-file prefixes, which trades
some overhead on true duplicates for fewer full reads of unrelated common-header
files.

## Reproducible checks and measured work

```bash
pnpm run build
node --test tests/scanner-performance.test.js
```

Measurements on temporary fixtures on 2026-10-24:

| Fixture / work | Before | After |
| --- | ---: | ---: |
| 256-file directory supplied through eight repeated roots: reported files | 2,048 (repeated) | 256 |
| Same fixture: `lstat` calls | 2,056 | 257 |
| Same fixture: peak concurrent `lstat` operations | 2,048 | 8 |
| Same fixture: progress callbacks | 8 | 1 |
| Sixteen 1 MiB files sharing a header: full-file streams | 16 | 3 |
| Same fixture: bytes read through full-file streams | 16 MiB | 3 MiB |

The common-header fixture includes two true copies and a third file with matching
prefix and tail but different middle bytes. Only the two true copies are returned.
Including sample reads, content I/O in that fixture falls from 16.25 MiB to
3.5 MiB. Configured full-hash buffer capacity falls from eight 1 MiB streams
to at most four 64 KiB streams (8 MiB to 256 KiB, excluding stream/runtime overhead).

Tests also simulate slow stats to verify adaptive backoff, force short reads,
check alias deduplication and hard links, preserve explicit skipped-directory roots,
and verify cancellation. Counts describe work and bounded resource demand; they
are not a claim of a universal wall-clock speedup or a benchmark of a live network
mount/cloud provider. Unreadable or unstable files remain subject to live filesystem
conditions.
