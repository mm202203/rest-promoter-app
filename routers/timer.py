from fastapi import APIRouter
from pydantic import BaseModel, Field

from services.timer_service import get_state_snapshot

router = APIRouter()


class ConfigRequest(BaseModel):
    duration_min: int = Field(ge=1, le=120)


@router.get("/state")
def get_state() -> dict:
    s = get_state_snapshot()
    return {
        "remaining": s.remaining,
        "timer_duration": s.timer_duration,
        "session_elapsed": s.session_elapsed,
        "accum_elapsed": s.accum_elapsed,
        "is_running": s.is_running,
        "is_breaking": s.is_breaking,
        "is_first": s.is_first,
        "dialog_triggered": s.dialog_triggered,
        "dialog_mode": s.dialog_mode,
        "prev_task": s.prev_task,
        "prev_load": s.prev_load,
    }
