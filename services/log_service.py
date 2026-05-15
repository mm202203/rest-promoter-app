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
    "session_start",
    "session_end",
]


def init_csv() -> None:
    CSV_PATH.parent.mkdir(exist_ok=True)
    if not CSV_PATH.exists():
        pd.DataFrame(columns=COLUMNS).to_csv(CSV_PATH, index=False)
    else:
        df = pd.read_csv(CSV_PATH)
        changed = False
        for col in COLUMNS:
            if col not in df.columns:
                df[col] = ""
                changed = True
        if changed:
            df[COLUMNS].to_csv(CSV_PATH, index=False)


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
    session_start: str,
    session_end: str,
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
        "session_start": session_start,
        "session_end": session_end,
    }
    df = pd.DataFrame([record])
    df.to_csv(CSV_PATH, mode="a", header=False, index=False)


def get_last_work_info() -> tuple[int, int, str, int] | None:
    """再起動時の作業セッション復元用。
    最終行が当日の start/skip なら復元情報を返す。"""
    if not CSV_PATH.exists():
        return None
    df = pd.read_csv(CSV_PATH)
    if df.empty:
        return None
    last = df.iloc[-1]
    today = datetime.now(JST).strftime("%Y-%m-%d")
    if last["action"] not in ("start", "skip") or not str(last["timestamp"]).startswith(
        today
    ):
        return None
    action_time = datetime.fromisoformat(str(last["timestamp"])).replace(tzinfo=JST)
    elapsed_sec = int((datetime.now(JST) - action_time).total_seconds())
    if last["action"] == "skip":
        snooze_sec = int(float(last["snooze_min"])) * 60
        remaining_sec = max(snooze_sec - elapsed_sec, 0)
        session_elapsed = min(elapsed_sec, snooze_sec)
    else:
        # start: タイマー上限なし（デフォルト3600秒を仮定）
        remaining_sec = max(3600 - elapsed_sec, 0)
        session_elapsed = min(elapsed_sec, 3600)
    task = str(last["task"]) if pd.notna(last["task"]) else ""
    load = int(last["load"]) if pd.notna(last["load"]) else 3
    return session_elapsed, remaining_sec, task, load


def get_last_rest_info() -> tuple[int, int] | None:
    if not CSV_PATH.exists():
        return None
    df = pd.read_csv(CSV_PATH)
    if df.empty:
        return None
    last = df.iloc[-1]
    today = datetime.now(JST).strftime("%Y-%m-%d")
    if last["action"] != "rest" or not str(last["timestamp"]).startswith(today):
        return None
    rest_time = datetime.fromisoformat(str(last["timestamp"])).replace(tzinfo=JST)
    elapsed_sec = int((datetime.now(JST) - rest_time).total_seconds())
    break_min = int(last["break_min"])
    return elapsed_sec, break_min


def generate_daily_report(current_session_sec: int = 0) -> tuple[str, str]:
    now = datetime.now(JST)
    today = now.strftime("%Y-%m-%d")
    filename = now.strftime("%Y%m%d_%H%M%S") + ".md"

    lines: list[str] = [f"# 日報 {now.strftime('%Y-%m-%d %H:%M:%S')}", ""]

    if CSV_PATH.exists():
        df = pd.read_csv(CSV_PATH)
        today_df = df[df["timestamp"].astype(str).str.startswith(today)]
    else:
        today_df = pd.DataFrame(columns=COLUMNS)

    def _parse_ts(s: str) -> datetime | None:
        if not s or s in ("", "nan", "None"):
            return None
        try:
            return datetime.fromisoformat(s).replace(tzinfo=JST)
        except ValueError:
            return None

    # タイムスタンプ方式で作業時間を集計
    # session_start が NaN の場合（サーバー再起動起因）は直前セッション開始時刻で補完
    last_session_start: datetime | None = None
    total_work_min = 0
    work_entries: list[str] = []

    for _, row in today_df.iterrows():
        action = str(row.get("action", ""))
        ts_str = str(row["timestamp"])
        session_start_ts = _parse_ts(str(row.get("session_start", "")))
        session_end_ts = _parse_ts(str(row.get("session_end", "")))

        if action == "start":
            last_session_start = _parse_ts(ts_str)
        elif action in ("rest", "skip"):
            effective_start = session_start_ts or last_session_start
            if effective_start and session_end_ts:
                work_time_min = max(
                    0,
                    int(
                        (session_end_ts - effective_start).total_seconds() / 60
                    ),
                )
            else:
                work_time_min = 0
            total_work_min += work_time_min
            if work_time_min > 0:
                time_str = ts_str[11:16]
                task_raw = row.get("task", "")
                task = (
                    str(task_raw)
                    if pd.notna(task_raw) and str(task_raw) != ""
                    else "（作業内容なし）"
                )
                load = int(row["load"]) if pd.notna(row.get("load")) else "-"
                state = int(row["state"]) if pd.notna(row.get("state")) else "-"
                suffix = "（スヌーズ継続）" if action == "skip" else ""
                work_entries.append(
                    f"- {time_str} {task}"
                    f"（負荷:{load} / 状態:{state}）→ {work_time_min}分{suffix}"
                )
            if action == "skip":
                last_session_start = session_end_ts or _parse_ts(ts_str)
            else:
                last_session_start = None

    lines.append("## 作業セッション")
    if not work_entries:
        lines.append("- 記録なし")
    else:
        lines.extend(work_entries)
    if current_session_sec > 0:
        current_min = current_session_sec // 60
        lines.append(
            f"- {now.strftime('%H:%M')} （進行中）→ {current_min}分（未確定）"
        )
    lines.append("")

    rest_rows = today_df[today_df["action"] == "rest"]
    lines.append("## 休憩")
    if rest_rows.empty:
        lines.append("- 記録なし")
    else:
        for _, row in rest_rows.iterrows():
            time_str = str(row["timestamp"])[11:16]
            break_min = int(row["break_min"]) if pd.notna(row["break_min"]) else 0
            lines.append(f"- {time_str} {break_min}分休憩")
    lines.append("")

    total_break = int(
        rest_rows["break_min"].apply(pd.to_numeric, errors="coerce").fillna(0).sum()
    )

    lines.append("## サマリー")
    lines.append(f"- 総作業時間: {total_work_min + current_session_sec // 60}分")
    lines.append(f"- 総休憩時間: {total_break}分")

    content = "\n".join(lines) + "\n"

    output_dir = Path("output")
    output_dir.mkdir(exist_ok=True)
    (output_dir / filename).write_text(content, encoding="utf-8")

    return filename, content


def read_logs(limit: int | None = None) -> list[dict]:
    if not CSV_PATH.exists():
        return []
    df = pd.read_csv(CSV_PATH)
    for col in ("session_start", "session_end"):
        if col not in df.columns:
            df[col] = ""
    if limit is not None:
        df = df.tail(limit)
    return df.where(pd.notna(df), None).to_dict(orient="records")
