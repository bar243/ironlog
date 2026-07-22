/* ============================================================================
   IRONLOG — app logic
   1) Paste your Apps Script Web App URL below (ends in /exec).
   ========================================================================== */
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbxxMc6lEPuDPV48rQwyO2brhQuA2rmgQprsMULqOF9n_Ap_l4kl0DbuBOYKDBQ9jeI/exec'
,
  DEFAULT_REST_SECONDS: 90,
  REST_STEP: 30,
};

/* ------------------------------ state ------------------------------ */
const state = {
  exercises: [],       // { id, name, type }
  logs: [],            // { logId, date, exerciseId, setNumber, reps, weightKg, timeSec, volume }
  selectedId: null,
  queue: JSON.parse(localStorage.getItem('ironlog.queue') || '[]'),
};

const $ = (id) => document.getElementById(id);
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmt = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });

/* ------------------------------ API ------------------------------ */
async function apiGet(action) {
  const res = await fetch(`${CONFIG.API_URL}?action=${action}`, { redirect: 'follow' });
  return res.json();
}
// text/plain keeps the request "simple" so Apps Script needs no CORS preflight.
async function apiPost(payload) {
  const res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

function setSync(mode) {
  const el = $('syncState');
  el.className = 'sync' + (mode === 'ok' ? '' : ' ' + mode);
  el.title = { ok: 'Synced', offline: 'Offline — changes queued', error: 'Sync error' }[mode] || '';
}

async function bootstrap() {
  // Show cached data immediately, then refresh from the sheet.
  const cached = localStorage.getItem('ironlog.cache');
  if (cached) {
    const c = JSON.parse(cached);
    state.exercises = c.exercises || [];
    state.logs = c.logs || [];
    renderAll();
  }
  try {
    await flushQueue();
    const data = await apiGet('bootstrap');
    if (!data.ok) throw new Error(data.error);
    state.exercises = data.exercises;
    state.logs = data.logs;
    localStorage.setItem('ironlog.cache', JSON.stringify({ exercises: data.exercises, logs: data.logs }));
    setSync('ok');
    renderAll();
  } catch (e) {
    console.warn('Bootstrap failed:', e);
    setSync(navigator.onLine ? 'error' : 'offline');
  }
}

async function flushQueue() {
  while (state.queue.length) {
    const next = state.queue[0];
    const res = await apiPost(next);          // throws if offline -> caught by caller
    if (!res.ok) throw new Error(res.error);
    state.queue.shift();
    localStorage.setItem('ironlog.queue', JSON.stringify(state.queue));
  }
}

/* --------------------------- derived data --------------------------- */
const logsFor = (exId) => state.logs.filter((l) => l.exerciseId === exId);
const exercise = (exId) => state.exercises.find((e) => e.id === exId);
const isTimed = (exId) => (exercise(exId) || {}).type === 'timed';

function sessionsFor(exId) {
  // Unique dates for this exercise, newest first.
  return [...new Set(logsFor(exId).map((l) => l.date))].sort().reverse();
}
function lastSessionInfo(exId, beforeDate) {
  const dates = sessionsFor(exId).filter((d) => !beforeDate || d < beforeDate);
  if (!dates.length) return null;
  const date = dates[0];
  const sets = logsFor(exId).filter((l) => l.date === date);
  if (isTimed(exId)) {
    const best = Math.max(...sets.map((s) => s.timeSec));
    return { date, text: `${best}s best · ${sets.length} set${sets.length > 1 ? 's' : ''}` };
  }
  const top = sets.reduce((a, b) => (b.weightKg > a.weightKg ? b : a));
  return { date, text: `${fmt(top.weightKg)}kg × ${top.reps}` };
}
function allTimePB(exId) {
  const rows = logsFor(exId);
  if (!rows.length) return null;
  if (isTimed(exId)) return `${Math.max(...rows.map((r) => r.timeSec))}s`;
  const top = rows.reduce((a, b) => (b.weightKg > a.weightKg ? b : a));
  return `${fmt(top.weightKg)}kg × ${top.reps}`;
}
const volumeOn = (exId, date) =>
  logsFor(exId).filter((l) => l.date === date).reduce((s, l) => s + l.volume, 0);
const timeOn = (exId, date) =>
  logsFor(exId).filter((l) => l.date === date).reduce((s, l) => s + l.timeSec, 0);

/* --------------------------- exercise picker --------------------------- */
function renderExerciseSelect() {
  const sel = $('exerciseSelect');
  sel.innerHTML = '<option value="">Select an exercise…</option>' +
    state.exercises
      .slice().sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => `<option value="${e.id}">${e.name}${e.type === 'timed' ? ' ⏱' : ''}</option>`)
      .join('');
  if (state.selectedId) sel.value = state.selectedId;
}

