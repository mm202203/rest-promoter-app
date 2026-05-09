# 実装設計：初回実装

## 実装アプローチ

### 実装順序の方針

**バックエンドから縦断的に実装する。** 各フェーズで動作確認できる状態を維持する。

```
フェーズ1：環境セットアップ
  → プロジェクト構造・pyproject.toml・start.bat・git init

フェーズ2：バックエンドコア
  → TimerState・timer_service（スレッドなし）・GET /state のみ

フェーズ3：バックグラウンドスレッド
  → タイマーカウントダウン・発火判定・フラグセット

フェーズ4：全 API エンドポイント
  → /start /pause /reset /config /record /dialog/ack /logs /advice

フェーズ5：フロントエンド基礎
  → index.html・style.css・ポーリング・タイマー表示・累積バー

フェーズ6：ダイアログ UI
  → 4モード・ステップフロー・バリデーション・アドバイス表示・グラフプレビュー

フェーズ7：グラフ・ログ表示
  → Chart.js グラフ2種・ログ一覧

フェーズ8：仕上げ
  → 接続エラー表示・ruff チェック・手動チェックリスト確認
```

---

## コンポーネントごとの実装設計

### `main.py`

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from routers import timer, dialog, log
from services.timer_service import start_background_thread
from services.log_service import init_csv

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_csv()                 # data/log.csv を初回生成
    start_background_thread()  # バックグラウンドスレッド起動
    yield

app = FastAPI(lifespan=lifespan)
app.include_router(timer.router)
app.include_router(dialog.router)
app.include_router(log.router)
# StaticFiles は必ずルーター登録後にマウントする（先にマウントすると API ルートが隠れる）
app.mount("/", StaticFiles(directory="static", html=True), name="static")
```

---

### `services/session_service.py`

定数はここに集約する。`timer_service.py` からもインポートして使う。

```python
# 閾値定数（秒）
SESSION_WARN_SEC_SCORE = 5400   # 90分：状態スコア3 + session_elapsed 超過判定
SESSION_WARN_SEC_LOAD  = 2700   # 45分：負荷4〜5 + session_elapsed 超過判定
ACCUM_WARN_SEC         = 8100   # 135分：累積バー警告
ACCUM_DANGER_SEC       = 10800  # 180分：累積バー上限・force モード判定

def get_advice(state_score: int, load: int, session_elapsed: int) -> dict:
    """
    アドバイスを優先度順に評価して返す。
    戻り値: {"level": "danger"|"warn"|"ok", "message": str}
    """
    if state_score <= 2:
        return {"level": "danger", "message": "状態がかなり悪化しています。休憩を強くおすすめします。"}
    if state_score == 3 and session_elapsed > SESSION_WARN_SEC_SCORE:
        return {"level": "warn", "message": "90分以上連続で作業しています。休憩をおすすめします。"}
    if load >= 4 and session_elapsed > SESSION_WARN_SEC_LOAD:
        return {"level": "warn", "message": "高負荷な作業を45分以上続けています。認知負荷が蓄積しています。"}
    return {"level": "ok", "message": "状態は良好です。このまま続けるか、休憩するか選択してください。"}

def get_accum_status(accum_elapsed: int) -> str:
    """累積バーの状態を返す。"""
    if accum_elapsed >= ACCUM_DANGER_SEC:
        return "danger"
    if accum_elapsed >= ACCUM_WARN_SEC:
        return "warn"
    return "normal"
```

---

### `services/timer_service.py`

```python
from dataclasses import dataclass
import threading
import copy
import time
from services.session_service import ACCUM_DANGER_SEC  # 定数は session_service から参照

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
```

**バックグラウンドスレッドのロジック:**

```python
def _tick() -> None:
    while True:
        time.sleep(1)
        with timer_lock:
            if timer_state.is_breaking:
                if timer_state.remaining > 0:
                    timer_state.remaining -= 1
                if timer_state.remaining == 0:
                    # 休憩終了 → timer ダイアログ発火
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
                    # タイマー発火 → モード判定
                    timer_state.dialog_mode = (
                        "force" if timer_state.accum_elapsed >= ACCUM_DANGER_SEC else "timer"
                    )
                    timer_state.dialog_triggered = True
                    timer_state.is_running = False

def start_background_thread() -> None:
    t = threading.Thread(target=_tick, daemon=True)
    t.start()
```

**Lock のスコープ:** `with timer_lock:` ブロック内は状態の読み書きのみ。I/O（CSV 書き込み）は Lock 外で行う。

**操作関数（routers から呼ぶ）:**

```python
def get_state_snapshot() -> TimerState:
    with timer_lock:
        return copy.copy(timer_state)

