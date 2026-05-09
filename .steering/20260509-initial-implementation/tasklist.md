# タスクリスト：初回実装

## 進捗サマリー

| フェーズ | 内容 | 状態 |
|---------|------|------|
| フェーズ1 | 環境セットアップ | ⬜ 未着手 |
| フェーズ2 | バックエンドコア | ⬜ 未着手 |
| フェーズ3 | バックグラウンドスレッド | ⬜ 未着手 |
| フェーズ4 | 全 API エンドポイント | ⬜ 未着手 |
| フェーズ5 | フロントエンド基礎 | ⬜ 未着手 |
| フェーズ6 | ダイアログ UI | ⬜ 未着手 |
| フェーズ7 | グラフ・ログ表示 | ⬜ 未着手 |
| フェーズ8 | 仕上げ | ⬜ 未着手 |

---

## フェーズ1：環境セットアップ

**目標:** `uv run uvicorn main:app` が通る最小構成を整える。

- [ ] `pyproject.toml` を作成する（fastapi / uvicorn[standard] / pandas / dev: ruff）
- [ ] `uv sync` を実行して `uv.lock` を生成する
- [ ] ディレクトリ構成を作成する
  - [ ] `routers/__init__.py`（空ファイル）
  - [ ] `services/__init__.py`（空ファイル）
  - [ ] `data/`（空ディレクトリ。`.gitkeep` は不要、`init_csv()` が起動時に生成する）
  - [ ] `static/`（空ディレクトリ）
- [ ] `main.py` を作成する（lifespan なし・StaticFiles なしの最小構成）
- [ ] `start.bat` を作成する（uvicorn 起動 + `start "" http://127.0.0.1:8000`）
- [ ] `.gitignore` を作成する（`data/log.csv` / `__pycache__/` / `.venv/`）
- [ ] `git init` を実行してローカルリポジトリを初期化する
- [ ] 初回コミットを作成する（`chore: 環境セットアップ`）
  - ステージング対象: `pyproject.toml` / `uv.lock` / `main.py` / `start.bat` / `.gitignore` / `routers/__init__.py` / `services/__init__.py` / `CLAUDE.md`（既存）/ `docs/`（既存）

**完了条件:** `uv run uvicorn main:app` が起動エラーなく動く。

---

## フェーズ2：バックエンドコア

**目標:** `GET /state` が正しい JSON を返す状態にする。

- [ ] `services/session_service.py` を作成する
  - [ ] 閾値定数 4 件（`SESSION_WARN_SEC_SCORE` / `SESSION_WARN_SEC_LOAD` / `ACCUM_WARN_SEC` / `ACCUM_DANGER_SEC`）
  - [ ] `get_advice(state_score, load, session_elapsed) -> dict`
  - [ ] `get_accum_status(accum_elapsed) -> str`
- [ ] `services/timer_service.py` を作成する
  - [ ] `TimerState` `@dataclass`（フィールド 11 件）
  - [ ] `timer_state` シングルトンと `timer_lock` を定義する
  - [ ] `get_state_snapshot() -> TimerState`
  - [ ] バックグラウンドスレッドはまだ実装しない
- [ ] `routers/timer.py` を作成する
  - [ ] `ConfigRequest` Pydantic モデル（`duration_min: int = Field(ge=1, le=120)`）
  - [ ] `GET /state` エンドポイント
- [ ] `main.py` に `routers/timer` を `include_router` する
- [ ] コミットする（`feat: TimerState と GET /state を実装`）

**完了条件:** `curl http://127.0.0.1:8000/state` が `remaining` 等を含む JSON を返す。

---

## フェーズ3：バックグラウンドスレッド

**目標:** タイマーが自動カウントダウンし、発火時に `dialog_triggered` が立つ。

- [ ] `services/timer_service.py` に `_tick()` を実装する
  - [ ] `is_breaking` 中の休憩カウントダウンと休憩終了 → `timer` ダイアログ発火
  - [ ] `is_running` 中のカウントダウン・`session_elapsed` / `accum_elapsed` 加算
  - [ ] タイマー発火 → `accum_elapsed >= ACCUM_DANGER_SEC` のとき `force`、それ以外は `timer` モード判定・`dialog_triggered = True`・`is_running = False`
- [ ] `start_background_thread()` を実装する（`daemon=True` スレッド）
- [ ] `main.py` を更新する
  - [ ] `lifespan` コンテキストマネージャを追加する（`init_csv()` + `start_background_thread()`）
  - [ ] `app = FastAPI(lifespan=lifespan)` に変更する
- [ ] コミットする（`feat: バックグラウンドスレッドとタイマー発火を実装`）

**完了条件:** `GET /state` を繰り返し叩くと `remaining` が減少する。

---

## フェーズ4：全 API エンドポイント

**目標:** バックエンドの全エンドポイントが仕様通りに動く。