function renderHistory() {
  const panel = $('historyPanel');
  if (!state.selectedId) { panel.hidden = true; return; }
  panel.hidden = false;
  const last = lastSessionInfo(state.selectedId);
  $('histLastDate').textContent = last ? last.date : 'No history yet';
  $('histLastDetail').textContent = last ? last.text : '—';
  $('histPB').textContent = allTimePB(state.selectedId) || '—';
}

/* ------------------------------ set rows ------------------------------ */
function setRowHTML(i, timed) {
  if (timed) {
    return `<div class="set-row timed">
      <span class="set-num">${i}</span>
      <div class="field"><span class="tag">Time (sec)</span>
        <input type="number" class="in-time" inputmode="numeric" min="0" step="1" placeholder="0"></div>
      <button class="set-del" type="button" aria-label="Remove set">×</button>
    </div>`;
  }
  return `<div class="set-row">
    <span class="set-num">${i}</span>
    <div class="field"><span class="tag">Reps</span>
      <input type="number" class="in-reps" inputmode="numeric" min="0" step="1" placeholder="0"></div>
    <div class="field"><span class="tag">Kg (− ok)</span>
      <input type="number" class="in-weight" inputmode="decimal" step="0.5" placeholder="0"></div>
    <button class="set-del" type="button" aria-label="Remove set">×</button>
  </div>`;
}

function addSetRow() {
  const wrap = $('setRows');
  const timed = isTimed(state.selectedId);
  wrap.insertAdjacentHTML('beforeend', setRowHTML(wrap.children.length + 1, timed));
  const row = wrap.lastElementChild;
  // Copy values from the previous set for fast entry.
  const prev = row.previousElementSibling;
  if (prev) row.querySelectorAll('input').forEach((inp, i) => {
    inp.value = prev.querySelectorAll('input')[i].value;
  });
  row.querySelector('.set-del').addEventListener('click', () => { row.remove(); renumberSets(); });
}
function renumberSets() {
  [...$('setRows').children].forEach((r, i) => (r.querySelector('.set-num').textContent = i + 1));
}
function resetSetRows() {
  $('setRows').innerHTML = '';
  $('setsLabel').textContent = isTimed(state.selectedId) ? 'Holds' : 'Sets';
  if (state.selectedId) { addSetRow(); addSetRow(); addSetRow(); }
}

/* ------------------------------ logging ------------------------------ */
async function logWorkout() {
  if (!state.selectedId) return showMsg('Pick an exercise first.', 'err');
  const timed = isTimed(state.selectedId);
  const sets = [...$('setRows').children].map((row) => {
    if (timed) return { reps: 0, weightKg: 0, timeSec: Number(row.querySelector('.in-time').value || 0) };
    return {
      reps: Number(row.querySelector('.in-reps').value || 0),
      weightKg: Number(row.querySelector('.in-weight').value || 0),
      timeSec: 0,
    };
  }).filter((s) => (timed ? s.timeSec > 0 : s.reps > 0));

  if (!sets.length) return showMsg(timed ? 'Enter at least one hold time.' : 'Enter reps for at least one set.', 'err');

  const payload = { action: 'logWorkout', exerciseId: state.selectedId, date: todayStr(), sets };

  // Optimistic local update so history/summary refresh instantly.
  sets.forEach((s, i) => state.logs.push({
    logId: 'local-' + Date.now() + i, date: payload.date, exerciseId: payload.exerciseId,
    setNumber: i + 1, reps: s.reps, weightKg: s.weightKg, timeSec: s.timeSec,
    volume: Math.round(s.weightKg * s.reps * 100) / 100,
  }));
  localStorage.setItem('ironlog.cache', JSON.stringify({ exercises: state.exercises, logs: state.logs }));
  renderAll();
  resetSetRows();
  showMsg('Logged ✓', 'ok');

  try {
    const res = await apiPost(payload);
    if (!res.ok) throw new Error(res.error);
    setSync('ok');
  } catch (e) {
    state.queue.push(payload);
    localStorage.setItem('ironlog.queue', JSON.stringify(state.queue));
    setSync('offline');
    showMsg('Saved locally — will sync to Sheets when back online.', 'ok');
  }
}

