# タスクリスト：初回実装

## 進捗サマリー

| フェーズ | 内容 | 状態 |
|---------|------|------|
| フェーズ1 | 環境セットアップ | ✅ 完了 |
| フェーズ2 | バックエンドコア | ✅ 完了 |
| フェーズ3 | バックグラウンドスレッド | ✅ 完了 |
| フェーズ4 | 全 API エンドポイント | ✅ 完了 |
| フェーズ5 | フロントエンド基礎 | ✅ 完了 |
| フェーズ6 | ダイアログ UI | ✅ 完了 |
| フェーズ7 | グラフ・ログ表示 | ✅ 完了 |
| フェーズ8 | 仕上げ | 🔲 手動チェック待ち |

---

## フェーズ1：環境セットアップ ✅

**目標:** `uv run uvicorn main:app` が通る最小構成を整える。

- [x] `pyproject.toml` を作成する（fastapi / uvicorn[standard] / pandas / dev: ruff）
- [x] `uv sync` を実行して `uv.lock` を生成する
- [x] ディレクトリ構成を作成する
  - [x] `routers/__init__.py`（空ファイル）
  - [x] `services/__init__.py`（空ファイル）
  - [x] `data/`（空ディレクトリ。`.gitkeep` は不要、`init_csv()` が起動時に生成する）
  - [x] `static/`（空ディレクトリ）
- [x] `main.py` を作成する（lifespan なし・StaticFiles なしの最小構成）
- [x] `start.bat` を作成する（uvicorn 起動 + `start "" http://127.0.0.1:8000`）
- [x] `.gitignore` を作成する（`data/log.csv` / `__pycache__/` / `.venv/`）
- [x] `git init` を実行してローカルリポジトリを初期化する
- [x] 初回コミットを作成する（`chore: 環境セットアップ`）
  - ステージング対象: `pyproject.toml` / `uv.lock` / `main.py` / `start.bat` / `.gitignore` / `routers/__init__.py` / `services/__init__.py` / `CLAUDE.md`（既存）/ `docs/`（既存）

**完了条件:** `uv run uvicorn main:app` が起動エラーなく動く。✅

---

## フェーズ2：バックエンドコア ✅

**目標:** `GET /state` が正しい JSON を返す状態にする。

- [x] `services/session_service.py` を作成する
  - [x] 閾値定数 4 件（`SESSION_WARN_SEC_SCORE` / `SESSION_WARN_SEC_LOAD` / `ACCUM_WARN_SEC` / `ACCUM_DANGER_SEC`）
  - [x] `get_advice(state_score, load, session_elapsed) -> dict`
  - [x] `get_accum_status(accum_elapsed) -> str`
- [x] `services/timer_service.py` を作成する
  - [x] `TimerState` `@dataclass`（フィールド 11 件）
  - [x] `timer_state` シングルトンと `timer_lock` を定義する
  - [x] `get_state_snapshot() -> TimerState`
  - [x] バックグラウンドスレッドはまだ実装しない
- [x] `routers/timer.py` を作成する
  - [x] `ConfigRequest` Pydantic モデル（`duration_min: int = Field(ge=1, le=120)`）
  - [x] `GET /state` エンドポイント
- [x] `main.py` に `routers/timer` を `include_router` する
- [x] コミットする（`feat: TimerState と GET /state を実装`）

**完了条件:** `curl http://127.0.0.1:8000/state` が `remaining` 等を含む JSON を返す。✅

---

## フェーズ3：バックグラウンドスレッド ✅

**目標:** タイマーが自動カウントダウンし、発火時に `dialog_triggered` が立つ。

- [x] `services/timer_service.py` に `_tick()` を実装する
  - [x] `is_breaking` 中の休憩カウントダウンと休憩終了 → `timer` ダイアログ発火
  - [x] `is_running` 中のカウントダウン・`session_elapsed` / `accum_elapsed` 加算
  - [x] タイマー発火 → `accum_elapsed >= ACCUM_DANGER_SEC` のとき `force`、それ以外は `timer` モード判定・`dialog_triggered = True`・`is_running = False`
- [x] `start_background_thread()` を実装する（`daemon=True` スレッド）
- [x] `main.py` を更新する
  - [x] `lifespan` コンテキストマネージャを追加する（`init_csv()` + `start_background_thread()`）
  - [x] `app = FastAPI(lifespan=lifespan)` に変更する
