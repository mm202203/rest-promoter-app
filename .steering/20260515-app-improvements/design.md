# design.md — アプリ改善タスク群

## 1. 起動時メッセージ変更

### 変更するコンポーネント
- `static/app.js`

### 実装アプローチ
`poll()` 内でダイアログを開く直前に `speak()` を呼ぶ箇所（現 276-279 行）で、`state.dialog_mode` による分岐を追加する。

```js
// 変更前
speak(wasBreaking ? '休憩が終わりました...' : '作業時間が終わりました...')

// 変更後
const msg = state.dialog_mode === 'first'
  ? 'おはようございます。本日の状態を教えてください。'
  : wasBreaking
    ? '休憩が終わりました。今の状態を教えてください。'
    : '作業時間が終わりました。今の状態を教えてください。';
speak(msg);
```

### 影響範囲
- `speak()` の呼び出し箇所のみ。他機能への影響なし。

---

## 2. 休憩ログの作業内容を空白にする

### 変更するコンポーネント
- `static/app.js`（2箇所）

### 実装アプローチ

**① フロントエンド送信値の変更（`submitDialog()`）**

`dialogRoute === 'rest'` または `mode === 'force'` のとき、現状は `task = lastState.prev_task` を送信している。これを `task = ''` に変更する。

バリデーション側（`routers/dialog.py`）は `task: str = Field(min_length=1)` になっているため、**バックエンドのバリデーションも `min_length=0` に緩和する**必要がある。ただし `action='start'`（初回）のときは task が必須のまま維持するため、`model_validator` 内で `action == "start" and not self.task` の場合にエラーを返す個別チェックを追加する。

**② 表示の変更（`renderLogs()`）**

`l.action === 'rest'` のとき、`task.textContent` を空文字にする。

```js
task.textContent = l.action === 'rest' ? '' : l.task;
```

### 影響範囲
- `routers/dialog.py` の `RecordRequest.task` バリデーション（`min_length=1` → `min_length=0`）
- `static/app.js` の `submitDialog()` と `renderLogs()`

---

## 3. 日報作成機能

### 変更するコンポーネント
- `services/log_service.py`（関数追加）
- `routers/log.py`（エンドポイント追加）
- `static/index.html`（ボタン追加）
- `static/app.js`（ボタンイベント追加）

### アクション別の日報への含め方

| action | 作業セッション欄 | 休憩欄 |
|--------|------------------|--------|
| `start` | 含めない（session_min = 0 のため意味なし） | - |
| `rest`  | 含める（session_min を作業時間として使用） | 含める（break_min を休憩時間として使用） |
| `skip`  | 含める（session_min を作業時間として使用） | - |

→「休憩は休憩欄、それ以外の作業記録は作業セッション欄」というシンプルな分類。

### 実装アプローチ

**バックエンド: `services/log_service.py`**

`generate_daily_report() -> tuple[str, str]` 関数を追加。
- 引数: なし（当日JST固定）
- 戻り値: `(filename, markdown_text)`
- 処理: CSVから当日行を抽出し、以下のMarkdownを生成

```markdown
# 日報 2026-05-15 18:30:42

## 作業セッション
- 09:12 タスクA（負荷:3 / 状態:4）→ 50分
- 10:05 タスクB（負荷:4 / 状態:3）→ 45分（スヌーズ継続）
- 11:00 タスクB（負荷:4 / 状態:3）→ 30分

## 休憩
- 10:55 15分休憩
- 13:10 10分休憩

## サマリー
- 総作業時間: 125分
- 総休憩時間: 25分
```

- `output/` フォルダが存在しない場合は `Path("output").mkdir(exist_ok=True)` で自動作成
- ファイル名: `YYYYMMDD_HHMMSS.md`（出力時刻のJST）
- ファイルをサーバー側 `output/` に書き込んだうえで、テキスト内容もレスポンスに返す（ブラウザダウンロードと二重化）

**バックエンド: `routers/log.py`**

```python
@router.post("/report")
def create_report() -> dict:
    filename, content = generate_daily_report()
    return {"filename": filename, "content": content}
```

**フロントエンド: `static/index.html`**

既存の操作ボタングループの末尾（`btn-self` の後）に追加：

```html
<button id="btn-report" class="btn btn-secondary">日報を出力</button>
```

**フロントエンド: `static/app.js`**

```js
btnReportEl.addEventListener('click', async () => {
  const res = await apiFetch('/report', 'POST');
  // ブラウザダウンロード
  const blob = new Blob([res.content], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = res.filename;
  a.click();
});
```

### 影響範囲
- 新規エンドポイント追加のみ。既存機能への影響なし。

---

## 4. 休憩時間の実時間計測

### 変更するコンポーネント
- `services/timer_service.py`
- `services/log_service.py`（再起動復元用関数追加）
- `routers/timer.py`
- `main.py`
- `static/app.js`

### 実装アプローチ

**`services/timer_service.py`**

`TimerState` に `break_elapsed: int = 0` を追加。

`_tick()` の休憩ブロック内で `break_elapsed += 1` を加算：

```python
if timer_state.is_breaking:
    if timer_state.remaining > 0:
        timer_state.remaining -= 1
        timer_state.break_elapsed += 1  # 追加
    if timer_state.remaining == 0:
        ...
```

`do_record(action='rest')` で `break_elapsed = 0` にリセット：

```python
elif action == 'rest':
    ...
    timer_state.break_elapsed = 0  # 追加
```

再起動復元用の `restore_break_state(elapsed_sec: int, break_min: int)` 関数を追加：

