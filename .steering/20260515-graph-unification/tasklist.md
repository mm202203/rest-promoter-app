# tasklist.md — グラフ統合

## 進捗凡例
- [x] 未着手
- [x] 完了

---

## #1 `static/style.css` の変更

- [x] `.charts-section` の `grid-template-columns` を `1fr` に変更（1列レイアウト）
- [x] `.legend-vline` クラスを追加（破線マーカー用）

---

## #2 `static/index.html` の変更

- [x] 第2の `chart-box`（`id="session-chart"` を含む）を削除
- [x] 第1の `chart-box` の凡例を更新
  - 負荷カラーチップ（低:青 / 中:グレー / 高:赤）
  - 休憩区切り線マーカー（`.legend-vline`）
  - 「点の大きさ＝作業時間（最大60分）」注釈

---

## #3 `static/app.js` — `sessionChart` の削除

- [x] `sessionChart` 変数宣言を削除
- [x] `initCharts()` 内の `sessionChart` 初期化ブロックを削除

---

## #4 `static/app.js` — `breakLinePlugin` の追加

- [x] `initCharts()` 直前に `breakLinePlugin` オブジェクトを定義
  - `afterDraw` フックで canvas に直接破線を描画
  - `chart._breakFlags` 配列を参照して rest エントリーの位置に線を引く

---

## #5 `static/app.js` — `stateChart` の更新

- [x] `initCharts()` 内の `stateChart` 設定を更新
  - `borderColor` を `#d0d0d0` に変更
  - dataset に `pointRadius: []` を追加
  - chart config の `plugins: [breakLinePlugin]` を追加

---

## #6 `static/app.js` — `loadColor()` の更新

- [x] 色定義を新仕様に変更
  - 低(1-2): `#4A90D9`
  - 中(3): `#888780`
  - 高(4-5): `#D85A30`

---

## #7 `static/app.js` — `updateCharts()` の更新

- [x] `sessionChart` への更新処理を削除
- [x] 表示対象を `action` が `rest` または `skip` のエントリーのみにフィルタリング（`todayLogs.filter()` → `.slice(-30)`）
- [x] `stateChart` の更新処理を追加
  - `pointBackgroundColor`: `loadColor(Number(l.load) || 3)` で生成
  - `pointRadius`: `4 + Math.min(Number(l.session_min) || 0, 60) / 60 * 8` で計算
  - `stateChart._breakFlags`: `l.action === 'rest'` の boolean 配列をセット

---

## #8 `start.bat` の改善

- [x] `uv sync` を `.venv` 削除後・サーバー起動前に実行（依存関係の確実なインストール）
- [x] `uv sync` 失敗時にエラーメッセージを表示して停止
- [x] `netstat` / `taskkill` のエラー出力を抑制（`2>nul`）
- [x] `timeout` を 8 秒に延長（uvicorn 起動待ち）

---

## 完了条件（全体）

- [x] すべてのタスクが完了している
- [x] ブラウザで以下を手動確認済み
  - [x] グラフが1つに統合されている
  - [x] 各点の色で負荷レベルが判別できる（低=青, 中=グレー, 高=赤）
  - [x] 各点のサイズで作業時間の長さが判別できる
  - [x] 休憩のタイミングに縦の破線が表示される
  - [x] 凡例・注釈が正しく表示される