function showMsg(text, cls) {
  const el = $('logMsg');
  el.textContent = text; el.className = 'msg ' + (cls || ''); el.hidden = false;
  clearTimeout(el._t); el._t = setTimeout(() => (el.hidden = true), 4000);
}

/* --------------------------- add exercise --------------------------- */
let newExType = 'standard';
async function addExercise() {
  const name = $('newExerciseName').value.trim();
  if (!name) return showMsg('Give the exercise a name.', 'err');
  try {
    const res = await apiPost({ action: 'addExercise', name, type: newExType });
    if (!res.ok) throw new Error(res.error);
    if (!res.existed) state.exercises.push(res.exercise);
    state.selectedId = res.exercise.id;
  } catch (e) {
    // Offline: create locally with a temp id (server will dedupe by name on sync of future logs).
    const ex = { id: 'local-' + Date.now(), name, type: newExType };
    state.exercises.push(ex);
    state.selectedId = ex.id;
    state.queue.push({ action: 'addExercise', name, type: newExType });
    localStorage.setItem('ironlog.queue', JSON.stringify(state.queue));
    setSync('offline');
  }
  localStorage.setItem('ironlog.cache', JSON.stringify({ exercises: state.exercises, logs: state.logs }));
  $('newExerciseName').value = '';
  $('addExercisePanel').hidden = true;
  renderExerciseSelect(); renderHistory(); resetSetRows();
}

/* ------------------------------ rest timer ------------------------------ */
const RIM = 527.8; // circumference of the r=84 rim
const timer = { duration: CONFIG.DEFAULT_REST_SECONDS, remaining: CONFIG.DEFAULT_REST_SECONDS, running: false, id: null };

function drawTimer() {
  const m = Math.floor(timer.remaining / 60);
  const s = String(timer.remaining % 60).padStart(2, '0');
  $('timerDisplay').textContent = `${m}:${s}`;
  $('plateRim').style.strokeDashoffset = RIM * (1 - timer.remaining / timer.duration);
  $('plate').classList.toggle('done', timer.remaining === 0);
}
function timerTick() {
  if (timer.remaining > 0) timer.remaining--;
  drawTimer();
  if (timer.remaining === 0) {
    stopTimer();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    beep();
  }
}
function startPauseTimer() {
  if (timer.running) return stopTimer();
  if (timer.remaining === 0) timer.remaining = timer.duration;
  timer.running = true;
  $('btnStartPause').textContent = 'Pause';
  timer.id = setInterval(timerTick, 1000);
}
function stopTimer() {
  timer.running = false;
  clearInterval(timer.id);
  $('btnStartPause').textContent = 'Start';
}
function resetTimer() {
  stopTimer();
  timer.remaining = timer.duration;
  $('plate').classList.remove('done');
  drawTimer();
}
function nudgeTimer(delta) {
  timer.duration = Math.max(CONFIG.REST_STEP, timer.duration + delta);
  timer.remaining = Math.max(0, Math.min(timer.duration, timer.remaining + delta));
  if (!timer.running) timer.remaining = timer.duration;
  drawTimer();
}
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; g.gain.setValueAtTime(0.25, ctx.currentTime);
    o.start(); o.stop(ctx.currentTime + 0.6);
  } catch (_) { /* audio not available */ }
}

