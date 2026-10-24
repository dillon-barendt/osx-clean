# Changelog

## Unreleased

### Added

- Electron desktop entry point reusing the existing server, UI, scanner, and cleanup logic.
- Sandboxed window, single-instance handling, native menus, Full Disk Access shortcut, and service shutdown on close/quit.
- DMG and ZIP packaging for Apple Silicon and Intel, plus a project app icon.
- Desktop regression tests and a smoke check for the actual packaged app.
- Reproducible pnpm dependency lockfile and desktop build workflow with downloadable artifacts and checksums.
- Desktop installation, architecture decision, permissions, and release-signing documentation.

### Unchanged

- CLI startup, API routes and authorization, scan categories, hashing, path validation, Trash behavior, and permanent-delete confirmations.

### Distribution status

- MVP builds do not include a Developer ID certificate or notarization. Public signed distribution requires maintainer credentials. No auto-updater or background service is added.
