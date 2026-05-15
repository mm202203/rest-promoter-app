from fastapi import APIRouter
from pydantic import BaseModel, Field

from services.timer_service import (
    do_config,
    do_pause,
    do_reset,
    do_start,
    get_state_snapshot,
)

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
        "break_elapsed": s.break_elapsed,
        "is_running": s.is_running,
        "is_breaking": s.is_breaking,
        "is_first": s.is_first,
        "dialog_triggered": s.dialog_triggered,
        "dialog_mode": s.dialog_mode,
        "prev_task": s.prev_task,
        "prev_load": s.prev_load,
    }


@router.post("/start")
def start() -> dict:
    return {"status": do_start()}


@router.post("/pause")
def pause() -> dict:
    return {"status": do_pause()}


@router.post("/reset")
def reset() -> dict:
    return {"status": do_reset()}


@router.post("/config")
def config(body: ConfigRequest) -> dict:
    do_config(body.duration_min * 60)
    return {"status": "updated", "timer_duration": body.duration_min * 60}
