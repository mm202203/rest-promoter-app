from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

JST = timezone(timedelta(hours=9))

CSV_PATH = Path("data/log.csv")
COLUMNS = [
    "timestamp",
    "dialog_mode",
    "task",
    "load",
    "state",
    "action",
    "session_min",
    "accum_min",
    "break_min",
    "snooze_min",
]


def init_csv() -> None:
    CSV_PATH.parent.mkdir(exist_ok=True)
    if not CSV_PATH.exists():
        pd.DataFrame(columns=COLUMNS).to_csv(CSV_PATH, index=False)


def _escape_csv_injection(value: str) -> str:
    if value and value[0] in ("=", "+", "-", "@"):
        return f"'{value}"
    return value


def append_log(
    dialog_mode: str,
    task: str,
    load: int,
    state: int,
    action: str,
    session_min: int,
    accum_min: int,
    break_min: int | None,
    snooze_min: int | None,
) -> None:
    record = {
        "timestamp": datetime.now(JST).strftime("%Y-%m-%dT%H:%M:%S"),
        "dialog_mode": dialog_mode,
        "task": _escape_csv_injection(task),
        "load": load,
        "state": state,
        "action": action,
        "session_min": session_min,
        "accum_min": accum_min,
        "break_min": break_min,
        "snooze_min": snooze_min,
    }
    df = pd.DataFrame([record])
    df.to_csv(CSV_PATH, mode="a", header=False, index=False)


def read_logs(limit: int | None = None) -> list[dict]:
    if not CSV_PATH.exists():
        return []
    df = pd.read_csv(CSV_PATH)
    if limit is not None:
        df = df.tail(limit)
    return df.where(pd.notna(df), None).to_dict(orient="records")
