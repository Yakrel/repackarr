from fastapi import APIRouter, Depends, Request, Form, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlmodel import Session, select
from app.database import get_session
from app.models import Game, Release
from app.services.manager import run_scan_cycle

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")

@router.get("/", response_class=HTMLResponse)
async def dashboard(request: Request, session: Session = Depends(get_session)):
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
    
    return templates.TemplateResponse(
        "dashboard.html", 
        {"request": request, "updates": grouped_updates.values(), "page": "dashboard"}
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

@router.post("/scan-now", response_class=HTMLResponse)
async def trigger_scan():
    await run_scan_cycle()
    return HTMLResponse("", headers={"HX-Refresh": "true"})