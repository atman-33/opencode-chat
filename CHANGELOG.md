# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.1.2] - 2026-06-15

### Fixed

- Fixed published extension missing runtime dependencies (`cross-spawn`, `tree-kill`) by publishing the pre-built VSIX to both marketplaces.
- Added `OpenCode` output channel logging to help diagnose server startup and view rendering issues.
- Hardened view rendering so template errors no longer leave the sidebar stuck on the loading screen.
- Added `allow-forms` to the iframe sandbox so chat input forms work correctly.
- Removed unused `.claude/` files from the packaged extension.

## [0.1.1] - 2026-06-15

### Changed

- Updated publisher information in `package.json`.

## [0.1.0] - 2026-06-15

### Added

- Initial custom fork release based on `kwickramasekara/opencode-chat-unofficial`.
- Renamed extension to `opencode-chat-unofficial-custom`.
- Added GitHub Actions workflows for CI, version bump, release, and release-only tagging.

### Changed

- Updated `repository` URL to `https://github.com/atman-33/opencode-chat`.
- Updated `README.md` to describe the fork and link to the original project.
