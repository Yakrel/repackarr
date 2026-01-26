"""
Simple migration runner for database schema changes.
Tracks applied migrations in a dedicated table.
"""
import logging
import importlib
from pathlib import Path
from sqlalchemy import text
from app.database import engine

logger = logging.getLogger("repackarr")


def ensure_migration_table():
    """Create migrations table if it doesn't exist"""
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))
        conn.commit()


def get_applied_migrations():
    """Get list of already applied migrations"""
    with engine.connect() as conn:
        result = conn.execute(text("SELECT version FROM schema_migrations"))
        return {row[0] for row in result}


def get_pending_migrations():
    """Find migration files that haven't been applied yet"""
    migrations_dir = Path(__file__).parent / "migrations"
    applied = get_applied_migrations()
    
    pending = []
    for file in sorted(migrations_dir.glob("*.py")):
        if file.name.startswith("__"):
            continue
        
        version = file.stem  # e.g., "001_add_steam_app_id"
        if version not in applied:
            pending.append(version)
    
    return pending


def run_migration(version: str):
    """Run a single migration"""
    logger.info(f"Applying migration: {version}")
    
    # Import the migration module
    module = importlib.import_module(f"app.migrations.{version}")
    
    # Run the up() function
    with engine.connect() as conn:
        try:
            module.up(conn)
            
            # Mark as applied
            conn.execute(
                text("INSERT INTO schema_migrations (version) VALUES (:version)"),
                {"version": version}
            )
            conn.commit()
            logger.info(f"✅ Migration applied: {version}")
            
        except Exception as e:
            conn.rollback()
            # Check if it's a "duplicate column" error (already exists)
            if "duplicate column" in str(e).lower():
                logger.info(f"⚠️  Migration {version} already applied (column exists)")
                # Mark as applied anyway
                conn.execute(
                    text("INSERT OR IGNORE INTO schema_migrations (version) VALUES (:version)"),
                    {"version": version}
                )
                conn.commit()
            else:
                logger.error(f"❌ Migration failed: {version} - {e}")
                raise


def run_migrations():
    """Run all pending migrations"""
    ensure_migration_table()
    pending = get_pending_migrations()
    
    if not pending:
        logger.info("No pending migrations")
        return
    
    logger.info(f"Found {len(pending)} pending migration(s)")
    for version in pending:
        run_migration(version)
    
    logger.info("All migrations completed")
