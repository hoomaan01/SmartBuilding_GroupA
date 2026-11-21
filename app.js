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

// ============================================================
// Colour scales (temperature / humidity)
// ============================================================

// Temperature: <=4 °C frozen dark blue ... 24 °C orange ... >=32 °C red
const TEMP_STOPS = [
  [0,  '#1e40af'],
  [4,  '#2563eb'],
  [12, '#22d3ee'],
  [18, '#facc15'],
  [24, '#fb923c'],
  [28, '#f97316'],
  [32, '#ef4444'],
  [40, '#dc2626']
];

// Humidity: dry = amber, comfortable = green/teal, humid = blue
const HUM_STOPS = [
  [0,   '#f59e0b'],
  [20,  '#fb923c'],
  [30,  '#facc15'],
  [40,  '#34d399'],
  [55,  '#2dd4bf'],
  [65,  '#38bdf8'],
  [80,  '#3b82f6'],
  [100, '#1d4ed8']
];

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function scaleColor(stops, v) {
  if (v <= stops[0][0]) return stops[0][1];
  if (v >= stops[stops.length - 1][0]) {
    return stops[stops.length - 1][1];
  }

  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [v0, c0] = stops[i - 1];
      const [v1, c1] = stops[i];
      const f = (v - v0) / (v1 - v0);
      const a = hexToRgb(c0);
      const b = hexToRgb(c1);
      const rgb = a.map((x, k) => Math.round(x + (b[k] - x) * f));
      return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    }
  }

  return stops[stops.length - 1][1];
}

const tempColor = (v) => scaleColor(TEMP_STOPS, v);
const humColor = (v) => scaleColor(HUM_STOPS, v);

// Gauge colour scales (temperature -20..60 °C, humidity 0..100 %).
const GAUGE_TEMP_STOPS = [
  [-20, '#1e3a8a'],
  [0,   '#1d4ed8'],
  [8,   '#38bdf8'],
  [18,  '#facc15'],
  [26,  '#fb923c'],
  [40,  '#ef4444'],
  [60,  '#b91c1c']
];

const GAUGE_HUM_STOPS = [
  [0,   '#f59e0b'],
  [25,  '#facc15'],
  [40,  '#34d399'],
  [60,  '#2dd4bf'],
  [80,  '#38bdf8'],
  [100, '#1d4ed8']
];

const gaugeTempColor = (v) => scaleColor(GAUGE_TEMP_STOPS, v);
const gaugeHumColor = (v) => scaleColor(GAUGE_HUM_STOPS, v);

// Good / moderate / poor colour for eCO2 and TVOC.
function qualityColor(v, good, poor) {
  if (v <= good) return '#34d399';
  if (v <= poor) return '#fbbf24';
  return '#f87171';
}

// Temperature gauge range.
const TEMP_MIN = -20;
const TEMP_MAX = 60;

