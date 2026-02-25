# Repackarr: AI Context & Development Guide

Repackarr is an automated manager for game repacks, designed to track updates and simplify library maintenance. It integrates with **qBittorrent** for library monitoring, **Prowlarr** for release discovery, and **IGDB** for metadata enrichment.

## Project Overview

*   **Type:** SvelteKit 5 Full-stack Application.
*   **Runtime:** Node.js (Adapter-Node).
*   **Database:** SQLite via `better-sqlite3` and `Drizzle ORM`.
*   **Styling:** Tailwind CSS v4.
*   **Primary Logic:** Server-side services for API integration and background task scheduling.

## Technical Architecture

### Core Services (`src/lib/server/`)
*   **`manager.ts`**: The central orchestrator. Handles the high-level logic for library synchronization and update searching.
*   **`qbit.ts`**: Manages the connection to qBittorrent. Filters torrents by category and extracts version information.
*   **`prowlarr.ts`**: Interfaces with Prowlarr's API to search indexers, parse releases, and handle version comparisons.
*   **`igdb.ts`**: Handles game metadata lookups (covers, Steam IDs, release dates).
*   **`scheduler.ts`**: Manages background tasks using `node-cron`. Initialized in `hooks.server.ts`.
*   **`progress.ts`**: A singleton manager for tracking real-time progress of long-running scans.

### Data Model (`src/lib/server/schema.ts`)
*   **`games`**: Tracks owned games, their current versions, and IGDB metadata.
*   **`releases`**: Stores discovered updates found via Prowlarr.
*   **`appSettings`**: Key-value store for UI-managed configuration (e.g., ignored keywords).
*   **`scanLogs`**: History of library syncs and update searches.

## Development Workflow

### Git & Identity
**Crucial:** Follow these identity settings for all commits:
*   **Name:** Berkay Yetgin
*   **Email:** 85676216+Yakrel@users.noreply.github.com
*   **Commit Style:** Clean messages, no AI-generated metadata or trailers.

### Testing & QA
The parsing logic (extracting versions from release names) is the most sensitive part of the app.
*   **Mandatory Test:** Run `npx tsx tests/test_parsing.ts` before every commit.
*   **Goal:** Maintain **100% Accuracy** against the `tests/torrent_examples.json` dataset.

### Setup & Installation
```bash
pnpm install
cp .env.example .env # Configure your qBit/Prowlarr details
```

### Database Management
Repackarr uses Drizzle Kit for schema management.
*   **Push Schema:** `pnpm db:push` (Directly updates the local SQLite database).
*   **Generate Migrations:** `pnpm db:generate` (Required for schema changes).
*   **Studio:** `pnpx drizzle-kit studio` (Visual DB explorer).

### Running the App
*   **Development:** `pnpm dev`
*   **Production Build:** `pnpm build && node build`
*   **Check/Lint:** `pnpm check`

## Key Conventions

1.  **Server Logic:** Keep heavy business logic in `src/lib/server/` services. Routes should primarily act as thin controllers.
2.  **Type Safety:** Use Zod schemas (found in `src/lib/server/validators.ts`) for validating API inputs and settings.
3.  **Logging:** Use the centralized `logger` (Winston) in `src/lib/server/logger.ts` instead of `console.log`.
4.  **Svelte 5:** The project uses Svelte 5 (Runes). Prefer `$state`, `$derived`, and `$effect` for reactivity.
5.  **Environment Variables:** Defined in `src/lib/server/config.ts`. Ensure new variables are added there and to `.env.example`.

## Integration Points

*   **qBittorrent:** Expects a specific category (default: `games`) to monitor.
*   **Prowlarr:** Requires an API key and the base URL.
*   **IGDB:** Requires `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` for covers and search autocomplete.

## Common Tasks for AI

*   **Adding a Filter:** Modify the parsing logic in `src/lib/server/prowlarr.ts` or update default keywords in `src/lib/server/config.ts`.
*   **New API Endpoint:** Create a new folder in `src/routes/api/` with a `+server.ts` file.
*   **Schema Change:** Update `src/lib/server/schema.ts` and run `pnpm db:push`.
*   **UI Update:** Modify components in `src/lib/server/components/ui/` or pages in `src/routes/`.
