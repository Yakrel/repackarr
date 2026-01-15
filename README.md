# Repackarr

![Python 3.12](https://img.shields.io/badge/Python-3.12-blue?style=flat-square&logo=python)
![FastAPI](https://img.shields.io/badge/FastAPI-0.110-009688?style=flat-square&logo=fastapi)
![Docker](https://img.shields.io/badge/Docker-v24+-2496ED?style=flat-square&logo=docker)
![License](https://img.shields.io/badge/License-GPLv2-red?style=flat-square)

**Repackarr** is a self-hosted, "Library Update Monitor" for your game collection. It bridges the gap between your local **qBittorrent** library and **Prowlarr** indexers.

## 🎯 Project Goal & Philosophy

**Repackarr** is a self-hosted, Dockerized application designed to act as a **"Library Update Monitor"** for your game collection.

### The Goal
To automatically track games imported from a local **qBittorrent** instance and query **Prowlarr** for newer releases (repacks, updates, patches) based on upload dates.

### The Philosophy
**It is NOT an auto-downloader.**

Unlike traditional *arr apps that automate the entire grab-and-download process, Repackarr provides a **"Dashboard of Opportunities"**. It identifies potential upgrades but strictly respects the "human in the loop" principle. The user must manually review and confirm updates before any action is taken, ensuring you maintain full control over your library's versioning.

## ✨ Features

- **🔄 Auto-Import:** Automatically syncs your existing game library from qBittorrent.
- **🔍 Smart Scanning:** Periodically queries Prowlarr for new releases (repacks, updates, patches).
- **🧠 Intelligent Parsing:** Uses `guessit` to understand release names and versions (e.g., v1.0 vs v1.2).
- **🛡️ Filters:** Built-in protection against false positives (Mac/PS5 versions, OSTs, Wallpapers).
- **⚡ Performance:** Fully async architecture powered by Python 3.12, FastAPI, and SQLModel.
- **🎨 Modern UI:** Lightweight, responsive interface built with HTMX and TailwindCSS (No Node.js required).

## 🚀 Getting Started

### Prerequisites

- Docker & Docker Compose
- qBittorrent (Enabled WebUI)
- Prowlarr (Configured with Indexers)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/berkayyetgin/repackarr.git
   cd repackarr
   ```

2. Configure environment variables in `docker-compose.yml`:

   ```yaml
   environment:
     - QBIT_HOST=http://192.168.1.100:8080
     - QBIT_USERNAME=admin
     - QBIT_PASSWORD=adminadmin
     - PROWLARR_URL=http://192.168.1.100:9696
     - PROWLARR_API_KEY=your_prowlarr_api_key
     - CRON_INTERVAL_MINUTES=60
     # Optional Auth for Dashboard
     - AUTH_USERNAME=admin
     - AUTH_PASSWORD=secret
   ```

3. Start the container:
   ```bash
   docker-compose up -d
   ```

4. Access the dashboard at `http://localhost:80` (or your server IP).

## 🛠️ Configuration Options

| Variable | Description | Default |
|----------|-------------|---------|
| `QBIT_CATEGORY` | The category in qBittorrent to monitor. | `games` |
| `PLATFORM_FILTER`| Whitelist for platforms. | `Windows,Linux` |
| `IGNORED_KEYWORDS`| Terms to strictly exclude. | `OST,Soundtrack,Wallpaper` |

## 🏗️ Architecture

- **Backend:** FastAPI (Async Python)
- **Database:** SQLite (via SQLModel)
- **Frontend:** Server-Side Rendered Jinja2 + HTMX for dynamic interactions.
- **Scanning Strategy:**
  1. Syncs "Completion Date" of torrents from qBittorrent.
  2. Searches Prowlarr for uploads *newer* than that date.
  3. Groups results by Game ID for easy comparison.

## 🤝 Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## 📄 License

This project is licensed under the **GPLv2 License** - see the [LICENSE](LICENSE) file for details.

Copyright (c) 2026 **Berkay Yetgin**.
