# 開発ガイドライン

## コーディング規約

### Python（バックエンド）

#### 基本方針

- **型ヒントを必ず付ける**。関数の引数・戻り値すべてに型ヒントを記述する
- **1関数1責務**。関数が複数のことをしていると感じたら分割する
- **コメントは WHY のみ**。コードから読み取れる WHAT は書かない
- **フォーマットは `ruff` で自動化**。手動でスタイルを整えない

#### `pyproject.toml`（開発依存含む）

```toml
[project]
name = "rest-promoter-app"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi",
    "uvicorn[standard]",
    "pandas",
]

[dependency-groups]
dev = ["ruff"]

[tool.ruff]
line-length = 88

[tool.ruff.lint]
select = ["E", "F", "I"]  # pycodestyle, pyflakes, isort
```

> **ruff の実行:** `uv run ruff check .` でチェック、`uv run ruff format .` でフォーマット。

#### フォーマット・スタイル

- インデント：スペース4つ
- 1行の最大文字数：88文字（`ruff` デフォルト）
- 文字列クォート：ダブルクォート `"` を使用

#### インポート順序

```python
# 1. 標準ライブラリ
import threading
from datetime import datetime

# 2. サードパーティ
import pandas as pd
from fastapi import APIRouter, HTTPException

# 3. ローカルモジュール
from services.timer_service import get_state, timer_lock
```

#### `TimerState` の実装形式

`TimerState` は `@dataclass` で実装する。スレッド間で共有するオブジェクトのため、Pydantic `BaseModel`（イミュータブル）は使わない。

```python
from dataclasses import dataclass, field

@dataclass
class TimerState:
    is_running: bool = False
    is_breaking: bool = False
    is_first: bool = True
    remaining: int = 3600
    timer_duration: int = 3600
    session_elapsed: int = 0
    accum_elapsed: int = 0
    dialog_triggered: bool = False
    dialog_mode: str | None = None
    prev_task: str = ""
    prev_load: int = 3
```

#### `TimerState` へのアクセス

```python
# Lock を使った読み書きのパターン
import copy

with timer_lock:
    state_copy = copy.copy(timer_state)  # プリミティブ型のみなのでシャローコピーで十分

# Lock のスコープは最小限に保つ（I/O・重い処理を Lock 内に含めない）
with timer_lock:
    timer_state.is_running = True
    timer_state.remaining = timer_state.timer_duration
```

#### 例外処理

エンドポイントで発生したエラーは `HTTPException` で返す。予期しない例外はそのまま伝播させ、FastAPI のデフォルトハンドラに委ねる。

```python
from fastapi import HTTPException

# バリデーションエラー（クライアント起因）→ 422 は Pydantic が自動で返すため明示不要
# ビジネスロジックエラー → 400 で返す
if timer_state.is_running:
    raise HTTPException(status_code=400, detail="already_running")

# CSV 書き込みエラーなど予期しない例外 → 500 として FastAPI が自動で返す（MVP では対象外）
```

---

### JavaScript（フロントエンド）

#### 基本方針

- **`const` を優先**し、再代入が必要な場合のみ `let` を使う。`var` は使わない
- **`async/await` を使う**。コールバックや `.then()` チェーンは避ける
- DOM 操作は **`textContent` を使う**。`innerHTML` は使わない（XSS 対策）
- **API レスポンスのキー名（`snake_case`）はそのまま使う**。camelCase への変換は行わない（例: `state.session_elapsed`）

#### フォーマット・スタイル

- インデント：スペース2つ
- 文字列クォート：シングルクォート `'` を使用
- セミコロン：あり

#### ポーリングの実装パターン

```javascript
// ポーリングはフラグで二重実行を防ぐ
let isPolling = false;
let isDialogOpen = false;  // ダイアログ表示中は重複発火を防ぐ

async function poll() {
  if (isPolling) return;
  isPolling = true;
  try {
    const res = await fetch('/state');
    if (!res.ok) {
      showConnectionError();  // サーバー応答なし時のエラー表示
      return;
    }
    hideConnectionError();
    const state = await res.json();
    updateUI(state);
    if (state.dialog_triggered && !isDialogOpen) {
      await fetch('/dialog/ack', { method: 'POST' });
      openDialog(state.dialog_mode);
    }
  } catch (e) {
    // fetch 自体の失敗（ネットワーク断・サーバーダウン）
    showConnectionError();
  } finally {
    isPolling = false;
  }
}

setInterval(poll, 1000);
```

