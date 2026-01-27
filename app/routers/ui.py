"""
UI Router - Web interface endpoints for Repackarr.
"""
import json
import logging
import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Form, HTTPException
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from fastapi import Request
from sqlmodel import Session, select, func
from app.database import get_session
from app.models import Game, Release, GameStatus, AppSetting, ScanLog, IgnoredRelease
from app.services.manager import run_scan_cycle, run_sync_library, run_search_updates
from app.services.prowlarr import ProwlarrService
from app.services.qbit import QBitService
from app.config import get_settings
from app.scheduler import scheduler
from app.progress import progress_manager

logger = logging.getLogger("repackarr")
router = APIRouter()
templates = Jinja2Templates(directory="app/templates")
settings = get_settings()


def get_dashboard_stats(session: Session) -> dict:
    """Get statistics for the dashboard."""
    total_games = session.exec(select(func.count(Game.id))).one()
    monitored_games = session.exec(
        select(func.count(Game.id)).where(Game.status == GameStatus.MONITORED)
    ).one()
    pending_updates = session.exec(
        select(func.count(Release.id)).where(Release.is_ignored == False)
    ).one()
    
    return {
        "total_games": total_games,
        "monitored_games": monitored_games,
        "pending_updates": pending_updates
    }


def get_updates_data(session: Session) -> list:
    """
    Get all pending updates grouped by game.
    
    Returns list of dicts containing game and its releases.
    """
    statement = (
        select(Release, Game)
        .join(Game)
        .where(Release.is_ignored.is_(False))
        .order_by(Game.title, Release.upload_date.desc())
    )
    results = session.exec(statement).all()
    
    grouped_updates = {}
    for release, game in results:
        if game.id not in grouped_updates:
            grouped_updates[game.id] = {"game": game, "releases": []}
        grouped_updates[game.id]["releases"].append(release)
    
    return list(grouped_updates.values())


from app.utils import extract_version

