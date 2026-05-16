# 設計書 - 配色シンプル化 & 状態スコアグラフ再設計

## 確定した仕様（要件確認結果）

| 項目 | 決定内容 |
|---|---|
| 累積バー警告段階（135分〜黄色） | 廃止。青→赤の2段階 |
| 「立ち止まる」ボタン | 青 `#185FA5` |
| 「終了」ボタン | グレー `#888780` |
| 直近7日ビュー | 実時間X軸（8時間ウィンドウ）＋スライダーで時間スクロール |
| session_start が空の古いレコード | timestamp をX座標にして点は表示、帯描画のみスキップ |
| ダイアログ内ミニグラフ | 今回変更する（実時間X軸に対応） |

---

## ① 配色シンプル化

### CSSカラー変数の変更（`static/style.css`）

| 変数名 | 旧値 | 新値 | 用途 |
|---|---|---|---|
| `--color-primary` | `#1976d2` | `#185FA5` | ボタン・アクティブ要素 |
| `--color-primary-hover` | `#1565c0` | `#134f8a` | ホバー |
| `--color-accum-normal` | `#4caf50` | `#185FA5` | 累積バー通常 |
| `--color-accum-warn` | `#ffc107` | 削除 | 廃止 |
| `--color-accum-danger` | `#f44336` | `#D85A30` | 累積バー上限・エラー |
| `--color-dialog-danger` | `#f44336` | `#D85A30` | ダイアログ警告枠 |
| `--color-state-low` | `#f44336` | `#D85A30` | 状態スコア低 |
| `--color-state-mid` | `#9e9e9e` | `#888780` | 状態スコア中 |
| `--color-state-high` | `#4caf50` | 削除（用途なし） | 廃止 |
| `--color-text-sub` | `#757575` | `#888780` | 補助テキスト |

### ハードコードされた色の変更

**`static/style.css`**

| 箇所 | 旧値 | 新値 |
|---|---|---|
| `.danger-warning` background | `#b71c1c` | `#b03b1c`（#D85A30の暗色） |
| `.btn-end` background | `#546e7a` | `#888780` |
| `.btn-end:hover` background | `#455a64` | `#6e6d69` |
| `.btn-self` background | `#7b1fa2` | `#185FA5` |
| `.btn-self:hover` background | `#6a1b9a` | `#134f8a` |
| `.advice-banner.level-ok` 系 | `#e8f5e9` / `#2e7d32` / `#a5d6a7` | `#e8f0e8` / `#3B6D11` / `#9ab89a` |
| `.pulse-border` keyframes | `rgba(244,67,54,...)` | `rgba(216,90,48,...)` |

**`static/app.js`**

| 関数 / 箇所 | 旧値 | 新値 |
|---|---|---|
| `timerProgressEl` stroke (作業中) | `#1976d2` | `#185FA5` |
| `timerProgressEl` stroke (休憩中) | `#4caf50` | `#3B6D11` |
| `timerTextEl` fill (休憩中) | `#4caf50` | `#3B6D11` |
| `stateChart` borderColor（折れ線） | `#d0d0d0` | `#185FA5` |
| `dialogStateChart` borderColor（折れ線） | `#9e9e9e` | `#185FA5` |
| `scoreColor()` score<=2 | `#f44336` | `#D85A30` |
| `scoreColor()` score===3 | `#9e9e9e` | `#888780` |
| `scoreColor()` score>=4 | `#4caf50` | `#185FA5` |
| `accum-warn` クラスの付与 | 削除対象（2段階化） | 廃止 |

**`static/index.html`**

| 箇所 | 旧値 | 新値 |
|---|---|---|
| `timer-progress` stroke 属性 | `#1976d2` | `#185FA5` |
| `timer-label` fill 属性 | `#4caf50` | `#3B6D11` |

### 累積バー2段階化（`static/app.js`）

`updateAccumBar()` 内で `accum-warn` クラスの付与を削除し、`ACCUM_WARN_MIN` 定数も削除する。

```
// 変更前
if (mins >= ACCUM_DANGER_MIN) { ... accum-danger }
else if (mins >= ACCUM_WARN_MIN) { accum-warn }

// 変更後
if (mins >= ACCUM_DANGER_MIN) { ... accum-danger }
// accum-warn 分岐を削除
```

---

## ② 状態スコアグラフ再設計

### ライブラリ追加（`static/index.html`）

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
```

### グローバル変数の変更（`static/app.js`）

```js
// 削除
let breakFlagsCache = [];
// weekSliderValue はそのまま維持（セマンティクスが変わる）

