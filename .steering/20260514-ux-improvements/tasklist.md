# タスクリスト：UX改善（ダイアログ・音声・タイマー）

## 進捗サマリー

| フェーズ | 内容 | 状態 |
|---------|------|------|
| フェーズ1 | バックエンド（セッション時刻・バリデーション） | ✅ 完了 |
| フェーズ2 | SVG タイマー（HTML・CSS・JS） | ✅ 完了 |
| フェーズ3 | 音声通知 | ✅ 完了 |
| フェーズ4 | プリセットボタン（HTML・CSS・JS） | ✅ 完了 |
| フェーズ5 | ダイアログフロー改修（JS） | ✅ 完了 |
| フェーズ6 | 仕上げ（lint・動作確認） | 🔲 手動チェック待ち |

---

## フェーズ1：バックエンド 🔲

**目標:** セッション時刻の記録・休憩60分の許容・既存 CSV のマイグレーションが動く。

### 1-1. `services/timer_service.py`

- [ ] ファイル先頭に `from datetime import datetime, timedelta, timezone` を追加する
- [ ] `_JST = timezone(timedelta(hours=9))` をモジュールレベルに追加する
- [ ] `TimerState` データクラスに `session_start_time: str = ""` フィールドを追加する
- [ ] `do_record()` の `action == "start"` ブロックに以下を追加する
  ```python
  timer_state.session_start_time = datetime.now(_JST).strftime("%Y-%m-%dT%H:%M:%S")
  ```
- [ ] `do_record()` の `action == "rest"` ブロックに以下を追加する
  ```python
  timer_state.session_start_time = ""
  ```
- [ ] `do_record()` の `action == "skip"` ブロックに以下を追加する
  ```python
  timer_state.session_start_time = datetime.now(_JST).strftime("%Y-%m-%dT%H:%M:%S")
  ```

### 1-2. `services/log_service.py`

- [ ] `COLUMNS` リストの末尾に `"session_start"`, `"session_end"` を追加する
- [ ] `init_csv()` を以下のマイグレーション対応版に置き換える
  - CSV が存在しない場合は従来通り新規作成する
  - CSV が存在する場合は `pd.read_csv()` で読み込み、`COLUMNS` に存在しないカラムを空文字で追加して上書き保存する（変更がない場合は上書きしない）
- [ ] `append_log()` のシグネチャ末尾に `session_start: str`, `session_end: str` パラメータを追加する
- [ ] `append_log()` 内の `record` dict に `"session_start": session_start`, `"session_end": session_end` を追加する
- [ ] `read_logs()` の `pd.read_csv()` 直後に以下の後方互換処理を追加する
  ```python
  for col in ("session_start", "session_end"):
      if col not in df.columns:
          df[col] = ""
  ```

### 1-3. `routers/dialog.py`

- [ ] ファイル先頭に `from datetime import datetime, timedelta, timezone` を追加する
- [ ] `_JST = timezone(timedelta(hours=9))` をモジュールレベルに追加する
- [ ] `RecordRequest.validate_action()` の以下の行を修正する
  ```python
  # 変更前
  elif self.break_min not in (5, 10, 15):
  # 変更後
  elif self.break_min not in (5, 10, 15, 60):
  ```
- [ ] `record()` 関数を以下の手順で更新する
  1. `s = get_state_snapshot()` の直後に `now_str = datetime.now(_JST).strftime("%Y-%m-%dT%H:%M:%S")` を追加する
  2. `session_start` / `session_end` を action に応じて決定するロジックを追加する（`action == "start"` なら `session_start = now_str`, `session_end = ""`、それ以外なら `session_start = s.session_start_time`, `session_end = now_str`）
  3. `append_log()` 呼び出しに `session_start=session_start, session_end=session_end` を追加する

**完了条件:** `POST /record` が `data/log.csv` に `session_start`/`session_end` を書き込む。既存 CSV がある状態で起動してもエラーなし。

---

## フェーズ2：SVG タイマー 🔲

**目標:** タイマー表示が SVG 円形プログレスに置き換わり、作業中・休憩中で色が変わる。

### 2-1. `static/index.html`

