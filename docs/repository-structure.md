# リポジトリ構造定義書

## ディレクトリ構成

```
rest-promoter-app/
│
├── CLAUDE.md                      # Claude Code 向けプロジェクトメモリ
├── main.py                        # FastAPI エントリポイント
├── pyproject.toml                 # uv プロジェクト定義・依存関係
├── uv.lock                        # uv ロックファイル（自動生成・コミット対象）
├── start.bat                      # 起動スクリプト（uvicorn + ブラウザ自動オープン）
├── .gitignore                     # Git 除外設定
│
├── data/
│   └── log.csv                    # 記録ログ（初回起動時に自動生成・.gitignore 対象）
│
├── static/
│   ├── index.html                 # メイン画面
│   ├── style.css                  # スタイル
│   └── app.js                     # ポーリング・ダイアログ制御・グラフ描画
│
├── routers/
│   ├── __init__.py                # 空ファイル（Python パッケージ宣言）
│   ├── timer.py                   # タイマー操作エンドポイント・Pydantic モデル
│   ├── dialog.py                  # ダイアログ記録・ack エンドポイント・Pydantic モデル
│   └── log.py                     # ログ取得エンドポイント・Pydantic モデル
│
├── services/
│   ├── __init__.py                # 空ファイル（Python パッケージ宣言）
│   ├── timer_service.py           # TimerState 管理・バックグラウンドスレッド
│   ├── session_service.py         # ダイアログモード判定・アドバイス分岐ロジック
│   └── log_service.py             # CSV 読み書き
│
├── docs/                          # 永続的ドキュメント
│   ├── product-requirements.md    # プロダクト要求定義書
│   ├── functional-design.md       # 機能設計書
│   ├── architecture.md            # 技術仕様書
│   ├── repository-structure.md    # リポジトリ構造定義書（本書）
│   ├── development-guidelines.md  # 開発ガイドライン
│   └── glossary.md                # ユビキタス言語定義
│
└── .steering/                     # 作業単位ドキュメント
    └── YYYYMMDD-[開発タイトル]/
        ├── requirements.md
        ├── design.md
        ├── tasklist.md
        └── decisions.md
```

---

## 各ディレクトリ・ファイルの役割

### ルートファイル

| ファイル | 役割 |
|---------|------|
| `CLAUDE.md` | Claude Code 向けのプロジェクト開発ルール定義。開発プロセス・ドキュメント管理方針を記載 |
| `main.py` | FastAPI インスタンスの生成、ルーター登録、`StaticFiles` マウント、バックグラウンドスレッド起動（lifespan）、`data/log.csv` の初回自動生成 |
| `pyproject.toml` | uv によるパッケージ管理。依存パッケージ（fastapi / uvicorn / pandas）と Python バージョン要件を定義 |
| `uv.lock` | uv が自動生成するロックファイル。依存パッケージのバージョンを固定し、再現性のある環境を保証する。コミット対象 |
| `start.bat` | アプリの起動スクリプト。uvicorn を起動しブラウザを自動オープンする |
| `.gitignore` | `data/log.csv`（作業ログはプライバシー情報を含む可能性があるため）、`__pycache__/`、`.venv/` を除外 |

---

### `data/`

アプリが生成・更新するデータファイルを置く。

| ファイル | 役割 |
|---------|------|
| `log.csv` | ダイアログ記録のログ。`main.py` 起動時にファイルが存在しない場合、ヘッダー行のみの空CSVを自動生成する |

**配置ルール:**
- `data/` 配下はアプリが自動生成・更新するファイルのみ置く
- 手動で編集しない（破損するとログが失われる）
- `data/log.csv` は `.gitignore` に追加する（作業内容・状態スコアはプライバシー情報を含むため）

---

### `static/`

ブラウザに配信する静的ファイルを置く。FastAPI の `StaticFiles` でマウントされる。

| ファイル | 役割 |
|---------|------|
| `index.html` | メイン画面のHTML。Chart.js の CDN 読み込みタグを含む |
| `style.css` | 全スタイル定義。CSS カスタムプロパティで色・サイズを管理 |
| `app.js` | ポーリング（`setInterval` 1秒）、ダイアログの表示・ステップ制御、グラフ描画（Chart.js）、ユーザー入力のクライアント側バリデーション、`self` モードダイアログの直接起動 |

**配置ルール:**
- フレームワークのビルド成果物は置かない（バンドラー不使用）
- 外部ライブラリはローカルに配置せず CDN 経由で読み込む（MVP方針）
- 画像・アイコンが必要な場合は `static/` 直下に置く

---

### `routers/`

FastAPI のルーター定義を置く。エンドポイントのルーティングと、そのエンドポイントで使う Pydantic モデルを同一ファイルに定義する。ビジネスロジックは持たない。