> **エラー表示方針:** サーバーへの接続が失敗した場合、画面上部に「サーバーに接続できません」バナーを表示する。復帰したら自動で非表示にする。

#### API 呼び出しのパターン

```javascript
async function postRecord(payload) {
  const res = await fetch('/record', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`POST /record failed: ${res.status}`);
  return res.json();
}
```

---

## 命名規則

### Python

| 対象 | 規則 | 例 |
|------|------|-----|
| 変数・関数 | `snake_case` | `timer_state`, `get_dialog_mode()` |
| クラス | `PascalCase` | `TimerState` |
| 定数 | `UPPER_SNAKE_CASE` | `ACCUM_WARN_SEC = 8100` |
| プライベート | `_` プレフィックス | `_background_thread` |
| モジュール | `snake_case` | `timer_service.py` |

**ドメイン固有の命名（Python・API キー共通）:**

| 名前 | 意味 |
|------|------|
| `session_elapsed` | 現セッション経過秒 |
| `accum_elapsed` | 累積作業秒 |
| `timer_duration` | タイマー設定秒数 |
| `remaining` | カウントダウン残り秒 |
| `dialog_mode` | ダイアログモード（`first`/`timer`/`self`/`force`） |
| `is_breaking` | 休憩中フラグ |
| `is_first` | firstモードフラグ |

### JavaScript

| 対象 | 規則 | 例 |
|------|------|-----|
| 変数・関数 | `camelCase` | `openDialog()`, `updateUI()` |
| API レスポンスのフィールド参照 | **snake_case のまま使う** | `state.session_elapsed`, `state.accum_elapsed` |
| 定数 | `UPPER_SNAKE_CASE` | `POLL_INTERVAL_MS = 1000` |
| DOM 要素の変数 | `El` サフィックス | `timerDisplayEl`, `dialogEl` |
| イベントハンドラ | `on` + イベント名 | `onStartClick`, `onDialogSubmit` |

### CSS

| 対象 | 規則 | 例 |
|------|------|-----|
| クラス | `kebab-case` | `.timer-display`, `.dialog-overlay` |
| CSS カスタムプロパティ | `--` プレフィックス + `kebab-case` | `--color-warning`, `--color-danger` |

**状態を表す CSS クラス:**

| クラス名 | 意味 |
|---------|------|
| `.is-running` | タイマー動作中 |
| `.is-breaking` | 休憩中 |
| `.accum-warn` | 累積バー警告（黄色） |
| `.accum-danger` | 累積バー上限（赤） |
| `.state-low` | 状態スコア低下時のダイアログ枠（赤ボーダー） |

---

## スタイリング規約

### CSS カスタムプロパティ（色定義）

```css
:root {
  /* 累積バーの状態色 */
  --color-accum-normal: #4caf50;
  --color-accum-warn:   #ffc107;
  --color-accum-danger: #f44336;

  /* ダイアログの警告ボーダー */
  --color-dialog-danger: #f44336;

  /* 状態スコアの点の色 */
  --color-state-low:    #f44336;  /* スコア 1〜2 */
  --color-state-mid:    #9e9e9e;  /* スコア 3   */
  --color-state-high:   #4caf50;  /* スコア 4〜5 */
}
```

### レイアウト方針

- ダイアログオーバーレイは `position: fixed; inset: 0;` で全画面を覆う
- `z-index` はダイアログを最前面（`z-index: 1000`）に固定し、他の要素を操作できなくする
- メイン画面は最大幅 `800px` で中央揃えとする
- レスポンシブ対応は MVP では対象外。デスクトップブラウザでの固定幅表示のみサポートする

---

## テスト規約

MVP フェーズではユニットテスト・統合テストの自動化は対象外とする。
品質確認は以下の手動チェックで行う。

