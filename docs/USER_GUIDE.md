# osx-clean User Guide

A comprehensive guide to understanding, configuring, and operating **osx-clean** — the local-first, review-driven macOS storage cleaner.

---

## Table of Contents

1. [Overview & Philosophy](#overview--philosophy)
2. [Prerequisites & macOS Permissions](#prerequisites--macos-permissions)
3. [Quick Start & Launching](#quick-start--launching)
   - [Desktop App](#desktop-app)
   - [Running from Source](#running-from-source)
   - [CLI Options](#cli-options)
4. [Step-by-Step Usage Guide](#step-by-step-usage-guide)
   - [1. Reading the Storage Overview](#1-reading-the-storage-overview)
   - [2. Configuring Scan Thresholds](#2-configuring-scan-thresholds)
   - [3. Running & Monitoring Scans](#3-running--monitoring-scans)
   - [4. Inspecting Findings & Categories](#4-inspecting-findings--categories)
   - [5. Revealing Items in Finder](#5-revealing-items-in-finder)
   - [6. Selecting & Cleaning Items](#6-selecting--cleaning-items)
   - [7. Executing Tool-Managed Commands](#7-executing-tool-managed-commands)
5. [Scan Coverage & Risk Tiers](#scan-coverage--risk-tiers)
6. [Safety Model & Deletion Safeguards](#safety-model--deletion-safeguards)
7. [Duplicate Detection Architecture](#duplicate-detection-architecture)
8. [Scope & Limitations](#scope--limitations)
9. [Troubleshooting & FAQ](#troubleshooting--faq)

---

## Overview & Philosophy

Most disk cleanup applications operate as opaque "black boxes" that ask for administrator privileges, scan in the background, and perform mass deletions with little to no visibility into what is actually being removed.

**osx-clean** is built on the opposite philosophy:

- **Local-First & Zero Telemetry:** Runs strictly on `127.0.0.1` on your Mac. No external network calls, no analytics, no accounts, and no background daemons.
- **Inspect Before Acting:** Every cleanable item displays its exact filesystem path, size, and metadata. You can reveal any item in Finder with one click.
- **Recover by Default:** All cleaning actions default to moving files to the native macOS Trash (`~/.Trash`), allowing painless recovery if needed.
- **Exact Duplicate Verification:** Duplicate files are never identified by name alone. They must match exact byte size, prefix fingerprints, and full SHA-256 cryptographic hashes.
- **Manual Command Guidance:** Third-party tool caches (such as Docker storage) provide copy-pasteable terminal commands rather than running destructive operations behind the scenes.

---

## Prerequisites & macOS Permissions

### Requirements
- **Operating System:** macOS (Apple Silicon or Intel).
- **Desktop app:** macOS 12+; use the Apple Silicon (`arm64`) or Intel (`x64`) download. No separately installed runtime is required.
- **Running the CLI:** Node.js 18.0.0 or higher.
- **Building from source:** Node.js 22.12+ and pnpm 10.28.2 for the desktop toolchain.

### macOS Privacy Permissions (TCC)
macOS enforces strict Transparency, Consent, and Control (TCC) permissions:
- When scanning user directories (`~/Documents`, `~/Downloads`, `~/Desktop`), macOS may prompt you to grant permission to your Terminal or IDE. Click **Allow**.
- For full system-wide visibility (such as scanning all Mail attachments, application caches, and Library logs), you can grant **Full Disk Access** to your terminal emulator (Terminal, iTerm2, Ghostty, etc.) under **System Settings → Privacy & Security → Full Disk Access**.
- For the packaged desktop edition, grant access to **osx-clean.app** instead. Use **osx-clean → Full Disk Access…**, add the installed app, then quit and reopen it. If the Trash fallback requests Finder automation, review it under **Privacy & Security → Automation**.

---

## Quick Start & Launching

### Desktop App

Open the DMG for your Mac, drag **osx-clean** into **Applications**, and launch
it from Finder, Spotlight, or the Dock. The app opens the existing interface in
its own window and selects an available loopback port automatically. All scan
and cleanup controls below work the same way. Close the window or press **⌘Q**
to exit the service.

Builds produced by the MVP packaging are not Developer ID signed or notarized.
See the [Desktop Guide](DESKTOP.md) for available build artifacts, installation
restrictions, permissions, and signing instructions.

### Running from Source

Clone the repository and install dependencies:

```bash
git clone https://github.com/dillon-barendt/osx-clean.git
cd osx-clean
pnpm install
pnpm run build
pnpm start
```

When started, the CLI will:
1. Initialize the local server on `127.0.0.1:4280`.
2. Generate a secure, 192-bit per-process authentication token.
3. Automatically launch your default browser to the authenticated UI:
   `http://127.0.0.1:4280/?token=<per-process-token>`

### CLI Options

You can customize the port or suppress automatic browser launch:

```bash
# Start on a custom port
node dist/cli.js --port 8080

# Start headless (without opening the browser automatically)
node dist/cli.js --no-open

# View command help
node dist/cli.js --help
```

| Flag | Description | Default |
| --- | --- | --- |
| `--port <number>` | Specific port to bind the local HTTP service | `4280` |
| `--no-open` | Start server without launching the default browser | `false` |
| `-h`, `--help` | Display CLI help and options | — |

---

## Step-by-Step Usage Guide

### 1. Reading the Storage Overview

At the top of the interface, the **Storage Overview** displays real-time disk statistics:
- **Disk Usage Bar:** Shows used vs. available space on your primary APFS/HFS+ volume.
- **Biggest Folders:** Asynchronously calculates and ranks the largest directories in your Home folder (`~`).
- **Applications Breakdown:** Lists the largest application bundles installed in `/Applications`.
- **Library Breakdown:** Breaks down disk usage inside `~/Library` (such as caches, application support, and logs).

---

### 2. Configuring Scan Thresholds

Click the **Options** button in the header bar to adjust scanner sensitivity:

- **Minimum Item Size (MB):** Ignores files and directories smaller than this threshold (default: `1 MB`).
- **Old Downloads Age (Days):** Minimum age for files in `~/Downloads` to be flagged as stale (default: `30 days`).
- **Large File Threshold (MB):** Minimum file size for standalone large file detection (default: `200 MB`).
- **Large Folder Threshold (MB):** Minimum directory size for top-level folder detection (default: `300 MB`).
- **Duplicate Minimum Size (MB):** Minimum file size to include in content-hash duplicate scans (default: `5 MB`).

Click **Apply & Rescan** to apply your adjustments immediately.

---

### 3. Running & Monitoring Scans

- Click **Rescan** at any time to re-evaluate the live filesystem.
- The interface connects via Server-Sent Events (SSE) to stream scan results progressively.
- Category cards show real-time scanning spinners, progress indicators, and item counts as each scanner completes.
- Once complete, category cards automatically sort by total reclaimable size (largest first).

---

### 4. Inspecting Findings & Categories

- Click on any category card header to expand its item list.
- Each item row displays:
  - **Item Name & Sub-label:** The filename or folder name with contextual notes (e.g., last modified date, app name, or duplicate group).
  - **Full Path:** The exact path on disk.
  - **Size:** Formatted byte size (KB, MB, GB).
  - **Checkbox:** For individual selection.

---

### 5. Revealing Items in Finder

Before cleaning, you can inspect any file or folder directly in macOS Finder:
- Click the **Reveal** button on the right side of any item row.
- The service invokes native macOS Finder integration (`open -R`) to highlight the exact file on your screen.

---

### 6. Selecting & Cleaning Items

1. **Select Items:**
   - Select individual files using the item checkboxes.
   - Select all files in a category using the master checkbox in the category header.
2. **Review the Action Bar:**
   - The sticky action bar at the bottom displays the total number of selected items and combined size.
3. **Choose an Action:**
   - **Move to Trash (Default & Recommended):** Click **Move to Trash**. Items are safely moved to `~/.Trash` via macOS Cocoa APIs (`NSFileManager.trashItemAtURL`). You can restore them from the macOS Trash at any time.
   - **Permanently Delete:** Click **Delete Permanently**. This triggers two explicit browser confirmation dialogs before invoking recursive unlinking. Use this only when you are certain the items are completely disposable.

---

### 7. Executing Tool-Managed Commands

For complex environments like **Docker**, `osx-clean` inspects reclaimable space using `docker system df` and provides the exact safe cleanup command:
- Click the **Copy** button to copy `docker system prune -a --volumes` to your clipboard.
- Run the command manually in your terminal when ready.

---

## Scan Coverage & Risk Tiers

`osx-clean` groups cleanup targets into 4 distinct risk tiers:

```
┌────────────────────────────────────────────────────────────────────────┐
│                          SCAN COVERAGE TIERS                           │
├─────────────────────┬──────────────────────────────────────────────────┤
│ Lower Risk          │ • macOS Trash (~/.Trash)                         │
│ (Generally safe to  │ • System Temp Files (/tmp, /private/tmp, TMPDIR) │
│  reclaim)           │ • Browser Caches (Safari, Chrome, Brave, Arc,    │
│                     │   Edge, Firefox)                                 │
│                     │ • Homebrew Cache (brew --cache)                  │
│                     │ • Old Downloads (> 30 days old)                  │
├─────────────────────┼──────────────────────────────────────────────────┤
│ Review Recommended  │ • Application Caches (~/Library/Caches)          │
│ (Safe, but apps may │ • System & User Logs (~/Library/Logs, /var/log)  │
│  recreate caches)   │ • Developer Caches (npm, pnpm, yarn, CocoaPods,  │
│                     │   pip, Gradle, SwiftPM, Carthage)                │
│                     │ • Project node_modules directories               │
│                     │ • Large Files (> 200 MB in user folders)         │
│                     │ • Large Folders (> 300 MB)                       │
│                     │ • Installed Applications (/Applications)         │
├─────────────────────┼──────────────────────────────────────────────────┤
│ High Attention      │ • Exact Duplicate Files (multi-stage SHA-256)    │
│ (Requires careful   │ • Orphaned Launch Agents (missing target binaries│
│  user review)       │ • iOS Device Backups (MobileSync)                │
│                     │ • Mail Downloads & Attachments                   │
├─────────────────────┼──────────────────────────────────────────────────┤
│ Tool Commands       │ • Docker Storage (reclaimable containers/images) │
└─────────────────────┴──────────────────────────────────────────────────┘
```

---

## Safety Model & Deletion Safeguards

`osx-clean` implements defense-in-depth security safeguards enforced in the server runtime:

1. **Loopback Address Only:** The HTTP server listens solely on `127.0.0.1` and never binds to public network interfaces.
2. **Timing-Safe Token Authorization:** Every API request must supply the 192-bit random token generated during startup, compared using `crypto.timingSafeEqual`.
3. **Protected Root Blacklist:** Deletion is permanently blocked for system directories and primary user directories, including:
   - `/`, `/System`, `/Library`, `/usr`, `/bin`, `/sbin`, `/var`, `/etc`, `/Applications`, `/private`
   - User home root (`~`), `~/Library`, `~/Desktop`, `~/Documents`, `~/Downloads`
   - Temporary system roots (`/tmp`, `/private/tmp`, `/var/folders`)
4. **Scan Provenance Requirement:** An item can only be deleted if its exact path was discovered during the active server session's scan. Hand-crafted API deletion payloads targeting unscanned paths are rejected.
5. **Fresh Filesystem Validation:** Every deletion request performs a fresh `lstat`. Symbolic links are never followed or traversed, and vanished files are skipped.
6. **Application Bundle Guardrail:** Directly installed `.app` bundles can be moved to the macOS Trash, but permanent deletion via the API is blocked to prevent accidental loss of applications.

---

## Duplicate Detection Architecture

Calculating duplicate files across tens of thousands of user files is computationally expensive. `osx-clean` employs an optimized, 4-stage pipeline that operates across your entire filesystem, mounted volumes, and cloud drives:

1. **Comprehensive Scan Root Discovery:**
   Dynamically discovers and aggregates candidate roots across:
   - All directories in your Home folder (`~`), including custom project repositories, archives, and media libraries.
   - Cloud storage integrations under `~/Library/CloudStorage/` (such as Proton Drive, Google Drive, Microsoft OneDrive, Dropbox, and Box).
   - iCloud Drive under `~/Library/Mobile Documents/`.
   - All attached and mounted disks under `/Volumes/` (including Mountain Duck virtual mounts, Google Drive mounts, external SSDs/HDDs, and network shares).
   - Multi-user and shared locations like `/Users/Shared/`.
2. **Parallel Directory Crawling:**
   Traverses all discovered roots concurrently using non-blocking directory workers. Automatically skips recursive symlinks, `.git` internals, and package manager caches (`node_modules`, `.cache`) to keep traversal blazing fast.
3. **Exact Size Partitioning:**
   Groups discovered files by exact byte size. Files with unique sizes are discarded immediately with zero hashing overhead.
4. **Parallel Prefix Hashing (16 KB):**
   For files that share the exact same byte size, reads and hashes the first 16 KB using SHA-256 across a parallel worker pool. Files that differ in their header are instantly eliminated.
5. **Full SHA-256 Verification & Grouping:**
   Only candidates that share both identical file sizes and matching 16 KB prefix hashes are streamed through full SHA-256 hashing. Surviving duplicate sets are grouped with unique color indicators and sorted by total reclaimable disk size.

---

## Scope & Limitations

### What osx-clean DOES:
- Scans local macOS storage on your internal and attached drives, mounted volumes (`/Volumes`, Mountain Duck, Google Drive, external drives), and cloud integrations (`~/Library/CloudStorage` for Proton Drive, Google Drive, OneDrive, Dropbox, Box, and iCloud Drive).
- Inspects real files and folders currently taking up physical space across user directories, shared folders (`/Users/Shared`), and filesystem locations.
- Seamlessly works with standard or elevated (sudo) permissions while keeping core macOS system files protected.
- Provides progressive feedback and disk usage breakdowns.
- Safely moves selected user-approved items to the native macOS Trash.
- Handles exact duplicate detection with cryptographic accuracy across all discovered storage roots.

### What osx-clean DOES NOT do (Limitations):
- **Does not run cloud analytics or store history:** There is no persistent database; all scans reflect the instantaneous state of your filesystem.
- **Does not bypass macOS TCC security:** Cannot access folders protected by macOS unless your terminal has been granted necessary permissions (e.g. Full Disk Access).
- **Does not automatically delete files without user consent:** No automatic background deletion or cron jobs.
- **Does not execute tool-managed cleanups silently:** Docker prune commands are presented for manual review and terminal execution.
- **Does not recover permanently deleted files:** Files moved to Trash are recoverable; files deleted via "Delete Permanently" cannot be recovered.

---

## Troubleshooting & FAQ

### Q: Why do some folders show "Permission denied" or "Operation not permitted"?
**A:** macOS System Integrity Protection (SIP) and TCC restrict access to certain private directories (such as Mail or Safari sandboxes). Open **System Settings → Privacy & Security → Full Disk Access** and add **osx-clean.app** for desktop use, or your terminal for CLI use. Quit and relaunch after changing access.

### Q: Where do files go when I click "Move to Trash"?
**A:** They are moved directly to your macOS Trash (`~/.Trash`). You can open the Trash from your macOS Dock and click **Put Back** on any file to restore it to its original location.

### Q: How do I stop the server?
**A:** In the desktop app, close its window or press **⌘Q**. For the CLI, press `Ctrl + C` in the terminal where it is running.

---

*osx-clean — Developed by Dillon Barendt. Licensed under the MIT License.*
