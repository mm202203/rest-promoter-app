# design.md — 状態スコアグラフ 点表示ルール修正

## 実装アプローチ

### 現状の仕組み

`updateCharts(logs)` が呼ばれると以下の流れで描画される。

```
allPeriodLogs（対象期間の全ログ）
  └─ skipLogs（action=skip のみ） ─→ buildDatasetPoints(skipLogs) ─→ chart.data
```

`buildDatasetPoints` は `skipLogs` だけを受け取り、各ログを `{ x: timestamp, y: state }` に変換する。
各日の最後の skip ログの後に `snooze_min` 分のゴーストポイント（点なし・線だけ）を付加する。

### 変更方針

`buildDatasetPoints` に渡すログを **skip + rest + first(action=start)** に拡張する。  
ゴーストポイントの挿入条件は「その日の最後の skip ログの直後」のみに限定する。

```
allPeriodLogs
  ├─ skipLogs（xMin/xMax 算出用 ※後述の例外あり）
  └─ displayLogs（skip + rest + first） ─→ buildDatasetPoints(displayLogs) ─→ chart.data
```

## 変更するコンポーネント

### 1. `buildDatasetPoints(displayLogs)` — 関数シグネチャと内部ロジック

**変更前:** `skipLogs` を走査し、「次の skip が翌日 or 存在しない」場合にゴーストポイントを追加。

**変更後:**
- パラメータ名を `displayLogs` に変更
- ループ前に `lastSkipTsByDate` を構築する  
  → 各日付の最後の skip ログのタイムスタンプを保持する辞書
- ゴーストポイントの条件を変更:  
  `isDayEnd && log.snooze_min`  
  → `log.action === 'skip' && lastSkipTsByDate[date] === log.timestamp && log.snooze_min`

```js
// 変更後のゴーストポイント条件
const isLastSkipOfDay =
  log.action === 'skip' &&
  lastSkipTsByDate[log.timestamp.slice(0, 10)] === log.timestamp;
if (isLastSkipOfDay && log.snooze_min) { /* ghost追加 */ }
```

### 2. `updateCharts(logs)` — `displayLogs` の構築・X軸範囲の調整

#### 変数宣言

```js
// 変更前
let skipLogs, allPeriodLogs, xMin, xMax;

// 変更後
let skipLogs, displayLogs, allPeriodLogs, xMin, xMax;
```

#### displayLogs のフィルタ条件（both モード共通）

```js
displayLogs = allPeriodLogs.filter(l =>
  l.action === 'skip' ||
  l.action === 'rest' ||
  (l.action === 'start' && l.dialog_mode === 'first')
);
```

#### X軸範囲（today/yesterday/dayBefore モード）

skipLogs が空でも displayLogs にデータがあれば X 軸を表示する。

```js
if (displayLogs.length === 0) {
  xMin = undefined;
  xMax = undefined;
} else if (skipLogs.length === 0) {
  // first / rest ログのみ → 最初の点を中心に ±30分
  const firstMs = new Date(displayLogs[0].timestamp).getTime();
  xMin = firstMs - 30 * 60000;
  xMax = firstMs + 30 * 60000;
} else {
  // 従来の skipLogs ベースのロジック（変更なし）
  const firstMs = new Date(skipLogs[0].timestamp).getTime();
  const lastLog = skipLogs[skipLogs.length - 1];
  const lastMs  = new Date(lastLog.timestamp).getTime();
  const ghostMs = lastLog.snooze_min ? lastMs + Number(lastLog.snooze_min) * 60000 : lastMs;
  xMin = skipLogs.length === 1 ? firstMs - 30 * 60000 : firstMs;
  xMax = skipLogs.length === 1 ? firstMs + 30 * 60000 : ghostMs;
}
```

#### week モードブランチ

```js
const allDisplayLogs = allPeriodLogs.filter(l =>
  l.action === 'skip' ||
  l.action === 'rest' ||
  (l.action === 'start' && l.dialog_mode === 'first')
);
// ウィンドウフィルタ
displayLogs = allDisplayLogs.filter(l => {
  const ts = new Date(l.timestamp).getTime();
  return ts >= winStartMs && ts <= winEndMs;
});
// else ブランチ
displayLogs = [];
```

#### `buildDatasetPoints` の呼び出し変更

```js
// 変更前
const { data: dsData, mins: dsMins } = buildDatasetPoints(skipLogs);

// 変更後
const { data: dsData, mins: dsMins } = buildDatasetPoints(displayLogs);
```

## 確定した仕様（あいまい点の解消）

| 項目 | 決定内容 |
|---|---|
| skipLogs が空でも first ログがある日のX軸 | firstログを基準に ±30分で表示 |
| first ログのツールチップ「作業時間: 0分」 | そのまま表示する |
| skip→rest→skip と線が繋がり、緑帯内に線がかかる場合 | 許容する |

## 影響範囲の分析

| 対象 | 影響 |
|---|---|
| `buildBandData` | 変更なし（allPeriodLogsを使用） |
| `updateDailyStats` | 変更なし（todayLogsを使用） |
| X軸範囲（week モード） | 変更なし（ウィンドウ固定） |
| X軸範囲（today 等モード） | skipLogs が空の場合のフォールバック追加 |
| ゴーストポイント | 各日の最後のskipにのみ追加（動作変わらず） |
| ツールチップ | first ログで「作業時間: 0分」、rest ログで「作業時間: X分」が表示される |
| 線の描画 | skip→rest→skip と連続して繋がる（許容） |