**実施タイミング:** `main` へのマージ前に必ず実施する。

### 手動チェックリスト

**タイマー動作:**
- [ ] 開始 → 発火 → ダイアログ表示が正しく動くか
- [ ] 一時停止 → 再開で残り時間が継続するか
- [ ] リセット後に `first` モードで再開するか
- [ ] タイマー間隔を変更後、次のセッションから新しい時間が反映されるか

**ダイアログフロー:**
- [ ] `first` / `timer` / `self` / `force` の各モードで正しいステップが表示されるか
- [ ] 作業内容未入力で次へ進めないか（バリデーション）
- [ ] 前回の作業内容・負荷がデフォルト表示されるか
- [ ] ダイアログ内に状態スコア推移グラフ（今回プレビュー付き）が表示されるか

**状態管理:**
- [ ] スヌーズ後に `accum_elapsed` がリセットされないか
- [ ] 休憩後に `accum_elapsed` が 0 にリセットされるか
- [ ] 累積 135分で累積バーが黄色、180分で赤になるか
- [ ] 休憩タイマー終了後に自動で `timer` ダイアログが表示されるか

**データ永続化:**
- [ ] ダイアログ送信後に `data/log.csv` に正しい行が追加されているか
- [ ] サーバー再起動後もログ・グラフが表示されるか

**`force` モード:**
- [ ] `accum_elapsed` 180分以上でタイマー発火した場合に `force` モードが開くか
- [ ] `force` モードでスヌーズ選択肢が非表示になっているか
- [ ] 自己申告ボタンでは `force` にならず `self` で開くか

**グラフ表示:**
- [ ] 状態スコア推移グラフが直近30件を表示しているか
- [ ] 連続作業時間グラフが `first` モードレコード（`session_min = 0`）を除外しているか

**セキュリティ:**
- [ ] `=` から始まる作業内容を入力した場合、CSV に `'=...` と書き込まれるか（CSV インジェクション対策）

---

## Git 規約

### リポジトリ初期化

ローカルのみで管理する（リモートリポジトリは使用しない）。

```bash
git init
git add .
git commit -m "docs: 初回ドキュメント一式を追加"
```

### ブランチ戦略

```
main          # 常に動作する状態を保つ
feature/xxx   # 機能追加・変更作業ブランチ
fix/xxx       # バグ修正ブランチ
```

**ブランチ名の例:**

| 作業 | ブランチ名 |
|------|-----------|
| タイマー機能の実装 | `feature/timer` |
| ダイアログフローの実装 | `feature/dialog-flow` |
| タイマー間隔変更機能 | `feature/timer-config` |
| CSV 書き込みバグ修正 | `fix/csv-write` |

### コミットメッセージ

**形式:**
```
<type>: <概要（日本語・50文字以内）>

<本文（任意）>
```

**type 一覧:**

| type | 用途 |
|------|------|
| `feat` | 新機能の追加 |
| `fix` | バグ修正 |
| `docs` | ドキュメントのみの変更 |
| `refactor` | 動作を変えないリファクタリング |
| `style` | フォーマット・インデント等の変更 |
| `chore` | ビルド設定・依存関係の更新 |

**例:**
```
feat: タイマー間隔をユーザーが変更できるようにする

POST /config エンドポイントを追加。
変更は次のセッション開始時から反映される。
```

### コミットの粒度

- 1コミットにつき1つの変更目的（機能・修正・ドキュメント）
- `tasklist.md` のタスク1項目 ≒ 1〜3コミットを目安とする
- 動作しない状態でコミットしない

### マージ方法

`feature/` または `fix/` ブランチを `main` にマージする際は **マージコミット（`--no-ff`）** を使う。

```bash
git checkout main
git merge --no-ff feature/timer-config
```

### 作業フロー

```
1. .steering/[YYYYMMDD]-[タイトル]/tasklist.md のタスクを確認
2. feature/ または fix/ ブランチを作成
3. 実装 → ruff でフォーマット → 手動チェック → コミット
4. main に --no-ff マージ
5. tasklist.md のタスクを完了マークに更新
```
