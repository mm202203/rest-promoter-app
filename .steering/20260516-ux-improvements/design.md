# design.md — UX改善4件

## 確定した設計判断

| 項目 | 決定 |
|------|------|
| 期間ボタン配置 | chart-box のタイトル行右横 |
| 作業時間デフォルト | `lastState.timer_duration` を分換算した値 |
| 継続作業ラベル | "X分"（"後"なし） |
| 7日表示ウィンドウ幅 | 20件固定 |
| スライダー初期位置 | 'week' 切り替えのたびに右端（最新）にリセット |
| First mode step 1 のダイアログチャート | 表示しない |

---

## 改善① グラフ表示期間の切り替え

### 状態管理

```js
let selectedPeriod = 'today'; // 'today' | 'yesterday' | 'dayBefore' | 'week'
let weekSliderValue = 0;      // 7日ウィンドウの開始インデックス
```

### 期間ボタン（HTML）

`chart-title` を `<div class="chart-title-row">` で包み、右側にボタングループを配置する。

```html
<div class="chart-title-row">
  <h3 class="chart-title">状態スコア推移</h3>
  <div class="period-btn-group">
    <button class="period-btn active" data-period="today">今日</button>
    <button class="period-btn" data-period="yesterday">前日</button>
    <button class="period-btn" data-period="dayBefore">前々日</button>
    <button class="period-btn" data-period="week">直近7日</button>
  </div>
</div>
```

### スライダー（HTML）

グラフ canvas の直下に配置。7日以外では `.hidden`。

```html
<input type="range" id="week-slider" class="week-slider hidden" min="0" max="0" step="1" value="0">
```

### `getDateByPeriod(period)` → 対象日の YYYY-MM-DD 文字列を返す

```js
function getDateByPeriod(period) {
  const offset = { today: 0, yesterday: 1, dayBefore: 2 }[period] ?? 0;
  return new Date(Date.now() + (9 - offset * 24) * 3600 * 1000)
    .toISOString().slice(0, 10);
  // より正確: JST の N日前を計算
}
```

実際は JST オフセットを考慮した計算を行う（既存の `getTodayJST()` を流用し日付減算）。

### `updateCharts(logs)` の変更

```js
function updateCharts(logs) {
  const workLogs = logs.filter(l => l.action === 'rest' || l.action === 'skip');

  let chartLogs;
  if (selectedPeriod === 'week') {
    // 直近7日のターゲット日付範囲
    const dates = getLast7Dates(); // ['2026-05-10', ..., '2026-05-16']
    const allWeekLogs = workLogs.filter(l => dates.some(d => l.timestamp.startsWith(d)));
    // スライダー更新
    const maxSlider = Math.max(0, allWeekLogs.length - WEEK_WINDOW);
    weekSliderEl.max = maxSlider;
    weekSliderEl.classList.toggle('hidden', allWeekLogs.length <= WEEK_WINDOW);
    chartLogs = allWeekLogs.slice(weekSliderValue, weekSliderValue + WEEK_WINDOW);
  } else {
    const targetDate = getPeriodDate(selectedPeriod);
    const dayLogs = workLogs.filter(l => l.timestamp.startsWith(targetDate));
    weekSliderEl.classList.add('hidden');
    chartLogs = dayLogs; // 上限なし
  }

  // X軸ラベル
  const labels = chartLogs.map(l =>
    selectedPeriod === 'week'
      ? l.timestamp.slice(5, 16).replace('T', ' ')  // 'M/D HH:MM'
      : l.timestamp.slice(11, 16)                     // 'HH:MM'
  );
  // 以降は既存のグラフ更新処理（pointBackgroundColor, pointRadius, breakFlagsCache）
  ...

  // updateDailyStats は常に「今日」のログで計算
  const todayLogs = logs.filter(l => l.timestamp.startsWith(getTodayJST()));
  updateDailyStats(todayLogs);
}
```

`WEEK_WINDOW = 20`（定数）

`weekSliderValue` はスライダーの `input` イベントで更新し、即座に `updateCharts(lastLogsCache)` を呼ぶ。

初期表示は右端（最新）なので、スライダー設定時に `weekSliderValue = max` とセットする。

### CSS

```css
.chart-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.chart-title {
  margin-bottom: 0; /* chart-title-row が margin を持つため */
}

.period-btn-group {
  display: flex;
  gap: 4px;
}

.period-btn {
  padding: 3px 8px;
  font-size: 11px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-surface);
  cursor: pointer;
}

.period-btn.active {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}

.week-slider {
  width: 100%;
  margin-top: 6px;
  accent-color: var(--color-primary);
}
```

---

## 改善② 開始ダイアログ質問順変更

### ステップ定義（first モード）

| step | 内容 |
|------|------|
| 1 | 状態スコア選択（`renderStateSelect`） |
| 2 | 作業内容入力（`renderTaskInput`） |
| 3 | 作業負荷選択（`renderLoadSelect`） |
| 4 | 作業時間選択（`renderWorkDurationSelect`、新規） |

### `getStepCount` 変更

```js
if (mode === 'first') return 4; // 3 → 4
```

### `renderWorkDurationSelect()` 新規追加

```js
function renderWorkDurationSelect() {
  // タイトル
  // ボタン: [15, 30, 45, 60, 75, 90] 分
  // デフォルト: lastState ? Math.round(lastState.timer_duration / 60) : 60
  // 選択で dialogData.work_min にセット
}
```

### `onNextClick` バリデーション変更（first モード）

```js
if (mode === 'first') {
  if (currentStep === 1 && dialogData.state == null) return;
  if (currentStep === 2) { /* task バリデーション */ }
  if (currentStep === 3 && dialogData.load == null) return;
  if (currentStep === 4 && dialogData.work_min == null) return;
}
```

### `submitDialog` 変更（first モード）

```js
if (mode === 'first') {
  // /config を先に呼んでタイマー時間を設定
  if (dialogData.work_min) {
    await apiFetch('/config', 'POST', { duration_min: dialogData.work_min });
  }
}
```

---

## 改善③ リセットボタン非表示

`index.html` の `btn-reset` に `style="display:none"` を追加。JS 側の参照・ロジックはそのまま維持。

---

## 改善④ スヌーズ→継続作業

### 変更箇所一覧

| ファイル | 変更内容 |
|---|---|
| `static/app.js` | `renderSnoozeSelect()` タイトル・ラベル・選択肢変更 |
| `static/app.js` | `renderLogs()` の actionMap `skip: '継続作業'` |
| `services/log_service.py` | 日報サフィックス `（スヌーズ継続）` → `（継続作業）` |

`snooze_min` フィールド名（API 内部）は変更しない。

---

## 影響範囲

| 項目 | 影響 |
|------|------|
| バックエンド | `log_service.py` の文字列変更のみ |
| `/config` API | 既存のまま流用 |
| `updateDailyStats` | 常に当日ログを使用（期間切り替えに連動しない） |
| `dialogStateChart` | 変更なし |
