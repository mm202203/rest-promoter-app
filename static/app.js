'use strict';

// ── 定数 ──────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 1000;
const ACCUM_WARN_MIN = 135;
const ACCUM_DANGER_MIN = 180;
const WEEK_WINDOW = 20;

// ── 状態変数 ──────────────────────────────────────────────────
let isPolling = false;
let isDialogOpen = false;
let lastState = null;
let currentDialogMode = null;
let currentStep = 1;
let dialogData = {};
let pendingAdvice = null;
let dialogRoute = null;
let breakDuration = null;
let workDuration = null;
let selectedPeriod = 'today';
let weekSliderValue = 0;

// ── DOM 参照 ──────────────────────────────────────────────────
const connectionErrorEl = document.getElementById('connection-error');
const dangerWarningEl = document.getElementById('danger-warning');
const timerProgressEl = document.getElementById('timer-progress');
const timerTextEl = document.getElementById('timer-text');
const timerLabelEl = document.getElementById('timer-label');
const sessionElapsedEl = document.getElementById('session-elapsed');
const accumBarEl = document.getElementById('accum-bar');
const accumTextEl = document.getElementById('accum-text');
const btnStartEl = document.getElementById('btn-start');
const btnPauseEl = document.getElementById('btn-pause');
const btnResetEl = document.getElementById('btn-reset');
const btnSelfEl = document.getElementById('btn-self');
const btnEndEl = document.getElementById('btn-end');
const dialogOverlayEl = document.getElementById('dialog-overlay');
const dialogBoxEl = document.getElementById('dialog-box');
const stepIndicatorEl = document.getElementById('step-indicator');
const stepContentEl = document.getElementById('step-content');
const adviseBannerEl = document.getElementById('advice-banner');
const btnBackEl = document.getElementById('btn-back');
const btnNextEl = document.getElementById('btn-next');
const statsWorkEl = document.getElementById('stats-work');
const statsBreakEl = document.getElementById('stats-break');
const btnReportEl = document.getElementById('btn-report-small');
const weekSliderEl = document.getElementById('week-slider');
const logHeaderEl = document.getElementById('log-header');
const logCollapseEl = document.getElementById('log-collapse');
const logChevronEl = document.getElementById('log-chevron');

// ── Chart.js グラフ ───────────────────────────────────────────
let stateChart = null;
let dialogStateChart = null;
let dialogChartCanvas = null; // DOM から切り離されても参照を保持するため変数で管理

let breakFlagsCache = [];
let sessionMinsCache = [];