def do_start() -> str:
    with timer_lock:
        if timer_state.is_running:
            return "already_running"
        if timer_state.is_breaking:
            return "breaking"
        if timer_state.is_first:
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
    """CSV 書き込みは Lock 外で行う。状態更新のみ Lock 内。"""
    with timer_lock:
        timer_state.prev_task = task
        timer_state.prev_load = load
        if action == "start":
            timer_state.is_first = False
            timer_state.is_running = True
        elif action == "rest":
            timer_state.accum_elapsed = 0
            timer_state.session_elapsed = 0
            timer_state.is_running = False   # 作業タイマーを停止してから休憩タイマーへ
            timer_state.is_breaking = True
            timer_state.remaining = (break_min or 0) * 60
        elif action == "skip":
            timer_state.session_elapsed = 0
            timer_state.is_breaking = False  # 万が一 is_breaking が残っていても解除
            timer_state.is_running = True
            timer_state.remaining = (snooze_min or 0) * 60

def do_ack() -> None:
    with timer_lock:
        timer_state.dialog_triggered = False
        timer_state.dialog_mode = None
```

---

### `services/log_service.py`

```python
import pandas as pd
from pathlib import Path
from datetime import datetime

CSV_PATH = Path("data/log.csv")
COLUMNS = [
    "timestamp", "dialog_mode", "task", "load", "state",
    "action", "session_min", "accum_min", "break_min", "snooze_min",
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
        "timestamp": datetime.now().isoformat(timespec="seconds"),
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
```

---

### `routers/timer.py`

```python
from fastapi import APIRouter
from pydantic import BaseModel, Field
from services.timer_service import get_state_snapshot, do_start, do_pause, do_reset, do_config

router = APIRouter()

class ConfigRequest(BaseModel):
    duration_min: int = Field(ge=1, le=120)

@router.get("/state")
def get_state():
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

@router.post("/start")
def start():
    return {"status": do_start()}

@router.post("/pause")
def pause():
    return {"status": do_pause()}

@router.post("/reset")
def reset():
    return {"status": do_reset()}

@router.post("/config")
def config(body: ConfigRequest):
    do_config(body.duration_min * 60)
    return {"status": "updated", "timer_duration": body.duration_min * 60}
```

---

### `routers/dialog.py`

```python
from fastapi import APIRouter
from pydantic import BaseModel, Field, model_validator
from typing import Literal
from services.timer_service import do_record, do_ack, get_state_snapshot
from services.log_service import append_log
from services.session_service import get_advice

router = APIRouter()

class RecordRequest(BaseModel):
    dialog_mode: Literal["first", "timer", "self", "force"]
    task: str = Field(min_length=1)
    load: int = Field(ge=1, le=5)
    state: int = Field(ge=1, le=5)
    action: Literal["start", "rest", "skip"]
    break_min: int | None = None
    snooze_min: int | None = None

    @model_validator(mode="after")
    def validate_action(self):
        if self.action == "rest":
            if self.dialog_mode == "force":
                if self.break_min != 15:
                    raise ValueError("force モードの休憩時間は15分固定です")
            elif self.break_min not in (5, 10, 15):
                raise ValueError("break_min は 5/10/15 のいずれかです")
        if self.action == "skip":
            if self.snooze_min not in (15, 30, 45, 60):
                raise ValueError("snooze_min は 15/30/45/60 のいずれかです")
        if self.action == "start" and self.dialog_mode != "first":
            raise ValueError("action=start は first モードのみ有効です")
        return self

class AdviceRequest(BaseModel):
    state_score: int = Field(ge=1, le=5)
    load: int = Field(ge=1, le=5)

@router.post("/record")
def record(body: RecordRequest):
    # do_record より前にスナップショットを取得する（do_record で elapsed がリセットされるため）
    s = get_state_snapshot()
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
    )
    do_record(body.action, body.break_min, body.snooze_min, body.task, body.load)
    return {"status": "recorded"}

@router.post("/dialog/ack")
def ack():
    do_ack()
    return {"status": "acknowledged"}

@router.post("/advice")
def advice(body: AdviceRequest):
    """
    ダイアログ Step1 で状態スコアを選択した直後に呼ぶ。
    session_elapsed はサーバー側の現在値を使用する。
    """
    s = get_state_snapshot()
    return get_advice(body.state_score, body.load, s.session_elapsed)
```

---

### `routers/log.py`

```python
from fastapi import APIRouter
from services.log_service import read_logs