### タイマー操作

- [ ] `services/timer_service.py` に操作関数を追加する
  - [ ] `do_start() -> str`
    - `is_first` のとき: `dialog_triggered = True`・`dialog_mode = "first"` のみ設定し、`is_running` は **変更しない**（タイマーは `POST /record action="start"` 後に開始する）
    - `is_first` でないとき: `is_running = True`
  - [ ] `do_pause() -> str`
  - [ ] `do_reset() -> str`
    - `is_running = False`・`is_breaking = False`・`is_first = True`・`session_elapsed = 0` をリセット
    - `accum_elapsed` は**リセットしない**（リセット操作は休憩ではないため）
    - `remaining = timer_duration`（設定秒数に戻す）
  - [ ] `do_config(duration_sec: int) -> None`（`timer_duration` のみ更新。進行中の `remaining` は変更しない）
  - [ ] `do_record(action, break_min, snooze_min, task, load) -> None`
    - `action="start"`: `is_first = False`・`is_running = True`
    - `action="rest"`: `accum_elapsed = 0`・`session_elapsed = 0`・`is_running = False`・`is_breaking = True`・`remaining = break_min * 60`
    - `action="skip"`: `session_elapsed = 0`・`is_breaking = False`（万が一残っている場合の解除）・`is_running = True`・`remaining = snooze_min * 60`
    - 注意: CSV 書き込みは Lock 外の `append_log()` で行うため、この関数内は状態更新のみ
  - [ ] `do_ack() -> None`
- [ ] `routers/timer.py` に残りのエンドポイントを追加する
  - [ ] `POST /start`
  - [ ] `POST /pause`
  - [ ] `POST /reset`
  - [ ] `POST /config`
- [ ] コミットする（`feat: タイマー操作 API を実装`）

### ダイアログ・ログ

- [ ] `services/log_service.py` を作成する
  - [ ] `CSV_PATH`・`COLUMNS` 定数
  - [ ] `init_csv() -> None`（ヘッダー行のみ CSV を生成。`data/` ディレクトリも `mkdir(exist_ok=True)` で作成）
  - [ ] `_escape_csv_injection(value: str) -> str`（先頭文字が `=+-@` の場合にシングルクォートを付加）
  - [ ] `append_log(...)` → CSV 追記
  - [ ] `read_logs(limit: int | None) -> list[dict]`（CSV 読み込み順＝timestamp 昇順のまま返す）
- [ ] `routers/dialog.py` を作成する
  - [ ] `RecordRequest` Pydantic モデル（`model_validator` でアクション検証）
  - [ ] `AdviceRequest` Pydantic モデル
  - [ ] `POST /record`（`get_state_snapshot()` → `append_log()` → `do_record()` の順。スナップショットを先に取ることで `do_record` によるリセット前の elapsed を記録する）
  - [ ] `POST /dialog/ack`
  - [ ] `POST /advice`
- [ ] `routers/log.py` を作成する
  - [ ] `GET /logs`（クエリパラメータ `limit` を受け付ける。返却順は timestamp 昇順）
- [ ] `main.py` に `routers/dialog` と `routers/log` を `include_router` する
- [ ] `main.py` に `StaticFiles` マウントを追加する（`include_router` をすべて記述した後に配置）
- [ ] コミットする（`feat: ダイアログ・ログ API と log_service を実装`）

**完了条件:** 全エンドポイントが `curl` または HTTPie で正常レスポンスを返す。

---

## フェーズ5：フロントエンド基礎

**目標:** ポーリングが動き、タイマー表示・累積バー・ボタン操作が機能する。

- [ ] `static/index.html` を作成する
  - [ ] Chart.js 4.x CDN タグ（バージョンピン留め。例: `@4.4.0`）
  - [ ] `style.css` / `app.js` の読み込みタグ
  - [ ] タイマー表示（`#timer-display`）・セッション経過表示（`#session-elapsed`）
  - [ ] 累積バー（`#accum-bar`）
  - [ ] 操作ボタン（開始 / 停止 / リセット / 自己申告）
  - [ ] タイマー間隔変更フィールドと変更ボタン
  - [ ] 接続エラーバナー（`#connection-error`、初期非表示）
  - [ ] ダイアログオーバーレイ（`#dialog-overlay`、初期非表示）
  - [ ] ログ一覧コンテナ（`#log-list`）
  - [ ] グラフ用 `<canvas>` 要素 2 つ（`#state-chart` / `#session-chart`）
- [ ] `static/style.css` を作成する
  - [ ] CSS カスタムプロパティ（`--color-accum-normal` / `--color-accum-warn` / `--color-accum-danger` / `--color-dialog-danger` / `--color-state-low` / `--color-state-mid` / `--color-state-high`）
  - [ ] 累積バーの `.accum-warn`（黄色）/ `.accum-danger`（赤）
  - [ ] ダイアログオーバーレイ（`position: fixed; inset: 0; z-index: 1000`）
  - [ ] `.state-low`（赤ボーダー）
  - [ ] メイン画面最大幅 `800px` 中央揃え
  - [ ] 休憩中状態（`.is-breaking`）のスタイル
