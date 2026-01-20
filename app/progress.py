"""
Progress tracking module for scan operations.
Uses asyncio queues to broadcast progress updates to SSE clients.
"""
import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
import logging

logger = logging.getLogger("repackarr")


@dataclass
class ScanProgress:
    """Current scan progress state."""
    is_scanning: bool = False
    phase: str = ""  # "sync" or "search"
    current_step: int = 0
    total_steps: int = 0
    current_item: str = ""
    started_at: Optional[datetime] = None
    
    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "is_scanning": self.is_scanning,
            "phase": self.phase,
            "current_step": self.current_step,
            "total_steps": self.total_steps,
            "current_item": self.current_item,
            "percent": int((self.current_step / self.total_steps * 100) if self.total_steps > 0 else 0),
            "started_at": self.started_at.isoformat() if self.started_at else None
        }


class ProgressManager:
    """
    Manages scan progress state and broadcasts updates to connected clients.
    """
    
    def __init__(self):
        self._progress = ScanProgress()
        self._subscribers: list[asyncio.Queue] = []
        self._lock = asyncio.Lock()
    
    @property
    def progress(self) -> ScanProgress:
        """Get current progress state."""
        return self._progress
    
    async def subscribe(self) -> asyncio.Queue:
        """Subscribe to progress updates. Returns a queue that receives updates."""
        queue: asyncio.Queue = asyncio.Queue()
        async with self._lock:
            self._subscribers.append(queue)
        # Send current state immediately
        await queue.put(self._progress.to_dict())
        return queue
    
    async def unsubscribe(self, queue: asyncio.Queue) -> None:
        """Unsubscribe from progress updates."""
        async with self._lock:
            if queue in self._subscribers:
                self._subscribers.remove(queue)
    
    async def _broadcast(self) -> None:
        """Broadcast current progress to all subscribers."""
        data = self._progress.to_dict()
        async with self._lock:
            for queue in self._subscribers:
                try:
                    await queue.put(data)
                except Exception as e:
                    logger.debug(f"Failed to send progress update: {e}")
    
    async def start_scan(self, phase: str, total_steps: int) -> None:
        """Start a new scan phase."""
        self._progress.is_scanning = True
        self._progress.phase = phase
        self._progress.current_step = 0
        self._progress.total_steps = total_steps
        self._progress.current_item = ""
        self._progress.started_at = datetime.utcnow()
        await self._broadcast()
    
    async def update(self, current_step: int, current_item: str = "") -> None:
        """Update progress within current phase."""
        self._progress.current_step = current_step
        self._progress.current_item = current_item
        await self._broadcast()
    
    async def complete(self) -> None:
        """Mark scan as complete."""
        self._progress.is_scanning = False
        self._progress.phase = ""
        self._progress.current_step = 0
        self._progress.total_steps = 0
        self._progress.current_item = ""
        self._progress.started_at = None
        await self._broadcast()


# Global progress manager instance
progress_manager = ProgressManager()
