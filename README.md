# Repackarr

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Docker Image](https://img.shields.io/badge/docker-ghcr.io%2Fyakrel%2Frepackarr-blue?logo=docker)](https://ghcr.io/yakrel/repackarr)

**Repackarr** is a self-hosted companion for qBittorrent and Prowlarr that helps keep a game repack library up to date.

Repackarr is designed for and tested exclusively with **RuTracker.org** and **NoNaMe Club (NNM-Club)** release formats. Other Prowlarr indexers are not supported, and title parsing or version matching will likely fail outside these two trackers.

## Screenshots

*Note: Screenshots may display slightly older versions of the user interface, but the core layout and features remain identical.*

### Dashboard
![Repackarr Dashboard](static/screenshots/dashboard.png)

### Library
![Repackarr Library](static/screenshots/library.png)

### Settings
![Repackarr Settings](static/screenshots/settings.png)

## Features

- **qBittorrent library sync**: Imports games from a dedicated qBittorrent category.
- **Prowlarr update search**: Checks your configured RuTracker and NNM-Club indexers for newer matching releases.
- **Manual update review**: Confirm, ignore, skip, or send releases to qBittorrent from the dashboard.
- **AutoDL support**: Automatically download eligible updates globally or per game.
- **Per-game controls**: Tune search queries, platform filters, ignored keywords, and AutoDL behavior.
- **IGDB metadata**: Optional cover art, cleaner titles, and autocomplete support.
- **Notifications**: See when automatic downloads succeed, fail, or are skipped.
- **Scan history**: Review recent sync and update checks, including skipped release reasons.
- **Basic Auth**: Optional username/password protection for the web UI.

## How It Works

1. Repackarr reads torrents from your configured qBittorrent category.
2. It creates a monitored game library from those torrents.
3. It searches Prowlarr for newer matching releases.
4. Matching releases appear on the dashboard for review.
5. If AutoDL is enabled, Repackarr can send the best eligible release to qBittorrent automatically.

The first full scan runs shortly after startup, then recurring scans run on the configured interval. You can also start a sync or update check from the UI at any time.

## Requirements

- **qBittorrent** with WebUI enabled.
- **Prowlarr** with RuTracker.org and/or NoNaMe Club configured.
- **Docker Compose** for the recommended setup.
- **IGDB credentials** are optional, but recommended for covers and autocomplete.

For best results, keep the games you want Repackarr to monitor in a dedicated qBittorrent category. The default category is `games`.

## Docker Compose

Create a folder for Repackarr:

```bash
mkdir repackarr
cd repackarr
mkdir data logs
```

Create a `.env` file:

```env
QBIT_HOST=http://192.168.1.100:8080
QBIT_USERNAME=admin
QBIT_PASSWORD=adminadmin
QBIT_CATEGORY=games

PROWLARR_URL=http://192.168.1.100:9696
PROWLARR_API_KEY=your_prowlarr_api_key

IGDB_CLIENT_ID=
IGDB_CLIENT_SECRET=

AUTH_USERNAME=
AUTH_PASSWORD=

CRON_INTERVAL_MINUTES=360
STARTUP_SCAN_DELAY_SECONDS=120

DATA_DIR=./data
LOG_DIR=./logs
```

Edit `.env` with your qBittorrent and Prowlarr details.

Use this `docker-compose.yml`:

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
    environment:
      - TZ=Europe/Istanbul
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
```

Start the container:

```bash
docker compose up -d
```

Open `http://your-server-ip:8090` and use **Sync Library** to import your qBittorrent games.

## Configuration

All core connection settings are configured through `.env`.

| Variable | Default | Description |
|---|---:|---|
| `QBIT_HOST` | - | qBittorrent WebUI URL, for example `http://192.168.1.10:8080` |
| `QBIT_USERNAME` | - | qBittorrent username |
| `QBIT_PASSWORD` | - | qBittorrent password |
| `QBIT_CATEGORY` | `games` | qBittorrent category to monitor |
| `PROWLARR_URL` | - | Prowlarr URL |
| `PROWLARR_API_KEY` | - | Prowlarr API key |
| `IGDB_CLIENT_ID` | - | Optional IGDB client ID for covers and autocomplete |
| `IGDB_CLIENT_SECRET` | - | Optional IGDB client secret |
| `AUTH_USERNAME` | - | Enables Basic Auth when set with `AUTH_PASSWORD` |
| `AUTH_PASSWORD` | - | Enables Basic Auth when set with `AUTH_USERNAME` |
| `CRON_INTERVAL_MINUTES` | `360` | Recurring scan interval, from 5 to 1440 minutes |
| `STARTUP_SCAN_DELAY_SECONDS` | `120` | Delay before the startup scan, from 0 to 3600 seconds |
| `DATA_DIR` | `/app/data` | App database location inside the container |
| `LOG_DIR` | `logs` | Log file location inside the container |

With the Docker Compose example above, `DATA_DIR=./data` and `LOG_DIR=./logs` resolve inside the container to the mounted `/app/data` and `/app/logs` folders. The database and logs are stored on your host in `./data` and `./logs`, so they survive container updates.

The following settings are managed from the web UI:

- Ignored keywords
- Allowed Prowlarr indexers
- Default platform
- Global AutoDL
- Per-game AutoDL overrides
- Per-game search queries and filters

## Notes

- Repackarr is built specifically for RuTracker.org and NoNaMe Club release formats. Other trackers are not supported out-of-the-box.
- Prowlarr indexer names in **Allowed Indexers** must match the exact names shown in Prowlarr.
- IGDB is optional. Repackarr still works without it, but game covers and title autocomplete will not be available.
- The title parser is validated against a dataset of real release names (`tests/torrent_examples.json`) to maintain accuracy.

## Troubleshooting

- **No games are imported**: Check that qBittorrent WebUI works and your torrents are in the configured category.
- **No releases are found**: Adjust the game's search query in the Library page and confirm your RuTracker/NNM-Club indexers work in Prowlarr.
- **Allowed indexer does not match**: Use the exact indexer name shown in Prowlarr.
- **AutoDL does not run**: Check that AutoDL is enabled globally or for the game, and that qBittorrent is reachable.
- **Progress does not update behind a reverse proxy**: Make sure response streaming / Server-Sent Events are not buffered for `/api/scan/progress`.
- **Database permission errors**: Make sure the mounted `data` folder is writable by the container.
- **Need more detail**: Check the Repackarr log files in the configured `LOG_DIR`.

## License

GPL v3 License. See [LICENSE](LICENSE) for more information.

---

Repackarr is a tool for managing your own library. Please support game developers whenever possible.
