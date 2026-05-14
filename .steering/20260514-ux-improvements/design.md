# 設計書：UX改善（ダイアログ・音声・タイマー）

## 変更ファイル一覧

| ファイル | 変更内容 |
|---------|---------|
| `services/timer_service.py` | `TimerState` に `session_start_time` 追加、`do_record()` で更新 |
| `services/log_service.py` | `COLUMNS` に `session_start`/`session_end` 追加、`append_log()` シグネチャ変更、`read_logs()` 後方互換対応、`init_csv()` にマイグレーション処理追加 |
| `routers/dialog.py` | `RecordRequest` バリデーション更新（`break_min=60` を許容）、`record()` で session 時刻を計算・渡す |
| `static/index.html` | タイマー表示を SVG に置き換え、設定欄をプリセットボタンに変更 |
| `static/style.css` | SVG 円形プログレス用スタイル追加、設定欄スタイル変更 |
| `static/app.js` | ダイアログフロー全面改修、音声通知追加、SVG 更新ロジック追加、プリセットボタン対応、`poll()` 内の `prevState` 保存追加 |

---

## 0. `poll()` の `prevState` 保存（全機能の前提）

音声通知の発話判定と SVG の `breakDuration` 検知は、いずれも「前回ポーリング時の `is_breaking`」を参照する必要がある。現行コードは L188 で `lastState = state` を代入してから L189 で `updateUI(state)` を呼ぶため、判定時には `lastState` がすでに新しい値に上書きされている。

**修正方針**: `poll()` の先頭で `const prevState = lastState` として旧値を保存し、判定箇所はすべて `prevState` を使う。`lastState = state` の代入位置は変更しない。

```js
async function poll() {
  if (isPolling) return;
  isPolling = true;
  try {
    const state = await apiFetch('/state');
    hideConnectionError();
    const prevState = lastState;   // ← 追加: 旧値を保存
    lastState = state;
    updateUI(state, prevState);    // ← prevState を渡す
    if (state.dialog_triggered && !isDialogOpen) {
      const wasBreaking = prevState && prevState.is_breaking;  // ← prevState を使う
      await apiFetch('/dialog/ack', 'POST');
      speak(wasBreaking
        ? '休憩が終わりました。今の状態を教えてください。'
        : '作業時間が終わりました。今の状態を教えてください。'
      );
      openDialog(state.dialog_mode);
    }
    ...
  }
}
```

`updateUI(state, prevState)` のシグネチャに `prevState` を追加し、内部で `updateTimerSvg(state, prevState)` に渡す。

---

## 1. ダイアログフロー改修

### 1-1. 状態変数の追加

```js
let dialogRoute = null; // null | 'rest' | 'continue'
// openDialog() 時に null でリセット
```

### 1-2. ステップ数の決定ロジック

```js
function getStepCount(mode, route) {
  if (mode === 'first') return 3;
  if (mode === 'force') return 2;
  if (route === 'rest') return 3;
  if (route === 'continue') return 5;
  return 5; // Step 2 未選択時の仮値（インジケーターに使用）
}
```

### 1-3. ステップ描画の再設計

#### first モード（変更なし）
```
Step 1: renderTaskInput()
Step 2: renderLoadSelect()
Step 3: renderStateSelect()
```

#### force モード
```
Step 1: renderStateSelect()
Step 2: renderBreakSelect(forceOnly=true)  ← 15分のみ
```

#### timer / self モード
```
Step 1: renderStateSelect() + renderDialogChart()
Step 2: renderRouteChoice()
  → 「休憩する」選択: dialogRoute = 'rest', Step 2 にハイライト状態を表示 → 「次へ」でStep 3へ
  → 「作業を続ける」選択: dialogRoute = 'continue', Step 2 にハイライト状態を表示 → 「次へ」でStep 3へ
  ※ ルート選択後はドット数・「次へ/完了」ラベルを動的に更新する
  ※ 「戻る」でStep 2に戻っても dialogRoute はリセットせず、前回の選択状態をハイライトしたまま表示
→ dialogRoute='rest':
    Step 3: renderBreakSelect(forceOnly=false)  ← 5/10/15/60 分
→ dialogRoute='continue':
    Step 3: renderTaskInput()
    Step 4: renderLoadSelect()
    Step 5: renderSnoozeSelect()
```

#### `renderRouteChoice()` の実装

