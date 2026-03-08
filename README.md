# Repackarr

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Docker Image](https://img.shields.io/badge/docker-ghcr.io%2Fyakrel%2Frepackarr-blue?logo=docker)](https://ghcr.io/yakrel/repackarr)

**Repackarr** helps you keep your game repack library up to date. It reads what you already have in qBittorrent, checks Prowlarr for better or newer releases, and lets you either pick updates manually or automate the whole flow.

## How It Works

```
1. Sync Library      →   Repackarr imports the games you already have in qBittorrent.
2. Check for Updates →   It keeps looking for newer releases in the background and you can also scan anytime.
3. Update Your Games →   Review releases on the Dashboard or turn on AutoDL for hands-off upgrades.
4. Stay Informed     →   Notifications tell you when AutoDL succeeds, fails, or skips a game.
```

## Screenshots

### Dashboard
![Repackarr Dashboard](static/screenshots/dashboard.png)

### Library
![Repackarr Library](static/screenshots/library.png)

### Settings
![Repackarr Settings](static/screenshots/settings.png)

## Features

- **Automatic Library Sync**: Pulls in the games you already manage in qBittorrent, so there is no big manual setup.
- **Smart Version Detection**: Reads version info from torrent titles and tracker pages across the major repack sources.
- **Automatic Update Checks**: Keeps an eye on your monitored games and looks for newer releases for you.
- **Auto-Download When You Want It**: Turn AutoDL on for the whole library or fine-tune it per game.
- **Notification Center**: See right away when an automatic download worked, failed, or was skipped.
- **Game Covers & Metadata**: Adds artwork and cleaner game info with IGDB support.
- **One-Click Updates**: Prefer manual control? Send a release to qBittorrent with one click.
- **Flexible Add Modes**: Choose between “I Want This Game” and “I Already Have It” when adding a title.
- **Skip & Ignore**: Hide releases you do not want and restore them later from the blacklist.
- **Scan History**: Review what past syncs and update checks found.

## Auto-Download & Notifications

- Turn **AutoDL** on from the **Library** page when you want Repackarr to grab updates for you.
- Leave it off if you prefer to review releases on the Dashboard first.
- You can still override AutoDL for each game:
  - **Use Global** → inherit the library-wide toggle
  - **Always** → auto-download updates for this game even if the global toggle is off
  - **Never** → keep this game manual even if the global toggle is on
- Notifications in the top bar let you know when Repackarr downloads an update, cannot send one to qBittorrent, or skips a game that is already downloading.

## Getting Started (Docker)

### Prerequisites
1. **qBittorrent**: WebUI must be enabled. Games you want to monitor should be in a dedicated category (default: `games`).
2. **Prowlarr**: At least one indexer configured. For the best results, **RuTracker.org** and **NoNaMe Club (NNM-Club)** are recommended.
3. **IGDB** *(Optional but recommended)*: Enables game covers and autocomplete search. Register a free app at the [Twitch Developer Portal](https://dev.twitch.tv/console) to get your credentials.

### 1. Create Directories
```bash
mkdir repackarr && cd repackarr
mkdir data logs
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your qBittorrent and Prowlarr details
```

### 3. Docker Compose
```yaml
services:
  repackarr:
    image: ghcr.io/yakrel/repackarr:latest
    container_name: repackarr
    restart: unless-stopped
    ports:
      - "8090:3000"
    env_file:
      - .env
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
```

### 4. Launch
```bash
docker compose up -d
```
Open `http://your-ip:8090` and hit **Sync Library** to get started.

After startup, Repackarr refreshes your library and begins checking for updates automatically.

## Configuration

All connection details are set via environment variables in your `.env` file:

| Variable | Default | Description |
|---|---|---|
| `QBIT_HOST` | — | qBittorrent WebUI URL (e.g. `http://192.168.1.10:8080`) |
| `QBIT_USERNAME` | — | qBittorrent username |
| `QBIT_PASSWORD` | — | qBittorrent password |
| `QBIT_CATEGORY` | `games` | The qBittorrent category to monitor |
| `PROWLARR_URL` | — | Prowlarr URL |
| `PROWLARR_API_KEY` | — | Prowlarr API key |
| `IGDB_CLIENT_ID` | (None) | *Recommended* — enables covers & autocomplete |
| `IGDB_CLIENT_SECRET` | (None) | *Recommended* — enables covers & autocomplete |
| `CRON_INTERVAL_MINUTES` | `360` | How often to scan for updates (in minutes) |
| `AUTH_USERNAME` | (None) | Enable Basic Auth for the UI |
| `AUTH_PASSWORD` | (None) | Enable Basic Auth for the UI |
| `DATA_DIR` | `/app/data` | Where app data is stored. For the bundled Docker setup, set this to `./data` in your `.env`. |
| `LOG_DIR` | `logs` | Where app logs are written. For the bundled Docker setup, set this to `./logs` in your `.env`. |

The following controls are managed from the UI:

- **Settings page**
  - **Ignored Keywords** — releases containing these keywords will be skipped globally.
  - **Allowed Indexers** — restrict searches to specific Prowlarr indexers.
  - **Default Platform** — Windows, Linux, or macOS.
- **Library page**
  - **Global Auto-Download** — enable or disable automatic downloading for monitored games.
  - **Per-game Auto-Download** — override the global AutoDL behavior for one title at a time.
  - **Add Game Mode** — choose between immediate search/download flow or track-only monitoring when adding a game manually.

## Troubleshooting

- **Games not found**: Try adjusting the "Search Query" for that game in the Library page to match how it appears on your indexer.
- **Indexer not working**: The name in **Allowed Indexers** must match exactly what Prowlarr shows.
- **Auto-download did not trigger**: Make sure AutoDL is enabled globally or for that specific game and that qBittorrent is reachable. If the game is already downloading, Repackarr will skip it and notify you.
- **Need more detail?**: Check the log files in `LOG_DIR`.
- **Database errors on startup**: Fix permissions with `chown -R 1000:1000 ./data`.
- **Reverse proxy**: Works with Nginx Proxy Manager and Traefik using a standard WebSocket-enabled config.

## License

GPL v3 License. See [LICENSE](LICENSE) for more information.

---
*Repackarr is a tool for managing your own library. Please support game developers whenever possible.*