- [x] コミットする（`feat: バックグラウンドスレッドとタイマー発火を実装`）

**完了条件:** `GET /state` を繰り返し叩くと `remaining` が減少する。✅

---

## フェーズ4：全 API エンドポイント ✅

**目標:** バックエンドの全エンドポイントが仕様通りに動く。

### タイマー操作

- [x] `services/timer_service.py` に操作関数を追加する
  - [x] `do_start() -> str`
    - `is_first` のとき: `dialog_triggered = True`・`dialog_mode = "first"` のみ設定し、`is_running` は **変更しない**（タイマーは `POST /record action="start"` 後に開始する）
    - `is_first` でないとき: `is_running = True`
  - [x] `do_pause() -> str`
  - [x] `do_reset() -> str`
    - `is_running = False`・`is_breaking = False`・`is_first = True`・`session_elapsed = 0` をリセット
    - `accum_elapsed` は**リセットしない**（リセット操作は休憩ではないため）
    - `remaining = timer_duration`（設定秒数に戻す）
  - [x] `do_config(duration_sec: int) -> None`（`timer_duration` のみ更新。進行中の `remaining` は変更しない）
  - [x] `do_record(action, break_min, snooze_min, task, load) -> None`
    - `action="start"`: `is_first = False`・`is_running = True`
    - `action="rest"`: `accum_elapsed = 0`・`session_elapsed = 0`・`is_running = False`・`is_breaking = True`・`remaining = break_min * 60`
    - `action="skip"`: `session_elapsed = 0`・`is_breaking = False`（万が一残っている場合の解除）・`is_running = True`・`remaining = snooze_min * 60`
    - 注意: CSV 書き込みは Lock 外の `append_log()` で行うため、この関数内は状態更新のみ
  - [x] `do_ack() -> None`
- [x] `routers/timer.py` に残りのエンドポイントを追加する
  - [x] `POST /start`
  - [x] `POST /pause`
  - [x] `POST /reset`
  - [x] `POST /config`
- [x] コミットする（`feat: タイマー操作 API を実装`）

### ダイアログ・ログ

- [x] `services/log_service.py` を作成する
  - [x] `CSV_PATH`・`COLUMNS` 定数
  - [x] `init_csv() -> None`（ヘッダー行のみ CSV を生成。`data/` ディレクトリも `mkdir(exist_ok=True)` で作成）
  - [x] `_escape_csv_injection(value: str) -> str`（先頭文字が `=+-@` の場合にシングルクォートを付加）
  - [x] `append_log(...)` → CSV 追記
  - [x] `read_logs(limit: int | None) -> list[dict]`（CSV 読み込み順＝timestamp 昇順のまま返す）
- [x] `routers/dialog.py` を作成する
  - [x] `RecordRequest` Pydantic モデル（`model_validator` でアクション検証）
  - [x] `AdviceRequest` Pydantic モデル
  - [x] `POST /record`（`get_state_snapshot()` → `append_log()` → `do_record()` の順。スナップショットを先に取ることで `do_record` によるリセット前の elapsed を記録する）
  - [x] `POST /dialog/ack`
  - [x] `POST /advice`
- [x] `routers/log.py` を作成する
  - [x] `GET /logs`（クエリパラメータ `limit` を受け付ける。返却順は timestamp 昇順）
- [x] `main.py` に `routers/dialog` と `routers/log` を `include_router` する
- [x] `main.py` に `StaticFiles` マウントを追加する（`include_router` をすべて記述した後に配置）
- [x] コミットする（`feat: ダイアログ・ログ API と log_service を実装`）

**完了条件:** 全エンドポイントが `curl` または HTTPie で正常レスポンスを返す。✅

---

## フェーズ5：フロントエンド基礎 ✅

**目標:** ポーリングが動き、タイマー表示・累積バー・ボタン操作が機能する。

