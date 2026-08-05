# osx-clean Publication Design

## Goal

Publish `osx-clean` as a focused, credible macOS storage inspection and cleanup tool whose interface and documentation make its safety model obvious.

## Product Identity

- Use `osx-clean` everywhere a user sees the product name: package metadata, CLI help, browser title, page heading, token names, temporary files, and documentation.
- Remove the nested source clone and all references to its previous owner, repository, branding, and overstated infrastructure-management positioning.
- Keep the product honest: this is a local Node.js service with a browser UI, not a remote fleet control plane.

## Visual Direction

Use a precision-utility theme: graphite background, warm off-white surfaces, signal orange for primary actions and measured green/red risk cues. Typography should combine a strong condensed display face with readable humanist body copy and monospace for paths and commands. The layout must remain responsive and usable on desktop and mobile.

The interface should communicate engineering confidence through visible operating constraints, clear scanning state, explicit selection, and restrained motion. It should not imitate macOS System Settings or use generic glass-card styling.

## Behavior And Safety

- Preserve the current scan, reveal, trash, and permanent-delete workflows.
- Keep the server bound to `127.0.0.1` and retain per-process token authorization.
- Continue requiring a path to have appeared in the active scan before deletion.
- Keep permanent deletion explicit and visually secondary to moving items to Trash.
- Continue using content hashes for exact duplicate detection.

## Documentation

The README must describe only implemented behavior and include prerequisites, installation, usage, scan categories, safety boundaries, architecture, development commands, limitations, and license. It must use the final public repository URL and avoid claims about unsupported architectures or automation.

## Verification

Before publication:

- Run TypeScript type checking and a production build.
- Start the built CLI without opening a browser and smoke-test the local HTTP/API boundary.
- Exercise the rendered UI in a real browser at desktop and mobile viewports.
- Search the publication tree for stale clone names, owner references, nested source copies, IDE metadata, and generated artifacts.
- Confirm the final Git diff and repository visibility after push.