| ファイル | 担当エンドポイント | Pydantic モデル例 |
|---------|-----------------|-----------------|
| `timer.py` | `GET /state` `POST /start` `POST /pause` `POST /reset` `POST /config` | `ConfigRequest`, `StateResponse` |
| `dialog.py` | `POST /record` `POST /dialog/ack` | `RecordRequest`, `RecordResponse` |
| `log.py` | `GET /logs` | `LogEntry`, `LogsResponse` |

**配置ルール:**
- 1ファイルにつき1つの関心領域（タイマー操作 / ダイアログ / ログ）に対応させる
- Pydantic モデルは対応するルーターファイルの先頭に定義する（`models/` ディレクトリは作らない）
- ビジネスロジックは必ず `services/` に委譲する。`routers/` 内でビジネスロジックを書かない
- `__init__.py` は空ファイル（Python パッケージ宣言のみ）

---

### `services/`

ビジネスロジックを置く。`routers/` から呼び出される。

| ファイル | 役割 |
|---------|------|
| `timer_service.py` | `TimerState` クラスのシングルトンインスタンス管理、`threading.Lock` による排他制御、バックグラウンドスレッド（1秒ごとの状態更新・タイマー発火判定）、タイマー操作メソッド（start / pause / reset / config） |
| `session_service.py` | ダイアログモードの判定ロジック（`first` / `timer` / `force`）、アドバイス分岐ロジック（状態スコア・負荷・`session_elapsed` の条件評価）。`TimerState` の値を受け取って結果を返す副作用のない純粋関数として実装する |
| `log_service.py` | `data/log.csv` への追記・全件読み込み（pandas 使用）、CSV インジェクション対策（先頭文字エスケープ）、初回起動時の CSV 自動生成 |

**サービス間の依存関係:**

```
timer_service ──▶ session_service  # タイマー発火時のダイアログモード判定
timer_service ──▶ log_service      # POST /record 処理時のCSV書き込み
session_service                    # 依存なし（純粋関数）
log_service                        # 依存なし（CSV I/O のみ）
```

**配置ルール:**
- `session_service` は副作用を持たない純粋関数として実装する（テスタビリティのため）
- `log_service` は CSV の読み書きのみを担う。タイマー状態に直接アクセスしない
- `__init__.py` は空ファイル（Python パッケージ宣言のみ）

---

### `docs/`

永続的ドキュメントを置く。アプリケーションの基本設計が変わらない限り更新されない。

| ファイル | 役割 |
|---------|------|
| `product-requirements.md` | プロダクト要求定義書 |
| `functional-design.md` | 機能設計書（API設計・データモデル・画面設計を含む） |
| `architecture.md` | 技術仕様書 |
| `repository-structure.md` | 本書 |
| `development-guidelines.md` | 開発ガイドライン |
| `glossary.md` | ユビキタス言語定義 |

**配置ルール:**
- `docs/` 配下は Markdown ファイルのみ置く
- 画像が必要な場合は `docs/images/` に置く
- 作業単位のドキュメント（ステアリングファイル）は `.steering/` に置く。`docs/` と混在させない

---

### `.steering/`

特定の開発作業ごとのドキュメントを置く。作業完了後も削除せず履歴として保持する。

```
.steering/
└── YYYYMMDD-[開発タイトル]/
    ├── requirements.md    # 今回の作業の要求内容
    ├── design.md          # 変更内容の設計
    ├── tasklist.md        # タスクリストと進捗
    └── decisions.md       # 意思決定ログ
```

**配置ルール:**
- ディレクトリ名は `YYYYMMDD-[開発タイトル]` 形式（例: `20260509-initial-implementation`）
- 新しい作業では必ず新しいディレクトリを作成する。既存ディレクトリを上書きしない

---

## ファイル配置ルール まとめ

| 種別 | 配置場所 | 例 |
|------|---------|-----|
| FastAPI エントリポイント | ルート直下 | `main.py` |
| 起動スクリプト | ルート直下 | `start.bat` |
| プロジェクト定義 | ルート直下 | `pyproject.toml` |
| ロックファイル | ルート直下 | `uv.lock` |
| エンドポイント定義 + Pydantic モデル | `routers/` | `timer.py` |
| ビジネスロジック | `services/` | `timer_service.py` |
| 画面ファイル | `static/` | `index.html`, `app.js`, `style.css` |
| データファイル | `data/` | `log.csv` |
| 永続的ドキュメント | `docs/` | `architecture.md` |
| 作業単位ドキュメント | `.steering/YYYYMMDD-xxx/` | `tasklist.md` |

**新しいファイルを追加するときの判断基準:**

1. エンドポイントを追加する → `routers/` に新ファイルまたは既存ファイルに追記
2. ビジネスロジックを追加する → `services/` に新ファイルまたは既存ファイルに追記
3. 画面の構成要素を追加する → `static/` の既存ファイルを編集（原則ファイルを増やさない）
4. アプリが生成するデータを追加する → `data/` に配置
5. Pydantic モデルを追加する → 対応する `routers/` ファイルの先頭に定義する
