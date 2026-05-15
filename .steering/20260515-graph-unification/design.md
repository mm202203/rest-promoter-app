# design.md — グラフ統合

## 実装アプローチ

### アーキテクチャ方針

- Chart.js 4.4.0（既存）をそのまま使用。追加 CDN は不要。
- annotation プラグインは未導入のため、Chart.js のローカルプラグイン機能で canvas に直接描画する。
- `stateChart` 1本に統合し、`sessionChart` は削除する。
- `dialogStateChart`（ダイアログ内グラフ）は変更しない。

---

## 変更するコンポーネント

### `static/app.js`

#### 1. `loadColor(load)` 関数の更新

```js
function loadColor(load) {
  if (load >= 4) return '#D85A30';
  if (load === 3) return '#888780';
  return '#4A90D9';
}
```

#### 2. カスタムプラグイン `breakLinePlugin` を追加（`initCharts` 前に定義）

```js
const breakLinePlugin = {
  id: 'breakLines',
  afterDatasetsDraw(chart) {
    const { ctx, scales, data } = chart;
    if (!data._breakFlags) return;
    data._breakFlags.forEach((isBreak, i) => {
      if (!isBreak) return;
      const meta = chart.getDatasetMeta(0);
      if (!meta.data[i]) return;
      const x = meta.data[i].x;
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = 'rgba(59, 109, 17, 0.5)';
      ctx.lineWidth = 2;
      ctx.moveTo(x, scales.y.top);
      ctx.lineTo(x, scales.y.bottom);
      ctx.stroke();
      ctx.restore();
    });
  },
};
```

#### 3. `initCharts()` の変更

- `stateChart` の dataset に `pointRadius: []` を追加
- `stateChart` の config に `plugins: [breakLinePlugin]` を追加
- `sessionChart` の初期化ブロックを削除
- `sessionChart` 変数宣言を削除

#### 4. `updateCharts(logs)` の変更

- `sessionChart` への更新処理を削除
- `stateChart` の更新に以下を追加：
  - `pointBackgroundColor` → `loadColor(Number(l.load) || 3)` で生成
  - `pointRadius` → `4 + Math.min(Number(l.session_min) || 0, 60) / 60 * 8` で生成
  - `stateChart.data._breakFlags` → `l.action === 'rest'` の boolean 配列

### `static/index.html`

#### 1. `charts-section` の変更

- 第2の `chart-box`（`session-chart`）を丸ごと削除
- 第1の `chart-box`（`state-chart`）の凡例を以下に更新：
  - 行1：負荷カラーチップ（低/中/高）＋ 休憩区切り線マーカー
  - 行2：「点の大きさ＝作業時間（最大60分）」テキスト

#### 凡例 HTML イメージ

```html
<div class="chart-legend-note">
  作業負荷:
  <span class="legend-chip" style="background:#4A90D9">低(1-2)</span>
  <span class="legend-chip" style="background:#888780">中(3)</span>
  <span class="legend-chip" style="background:#D85A30">高(4-5)</span>
  <span class="legend-vline"></span>休憩
</div>
<div class="chart-legend-note">点の大きさ＝作業時間（最大60分）</div>
```

### `static/style.css`

#### 1. `.charts-section` のグリッドを1列に変更

```css
.charts-section {
  grid-template-columns: 1fr;
}
```

#### 2. `.legend-vline` を追加

```css
.legend-vline {
  display: inline-block;
  width: 0;
  height: 14px;
  border-left: 2px dashed rgba(59, 109, 17, 0.6);
  margin: 0 4px;
  vertical-align: middle;
}
```

---

## 確定した設計判断

| 項目 | 決定 |
|------|------|
| グラフの高さ | Chart.js デフォルト（aspect ratio 2:1）のまま変更しない |
| 折れ線の border color | `#d0d0d0`（薄いグレー）に変更し、点の色を目立たせる |
| 表示対象ログ | `action` が `rest` または `skip` のエントリーのみ（start 除外） |

---

## データ構造の変更

なし。`GET /logs` の既存レスポンスをそのまま使用。

各ログエントリから使用するフィールド：
- `l.timestamp` → X軸ラベル（`[11:16]` スライス）
- `l.state` → Y軸値
- `l.load` → 点の色
- `l.session_min` → 点のサイズ
- `l.action === 'rest'` → 破線フラグ

---

## 影響範囲の分析

| 項目 | 影響 |
|------|------|
| バックエンド | なし |
| `GET /logs` | なし（使用フィールドが増えるだけ） |
| `updateDailyStats()` | なし（`session_min` 集計は継続） |
| `dialogStateChart` | なし |
| `renderLogs()` | なし |
