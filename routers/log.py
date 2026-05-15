from fastapi import APIRouter

from services.log_service import generate_daily_report, read_logs
from services.timer_service import get_state_snapshot

router = APIRouter()


@router.get("/logs")
def get_logs(limit: int | None = None) -> dict:
    return {"logs": read_logs(limit)}


@router.post("/report")
def create_report() -> dict:
    s = get_state_snapshot()
    has_ongoing = s.session_elapsed > 0 and not s.is_breaking
    current_session_sec = s.session_elapsed if has_ongoing else 0
    filename, content = generate_daily_report(current_session_sec)
    return {"filename": filename, "content": content}
