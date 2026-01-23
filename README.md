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

### Initial Configuration via .env

While many settings can be changed in the UI, initial connection details and authentication are set in `.env`:

| Variable | Description | Example |
|----------|-------------|---------|
| `QBIT_HOST` | qBittorrent WebUI URL | `http://192.168.1.100:8080` |
| `QBIT_USERNAME` | qBittorrent username | `admin` |
| `QBIT_PASSWORD` | qBittorrent password | `your_password` |
| `AUTH_USERNAME` | Dashboard auth username | `admin` (Optional) |
| `AUTH_PASSWORD` | Dashboard auth password | `secret` (Optional) |
| `QBIT_CATEGORY` | qBittorrent category | `games` |
| `ALLOWED_INDEXERS` | Comma-separated tracker list | `NoNaMe Club, RuTracker.org` |

### Tracker Filtering

Repackarr uses a **whitelist-only** approach for trackers. Only the trackers specified in `ALLOWED_INDEXERS` will be searched. This provides:
- **Faster searches**: Only your preferred trackers are queried
- **No timeouts**: Avoids slow or unresponsive trackers
- **Bandwidth efficiency**: No wasted API calls to unwanted sources

The tracker names are matched using case-insensitive substring matching against your Prowlarr indexer names.

## 📋 Features

- **Dashboard**: View all available updates with live statistics and **Activity Logs**.
- **Dynamic Settings**: Change Prowlarr URL, API keys, Scan Intervals, and filters directly from the UI without restarting.
- **Library Management**: Track games from qBittorrent with monitoring controls.
- **Smart Detection**: Automatically strips release group tags (CODEX, NECROS, etc.) for cleaner game titles.
- **Improved Game Matching**: Advanced IGDB integration to accurately find covers for main games (ignoring DLCs/VR versions if needed).
- **Pre-Filtered Tracker Search**: Searches only your whitelisted trackers at the Prowlarr API level for faster results and no timeouts.
- **Auto-Refresh**: Real-time statistics updates via HTMX.
- **Scan History**: View detailed logs of previous scans, including how many updates were found and any errors encountered.
- **Flexible Filtering**: Platform and keyword filtering for targeted results.

## 🎯 How It Works

1. **Sync**: Repackarr scans your qBittorrent for games in the specified category.
2. **Detect**: Game titles are parsed and cleaned (e.g., "Green Hell-NECROS" → "Green Hell").
3. **Monitor**: Games are added to your library. You can "Monitor" or "Ignore" specific titles.
4. **Search**: Prowlarr is queried periodically (configurable) for newer releases based on your platform/keyword filters.
5. **Review**: You review found releases on the Dashboard and manually decide which to download.

## 🔧 Settings & Configuration

Repackarr uses a hybrid configuration approach:

1.  **Environment Variables (.env)**: Used for sensitive credentials (qBittorrent login, Web Auth) and initial bootstrap.
2.  **UI Settings (Database)**: Used for runtime configuration (Prowlarr details, Intervals, IGDB keys).

**Note:** Settings changed in the UI are saved to the database and will **override** the values in your `.env` file. This allows you to tweak scan intervals or API keys instantly without restarting the container.

## 📄 License
GPLv2 License - Copyright (c) 2026 **Berkay Yetgin**.