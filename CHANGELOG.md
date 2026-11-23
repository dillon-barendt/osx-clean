# Changelog

## Unreleased

### Performance

- Stream file discovery with visited-directory tracking, normalized root deduplication, bounded adaptive workers, and coalesced progress updates.
- Reduce duplicate-scan metadata retention and full-file reads using size, prefix, and tail filters followed by exact SHA-256 verification.
- Preserve distinct hard links, explicit roots inside skipped folders, path filtering, and cancellation; handle short sample reads safely.
- Add repeatable work measurements and scanning regressions in `docs/SCANNER_PERFORMANCE.md`.

### Added

- Electron desktop entry point reusing the existing server, UI, scanner, and cleanup logic.
- Sandboxed window, single-instance handling, native menus, Full Disk Access shortcut, and service shutdown on close/quit.
- DMG and ZIP packaging for Apple Silicon and Intel, plus a project app icon.
- Desktop regression tests and a smoke check for the actual packaged app.
- Reproducible pnpm dependency lockfile and desktop build workflow with downloadable artifacts and checksums.
- Desktop installation, architecture decision, permissions, and release-signing documentation.

### Unchanged

- CLI startup, API routes and authorization, scan categories, exact SHA-256 matching, path validation, Trash behavior, and permanent-delete confirmations.

### Distribution status

- MVP builds do not include a Developer ID certificate or notarization. Public signed distribution requires maintainer credentials. No auto-updater or background service is added.