- [ ] `static/app.js` を作成する
  - [ ] 定数定義（`POLL_INTERVAL_MS = 1000` / `ACCUM_WARN_MIN = 135` / `ACCUM_DANGER_MIN = 180` 等）
  - [ ] 状態変数（`isPolling = false` / `isDialogOpen = false` / `lastState = null`）
  - [ ] `poll()` 関数
    - `GET /state` → `updateUI(state)` → `lastState = state` で保持
    - `state.dialog_triggered && !isDialogOpen` のとき: `POST /dialog/ack` → `openDialog(state.dialog_mode)`
    - fetch 失敗時: `showConnectionError()`、成功時: `hideConnectionError()`
  - [ ] `updateTimerDisplay(state)`（MM:SS フォーマット。`is_breaking` 中は「休憩中 MM:SS」表示）
  - [ ] `updateAccumBar(state)`（幅計算・`.accum-warn` / `.accum-danger` クラスの付け替え）
  - [ ] `updateButtonStates(state)`
    - `is_breaking = true` のとき: 開始 / 停止 / リセット / 自己申告ボタンをすべて無効化
    - `isDialogOpen = true` のとき: 自己申告ボタンを無効化
  - [ ] 開始 / 停止 / リセット / 設定変更 のボタンイベントハンドラ（各 API を POST 後に `poll()` を呼ぶ）
  - [ ] 接続エラー表示 `showConnectionError()` / 非表示 `hideConnectionError()`
  - [ ] Chart.js グラフ初期化 `initCharts()` → 3 インスタンス生成（`#state-chart` / `#session-chart` / `#dialog-state-chart`）
    - `#dialog-state-chart` はダイアログ Step1 で使用するため、この時点で初期化しておく
  - [ ] `setInterval(poll, POLL_INTERVAL_MS)` の開始
- [ ] コミットする（`feat: フロントエンド基礎（ポーリング・タイマー表示・累積バー）`）

**完了条件:** ブラウザで開始 → 残り時間カウントダウン → 一時停止 → リセットが動く。累積バーが状態に応じて色変する。

---

## フェーズ6：ダイアログ UI

**目標:** 4 モードのダイアログが正しいステップフローで動き、`POST /record` が送信される。

- [ ] `static/index.html` にダイアログ内 HTML 要素を追加する
  - [ ] ステップインジケーター（`#step-indicator`）
  - [ ] 各ステップコンテナ（`#step-content`）
  - [ ] 次へ / 戻るボタン
  - [ ] ダイアログ内グラフ用 `<canvas>`（`#dialog-state-chart`、既存のダイアログオーバーレイ内に配置）
  - [ ] アドバイスバナー表示エリア（`#advice-banner`、Step2 先頭に配置・初期非表示）
- [ ] `static/app.js` にダイアログ制御を実装する
  - [ ] `openDialog(mode)`
    - `isDialogOpen = true` に設定する
    - `dialogData` をリセットする（`state: null` / `task: ''` / `load: null` / `action: null` / `break_min: null` / `snooze_min: null`）
    - `showStep(1)` を呼ぶ
  - [ ] `showStep(n)` → モード別コンテンツ描画（DOM を `textContent` で更新）
    - [ ] `first` Step1：作業内容テキスト入力（`lastState.prev_task` をデフォルト値に設定）
    - [ ] `first` Step2：作業負荷（1〜5 選択、`lastState.prev_load` をデフォルト値に設定）
    - [ ] `first` Step3：状態スコア（1〜5 選択）
    - [ ] `timer`/`self`/`force` Step1：状態スコア選択 + `updateDialogChart()` 呼び出し（スコア変更のたびにプレビュー更新）
    - [ ] `timer`/`self`/`force` Step2：アドバイスバナー表示（前ステップで取得済みの結果を表示）+ 作業内容テキスト入力（`lastState.prev_task` をデフォルト値に設定）
    - [ ] `timer`/`self`/`force` Step3：作業負荷（1〜5 選択、`lastState.prev_load` をデフォルト値に設定）
    - [ ] `timer`/`self`/`force` Step4：休憩/スヌーズ選択（`force` はスヌーズ選択肢を `hidden`、休憩時間 15分 固定）
  - [ ] ステップインジケーター更新（`showStep` 内で現在ステップ番号をドット列で描画）
  - [ ] `onNextClick()`
    - 作業内容（`task`）の空欄バリデーション：空のとき `textContent` でエラーメッセージ表示・ステップを進めない
    - `timer`/`self`/`force` Step1 完了後：`fetchAdvice(dialogData.state, lastState.prev_load)` を呼んでレスポンスを保持してから Step2 へ遷移する（`load` には `lastState.prev_load` を使う）
    - 最終ステップ完了後：`submitDialog()` を呼ぶ
    - それ以外：`showStep(n + 1)` を呼ぶ
  - [ ] `onBackClick()` → `showStep(n - 1)`
  - [ ] `fetchAdvice(stateScore, load)` → `POST /advice` → レスポンス（`{level, message}`）を変数に保持する
  - [ ] `submitDialog()` → `POST /record` → `closeDialog()` → `updateCharts()` + `renderLogs()`
  - [ ] `closeDialog()`
    - オーバーレイを非表示にする
    - `isDialogOpen = false` に設定する
  - [ ] ダイアログオーバーレイの背景クリックでダイアログが**閉じない**ようにする（背景クリックイベントをキャプチャして何もしないか、または `pointer-events: none` を適切に設定する）
  - [ ] 自己申告ボタン → `isDialogOpen` でない場合のみ `openDialog('self')` を呼ぶ（`accum_elapsed` の値に関わらず常に `self` モード）
  - [ ] `state-low` クラスの付け替え（状態スコア 1〜2 のときダイアログルート要素に付与、3 以上なら除去）
