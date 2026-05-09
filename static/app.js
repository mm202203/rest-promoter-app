'use strict';

// ── 定数 ──────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 1000;
const ACCUM_WARN_MIN = 135;
const ACCUM_DANGER_MIN = 180;

// ── 状態変数 ──────────────────────────────────────────────────
let isPolling = false;
let isDialogOpen = false;
let lastState = null;
let currentDialogMode = null;
let currentStep = 1;
let dialogData = {};
let pendingAdvice = null;

// ── DOM 参照 ──────────────────────────────────────────────────
const connectionErrorEl = document.getElementById('connection-error');
const timerDisplayEl = document.getElementById('timer-display');
const sessionElapsedEl = document.getElementById('session-elapsed');
const accumBarEl = document.getElementById('accum-bar');
const accumTextEl = document.getElementById('accum-text');
const btnStartEl = document.getElementById('btn-start');
const btnPauseEl = document.getElementById('btn-pause');
const btnResetEl = document.getElementById('btn-reset');
const btnSelfEl = document.getElementById('btn-self');
const btnConfigEl = document.getElementById('btn-config');
const inputDurationEl = document.getElementById('input-duration');
const dialogOverlayEl = document.getElementById('dialog-overlay');
const dialogBoxEl = document.getElementById('dialog-box');
const stepIndicatorEl = document.getElementById('step-indicator');
const stepContentEl = document.getElementById('step-content');
const adviseBannerEl = document.getElementById('advice-banner');
const btnBackEl = document.getElementById('btn-back');
const btnNextEl = document.getElementById('btn-next');

// ── Chart.js グラフ ───────────────────────────────────────────
let stateChart = null;
let sessionChart = null;
let dialogStateChart = null;

function initCharts() {
  const stateCtx = document.getElementById('state-chart').getContext('2d');
  stateChart = new Chart(stateCtx, {
    type: 'line',
    data: { labels: [], datasets: [{ label: '状態スコア', data: [], pointBackgroundColor: [], borderColor: '#9e9e9e', tension: 0.3, fill: false }] },
    options: {
      scales: { y: { min: 1, max: 5, ticks: { stepSize: 1 } } },
      plugins: { legend: { display: false } },
      animation: false,
    },
  });

  const sessionCtx = document.getElementById('session-chart').getContext('2d');
  sessionChart = new Chart(sessionCtx, {
    type: 'bar',
    data: { labels: [], datasets: [{ label: '作業時間(分)', data: [], backgroundColor: '#1976d2' }] },
    options: {
      scales: { y: { min: 0, ticks: { stepSize: 10 } } },
      plugins: { legend: { display: false } },
      animation: false,
    },
  });

  const dialogCtx = document.getElementById('dialog-state-chart');
  if (dialogCtx) {
    dialogStateChart = new Chart(dialogCtx.getContext('2d'), {
      type: 'line',
      data: { labels: [], datasets: [{ label: '状態スコア', data: [], pointBackgroundColor: [], borderColor: '#9e9e9e', tension: 0.3, fill: false }] },
      options: {
        scales: { y: { min: 1, max: 5, ticks: { stepSize: 1 } } },
        plugins: { legend: { display: false } },
        animation: false,
      },
    });
  }
}

function scoreColor(score) {
  if (score <= 2) return '#f44336';
  if (score === 3) return '#9e9e9e';
  return '#4caf50';
}

function updateCharts(logs) {
  const stateLogs = logs.slice(-30);
  stateChart.data.labels = stateLogs.map(l => l.timestamp.slice(11, 16));
  stateChart.data.datasets[0].data = stateLogs.map(l => l.state);
  stateChart.data.datasets[0].pointBackgroundColor = stateLogs.map(l => scoreColor(l.state));
  stateChart.update();

  const sessionLogs = logs.filter(l => l.session_min > 0).slice(-30);
  sessionChart.data.labels = sessionLogs.map(l => l.timestamp.slice(11, 16));
  sessionChart.data.datasets[0].data = sessionLogs.map(l => l.session_min);
  sessionChart.update();
}

function updateDialogChart(logs, previewScore) {
  if (!dialogStateChart) return;
  const base = logs.slice(-29);
  const allPoints = previewScore != null
    ? [...base, { timestamp: '今回', state: previewScore }]
    : base.slice(-30);
  dialogStateChart.data.labels = allPoints.map((l, i) => i === allPoints.length - 1 && previewScore != null ? '今回' : l.timestamp.slice(11, 16));
  dialogStateChart.data.datasets[0].data = allPoints.map(l => l.state);
  dialogStateChart.data.datasets[0].pointBackgroundColor = allPoints.map(l => scoreColor(l.state));
  dialogStateChart.update();
}

