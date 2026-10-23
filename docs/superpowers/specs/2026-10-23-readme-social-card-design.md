# README Social Card and Polish Design

## Intent

Refresh the repository README so a first-time visitor quickly understands what
`osx-clean` does, why it is safe to review, how to try it, and where to find
the detailed User Guide. Add a polished repository social card that reinforces
the local-first, inspect-before-acting position in GitHub previews.

## Goals

- Lead with the product value: inspect storage before taking cleanup action.
- Bring the User Guide's permission setup, scan controls, risk tiers, duplicate
  verification, recovery model, and limitations into concise README sections.
- Add one durable project asset at `docs/social-card.png` and reference it from
  the README without introducing runtime dependencies.
- Keep commands and claims aligned with the current project behavior.

## Non-goals

- No application code or API behavior changes.
- No changes to the browser UI, package manager, or deployment workflow.
- No claim that scans or deletions are risk-free; the review boundary remains
  explicit.

## Chosen approach

Use a dark 1280x640 product card with a restrained storage-visualization motif,
the `osx-clean` name, and the message “Inspect first. Recover by default.”
The README will use a short hero introduction, a compact capability table,
quick start and permission guidance, then link to the User Guide for the full
workflow and safety details. The generated PNG is documentation-only and will
live under `docs/` so it is versioned with the project.

## Success checks

- README links resolve to existing files and the social card is referenced once.
- README contains no stale npm-only commands or unsupported safety claims.
- `git diff --check` passes.
- Existing typecheck and test commands remain unchanged and pass when run.