const breakLinePlugin = {
  id: 'breakLines',
  beforeDatasetsDraw(chart) {
    const { ctx, scales } = chart;
    breakFlagsCache.forEach((isBreak, i) => {
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

function initCharts() {
  const stateCtx = document.getElementById('state-chart').getContext('2d');
  stateChart = new Chart(stateCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: '状態スコア',
        data: [],
        pointBackgroundColor: [],
        pointRadius: [],
        borderColor: '#d0d0d0',
        tension: 0.3,
        fill: false,
      }],
    },
    options: {
      scales: { y: { min: 1, max: 5, ticks: { stepSize: 1 } } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(ctx) {
              const y = ctx.parsed.y;
              const sessionMin = sessionMinsCache[ctx.dataIndex] ?? 0;
              return `状態: ${y} / 作業時間: ${sessionMin}分`;
            },
          },
        },
      },
      animation: false,
    },
    plugins: [breakLinePlugin],
  });

  dialogChartCanvas = document.getElementById('dialog-state-chart');
  if (dialogChartCanvas) {
    dialogStateChart = new Chart(dialogChartCanvas.getContext('2d'), {
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

function loadColor(load) {
  if (load >= 4) return '#D85A30';
  if (load === 3) return '#888780';
  return '#4A90D9';
}

function scoreColor(score) {
  if (score <= 2) return '#f44336';
  if (score === 3) return '#9e9e9e';
  return '#4caf50';
}

function getPeriodDate(period) {
  const n = { today: 0, yesterday: 1, dayBefore: 2 }[period] ?? 0;
  return new Date(Date.now() + (9 - n * 24) * 3600 * 1000).toISOString().slice(0, 10);
}

function getLast7Dates() {
  return Array.from({ length: 7 }, (_, i) =>
    new Date(Date.now() + (9 - i * 24) * 3600 * 1000).toISOString().slice(0, 10)
  );
}

function updateCharts(logs) {
  if (!stateChart) return;
  try {
    const today = getTodayJST();
    const todayLogs = logs.filter(l => l.timestamp && l.timestamp.startsWith(today));
    const workLogs = logs.filter(l =>
      l.timestamp && (l.action === 'rest' || l.action === 'skip')
    );

    let chartLogs;
    if (selectedPeriod === 'week') {
      const dates = getLast7Dates();
      const allWeekLogs = workLogs.filter(l => dates.some(d => l.timestamp.startsWith(d)));
      const maxSlider = Math.max(0, allWeekLogs.length - WEEK_WINDOW);
      weekSliderEl.max = maxSlider;
      weekSliderValue = Math.min(weekSliderValue, maxSlider);
      weekSliderEl.value = weekSliderValue;
      if (allWeekLogs.length > WEEK_WINDOW) {
        weekSliderEl.classList.remove('hidden');
      } else {
        weekSliderEl.classList.add('hidden');
      }
      chartLogs = allWeekLogs.slice(weekSliderValue, weekSliderValue + WEEK_WINDOW);
    } else {
      const targetDate = getPeriodDate(selectedPeriod);
      chartLogs = workLogs.filter(l => l.timestamp.startsWith(targetDate));
      weekSliderEl.classList.add('hidden');
    }

    stateChart.data.labels = chartLogs.map(l =>
      selectedPeriod === 'week'
        ? l.timestamp.slice(5, 10).replace('-', '/') + ' ' + l.timestamp.slice(11, 16)
        : l.timestamp.slice(11, 16)
    );
    stateChart.data.datasets[0].data = chartLogs.map(l => Number(l.state));
    sessionMinsCache = chartLogs.map(l => Number(l.session_min) || 0);
    stateChart.data.datasets[0].pointBackgroundColor = chartLogs.map(l => loadColor(Number(l.load) || 3));
    stateChart.data.datasets[0].pointRadius = chartLogs.map(l => {
      const m = Number(l.session_min) || 0;
      return 4 + Math.min(m, 60) / 60 * 8;
    });
    breakFlagsCache = chartLogs.map(l => l.action === 'rest');
    stateChart.update();

    updateDailyStats(todayLogs);
  } catch (e) {
    console.error('updateCharts error:', e);
  }
}

function updateDailyStats(todayLogs) {
  const completedWorkMin = todayLogs
    .filter(l => l.action === 'rest' || l.action === 'skip')
    .reduce((sum, l) => sum + (Number(l.session_min) || 0), 0);
  const currentSessionMin = lastState ? Math.floor(lastState.session_elapsed / 60) : 0;
  statsWorkEl.textContent = `${completedWorkMin + currentSessionMin}分`;

  const restLogs = todayLogs.filter(l => l.action === 'rest');
  const completedRestLogs = (lastState && lastState.is_breaking)
    ? restLogs.slice(0, -1)
    : restLogs;
  const completedBreakMin = completedRestLogs.reduce((sum, l) => sum + (Number(l.break_min) || 0), 0);
  const currentBreakMin = lastState ? Math.floor((lastState.break_elapsed || 0) / 60) : 0;
  statsBreakEl.textContent = `${completedBreakMin + currentBreakMin}分`;
}

function updateDialogChart(logs, previewScore) {
  if (!dialogStateChart) return;
  const today = getTodayJST();
  const base = logs.filter(l => l.timestamp && l.timestamp.startsWith(today)).slice(-29);
  const allPoints = previewScore != null
    ? [...base, { timestamp: '今回', state: previewScore }]
    : base.slice(-30);
  dialogStateChart.data.labels = allPoints.map((l, i) => i === allPoints.length - 1 && previewScore != null ? '今回' : l.timestamp.slice(11, 16));
  dialogStateChart.data.datasets[0].data = allPoints.map(l => l.state);
  dialogStateChart.data.datasets[0].pointBackgroundColor = allPoints.map(l => scoreColor(l.state));
  dialogStateChart.update();
}

// ── 音声通知 ──────────────────────────────────────────────────
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

// ── ユーティリティ ────────────────────────────────────────────
function formatMmss(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function getTodayJST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
function updateTimerSvg(state, prevState) {
  const CIRCUMFERENCE = 552.92;

  if (state.is_breaking && (!prevState || !prevState.is_breaking)) {
    breakDuration = state.remaining;
  }
  if (!state.is_breaking) {
    breakDuration = null;
  }

  if (!state.is_breaking && state.is_running && (!prevState || !prevState.is_running)) {
    workDuration = state.remaining;
  }

  const total = state.is_breaking
    ? (breakDuration ?? state.remaining)
    : (workDuration ?? state.timer_duration);
  const ratio = total > 0 ? state.remaining / total : 1;
  const offset = CIRCUMFERENCE * (1 - ratio);

  timerProgressEl.setAttribute('stroke-dashoffset', offset.toFixed(2));
  timerProgressEl.setAttribute('stroke', state.is_breaking ? '#4caf50' : '#1976d2');

  if (state.is_breaking) {
    timerTextEl.textContent = formatMmss(state.remaining);
    timerTextEl.setAttribute('font-size', '24');
    timerTextEl.setAttribute('fill', '#4caf50');
    timerLabelEl.setAttribute('visibility', 'visible');
  } else {
    timerTextEl.textContent = formatMmss(state.remaining);
    timerTextEl.setAttribute('font-size', '38');
    timerTextEl.setAttribute('fill', '#212121');
    timerLabelEl.setAttribute('visibility', 'hidden');
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
    dangerWarningEl.classList.remove('hidden');
  } else {
    dangerWarningEl.classList.add('hidden');
    if (mins >= ACCUM_WARN_MIN) accumBarEl.classList.add('accum-warn');
  }
}

function updateButtonStates(state) {
  const breaking = state.is_breaking;
  btnStartEl.disabled = breaking || state.is_running;
  btnPauseEl.disabled = breaking || !state.is_running;
  btnResetEl.disabled = breaking;
  btnEndEl.disabled = breaking;
  btnSelfEl.disabled = isDialogOpen; // 休憩中も自己申告可能
}

function updatePresetHighlight(state) {
  const currentMin = Math.round(state.timer_duration / 60);
  document.querySelectorAll('.preset-btn').forEach(btn => {
    const isActive = parseInt(btn.dataset.min, 10) === currentMin;
    btn.classList.toggle('active', isActive);
    btn.disabled = state.is_breaking;
  });
}

function updateUI(state, prevState) {
  updateTimerSvg(state, prevState);
  updateAccumBar(state);
  updateButtonStates(state);
  updatePresetHighlight(state);
}

// ── ポーリング ────────────────────────────────────────────────
async function poll() {
  if (isPolling) return;
  isPolling = true;
  try {
    const state = await apiFetch('/state');
    hideConnectionError();
    const prevState = lastState;
    lastState = state;
    updateUI(state, prevState);
    if (state.dialog_triggered && !isDialogOpen) {
      const wasBreaking = prevState && prevState.is_breaking;
      await apiFetch('/dialog/ack', 'POST');
      const msg = state.dialog_mode === 'first'
        ? 'おはようございます。本日の状態を教えてください。'
        : wasBreaking
          ? '休憩が終わりました。今の状態を教えてください。'
          : '作業時間が終わりました。今の状態を教えてください。';
      speak(msg);
      openDialog(state.dialog_mode);
    }
    const logsRes = await apiFetch('/logs');
    lastLogsCache = logsRes.logs;
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
    ts.textContent = l.timestamp.replace('T', ' ').slice(5, 16);

    const task = document.createElement('span');
    task.className = 'log-task';
    task.textContent = l.action === 'rest' ? '' : l.task;

    const action = document.createElement('span');
    action.className = 'log-action';
    const actionMap = { start: '開始', rest: '休憩', skip: '継続作業' };
    action.textContent = actionMap[l.action] || l.action;

    item.appendChild(ts);
    item.appendChild(task);
    item.appendChild(action);
    logListEl.appendChild(item);
  }
}

const logListEl = document.getElementById('log-list');

// ── ダイアログ ────────────────────────────────────────────────
function getStepCount(mode, route) {
  if (mode === 'first') return 4;
  if (mode === 'force') return 2;
  if (route === 'rest') return 3;
  if (route === 'continue') return 5;
  return 5;
}

function openDialog(mode) {
  currentDialogMode = mode;
  currentStep = 1;
  isDialogOpen = true;
  pendingAdvice = null;
  dialogRoute = null;
  dialogData = { state: null, task: '', load: null, action: null, break_min: null, snooze_min: null, work_min: null };
  dialogBoxEl.classList.remove('state-low');
  dialogOverlayEl.classList.remove('hidden');
  showStep(1);
}

function closeDialog() {
  dialogOverlayEl.classList.add('hidden');
  isDialogOpen = false;
  dialogRoute = null;
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

function renderFirstStep(step) {
  if (step === 1) renderStateSelect();
  else if (step === 2) renderTaskInput('今回の作業内容を入力してください');
  else if (step === 3) renderLoadSelect();
  else if (step === 4) renderWorkDurationSelect();
}

function renderWorkDurationSelect() {
  const title = document.createElement('div');
  title.className = 'step-title';
  title.textContent = '最初の作業時間を選択してください';
  stepContentEl.appendChild(title);

  const group = document.createElement('div');
  group.className = 'radio-group';
  const defaultMin = lastState ? Math.round(lastState.timer_duration / 60) : 60;
  for (const min of [15, 30, 45, 60, 75, 90]) {
    const btn = document.createElement('button');
    const isDefault = min === defaultMin;
    btn.className = 'radio-btn' + (isDefault ? ' selected' : '');
    btn.textContent = `${min}分`;
    if (isDefault && dialogData.work_min == null) dialogData.work_min = min;
    btn.addEventListener('click', () => {
      dialogData.work_min = min;
      group.querySelectorAll('.radio-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
    group.appendChild(btn);
  }
  stepContentEl.appendChild(group);
}

function renderTimerStep(step, mode) {
  if (mode === 'force') {
    if (step === 1) {
      renderStateSelect();
      renderDialogChart();
      updateDialogChart(lastLogsCache, null);
    } else if (step === 2) renderBreakSelect(true);
    return;
  }
  // timer / self
  if (step === 1) {
    renderStateSelect();
    renderDialogChart();
    updateDialogChart(lastLogsCache, null);
  } else if (step === 2) {
    renderRouteChoice();
  } else if (dialogRoute === 'rest') {
    if (step === 3) renderBreakSelect(false);
  } else {
    // continue route
    if (step === 3) {
      if (pendingAdvice) showAdviceBanner(pendingAdvice);
      renderTaskInput('現在の作業内容を確認・修正してください');
    } else if (step === 4) {
      renderLoadSelect();
    } else if (step === 5) {
      renderSnoozeSelect();
    }
  }
}

function renderRouteChoice() {
  const title = document.createElement('div');
  title.className = 'step-title';
  title.textContent = '次のアクションを選択してください';
  stepContentEl.appendChild(title);

  for (const [route, label] of [['rest', '休憩する'], ['continue', '作業を続ける']]) {
    const btn = document.createElement('button');
    btn.className = 'route-btn' + (dialogRoute === route ? ' selected' : '');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      dialogRoute = route;
      stepContentEl.querySelectorAll('.route-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      updateStepIndicator(currentStep, getStepCount(currentDialogMode, dialogRoute));
    });
    stepContentEl.appendChild(btn);
  }
}

function renderBreakSelect(forceOnly) {
  const title = document.createElement('div');
  title.className = 'step-title';
  title.textContent = '休憩時間を選択してください';
  stepContentEl.appendChild(title);

  const group = document.createElement('div');
  group.className = 'radio-group';
  const options = forceOnly ? [15] : [5, 10, 15, 60];
  for (const min of options) {
    const btn = document.createElement('button');
    btn.className = 'radio-btn' + (dialogData.break_min === min ? ' selected' : '');
    btn.textContent = `${min}分`;
    btn.addEventListener('click', () => {
      dialogData.action = 'rest';
      dialogData.break_min = min;
      group.querySelectorAll('.radio-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
    group.appendChild(btn);
  }
  stepContentEl.appendChild(group);
}

function renderSnoozeSelect() {
  const title = document.createElement('div');
  title.className = 'step-title';
  title.textContent = '継続作業時間を選択してください';
  stepContentEl.appendChild(title);

  const group = document.createElement('div');
  group.className = 'radio-group';
  for (const min of [15, 30, 45, 60, 75, 90]) {
    const btn = document.createElement('button');
    btn.className = 'radio-btn' + (dialogData.snooze_min === min ? ' selected' : '');
    btn.textContent = `${min}分`;
    btn.addEventListener('click', () => {
      dialogData.action = 'skip';
      dialogData.snooze_min = min;
      group.querySelectorAll('.radio-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
    group.appendChild(btn);
  }
  stepContentEl.appendChild(group);
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

function renderDialogChart() {
  const box = document.createElement('div');
  box.className = 'dialog-chart-box';
  if (dialogChartCanvas) {
    dialogChartCanvas.style.display = '';
    box.appendChild(dialogChartCanvas); // 変数参照で再アタッチ（getElementById は切り離し後に見つけられない）
  }
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
  const total = getStepCount(mode, dialogRoute);

  // バリデーション
  if (mode === 'first') {
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
    if (currentStep === 4 && dialogData.work_min == null) return;
  } else if (mode === 'force') {
    if (currentStep === 1 && dialogData.state == null) return;
    if (currentStep === 2 && dialogData.break_min == null) return;
  } else {
    // timer / self
    if (currentStep === 1 && dialogData.state == null) return;
    if (currentStep === 2 && dialogRoute == null) return;
    if (dialogRoute === 'rest') {
      if (currentStep === 3 && dialogData.break_min == null) return;
    } else {
      // continue
      if (currentStep === 3) {
        const taskEl = document.getElementById('input-task');
        const errEl = document.getElementById('task-error');
        if (!taskEl || !taskEl.value.trim()) {
          if (errEl) errEl.classList.remove('hidden');
          return;
        }
        dialogData.task = taskEl.value.trim();
      }
      if (currentStep === 4 && dialogData.load == null) return;
      if (currentStep === 5 && dialogData.snooze_min == null) return;
    }
  }

  // Step1 完了後（timer/self）: アドバイス取得
  if ((mode === 'timer' || mode === 'self') && currentStep === 1) {
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
  let task, load, action, break_min, snooze_min;

  if (mode === 'first') {
    task = dialogData.task;
    load = dialogData.load;
    action = 'start';
  } else if (dialogRoute === 'rest' || mode === 'force') {
    task = '';
    load = lastState ? lastState.prev_load : 3;
    action = 'rest';
    break_min = dialogData.break_min;
  } else {
    task = dialogData.task;
    load = dialogData.load;
    action = 'skip';
    snooze_min = dialogData.snooze_min;
  }

  if (mode === 'first' && dialogData.work_min) {
    await apiFetch('/config', 'POST', { duration_min: dialogData.work_min });
  }
  const payload = {
    dialog_mode: mode,
    task,
    load,
    state: dialogData.state,
    action,
    break_min: break_min || null,
    snooze_min: snooze_min || null,
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

btnEndEl.addEventListener('click', async () => {
  await apiFetch('/reset', 'POST');
  await poll();
});

btnSelfEl.addEventListener('click', () => {
  if (isDialogOpen) return;
  openDialog('self');
});

btnReportEl.addEventListener('click', async (e) => {
  e.stopPropagation();
  try {
    const res = await apiFetch('/report', 'POST');
    const blob = new Blob([res.content], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = res.filename;
    a.click();
  } catch (err) {
    alert(`日報の出力に失敗しました。サーバーを再起動してから再度お試しください。\n${err}`);
  }
});

document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const min = parseInt(btn.dataset.min, 10);
    await apiFetch('/config', 'POST', { duration_min: min });
    await poll();
  });
});

document.querySelectorAll('.period-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedPeriod = btn.dataset.period;
    if (selectedPeriod === 'week') weekSliderValue = Number.MAX_SAFE_INTEGER;
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateCharts(lastLogsCache);
  });
});

weekSliderEl.addEventListener('input', () => {
  weekSliderValue = Number(weekSliderEl.value);
  updateCharts(lastLogsCache);
});

logHeaderEl.addEventListener('click', () => {
  const isOpen = logCollapseEl.classList.toggle('open');
  logChevronEl.classList.toggle('open', isOpen);
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
