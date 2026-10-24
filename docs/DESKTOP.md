# Desktop app

The desktop edition packages the existing scanner and interface in an Electron
macOS application. It installs as `osx-clean.app`, opens in its own window, and
includes its runtime. End users do not need Node.js, pnpm, or a terminal.

## Install and launch

Requirements: macOS 12 Monterey or later and the download matching your Mac.
Choose `arm64` for Apple Silicon or `x64` for Intel (Apple menu → About This Mac).

1. Open `osx-clean-<version>-mac-<arch>.dmg`.
2. Drag **osx-clean** into **Applications**, then eject the disk image.
3. Open **osx-clean** from Applications, Spotlight, or the Dock.
4. Review scan findings before choosing Move to Trash or permanent deletion.

The ZIP is an alternative: extract it and move the app into Applications.
Scan thresholds, duplicates, Finder reveal, cleanup confirmations, and the
manual Docker command work as in the [User Guide](USER_GUIDE.md).

Local and CI MVP builds are **not Developer ID signed or notarized**. Apple
Silicon builds may carry an ad-hoc signature, which does not establish a
publisher identity. macOS may block a downloaded app. Only for a build whose
source you trust, use **System Settings → Privacy & Security → Open Anyway**
after attempting to open it. If macOS does not offer an override, use a signed
release or build locally. Do not disable Gatekeeper or strip quarantine flags.

## Permissions belong to the app

Allow Files and Folders access when macOS prompts. For broader scan coverage,
open **osx-clean → Full Disk Access…** and add the installed
`/Applications/osx-clean.app` in System Settings. Quit and reopen after changing
permissions. Terminal permission alone does not grant access to the packaged app.

The native Trash helper may use Finder as a fallback for FileProvider/cloud
locations. If prompted, allow osx-clean to control Finder for that operation;
you can review this under **Privacy & Security → Automation**. No administrator
prompt or elevated execution is added by the desktop wrapper.

The app exits when its window closes or when you press **⌘Q**. It does not add
a login item, daemon, or automatic updater. A second launch focuses the existing
window. Each launch uses a new authentication token and an available loopback
port, so a separately running CLI on port 4280 does not conflict.

## Build from source

The desktop toolchain requires macOS and Node.js **22.12 or newer**, plus
pnpm **10.28.2** (pinned in `package.json`). The browser/CLI runtime still supports
Node.js 18+. Install dependencies using the committed pnpm lockfile:

```bash
pnpm install --frozen-lockfile
pnpm desktop
```

If a global pnpm installation is broken or unavailable, use
`npx --yes pnpm@10.28.2 <command>` in place of `pnpm <command>`; this uses the
same pinned manager without changing the project toolchain.

```bash
# Build the .app directory for the build machine's architecture
pnpm desktop:pack

# Build DMG and ZIP downloads for the build machine's architecture
pnpm desktop:dist

# Build separate Apple Silicon and Intel downloads
pnpm desktop:dist:all

# Verify the installed Electron runtime and the existing UI/API together
pnpm desktop:smoke

# Verify the actual packaged .app for the build machine's architecture
pnpm desktop:smoke:packaged
```

Outputs go into ignored `release/`:

| Output | Purpose |
| --- | --- |
| `mac-arm64/osx-clean.app` | Apple Silicon app bundle |
| `mac/osx-clean.app` | Intel app bundle |
| `osx-clean-0.1.0-mac-arm64.dmg` / `.zip` | Apple Silicon downloads |
| `osx-clean-0.1.0-mac-x64.dmg` / `.zip` | Intel downloads |

Artifact names use the version in `package.json`. Building another architecture
does not test it; run the packaged smoke check on matching hardware. To test a
custom bundle, run `node scripts/smoke-desktop.mjs /path/to/app/Contents/MacOS/osx-clean`.

Smoke mode suppresses scan/overview requests in the desktop session only, so it
does not crawl your home or mounted drives. It loads the real packaged UI, checks
the renderer has no Node access, exercises authentication and protected-root
rejection, and verifies the packaged Trash helper exists. It does not delete or
trash test files. The normal regression suite still tests native Trash on
temporary fixtures.

