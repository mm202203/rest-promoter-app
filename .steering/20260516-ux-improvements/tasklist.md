# tasklist.md — UX改善4件

## 進捗凡例
- [x] 未着手
- [x] 完了

---

## #1 改善① グラフ期間切り替え — HTML

- [x] `index.html` の `.chart-box` 内タイトルを `<div class="chart-title-row">` で包み、右側に期間ボタングループを追加
  - ボタン: 今日 / 前日 / 前々日 / 直近7日（`data-period` 属性付き）
  - 「今日」に `active` クラスを初期付与
- [x] `index.html` にスライダー `<input type="range" id="week-slider">` をグラフ canvas の直下に追加（初期クラス `hidden`）

---

## #2 改善① グラフ期間切り替え — CSS

- [x] `style.css` に `.chart-title-row`（flex, space-between）を追加
- [x] `style.css` の `.chart-title` から `margin-bottom` を除去（`.chart-title-row` が管理するため）
- [x] `style.css` に `.period-btn-group`・`.period-btn`・`.period-btn.active` を追加
- [x] `style.css` に `.week-slider` を追加

---

## #3 改善① グラフ期間切り替え — JS

- [x] `app.js` に定数 `WEEK_WINDOW = 20` を追加
- [x] `app.js` に状態変数 `selectedPeriod = 'today'`・`weekSliderValue = 0` を追加
- [x] `app.js` に `weekSliderEl` の DOM 参照を追加
- [x] `app.js` に `getPeriodDate(period)` 関数を追加（JST で N 日前の YYYY-MM-DD を返す）
- [x] `app.js` に `getLast7Dates()` 関数を追加（今日を含む直近7日の日付配列を返す）
- [x] `app.js` の `updateCharts(logs)` を改修
  - `workLogs` を rest/skip でフィルタリング（既存）
  - `selectedPeriod` に応じて `chartLogs` を決定
  - 7日ビュー: スライダーの `max` 設定・`weekSliderValue` を `max` にリセット・`weekSliderEl` の表示切り替え
  - 単日ビュー: 当該日の全件表示（30件上限撤廃）
  - X軸ラベル: 7日ビューは `M/D HH:MM`、単日は `HH:MM`
  - `updateDailyStats` は常に当日ログで呼ぶ（期間に連動しない）
- [x] `app.js` に期間ボタンのクリックイベントリスナーを追加
  - `selectedPeriod` を更新、ボタンの `active` を切り替え
  - `week` 選択時は `weekSliderValue = 0`（max 設定後に max へ上書き）→ `updateCharts` 内で max にリセット
- [x] `app.js` に `weekSliderEl` の `input` イベントリスナーを追加
  - `weekSliderValue = Number(weekSliderEl.value)`
  - `updateCharts(lastLogsCache)` を呼ぶ

---

## #4 改善② 開始ダイアログ質問順変更 — JS

- [x] `app.js` の `getStepCount` で `mode === 'first'` の戻り値を `3` → `4` に変更
- [x] `app.js` の `openDialog()` の `dialogData` 初期化に `work_min: null` を追加
- [x] `app.js` に `renderWorkDurationSelect()` 関数を追加
  - 選択肢: [15, 30, 45, 60, 75, 90] 分
  - デフォルト: `lastState ? Math.round(lastState.timer_duration / 60) : 60`（一致する選択肢をあらかじめ選択状態に）
  - 選択で `dialogData.work_min` にセット
- [x] `app.js` の `renderFirstStep(step)` を改修
  - step 1: `renderStateSelect()`
  - step 2: `renderTaskInput('今回の作業内容を入力してください')`
  - step 3: `renderLoadSelect()`
  - step 4: `renderWorkDurationSelect()`
- [x] `app.js` の `onNextClick` の first モードバリデーションを改修
  - step 1: `dialogData.state == null` なら return
  - step 2: task の空チェック
  - step 3: `dialogData.load == null` なら return
  - step 4: `dialogData.work_min == null` なら return
- [x] `app.js` の `submitDialog` の first モード処理を改修
  - `POST /config { duration_min: dialogData.work_min }` を `/record` の前に呼ぶ

---

## #5 改善③ リセットボタン非表示 — HTML

- [x] `index.html` の `btn-reset` に `style="display:none"` を追加

---

## #6 改善④ スヌーズ→継続作業 — JS

- [x] `app.js` の `renderSnoozeSelect()` を改修
  - タイトル: "スヌーズ時間を選択してください" → "継続作業時間を選択してください"
  - 選択肢: `[15, 30, 45, 60]` → `[15, 30, 45, 60, 75, 90]`
  - ラベル: `${min}分後` → `${min}分`
- [x] `app.js` の `renderLogs()` の `actionMap` で `skip: 'スヌーズ'` → `skip: '継続作業'`

---

## #7 改善④ スヌーズ→継続作業 — Python

- [x] `services/log_service.py` の日報サフィックス `（スヌーズ継続）` → `（継続作業）`
- [x] ruff チェックで lint エラーがないことを確認

---

## 完了条件（全体）

- [x] すべてのタスクが完了している
- [x] ブラウザで以下を手動確認済み
  - [x] 期間ボタンで今日／前日／前々日／直近7日のグラフが切り替わる
  - [x] 直近7日でスライダーが表示され、移動でグラフがスクロールする
  - [x] 直近7日のX軸に日付が表示される
  - [x] 開始ダイアログが 状態→作業内容→作業負荷→作業時間 の4ステップになっている
  - [x] 作業時間のデフォルトが現在のタイマー設定値になっている
  - [x] リセットボタンが非表示になっている
  - [x] 「スヌーズ」の表記がUI・日報から消えている
  - [x] 継続作業時間の選択肢が 15/30/45/60/75/90 分になっている
