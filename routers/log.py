from fastapi import APIRouter

from services.log_service import read_logs

router = APIRouter()


@router.get("/logs")
def get_logs(limit: int | None = None) -> dict:
    return {"logs": read_logs(limit)}