## Download builds in GitHub Actions

The **Desktop builds** workflow builds and tests on both Apple Silicon and Intel
runners. Run it manually from Actions, or push a `v*` tag whose version matches
`package.json`. Download `osx-clean-mac-arm64` or `osx-clean-mac-x64` from the
successful run's Artifacts section. GitHub requires sign-in to download workflow
artifacts; the outer artifact ZIP contains the DMG, app ZIP, and `SHA256SUMS.txt`.

The workflow does not publish a public release. Maintainers can attach the
verified DMG, ZIP, and checksums to a GitHub Release for public downloads. Do not
label unsigned MVP artifacts as notarized releases.

## Signing for public distribution

Reliable public installation requires an Apple Developer **Developer ID
Application** certificate and notarization credentials. No signing identity is
included in this repository. The default builder configuration can discover a
valid certificate locally; the unsigned MVP does not require one.

For a signed release, supply credentials through the build environment, never
committed files: `CSC_LINK` and `CSC_KEY_PASSWORD` for the signing certificate,
and either the supported App Store Connect API credentials or `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` for notarization. Require
signing and notarization explicitly so missing credentials fail the build:

```bash
pnpm desktop:dist --config.forceCodeSigning=true --config.mac.notarize=true
```

Verify the result before distributing:

```bash
codesign --verify --deep --strict --verbose=2 release/mac-arm64/osx-clean.app
spctl --assess --type execute --verbose=2 release/mac-arm64/osx-clean.app
xcrun stapler validate release/mac-arm64/osx-clean.app
```

Use `release/mac/` for Intel. Signing/notarization have not been verified without
publisher credentials. See the official [Electron security guide](https://www.electronjs.org/docs/latest/tutorial/security)
and [electron-builder macOS documentation](https://www.electron.build/v26/docs/mac/).

## Why Electron

| Method | Fit for this repository |
| --- | --- |
| Electron + electron-builder | Bundles Chromium and Node, reuses the existing service/UI, creates `.app`, DMG, and ZIP. Best MVP fit. |
| Tauri or Swift + WKWebView | Smaller webview shell, but needs a separate bundled Node service and lifecycle/permission integration, or a backend rewrite. More work to preserve existing behavior. |
| Browser launcher / standalone Node executable | Keeps the service, but still relies on a browser and needs additional macOS application packaging. |

The tradeoff is a larger download and responsibility for keeping Electron
updated. This is a macOS app with a web interface in a native window, rather
than a SwiftUI rewrite. App Store sandboxing is outside the MVP's broad storage
scanning requirements.

## Implementation boundaries

- `src/desktop/main.ts`: single instance, native menus, window, permissions, and shutdown.
- `src/desktop/service.ts`: starts the unchanged `createServer()` on `127.0.0.1:0`.
- `src/desktop/policy.ts`: sandbox settings and local-origin checks.
- `src/desktop/smoke.ts` and `scripts/smoke-desktop.mjs`: opt-in runtime verification.
- `electron-builder.json`: allowlisted app contents, installer layout, bundle identity, and permission descriptions.
- `scripts/create-app-icon.swift`: reproducible icon based on the existing document mark. Regenerate with `swift scripts/create-app-icon.swift desktop/assets` (Xcode Command Line Tools required only to regenerate the icon).

There is no preload bridge or renderer Node integration. New windows, webviews,
remote navigation, and requests outside the local service origin are blocked.
Only clipboard writes for the local UI are allowed through Electron permission
handlers. Existing browser confirmation dialogs and API validation remain in
place. Scan, deletion, hash, path-security, and CLI source files are unchanged.

ASAR is disabled intentionally: the JXA Trash helper must be a real filesystem
path readable by `/usr/bin/osascript`. The app includes built server files,
public assets, the helper, license, and guides, while excluding source checkouts,
tests, secrets, and build tooling.
