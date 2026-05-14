import copy
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from services.session_service import ACCUM_DANGER_SEC

_JST = timezone(timedelta(hours=9))


@dataclass
class TimerState:
    is_running: bool = False
    is_breaking: bool = False
    is_first: bool = True
    remaining: int = 3600
    timer_duration: int = 3600
    session_elapsed: int = 0
    accum_elapsed: int = 0
    dialog_triggered: bool = False
    dialog_mode: str | None = None
    prev_task: str = ""
    prev_load: int = 3
    session_start_time: str = ""


timer_state = TimerState()
timer_lock = threading.Lock()


def get_state_snapshot() -> TimerState:
    with timer_lock:
        return copy.copy(timer_state)


def _tick() -> None:
    while True:
        time.sleep(1)
        with timer_lock:
            if timer_state.is_breaking:
                if timer_state.remaining > 0:
                    timer_state.remaining -= 1
                if timer_state.remaining == 0:
                    timer_state.is_breaking = False
                    timer_state.is_running = False
                    timer_state.dialog_triggered = True
                    timer_state.dialog_mode = "timer"
            elif timer_state.is_running:
                if timer_state.remaining > 0:
                    timer_state.remaining -= 1
                    timer_state.session_elapsed += 1
                    timer_state.accum_elapsed += 1
                if timer_state.remaining == 0:
                    timer_state.dialog_mode = (
                        "force"
                        if timer_state.accum_elapsed >= ACCUM_DANGER_SEC
                        else "timer"
                    )
                    timer_state.dialog_triggered = True
                    timer_state.is_running = False


def start_background_thread() -> None:
    t = threading.Thread(target=_tick, daemon=True)
    t.start()


def do_start() -> str:
    with timer_lock:
        if timer_state.is_running:
            return "already_running"
        if timer_state.is_breaking:
            return "breaking"
        if timer_state.is_first:
            # タイマーは POST /record action="start" 後に開始する
            timer_state.dialog_triggered = True
            timer_state.dialog_mode = "first"
        else:
            timer_state.is_running = True
        return "started"


def do_pause() -> str:
    with timer_lock:
        if not timer_state.is_running:
            return "already_paused"
        timer_state.is_running = False
        return "paused"


def do_reset() -> str:
    with timer_lock:
        timer_state.is_running = False
        timer_state.is_breaking = False
        timer_state.is_first = True
        timer_state.remaining = timer_state.timer_duration
        timer_state.session_elapsed = 0
        # accum_elapsed はリセットしない（休憩を取ったときのみリセット）
        timer_state.dialog_triggered = False
        timer_state.dialog_mode = None
        return "reset"


def do_config(duration_sec: int) -> None:
    with timer_lock:
        timer_state.timer_duration = duration_sec


def do_record(
    action: str,
    break_min: int | None,
    snooze_min: int | None,
    task: str,
    load: int,
) -> None:
    with timer_lock:
        timer_state.prev_task = task
        timer_state.prev_load = load
        if action == "start":
            timer_state.is_first = False
            timer_state.is_running = True
            timer_state.session_start_time = datetime.now(_JST).strftime(
                "%Y-%m-%dT%H:%M:%S"
            )
        elif action == "rest":
            timer_state.accum_elapsed = 0
            timer_state.session_elapsed = 0
            timer_state.is_running = False
            timer_state.is_breaking = True
            timer_state.remaining = (break_min or 0) * 60
            timer_state.session_start_time = ""
        elif action == "skip":
            timer_state.session_elapsed = 0
            timer_state.is_breaking = False
            timer_state.is_running = True
            timer_state.remaining = (snooze_min or 0) * 60
            timer_state.session_start_time = datetime.now(_JST).strftime(
                "%Y-%m-%dT%H:%M:%S"
            )


def do_ack() -> None:
    with timer_lock:
        timer_state.dialog_triggered = False
        timer_state.dialog_mode = None