```python
def restore_break_state(elapsed_sec: int, break_min: int) -> None:
    with timer_lock:
        total_sec = break_min * 60
        timer_state.is_breaking = True
        timer_state.is_first = False
        timer_state.break_elapsed = min(elapsed_sec, total_sec)
        timer_state.remaining = max(total_sec - elapsed_sec, 0)
        # remaining が 0 になっていても _tick() が処理するため is_breaking のままでよい
```

**`services/log_service.py`**

`get_last_rest_info() -> tuple[int, int] | None` 関数を追加。
- 当日CSVの最終行が `action='rest'` の場合、`(elapsed_sec, break_min)` を返す
- それ以外は `None` を返す

```python
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
    rest_time = datetime.fromisoformat(last["timestamp"]).replace(tzinfo=JST)
    elapsed_sec = int((datetime.now(JST) - rest_time).total_seconds())
    break_min = int(last["break_min"])
    return elapsed_sec, break_min
```

**`main.py`**

`lifespan` 内で起動時に休憩状態を復元：

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_csv()
    info = get_last_rest_info()
    if info:
        restore_break_state(*info)
    start_background_thread()
    yield
```

**`routers/timer.py`**

`/state` レスポンスに `break_elapsed` を追加：

```python
return {
    ...
    "break_elapsed": s.break_elapsed,
}
```

**`static/app.js` — `updateDailyStats()`**

```js
function updateDailyStats(todayLogs) {
  // 作業時間（変更なし）
  const completedWorkMin = todayLogs
    .filter(l => l.action === 'rest' || l.action === 'skip')
    .reduce((sum, l) => sum + (Number(l.session_min) || 0), 0);
  const currentSessionMin = lastState ? Math.floor(lastState.session_elapsed / 60) : 0;
  statsWorkEl.textContent = `${completedWorkMin + currentSessionMin}分`;

  // 休憩時間: 進行中の休憩は break_elapsed で計測
  const restLogs = todayLogs.filter(l => l.action === 'rest');
  const completedRestLogs = (lastState && lastState.is_breaking)
    ? restLogs.slice(0, -1)   // 最新 rest ログは進行中なので除外
    : restLogs;
  const completedBreakMin = completedRestLogs.reduce((sum, l) => sum + (Number(l.break_min) || 0), 0);
  const currentBreakMin = lastState ? Math.floor(lastState.break_elapsed / 60) : 0;
  statsBreakEl.textContent = `${completedBreakMin + currentBreakMin}分`;
}
```

### 影響範囲
- `TimerState` のフィールド追加（既存フィールドへの影響なし）
- `/state` レスポンスへのフィールド追加（後方互換あり）
- 起動時に CSV を1回読み込む処理が追加される（`init_csv()` の後なので順序保証あり）

---

## 5. 棒グラフへの作業負荷の視覚化

### 変更するコンポーネント
- `static/app.js`

### 実装アプローチ

**負荷色ヘルパー関数を追加：**

```js
function loadColor(load) {
  if (load >= 4) return '#e53935';   // 赤（重い）
  if (load === 3) return '#1976d2';  // 青（普通、現行色）
  return '#64b5f6';                  // 水色（軽い）
}
```

**`initCharts()` の `sessionChart` 定義を変更：**

- 作業データセットの `backgroundColor` を静的な単色文字列から削除し、`updateCharts()` で動的に設定する。

**`updateCharts()` を変更：**

```js
sessionChart.data.datasets[0].backgroundColor = chartLogs.map(l => loadColor(Number(l.load) || 3));
```

**凡例の対応：**

Chart.js の凡例は自動生成されるが、作業データセットは単一ラベル（`'作業'`）のため、色の意味がわからない。グラフタイトルの下に HTML で補足説明を追加する。

```html
<!-- index.html の session-chart の chart-box 内に追加 -->
<div class="chart-legend-note">
  作業バーの色: <span style="color:#64b5f6">■ 負荷低(1-2)</span>
  <span style="color:#1976d2">■ 負荷中(3)</span>
  <span style="color:#e53935">■ 負荷高(4-5)</span>
</div>
```

### 影響範囲
- `app.js` の `loadColor()` 追加と `updateCharts()` の変更のみ。
- `index.html` の凡例説明の追加。

---

## 6. 状態スコア選択前のグラフ表示

### 変更するコンポーネント
- `static/app.js`

### 実装アプローチ

`renderTimerStep()` の step 1 で `renderDialogChart()` を呼んだ直後に `updateDialogChart(lastLogsCache, null)` を追加する。`force` モードも同様。

```js
function renderTimerStep(step, mode) {
  if (mode === 'force') {
    if (step === 1) {
      renderStateSelect();
      renderDialogChart();
      updateDialogChart(lastLogsCache, null);  // 追加
    }
    ...
  }
  if (step === 1) {
    renderStateSelect();
    renderDialogChart();
    updateDialogChart(lastLogsCache, null);  // 追加
  }
  ...
}
```

`lastLogsCache` は直前の `poll()` で更新済みのため、ダイアログ開示時点で当日データが入っている。

### 影響範囲
- `renderTimerStep()` の2箇所のみ。他機能への影響なし。

---

## データ構造の変更まとめ

| 変更 | 内容 |
|------|------|
| `TimerState.break_elapsed` | `int = 0` フィールド追加（#4） |
| `/state` レスポンス | `break_elapsed` キー追加（#4） |
| `RecordRequest.task` | `min_length=1` → `min_length=0`（#2）※ action='start' は model_validator で個別必須チェック |
| `output/` フォルダ | 日報出力用に新規作成（#3） |
| `get_last_rest_info()` | 起動時の休憩状態復元用（#4） |
| `restore_break_state()` | timer_service の起動時復元関数（#4） |

既存のCSVスキーマ・他APIレスポンスへの破壊的変更はなし。