- [ ] `.timer-section` 内の `<div id="timer-display" ...>` を以下の SVG 要素に置き換える
  ```html
  <svg id="timer-svg" class="timer-svg" width="200" height="200"
       viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
    <circle id="timer-track" cx="100" cy="100" r="88"
            stroke="#e0e0e0" stroke-width="12" fill="none"/>
    <circle id="timer-progress" cx="100" cy="100" r="88"
            stroke="#1976d2" stroke-width="12" fill="none"
            stroke-linecap="round"
            transform="rotate(-90 100 100)"
            stroke-dasharray="552.92" stroke-dashoffset="0"/>
    <text id="timer-label" x="100" y="90"
          text-anchor="middle" font-size="16" fill="#4caf50"
          font-family="inherit" visibility="hidden">休憩</text>
    <text id="timer-text" x="100" y="116"
          text-anchor="middle" font-size="38" font-weight="700" fill="#212121"
          font-variant-numeric="tabular-nums" font-family="inherit">--:--</text>
  </svg>
  ```

### 2-2. `static/style.css`

- [ ] `.timer-display` と `.timer-display.is-breaking` のスタイルブロックを削除する
- [ ] `.timer-svg { display: block; margin: 0 auto; }` を `.timer-section` 関連スタイルの近くに追加する

### 2-3. `static/app.js`（SVG 関連）

- [ ] `timerDisplayEl` の DOM 参照宣言を削除する
- [ ] 以下の DOM 参照を追加する
  ```js
  const timerProgressEl = document.getElementById('timer-progress');
  const timerTextEl     = document.getElementById('timer-text');
  const timerLabelEl    = document.getElementById('timer-label');
  ```
- [ ] 状態変数に `let breakDuration = null;` を追加する
- [ ] `updateTimerDisplay(state)` 関数を削除し、`updateTimerSvg(state, prevState)` 関数を新規追加する
  - `prevState.is_breaking` が false で `state.is_breaking` が true のとき `breakDuration = state.remaining` を記録する
  - `state.is_breaking` が false のとき `breakDuration = null` にリセットする
  - `total` を `state.is_breaking ? (breakDuration ?? state.remaining) : state.timer_duration` で計算する（`breakDuration` が null のときは `state.remaining` をフォールバックとして100%表示する）
  - `ratio = total > 0 ? state.remaining / total : 1` で進行率を計算する
  - `offset = 552.92 * (1 - ratio)` を `#timer-progress` の `stroke-dashoffset` に設定する
  - `state.is_breaking` のとき `stroke` を `#4caf50`、それ以外は `#1976d2` に設定する
  - 作業中: `#timer-label` を `visibility="hidden"`、`#timer-text` の `font-size="38"`、`fill="#212121"`、テキストを `formatMmss(state.remaining)` にする
  - 休憩中: `#timer-label` を `visibility="visible"`、`#timer-text` の `font-size="24"`、`fill="#4caf50"`、テキストを `formatMmss(state.remaining)` にする
  - 末尾に `sessionElapsedEl.textContent = \`セッション経過: ${formatMmss(state.session_elapsed)}\`` を追加する（現行 `updateTimerDisplay()` の L144 相当）
- [ ] `updateUI(state)` のシグネチャを `updateUI(state, prevState)` に変更する
- [ ] `updateUI()` 内の `updateTimerDisplay(state)` 呼び出しを `updateTimerSvg(state, prevState)` に置き換える
- [ ] `poll()` 内の `lastState = state` の直前に `const prevState = lastState;` を追加する
- [ ] `poll()` 内の `updateUI(state)` を `updateUI(state, prevState)` に変更する

**完了条件:** ブラウザで開始するとタイマーが SVG 円形プログレスで表示される。休憩中は緑色になる。

---

## フェーズ3：音声通知 🔲

**目標:** タイマー発火・休憩終了時に日本語音声が再生される。

### 3-1. `static/app.js`（音声関連）

- [ ] `speak(text)` 関数を追加する（定数定義エリアの近くに配置）
  ```js
  function speak(text) {
    try {
      if (!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'ja-JP';
      window.speechSynthesis.speak(utter);
    } catch (_) {
      // silent fallback
    }
  }
  ```
