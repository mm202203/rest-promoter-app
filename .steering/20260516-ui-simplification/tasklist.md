# tasklist.md — UI シンプル化

## 進捗凡例
- [x] 未着手
- [x] 完了

---

## #1 ボタン構成 — HTML

- [x] `index.html` の `btn-self` ラベルを「自己申告」→「立ち止まる」に変更
- [x] `index.html` の `btn-self` に `tooltip-btn` クラスと `data-tooltip="今の状態を記録して次のアクションを決めます"` 属性を追加
- [x] `index.html` の `btn-end` ラベルを「本日の作業終了」→「終了」に変更
- [x] `index.html` の `btn-report` を button-group から削除（log-section へ移動）
- [x] `index.html` のボタン並び順を「開始・立ち止まる・終了」に整理（停止・リセットは `display:none` のまま）

---

## #2 最近の記録セクション — HTML

- [x] `index.html` の `.log-section` を改修
  - `<h3 class="log-title">` を `<div class="log-header" id="log-header">` で包み、右端に `.log-header-actions` を追加
  - `.log-header-actions` 内に `<button id="btn-report-small" class="btn-report-small">日報を出力</button>` と `<span class="log-chevron" id="log-chevron">▼</span>` を配置
  - `<div id="log-list">` を `<div class="log-collapse" id="log-collapse">` で包む

---

## #3 CSS — ツールチップ

- [x] `style.css` に `.tooltip-btn`・`.tooltip-btn::after`・`.tooltip-btn:hover::after` を追加

---

## #4 CSS — 折りたたみ

- [x] `style.css` に `.log-header`・`.log-header-actions`・`.log-chevron`・`.log-chevron.open` を追加
- [x] `style.css` に `.log-collapse`・`.log-collapse.open` を追加（`max-height` transition）
- [x] `style.css` に `.btn-report-small`・`.btn-report-small:hover` を追加
- [x] `style.css` の既存 `.log-title` から `margin-bottom` を除去（`.log-header` が管理するため）

---

## #5 CSS — セグメントコントロール（期間ボタン）

- [x] `style.css` の `.period-btn-group` を上書き（`background: #f0f0f0`・`border-radius: 20px`・`padding: 3px`）
- [x] `style.css` の `.period-btn` を上書き（`border: none`・`border-radius: 16px`・`background: transparent`）
- [x] `style.css` の `.period-btn.active` を上書き（`background: #fff`・`box-shadow`・`color: var(--color-text)`）
- [x] `style.css` の `.period-btn:hover` を更新（`color: var(--color-text)`）

---

## #6 JS — ボタン参照・折りたたみ

- [x] `app.js` の `btnReportEl` 参照を `document.getElementById('btn-report-small')` に変更
- [x] `app.js` に `logHeaderEl`・`logCollapseEl`・`logChevronEl` の DOM 参照を追加
- [x] `app.js` に `logHeaderEl` の click イベントリスナーを追加（`log-collapse` / `log-chevron` の `open` クラスをトグル）
- [x] `app.js` の `btn-report-small` の click イベントリスナーに `e.stopPropagation()` を追加

---

## #7 JS — グラフ tooltip・データ構造変更

- [x] `app.js` の `initCharts()` で `stateChart` の options に `parsing: { yAxisKey: 'y' }` を追加
- [x] `app.js` の `initCharts()` で `stateChart` の `plugins.tooltip.callbacks.label` を追加
  - 表示内容：`` `状態: ${raw.y} / 作業時間: ${raw.session_min}分` ``
- [x] `app.js` の `updateCharts()` で `stateChart.data.datasets[0].data` を `chartLogs.map(l => ({ y: Number(l.state), session_min: Number(l.session_min) || 0 }))` に変更
- [x] `app.js` の `updateDialogChart()` への影響がないことを確認（`dialogStateChart` は別インスタンスで独立）

---

## 完了条件（全体）

- [x] すべてのタスクが完了している
- [x] ブラウザで以下を手動確認済み
  - [x] ボタンが「開始・立ち止まる・終了」の3つに絞られている
  - [x] 「立ち止まる」にホバーするとツールチップが表示される
  - [x] 「最近の記録」がデフォルト折りたたみで、クリックで展開できる
  - [x] 「日報を出力」が最近の記録ヘッダー内にあり、クリックでダウンロードされる
  - [x] グラフ点にホバーすると「状態: X / 作業時間: Y分」が表示される
  - [x] 期間ボタンがセグメントコントロール風に見える
  - [x] ポーリング・ダイアログが正常に動作する
