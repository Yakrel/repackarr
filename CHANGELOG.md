# Changelog

## [0.1.3] - 2026-05-03

### Added
- Added `SCAN_LOG_RETENTION` to keep scan history under control by pruning older database scan logs after each update scan.
- Added `STARTUP_SCAN_DELAY_SECONDS` so the first automatic scan can wait for qBittorrent and Prowlarr to finish starting.
- Added automatic cleanup for old `repackarr-YYYY-MM-DD.log` files so file logs do not linger beyond the 14-day retention window.

### Changed
- Scan history retention now uses deterministic ID-based pruning and a single cutoff row for safer cleanup.
- Scheduler intervals now start after the delayed startup scan, preventing interval scans from bypassing the startup delay.
- Documentation now separates database scan-history retention from file-log retention.

### Fixed
- Scan log save and prune failures now produce separate log messages.

## [0.1.2] - 2026-03-08

### Added
- Auto-Download can now grab matching updates for you automatically.
- A new notification center keeps you posted when automatic downloads succeed, fail, or are skipped.
- You can now control Auto-Download for the whole library or per game.

### Changed
- Adding a game is now clearer: choose **I Want This Game** to search right away, or **I Already Have It** to simply track it.
- Scans now start automatically after launch and feel more reliable overall.
- The app feels more consistent across update checks, progress, and version labels.
- Dashboard recommendations now line up better with what Auto-Download would pick.

### Fixed
- Error messages are clearer when something goes wrong.
- Auto-download follow-up handling is more reliable during bigger scan runs.

## [0.1.1] - 2026-03-04

### Added
- Per-torrent download and upload speed limit controls
- Speed limits now load from qBittorrent when you open the page
- Upload speed is shown alongside download speed in torrent status
- A turtle mode toggle to quickly slow everything down
- An in-app changelog viewer

### Changed
- Torrent control buttons redesigned for a cleaner look

## [0.1.0] - 2026-02-01

- Initial release