const charts = [
  ['chartTemp', 'temperature_c', tempColor],
  ['chartHumidity', 'humidity_rh', humColor],
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

function num(v) {
  if (v === null || v === undefined || v === '') return NaN;
  return Number(v);
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

// ============================================================
// Icons and visual cards
// ============================================================

const SVG_NS = 'http://www.w3.org/2000/svg';

const WINDOW_SVG = `
<svg viewBox="0 0 120 110" aria-hidden="true">
  <defs>
    <linearGradient id="skyG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5eb6ff"/><stop offset="1" stop-color="#cfeeff"/>
    </linearGradient>
  </defs>
  <rect class="frame" x="8" y="6" width="104" height="98" rx="7"/>
  <g class="outside">
    <rect x="16" y="14" width="88" height="82" fill="url(#skyG)"/>
    <circle cx="86" cy="32" r="8" fill="#fde68a"/>
    <path d="M26 44q6-9 14-4 5-7 13 0 8-2 9 6H26z" fill="#fff" opacity=".9"/>
  </g>
  <g class="sash">
    <rect class="glass" x="16" y="14" width="88" height="82"/>
    <line class="bars" x1="60" y1="14" x2="60" y2="96"/>
    <line class="bars" x1="16" y1="55" x2="104" y2="55"/>
    <rect class="handle" x="94" y="50" width="5" height="12" rx="2"/>
  </g>
</svg>`;

const DOOR_SVG = `
<svg viewBox="0 0 120 110" aria-hidden="true">
  <rect class="frame" x="22" y="4" width="76" height="102" rx="5"/>
  <g class="spill">
    <rect x="28" y="10" width="64" height="94" fill="#0f2a3d"/>
    <path d="M28 104h64l-14-40H42z" fill="#fde68a" opacity=".28"/>
  </g>
  <g class="leaf">
    <rect class="panelfill" x="28" y="10" width="64" height="94"/>
    <rect class="inset" x="36" y="18" width="48" height="32"/>
    <rect class="inset" x="36" y="58" width="48" height="38"/>
    <circle class="knob" cx="83" cy="62" r="3.6"/>
  </g>
  <rect x="14" y="104" width="92" height="4" rx="2" fill="#27465c"/>
</svg>`;

function initIcons() {
  document.querySelectorAll('.anim').forEach((el) => {
    el.innerHTML = el.dataset.kind === 'door' ? DOOR_SVG : WINDOW_SVG;
  });

}

function setAccent(cardId, color) {
  $(cardId).style.setProperty('--accent', color);
}

function setChip(id, text) {
  $(id).textContent = text;
}

function svgEl(name, attrs, parent) {
  const e = document.createElementNS(SVG_NS, name);

  for (const k in attrs) {
    e.setAttribute(k, attrs[k]);
  }

  parent.appendChild(e);
  return e;
}

const G_CX = 80;
const G_CY = 76;
const G_R = 58;
const G_SW = 11;

function gPoint(angle, r) {
  const t = angle * Math.PI / 180;
  return [G_CX + Math.cos(t) * r, G_CY + Math.sin(t) * r];
}

function gArc(a0, a1, r) {
  const p0 = gPoint(a0, r);
  const p1 = gPoint(a1, r);
  const large = (a1 - a0) > 180 ? 1 : 0;

  return `M${p0[0].toFixed(2)} ${p0[1].toFixed(2)}` +
    `A${r} ${r} 0 ${large} 1 ${p1[0].toFixed(2)} ${p1[1].toFixed(2)}`;
}

// Draws the arc gauge. Only the filled part is coloured; the rest of
// the track stays empty. A NaN value draws just the empty track.
function drawGauge(svgId, stops, min, max, v) {
  const svg = $(svgId);
  svg.textContent = '';

  svgEl('path', {
    d: gArc(135, 405, G_R + 10.5),
    fill: 'none',
    stroke: 'rgba(255,255,255,.07)',
    'stroke-width': 0.8
  }, svg);

  svgEl('path', {
    d: gArc(135, 405, G_R),
    fill: 'none',
    stroke: '#1a1e24',
    'stroke-width': G_SW,
    'stroke-linecap': 'round'
  }, svg);

  if (!Number.isFinite(v)) return null;

  const p = Math.min(Math.max((v - min) / (max - min), 0), 1);
  const a0 = 135;
  const a1 = 135 + 270 * p;
  const n = Math.max(2, Math.round(p * 70));

  for (let i = 0; i < n; i++) {
    const s0 = a0 + (a1 - a0) * i / n;
    const s1 = a0 + (a1 - a0) * (i + 1) / n + (i < n - 1 ? 0.6 : 0);

    svgEl('path', {
      d: gArc(s0, s1, G_R),
      fill: 'none',
      'stroke-width': G_SW,
      stroke: scaleColor(stops, min + (max - min) * ((i + 0.5) / n) * p)
    }, svg);
  }

  const start = gPoint(a0, G_R);
  const knob = gPoint(a1, G_R);
  const color = scaleColor(stops, v);

  svgEl('circle', {
    cx: start[0], cy: start[1], r: G_SW / 2,
    fill: scaleColor(stops, min + (max - min) * 0.001)
  }, svg);

  svgEl('circle', {
    cx: knob[0], cy: knob[1], r: 12,
    fill: color, opacity: 0.22
  }, svg);

  svgEl('circle', {
    cx: knob[0], cy: knob[1], r: 6.5,
    fill: '#fff', stroke: color, 'stroke-width': 2.5
  }, svg);

  return color;
}

const particleState = {};

function setParticles(containerId, count, size, dur, color, opacity) {
  const box = $(containerId);
  const key = `${count}|${color}`;

  if (particleState[containerId] === key) return;
  particleState[containerId] = key;

  box.textContent = '';

  for (let i = 0; i < count; i++) {
    const d = document.createElement('i');
    const sz = size * (0.6 + Math.random() * 0.8);

    d.className = 'pt';
    d.style.cssText =
      `width:${sz.toFixed(1)}px;height:${sz.toFixed(1)}px;` +
      `right:${(6 + Math.random() * 34).toFixed(1)}%;background:${color};` +
      `--o:${opacity};` +
      `animation-duration:${(dur * (0.7 + Math.random() * 0.6)).toFixed(2)}s;` +
      `animation-delay:-${(Math.random() * dur).toFixed(2)}s`;
    box.appendChild(d);
  }
}

function clearParticles() {
  for (const id of ['partsCO2', 'partsTVOC']) {
    $(id).textContent = '';
    particleState[id] = '';
  }
}

function resetVisuals() {
  for (const id of ['cardTemp', 'cardHum', 'cardCO2', 'cardTVOC']) {
    $(id).style.removeProperty('--accent');
    $(id).classList.remove('tint');
  }

  $('cardTemp').classList.remove('frozen', 'hot');
  $('cardMotion').dataset.motion = 'unknown';

  setChip('tempnote', '—');
  setChip('humnote', '—');

  drawGauge('tSvg', GAUGE_TEMP_STOPS, TEMP_MIN, TEMP_MAX, NaN);
  drawGauge('hSvg', GAUGE_HUM_STOPS, 0, 100, NaN);

  visualLux(NaN);
  clearParticles();
}

function visualTemperature(v) {
  const n = num(v);
  if (!Number.isFinite(n)) return;

  const c = drawGauge('tSvg', GAUGE_TEMP_STOPS, TEMP_MIN, TEMP_MAX, n);
  setAccent('cardTemp', c);

  $('cardTemp').classList.toggle('frozen', n <= 4);
  $('cardTemp').classList.toggle('hot', n >= 32);

  setChip(
    'tempnote',
    n <= 0 ? 'Freezing'
      : n <= 4 ? 'Near freezing'
      : n < 16 ? 'Cold'
      : n < 21 ? 'Cool'
      : n <= 26 ? 'Comfortable'
      : n < 32 ? 'Warm'
      : 'Hot'
  );
}

function visualHumidity(v) {
  const n = num(v);
  if (!Number.isFinite(n)) return;

  const c = drawGauge('hSvg', GAUGE_HUM_STOPS, 0, 100, n);
  setAccent('cardHum', c);

  setChip(
    'humnote',
    n < 30 ? 'Dry'
      : n <= 60 ? 'Comfortable'
      : n <= 70 ? 'Humid'
      : 'Very humid'
  );
}

// Pulsing dot: 4 bands (0-20, 20-100, 100-300, >300 lux).
function visualLux(v) {
  const n = num(v);
  const wrap = document.querySelector('#cardLux .pulse');
  const dot = $('luxDot');
  const ring = $('luxRing');

  if (!Number.isFinite(n)) {
    wrap.classList.remove('on');
    dot.style.cssText = '';
    ring.style.cssText = '';
    return;
  }

  let size, glow, glowColor, scale, color;

  if (n < 20) {
    size = 10; glow = 4; scale = 1.6;
    glowColor = 'rgba(190,205,225,.35)'; color = '#cbd5e1';
  } else if (n < 100) {
    size = 13; glow = 10; scale = 2;
    glowColor = 'rgba(240,240,235,.5)'; color = '#f5f5f0';
  } else if (n < 300) {
    size = 16; glow = 20; scale = 2.6;
    glowColor = 'rgba(255,236,190,.7)'; color = '#fff4d0';
  } else {
    size = 20; glow = 34; scale = 3.2;
    glowColor = 'rgba(255,226,150,.95)'; color = '#fff4d0';
  }

  const margin = `${-size / 2}px 0 0 ${-size / 2}px`;

  dot.style.width = `${size}px`;
  dot.style.height = `${size}px`;
  dot.style.margin = margin;
  dot.style.background = color;
  dot.style.boxShadow =
    `0 0 ${glow}px ${Math.round(glow / 3)}px ${glowColor}`;

  ring.style.width = `${size}px`;
  ring.style.height = `${size}px`;
  ring.style.margin = margin;
  ring.style.borderColor = color;
  ring.style.setProperty('--rs', scale);

  wrap.classList.add('on');
}

function visualGas(v, kind) {
  const n = num(v);
  if (!Number.isFinite(n)) return;

  const co2 = kind === 'co2';
  const card = co2 ? 'cardCO2' : 'cardTVOC';
  const color = co2
    ? qualityColor(n, 800, 1200)
    : qualityColor(n, 220, 660);

  setAccent(card, color);
  $(card).classList.add('tint');

  if (co2) {
    const count = Math.min(12, Math.max(3, Math.round(3 + (n - 400) / 1600 * 9)));
    setParticles('partsCO2', count, 12, 9, color, 0.28);
  } else {
    const count = Math.min(16, Math.max(4, Math.round(4 + n / 1000 * 12)));
    setParticles('partsTVOC', count, 5, 5, color, 0.4);
  }
}

function visualMotion(v) {
  $('cardMotion').dataset.motion =
    v === true ? 'yes' : v === false ? 'no' : 'unknown';
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
    'd1',
    'window1',
    'window2',
    'door1',
    'w1time',
    'w2time',
    'd1time'
  ]) {
    $(id).textContent = '—';
  }

  resetVisuals();

  for (const id of ['cardW1', 'cardW2', 'cardD1']) {
    $(id).dataset.state = 'unknown';
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

  // Visual indicators.
  visualTemperature(data.temperature_c);
  visualHumidity(data.humidity_rh);
  visualLux(data.illuminance_lux);
  visualGas(data.eco2_ppm, 'co2');
  visualGas(data.tvoc_ppb, 'tvoc');
  visualMotion(data.motion_detected);

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
// Window and Door Status — W1, W2, D1
// ============================================================

function displayWindows(windows, latest) {
  // [event id, latest-sample keys, time element, text element, state box, card]
  const configurations = [
    ['W1', ['window_1_open'], 'w1time', 'window1', 'w1', 'cardW1'],
    ['W2', ['window_2_open'], 'w2time', 'window2', 'w2', 'cardW2'],
    ['D1', ['door_1_open', 'door_open', 'd1_open'], 'd1time', 'door1', 'd1', 'cardD1']
  ];

  for (const [id, keys, timeId, boxId, cardTextId, cardId] of configurations) {
    const event =
      windows?.[id] ??
      windows?.[id.toLowerCase()] ??
      (id === 'D1' ? windows?.door_1 : undefined);

    const key = keys.find(
      k => typeof latest?.[k] === 'boolean'
    );

    const open =
      typeof event?.open === 'boolean'
        ? event.open
        : key
          ? latest[key]
          : undefined;

    const label = windowLabel(open);

    $(cardTextId).textContent = label;
    $(boxId).textContent = label;

    $(cardId).dataset.state =
      open === true ? 'open'
        : open === false ? 'closed'
        : 'unknown';

    $(timeId).textContent =
      event?.recorded_at
        ? `Last event: ${when(event.recorded_at)}`
        : key
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

  ctx.font = '12px Inter, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#b9c8d2';
  ctx.strokeStyle = '#2a3038';
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

  // A function colour draws each segment by its value
  // (temperature and humidity colour scales).
  const colorFn = typeof color === 'function' ? color : null;

  ctx.lineWidth = 2.4;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (colorFn) {
    for (let i = 1; i < pts.length; i++) {
      ctx.strokeStyle = colorFn((pts[i - 1].y + pts[i].y) / 2);
      ctx.beginPath();
      ctx.moveTo(X(pts[i - 1]), Y(pts[i - 1]));
      ctx.lineTo(X(pts[i]), Y(pts[i]));
      ctx.stroke();
    }
  } else {
    ctx.strokeStyle = color;
    ctx.beginPath();

    pts.forEach((p, i) => {
      if (i === 0) {
        ctx.moveTo(X(p), Y(p));
      } else {
        ctx.lineTo(X(p), Y(p));
      }
    });

    ctx.stroke();
  }

  // Highlight the latest point.
  const last = pts[pts.length - 1];
  const dotColor = colorFn ? colorFn(last.y) : color;

  ctx.fillStyle = dotColor;
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
  ctx.fillStyle = '#b9c8d2';

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
initIcons();
clearReadings();
status('Not connected');
renderCharts();
