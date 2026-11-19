
'use strict';

// ============================================================
// SmartBuilding Group A — Final Dashboard
// Device: ENV_GROUP_A_01
// API: Supabase read-group-data Edge Function
//
// SECURITY:
// Never put DASHBOARD_ACCESS_A, device tokens, or service_role
// keys in this public JavaScript file.
// ============================================================

const API_URL =
  'https://izbtxfmkfmkfledrqtpu.supabase.co/functions/v1/read-group-data';

const DEVICE_ID = 'ENV_GROUP_A_01';
const MAX_POINTS = 60;
const REFRESH_MS = 30000;
const REQUEST_TIMEOUT_MS = 12000;
const STALE_AFTER_MS = 2 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 60 * 1000;

const $ = (id) => document.getElementById(id);

let accessCode = '';
let timer = null;
let rows = [];
let inFlight = false;
let sessionId = 0;

const charts = [
  ['chartTemp', 'temperature_c', '#18b7c5'],
  ['chartHumidity', 'humidity_rh', '#8cb8ff'],
  ['chartLux', 'illuminance_lux', '#f4c873'],
  ['chartCO2', 'eco2_ppm', '#a99aff'],
  ['chartTVOC', 'tvoc_ppb', '#eea1bd']
];

// ============================================================
// UI Helpers
// ============================================================

function status(label, css = '') {
  $('status').textContent = label;
  $('status').className = `status ${css}`;
}

function message(text) {
  $('message').textContent = text;
}

function value(v, digits = 1) {
  if (v === null || v === undefined || v === '') {
    return '—';
  }

  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

function when(s) {
  if (!s) return '—';

  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString();
}

function windowLabel(v) {
  return typeof v === 'boolean'
    ? (v ? 'OPEN' : 'CLOSED')
    : '—';
}

function clearReadings() {
  for (const id of [
    'temperature',
    'humidity',
    'lux',
    'eco2',
    'tvoc',
    'motion',
    'last',
    'w1',
    'w2',
    'window1',
    'window2',
    'w1time',
    'w2time'
  ]) {
    $(id).textContent = '—';
  }
}

// ============================================================
// API Communication
// ============================================================

async function api(action) {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-dashboard-key': accessCode
      },
      body: JSON.stringify({
        action,
        device_id: DEVICE_ID
      }),
      signal: controller.signal,
      cache: 'no-store'
    });

    let data = {};

    try {
      data = await response.json();
    } catch {
      throw new Error('Invalid server response.');
    }

    if (!response.ok) {
      if (response.status === 401 ||
          response.status === 403) {
        throw new Error(
          'Access denied. Check the Group A code and server settings.'
        );
      }

      throw new Error(
        data.error || `Server error ${response.status}`
      );
    }

    if (!data || typeof data !== 'object' ||
        data.device_id !== DEVICE_ID) {
      throw new Error('Unexpected device response.');
    }

    if (action === 'recent' && !Array.isArray(data.rows)) {
      throw new Error('Invalid recent-data response.');
    }

    if (action === 'latest' &&
        !Object.prototype.hasOwnProperty.call(data, 'latest')) {
      throw new Error('Invalid latest-data response.');
    }

    return data;

  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out.');
    }

    throw err;

  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// Data Management
// ============================================================

function appendRow(row) {
  if (!row || !row.record_id) return;

  const timestamp = new Date(row.recorded_at).getTime();

  if (!Number.isFinite(timestamp)) return;

  const index = rows.findIndex(
    x => x.record_id === row.record_id
  );

  if (index >= 0) {
    rows[index] = row;
  } else {
    rows.push(row);
  }

  rows.sort((a, b) =>
    new Date(a.recorded_at).getTime() -
    new Date(b.recorded_at).getTime() ||
    String(a.record_id).localeCompare(String(b.record_id))
  );

  rows = rows.slice(-MAX_POINTS);
}

// ============================================================
// Latest Measurements
// ============================================================

