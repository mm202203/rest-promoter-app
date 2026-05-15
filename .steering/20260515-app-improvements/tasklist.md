# tasklist.md — アプリ改善タスク群

## 進捗凡例
- [ ] 未着手
- [x] 完了

---

## #1 起動時メッセージ変更

- [x] `static/app.js` の `poll()` 内 `speak()` 呼び出しを `dialog_mode` で3分岐に変更

---

## #2 休憩ログの作業内容を空白にする

- [x] `static/app.js` の `submitDialog()` で `action='rest'` 時に `task = ''` を送信するよう変更
- [x] `routers/dialog.py` の `RecordRequest.task` を `min_length=0` に緩和
- [x] `routers/dialog.py` の `model_validator` に `action='start'` かつ `task` が空の場合のエラーチェックを追加
- [x] `static/app.js` の `renderLogs()` で `action === 'rest'` のとき task 欄を空白表示に変更

---

## #3 日報作成機能

- [x] `services/log_service.py` に `generate_daily_report()` 関数を追加
  - CSVから当日行を抽出
  - `action='rest'` / `'skip'` を作業セッション欄、`action='rest'` を休憩欄に分類
  - `action='start'` は除外
  - `skip` 行は「（スヌーズ継続）」と付記
  - `output/` フォルダを自動作成してファイル書き込み
  - `(filename, markdown_text)` を返す
- [x] `routers/log.py` に `POST /report` エンドポイントを追加
- [x] `static/index.html` に「日報を出力」ボタンを追加（`btn-self` の後）
- [x] `static/app.js` に `btnReportEl` の DOM 参照を追加
- [x] `static/app.js` にボタンクリックイベントを追加（`/report` POST → Blob ダウンロード）

---

## #4 休憩時間の実時間計測 ＋ 再起動復元

- [x] `services/timer_service.py` の `TimerState` に `break_elapsed: int = 0` を追加
- [x] `services/timer_service.py` の `_tick()` で `is_breaking` 中に `break_elapsed += 1` を追加
- [x] `services/timer_service.py` の `do_record(action='rest')` で `break_elapsed = 0` にリセット
- [x] `services/timer_service.py` に `restore_break_state(elapsed_sec, break_min)` 関数を追加
- [x] `services/log_service.py` に `get_last_rest_info()` 関数を追加（当日最終 rest 行から経過秒と break_min を返す）
- [x] `main.py` の `lifespan` で起動時に `get_last_rest_info()` → `restore_break_state()` を呼び出す
- [x] `routers/timer.py` の `/state` レスポンスに `break_elapsed` を追加
- [x] `static/app.js` の `updateDailyStats()` を改修
  - 進行中の休憩は `state.break_elapsed` から計算
  - 完了した休憩は `restLogs.slice(0, -1)` の `break_min` を合計

---

## #5 棒グラフへの作業負荷の視覚化

- [x] `static/app.js` に `loadColor(load)` ヘルパー関数を追加（水色 / 青 / 赤の3段階）
- [x] `static/app.js` の `initCharts()` で `sessionChart` 作業データセットの `backgroundColor` を静的単色から削除
- [x] `static/app.js` の `updateCharts()` で `sessionChart.data.datasets[0].backgroundColor` を `loadColor` による色配列に変更
- [x] `static/index.html` の `session-chart` の `chart-box` 内に負荷色の凡例説明を追加

---

## #6 状態スコア選択前のグラフ表示

- [x] `static/app.js` の `renderTimerStep()` で step 1 の `renderDialogChart()` 呼び出し直後に `updateDialogChart(lastLogsCache, null)` を追加（`force` モードも同様）

---

## 完了条件（全体）

- [x] すべてのタスクが完了している
- [x] `pyproject.toml` の型チェック・リントが通る
- [ ] ブラウザで以下を手動確認済み
  - [ ] 起動時の音声が「おはようございます」になる
  - [ ] 休憩ログの作業内容欄が空白になる
  - [ ] 日報ボタンでファイルがダウンロードされ、`output/` にも生成される
  - [ ] 休憩中に「本日の休憩」が1分ごとに更新される
  - [ ] 棒グラフの作業バーが負荷に応じて色分けされる
  - [ ] ダイアログ開示直後からグラフが表示される

---

---

## #7 日報の作業時間集計をタイムスタンプ方式（Option B）に変更

- [x] `services/log_service.py` の `generate_daily_report()` を `session_min` 集計から `session_end - session_start` 集計に変更
  - 各行を全件イテレートし `last_session_start` をトラッキング
  - `session_start` が NaN の行（サーバー再起動起因）は `last_session_start` で補完
  - `work_time_min = 0` の行はレポートに表示しない
  - サマリーの総作業時間もタイムスタンプ由来の合計に変更

---

## 完了条件（追加）

- [x] `generate_daily_report()` がタイムスタンプ方式で集計する

---

## 人手修正ログ

（実装中に発生した手動修正はここに追記）