// 追加
let bandDataCache = [];        // 帯描画用: [{start: Date, end: Date, type: 'work'|'rest', load: number|null}]
let afterBreakFlagsCache = []; // 折れ線破線判定: skipの各点が休憩後かどうか (boolean[])
// sessionMinsCache はそのまま維持
```

`weekSliderValue` の意味変更：
- 旧：week ビューの skip ログ配列のオフセット（件数）
- 新：7日分全体の先頭から何分後を表示開始とするか（分単位の時間オフセット）
- 初期値：最新データが見えるよう `weekSlider.max` に設定（右端）

### 背景帯描画プラグイン

既存の `breakLinePlugin` を完全に削除し、`backgroundBandPlugin` に置き換える。
`initCharts()` の `plugins: [breakLinePlugin]` も `plugins: [backgroundBandPlugin]` に変更する。

```js
const backgroundBandPlugin = {
  id: 'backgroundBands',
  beforeDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea) return;
    const xScale = scales.x;

    bandDataCache.forEach(({ start, end, type, load }) => {
      const xStart = xScale.getPixelForValue(start.getTime());
      const xEnd   = xScale.getPixelForValue(end.getTime());
      if (xStart >= chartArea.right || xEnd <= chartArea.left) return;
      const x1 = Math.max(xStart, chartArea.left);
      const x2 = Math.min(xEnd, chartArea.right);

      let color;
      if (type === 'rest') {
        color = 'rgba(59, 109, 17, 0.3)';
      } else {
        if (load >= 4)       color = 'rgba(216, 90, 48, 0.50)';
        else if (load === 3) color = 'rgba(216, 90, 48, 0.30)';
        else                 color = 'rgba(216, 90, 48, 0.15)';
      }

      ctx.save();
      ctx.fillStyle = color;
      ctx.fillRect(x1, chartArea.top, x2 - x1, chartArea.bottom - chartArea.top);
      ctx.restore();
    });
  },
};
```

### `initCharts()` の変更内容

```js
// stateChart: time スケール + backgroundBandPlugin に変更
stateChart = new Chart(stateCtx, {
  type: 'line',
  data: {
    datasets: [{
      label: '状態スコア',
      data: [],              // {x: ISO文字列, y: number} の配列に変更
      pointBackgroundColor: [],
      pointRadius: [],
      borderColor: '#185FA5',
      tension: 0.3,
      fill: false,
      segment: {
        borderDash: (ctx) => afterBreakFlagsCache[ctx.p1DataIndex] ? [5, 5] : [],
      },
    }],
  },
  options: {
    scales: {
      x: { type: 'time', time: { displayFormats: { minute: 'HH:mm', hour: 'HH:mm' } } },
      y: { min: 1, max: 5, ticks: { stepSize: 1 } },
    },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { /* 後述 */ } },
    },
    animation: false,
  },
  plugins: [backgroundBandPlugin],
});

// dialogStateChart: time スケール + borderColor 変更
dialogStateChart = new Chart(dialogChartCanvas.getContext('2d'), {
  type: 'line',
  data: { datasets: [{ label: '状態スコア', data: [], pointBackgroundColor: [], borderColor: '#185FA5', tension: 0.3, fill: false }] },
  options: {
    scales: {
      x: { type: 'time', time: { displayFormats: { minute: 'HH:mm', hour: 'HH:mm' } } },
      y: { min: 1, max: 5, ticks: { stepSize: 1 } },
    },
    plugins: { legend: { display: false } },
    animation: false,
  },
});
```

### `buildBandData(logs)` 関数

```
入力: 対象期間の全ログ（action 問わず、時系列順）
      ※帯描画に必要なのは rest/skip のみだが、全ログを渡してよい

出力: bandDataCache を更新する

ロジック:
  for each log in logs:
    if log.action === 'rest' and log.session_start is not empty:
      push { start: new Date(session_start), end: new Date(timestamp),
              type: 'work', load: Number(log.load) }
      if log.break_min is not empty:
        restEnd = new Date(timestamp).getTime() + Number(break_min) * 60000
        push { start: new Date(timestamp), end: new Date(restEnd),
                type: 'rest', load: null }
    if log.action === 'skip' and log.session_start is not empty:
      push { start: new Date(session_start), end: new Date(timestamp),
              type: 'work', load: Number(log.load) }
    (action === 'start' は対象外)
```

### 週ビューのスライダー（8時間ウィンドウ）

```
WEEK_TIME_WINDOW_MIN = 480  // 8時間（分単位）

週ビュー選択時:
  dates = getLast7Dates()
  allWeekLogs = 全ログのうち dates に含まれるもの（action 問わず）
  skipLogs    = allWeekLogs.filter(action === 'skip')

  weekStart = allWeekLogs[0].timestamp（最古のログ）
  weekEnd   = allWeekLogs[last].timestamp（最新のログ）
  totalMinutes = (weekEnd - weekStart) in minutes

  slider.min = 0
  slider.max = max(0, totalMinutes - WEEK_TIME_WINDOW_MIN)
  slider.step = 30
  // 初期値: 右端（最新データが見える）
  weekSliderValue = Math.min(weekSliderValue, slider.max)
  if weekSliderValue === 初回 → slider.max に設定

  windowStart = weekStart + weekSliderValue 分
  windowEnd   = windowStart + WEEK_TIME_WINDOW_MIN 分

  chartLogs = skipLogs のうち windowStart <= timestamp <= windowEnd のもの
  bandLogs  = allWeekLogs のうち windowStart 付近（session_startが windowStart以前でもtimestampがウィンドウ内なもの含む）
              ※実装上は allWeekLogs をそのまま buildBandData に渡してよい（ウィンドウ外の帯はプラグインがクリップする）

  X軸: min = windowStart, max = windowEnd
  displayFormats: { minute: 'MM/dd HH:mm', hour: 'MM/dd HH:mm' }
  unit: 'hour'