- [x] `static/index.html` を作成する
  - [x] Chart.js 4.x CDN タグ（バージョンピン留め。例: `@4.4.0`）
  - [x] `style.css` / `app.js` の読み込みタグ
  - [x] タイマー表示（`#timer-display`）・セッション経過表示（`#session-elapsed`）
  - [x] 累積バー（`#accum-bar`）
  - [x] 操作ボタン（開始 / 停止 / リセット / 自己申告）
  - [x] タイマー間隔変更フィールドと変更ボタン
  - [x] 接続エラーバナー（`#connection-error`、初期非表示）
  - [x] ダイアログオーバーレイ（`#dialog-overlay`、初期非表示）
  - [x] ログ一覧コンテナ（`#log-list`）
  - [x] グラフ用 `<canvas>` 要素 2 つ（`#state-chart` / `#session-chart`）
- [x] `static/style.css` を作成する
  - [x] CSS カスタムプロパティ（`--color-accum-normal` / `--color-accum-warn` / `--color-accum-danger` / `--color-dialog-danger` / `--color-state-low` / `--color-state-mid` / `--color-state-high`）
  - [x] 累積バーの `.accum-warn`（黄色）/ `.accum-danger`（赤）
  - [x] ダイアログオーバーレイ（`position: fixed; inset: 0; z-index: 1000`）
  - [x] `.state-low`（赤ボーダー）
  - [x] メイン画面最大幅 `800px` 中央揃え
  - [x] 休憩中状態（`.is-breaking`）のスタイル
- [x] `static/app.js` を作成する
  - [x] 定数定義（`POLL_INTERVAL_MS = 1000` / `ACCUM_WARN_MIN = 135` / `ACCUM_DANGER_MIN = 180` 等）
  - [x] 状態変数（`isPolling = false` / `isDialogOpen = false` / `lastState = null`）
  - [x] `poll()` 関数
    - `GET /state` → `updateUI(state)` → `lastState = state` で保持
    - `state.dialog_triggered && !isDialogOpen` のとき: `POST /dialog/ack` → `openDialog(state.dialog_mode)`
    - fetch 失敗時: `showConnectionError()`、成功時: `hideConnectionError()`
  - [x] `updateTimerDisplay(state)`（MM:SS フォーマット。`is_breaking` 中は「休憩中 MM:SS」表示）
  - [x] `updateAccumBar(state)`（幅計算・`.accum-warn` / `.accum-danger` クラスの付け替え）
  - [x] `updateButtonStates(state)`
    - `is_breaking = true` のとき: 開始 / 停止 / リセット / 自己申告ボタンをすべて無効化
    - `isDialogOpen = true` のとき: 自己申告ボタンを無効化
  - [x] 開始 / 停止 / リセット / 設定変更 のボタンイベントハンドラ（各 API を POST 後に `poll()` を呼ぶ）
  - [x] 接続エラー表示 `showConnectionError()` / 非表示 `hideConnectionError()`
  - [x] Chart.js グラフ初期化 `initCharts()` → 3 インスタンス生成（`#state-chart` / `#session-chart` / `#dialog-state-chart`）
    - `#dialog-state-chart` はダイアログ Step1 で使用するため、この時点で初期化しておく
  - [x] `setInterval(poll, POLL_INTERVAL_MS)` の開始
- [x] コミットする（`feat: フロントエンド基礎（ポーリング・タイマー表示・累積バー）`）

**完了条件:** ブラウザで開始 → 残り時間カウントダウン → 一時停止 → リセットが動く。累積バーが状態に応じて色変する。✅

---

## フェーズ6：ダイアログ UI ✅

**目標:** 4 モードのダイアログが正しいステップフローで動き、`POST /record` が送信される。

- [x] `static/index.html` にダイアログ内 HTML 要素を追加する
  - [x] ステップインジケーター（`#step-indicator`）
  - [x] 各ステップコンテナ（`#step-content`）
  - [x] 次へ / 戻るボタン
  - [x] ダイアログ内グラフ用 `<canvas>`（`#dialog-state-chart`、ダイアログオーバーレイ内に配置）
  - [x] アドバイスバナー表示エリア（`#advice-banner`、Step2 先頭に配置・初期非表示）
