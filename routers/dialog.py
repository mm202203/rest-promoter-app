from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field, model_validator

from services.log_service import append_log
from services.session_service import get_advice
from services.timer_service import do_ack, do_record, get_state_snapshot

_JST = timezone(timedelta(hours=9))

router = APIRouter()


class RecordRequest(BaseModel):
    dialog_mode: Literal["first", "timer", "self", "force"]
    task: str = Field(min_length=0)
    load: int = Field(ge=1, le=5)
    state: int = Field(ge=1, le=5)
    action: Literal["start", "rest", "skip"]
    break_min: int | None = None
    snooze_min: int | None = None

    @model_validator(mode="after")
    def validate_action(self) -> "RecordRequest":
        if self.action == "rest":
            if self.dialog_mode == "force":
                if self.break_min != 15:
                    raise ValueError("force モードの休憩時間は15分固定です")
            elif self.break_min not in (5, 10, 15, 60):
                raise ValueError("break_min は 5/10/15/60 のいずれかです")
        if self.action == "skip":
            if self.snooze_min not in (15, 30, 45, 60):
                raise ValueError("snooze_min は 15/30/45/60 のいずれかです")
        if self.action == "start" and self.dialog_mode != "first":
            raise ValueError("action=start は first モードのみ有効です")
        if self.action == "start" and not self.task:
            raise ValueError("action=start のとき task は必須です")
        return self


class AdviceRequest(BaseModel):
    state_score: int = Field(ge=1, le=5)
    load: int = Field(ge=1, le=5)


@router.post("/record")
def record(body: RecordRequest) -> dict:
    s = get_state_snapshot()
    now_str = datetime.now(_JST).strftime("%Y-%m-%dT%H:%M:%S")

    if body.action == "start":
        session_start = now_str
        session_end = ""
    else:
        session_start = s.session_start_time
        session_end = now_str

    append_log(
        dialog_mode=body.dialog_mode,
        task=body.task,
        load=body.load,
        state=body.state,
        action=body.action,
        session_min=s.session_elapsed // 60,
        accum_min=s.accum_elapsed // 60,
        break_min=body.break_min,
        snooze_min=body.snooze_min,
        session_start=session_start,
        session_end=session_end,
    )
    do_record(body.action, body.break_min, body.snooze_min, body.task, body.load)
    return {"status": "recorded"}


@router.post("/dialog/ack")
def ack() -> dict:
    do_ack()
    return {"status": "acknowledged"}


@router.post("/advice")
def advice(body: AdviceRequest) -> dict:
    s = get_state_snapshot()
    return get_advice(body.state_score, body.load, s.session_elapsed)