// ── ユーティリティ ────────────────────────────────────────────
function formatMmss(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function showConnectionError() {
  connectionErrorEl.classList.remove('hidden');
}

function hideConnectionError() {
  connectionErrorEl.classList.add('hidden');
}

async function apiFetch(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return res.json();
}

// ── UI 更新 ───────────────────────────────────────────────────
function updateTimerDisplay(state) {
  if (state.is_breaking) {
    timerDisplayEl.textContent = `休憩中 ${formatMmss(state.remaining)}`;
    timerDisplayEl.classList.add('is-breaking');
  } else {
    timerDisplayEl.textContent = formatMmss(state.remaining);
    timerDisplayEl.classList.remove('is-breaking');
  }
  sessionElapsedEl.textContent = `セッション経過: ${formatMmss(state.session_elapsed)}`;
}

function updateAccumBar(state) {
  const mins = Math.floor(state.accum_elapsed / 60);
  const pct = Math.min((mins / ACCUM_DANGER_MIN) * 100, 100);
  accumBarEl.style.width = `${pct}%`;
  accumTextEl.textContent = `${mins}分 / ${ACCUM_DANGER_MIN}分`;
  accumBarEl.classList.remove('accum-warn', 'accum-danger');
  if (mins >= ACCUM_DANGER_MIN) {
    accumBarEl.classList.add('accum-danger');
  } else if (mins >= ACCUM_WARN_MIN) {
    accumBarEl.classList.add('accum-warn');
  }
}

function updateButtonStates(state) {
  const breaking = state.is_breaking;
  btnStartEl.disabled = breaking || state.is_running;
  btnPauseEl.disabled = breaking || !state.is_running;
  btnResetEl.disabled = breaking;
  btnSelfEl.disabled = breaking || isDialogOpen;
  btnConfigEl.disabled = breaking;
}

function updateUI(state) {
  updateTimerDisplay(state);
  updateAccumBar(state);
  updateButtonStates(state);
  inputDurationEl.value = Math.round(state.timer_duration / 60);
}

// ── ポーリング ────────────────────────────────────────────────
async function poll() {
  if (isPolling) return;
  isPolling = true;
  try {
    const state = await apiFetch('/state');
    hideConnectionError();
    lastState = state;
    updateUI(state);
    if (state.dialog_triggered && !isDialogOpen) {
      await apiFetch('/dialog/ack', 'POST');
      openDialog(state.dialog_mode);
    }
    const logsRes = await apiFetch('/logs');
    updateCharts(logsRes.logs);
    renderLogs(logsRes.logs);
  } catch {
    showConnectionError();
  } finally {
    isPolling = false;
  }
}

// ── ログ描画 ──────────────────────────────────────────────────
function renderLogs(logs) {
  const recent = logs.slice(-8).reverse();
  logListEl.textContent = '';
  if (recent.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'log-item';
    empty.textContent = '記録なし';
    logListEl.appendChild(empty);
    return;
  }
  for (const l of recent) {
    const item = document.createElement('div');
    item.className = 'log-item';

    const ts = document.createElement('span');
    ts.className = 'log-ts';
    ts.textContent = l.timestamp.slice(5, 16);

    const task = document.createElement('span');
    task.className = 'log-task';
    task.textContent = l.task;

    const action = document.createElement('span');
    action.className = 'log-action';
    const actionMap = { start: '開始', rest: '休憩', skip: 'スヌーズ' };
    action.textContent = actionMap[l.action] || l.action;

    item.appendChild(ts);
    item.appendChild(task);
    item.appendChild(action);
    logListEl.appendChild(item);
  }
}

const logListEl = document.getElementById('log-list');

// ── ダイアログ ────────────────────────────────────────────────
function totalSteps(mode) {
  return mode === 'first' ? 3 : 4;
}

function openDialog(mode) {
  currentDialogMode = mode;
  currentStep = 1;
  isDialogOpen = true;
  pendingAdvice = null;
  dialogData = { state: null, task: '', load: null, action: null, break_min: null, snooze_min: null };
  dialogBoxEl.classList.remove('state-low');
  dialogOverlayEl.classList.remove('hidden');
  showStep(1);
}

function closeDialog() {
  dialogOverlayEl.classList.add('hidden');
  isDialogOpen = false;
}

function updateStepIndicator(step, total) {
  stepIndicatorEl.textContent = '';
  for (let i = 1; i <= total; i++) {
    const dot = document.createElement('div');
    dot.className = 'step-dot' + (i === step ? ' active' : '');
    stepIndicatorEl.appendChild(dot);
  }
  btnBackEl.style.visibility = step > 1 ? 'visible' : 'hidden';
  btnNextEl.textContent = step === total ? '完了' : '次へ';
}

function showStep(step) {
  currentStep = step;
  const mode = currentDialogMode;
  const total = totalSteps(mode);
  updateStepIndicator(step, total);
  adviseBannerEl.classList.add('hidden');
  stepContentEl.textContent = '';

  if (mode === 'first') {
    renderFirstStep(step);
  } else {
    renderTimerStep(step, mode);
  }
}

function renderFirstStep(step) {
  if (step === 1) renderTaskInput('今回の作業内容を入力してください');
  else if (step === 2) renderLoadSelect();
  else if (step === 3) renderStateSelect();
}

function renderTimerStep(step, mode) {
  if (step === 1) {
    renderStateSelect();
    renderDialogChart();
  } else if (step === 2) {
    if (pendingAdvice) showAdviceBanner(pendingAdvice);
    renderTaskInput('現在の作業内容を確認・修正してください');
  } else if (step === 3) {
    renderLoadSelect();
  } else if (step === 4) {
    renderActionSelect(mode);
  }
}

function renderTaskInput(label) {
  const title = document.createElement('div');
  title.className = 'step-title';
  title.textContent = label;
  stepContentEl.appendChild(title);

  const textarea = document.createElement('textarea');
  textarea.className = 'task-input';
  textarea.id = 'input-task';
  textarea.value = dialogData.task || (lastState ? lastState.prev_task : '');
  stepContentEl.appendChild(textarea);

  const errEl = document.createElement('div');
  errEl.className = 'field-error hidden';
  errEl.id = 'task-error';
  errEl.textContent = '作業内容を入力してください';
  stepContentEl.appendChild(errEl);
}

function renderStateSelect() {
  const title = document.createElement('div');
  title.className = 'step-title';
  title.textContent = '現在の状態スコアを選択してください（1=かなり悪い 〜 5=かなりよい）';
  stepContentEl.appendChild(title);

  const group = document.createElement('div');
  group.className = 'score-group';
  for (let i = 1; i <= 5; i++) {
    const btn = document.createElement('button');
    btn.className = 'score-btn' + (dialogData.state === i ? ' selected' : '');
    btn.textContent = String(i);
    btn.addEventListener('click', () => {
      dialogData.state = i;
      group.querySelectorAll('.score-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      if (i <= 2) dialogBoxEl.classList.add('state-low');
      else dialogBoxEl.classList.remove('state-low');
      if (currentDialogMode !== 'first') updateDialogChart(lastLogsCache, i);
    });
    group.appendChild(btn);
  }
  stepContentEl.appendChild(group);
}

function renderLoadSelect() {
  const title = document.createElement('div');
  title.className = 'step-title';
  title.textContent = '作業負荷を選択してください（1=軽い 〜 5=重い）';
  stepContentEl.appendChild(title);

  const group = document.createElement('div');
  group.className = 'score-group';
  const defaultLoad = dialogData.load || (lastState ? lastState.prev_load : 3);
  for (let i = 1; i <= 5; i++) {
    const btn = document.createElement('button');
    btn.className = 'score-btn' + (defaultLoad === i ? ' selected' : '');
    btn.textContent = String(i);
    if (defaultLoad === i && dialogData.load == null) dialogData.load = i;
    btn.addEventListener('click', () => {
      dialogData.load = i;
      group.querySelectorAll('.score-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
    group.appendChild(btn);
  }
  stepContentEl.appendChild(group);
}

function renderActionSelect(mode) {
  const title = document.createElement('div');
  title.className = 'step-title';
  title.textContent = '次のアクションを選択してください';
  stepContentEl.appendChild(title);

  const restLabel = document.createElement('div');
  restLabel.className = 'action-label';
  restLabel.textContent = '休憩する';
  stepContentEl.appendChild(restLabel);

  const restGroup = document.createElement('div');
  restGroup.className = 'radio-group';
  const restOptions = mode === 'force' ? [15] : [5, 10, 15];
  for (const min of restOptions) {
    const btn = document.createElement('button');
    btn.className = 'radio-btn' + (dialogData.action === 'rest' && dialogData.break_min === min ? ' selected' : '');
    btn.textContent = `${min}分`;
    btn.addEventListener('click', () => {
      dialogData.action = 'rest';
      dialogData.break_min = min;
      dialogData.snooze_min = null;
      document.querySelectorAll('.radio-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
    restGroup.appendChild(btn);
  }
  stepContentEl.appendChild(restGroup);

  if (mode !== 'force') {
    const snoozeLabel = document.createElement('div');
    snoozeLabel.className = 'action-label';
    snoozeLabel.textContent = 'スヌーズ（後で）';
    stepContentEl.appendChild(snoozeLabel);

    const snoozeGroup = document.createElement('div');
    snoozeGroup.className = 'radio-group';
    for (const min of [15, 30, 45, 60]) {
      const btn = document.createElement('button');
      btn.className = 'radio-btn' + (dialogData.action === 'skip' && dialogData.snooze_min === min ? ' selected' : '');
      btn.textContent = `${min}分後`;
      btn.addEventListener('click', () => {
        dialogData.action = 'skip';
        dialogData.snooze_min = min;
        dialogData.break_min = null;
        document.querySelectorAll('.radio-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
      snoozeGroup.appendChild(btn);
    }
    stepContentEl.appendChild(snoozeGroup);
  }

  const errEl = document.createElement('div');
  errEl.className = 'field-error hidden';
  errEl.id = 'action-error';
  errEl.textContent = 'アクションを選択してください';
  stepContentEl.appendChild(errEl);
}

function renderDialogChart() {
  const box = document.createElement('div');
  box.className = 'dialog-chart-box';
  const canvas = document.getElementById('dialog-state-chart');
  if (canvas) box.appendChild(canvas);
  stepContentEl.appendChild(box);
}

function showAdviceBanner(advice) {
  adviseBannerEl.className = `advice-banner level-${advice.level}`;
  adviseBannerEl.textContent = advice.message;
  adviseBannerEl.classList.remove('hidden');
}

let lastLogsCache = [];

async function fetchAdvice(stateScore, load) {
  const res = await apiFetch('/advice', 'POST', { state_score: stateScore, load });
  pendingAdvice = res;
}

async function onNextClick() {
  const mode = currentDialogMode;
  const total = totalSteps(mode);

  // バリデーション
  if (mode === 'first') {
    if (currentStep === 1) {
      const taskEl = document.getElementById('input-task');
      const errEl = document.getElementById('task-error');
      if (!taskEl || !taskEl.value.trim()) {
        if (errEl) errEl.classList.remove('hidden');
        return;
      }
      dialogData.task = taskEl.value.trim();
    }
    if (currentStep === 2 && dialogData.load == null) return;
    if (currentStep === 3 && dialogData.state == null) return;
  } else {
    if (currentStep === 1 && dialogData.state == null) return;
    if (currentStep === 2) {
      const taskEl = document.getElementById('input-task');
      const errEl = document.getElementById('task-error');
      if (!taskEl || !taskEl.value.trim()) {
        if (errEl) errEl.classList.remove('hidden');
        return;
      }
      dialogData.task = taskEl.value.trim();
    }
    if (currentStep === 3 && dialogData.load == null) return;
    if (currentStep === 4) {
      const errEl = document.getElementById('action-error');
      if (dialogData.action == null) {
        if (errEl) errEl.classList.remove('hidden');
        return;
      }
    }
  }

  // Step1 完了後（timer/self/force）: アドバイス取得
  if (mode !== 'first' && currentStep === 1) {
    const prevLoad = lastState ? lastState.prev_load : 3;
    await fetchAdvice(dialogData.state, prevLoad);
  }

  if (currentStep === total) {
    await submitDialog();
  } else {
    showStep(currentStep + 1);
  }
}

function onBackClick() {
  if (currentStep > 1) showStep(currentStep - 1);
}

async function submitDialog() {
  const mode = currentDialogMode;
  const payload = {
    dialog_mode: mode,
    task: dialogData.task,
    load: dialogData.load,
    state: dialogData.state,
    action: mode === 'first' ? 'start' : dialogData.action,
    break_min: dialogData.break_min || null,
    snooze_min: dialogData.snooze_min || null,
  };
  await apiFetch('/record', 'POST', payload);
  closeDialog();
  const logsRes = await apiFetch('/logs');
  lastLogsCache = logsRes.logs;
  updateCharts(logsRes.logs);
  renderLogs(logsRes.logs);
}

// ── イベントリスナー ──────────────────────────────────────────
btnStartEl.addEventListener('click', async () => {
  await apiFetch('/start', 'POST');
  await poll();
});

btnPauseEl.addEventListener('click', async () => {
  await apiFetch('/pause', 'POST');
  await poll();
});

btnResetEl.addEventListener('click', async () => {
  await apiFetch('/reset', 'POST');
  await poll();
});

btnSelfEl.addEventListener('click', () => {
  if (isDialogOpen) return;
  openDialog('self');
});

btnConfigEl.addEventListener('click', async () => {
  const min = parseInt(inputDurationEl.value, 10);
  if (isNaN(min) || min < 1 || min > 120) {
    alert('1〜120分の範囲で入力してください');
    return;
  }
  await apiFetch('/config', 'POST', { duration_min: min });
  await poll();
});

btnNextEl.addEventListener('click', onNextClick);
btnBackEl.addEventListener('click', onBackClick);

// オーバーレイ背景クリックで閉じない（イベントをダイアログボックスで止める）
dialogBoxEl.addEventListener('click', e => e.stopPropagation());
dialogOverlayEl.addEventListener('click', e => e.stopPropagation());

// ── 起動 ─────────────────────────────────────────────────────
initCharts();
setInterval(poll, POLL_INTERVAL_MS);
poll();
