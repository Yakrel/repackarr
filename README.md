# Repackarr

![Python 3.12](https://img.shields.io/badge/Python-3.12-blue?style=flat-square&logo=python)
![FastAPI](https://img.shields.io/badge/FastAPI-0.110-009688?style=flat-square&logo=fastapi)
![Docker](https://img.shields.io/badge/Docker-v24+-2496ED?style=flat-square&logo=docker)
![License](https://img.shields.io/badge/License-GPLv2-red?style=flat-square)

**Repackarr** is a self-hosted "Library Update Monitor" for your game collection. It bridges the gap between your local **qBittorrent** library and **Prowlarr** indexers.

## 🎯 Project Goal & Philosophy

**Repackarr** acts as a **"Library Update Monitor"**. It automatically tracks games imported from a local **qBittorrent** instance and queries **Prowlarr** for newer releases (repacks, updates, patches).

### The Philosophy: It is NOT an auto-downloader.
Unlike traditional *arr apps, Repackarr provides a **"Dashboard of Opportunities"**. It identifies potential upgrades but strictly respects the "human in the loop" principle. You must manually review and confirm updates.

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- qBittorrent with WebUI enabled
- Prowlarr with configured indexers
- (Optional) IGDB API credentials for game covers

### Installation

1. Download `docker-compose.yml` and `.env.example` from this repository

2. Rename and configure `.env.example` → `.env` with your settings

3. Start the container:
   ```bash
   docker-compose up -d
   ```

4. Access at `http://localhost:8090`

5. Navigate to Settings page to test your connections

### Required Settings

Edit `.env` file with your values:

| Variable | Description | Example |
|----------|-------------|---------|
| `QBIT_HOST` | qBittorrent WebUI URL | `http://192.168.1.100:8080` |
| `QBIT_USERNAME` | qBittorrent username | `admin` |
| `QBIT_PASSWORD` | qBittorrent password | `your_password` |
| `PROWLARR_URL` | Prowlarr instance URL | `http://192.168.1.100:9696` |
| `PROWLARR_API_KEY` | Prowlarr API key (Settings → General) | `abc123...` |

### Optional Settings

All settings have sensible defaults. Configure in `.env` if needed:

| Variable | Description | Default |
|----------|-------------|---------|
| `QBIT_CATEGORY` | qBittorrent category to monitor | `games` |
| `CRON_INTERVAL_MINUTES` | Scan frequency (minutes) | `60` |
| `PLATFORM_FILTER` | Allowed platforms | `Windows,Linux` |
| `IGNORED_KEYWORDS` | Excluded keywords | `OST,Soundtrack,Wallpaper,Update Only,Crack Only` |
| `AUTH_USERNAME` | Dashboard auth username | `None` (disabled) |
| `AUTH_PASSWORD` | Dashboard auth password | `None` (disabled) |
| `IGDB_CLIENT_ID` | IGDB API client ID (for game covers) | `None` (disabled) |
| `IGDB_CLIENT_SECRET` | IGDB API client secret (for game covers) | `None` (disabled) |
| `TZ` | Timezone | `UTC` |

## 📋 Features

- **Dashboard**: View all available updates at a glance with live statistics
- **Library Management**: Track games from qBittorrent with monitoring controls
- **Smart Detection**: Automatically strips release group tags (CODEX, NECROS, etc.) for cleaner game titles
- **Auto-Refresh**: Real-time statistics updates without page refresh (10s polling)
- **Settings Page**: Test connections and view configuration
- **Game Covers**: Optional IGDB integration for game artwork
- **Flexible Filtering**: Platform and keyword filtering for targeted results

## 🎯 How It Works

1. **Sync**: Repackarr scans your qBittorrent for games in the specified category
2. **Detect**: Game titles are intelligently parsed and cleaned (e.g., "Green Hell-NECROS" → "Green Hell")
3. **Monitor**: Games are added to your library and monitored for updates
4. **Search**: Prowlarr is queried periodically for newer releases
5. **Review**: You review and manually decide which updates to download

## 🔧 Settings

Access the Settings page from the navigation menu to:
- Test qBittorrent connection
- Test Prowlarr connection  
- View current configuration
- Check IGDB integration status

All configuration is done via environment variables. Changes require a container restart.

## 📄 License
GPLv2 License - Copyright (c) 2026 **Berkay Yetgin**.