function display(data) {
  if (!data) {
    status('No readings available', 'stale');
    return;
  }

  $('temperature').textContent =
    value(data.temperature_c);

  $('humidity').textContent =
    value(data.humidity_rh);

  $('lux').textContent =
    value(data.illuminance_lux, 0);

  $('eco2').textContent =
    value(data.eco2_ppm, 0);

  $('tvoc').textContent =
    value(data.tvoc_ppb, 0);

  $('motion').textContent =
    data.motion_detected === true
      ? 'Detected'
      : data.motion_detected === false
        ? 'Clear'
        : '—';

  $('last').textContent = when(data.recorded_at);

  const timestamp =
    new Date(data.recorded_at).getTime();

  const age = Date.now() - timestamp;

  if (!Number.isFinite(age)) {
    status('Timestamp unavailable', 'stale');
  } else if (age < -FUTURE_TOLERANCE_MS) {
    status('Invalid future timestamp', 'stale');
  } else if (age > STALE_AFTER_MS) {
    status('Data delayed', 'stale');
  } else {
    status('Connected · Live', 'online');
  }
}

// ============================================================
// Window Status — W1 and W2
// ============================================================

function displayWindows(windows, latest) {
  const configurations = [
    ['W1', 'window_1_open', 'w1time', 'window1'],
    ['W2', 'window_2_open', 'w2time', 'window2']
  ];

  for (const [id, key, timeId, boxId] of configurations) {
    const event = windows?.[id];

    const open =
      typeof event?.open === 'boolean'
        ? event.open
        : latest?.[key];

    const label = windowLabel(open);

    $(id.toLowerCase()).textContent = label;
    $(boxId).textContent = label;

    $(timeId).textContent =
      event?.recorded_at
        ? `Last event: ${when(event.recorded_at)}`
        : latest && typeof latest[key] === 'boolean'
          ? 'Latest sample state'
          : 'No verified state';
  }
}

// ============================================================
// Canvas Charts
// ============================================================

function draw(canvasId, field, color) {
  const canvas = $(canvasId);
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();

  const w = Math.max(260, rect.width);
  const h = Math.max(170, rect.height);

  const dpr = Math.min(
    window.devicePixelRatio || 1,
    2
  );

  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const L = 48;
  const R = 12;
  const T = 18;
  const B = 32;

  const pw = w - L - R;
  const ph = h - T - B;

  // Exclude missing values without converting null to zero.
  const pts = rows
    .filter(r =>
      r[field] !== null &&
      r[field] !== undefined &&
      r[field] !== ''
    )
    .map(r => ({
      y: Number(r[field]),
      t: new Date(r.recorded_at).getTime()
    }))
    .filter(p =>
      Number.isFinite(p.y) &&
      Number.isFinite(p.t)
    )
    .sort((a, b) => a.t - b.t);

  ctx.font = '12px system-ui';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#99b5c1';
  ctx.strokeStyle = '#315362';
  ctx.lineWidth = 1;

  if (!pts.length) {
    ctx.textAlign = 'center';
    ctx.fillText(
      'Waiting for readings',
      w / 2,
      h / 2
    );
    return;
  }

  let lo = Math.min(...pts.map(p => p.y));
  let hi = Math.max(...pts.map(p => p.y));

  const pad = Math.max(
    (hi - lo) * 0.12,
    Math.abs(hi) * 0.01,
    0.5
  );

  lo -= pad;
  hi += pad;

  // Horizontal grid and Y-axis labels.
  for (let j = 0; j <= 4; j++) {
    const y = T + ph * j / 4;

    ctx.beginPath();
    ctx.moveTo(L, y);
    ctx.lineTo(w - R, y);
    ctx.stroke();

    const tick = hi - (hi - lo) * j / 4;

    ctx.fillText(
      tick.toFixed(hi - lo > 100 ? 0 : 1),
      L - 7,
      y + 4
    );
  }

  const times = pts.map(p => p.t);

  const tMin = Math.min(...times);
  let tMax = Math.max(...times);

  if (tMin === tMax) {
    tMax = tMin + 1;
  }

  const X = p =>
    L + (p.t - tMin) / (tMax - tMin) * pw;

  const Y = p =>
    T + (hi - p.y) / (hi - lo) * ph;

  // Draw the data line.
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.4;
  ctx.beginPath();

  pts.forEach((p, i) => {
    if (i === 0) {
      ctx.moveTo(X(p), Y(p));
    } else {
      ctx.lineTo(X(p), Y(p));
    }
  });

  ctx.stroke();

  // Highlight the latest point.
  const last = pts[pts.length - 1];

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(
    X(last),
    Y(last),
    4,
    0,
    Math.PI * 2
  );
  ctx.fill();

  // X-axis time labels.
  ctx.fillStyle = '#99b5c1';

  ctx.textAlign = 'left';
  ctx.fillText(
    new Date(tMin).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    }),
    L,
    h - 7
  );

  ctx.textAlign = 'right';
  ctx.fillText(
    new Date(tMax).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    }),
    w - R,
    h - 7
  );
}

