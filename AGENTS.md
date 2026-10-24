<!-- Project-specific guidance for coding agents working in osx-clean. -->

# osx-clean Agent Guide

## Project purpose

`osx-clean` is a local-only macOS storage scanner and review UI. It is a
dependency-light TypeScript/Node service that discovers cleanup candidates,
shows their paths and sizes, and keeps destructive actions behind explicit
user review.

The safety boundary is the product boundary: preserve it in every change.
The service must remain loopback-only, token-authenticated, scan-provenance
aware, and conservative about filesystem paths. Moving an item to the macOS
Trash is the default recovery-friendly action; permanent deletion is a
separate, guarded action.

## Repository map

- `src/cli.ts` parses CLI options, starts the service on `127.0.0.1`, and opens
  the tokenized browser URL.
- `src/server.ts` serves `public/`, exposes authenticated JSON/SSE routes, and
  coordinates scan and deletion operations.
- `src/scanners/` contains the category registry and individual scanners.
- `src/scanners/userFiles.ts` owns broad user-file discovery, large-file
  scanning, old-download scanning, and exact duplicate detection.
- `src/security.ts` owns path canonicalization, protected roots, scan
  provenance, token generation, and timing-safe token comparison.
- `src/trash.ts` calls the macOS bridge in `scripts/trash-items.js` and
  permanently deletes only after server-side validation.
- `src/fswalk.ts`, `src/fsfind.ts`, `src/du.ts`, and `src/overview.ts` provide
  filesystem traversal and storage measurements.
- `public/` is the browser UI; keep API event names and response shapes in
  sync with `src/server.ts`.
- `tests/osx-clean.test.js` covers scanner, security, and deletion behavior.
- `tests/production.test.js` covers the built HTTP service, authentication,
  SSE streams, and end-to-end safety checks.
- `docs/USER_GUIDE.md` documents user-visible behavior and safety limitations.
- `src/desktop/` wraps the existing server in Electron without changing scanner or cleanup logic.
- `electron-builder.json` defines `.app`, DMG, and ZIP packaging; `docs/DESKTOP.md` covers installation and distribution.

## Runtime and commands

Requirements are macOS and Node.js 18 or newer. The repository uses pnpm in
its current documentation and workflow. Use the existing lockfile when one is
present; do not switch package managers or regenerate a lockfile casually.

```bash
pnpm install
pnpm run typecheck
pnpm run build
pnpm test
pnpm run dev -- --no-open
pnpm run clean
pnpm desktop
pnpm desktop:dist
pnpm desktop:smoke:packaged
```

`pnpm test` builds `src/` into `dist/` and runs the Node built-in test runner.
`pnpm run dev -- --no-open` starts the local service without opening a
browser. `pnpm run typecheck` is the fastest check for TypeScript changes.

Before handing off a change, run at minimum:

```bash
pnpm run typecheck
pnpm test
git diff --check
```

The scanner can traverse large home directories, mounted volumes, and cloud
storage. Avoid launching a full interactive scan as a substitute for focused
tests during development.

Desktop builds require Node.js 22.12+ and pinned pnpm 10.28.2. Use
`pnpm install --frozen-lockfile`. `release/` contains generated app artifacts
and stays ignored. Packaged smoke checks suppress automatic scans; run them on
the matching CPU architecture. Keep the JXA helper outside ASAR, retain renderer
sandboxing and local-origin restrictions, and never claim unsigned artifacts
are signed or notarized.

## Implementation rules

- Keep diffs narrow and preserve the existing package boundaries.
- Use strict TypeScript types. Do not weaken types or add broad assertions to
  silence a compiler warning.
- Use Node built-ins and existing helpers before adding a dependency.
- Keep async filesystem and child-process work abort-aware where the existing
  scanner context provides an `AbortSignal`.
- Add a regression test for every behavioral or safety fix. Prefer temporary
  directories and deterministic fixtures; never make tests depend on a real
  user file being disposable.
- Keep scanner results inspectable: include stable paths, sizes, and relevant
  warnings or detail rather than hiding failures.
- Keep command categories informational. Do not silently execute Docker,
  Homebrew, or other tool-owned cleanup commands.
- Preserve exact duplicate semantics: equal size plus full SHA-256 content
  equality. Names, paths, or prefix fingerprints alone are only candidate
  filters, never proof of duplication.
- Preserve the API contract: authenticated routes, loopback binding, SSE
  event names, and the `/api/categories`, `/api/overview`, `/api/scan`,
  `/api/delete`, and `/api/reveal` routes.

## Filesystem safety checklist

Before changing cleanup behavior, verify all of the following remain true:

1. Requests require the per-process token, compared with timing-safe logic.
2. The server binds to `127.0.0.1`, not an externally reachable interface.
3. Protected roots and system paths cannot be deletion targets.
4. A path must come from the current process's scan results before deletion.
5. Deletion performs a fresh `lstat` and rejects symlinks, missing paths, and
   unsafe changes.
6. Moving to Trash remains the primary action and uses the macOS bridge.
7. User-installed `.app` bundles may be trashed but may not be permanently
   deleted through the API.
8. Tests do not delete real user data; permanent-delete tests use temporary
   fixtures and clean them up.

Treat macOS TCC/Full Disk Access failures as expected environmental limits.
Report them clearly; do not bypass them with elevated privileges or broadened
path permissions.

## Git and change hygiene

Use one conventional commit type and a concise imperative subject, for
example:

```text
feat: add scanner category
fix: reject unsafe deletion path
docs: clarify recovery workflow
test: cover authenticated scan stream
refactor: isolate filesystem helper
chore: update development tooling
```

Keep unrelated worktree changes and nested checkouts untouched. Do not use
destructive commands such as `git reset --hard`, broad recursive deletion, or
force-pushes. Inspect `git status`, the relevant diff, and stash entries before
restoring or committing work.

When changing a safety-sensitive behavior, explain the threat or failure mode
in the commit body or review notes and include the test that demonstrates the
guardrail.
