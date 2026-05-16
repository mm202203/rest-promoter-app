'use strict';

// ── 定数 ──────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 1000;
const ACCUM_DANGER_MIN = 180;

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

const WEEK_TIME_WINDOW_MIN = 480;

let bandDataCache = [];
let sessionMinsCache = [];

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

function initCharts() {
  const stateCtx = document.getElementById('state-chart').getContext('2d');
  stateChart = new Chart(stateCtx, {
    type: 'line',
    data: {
      datasets: [{
        label: '状態スコア',
        data: [],
        pointBackgroundColor: '#185FA5',
        pointRadius: [],
        borderColor: '#185FA5',
        tension: 0.3,
        fill: false,
        spanGaps: false,
      }],
    },
    options: {
      scales: {
        x: {
          type: 'time',
          time: { displayFormats: { minute: 'HH:mm', hour: 'HH:mm' } },
        },
        y: { min: 1, max: 5, ticks: { stepSize: 1 } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => item.raw !== null && !item.raw?._ghost,
          callbacks: {
            title: (items) => {
              const raw = items[0].raw;
              return selectedPeriod === 'week'
                ? String(raw.x).slice(5, 10).replace('-', '/') + ' ' + String(raw.x).slice(11, 16)
                : String(raw.x).slice(11, 16);
            },
            label: (ctx) => {
              const sessionMin = sessionMinsCache[ctx.dataIndex];
              return sessionMin != null ? `状態: ${ctx.raw.y} / 作業時間: ${sessionMin}分` : null;
            },
          },
        },
      },
      animation: false,
    },
    plugins: [backgroundBandPlugin],
  });

  dialogChartCanvas = document.getElementById('dialog-state-chart');
  if (dialogChartCanvas) {
    dialogStateChart = new Chart(dialogChartCanvas.getContext('2d'), {
      type: 'line',
      data: {
        datasets: [{
          label: '状態スコア',
          data: [],
          pointBackgroundColor: [],
          borderColor: '#185FA5',
          tension: 0.3,
          fill: false,
        }],
      },
      options: {
        scales: {
          x: {
            type: 'time',
            time: { displayFormats: { minute: 'HH:mm', hour: 'HH:mm' } },
          },
          y: { min: 1, max: 5, ticks: { stepSize: 1 } },
        },
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
  if (score <= 2) return '#D85A30';
  if (score === 3) return '#888780';
  return '#185FA5';
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

function buildBandData(logs) {
  bandDataCache = [];
  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    if (!log.session_start) continue;
    if (log.action === 'rest' || log.action === 'skip') {
      bandDataCache.push({
        start: new Date(log.session_start),
        end:   new Date(log.timestamp),
        type:  'work',
        load:  Number(log.load) || 3,
      });
    }
    if (log.action === 'rest') {
      const restStart = new Date(log.timestamp);
      // 次の session_start まで緑帯を延長（ダイアログ操作の余白も休憩として扱う）
      const nextWithSession = logs.slice(i + 1).find(l => l.session_start);
      const restEnd = nextWithSession
        ? new Date(nextWithSession.session_start)
        : new Date(restStart.getTime() + Number(log.break_min || 0) * 60000);
      bandDataCache.push({ start: restStart, end: restEnd, type: 'rest', load: null });
    }
  }
}

// skip ログから chart.js dataset.data と sessionMinsCache を構築する
// - 日付をまたぐ場合は null でラインをブレーク
// - 各日の末尾 skip の後に snooze_min 分のゴーストポイントを追加（線の延長）
function buildDatasetPoints(skipLogs) {
  const data = [];
  const mins = [];

  for (let i = 0; i < skipLogs.length; i++) {
    const log     = skipLogs[i];
    const prevLog = skipLogs[i - 1];
    const nextLog = skipLogs[i + 1];

    if (prevLog && prevLog.timestamp.slice(0, 10) !== log.timestamp.slice(0, 10)) {
      data.push(null);
      mins.push(null);
    }

    data.push({ x: log.timestamp, y: Number(log.state) });
    mins.push(Number(log.session_min) || 0);

    const isDayEnd = !nextLog || nextLog.timestamp.slice(0, 10) !== log.timestamp.slice(0, 10);
    if (isDayEnd && log.snooze_min) {
      const ghostMs = new Date(log.timestamp).getTime() + Number(log.snooze_min) * 60000;
      data.push({ x: new Date(ghostMs).toISOString(), y: Number(log.state), _ghost: true });
      mins.push(null);
    }
  }

  return { data, mins };
}

function updateCharts(logs) {
  if (!stateChart) return;
  try {
    const today = getTodayJST();
    const todayLogs = logs.filter(l => l.timestamp && l.timestamp.startsWith(today));

    let skipLogs, allPeriodLogs, xMin, xMax;

    if (selectedPeriod === 'week') {
      const dates = getLast7Dates();
      allPeriodLogs = logs.filter(l => l.timestamp && dates.some(d => l.timestamp.startsWith(d)));
      const allSkipLogs = allPeriodLogs.filter(l => l.action === 'skip');

      if (allPeriodLogs.length > 0) {
        const weekStartMs = new Date(allPeriodLogs[0].timestamp).getTime();
        const weekEndMs   = new Date(allPeriodLogs[allPeriodLogs.length - 1].timestamp).getTime();
        const totalMin    = (weekEndMs - weekStartMs) / 60000;
        const maxOffset   = Math.max(0, Math.ceil(totalMin - WEEK_TIME_WINDOW_MIN));
        weekSliderEl.max  = maxOffset;
        weekSliderEl.step = 30;
        weekSliderValue   = Math.min(weekSliderValue, maxOffset);
        weekSliderEl.value = weekSliderValue;
        weekSliderEl.classList.toggle('hidden', maxOffset === 0);

        const winStartMs = weekStartMs + weekSliderValue * 60000;
        const winEndMs   = winStartMs + WEEK_TIME_WINDOW_MIN * 60000;
        xMin = winStartMs;
        xMax = winEndMs;
        // ms で比較（文字列比較はJST/UTCのズレが生じるため）
        skipLogs = allSkipLogs.filter(l => {
          const ts = new Date(l.timestamp).getTime();
          return ts >= winStartMs && ts <= winEndMs;
        });
      } else {
        weekSliderEl.classList.add('hidden');
        skipLogs = [];
        xMin = undefined;
        xMax = undefined;
      }

      stateChart.options.scales.x.time.unit = 'hour';
      stateChart.options.scales.x.time.displayFormats = { minute: 'MM/dd HH:mm', hour: 'MM/dd HH:mm' };
    } else {
      const targetDate = getPeriodDate(selectedPeriod);
      allPeriodLogs = logs.filter(l => l.timestamp && l.timestamp.startsWith(targetDate));
      skipLogs = allPeriodLogs.filter(l => l.action === 'skip');
      weekSliderEl.classList.add('hidden');

      if (skipLogs.length === 0) {
        xMin = undefined;
        xMax = undefined;
      } else {
        const firstMs = new Date(skipLogs[0].timestamp).getTime();
        const lastLog = skipLogs[skipLogs.length - 1];
        const lastMs  = new Date(lastLog.timestamp).getTime();
        // ゴーストポイント分まで X 軸を広げる
        const ghostMs = lastLog.snooze_min ? lastMs + Number(lastLog.snooze_min) * 60000 : lastMs;
        xMin = skipLogs.length === 1 ? firstMs - 30 * 60000 : firstMs;
        xMax = skipLogs.length === 1 ? firstMs + 30 * 60000 : ghostMs;
      }

      stateChart.options.scales.x.time.unit = 'minute';
      stateChart.options.scales.x.time.displayFormats = { minute: 'HH:mm', hour: 'HH:mm' };
    }

    stateChart.options.scales.x.min = xMin;
    stateChart.options.scales.x.max = xMax;

    buildBandData(allPeriodLogs);

    const { data: dsData, mins: dsMins } = buildDatasetPoints(skipLogs);
    sessionMinsCache = dsMins;
    stateChart.data.datasets[0].data = dsData;
    stateChart.data.datasets[0].pointRadius = dsData.map(p => (p && !p._ghost) ? 5 : 0);
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
  // 実際の休憩時間 = rest.timestamp から次の session_start まで（ダイアログ操作時間を含む）
  const completedBreakMin = completedRestLogs.reduce((sum, restLog) => {
    const nextWithSession = todayLogs.find(l => l.timestamp > restLog.timestamp && l.session_start);
    if (nextWithSession) {
      return sum + (new Date(nextWithSession.session_start).getTime() - new Date(restLog.timestamp).getTime()) / 60000;
    }
    return sum + (Number(restLog.break_min) || 0);
  }, 0);
  const currentBreakMin = lastState ? Math.floor((lastState.break_elapsed || 0) / 60) : 0;
  statsBreakEl.textContent = `${Math.round(completedBreakMin + currentBreakMin)}分`;
}

function updateDialogChart(logs, previewScore) {
  if (!dialogStateChart) return;
  const today = getTodayJST();
  const skipLogs = logs.filter(l => l.timestamp && l.timestamp.startsWith(today) && l.action === 'skip');
  const prevLoad = lastState ? lastState.prev_load : 3;

  const points = previewScore != null
    ? [...skipLogs, { timestamp: new Date().toISOString(), state: previewScore, load: prevLoad, _preview: true }]
    : skipLogs;

  let xMin, xMax;
  if (points.length === 0) {
    xMin = undefined;
    xMax = undefined;
  } else if (points.length === 1) {
    xMin = new Date(new Date(points[0].timestamp).getTime() - 30 * 60000).toISOString();
    xMax = new Date(new Date(points[0].timestamp).getTime() + 30 * 60000).toISOString();
  } else {
    xMin = points[0].timestamp;
    xMax = points[points.length - 1].timestamp;
  }

  dialogStateChart.options.scales.x.min = xMin;
  dialogStateChart.options.scales.x.max = xMax;
  dialogStateChart.data.datasets[0].data = points.map(l => ({ x: l.timestamp, y: Number(l.state) }));
  dialogStateChart.data.datasets[0].pointBackgroundColor = points.map(l => loadColor(Number(l.load) || prevLoad));
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
  timerProgressEl.setAttribute('stroke', state.is_breaking ? '#3B6D11' : '#185FA5');

  if (state.is_breaking) {
    timerTextEl.textContent = formatMmss(state.remaining);
    timerTextEl.setAttribute('font-size', '24');
    timerTextEl.setAttribute('fill', '#3B6D11');
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
  accumBarEl.classList.remove('accum-danger');
  if (mins >= ACCUM_DANGER_MIN) {
    accumBarEl.classList.add('accum-danger');
    dangerWarningEl.classList.remove('hidden');
  } else {
    dangerWarningEl.classList.add('hidden');
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
