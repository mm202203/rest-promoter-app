# タスクリスト - 配色シンプル化 & 状態スコアグラフ再設計

## 実装タスク

### ① 配色シンプル化

- [x] **T01** `static/style.css` のCSS変数を更新（`--color-primary` / `--color-accum-normal` / `--color-accum-danger` / `--color-dialog-danger` / `--color-state-low` / `--color-state-mid` / `--color-text-sub`）
- [x] **T02** `static/style.css` の `--color-accum-warn` / `--color-state-high` 変数を削除
- [x] **T03** `static/style.css` のハードコード色を更新（`.danger-warning` / `.btn-end` / `.btn-end:hover` / `.btn-self` / `.btn-self:hover` / `.advice-banner.level-ok` 系 / `.pulse-border` keyframes）
- [x] **T04** `static/index.html` のインライン属性を更新（`timer-progress` stroke / `timer-label` fill）
- [x] **T05** `static/app.js` のハードコード色を更新（`timerProgressEl` / `timerTextEl` の stroke/fill）
- [x] **T06** `static/app.js` の `scoreColor()` 関数の色値を更新（`#D85A30` / `#888780` / `#185FA5`）
- [x] **T07** `static/app.js` の `updateAccumBar()` から `accum-warn` クラス付与を削除、`ACCUM_WARN_MIN` 定数を削除

### ② グラフ再設計（準備）

- [x] **T08** `static/index.html` に `chartjs-adapter-date-fns` の CDN script タグを追加
- [x] **T09** `static/app.js` の `breakLinePlugin` / `breakFlagsCache` を削除し、`backgroundBandPlugin` / `bandDataCache` / `afterBreakFlagsCache` を追加
- [x] **T10** `static/app.js` の `WEEK_WINDOW` 定数を削除し、`WEEK_TIME_WINDOW_MIN = 480` 定数を追加

### ② グラフ再設計（`initCharts` 変更）

- [x] **T11** `stateChart` の初期化を変更（`data.labels` 削除、`data: [{x, y}]` 形式に、`borderColor: '#185FA5'`、`segment.borderDash` コールバック追加、`plugins: [backgroundBandPlugin]`、`x: { type: 'time' }` スケール追加）
- [x] **T12** `dialogStateChart` の初期化を変更（`borderColor: '#185FA5'`、`x: { type: 'time' }` スケール追加、`data: [{x, y}]` 形式に）

### ② グラフ再設計（`updateCharts` 変更）

- [x] **T13** `buildBandData(logs)` 関数を新設（rest / skip レコードから帯データを計算して `bandDataCache` を更新）
- [x] **T14** `afterBreakFlagsCache` の構築ロジックを新設（`buildAfterBreakFlags(skipLogs, allLogs)` として実装）
- [x] **T15** 週ビューの `updateCharts()` を変更（`allWeekLogs` から `weekStart` / `weekEnd` を算出、スライダーを分単位時間オフセットで制御、`windowStart` / `windowEnd` に基づく `chartLogs` フィルタ）
- [x] **T16** 単日ビューの `updateCharts()` を変更（`chartLogs` を skip のみに変更、X軸 min/max を設定、データ0件・1件のフォールバック処理）
- [x] **T17** `stateChart.data.datasets[0].data` の更新を `{x, y}` 形式に変更（`labels` 配列の更新を削除）
- [x] **T18** `stateChart.options.scales.x` を `updateCharts()` 内で動的に更新（`unit` / `displayFormats` / `min` / `max` をビューに応じて設定して `chart.update()` を呼ぶ）

### ② グラフ再設計（ダイアログ内グラフ）

- [x] **T19** `updateDialogChart()` を変更（skip ログのみフィルタ、`{x, y}` 形式に、点の色を `loadColor()` で決定、プレビュー点のX座標を `new Date().toISOString()`、X軸 min/max を設定）

### ② グラフ再設計（凡例・CSS）

- [x] **T20** `static/index.html` の凡例を変更（`.legend-vline` + テキスト「休憩」を `.legend-band` に置き換え）
- [x] **T21** `static/style.css` に `.legend-band` の CSS を追加し、`.legend-vline` の CSS を削除

### 確認・後処理

- [x] **T22** バージョンクエリ文字列を更新（`app.js?v=20260516d`）
- [x] **T23** 動作確認（単日ビュー：X軸時刻・背景帯・点描画・破線・ツールチップ）
- [x] **T24** 動作確認（週ビュー：スライダー・8時間ウィンドウ・日付またぎ表示）
- [x] **T25** 動作確認（ダイアログ内グラフ：実時間X軸・プレビュー点）
- [x] **T26** 動作確認（配色：タイマー・ボタン・累積バー・アドバイスバナー）
- [x] **T27** アプリ正常起動確認（`/` と `/state` が HTTP 200 を返すことを確認済み）

## 人手修正ログ

（実装中に発生した手動修正をここに記録）

## 完了条件

- X軸が実時間（HH:mm / MM/dd HH:mm）になっている
- 作業時間帯が負荷の濃淡で赤く塗られている
- 休憩時間帯が緑で塗られている
- 状態スコアの点（skip のみ）が時刻位置に正しく打たれている
- 週ビューが8時間ウィンドウ＋スライダーで時間スクロールできる
- 配色が4色パレットに統一されている
- 既存APIとの接続が正常に動作する
