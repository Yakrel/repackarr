# Changelog

## [0.1.2] - 2026-03-08

### Added
- Auto-Download can now automatically grab the best matching release for eligible games.
- A new notification center shows when automatic downloads succeed, fail, or are skipped.
- You can now control Auto-Download globally or override it for each game in your library.

### Changed
- The Add Game flow is now clearer: choose **I Want This Game** to search right away, or **I Already Have It** to just start tracking it.
- Scheduled scans now run once at startup and avoid overlapping runs, making background checks more reliable.
- Version labels, scan progress, and update actions now feel more consistent across the app.
- Recommended releases on the Dashboard now match the exact release Auto-Download would choose.

### Fixed
- Error messages are cleaner and safer when something goes wrong.
- Auto-download follow-up handling is more reliable during large scan runs.

## [0.1.1] - 2026-03-04

### Added
- Per-torrent download and upload speed limit controls
- Speed limits are now loaded from qBittorrent on page open
- Upload speed shown alongside download speed in torrent status
- Turtle mode toggle to quickly throttle all speeds
- In-app changelog viewer

### Changed
- Torrent control buttons redesigned for a cleaner look

## [0.1.0] - 2026-02-01

- Initial release