2択を `.route-btn` クラスのボタンで表示する。
- ボタンクリック時: `dialogRoute` を設定 → `.route-btn` の `.selected` クラスを付け替え → `updateStepIndicator(2, getStepCount(mode, dialogRoute))` を呼んでドット数を更新
- Step 2 に「戻る」で戻ってきた場合: `dialogRoute` は null でないため、対応するボタンに `.selected` が付いた状態で描画される
- 「次へ」バリデーション: `dialogRoute != null` でなければ進まない

#### `renderBreakSelect(forceOnly)` の実装

- `forceOnly=false`: 5 / 10 / 15 / 60 分の `.radio-btn` を表示
- `forceOnly=true`: 15分のみを表示
- クリック時: `dialogData.action = 'rest'`、`dialogData.break_min = min`

#### `renderSnoozeSelect()` の実装

- 選択肢: 15 / 30 / 45 / 60 分後
- クリック時: `dialogData.action = 'skip'`、`dialogData.snooze_min = min`

#### 既存 `renderActionSelect()` の削除

`renderBreakSelect()` / `renderSnoozeSelect()` に分解されるため削除する。

### 1-4. `onNextClick()` のバリデーション

| mode | step | 条件 |
|------|------|------|
| `first` | 1 | `dialogData.task` 必須 |
| `first` | 2 | `dialogData.load != null` |
| `first` | 3 | `dialogData.state != null` |
| `force` | 1 | `dialogData.state != null` |
| `force` | 2 | `dialogData.break_min != null` |
| `timer`/`self` | 1 | `dialogData.state != null` |
| `timer`/`self` | 2 | `dialogRoute != null` |
| `timer`/`self` (rest) | 3 | `dialogData.break_min != null` |
| `timer`/`self` (continue) | 3 | `dialogData.task` 必須 |
| `timer`/`self` (continue) | 4 | `dialogData.load != null` |
| `timer`/`self` (continue) | 5 | `dialogData.snooze_min != null` |

Step 3 のバリデーションは `dialogRoute` を参照して分岐する（同じ step 3 でも rest/continue でチェック対象が異なる）。

Step 1 完了後のアドバイス取得は `force` モードを除いた場合のみ実行する。  
アドバイスバナーの表示は継続ルートの Step 3 先頭のみ（`dialogRoute === 'continue' && currentStep === 3`）。

### 1-5. `submitDialog()` の変更

```js
async function submitDialog() {
  const mode = currentDialogMode;
  let task, load, action, break_min, snooze_min;

  if (mode === 'first') {
    task = dialogData.task;
    load = dialogData.load;
    action = 'start';
  } else if (dialogRoute === 'rest') {
    task = lastState.prev_task;   // 前回値を引き継ぐ
    load = lastState.prev_load;   // 前回値を引き継ぐ
    action = 'rest';
    break_min = dialogData.break_min;
  } else {                        // continue
    task = dialogData.task;
    load = dialogData.load;
    action = 'skip';
    snooze_min = dialogData.snooze_min;
  }

  const payload = {
    dialog_mode: mode,
    task, load,
    state: dialogData.state,
    action,
    break_min: break_min || null,
    snooze_min: snooze_min || null,
  };
  await apiFetch('/record', 'POST', payload);
  closeDialog();
  const logsRes = await apiFetch('/logs');
  lastLogsCache = logsRes.logs;
  updateCharts(logsRes.logs);
  renderLogs(logsRes.logs);
}
```

`closeDialog()` 内で `dialogRoute = null` をリセットする。

---

## 2. 音声通知

### `speak(text)` 関数

```js
function speak(text) {
  try {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();   // 前回の発話が残っている場合に備えてキャンセル
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'ja-JP';
    window.speechSynthesis.speak(utter);
  } catch (_) {
    // silent fallback
  }
}
```

### `poll()` での呼び出し

「セクション0」に示した通り、`prevState.is_breaking` で発話内容を切り替え、`openDialog()` の前に呼ぶ。

- `self` モード: ユーザーが手動で `openDialog('self')` を呼ぶため、このコードパスを通らず自然に音声なし
- `force` モード: タイマー発火（`prevState.is_breaking === false`）なので「作業時間が終わりました」が再生される

---

## 3. SVG 円形プログレスバー

### 3-1. `index.html` の変更

`#timer-display` の `<div>` を SVG 要素に置き換える。

