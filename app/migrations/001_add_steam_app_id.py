"""
Add steam_app_id column to game table
"""
from sqlalchemy import text

def up(conn):
    """Apply migration"""
    conn.execute(text("ALTER TABLE game ADD COLUMN steam_app_id INTEGER"))
    conn.commit()

def down(conn):
    """Revert migration (SQLite doesn't support DROP COLUMN easily)"""
    pass
