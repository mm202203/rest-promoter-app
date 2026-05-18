# tasklist.md — 状態スコアグラフ 点表示ルール修正

## タスク一覧

### T1. `buildDatasetPoints` 関数の修正
- [x] パラメータ名を `skipLogs` → `displayLogs` に変更
- [x] ループ前に `lastSkipTsByDate` 辞書を構築（各日付の最後のskipタイムスタンプ）
- [x] ゴーストポイントの条件を `isLastSkipOfDay && log.snooze_min` に変更

### T2. `updateCharts` — 変数宣言と `displayLogs` の構築

#### T2-1. 変数宣言の更新
- [x] `let skipLogs, allPeriodLogs, xMin, xMax;` に `displayLogs` を追加

#### T2-2. today/yesterday/dayBefore モードの修正
- [x] `displayLogs` を構築（skip + rest + first）
- [x] X軸ロジックを3段階に変更（`displayLogs.length === 0` / `skipLogs.length === 0` / それ以外）

#### T2-3. week モードの修正
- [x] `allDisplayLogs` を構築してウィンドウフィルタ後に `displayLogs` に代入
- [x] else ブランチで `displayLogs = []` を設定

### T3. `buildDatasetPoints` の呼び出しを変更
- [x] `buildDatasetPoints(skipLogs)` → `buildDatasetPoints(displayLogs)` に変更

## 完了条件

- [ ] `action=rest` のログがグラフ上に点として表示される
- [ ] `dialog_mode=first`（action=start）のログがグラフ上に点として表示される
- [ ] ゴーストポイント（線の延長）が各日の最後のskipにのみ追加される
- [ ] 緑の休憩帯の表示範囲が変わっていない
- [ ] today / yesterday / dayBefore / week の全ピリオドで正常に動作する
- [ ] コンソールにエラーが出ない

## 人手修正ログ

（実装中に発生した場合に追記）