- [ ] `poll()` 内の `dialog_triggered` 検知ブロックを以下に更新する
  ```js
  if (state.dialog_triggered && !isDialogOpen) {
    const wasBreaking = prevState && prevState.is_breaking;
    await apiFetch('/dialog/ack', 'POST');
    speak(wasBreaking
      ? '休憩が終わりました。今の状態を教えてください。'
      : '作業時間が終わりました。今の状態を教えてください。'
    );
    openDialog(state.dialog_mode);
  }
  ```
  - `prevState` はフェーズ2で追加済みのため、そのまま使用できる

**完了条件:** タイマー発火・休憩終了時に音声が再生される（対応ブラウザ）。対応外環境ではエラーなしで無音になる。※ オートプレイポリシーにより初回操作前は鳴らない場合があるが、それは許容範囲とする。

---

## フェーズ4：プリセットボタン 🔲

**目標:** タイマー間隔がプリセットボタンで設定でき、現在値がハイライトされる。休憩時間に60分が追加される。

### 4-1. `static/index.html`

- [ ] `.config-section` 内の `<label for="input-duration">`, `<input id="input-duration">`, `<button id="btn-config">` を削除し、以下に置き換える
  ```html
  <div class="config-section">
    <span class="config-label">タイマー間隔:</span>
    <div id="preset-group" class="preset-group">
      <button class="preset-btn" data-min="15">15分</button>
      <button class="preset-btn" data-min="30">30分</button>
      <button class="preset-btn" data-min="45">45分</button>
      <button class="preset-btn" data-min="60">60分</button>
      <button class="preset-btn" data-min="75">75分</button>
      <button class="preset-btn" data-min="90">90分</button>
    </div>
  </div>
  ```

### 4-2. `static/style.css`

- [ ] `.input-duration` のスタイルブロックを削除する
- [ ] 以下のスタイルを `.config-section` 関連の近くに追加する
  ```css
  .config-label {
    font-size: 13px;
    color: var(--color-text-sub);
    white-space: nowrap;
  }

  .preset-group {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .preset-btn {
    padding: 6px 14px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 13px;
    background: var(--color-surface);
    transition: border-color 0.2s, background 0.2s;
  }

  .preset-btn:hover:not(:disabled) {
    border-color: var(--color-primary);
  }

  .preset-btn.active {
    border-color: var(--color-primary);
    background: var(--color-primary);
    color: #fff;
  }

  .preset-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  ```

### 4-3. `static/app.js`（プリセット関連）

- [ ] `inputDurationEl` の DOM 参照宣言を削除する
- [ ] `btnConfigEl` の DOM 参照宣言を削除する
- [ ] `btnConfigEl.addEventListener('click', ...)` のイベントリスナーブロック全体を削除する
- [ ] `updateUI()` 内の以下のブロックを削除する
  ```js
  if (document.activeElement !== inputDurationEl) {
    inputDurationEl.value = Math.round(state.timer_duration / 60);
  }
  ```
- [ ] `updateButtonStates()` 内の `btnConfigEl.disabled = breaking;` を削除する
- [ ] `updatePresetHighlight(state)` 関数を追加する
  ```js
  function updatePresetHighlight(state) {
    const currentMin = Math.round(state.timer_duration / 60);
    document.querySelectorAll('.preset-btn').forEach(btn => {
      const isActive = parseInt(btn.dataset.min, 10) === currentMin;
      btn.classList.toggle('active', isActive);
      btn.disabled = state.is_breaking;
    });
  }
  ```
- [ ] `updateUI()` 内で `updatePresetHighlight(state)` を呼ぶ行を追加する
- [ ] プリセットボタンのイベントリスナーをイベントリスナーセクションに追加する
  ```js
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const min = parseInt(btn.dataset.min, 10);
      await apiFetch('/config', 'POST', { duration_min: min });
      await poll();
    });
  });
  ```

**完了条件:** プリセットボタンをクリックするとタイマー間隔が変わり、対応ボタンがハイライトされる。休憩中はボタンが無効化される。

---

