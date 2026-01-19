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
    
    return ""  # HTMX removes the element


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
        <button class="group flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 hover:bg-emerald-500/30 transition cursor-pointer">
            <span class="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span class="text-xs font-semibold text-emerald-300 uppercase tracking-wide">Monitored</span>
        </button>
        """)
    else:
        return HTMLResponse("""
        <button class="group flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-600/30 border border-slate-500/30 hover:bg-slate-500/30 transition cursor-pointer">
            <span class="h-2 w-2 rounded-full bg-slate-400"></span>
            <span class="text-xs font-semibold text-slate-300 uppercase tracking-wide">Ignored</span>
        </button>
        """)


@router.delete("/game/{id}", response_class=HTMLResponse)
async def delete_game(id: int, session: Session = Depends(get_session)):
    """Delete a game from the library."""
    game = session.get(Game, id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
        
    session.delete(game)
    session.commit()
    
    return ""  # HTMX removes the row


# ============================================
# Scan Actions
# ============================================

@router.post("/scan-now", response_class=HTMLResponse)
async def trigger_scan():
    """Trigger a full scan cycle (sync library + check updates)."""
    await run_scan_cycle()
    return HTMLResponse("", headers={"HX-Trigger": "updates-changed"})


@router.post("/sync-library", response_class=HTMLResponse)
async def trigger_sync_library():
    """Sync library from qBittorrent."""
    await run_sync_library()
    return HTMLResponse("", headers={"HX-Trigger": "updates-changed"})


@router.post("/check-updates", response_class=HTMLResponse)
async def trigger_check_updates():
    """Check Prowlarr for updates."""
    await run_search_updates()
    return HTMLResponse("", headers={"HX-Trigger": "updates-changed"})