import copy
import threading
import time
from dataclasses import dataclass

from services.session_service import ACCUM_DANGER_SEC


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