- [ ] コミットする（`feat: ダイアログ UI（4モード・ステップフロー・アドバイス）`）

**完了条件:** `first` / `timer` / `self` / `force` の各モードで全ステップを通過して `POST /record` が送信される。`force` モードでスヌーズが非表示になる。作業内容空欄でエラーが出る。ダイアログ背景クリックでは閉じない。

---

## フェーズ7：グラフ・ログ表示

**目標:** 状態スコア推移グラフ・連続作業時間グラフ・ログ一覧が表示される。

- [ ] `static/app.js` に Chart.js グラフ更新関数を実装する（`initCharts()` はフェーズ5で実装済み）
  - [ ] `updateCharts(logs)` → メイン画面の 2 グラフのデータを更新する
    - [ ] 状態スコア推移グラフ（折れ線、直近 30 件）：点の色分け（1〜2=赤 / 3=グレー / 4〜5=緑）
    - [ ] 連続作業時間グラフ（棒グラフ、直近 30 件）：`session_min = 0`（`first` モードレコード）を除外する
  - [ ] `updateDialogChart(logs, previewScore)` → ダイアログ Step1 のプレビュー付き更新
    - 既存ログ（直近 30 件）の末尾に今回のスコアを仮追加してプレビュー表示する
    - 状態スコア選択変更のたびにリアルタイム更新する
- [ ] `static/app.js` に `renderLogs(logs)` を実装する
  - [ ] `GET /logs` の結果を timestamp 降順（末尾から逆順）で直近 8 件表示する
  - [ ] DOM 更新は `textContent` を使う（`innerHTML` 禁止）
- [ ] ポーリング完了後に `GET /logs` を呼んでグラフ・ログを更新する（毎ポーリングごと、または `submitDialog()` 後）
- [ ] コミットする（`feat: 状態スコア・連続作業時間グラフとログ一覧を実装`）

**完了条件:** グラフにデータが表示される。ダイアログ Step1 でスコア選択時にプレビューが更新される。ログ一覧に直近 8 件が表示される。

---

## フェーズ8：仕上げ

**目標:** 受け入れ条件をすべて満たした状態にする。

- [ ] `ruff` チェックを通す
  - [ ] `uv run ruff format .` でフォーマットを適用する
  - [ ] `uv run ruff check .` がエラーなし
  - [ ] `uv run ruff format --check .` が差分なし
- [ ] 手動チェックリスト（`docs/development-guidelines.md` 参照）を実施する
  - [ ] タイマー動作（開始・発火・一時停止・リセット・間隔変更）
  - [ ] ダイアログフロー（`first` / `timer` / `self` / `force` 全モード）
  - [ ] 状態管理（スヌーズ後 `accum_elapsed` 不変・休憩後ゼロリセット・警告/上限色変）
  - [ ] データ永続化（CSV 書き込み・再起動後もログ表示）
  - [ ] `force` モード（180分以上で発動・スヌーズ非表示・自己申告では `self`）
  - [ ] グラフ表示（直近 30 件・`first` レコード除外）
  - [ ] セキュリティ（CSV インジェクション対策）
- [ ] 最終コミットを作成する（`feat: 初回実装完了`）
- [ ] `main` に `--no-ff` マージする

**完了条件:** `requirements.md` の受け入れ条件がすべて ✅ になる。

---

## 人手修正ログ

実装中に Claude Code の出力を手動で修正した場合、ここに記録する。

| 日付 | 対象ファイル | 修正内容 | 理由 |
|------|------------|---------|------|
| （記録なし） | | | |
