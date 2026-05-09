import copy
import threading
from dataclasses import dataclass


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