```html
<svg id="timer-svg" class="timer-svg" width="200" height="200"
     viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <circle id="timer-track" cx="100" cy="100" r="88"
          stroke="#e0e0e0" stroke-width="12" fill="none"/>
  <circle id="timer-progress" cx="100" cy="100" r="88"
          stroke="#1976d2" stroke-width="12" fill="none"
          stroke-linecap="round"
          transform="rotate(-90 100 100)"
          stroke-dasharray="552.92" stroke-dashoffset="0"/>
  <text id="timer-label" x="100" y="90"
        text-anchor="middle" dominant-baseline="auto"
        font-size="16" fill="#4caf50"
        font-family="inherit" visibility="hidden">休憩</text>
  <text id="timer-text" x="100" y="116"
        text-anchor="middle" dominant-baseline="auto"
        font-size="38" font-weight="700" fill="#212121"
        font-variant-numeric="tabular-nums" font-family="inherit">--:--</text>
</svg>
```

- 円周: `2 × π × 88 ≈ 552.92`
- 初期状態（`--:--`）は `stroke-dashoffset = 0`（全円弧を表示）
- 「休憩」ラベルは `#timer-label`（`font-size="16"`）、数値は `#timer-text`（`font-size="38"` / 休憩中は `font-size="24"` に変更）の2要素に分離

### 3-2. `app.js` の変更

#### 状態変数の追加

```js
let breakDuration = null; // 休憩開始時の remaining を記録
```

#### DOM 参照の変更

```js
// 削除: timerDisplayEl
const timerProgressEl = document.getElementById('timer-progress');
const timerTextEl     = document.getElementById('timer-text');
const timerLabelEl    = document.getElementById('timer-label');
```

#### `updateTimerSvg(state, prevState)` 関数

```js
function updateTimerSvg(state, prevState) {
  const CIRCUMFERENCE = 552.92;

  // 休憩開始を検知して breakDuration を記録（prevState が必要）
  if (state.is_breaking && (!prevState || !prevState.is_breaking)) {
    breakDuration = state.remaining;
  }
  if (!state.is_breaking) {
    breakDuration = null;
  }

  const total = state.is_breaking
    ? (breakDuration ?? state.remaining)  // null フォールバック: 現在値を全体として扱い 100% 表示
    : state.timer_duration;
  const ratio = total > 0 ? state.remaining / total : 1; // ゼロ除算時は 100% 表示
  const offset = CIRCUMFERENCE * (1 - ratio);

  timerProgressEl.setAttribute('stroke-dashoffset', offset.toFixed(2));
  timerProgressEl.setAttribute('stroke', state.is_breaking ? '#4caf50' : '#1976d2');

  if (state.is_breaking) {
    timerTextEl.textContent = formatMmss(state.remaining);
    timerTextEl.setAttribute('font-size', '24');
    timerTextEl.setAttribute('y', '116');
    timerLabelEl.setAttribute('visibility', 'visible');
  } else {
    timerTextEl.textContent = formatMmss(state.remaining);
    timerTextEl.setAttribute('font-size', '38');
    timerTextEl.setAttribute('y', '116');
    timerLabelEl.setAttribute('visibility', 'hidden');
  }
  timerTextEl.setAttribute('fill', state.is_breaking ? '#4caf50' : '#212121');
}
```

- `updateUI(state, prevState)` のシグネチャを変更し、`updateTimerSvg(state, prevState)` を呼ぶ
- 既存の `updateTimerDisplay(state)` 呼び出しを `updateTimerSvg(state, prevState)` に置き換える

### 3-3. `style.css` の変更

```css
/* 追加 */
.timer-svg {
  display: block;
  margin: 0 auto;
}

/* 削除: .timer-display, .timer-display.is-breaking */
```

---

## 4. 作業時間プリセット・休憩時間追加

### 4-1. `index.html` の変更

```html
<!-- 変更後 -->
<div class="config-section">
  <span class="config-label">タイマー間隔:</span>
  <div id="preset-group" class="preset-group">
    <button class="preset-btn" data-min="15">15分</button>
    <button class="preset-btn" data-min="30">30分</button>
    <button class="preset-btn" data-min="45">45分</button>
    <button class="preset-btn" data-min="60">60分</button>
    <button class="preset-btn" data-min="75">75分</button>
    <button class="preset-btn" data-min="90">90分</button>
  </div>
</div>
```

削除: `<input id="input-duration">` / `<button id="btn-config">` / `<label for="input-duration">`

### 4-2. `app.js` の変更

**削除する既存コード:**
- `inputDurationEl` / `btnConfigEl` の DOM 参照
- `btnConfigEl.addEventListener(...)` イベントリスナー
- `updateUI()` 内の `inputDurationEl.value = ...` の行
- `updateButtonStates()` 内の `btnConfigEl.disabled = breaking` の行