```

スライダーのデータが8時間未満しかない場合は `slider.max === 0` となり、スライダーを非表示にする（現行と同様）。

### 単日ビュー（today / yesterday / dayBefore）

```
targetDate = getPeriodDate(selectedPeriod)
allDayLogs = logs.filter(timestamp.startsWith(targetDate))（action 問わず）
skipLogs   = allDayLogs.filter(action === 'skip')

chartLogs  = skipLogs
buildBandData(allDayLogs)

// X軸の min/max
if skipLogs.length === 0:
  min/max を設定しない（Chart.js の自動スケールに任せる）
else if skipLogs.length === 1:
  min = timestamp - 30分
  max = timestamp + 30分
else:
  min = skipLogs[0].timestamp
  max = skipLogs[last].timestamp

X軸: unit: 'minute', displayFormats: { minute: 'HH:mm', hour: 'HH:mm' }
weekSlider: hidden
```

### `afterBreakFlagsCache` の構築

```
入力: skipLogs（点描画対象）、allPeriodLogs（全ログ、rest 含む）

afterBreakFlagsCache = skipLogs.map((log, i) => {
  if (i === 0) return false;
  const prevSkip = skipLogs[i - 1];
  // prevSkip.timestamp と log.timestamp の間に action=rest が存在するか
  return allPeriodLogs.some(l =>
    l.action === 'rest' &&
    l.timestamp > prevSkip.timestamp &&
    l.timestamp < log.timestamp
  );
});
```

### グラフデータセット更新（`updateCharts` 内）

```js
const skipLogs = chartLogs; // 単日の場合は既に skip のみ、週もウィンドウ内 skip のみ

stateChart.data.datasets[0].data = skipLogs.map(l => ({ x: l.timestamp, y: Number(l.state) }));
sessionMinsCache = skipLogs.map(l => Number(l.session_min) || 0);
stateChart.data.datasets[0].pointBackgroundColor = skipLogs.map(l => loadColor(Number(l.load) || 3));
stateChart.data.datasets[0].pointRadius = skipLogs.map(l => {
  const m = Number(l.session_min) || 0;
  return 4 + Math.min(m, 60) / 60 * 8;
});
```

`labels` 配列は不要になる（time スケールは `x` 値から自動生成）。

### ツールチップ

```js
tooltip: {
  callbacks: {
    title: (items) => items[0].raw.x.slice(11, 16),  // HH:mm
    label: (ctx) => {
      const sessionMin = sessionMinsCache[ctx.dataIndex] ?? 0;
      return `状態: ${ctx.raw.y} / 作業時間: ${sessionMin}分`;
    },
  },
},
```

週ビューの場合は title を `MM/dd HH:mm` にする。

### `updateDialogChart()` の変更

```
対象ログ: 今日の skip ログのみ（rest を除外）
プレビュー点: { x: new Date().toISOString(), y: previewScore, load: lastState.prev_load }

X軸:
  if skipLogs.length === 0 かつ previewなし: min/max 設定なし
  else: min = skipLogs[0].timestamp, max = new Date().toISOString()

帯描画: なし（ダイアログは狭いため省略）

点の色:
  - 履歴点: loadColor(log.load)
  - プレビュー点: loadColor(lastState.prev_load ?? 3)
```

### 凡例の HTML 変更（`static/index.html`）

```html
<!-- 変更前 -->
<div class="chart-legend-note">
  作業負荷:
  <span class="legend-chip" style="background:#4A90D9">低(1-2)</span>
  <span class="legend-chip" style="background:#888780">中(3)</span>
  <span class="legend-chip" style="background:#D85A30">高(4-5)</span>
  <span class="legend-vline"></span>休憩
</div>

<!-- 変更後 -->
<div class="chart-legend-note">
  作業負荷:
  <span class="legend-chip" style="background:#4A90D9">低(1-2)</span>
  <span class="legend-chip" style="background:#888780">中(3)</span>
  <span class="legend-chip" style="background:#D85A30">高(4-5)</span>
  <span class="legend-band">休憩帯</span>
</div>
```

### `.legend-band` のCSS追加（`static/style.css`）

```css
.legend-band {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  color: #3B6D11;
  background: rgba(59, 109, 17, 0.25);
  border: 1px solid rgba(59, 109, 17, 0.4);
}
```

`.legend-vline` の CSS 定義は削除する。

### 変更しないもの

- ログデータのCSV構造
- `/logs` / `/state` / `/record` 等のAPI
- `dialogStateChart` の canvas サイズ
- `updateDailyStats()` の統計計算ロジック
- ログ一覧の描画（`renderLogs()`）
- `loadColor()` 関数（色値は仕様通り）