- [x] `static/app.js` にダイアログ制御を実装する
  - [x] `openDialog(mode)` → `isDialogOpen = true`・`dialogData` リセット・`showStep(1)`
  - [x] `showStep(n)` → モード別コンテンツ描画
  - [x] ステップインジケーター更新
  - [x] `onNextClick()` → バリデーション・アドバイス取得・ステップ遷移
  - [x] `onBackClick()` → `showStep(n - 1)`
  - [x] `fetchAdvice(stateScore, load)` → `POST /advice` → `pendingAdvice` に保持（`load` には `lastState.prev_load` を使用）
  - [x] `submitDialog()` → `POST /record` → `closeDialog()` → グラフ・ログ更新
  - [x] `closeDialog()` → オーバーレイ非表示・`isDialogOpen = false`
  - [x] ダイアログ背景クリックで閉じない（`stopPropagation` で実装）
  - [x] 自己申告ボタン → `isDialogOpen` でない場合のみ `openDialog('self')`
  - [x] `state-low` クラスの付け替え（スコア 1〜2 で付与、3 以上で除去）
- [x] コミットする（フェーズ5〜7 一括コミット）

**完了条件:** 全モードで `POST /record` が送信される。✅

---

## フェーズ7：グラフ・ログ表示 ✅

**目標:** 状態スコア推移グラフ・連続作業時間グラフ・ログ一覧が表示される。

- [x] `updateCharts(logs)` → 状態スコア折れ線・連続作業時間棒グラフを更新（`first` レコード除外）
- [x] `updateDialogChart(logs, previewScore)` → ダイアログ Step1 プレビュー付き更新（スコア変更でリアルタイム更新）
- [x] `renderLogs(logs)` → 直近 8 件を timestamp 降順で表示（`textContent` 使用）
- [x] ポーリング完了後に `GET /logs` を呼んでグラフ・ログを更新

**完了条件:** グラフとログ一覧が表示される。✅

---

## フェーズ8：仕上げ 🔲

**目標:** 受け入れ条件をすべて満たした状態にする。

- [x] `ruff` チェックを通す
  - [x] `uv run ruff format .` でフォーマットを適用する
  - [x] `uv run ruff check .` がエラーなし
  - [x] `uv run ruff format --check .` が差分なし
- [ ] 手動チェックリスト（`docs/development-guidelines.md` 参照）を実施する ← **ユーザーが実施**
  - [ ] タイマー動作（開始・発火・一時停止・リセット・間隔変更）
  - [ ] ダイアログフロー（`first` / `timer` / `self` / `force` 全モード）
  - [ ] 状態管理（スヌーズ後 `accum_elapsed` 不変・休憩後ゼロリセット・警告/上限色変）
  - [ ] データ永続化（CSV 書き込み・再起動後もログ表示）
  - [ ] `force` モード（180分以上で発動・スヌーズ非表示・自己申告では `self`）
  - [ ] グラフ表示（直近 30 件・`first` レコード除外）
  - [ ] セキュリティ（CSV インジェクション対策）
- [ ] 最終コミットを作成する（手動チェック完了後）

**完了条件:** `requirements.md` の受け入れ条件がすべて ✅ になる。

---

## 人手修正ログ

| 日付 | 対象ファイル | 修正内容 | 理由 |
|------|------------|---------|------|
| 2026-05-09 | `static/index.html`, `static/app.js` | ダイアログ内グラフの3バグ修正（canvas 未追加・`lastLogsCache` 未更新・切り離し後の`getElementById` 失敗） | 実装後の自動検査で発見 |
| 2026-05-09 | `services/log_service.py` | タイムスタンプをJST固定に変更（`datetime.now(JST)`） | ユーザー動作確認で発見 |
| 2026-05-09 | `static/app.js` | タイマー間隔変更フォーカス中の上書き防止 | ユーザー動作確認で発見 |
| 2026-05-09 | `static/app.js` | スヌーズのラベルを「作業を継続する（次の介入まで）」に変更 | ユーザー動作確認で発見 |
| 2026-05-09 | `static/index.html`, `static/app.js`, `static/style.css` | 累積180分超過時の常時警告バナー追加（点滅アニメーション付き） | ユーザー動作確認で発見 |
| 2026-05-09 | `static/app.js` | 連続作業時間グラフの縦軸単位を「分」表示に変更 | ユーザー動作確認で発見 |
| 2026-05-09 | `static/app.js` | 休憩中でも自己申告ボタンを有効化 | ユーザー動作確認で発見 |
| 2026-05-09 | `start.bat` | CRLF改行・`\"\"` 削除・ポート競合自動解消・Linux製`.venv`自動削除に修正 | Windows起動エラーをユーザーが確認 |
