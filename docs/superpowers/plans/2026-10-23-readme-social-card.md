# README Social Card and Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the README with concise User Guide-backed product documentation and add a polished social card at `docs/social-card.png`.

**Architecture:** Documentation-only change. The README becomes the concise entry point, while `docs/USER_GUIDE.md` remains the detailed operational reference. The social card is a versioned raster asset referenced from the README and has no runtime dependency.

**Tech Stack:** Markdown, PNG, existing TypeScript/Node project checks, built-in image generation.

**Spec:** `docs/superpowers/specs/2026-10-23-readme-social-card-design.md`

## Global Constraints

- Keep the project local-only and preserve the explicit review boundary.
- Keep commands and claims aligned with current project behavior.
- Do not change application code, API behavior, package manager, or deployment workflow.
- Use the User Guide as the source for permissions, scan controls, risk tiers, duplicate verification, recovery, and limitations.
- Add the social card at `docs/social-card.png` with no runtime integration.

## Review Focus

- A new user should see macOS/Node prerequisites and the shortest working start path.
- Permission guidance must distinguish normal Files and Folders access from Full Disk Access.
- Safety copy must not imply that scanner findings are automatically safe to delete.
- Duplicate detection must be described as exact content verification, not filename matching.
- README links and the social-card path must resolve from the repository root.

---

### Task 1: Generate and validate the social card

**Files:**
- Create: `docs/social-card.png`

**Interfaces:**
- Produces: a 1280x640 documentation asset with the `osx-clean` name and the message “Inspect first. Recover by default.”

- [ ] **Step 1: Generate the dark product card**

Use the image-generation skill with a restrained dark macOS-inspired palette, a clean storage visualization, generous negative space, and no extra unsupported claims or watermark.

- [ ] **Step 2: Inspect the generated image**

Confirm the dimensions, legibility, project name, intended message, and absence of distracting or inaccurate UI details.

- [ ] **Step 3: Save the selected asset**

Place the final PNG at `docs/social-card.png` and preserve the existing project files.

### Task 2: Rewrite the README entry point

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: `docs/USER_GUIDE.md` and `docs/social-card.png`.
- Produces: a concise README with hero positioning, social-card reference, User Guide links, quick start, capability/risk overview, safety model, development commands, and limitations.

- [ ] **Step 1: Replace the opening with a clear product hero**

Lead with what `osx-clean` does, who it is for, and the “inspect before acting / recover by default / stay local” positioning. Add the social-card image with useful alt text and a link to the User Guide.

- [ ] **Step 2: Add User Guide-backed onboarding and capability sections**

Include prerequisites, permission expectations, the CLI command, scan controls, category/risk summary, exact duplicate behavior, and the distinction between reviewable cleanup and manual commands. Keep detailed procedural instructions in the User Guide.

- [ ] **Step 3: Preserve and tighten the safety and development sections**

Retain the loopback/token/provenance/fresh-validation/Trash-first guarantees, clarify limitations, keep the current development commands, and ensure no stale npm-only instructions remain.

- [ ] **Step 4: Validate Markdown references and copy**

Check that all relative links resolve, the image reference is singular and correct, headings are coherent, and the README does not contradict the User Guide.

### Task 3: Run repository verification

**Files:**
- Verify: `README.md`, `docs/social-card.png`

- [ ] **Step 1: Run whitespace and repository checks**

Run `git diff --check` and inspect `git status --short` for only the intended files.

- [ ] **Step 2: Run the existing typecheck and tests**

Run `npm run typecheck` and `npm test` if dependencies are available; documentation and image changes must not alter application behavior.

- [ ] **Step 3: Review the final diff**

Confirm the README is materially clearer, the card is referenced correctly, and no generated or unrelated files are included.