/* ------------------------------ summary ------------------------------ */
function renderSummary() {
  const today = todayStr();
  // All-time dashboard: every exercise with at least one logged set, newest activity first.
  const loggedIds = [...new Set(state.logs.map((l) => l.exerciseId))];
  const exIds = loggedIds.sort((a, b) => {
    const la = lastSessionInfo(a) ? lastSessionInfo(a).date : '';
    const lb = lastSessionInfo(b) ? lastSessionInfo(b).date : '';
    return lb.localeCompare(la);
  });
  const list = $('summaryList');
  list.innerHTML = '';
  $('summaryEmpty').hidden = exIds.length > 0;

  let grandTotal = 0;

  exIds.forEach((exId) => {
    const ex = exercise(exId) || { name: 'Unknown', type: 'standard' };
    const timed = ex.type === 'timed';
    const unit = timed ? 's' : '';

    const lastDate = lastSessionInfo(exId) ? lastSessionInfo(exId).date : today;
    const current = timed ? timeOn(exId, lastDate) : volumeOn(exId, lastDate);
    if (!timed) grandTotal += logsFor(exId).reduce((s, l) => s + l.volume, 0);

    const prev = lastSessionInfo(exId, lastDate);
    const lastVal = prev ? (timed ? timeOn(exId, prev.date) : volumeOn(exId, prev.date)) : null;
    const allTime = logsFor(exId).reduce((s, l) => s + (timed ? l.timeSec : l.volume), 0);

    const deltaCls = lastVal === null ? '' : current >= lastVal ? 'delta-up' : 'delta-down';
    const note = lastVal === null ? 'First logged session — baseline set.'
      : `${current >= lastVal ? '▲' : '▼'} ${fmt(Math.abs(current - lastVal))}${unit || ' kg·reps'} vs previous session (${prev.date})`;

    list.insertAdjacentHTML('beforeend', `
      <section class="card sum-card">
        <h2 class="sum-name">${ex.name}</h2>
        <div class="sum-grid">
          <div class="sum-cell"><span class="eyebrow">Latest session</span>
            <span class="sum-val ${deltaCls}">${fmt(current)}${unit}</span></div>
          <div class="sum-cell"><span class="eyebrow">Previous</span>
            <span class="sum-val">${lastVal === null ? '—' : fmt(lastVal) + unit}</span></div>
          <div class="sum-cell"><span class="eyebrow">All-time</span>
            <span class="sum-val">${fmt(allTime)}${unit}</span></div>
        </div>
        <p class="sum-note">${note}</p>
      </section>`);
  });

  $('totalToday').textContent = fmt(grandTotal);
}

/* ------------------------------ wiring ------------------------------ */
function renderAll() { renderExerciseSelect(); renderHistory(); renderSummary(); }

document.addEventListener('DOMContentLoaded', () => {
  // Tabs
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    $('screen-log').hidden = t.dataset.screen !== 'log';
    $('screen-summary').hidden = t.dataset.screen !== 'summary';
    if (t.dataset.screen === 'summary') renderSummary();
  }));

  // Exercise picker
  $('exerciseSelect').addEventListener('change', (e) => {
    state.selectedId = e.target.value || null;
    renderHistory(); resetSetRows();
  });
  $('btnShowAdd').addEventListener('click', () => {
    const p = $('addExercisePanel'); p.hidden = !p.hidden;
    if (!p.hidden) $('newExerciseName').focus();
  });
  document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active'); newExType = b.dataset.type;
  }));
  $('btnAddExercise').addEventListener('click', addExercise);

  // Sets + log
  $('btnAddSet').addEventListener('click', addSetRow);
  $('btnLog').addEventListener('click', logWorkout);

  // Timer
  $('btnStartPause').addEventListener('click', startPauseTimer);
  $('btnReset').addEventListener('click', resetTimer);
  $('btnPlus').addEventListener('click', () => nudgeTimer(CONFIG.REST_STEP));
  $('btnMinus').addEventListener('click', () => nudgeTimer(-CONFIG.REST_STEP));
   // Auto-start rest timer when a set's weight (or hold time) is filled in.
  $('setRows').addEventListener('blur', (e) => {
    if (e.target.classList.contains('in-weight') || e.target.classList.contains('in-time')) {
      if (e.target.value !== '') { resetTimer(); startPauseTimer(); }
    }
  }, true);
  drawTimer();

  window.addEventListener('online', bootstrap);
  bootstrap();
});