router = APIRouter()

@router.get("/logs")
def get_logs(limit: int | None = None):
    return {"logs": read_logs(limit)}
```

---

### フロントエンド実装方針

#### `app.js` の構造

```
定数定義
  POLL_INTERVAL_MS, ACCUM_WARN_MIN, ACCUM_DANGER_MIN など

状態変数
  isPolling, isDialogOpen, currentDialogMode, currentStep
  dialogData（各ステップの入力値を保持）

ポーリング
  poll() → updateUI(state) → ダイアログ発火検知

UI 更新
  updateTimerDisplay(state)    タイマー表示・休憩中切り替え
  updateAccumBar(state)        累積バーの幅と色
  updateButtonStates(state)    ボタンの有効/無効

ダイアログ制御
  openDialog(mode) → dialogData をリセット → showStep(1)
  showStep(n)      → モードに応じた内容をレンダリング
  onNextClick()    → バリデーション → showStep(n+1) or submitDialog()
  onBackClick()    → showStep(n-1)
  submitDialog()   → POST /record → closeDialog() → updateCharts()

アドバイス取得
  fetchAdvice(stateScore, load) → POST /advice → アドバイスバナーを表示

グラフ描画
  initCharts()                          Chart.js インスタンス生成
  updateCharts(logs)                    データ更新（メイン画面）
  updateDialogChart(logs, previewScore) Step1 プレビュー更新

ログ表示
  renderLogs(logs) → 直近8件をDOMに描画（textContent 使用）
```

#### ダイアログの `dialogData` 管理

`first` モードと `timer`/`self`/`force` モードではステップの順番が異なる。
`dialogData` は収集する値の入れ物として共通に使うが、各ステップで**何を収集するか**はモードで異なる。

```javascript
// 各ステップ完了時に保存し、最終ステップ完了時に POST /record に渡す
let dialogData = {
  state: null,      // first: Step3 / timer・self・force: Step1 で設定
  task: '',         // first: Step1 / timer・self・force: Step2 で設定
  load: null,       // first: Step2 / timer・self・force: Step3 で設定
  action: null,     // first: なし  / timer・self・force: Step4 で設定
  break_min: null,
  snooze_min: null,
};
```

**ステップ定義（モード別）:**

| Step | first | timer / self / force |
|------|-------|----------------------|
| 1 | 作業内容（task） | 状態スコア（state）+ アドバイス表示 |
| 2 | 作業負荷（load） | 作業内容（task） |
| 3 | 状態スコア（state） | 作業負荷（load） |
| 4 | なし（完了） | 休憩/スヌーズ選択（action） |

- Step1 の終了後、`timer`/`self`/`force` モードでは `POST /advice` を呼んでアドバイスを表示してから Step2 へ進む
- `force` モードでは Step4 のスヌーズ選択肢要素を `hidden` にする
- 状態スコア 1〜2 のときは `state-low` クラスをダイアログルート要素に付与する

#### ダイアログ表示切り替えの方針

- `first` / `timer` / `self` / `force` の各モードは同一の HTML 構造を使い回す
- CSS クラスと JS で表示・非表示・文言を切り替える

---

## 影響範囲の分析

初回実装のため既存コードへの影響はない。
ただし以下の実装上の注意点を守る。

| 注意点 | 詳細 |
|--------|------|
| `append_log` → `do_record` の順序 | `append_log`（CSV 書き込み）を先に呼び、その後 `do_record`（状態更新・タイマー再起動）を呼ぶ。逆にするとタイマー開始後に CSV 書き込みが遅れる |
| `get_state_snapshot()` のタイミング | `/record` 処理では `do_record` より前にスナップショットを取得する。`do_record` 実行後は `session_elapsed`・`accum_elapsed` がリセットされる |
| ポーリングと ACK の順序 | `dialog_triggered = true` 検知 → `POST /dialog/ack` → ダイアログ表示の順を守る。ACK を先に送ることで次のポーリングでの二重発火を防ぐ |
| `StaticFiles` のマウント順序 | `app.include_router(...)` をすべて登録した後に `app.mount(...)` を記述する。先にマウントすると API ルートが隠れる |
| 定数の参照元 | `ACCUM_DANGER_SEC` 等の閾値定数は `session_service.py` に集約。`timer_service.py` はインポートして参照する |
| `POST /advice` の呼び出しタイミング | ダイアログ Step1 完了後（状態スコア選択後）に呼ぶ。`first` モードでは Step3 完了後だが、アドバイス表示なしのまま完了するため呼ばない |