@router.post("/release/force-add", response_class=HTMLResponse)
async def force_add_release(
    game_id: int = Form(...),
    title: str = Form(...),
    indexer: str = Form(...),
    magnet_url: str = Form(None),
    info_url: str = Form(None),
    size: str = Form(None),
    date: str = Form(None),
    session: Session = Depends(get_session)
):
    """Force add a release from the skipped list."""
    game = session.get(Game, game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
        
    # Check if already exists to prevent duplicates (though user forced it, maybe we should allow? 
    # But unique constraint might fail. Let's check.)
    existing = session.exec(
        select(Release).where(
            Release.raw_title == title,
            Release.game_id == game_id
        )
    ).first()
    
    if existing:
        return HTMLResponse(
            '<span class="text-amber-400 text-xs">Already exists</span>'
        )
        
    # Parse date
    upload_date = datetime.utcnow()
    if date and date != "N/A":
        for fmt in ('%Y-%m-%d %H:%M', '%Y-%m-%d'):
            try:
                upload_date = datetime.strptime(date, fmt)
                break
            except ValueError:
                continue
            
    # Extract version
    parsed_version = extract_version(title)
    
    release = Release(
        game_id=game_id,
        raw_title=title,
        parsed_version=parsed_version,
        upload_date=upload_date,
        indexer=indexer,
        magnet_url=magnet_url,
        info_url=info_url,
        size=size,
        is_ignored=False
    )
    
    session.add(release)
    session.commit()
    
    return HTMLResponse(
        '<span class="text-emerald-400 text-xs font-bold">✓ Added</span>',
        headers={"HX-Trigger": "updates-changed, stats-changed"}
    )


# ============================================
# Page Routes
# ============================================

@router.get("/", response_class=HTMLResponse)
async def dashboard(request: Request, session: Session = Depends(get_session)):
    """Main dashboard showing available updates."""
    updates = get_updates_data(session)
    stats = get_dashboard_stats(session)
    
    # Get recent logs
    logs = session.exec(select(ScanLog).order_by(ScanLog.started_at.desc()).limit(5)).all()
    
    return templates.TemplateResponse(
        "dashboard.html", 
        {
            "request": request, 
            "updates": updates, 
            "stats": stats,
            "logs": logs,
            "page": "dashboard",
            "settings": settings
        }
    )


@router.get("/log/{id}/details", response_class=HTMLResponse)
async def get_log_details(id: int, request: Request, session: Session = Depends(get_session)):
    """HTMX partial: Returns details for a specific log."""
    log = session.get(ScanLog, id)
    if not log:
        return HTMLResponse("Log not found", status_code=404)
        
    details = {}
    if log.details:
        try:
            details = json.loads(log.details)
        except:
            details = {"error": "Could not parse details"}
    
    skip_summary = {}
    if log.skip_details:
        try:
            skip_summary = json.loads(log.skip_details)
        except:
            skip_summary = {}
            
    return templates.TemplateResponse(
        "partials/log_details_modal.html",
        {
            "request": request,
            "log": log,
            "details": details,
            "skip_summary": skip_summary
        }
    )


@router.get("/library", response_class=HTMLResponse)
async def library(request: Request, session: Session = Depends(get_session)):
    """Library page showing all games."""
    games = session.exec(select(Game).order_by(Game.title)).all()
    stats = get_dashboard_stats(session)
    
    return templates.TemplateResponse(
        "library.html", 
        {
            "request": request, 
            "games": games, 
            "stats": stats,
            "page": "library",
            "settings": settings
        }
    )


@router.get("/settings", response_class=HTMLResponse)
async def settings_page(request: Request, session: Session = Depends(get_session)):
    """Settings page showing configuration."""
    # Get ignored releases with game info
    ignored_releases = session.exec(
        select(IgnoredRelease, Game)
        .join(Game, IgnoredRelease.game_id == Game.id)
        .order_by(IgnoredRelease.ignored_at.desc())
    ).all()
    
    return templates.TemplateResponse(
        "settings.html", 
        {
            "request": request, 
            "page": "settings",
            "settings": settings,
            "ignored_releases": ignored_releases
        }
    )

@router.post("/settings/save", response_class=HTMLResponse)
async def save_settings(
    request: Request,
    CRON_INTERVAL_MINUTES: int = Form(...),
    PROWLARR_URL: str = Form(...),
    PROWLARR_API_KEY: str = Form(...),
    IGDB_CLIENT_ID: str = Form(""),
    IGDB_CLIENT_SECRET: str = Form(""),
    PLATFORM_FILTER: str = Form(...),
    IGNORED_KEYWORDS: str = Form(""),
    ALLOWED_INDEXERS: str = Form(""),
    session: Session = Depends(get_session)
):
    """Save settings to database and update runtime config."""
    form_data = {
        "CRON_INTERVAL_MINUTES": str(CRON_INTERVAL_MINUTES),
        "PROWLARR_URL": PROWLARR_URL,
        "PROWLARR_API_KEY": PROWLARR_API_KEY,
        "IGDB_CLIENT_ID": IGDB_CLIENT_ID,
        "IGDB_CLIENT_SECRET": IGDB_CLIENT_SECRET,
        "PLATFORM_FILTER": PLATFORM_FILTER,
        "IGNORED_KEYWORDS": IGNORED_KEYWORDS,
        "ALLOWED_INDEXERS": ALLOWED_INDEXERS
    }
    
    # Update DB
    for key, value in form_data.items():
        setting = session.get(AppSetting, key)
        if not setting:
            setting = AppSetting(key=key, value=value)
        else:
            setting.value = value
            setting.updated_at = datetime.utcnow()
        session.add(setting)
    
    session.commit()
    
    # Update Runtime Config
    old_interval = settings.CRON_INTERVAL_MINUTES
    old_allowed_indexers = settings.ALLOWED_INDEXERS
    
    settings.CRON_INTERVAL_MINUTES = CRON_INTERVAL_MINUTES
    settings.PROWLARR_URL = PROWLARR_URL
    settings.PROWLARR_API_KEY = PROWLARR_API_KEY
    settings.IGDB_CLIENT_ID = IGDB_CLIENT_ID or None
    settings.IGDB_CLIENT_SECRET = IGDB_CLIENT_SECRET or None
    settings.PLATFORM_FILTER = PLATFORM_FILTER
    settings.IGNORED_KEYWORDS = IGNORED_KEYWORDS
    settings.ALLOWED_INDEXERS = ALLOWED_INDEXERS
    
    # Refresh Prowlarr indexer cache if allowed indexers changed
    if old_allowed_indexers != ALLOWED_INDEXERS:
        prowlarr = ProwlarrService()
        await prowlarr.refresh_indexer_cache()
    
    # Reschedule if interval changed
    if old_interval != CRON_INTERVAL_MINUTES:
        try:
            scheduler.reschedule_job(
                'scan_job', 
                trigger='interval', 
                minutes=CRON_INTERVAL_MINUTES
            )
        except Exception as e:
            # Job might not exist yet or error
            pass
            
    return templates.TemplateResponse(
        "settings.html", 
        {
            "request": request, 
            "page": "settings", 
            "settings": settings,
            "success": True
        }
    )


@router.post("/ignored/{ignored_id}/restore", response_class=HTMLResponse)
async def restore_ignored_release(ignored_id: int, session: Session = Depends(get_session)):
    """Remove a release from the ignored list."""
    ignored = session.get(IgnoredRelease, ignored_id)
    if not ignored:
        raise HTTPException(status_code=404, detail="Ignored release not found")
    
    session.delete(ignored)
    session.commit()
    
    return HTMLResponse("")  # HTMX will remove the row


# ============================================
# HTMX Partial Routes
# ============================================

@router.get("/stats-cards", response_class=HTMLResponse)
async def stats_cards(request: Request, session: Session = Depends(get_session)):
    """HTMX partial: Returns updated stats cards."""
    stats = get_dashboard_stats(session)
    
    return templates.TemplateResponse(
        "partials/stats_cards.html",
        {
            "request": request,
            "stats": stats,
            "page": request.headers.get("Hx-Current-Url", "").split("/")[-1] or "dashboard",
            "settings": settings
        }
    )


@router.get("/updates-list", response_class=HTMLResponse)
async def updates_list(request: Request, session: Session = Depends(get_session)):
    """HTMX partial: Returns updated list of pending updates."""
    updates = get_updates_data(session)
    stats = get_dashboard_stats(session)
    
    return templates.TemplateResponse(
        "partials/updates_list.html", 
        {"request": request, "updates": updates, "stats": stats}
    )


@router.get("/activity-log", response_class=HTMLResponse)
async def activity_log(request: Request, session: Session = Depends(get_session)):
    """HTMX partial: Returns updated activity log."""
    logs = session.exec(select(ScanLog).order_by(ScanLog.started_at.desc()).limit(5)).all()
    
    return templates.TemplateResponse(
        "partials/activity_log.html",
        {"request": request, "logs": logs}
    )


# ============================================
# Release Actions
# ============================================

@router.post("/release/{id}/download", response_class=HTMLResponse)
async def download_release(id: int, session: Session = Depends(get_session)):
    """
    Send the release magnet/link to the download client (qBittorrent).
    """
    logger.info(f"Download requested for release {id}")
    release = session.get(Release, id)
    if not release:
        logger.error(f"Release {id} not found")
        raise HTTPException(status_code=404, detail="Release not found")
        
    magnet = release.magnet_url or release.info_url
    if not magnet:
        logger.warning(f"No magnet/info URL for release {id}")
        return HTMLResponse(
            '<span class="text-red-400 text-xs">No link available</span>'
        )
    
    logger.info(f"Sending to qBittorrent: {magnet[:100]}...")
    qbit = QBitService()
    try:
        success = await qbit.add_torrent(magnet)
        if success:
            logger.info(f"Successfully sent release {id} to qBittorrent")
            return HTMLResponse(
                '<span class="text-emerald-400 text-xs font-bold flex items-center gap-1">✓ Sent to Client</span>'
            )
        else:
            logger.error(f"Failed to send release {id} to qBittorrent")
            return HTMLResponse(
                '<span class="text-red-400 text-xs">Failed to send</span>'
            )
    except Exception as e:
        logger.error(f"Exception downloading release {id}: {e}")
        return HTMLResponse(
            f'<span class="text-red-400 text-xs">Error: {str(e)[:50]}</span>'
        )
    finally:
        await qbit.close()


@router.post("/release/{id}/ignore", response_class=HTMLResponse)
async def ignore_release_permanently(id: int, session: Session = Depends(get_session)):
    """
    Permanently ignore a release - adds to ignore list and removes from updates.
    Future scans will skip this release.
    """
    release = session.get(Release, id)
    if not release:
        raise HTTPException(status_code=404, detail="Release not found")
    
    # Add to ignored releases table
    ignored = IgnoredRelease(
        game_id=release.game_id,
        release_title=release.raw_title,
        raw_title=release.raw_title
    )
    
    try:
        session.add(ignored)
        session.delete(release)  # Remove from releases
        session.commit()
        return HTMLResponse("", headers={"HX-Trigger": "stats-changed"})
    except Exception as e:
        session.rollback()
        # If duplicate, just delete the release
        session.delete(release)
        session.commit()
        return HTMLResponse("", headers={"HX-Trigger": "stats-changed"})


@router.post("/release/{id}/confirm", response_class=HTMLResponse)
async def confirm_update(id: int, session: Session = Depends(get_session)):
    """
    Confirm that user has updated to this release.
    Updates the game's version date and clears all releases.
    """
    release = session.get(Release, id)
    if not release:
        raise HTTPException(status_code=404, detail="Release not found")
    
    game = session.get(Game, release.game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    
    # Update game's version info
    game.current_version_date = release.upload_date
    if release.parsed_version:
        game.current_version = release.parsed_version
    session.add(game)
    
    # Delete ALL releases for this game (clean slate)
    # Next scan will find newer releases automatically based on the new version date
    releases_to_delete = session.exec(
        select(Release).where(Release.game_id == game.id)
    ).all()
    
    for r in releases_to_delete:
        session.delete(r)
        
    session.commit()
    
    return HTMLResponse("", headers={"HX-Refresh": "true"})


# ============================================
# Game Actions
# ============================================

@router.post("/game/{id}/update-query", response_class=HTMLResponse)
async def update_game_query(
    id: int, 
    search_query: str = Form(...), 
    session: Session = Depends(get_session)
):
    """Update the search query for a game."""
    game = session.get(Game, id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    
    game.search_query = search_query.strip()
    session.add(game)
    session.commit()
    
    return HTMLResponse(
        f'<span class="text-green-400 text-xs">✓ Saved</span>',
        headers={"HX-Trigger": "query-saved"}
    )


@router.post("/game/{id}/update-details", response_class=HTMLResponse)
async def update_game_details(
    id: int,
    title: str = Form(...),
    search_query: str = Form(...),
    version_date: str = Form(...),
    version: str = Form(""),
    platform_filter: str = Form("Windows"),
    session: Session = Depends(get_session)
):
    """Update game details including platform filter."""
    game = session.get(Game, id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    
    # Parse version date
    try:
        # datetime-local sends YYYY-MM-DDTHH:MM
        if 'T' in version_date:
            parsed_date = datetime.fromisoformat(version_date)
        else:
            parsed_date = datetime.strptime(version_date, '%Y-%m-%d')
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Please use YYYY-MM-DD HH:mm format.")
    
    # Update game fields
    game.title = title.strip().title()
    game.search_query = search_query.strip()
    game.current_version_date = parsed_date
    game.current_version = version.strip() if version else None
    game.platform_filter = platform_filter
    
    session.add(game)
    session.commit()
    
    return HTMLResponse("", headers={"HX-Refresh": "true"})


@router.post("/game/{id}/reset-scan", response_class=HTMLResponse)
async def reset_game_scan(id: int, session: Session = Depends(get_session)):
    """Clear existing releases and trigger a fresh Prowlarr search."""
    game = session.get(Game, id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    # Delete existing releases
    releases = session.exec(
        select(Release).where(Release.game_id == id)
    ).all()
    for release in releases:
        session.delete(release)
    session.commit()

    # Trigger immediate search
    prowlarr = ProwlarrService()
    try:
        await prowlarr.search_for_game(game.id)
    finally:
        await prowlarr.close()

    return HTMLResponse("", headers={"HX-Trigger": "updates-changed"})


@router.post("/game/{id}/toggle-monitor", response_class=HTMLResponse)
async def toggle_game_monitor(id: int, session: Session = Depends(get_session)):
    """Toggle game's monitoring status."""
    game = session.get(Game, id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    
    # Toggle status
    if game.status == GameStatus.MONITORED:
        game.status = GameStatus.IGNORED
    else:
        game.status = GameStatus.MONITORED
        
    session.add(game)
    session.commit()
    
    # Return the new status badge
    if game.status == GameStatus.MONITORED:
        return HTMLResponse("""
        <button class="group flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 hover:bg-emerald-500/30 hover:border-emerald-500/50 transition cursor-pointer shadow-sm hover:shadow-md">
            <span class="h-2 w-2 rounded-full bg-emerald-400 animate-pulse group-hover:animate-none"></span>
            <span class="text-xs font-semibold text-emerald-300 group-hover:text-emerald-200 uppercase tracking-wide">Monitored</span>
        </button>
        """, headers={"HX-Trigger": "stats-changed"})
    else:
        return HTMLResponse("""
        <button class="group flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-600/30 border border-slate-500/30 hover:bg-slate-500/40 hover:border-slate-500/50 transition cursor-pointer shadow-sm hover:shadow-md">
            <span class="h-2 w-2 rounded-full bg-slate-400 group-hover:bg-slate-300"></span>
            <span class="text-xs font-semibold text-slate-300 group-hover:text-slate-200 uppercase tracking-wide">Ignored</span>
        </button>
        """, headers={"HX-Trigger": "stats-changed"})


@router.delete("/game/{id}", response_class=HTMLResponse)
async def delete_game(id: int, session: Session = Depends(get_session)):
    """Delete a game from the library."""
    game = session.get(Game, id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
        
    session.delete(game)
    session.commit()
    
    return HTMLResponse("", headers={"HX-Trigger": "stats-changed"})  # HTMX removes the row


@router.post("/game/add-manual", response_class=HTMLResponse)
async def add_manual_game(
    request: Request,
    title: str = Form(...),
    search_query: str = Form(...),
    version_date: str = Form(...),
    platform_filter: str = Form("Windows"),
    session: Session = Depends(get_session)
):
    """
    Manually add a game to the library for tracking.
    This is for games not synced from qBittorrent.
    """
    from app.services.igdb import IGDBService
    
    # Validate inputs
    title = title.strip()
    search_query = search_query.strip()
    
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    if not search_query:
        raise HTTPException(status_code=400, detail="Search query is required")
    
    # Parse version date
    try:
        if 'T' in version_date:
            parsed_date = datetime.fromisoformat(version_date)
        else:
            parsed_date = datetime.strptime(version_date, '%Y-%m-%d')
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD HH:mm")
    
    # Check if game already exists
    existing_game = session.exec(
        select(Game).where(Game.title == title)
    ).first()
    
    if existing_game:
        raise HTTPException(status_code=400, detail="A game with this title already exists")
    
    # Try to fetch metadata from IGDB
    cover_url = None
    steam_app_id = None
    if settings.is_igdb_enabled:
        igdb = IGDBService()
        try:
            metadata = await igdb.get_game_metadata(title)
            if metadata:
                cover_url = metadata.get("cover_url")
                steam_app_id = metadata.get("steam_app_id")
        except Exception:
            pass
        finally:
            await igdb.close()
    
    # Create the game
    new_game = Game(
        title=title.title(),
        search_query=search_query,
        current_version_date=parsed_date,
        current_version=None,
        status=GameStatus.MONITORED,
        cover_url=cover_url,
        steam_app_id=steam_app_id,
        is_manual=True,
        platform_filter=platform_filter
    )
    session.add(new_game)
    session.commit()
    
    # Return success with refresh trigger
    return HTMLResponse(
        "",
        headers={"HX-Refresh": "true"}
    )


@router.get("/game/{game_id}/skipped", response_class=HTMLResponse)
async def get_game_skipped_releases(
    request: Request,
    game_id: int, 
    session: Session = Depends(get_session)
):
    """
    Get skipped releases for a specific game from the last scan.
    Returns HTML table rows for HTMX.
    """
    # Get the last scan log
    last_scan = session.exec(
        select(ScanLog)
        .where(ScanLog.skip_details.is_not(None))
        .order_by(ScanLog.started_at.desc())
    ).first()
    
    if not last_scan or not last_scan.skip_details:
        return HTMLResponse("""
            <tr>
                <td colspan="5" class="text-center text-dark-400 py-4">
                    No skipped releases found
                </td>
            </tr>
        """)
    
    try:
        all_skipped = json.loads(last_scan.skip_details)
        
        # all_skipped structure: [{"game": "Title", "game_id": 123, "items": [skip_info, ...]}]
        # Find data for this specific game
        game_data = None
        for game_skip in all_skipped:
            if game_skip.get("game_id") == game_id:
                game_data = game_skip
                break
        
        if not game_data or not game_data.get("items"):
            return HTMLResponse("""
                <tr>
                    <td colspan="5" class="text-center text-dark-400 py-4">
                        No skipped releases for this game
                    </td>
                </tr>
            """)
        
        # Generate HTML rows from items
        rows = []
        for skip in game_data["items"][:50]:  # Limit to 50
            reason_class = "text-yellow-400" if "ignored" in skip.get("reason", "").lower() else "text-dark-300"
            title = skip.get('title', 'N/A')
            title_display = title[:80] + "..." if len(title) > 80 else title

            rows.append(f"""
                <tr class="border-b border-dark-700/50 hover:bg-dark-700/30">
                    <td class="py-3 text-sm text-dark-200 break-words" title="{title}">{title_display}</td>
                    <td class="py-3 text-sm text-dark-400 whitespace-nowrap">{skip.get('date', 'N/A')}</td>
                    <td class="py-3 text-sm {reason_class}">{skip.get('reason', 'Unknown')}</td>
                    <td class="py-3 text-sm text-dark-400">{skip.get('indexer', 'N/A')}</td>
                    <td class="py-3 text-sm text-dark-400 text-right whitespace-nowrap">{skip.get('size', 'N/A')}</td>
                </tr>
            """)
        
        return HTMLResponse("\n".join(rows))
        
    except Exception as e:
        return HTMLResponse(f"""
            <tr>
                <td colspan="5" class="text-center text-red-400 py-4">
                    Error loading skipped releases: {str(e)}
                </td>
            </tr>
        """)


# ============================================
# Scan Actions
# ============================================

@router.post("/scan-now", response_class=HTMLResponse)
async def trigger_scan():
    """Trigger a full scan cycle (sync library + check updates)."""
    await run_scan_cycle()
    return HTMLResponse("", headers={"HX-Trigger": "updates-changed, stats-changed"})


@router.post("/sync-library", response_class=HTMLResponse)
async def trigger_sync_library():
    """Sync library from qBittorrent."""
    try:
        await run_sync_library()
    finally:
        await progress_manager.complete()
    return HTMLResponse("", headers={"HX-Trigger": "updates-changed, stats-changed"})


@router.post("/check-updates", response_class=HTMLResponse)
async def trigger_check_updates():
    """Check Prowlarr for updates."""
    try:
        await run_search_updates()
    finally:
        await progress_manager.complete()
    return HTMLResponse("", headers={"HX-Trigger": "updates-changed, stats-changed"})


@router.get("/scan-progress")
async def scan_progress_sse():
    """SSE endpoint for real-time scan progress updates."""
    async def event_generator():
        queue = await progress_manager.subscribe()
        try:
            while True:
                try:
                    # Wait for progress update with timeout (60s keepalive interval)
                    data = await asyncio.wait_for(queue.get(), timeout=60.0)
                    yield f"data: {json.dumps(data)}\n\n"
                    
                    # If scan completed, send one more update and stop
                    if not data.get("is_scanning", True):
                        break
                except asyncio.TimeoutError:
                    # Send keepalive comment to keep connection alive
                    yield f": keepalive\n\n"
        finally:
            await progress_manager.unsubscribe(queue)
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.get("/scan-progress/status")
async def scan_progress_status():
    """Get current scan progress status (polling fallback)."""
    return progress_manager.progress.to_dict()


# ============================================
# Settings & Test Endpoints
# ============================================

@router.post("/test-qbit-connection", response_class=HTMLResponse)
async def test_qbit_connection():
    """Test qBittorrent connection."""
    from app.services.qbit import QBitService
    qbit = QBitService()
    try:
        success = await qbit.login()
        if success:
            return HTMLResponse("""
                <div class="flex items-center gap-2 text-green-400">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>Connection successful</span>
                </div>
            """)
        else:
            return HTMLResponse("""
                <div class="flex items-center gap-2 text-red-400">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    <span>Connection failed - check credentials</span>
                </div>
            """)
    except Exception as e:
        return HTMLResponse(f"""
            <div class="flex items-center gap-2 text-red-400">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span>Error: {str(e)[:100]}</span>
            </div>
        """)
    finally:
        await qbit.close()


@router.post("/test-prowlarr-connection", response_class=HTMLResponse)
async def test_prowlarr_connection():
    """Test Prowlarr connection."""
    from app.services.prowlarr import ProwlarrService
    prowlarr = ProwlarrService()
    try:
        resp = await prowlarr.client.get(
            f"{prowlarr.base_url}/api/v1/health",
            headers=prowlarr.headers
        )
        resp.raise_for_status()
        return HTMLResponse("""
            <div class="flex items-center gap-2 text-green-400">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Connection successful</span>
            </div>
        """)
    except Exception as e:
        return HTMLResponse(f"""
            <div class="flex items-center gap-2 text-red-400">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span>Error: {str(e)[:100]}</span>
            </div>
        """)
    finally:
        await prowlarr.close()