## フェーズ5：ダイアログフロー改修 🔲

**目標:** 休憩ルートでは作業内容・負荷入力がスキップされ、継続ルートでは全ステップが表示される。

### 5-1. `static/app.js`（状態変数・ユーティリティ）

- [ ] 状態変数に `let dialogRoute = null;` を追加する
- [ ] `totalSteps(mode)` 関数を削除し、`getStepCount(mode, route)` 関数を追加する
  ```js
  function getStepCount(mode, route) {
    if (mode === 'first') return 3;
    if (mode === 'force') return 2;
    if (route === 'rest') return 3;
    if (route === 'continue') return 5;
    return 5;
  }
  ```

### 5-1b. `static/style.css`（ルート選択ボタン）

- [ ] `.route-btn` のスタイルを `style.css` に追加する（`.radio-btn` と同様の基本スタイルに、幅広・余白大きめを加えたもの）
  ```css
  .route-btn {
    display: block;
    width: 100%;
    padding: 12px 20px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    background: var(--color-surface);
    text-align: left;
    transition: border-color 0.2s, background 0.2s;
  }

  .route-btn:hover {
    border-color: var(--color-primary);
  }

  .route-btn.selected {
    border-color: var(--color-primary);
    background: var(--color-primary);
    color: #fff;
  }
  ```

### 5-2. `static/app.js`（ダイアログ描画関数）

- [ ] `renderActionSelect(mode)` 関数を削除する
- [ ] `renderRouteChoice()` 関数を新規追加する
  - タイトル「次のアクションを選択してください」を表示する
  - 「休憩する」と「作業を続ける」の2つの `.route-btn` ボタンを表示する
  - `dialogRoute` が null でない場合は対応するボタンに `.selected` クラスを付与した状態で描画する
  - ボタンクリック時: `dialogRoute` を `'rest'` または `'continue'` に設定し、`.route-btn` の `.selected` を付け替え、`updateStepIndicator(currentStep, getStepCount(currentDialogMode, dialogRoute))` を呼ぶ
- [ ] `renderBreakSelect(forceOnly)` 関数を新規追加する
  - タイトル「休憩時間を選択してください」を表示する
  - `forceOnly=false` のとき: 5 / 10 / 15 / 60 分の `.radio-btn` ボタンを表示する
  - `forceOnly=true` のとき: 15分のみ表示する
  - クリック時: `dialogData.action = 'rest'`、`dialogData.break_min = min`、`.radio-btn` の `.selected` を付け替える
  - `dialogData.break_min` が設定済みの場合は対応ボタンに `.selected` を付与した状態で描画する
- [ ] `renderSnoozeSelect()` 関数を新規追加する
  - タイトル「スヌーズ時間を選択してください」を表示する
  - 15 / 30 / 45 / 60 分後の `.radio-btn` ボタンを表示する
  - クリック時: `dialogData.action = 'skip'`、`dialogData.snooze_min = min`、`.selected` を付け替える
  - `dialogData.snooze_min` が設定済みの場合は対応ボタンに `.selected` を付与した状態で描画する

### 5-3. `static/app.js`（ダイアログ制御）

- [ ] `openDialog(mode)` 内の `dialogData` リセット時に `dialogRoute = null` を追加する
- [ ] `closeDialog()` 内に `dialogRoute = null` を追加する
- [ ] `showStep(step)` を以下のロジックに更新する
  ```js
  function showStep(step) {
    currentStep = step;
    const mode = currentDialogMode;
    const total = getStepCount(mode, dialogRoute);
    updateStepIndicator(step, total);
    adviseBannerEl.classList.add('hidden');
    stepContentEl.textContent = '';

    if (mode === 'first') {
      renderFirstStep(step);
    } else {
      renderTimerStep(step, mode);
    }
  }
  ```
