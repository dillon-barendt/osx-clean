# osx-clean

**A local-first macOS storage scanner that makes every cleanup action inspectable.**

[![macOS](https://img.shields.io/badge/platform-macOS-171816?style=flat-square)](https://www.apple.com/macos/)
[![Node.js 18+](https://img.shields.io/badge/node-%3E%3D18-43853d?style=flat-square)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square)](https://www.typescriptlang.org/)
[![CI](https://github.com/dillon-barendt/osx-clean/actions/workflows/ci.yml/badge.svg)](https://github.com/dillon-barendt/osx-clean/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-ff5a1f?style=flat-square)](LICENSE)

`osx-clean` maps storage usage, scans common cleanup targets, and keeps deletion behind an explicit review boundary. It runs entirely on your Mac as a dependency-light TypeScript service with a responsive browser interface.

No account. No telemetry. No cloud service. No background daemon.

## Why osx-clean

Most cleaners ask for broad trust and hide the mechanics. `osx-clean` takes the opposite approach:

- **Inspect before acting.** Every candidate includes its path and size.
- **Recover by default.** The primary action moves files to the macOS Trash.
- **Match duplicates exactly.** Duplicate sets require equal size and SHA-256 content hashes.
- **Keep risky commands manual.** Tool-owned cleanup commands are shown for review, not executed silently.
- **Stay local.** The service listens only on `127.0.0.1` and authorizes API requests with a per-process random token.

## Documentation

For detailed step-by-step instructions, scanning categories, configuration options, safety architecture, and limitations, refer to the [User Guide](docs/USER_GUIDE.md).

## Quick Start

Requirements:

- macOS
- Node.js 18 or newer

```bash
git clone https://github.com/dillon-barendt/osx-clean.git
cd osx-clean
pnpm install
pnpm run build
pnpm start
```

The CLI starts the local service and opens the authenticated interface in your default browser.

```text
osx-clean is running.
Scan target: this Mac, local-only
Open: http://127.0.0.1:4280/?token=<per-process-token>
```

To expose the command from your checkout:

```bash
pnpm link
osx-clean --no-open
```

### CLI Options

```text
Usage: osx-clean [--port <n>] [--no-open]
```

| Option | Behavior |
| --- | --- |
| `--port <n>` | Use a port other than `4280`. |
| `--no-open` | Start the service without opening a browser. |
| `--help`, `-h` | Print command usage. |

## Scan Coverage

The interface separates findings by risk and lets you adjust size and age thresholds before rescanning.

| Risk | Categories |
| --- | --- |
| Lower risk | Trash, temporary files, browser caches, Homebrew cache, old downloads |
| Review recommended | Application caches, logs, developer caches, `node_modules`, large files, large folders, applications |
| High attention | Orphaned launch agents, iOS backups, Mail attachments, exact duplicate files |
| Manual command | Docker reclaimable storage |

The storage overview also reports disk usage and sizes top-level home, Library, and Applications folders progressively while the cleanup scan runs.

## Safety Model

Cleanup tools fail dangerously when path validation and user intent are treated as UI concerns. `osx-clean` enforces both in the service:

1. **Loopback binding.** The HTTP server listens on `127.0.0.1`, not the network.
2. **Per-process authorization.** API routes require a random 192-bit token using timing-safe comparison.
3. **Protected roots.** System areas, user root folders, Library roots, and temporary roots cannot be deletion targets.
4. **Scan provenance.** A path must have appeared in the current process's scan results before deletion is accepted.
5. **Fresh filesystem validation.** Every action performs a new `lstat`; symlinks and vanished files are rejected.
6. **Recoverable default.** Moving to Trash is primary. Permanent deletion is visually secondary and requires two confirmations.
7. **Application guardrail.** Directly installed `.app` bundles can be moved to Trash but cannot be permanently deleted through the API.

These controls reduce risk; they do not make every suggested file disposable. Review selected paths before approving an action.

## Architecture

```text
CLI (src/cli.ts)
  |
  +-- binds HTTP server to 127.0.0.1
  +-- opens tokenized browser URL
        |
        +-- static UI (public/)
        +-- scan and overview event streams
        +-- authenticated reveal/trash/delete routes
              |
              +-- scanners (src/scanners/)
              +-- path policy (src/security.ts)
              +-- macOS Trash bridge (scripts/trash-items.js)
```

The runtime has no third-party dependencies. TypeScript and Node type definitions are development-only.

## Development

```bash
pnpm ci
pnpm run typecheck
pnpm test
pnpm run dev -- --no-open
```

| Script | Purpose |
| --- | --- |
| `pnpm run typecheck` | Check strict TypeScript types without emitting files. |
| `pnpm run build` | Compile `src/` into `dist/`. |
| `pnpm test` | Build and run the Node regression suite. |
| `pnpm run dev` | Build and launch the local interface. |
| `pnpm run clean` | Remove compiled output. |

The regression suite verifies content-hash duplicate matching and deletion-root protections using only Node's built-in test runner.

## Limitations

- Full scans can take time on large home directories because results are calculated from the live filesystem.
- macOS privacy protections may hide folders until your terminal has the relevant Files and Folders or Full Disk Access permission.
- Some categories report reclaimable space or a command rather than deleting tool-managed data directly.
- Permanent deletion cannot be recovered. Prefer Trash unless you have a specific reason not to.
- Duplicate and large file scanning searches across your entire user directories, mounted volumes (`/Volumes`, Mountain Duck, Google Drive, external drives), cloud integrations (`~/Library/CloudStorage` for Proton Drive, Google Drive, OneDrive, Dropbox, Box, iCloud Drive), and `/Users/Shared`.

## Contributing

Keep changes narrow, preserve the local-only safety boundary, and add a regression test for behavioral fixes. Before opening a pull request, run:

```bash
pnpm run typecheck
pnpm test
git diff --check
```

## License

[MIT](LICENSE) Copyright (c) 2026 Dillon Barendt.
