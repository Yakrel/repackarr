"""
UI Router - Web interface endpoints for Repackarr.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Form, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi import Request
from sqlmodel import Session, select, func
from app.database import get_session
from app.models import Game, Release, GameStatus
from app.services.manager import run_scan_cycle, run_sync_library, run_search_updates
from app.services.prowlarr import ProwlarrService
from app.config import get_settings

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


# ============================================
# Page Routes
# ============================================

@router.get("/", response_class=HTMLResponse)
async def dashboard(request: Request, session: Session = Depends(get_session)):
    """Main dashboard showing available updates."""
    updates = get_updates_data(session)
    stats = get_dashboard_stats(session)
    
    return templates.TemplateResponse(
        "dashboard.html", 
        {
            "request": request, 
            "updates": updates, 
            "stats": stats,
            "page": "dashboard",
            "settings": settings
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


# ============================================
# HTMX Partial Routes
# ============================================

@router.get("/stats-cards", response_class=HTMLResponse)
async def stats_cards(request: Request, session: Session = Depends(get_session)):
    """HTMX partial: Returns updated stats cards."""
    stats = get_dashboard_stats(session)
    
    return HTMLResponse(f"""
    <div id="stats-cards" 
         hx-get="/stats-cards" 
         hx-trigger="every 10s, stats-changed from:body"
         hx-swap="outerHTML">
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div class="bg-dark-800/50 rounded-xl border border-dark-700/50 p-4 hover:border-dark-600/50 transition">
            <div class="flex items-center gap-3">
                <div class="p-2 rounded-lg bg-brand-500/20">
                    <svg class="w-5 h-5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                </div>
                <div>
                    <p class="text-2xl font-bold text-white">{stats['total_games']}</p>
                    <p class="text-xs text-dark-400">Total Games</p>
                </div>
            </div>
        </div>
        
        <div class="bg-dark-800/50 rounded-xl border border-dark-700/50 p-4 hover:border-dark-600/50 transition">
            <div class="flex items-center gap-3">
                <div class="p-2 rounded-lg bg-emerald-500/20">
                    <svg class="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                </div>
                <div>
                    <p class="text-2xl font-bold text-white">{stats['monitored_games']}</p>
                    <p class="text-xs text-dark-400">Monitored</p>
                </div>
            </div>
        </div>
        
        <div class="bg-dark-800/50 rounded-xl border border-dark-700/50 p-4 hover:border-dark-600/50 transition">
            <div class="flex items-center gap-3">
                <div class="p-2 rounded-lg bg-{"slate-500" if request.url.path == "/library" else "amber-500"}/20">
                    <svg class="w-5 h-5 text-{"slate" if request.url.path == "/library" else "amber"}-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        {"<path stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21' />" if request.url.path == "/library" else "<path stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4' />"}
                    </svg>
                </div>
                <div>
                    <p class="text-2xl font-bold text-white">{stats['total_games'] - stats['monitored_games'] if request.url.path == "/library" else stats['pending_updates']}</p>
                    <p class="text-xs text-dark-400">{"Ignored" if request.url.path == "/library" else "Updates Found"}</p>
                </div>
            </div>
        </div>
        
        <div class="bg-dark-800/50 rounded-xl border border-dark-700/50 p-4 hover:border-dark-600/50 transition">
            <div class="flex items-center gap-3">
                <div class="p-2 rounded-lg bg-{"amber" if request.url.path == "/library" else "cyan"}-500/20">
                    <svg class="w-5 h-5 text-{"amber" if request.url.path == "/library" else "cyan"}-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        {"<path stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4' />" if request.url.path == "/library" else "<path stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' />"}
                    </svg>
                </div>
                <div>
                    <p class="text-2xl font-bold text-white">{stats['pending_updates'] if request.url.path == "/library" else f"{settings.CRON_INTERVAL_MINUTES}m"}</p>
                    <p class="text-xs text-dark-400">{"Updates Found" if request.url.path == "/library" else "Scan Interval"}</p>
                </div>
            </div>
        </div>
    </div>
    </div>
    """)


@router.get("/updates-list", response_class=HTMLResponse)
async def updates_list(request: Request, session: Session = Depends(get_session)):
    """HTMX partial: Returns updated list of pending updates."""
    updates = get_updates_data(session)
    stats = get_dashboard_stats(session)
    
    return templates.TemplateResponse(
        "partials/updates_list.html", 
        {"request": request, "updates": updates, "stats": stats}
    )


# ============================================
# Release Actions
# ============================================

@router.post("/release/{id}/dismiss", response_class=HTMLResponse)
async def dismiss_release(id: int, session: Session = Depends(get_session)):
    """Dismiss/ignore a release - removes it from the updates list."""
    release = session.get(Release, id)
    if not release:
        raise HTTPException(status_code=404, detail="Release not found")
    
    release.is_ignored = True
    session.add(release)
    session.commit()
    
    return HTMLResponse("", headers={"HX-Trigger": "stats-changed"})  # HTMX removes the element


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
    
    # Delete all releases for this game
    releases = session.exec(
        select(Release).where(Release.game_id == game.id)
    ).all()
    for r in releases:
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
    await run_sync_library()
    return HTMLResponse("", headers={"HX-Trigger": "updates-changed, stats-changed"})


@router.post("/check-updates", response_class=HTMLResponse)
async def trigger_check_updates():
    """Check Prowlarr for updates."""
    await run_search_updates()
    return HTMLResponse("", headers={"HX-Trigger": "updates-changed, stats-changed"})