- [ ] `renderTimerStep(step, mode)` を以下の構成に改修する
  ```
  force モード:
    step 1: renderStateSelect() + renderDialogChart()
    step 2: renderBreakSelect(forceOnly=true)

  timer / self モード:
    step 1: renderStateSelect() + renderDialogChart()
    step 2: renderRouteChoice()
    step 3 (rest):     renderBreakSelect(forceOnly=false)
    step 3 (continue): renderTaskInput() + アドバイスバナー表示
    step 4 (continue): renderLoadSelect()
    step 5 (continue): renderSnoozeSelect()
  ```
  - アドバイスバナーは `dialogRoute === 'continue' && step === 3 && pendingAdvice` のときのみ `showAdviceBanner(pendingAdvice)` を呼ぶ

### 5-4. `static/app.js`（バリデーション・送信）

- [ ] `onNextClick()` を以下のバリデーションテーブルに従って全面改修する

  | mode | step | バリデーション |
  |------|------|--------------|
  | `first` | 1 | `dialogData.task` 必須（空文字チェック） |
  | `first` | 2 | `dialogData.load != null` |
  | `first` | 3 | `dialogData.state != null` |
  | `force` | 1 | `dialogData.state != null` |
  | `force` | 2 | `dialogData.break_min != null` |
  | `timer`/`self` | 1 | `dialogData.state != null` |
  | `timer`/`self` | 2 | `dialogRoute != null` |
  | `timer`/`self` (rest) | 3 | `dialogData.break_min != null` |
  | `timer`/`self` (continue) | 3 | `dialogData.task` 必須 |
  | `timer`/`self` (continue) | 4 | `dialogData.load != null` |
  | `timer`/`self` (continue) | 5 | `dialogData.snooze_min != null` |

  - Step 1 完了後のアドバイス取得は `mode !== 'first' && mode !== 'force'` のときのみ実行する
  - 最終ステップ（`currentStep === getStepCount(mode, dialogRoute)`）のとき `submitDialog()` を呼ぶ

- [ ] `submitDialog()` を以下のように改修する
  - `mode === 'first'`: `task = dialogData.task`, `load = dialogData.load`, `action = 'start'`
  - `dialogRoute === 'rest'`: `task = lastState.prev_task`, `load = lastState.prev_load`, `action = 'rest'`, `break_min = dialogData.break_min`
  - `dialogRoute === 'continue'`: `task = dialogData.task`, `load = dialogData.load`, `action = 'skip'`, `snooze_min = dialogData.snooze_min`

**完了条件:** 全モード（first / timer / self / force）でダイアログが仕様通りのステップフローで動き、`POST /record` が正しい payload で送信される。

---

## フェーズ6：仕上げ 🔲

**目標:** lint エラーなし・受け入れ条件をすべて満たす。

- [ ] `uv run ruff format .` でフォーマットを適用する
- [ ] `uv run ruff check .` がエラーなしになる
- [ ] 手動動作確認チェックリスト
  - [ ] タイマー発火時に「作業時間が終わりました」の音声が流れる（Chrome/Edge）
  - [ ] 休憩終了時に「休憩が終わりました」の音声が流れる
  - [ ] ブラウザが SpeechSynthesis 非対応でもエラーが出ない
  - [ ] SVG が作業中は青、休憩中は緑で表示される
  - [ ] 休憩中に「休憩」ラベルが表示され、数値が小さくなる
  - [ ] timer モードで「休憩する」→ 3ステップで完了し `action=rest` が送信される
  - [ ] timer モードで「作業を続ける」→ 5ステップで完了し `action=skip` が送信される
  - [ ] force モードで 2ステップ（状態 → 休憩時間）になっている
  - [ ] first モードで 3ステップのフローが変わっていない
  - [ ] 休憩時間の選択肢に「60分」が表示される
  - [ ] プリセットボタンが現在のタイマー間隔をハイライトしている
  - [ ] プリセットボタンをクリックするとタイマー間隔が変わる
  - [ ] 休憩中はプリセットボタンが無効化される
  - [ ] CSV に `session_start` / `session_end` が記録される（`skip` / `rest` 行は両方、`start` 行は `session_start` のみ）
  - [ ] 既存の CSV がある状態で起動してもエラーなし
- [ ] コミットを作成する（`feat: ダイアログ・音声・SVGタイマー・プリセットボタンを実装`）

---

## 人手修正ログ

| 日付 | 対象ファイル | 修正内容 | 理由 |
|------|------------|---------|------|