**追加するコード:**

```js
// プリセットボタンのイベントリスナー
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const min = parseInt(btn.dataset.min, 10);
    await apiFetch('/config', 'POST', { duration_min: min });
    await poll();
  });
});
```

```js
// updateUI() 内に追加
function updatePresetHighlight(state) {
  const currentMin = Math.round(state.timer_duration / 60);
  document.querySelectorAll('.preset-btn').forEach(btn => {
    const isActive = parseInt(btn.dataset.min, 10) === currentMin;
    btn.classList.toggle('active', isActive);
    btn.disabled = state.is_breaking; // 休憩中は無効化
  });
}
```

### 4-3. `style.css` の変更

```css
/* 追加 */
.preset-group {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.preset-btn {
  padding: 6px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 13px;
  background: var(--color-surface);
  transition: border-color 0.2s, background 0.2s;
}

.preset-btn:hover:not(:disabled) {
  border-color: var(--color-primary);
}

.preset-btn.active {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: #fff;
}

/* 削除: .input-duration */
```

### 4-4. `routers/dialog.py` のバリデーション変更

```python
# 変更前
elif self.break_min not in (5, 10, 15):
# 変更後
elif self.break_min not in (5, 10, 15, 60):
```

---

## 5. CSV セッション時刻追加

### 5-1. `services/timer_service.py` の変更

#### `TimerState` にフィールド追加

```python
@dataclass
class TimerState:
    ...
    session_start_time: str = ""
```

#### `do_record()` の変更

JST は `timer_service.py` 内で独立して定義する（`log_service.py` からのインポートは循環依存の懸念があるため避ける）。

```python
from datetime import datetime, timedelta, timezone
_JST = timezone(timedelta(hours=9))

def do_record(action, break_min, snooze_min, task, load):
    with timer_lock:
        timer_state.prev_task = task
        timer_state.prev_load = load
        if action == "start":
            timer_state.is_first = False
            timer_state.is_running = True
            timer_state.session_start_time = datetime.now(_JST).strftime("%Y-%m-%dT%H:%M:%S")
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
            timer_state.session_start_time = datetime.now(_JST).strftime("%Y-%m-%dT%H:%M:%S")
```

### 5-2. `services/log_service.py` の変更

#### `COLUMNS` に追加

```python
COLUMNS = [
    "timestamp", "dialog_mode", "task", "load", "state", "action",
    "session_min", "accum_min", "break_min", "snooze_min",
    "session_start", "session_end",
]
```

#### `init_csv()` にマイグレーション処理を追加

新規 CSV 作成と既存 CSV への不足カラム追加を両方処理する。

```python
def init_csv() -> None:
    CSV_PATH.parent.mkdir(exist_ok=True)
    if not CSV_PATH.exists():
        pd.DataFrame(columns=COLUMNS).to_csv(CSV_PATH, index=False)
    else:
        # 既存 CSV に不足カラムを空文字で追加
        df = pd.read_csv(CSV_PATH)
        changed = False
        for col in COLUMNS:
            if col not in df.columns:
                df[col] = ""
                changed = True
        if changed:
            df[COLUMNS].to_csv(CSV_PATH, index=False)
```

#### `append_log()` シグネチャ変更

```python
def append_log(
    ...,
    session_start: str,
    session_end: str,
) -> None:
    record = {
        ...,
        "session_start": session_start,
        "session_end": session_end,
    }
```

#### `read_logs()` の後方互換処理

`init_csv()` のマイグレーションで通常はカバーされるが、念のため補完を維持する。

```python
def read_logs(limit=None):
    if not CSV_PATH.exists():
        return []
    df = pd.read_csv(CSV_PATH)
    for col in ("session_start", "session_end"):
        if col not in df.columns:
            df[col] = ""
    if limit is not None:
        df = df.tail(limit)
    return df.where(pd.notna(df), None).to_dict(orient="records")
```

### 5-3. `routers/dialog.py` の変更

JST は `routers/dialog.py` 内で独立して定義する。

```python
from datetime import datetime, timedelta, timezone
_JST = timezone(timedelta(hours=9))

@router.post("/record")
def record(body: RecordRequest) -> dict:
    s = get_state_snapshot()
    now_str = datetime.now(_JST).strftime("%Y-%m-%dT%H:%M:%S")

    if body.action == "start":
        session_start = now_str
        session_end = ""
    else:  # "rest" or "skip"
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
```