function renderCharts() {
  charts.forEach(([id, field, color]) =>
    draw(id, field, color)
  );
}

// ============================================================
// Refresh Logic
// ============================================================

async function refresh() {
  if (inFlight || !accessCode) return false;

  inFlight = true;
  const currentSession = sessionId;

  try {
    const data = await api('latest');

    if (currentSession !== sessionId) {
      return false;
    }

    if (data.latest) {
      appendRow(data.latest);
      display(data.latest);
    } else {
      clearReadings();
      status('No readings available', 'stale');
    }

    displayWindows(data.windows, data.latest);

    renderCharts();
    message('');

    return true;

  } catch (err) {
    if (currentSession === sessionId) {
      status('Connection issue', 'stale');
      message(
        err.message || 'Unable to refresh data.'
      );
    }

    return false;

  } finally {
    inFlight = false;
  }
}

// ============================================================
// Connect
// ============================================================

async function connect() {
  if (accessCode || $('connect').disabled) return;

  const code = $('access').value.trim();

  if (!code) {
    message('Enter your Group A access code.');
    return;
  }

  accessCode = code;
  const currentSession = ++sessionId;

  $('connect').disabled = true;
  message('Connecting…');

  try {
    // Step 1: Verify recent-data endpoint.
    const recent = await api('recent');

    if (currentSession !== sessionId) return;

    rows = [];

    for (const row of recent.rows) {
      appendRow(row);
    }

    renderCharts();

    // Step 2: Verify latest-data endpoint.
    const success = await refresh();

    if (currentSession !== sessionId) return;

    if (!success) {
      throw new Error(
        'Initial connection failed. Check the latest-data endpoint.'
      );
    }

    $('disconnect').disabled = false;
    $('access').value = '';
    $('access').disabled = true;

    if (timer) {
      clearInterval(timer);
    }

    timer = setInterval(refresh, REFRESH_MS);

  } catch (err) {
    if (currentSession !== sessionId) return;

    accessCode = '';
    rows = [];

    clearReadings();
    renderCharts();

    status('Not connected');
    message(
      err.message || 'Connection failed.'
    );

    $('connect').disabled = false;
    $('disconnect').disabled = true;
    $('access').disabled = false;
  }
}

// ============================================================
// Disconnect
// ============================================================

function disconnect() {
  sessionId++;

  if (timer) {
    clearInterval(timer);
  }

  timer = null;
  accessCode = '';
  rows = [];

  $('access').value = '';
  $('access').disabled = false;

  $('connect').disabled = false;
  $('disconnect').disabled = true;

  clearReadings();
  renderCharts();

  status('Not connected');
  message('Disconnected.');
}

// ============================================================
// Event Listeners
// ============================================================

$('connect').addEventListener('click', connect);

$('disconnect').addEventListener(
  'click',
  disconnect
);

$('access').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    connect();
  }
});

window.addEventListener('resize', renderCharts);

// Initial state.
clearReadings();
status('Not connected');
renderCharts();
