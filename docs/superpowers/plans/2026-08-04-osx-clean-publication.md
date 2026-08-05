# osx-clean Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current local cleaner into a consistently branded, visually distinctive, documented, verified, and publicly available `osx-clean` repository.

**Architecture:** Preserve the dependency-light TypeScript HTTP service and static browser client. Change identity and presentation at their existing boundaries, remove repository debris, and verify both the compiled service and browser experience before publication.

**Tech Stack:** Node.js 18+, TypeScript 5, HTML, CSS, browser JavaScript, GitHub CLI

## Global Constraints

- Product name is exactly `osx-clean`.
- Runtime remains local-only on `127.0.0.1`.
- No runtime dependencies are added.
- Existing scan and deletion safety behavior is preserved.
- The public repository contains no nested clone, IDE metadata, generated build output, or previous-owner references.

---

### Task 1: Repository Identity And Hygiene

**Files:**
- Modify: `.gitignore`
- Modify: `.aiignore`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/cli.ts`
- Modify: `src/server.ts`
- Modify: `src/trash.ts`
- Modify: `src/scanners/types.ts`
- Delete: nested source clone

**Interfaces:**
- Consumes: existing package, CLI, HTTP token, and temporary-file naming
- Produces: one consistent `osx-clean` product identity and a publication-safe tree

- [x] Update ignore rules to exclude IDE, local AI, generated, and browser-test artifacts.
- [x] Rename package, binary, user-visible CLI output, request-token identifiers, and temporary files to `osx-clean`.
- [x] Remove the nested clone and scan for stale owner/product references.
- [x] Run `npm run typecheck` and confirm an exit code of 0.
- [x] Commit as `feat(osx-clean): establish local cleaner`.

### Task 2: Precision-Utility Interface

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.css`
- Modify: `public/app.js`

**Interfaces:**
- Consumes: existing API endpoints and static DOM hooks
- Produces: responsive themed UI without changing the service contract

- [x] Replace the browser title, heading, token global, and visible product copy with `osx-clean` language.
- [x] Add the graphite, warm-white, and signal-orange design tokens and responsive layout.
- [x] Add restrained load/scan motion and visible local-only safety cues with reduced-motion support.
- [x] Exercise options, rescan, category expansion, selection, and mobile layout in a real browser.
- [x] Commit as `feat(osx-clean): sharpen the cleanup interface`.

### Task 3: Public Documentation And Release Verification

**Files:**
- Modify: `README.md`
- Modify: `LICENSE`

**Interfaces:**
- Consumes: final package scripts, architecture, scan categories, and safety behavior
- Produces: accurate contributor and user documentation for GitHub

- [x] Replace the drifted README with accurate overview, setup, safety, architecture, development, limitations, and license sections.
- [x] Update the license attribution to the current project owner.
- [x] Run `npm run typecheck`, `npm run build`, and `npm test` and confirm all exit with code 0.
- [x] Start `node dist/cli.js --no-open`, verify HTML plus authorized and unauthorized API behavior, then stop it.
- [x] Confirm no stale clone identity, nested repository copy, IDE metadata, or generated output is staged.
- [x] Commit as `docs(osx-clean): document the local safety model`.
- [ ] Create `dillon-barendt/osx-clean` as a public repository, push the default branch, and verify GitHub visibility.
