from fastapi import APIRouter, Depends, Request, Form, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlmodel import Session, select
from app.database import get_session
from app.models import Game, Release, GameStatus
from app.services.manager import run_scan_cycle, run_sync_library, run_search_updates
from app.services.prowlarr import ProwlarrService

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")

def get_updates_data(session: Session):
    statement = (
        select(Release, Game)
        .join(Game)
        .where(Release.is_ignored == False)
        .order_by(Game.title, Release.upload_date.desc())
    )
    results = session.exec(statement).all()
    
    grouped_updates = {}
    for release, game in results:
        if game.id not in grouped_updates:
            grouped_updates[game.id] = {"game": game, "releases": []}
        grouped_updates[game.id]["releases"].append(release)
    
    return grouped_updates.values()

@router.get("/", response_class=HTMLResponse)
async def dashboard(request: Request, session: Session = Depends(get_session)):
    updates = get_updates_data(session)
    return templates.TemplateResponse(
        "dashboard.html", 
        {"request": request, "updates": updates, "page": "dashboard"}
    )

@router.get("/updates-list", response_class=HTMLResponse)
async def updates_list(request: Request, session: Session = Depends(get_session)):
    updates = get_updates_data(session)
    return templates.TemplateResponse(
        "partials/updates_list.html", 
        {"request": request, "updates": updates}
    )

@router.get("/library", response_class=HTMLResponse)
async def library(request: Request, session: Session = Depends(get_session)):
    games = session.exec(select(Game).order_by(Game.title)).all()
    return templates.TemplateResponse(
        "library.html", 
        {"request": request, "games": games, "page": "library"}
    )

@router.post("/release/{id}/dismiss", response_class=HTMLResponse)
async def dismiss_release(id: int, session: Session = Depends(get_session)):
    release = session.get(Release, id)
    if not release:
        raise HTTPException(status_code=404)
    
    release.is_ignored = True
    session.add(release)
    session.commit()
    
    return ""

@router.post("/release/{id}/confirm", response_class=HTMLResponse)
async def confirm_update(id: int, session: Session = Depends(get_session)):
    release = session.get(Release, id)
    if not release:
        raise HTTPException(status_code=404)
    
    game = session.get(Game, release.game_id)
    
    game.current_version_date = release.upload_date
    session.add(game)
    
    statement = select(Release).where(Release.game_id == game.id)
    all_releases = session.exec(statement).all()
    
    for r in all_releases:
        session.delete(r)
        
    session.commit()
    
    return HTMLResponse("", headers={"HX-Refresh": "true"}) 

@router.post("/game/{id}/update-query", response_class=HTMLResponse)
async def update_game_query(id: int, search_query: str = Form(...), session: Session = Depends(get_session)):
    game = session.get(Game, id)
    if not game:
        raise HTTPException(status_code=404)
    
    game.search_query = search_query
    session.add(game)
    session.commit()
    
    return search_query

@router.post("/game/{id}/reset-scan", response_class=HTMLResponse)
async def reset_game_scan(id: int, session: Session = Depends(get_session)):
    """Deletes existing found releases for the game and triggers a fresh Prowlarr search."""
    game = session.get(Game, id)
    if not game:
        raise HTTPException(status_code=404)

    # 1. Delete existing releases for this game
    releases = session.exec(select(Release).where(Release.game_id == id)).all()
    for release in releases:
        session.delete(release)
    session.commit()

    # 2. Trigger immediate search (background task or await depending on preference)
    prowlarr = ProwlarrService()
    try:
        await prowlarr.search_for_game(game.id)
    finally:
        await prowlarr.close()

    # 3. Re-render the dashboard (or just this game's section, but for now full refresh is easier via HTMX)
    return HTMLResponse("", headers={"HX-Trigger": "updates-changed"})

@router.post("/game/{id}/toggle-monitor", response_class=HTMLResponse)
async def toggle_game_monitor(id: int, session: Session = Depends(get_session)):
    game = session.get(Game, id)
    if not game:
        raise HTTPException(status_code=404)
    
    if game.status == GameStatus.MONITORED:
        game.status = GameStatus.IGNORED
    else:
        game.status = GameStatus.MONITORED
        
    session.add(game)
    session.commit()
    
    # Return the new status badge HTML directly to update the UI without full reload
    status_color = "green" if game.status == GameStatus.MONITORED else "gray"
    status_text = "Monitored" if game.status == GameStatus.MONITORED else "Ignored"
    
    return f"""
    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-{status_color}-900 text-{status_color}-200">
        {status_text}
    </span>
    """

@router.delete("/game/{id}", response_class=HTMLResponse)
async def delete_game(id: int, session: Session = Depends(get_session)):
    game = session.get(Game, id)
    if not game:
        raise HTTPException(status_code=404)
        
    session.delete(game)
    session.commit()
    
    return "" # HTMX will remove the row

@router.post("/scan-now", response_class=HTMLResponse)
async def trigger_scan():
    await run_scan_cycle()
    return HTMLResponse("", headers={"HX-Trigger": "updates-changed"})

@router.post("/sync-library", response_class=HTMLResponse)
async def trigger_sync_library():
    await run_sync_library()
    return HTMLResponse("", headers={"HX-Trigger": "updates-changed"})

@router.post("/check-updates", response_class=HTMLResponse)
async def trigger_check_updates():
    await run_search_updates()
    return HTMLResponse("", headers={"HX-Trigger": "updates-changed"})