# design.md — UI シンプル化

## 変更ファイル一覧

| ファイル | 変更内容 |
|---|---|
| `static/index.html` | ボタンリネーム・非表示化、日報ボタン移動、log-section 構造変更 |
| `static/style.css` | ツールチップ、折りたたみ、セグメントコントロール、日報ボタンのスタイル追加 |
| `static/app.js` | ボタン参照更新、折りたたみJS、グラフデータ構造変更、tooltip設定 |

---

## 1. ボタン構成

### HTML 変更

```html
<!-- 変更後 -->
<div class="button-group">
  <button id="btn-start" class="btn btn-primary">開始</button>
  <button id="btn-pause" class="btn btn-secondary" style="display:none">停止</button>
  <button id="btn-reset" class="btn btn-secondary" style="display:none">リセット</button>
  <button id="btn-end" class="btn btn-end">終了</button>
  <button id="btn-self" class="btn btn-self tooltip-btn" data-tooltip="今の状態を記録して次のアクションを決めます">立ち止まる</button>
</div>
```

- `btn-self` のラベルを「自己申告」→「立ち止まる」に変更
- `btn-end` のラベルを「本日の作業終了」→「終了」に変更
- `btn-self` に `tooltip-btn` クラスと `data-tooltip` 属性を付与
- `btn-report` は log-section へ移動（後述）

### ボタン並び順

「開始」「終了」「立ち止まる」の順。終了は作業終了の重みを示すため中央配置も検討したが、
操作頻度（開始＞立ち止まる＞終了）を考慮して「開始・立ち止まる・終了」の左→右順とする。

---

## 2. 最近の記録の折りたたみ

### HTML 変更

```html
<div class="log-section">
  <div class="log-header" id="log-header">
    <h3 class="log-title">最近の記録</h3>
    <div class="log-header-actions">
      <button id="btn-report" class="btn-report-small">日報を出力</button>
      <span class="log-chevron" id="log-chevron">▼</span>
    </div>
  </div>
  <div class="log-collapse" id="log-collapse">
    <div id="log-list" class="log-list"></div>
  </div>
</div>
```

### CSS 変更

```css
.log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  user-select: none;
  padding-bottom: 4px;
}

.log-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.log-chevron {
  font-size: 12px;
  color: var(--color-text-sub);
  transition: transform 0.2s;
}

.log-chevron.open {
  transform: rotate(180deg);
}

.log-collapse {
  overflow: hidden;
  max-height: 0;
  transition: max-height 0.3s ease;
}

.log-collapse.open {
  max-height: 600px; /* 十分大きい値 */
}

.btn-report-small {
  font-size: 11px;
  padding: 3px 8px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-surface);
  color: var(--color-text-sub);
  cursor: pointer;
  white-space: nowrap;
}

.btn-report-small:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
```

### JS 変更

```js
const logHeaderEl = document.getElementById('log-header');
const logCollapseEl = document.getElementById('log-collapse');
const logChevronEl = document.getElementById('log-chevron');

logHeaderEl.addEventListener('click', () => {
  const isOpen = logCollapseEl.classList.toggle('open');
  logChevronEl.classList.toggle('open', isOpen);
});
```

既存の `btn-report` のイベントリスナーは `btn-report` → `btn-report-small` に ID 変更して対応。
クリックイベントが log-header に伝播しないよう、btn-report-small には `e.stopPropagation()` を追加。

---

## 3. ツールチップ（立ち止まるボタン）

### CSS

```css
.tooltip-btn {
  position: relative;
}

.tooltip-btn::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  background: #333;
  color: #fff;
  font-size: 12px;
  font-weight: 400;
  padding: 6px 10px;
  border-radius: 6px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s;
  z-index: 100;
}

.tooltip-btn:hover::after {
  opacity: 1;
}
```

`data-tooltip` 属性の値を `content: attr(data-tooltip)` で取得するため、JS 不要。

---

## 4. グラフ点ホバー（作業時間 tooltip）

### データ構造変更

```js
// 変更前
stateChart.data.datasets[0].data = chartLogs.map(l => l.state);

// 変更後（Chart.js の parsed data に session_min を埋め込む）
stateChart.data.datasets[0].data = chartLogs.map(l => ({
  y: Number(l.state),
  session_min: Number(l.session_min) || 0,
}));
```

Chart.js の `parsing` オプションで y 軸キーを指定：

```js
options: {
  parsing: { yAxisKey: 'y' },
  plugins: {
    tooltip: {
      callbacks: {
        label(ctx) {
          const raw = ctx.raw;
          return `状態: ${raw.y} / 作業時間: ${raw.session_min}分`;
        },
      },
    },
    legend: { display: false },
  },
  ...
}
```

### pointRadius との整合

`pointRadius` の計算は現行の `l.session_min` 参照から `chartLogs` 内の値を使う形を維持：

```js
stateChart.data.datasets[0].pointRadius = chartLogs.map(l => {
  const m = Number(l.session_min) || 0;
  return 4 + Math.min(m, 60) / 60 * 8;
});
```

---

## 5. 期間ボタンのデザイン刷新

### CSS 変更（`.period-btn-group` と `.period-btn` を置き換え）

```css
.period-btn-group {
  display: flex;
  background: #f0f0f0;
  border-radius: 20px;
  padding: 3px;
  gap: 2px;
}

.period-btn {
  padding: 4px 10px;
  font-size: 11px;
  border: none;
  border-radius: 16px;
  background: transparent;
  color: var(--color-text-sub);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
  white-space: nowrap;
}

.period-btn:hover {
  color: var(--color-text);
}

.period-btn.active {
  background: #fff;
  color: var(--color-text);
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
}
```

---

## 影響範囲

- `btnReportEl` DOM 参照と click イベントリスナー：ID を `btn-report` → `btn-report-small` に変更
- `btnSelfEl` のラベル変更はHTMLのみ、JS参照（`#btn-self`）は変更なし
- `btnEndEl` のラベル変更はHTMLのみ、JS参照（`#btn-end`）は変更なし
- グラフ tooltip が新しく表示されるが、既存の breakLinePlugin・pointRadius には影響なし
- `parsing: { yAxisKey: 'y' }` 追加により Chart.js が `data[i].y` を y 値として読む

---

## 非変更事項

- バックエンドAPI・ポーリング・ダイアログロジックは一切変更しない
- `btn-pause`・`btn-reset` のDOM・JSリスナーは保持
- タイマー・累積バー・統計表示は変更なし
