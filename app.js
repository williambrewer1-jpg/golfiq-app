// GolfIQ for iPhone — UI. All data lives in this browser's on-device storage (store.js).
import * as A from './analytics.js';
import * as F from './features.js';
import * as B from './bench.js';
import { registerCompete } from './compete.js';
import { registerProgress } from './progress.js';
import { registerGuided } from './guided.js';
import * as FEEL from './feel.js';
import * as CHT from './charts.js';
import * as CH from './challenges.js';
import * as S from './store.js';
import { syncFromGitHub, newStateKey } from './sync.js';
import { TOUR_CSV } from './baseline.js';
import { BOOKMARKLET_SRC, bookmarkletUrl } from './bookmarklet.js';
import { registerPages } from './pages2.js';
import { registerPlay } from './play.js';
import { icon } from './icons.js';

const TOUR = A.Baseline.fromCsv(TOUR_CSV, 'pga_tour_broadie');
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
let state = null, DS = null, DSDUP = null, plots = [], ui = JSON.parse(localStorage.getItem('golfiq-ui') || '{}');
let filters = JSON.parse(localStorage.getItem('golfiq-filters') || '{"formats":["18"]}');
const saveUi = () => localStorage.setItem('golfiq-ui', JSON.stringify(ui));

// ------------------------------------------------------------------ helpers
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 1, u = '') => (A.isNum(v) ? (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(d)) + u : '–');
const sgn = (v, d = 2) => (A.isNum(v) ? (v > 0 ? '+' : '') + v.toFixed(d) : '–');
const note = (t) => `<p class="note">ⓘ ${t}</p>`;
function toast(t, ms = 3500) { const e = $('#toast'); e.textContent = t; e.style.display = 'block'; clearTimeout(e._t); e._t = setTimeout(() => { e.style.display = 'none'; }, ms); }
function table(rows, cols, opts = {}) {
  if (!rows?.length) return `<p class="muted small">${opts.empty || 'No data'}</p>`;
  const h = cols.map((c) => `<th>${esc(c[1])}</th>`).join('');
  const cell = (v) => (A.isNum(v) ? (Number.isInteger(v) ? String(v) : fmt(v)) : esc(v ?? '–'));
  const b = rows.map((r, i) => `<tr${opts.click ? ` class="click" data-i="${i}"` : ''}>${cols.map(([k, , f]) => `<td>${f ? f(r[k], r) : cell(r[k])}</td>`).join('')}</tr>`).join('');
  return `<div class="tbl"><table${opts.id ? ` id="${opts.id}"` : ''}><thead><tr>${h}</tr></thead><tbody>${b}</tbody></table></div>`;
}
const n0 = (v) => fmt(v, 0), n1 = (v) => fmt(v, 1), n2 = (v) => fmt(v, 2), p0 = (v) => fmt(v, 0, '%');
// ---- units: everything is stored and computed in metres; converted only for display/entry
const YD = 0.9144, FT = 0.3048;
let UNIT = 'yd';                                                   // 'yd' (default) or 'm'
const PUNIT = () => (UNIT === 'yd' ? 'ft' : 'm');                  // putting distances
const cv = (m) => (A.isNum(m) ? (UNIT === 'yd' ? m / YD : m) : null);
const uncv = (v) => (A.isNum(v) ? (UNIT === 'yd' ? v * YD : v) : null);
const pcv = (m) => (A.isNum(m) ? (UNIT === 'yd' ? m / FT : m) : null);
const puncv = (v) => (A.isNum(v) ? (UNIT === 'yd' ? v * FT : v) : null);
const cvA = (a) => a.map(cv);
const D = (m, d = 0) => (A.isNum(m) ? `${fmt(cv(m), d)} ${UNIT}` : '–');          // "152 yd"
const DP = (m, d = 0) => (A.isNum(m) ? `${fmt(pcv(m), d)} ${PUNIT()}` : '–');     // "12 ft"
const d0 = (v) => fmt(cv(v), 0), d1 = (v) => fmt(cv(v), 1);
const area = (m2) => (A.isNum(m2) ? (UNIT === 'yd' ? m2 / (YD * YD) : m2) : null);
const inputVal = (m, d = 1) => (A.isNum(m) ? String(Math.round(cv(m) * 10 ** d) / 10 ** d) : '');
const badge = (s) => `<span class="badge ${s}">${s}</span>`;
function seg(key, options, dflt, cls = '') {
  const cur = ui[key] ?? dflt;
  return `<div class="seg ${cls}" data-seg="${key}">${options.map(([v, l]) => `<button data-v="${esc(v)}" class="${String(v) === String(cur) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
}
const segVal = (key, dflt) => ui[key] ?? dflt;
function select(key, options, dflt, label) {
  const cur = ui[key] ?? dflt;
  return `${label ? `<label class="f">${esc(label)}</label>` : ''}<select data-sel="${key}">${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}
function chips(key, options, dflt = []) {
  const cur = ui[key] ?? dflt;
  return `<div class="chips" data-chips="${key}">${options.map((o) => `<button class="chip ${cur.includes(o) ? 'on' : ''}" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
}
function kpi(label, value, delta = null, hib = true, d = 1, unit = '') {
  let dd = '';
  if (A.isNum(delta) && Math.abs(delta) > 1e-9) { const good = (delta > 0) === hib; dd = `<div class="d ${good ? 'good' : 'bad'}">${delta > 0 ? '▲' : '▼'} ${fmt(Math.abs(delta), d)}${unit} vs earlier</div>`; }
  return `<div class="kpi"><div class="l">${esc(label)}</div><div class="v">${fmt(value, d, unit)}</div>${dd}</div>`;
}
function plot(traces, layout = {}, cls = '') { const id = `p${plots.length}`; plots.push([id, traces, layout]); return `<div class="plot ${cls}" id="${id}"></div>`; }
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
// Chart colours come from the theme (light and dark), read again at every render, so charts never use fixed colours.
const P = {}, COLORS = [];
const hexRgb = (h) => { const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(h || ''); if (!m) return null; const x = m[1].length === 3 ? [...m[1]].map((d) => d + d).join('') : m[1]; return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); };
const mixHex = (a, b, t) => { const x = hexRgb(a), y = hexRgb(b); return x && y ? `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})` : a; };
const alphaOf = (h, a) => { const x = hexRgb(h); return x ? `rgba(${x.join(',')},${a})` : h; };
function refreshPalette() {
  Object.assign(P, { accent: css('--accent'), gold: css('--gold'), good: css('--good'), bad: css('--bad'), warn: css('--warn'), ink: css('--ink'), muted: css('--muted'), line: css('--line'), hair: css('--hair'), card: css('--card'), sans: css('--sans') });
  P.accentSoft = alphaOf(P.accent, 0.16);
  const base = [P.accent, P.good, P.bad, P.ink, P.muted];
  COLORS.length = 0; COLORS.push(...base, ...base.map((c) => mixHex(c, P.card, 0.5)), mixHex(P.accent, P.bad, 0.5), mixHex(P.good, P.ink, 0.5));
}
refreshPalette();
// every Plotly chart is locked (no drag-zoom, no double-tap, no scroll-zoom); only the course map keeps its own pan and zoom
function drawPlots() {
  if (!window.Plotly) { plots.forEach(([id]) => { const e = document.getElementById(id); if (e) e.innerHTML = '<p class="muted small">Charts load when online the first time.</p>'; }); return; }
  for (const [id, traces, layout] of plots) {
    const e = document.getElementById(id); if (!e) continue;
    const isMap = !!layout.map, font = { family: P.sans, size: 11, color: P.ink };
    const ax = (a = {}) => ({ gridcolor: P.hair, zerolinecolor: P.line, linecolor: P.line, tickfont: { size: 11, color: P.muted }, ...a, ...(a.title ? { title: { ...a.title, font: { size: 11, color: P.muted } } } : {}), fixedrange: !isMap });
    const L = { margin: { l: 44, r: 10, t: layout.title ? 34 : 10, b: 40 }, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font,
      legend: { orientation: 'h', y: -0.22 }, hovermode: 'closest', hoverlabel: { bgcolor: P.ink, bordercolor: P.ink, font: { family: P.sans, size: 12, color: P.card } },
      ...layout, xaxis: ax(layout.xaxis), yaxis: ax(layout.yaxis), dragmode: isMap ? 'pan' : false };
    if (layout.title) L.title = { text: layout.title, font: { size: 13, family: P.sans, color: P.ink }, x: 0.02 };
    Plotly.newPlot(e, traces, L, { responsive: true, displayModeBar: false, scrollZoom: isMap, doubleClick: isMap ? 'reset' : false, showTips: false });
  }
}
async function saveFile(name, text) {
  const file = new File([text], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
const readFile = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsText(f); });

// ------------------------------------------------------------------ data & filters
const BUILD = { estimateIndex: true };
function rebuild() { UNIT = state.settings?.units === 'm' ? 'm' : 'yd'; DS = A.buildDataset(state, BUILD); DSDUP = null; FEEL.init(state.settings); }
function filtered(opts = {}) {
  const f = { ...filters }; if (opts.allFormats) delete f.formats;
  return A.filterDataset(DS, f);
}
function filterSheet() {
  const r = DS.rounds, courses = [...new Set(r.map((x) => x.course_name).filter(Boolean))].sort(), tees = [...new Set(r.map((x) => x.tee).filter(Boolean))].sort();
  const box = (name, vals, cur) => vals.map((v) => `<label style="display:flex;gap:8px;align-items:center;margin:6px 0"><input type="checkbox" name="${name}" value="${esc(v)}" ${cur?.includes(v) ? 'checked' : ''}>${esc(v)}</label>`).join('');
  $('#sheetPanel').innerHTML = `<h2 style="margin-top:0">Filters</h2>
    <div class="row"><div><label class="f">From</label><input type="date" id="fFrom" value="${filters.dateFrom || ''}"></div><div><label class="f">To</label><input type="date" id="fTo" value="${filters.dateTo || ''}"></div></div>
    <label class="f">Most recent rounds</label><select id="fLast">${[['', 'All'], [5, '5'], [10, '10'], [20, '20'], [50, '50']].map(([v, l]) => `<option value="${v}" ${String(filters.lastN || '') === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label class="f">Round length (9 and 18 holes are never averaged together)</label>${box('fmt', ['18', '9', 'partial'], filters.formats)}
    ${courses.length ? `<label class="f">Courses (none ticked = all)</label>${box('course', courses, filters.courses)}` : ''}
    ${tees.length > 1 ? `<label class="f">Tees</label>${box('tee', tees, filters.tees)}` : ''}
    <div class="row"><div><label class="f">Handicap index from</label><input type="number" step="0.1" id="fH0" value="${filters.hcp?.[0] ?? ''}"></div><div><label class="f">to</label><input type="number" step="0.1" id="fH1" value="${filters.hcp?.[1] ?? ''}"></div></div>
    <p><button class="btn" id="fApply">Apply</button><button class="btn sec" id="fReset">Reset</button></p>`;
  $('#sheet').classList.add('open');
  $('#fApply').onclick = () => {
    const vals = (n) => $$(`input[name=${n}]:checked`).map((e) => e.value);
    const h0 = parseFloat($('#fH0').value), h1 = parseFloat($('#fH1').value);
    filters = { dateFrom: $('#fFrom').value || null, dateTo: $('#fTo').value || null, lastN: parseInt($('#fLast').value, 10) || null,
      formats: vals('fmt'), courses: vals('course'), tees: vals('tee'), hcp: Number.isFinite(h0) && Number.isFinite(h1) ? [h0, h1] : null };
    localStorage.setItem('golfiq-filters', JSON.stringify(filters)); $('#sheet').classList.remove('open'); render();
  };
  $('#fReset').onclick = () => { filters = { formats: ['18'] }; localStorage.setItem('golfiq-filters', JSON.stringify(filters)); $('#sheet').classList.remove('open'); render(); };
}
function filterSummary(ds) {
  const parts = [`${ds.rounds.length} of ${DS.rounds.length} rounds`];
  if (filters.formats?.length) parts.push(`${filters.formats.join('/')} holes`);
  if (filters.lastN) parts.push(`last ${filters.lastN}`);
  if (filters.courses?.length) parts.push(filters.courses.join(', '));
  if (filters.dateFrom || filters.dateTo) parts.push(`${filters.dateFrom || '…'} → ${filters.dateTo || '…'}`);
  return `<p class="small muted" style="margin:0 0 10px">${esc(parts.join(' · '))}</p>`;
}
function demoBanner() {
  const n = S.demoRoundCount(state); if (!n) return '';
  const real = state.bundles.length - n;
  return `<div class="warn"><b>Demo data is loaded:</b> ${n} synthetic rounds${real ? ` are mixed in with your ${real} Garmin rounds` : ''}, plus demo clubs and a demo handicap history. <br><button class="btn" data-removedemo>Remove demo data</button><br><span class="small">Keeps your Garmin rounds, your own edits and your cloud-sync settings.</span></div>`;
}
const emptyMsg = () => `<div class="card"><h2>Welcome to GolfIQ</h2><p>Your golf, measured. Everything you add stays on this phone.</p>
  <p><a class="btn" href="#play">Play a round &amp; keep score</a></p>
  <p class="small">Have a Garmin watch? Bring in your full shot history on the <a href="#data">Data</a> page (automatic sync or a one-tap export) – setup steps are under <a href="#help">Help</a>.</p>
  <p><button class="btn sec" id="loadSample">Explore with demo data</button></p></div>`;

// ------------------------------------------------------------------ trend chart
function trendChart(rounds, metric, label, ref = null) {
  const m = A.METRICS[metric] || [label, true, ''], n = rounds.filter((r) => A.isNum(r[metric])).length, wins = CHT.trendWins(n), key = `tw_${metric}`;
  const win = wins.includes(Number(ui[key])) ? Number(ui[key]) : (wins[0] || 0);
  const ctl = wins.length > 1 ? `<div class="seg" data-seg="${key}">${wins.map((w) => `<button data-v="${w}" class="${w === win ? 'on' : ''}">${w} rounds</button>`).join('')}</div>` : '';
  return ctl + CHT.trend({ rounds, metric, label, unit: m[2], hib: m[1], ref, win });
}

const SOFT_BAD = 'color-mix(in srgb, var(--bad) 70%, var(--card))';
function distChart(rounds, metric) {
  const vals = rounds.map((x) => x[metric]).filter(A.isNum); if (vals.length < 2) return '';
  const intM = ['stableford_round', 'gross', 'to_par'].includes(metric), w = 2, bins = CHT.bin(vals, w), last = vals[vals.length - 1];
  const hotI = Math.min(bins.length - 1, Math.max(0, Math.floor((last - bins[0].lo) / w + 1e-9))), name = A.METRICS[metric]?.[0] || metric;
  const items = bins.map((b, i) => ({ label: intM ? `${b.lo}–${b.hi - 1}` : `${b.lo}–${b.hi}`, xl: String(b.lo), value: b.count, hot: i === hotI, tone: 'accent', note: `${intM ? `${b.lo}–${b.hi - 1}` : `${b.lo} to ${b.hi}`}: ${b.count} round${b.count === 1 ? '' : 's'}${i === hotI ? ' (includes your last round)' : ''}` }));
  return `<h3>Distribution of rounds</h3>${CHT.bars({ items, digits: 0, aria: `How many rounds fall in each ${name} range`, caption: `Tap a bar. The outlined bar holds your last round (${fmt(last)}).` })}`;
}
function holeChart(ha) {
  const cells = ha.map((x) => ({ hole: x.hole, value: x.avg_to_par, detail: `Hole ${x.hole} · par ${x.par} · SI ${x.si ?? '–'} · avg ${fmt(x.avg, 1)} (${sgn(x.avg_to_par, 1)}) · GIR ${fmt(x.gir_pct, 0)}% · ${x.played} played` }));
  return CHT.holeGrid({ groups: [{ title: 'Front 9', rows: [{ cells: cells.filter((c) => c.hole <= 9) }] }, { title: 'Back 9', rows: [{ cells: cells.filter((c) => c.hole > 9) }] }], digits: 1, aria: 'Average score to par on each hole', caption: 'Average to par per hole. Tap a hole for details.' });
}
// ------------------------------------------------------------------ pages
const PAGES = {
  home: ['GolfIQ', 'home'], stats: ['Stats', 'chart'], rounds: ['Rounds', 'list'],
  data: ['Data & sync', 'cloud'], corrections: ['Corrections log', 'pencil'], settings: ['Settings', 'gear'], help: ['Help & setup', 'help'],
};
const NAV = [['home', 'Home'], ['play', 'Play'], ['rounds', 'Rounds'], ['stats', 'Stats'], ['practice', 'Practice']];
let EXTRA = null;                         // pages registered from pages2.js / play.js
let SUBWIRE = [];                         // sub-pages shown inside a hub that need their own event wiring
let EMBED = null;
const SETTINGS_PAGES = ['settings', 'data', 'help', 'corrections'];
let lastMain = '#home';                   // where Done / back returns to from Settings
let PROG = null;                          // progress: forecast, milestones, roadmaps, badges (progress.js)
let COMP = null; let GUIDED = null;                          // practice competition + friends (compete.js)
let E_CACHE = null;
// expected strokes to hole out (your strokes-gained model), rebuilt when the data changes
function expectedFn() { if (!E_CACHE || E_CACHE.ds !== DS) E_CACHE = { ds: DS, f: A.expectedModel(DS, TOUR) }; return E_CACHE.f; }                         // round shown inside the round page (review / edit tabs)
const FILTERED = new Set(['stats', 'rounds']);
// Pages that moved in the reorganisation: old address -> [new page, ui state to set, optional hook]
const latestRound = () => DS.rounds[DS.rounds.length - 1]?.round_id || null;
const MOVED = {
  overview: ['home'], more: ['settings'], coaching: ['practice', { pr_tab: 'focus' }],
  scoring: ['stats', { sx_tab: 'scoring' }], striking: ['stats', { sx_tab: 'approach' }], putting: ['stats', { sx_tab: 'putting' }], sg: ['stats', { sx_tab: 'sg' }],
  handicap: ['stats', { sx_tab: 'handicap' }], clubs: ['stats', { sx_tab: 'bag', bag_tab: 'gapping' }], dispersion: ['stats', { sx_tab: 'bag', bag_tab: 'dispersion' }],
  conditions: ['stats', { sx_tab: 'insights', in_tab: 'conditions' }], compare: ['stats', { sx_tab: 'insights', in_tab: 'compare' }], bests: ['stats', { sx_tab: 'insights', in_tab: 'bests' }],
  caddie: ['play', { pl_tab: 'caddie' }], playbook: ['play', { pl_tab: 'plan' }],
  review: ['rounds', { rd_tab: 'review' }, () => { ui.rd_open = ui.rv_round && DS.rounds.some((r) => r.round_id === ui.rv_round) ? ui.rv_round : latestRound(); }],
  edit: ['rounds', { rd_tab: 'edit' }, () => { ui.rd_open = ui.ed_round && DS.rounds.some((r) => r.round_id === ui.ed_round) ? ui.ed_round : latestRound(); }],
};
const noMatch = '<div class="warn">No rounds match the filters.</div>';

function pageHome() {
  if (!DS.rounds.length) return (state.journal.draft ? `<a class="hero" href="#play"><span>Round in progress</span><b>${esc(state.journal.draft.course_name)} · hole ${state.journal.draft.hole}</b><em>Continue ›</em></a>` : '') + emptyMsg();
  const r18 = DS.rounds.filter((x) => x.format === '18'), last = DS.rounds[DS.rounds.length - 1], d = state.journal.draft;
  const withD = DS.rounds.filter((x) => A.isNum(x.differential_for_index)), idx = withD.length ? withD[withD.length - 1].index_after : null;
  const off = [...(state.settings.handicaps || [])].sort((a, b) => a.date.localeCompare(b.date)).pop();
  const k = r18.length ? Object.fromEntries(A.kpiTable(r18, 5).map((x) => [x.metric, x])) : {};
  const SHORT = { stableford_round: 'Stableford', differential: 'Differential', gir_pct: 'GIR', fw_pct: 'Fairways', putts_round: 'Putts', penalties: 'Penalties' };
  const t = (m, dd = 1, u = '') => (k[m] ? kpi(SHORT[m] || k[m].label, k[m].recent, k[m].delta, A.METRICS[m][1], dd, u) : '');
  const needs = last ? EXTRA.reviewNeeds(DS, last.round_id).filter((x) => x.any).length : 0;
  const fs = r18.length >= 8 ? A.findings(A.filterDataset(DS, { formats: ['18'], lastN: 20 }), UNIT).slice(0, 3) : [];
  const th = (state.journal.thoughts || []).filter(Boolean), sc = state.sync || {};
  const metric = r18.filter((x) => x.differential !== null).length >= 5 ? 'differential' : 'stableford_round';
  return `${demoBanner()}
  ${d ? `<a class="hero" href="#play"><span>Round in progress</span><b>${esc(d.course_name)} · hole ${d.hole}</b><em>Continue ›</em></a>`
    : `<div class="quick"><a class="btn" href="#play">${icon('flag', 18)} Play a round</a><a class="btn sec" href="#practice">${icon('dumbbell', 18)} Practice</a></div>`}
  <div class="kpis">${kpi('GolfIQ index', idx)}<div class="kpi"><div class="l">Official index</div><div class="v">${off ? fmt(off.handicap_index) : '–'}</div><div class="d muted">${off ? 'from ' + esc(off.date) : '<a href="#settings">add in Settings</a>'}</div></div></div>
  ${PROG.levelRow()}
  ${PROG.homeCard()}
  ${PROG.journeyHome()}
  ${PROG.homePayoff()}
  ${GUIDED.homeCard()}
  ${last ? `<div class="card"><div class="rv-h"><h2 style="margin:0">Last round</h2><span class="small muted">${esc(last.date)}</span></div><p class="small muted" style="margin:2px 0 8px">${esc(last.course_name || '')}${last.format !== '18' ? ` · ${esc(last.format)} holes` : ''}</p>
    <div class="kpis">${kpi('Gross', last.gross, null, false, 0)}${kpi('Stableford', last.stableford_round, null, true, 0)}${kpi('GIR', last.gir_pct, null, true, 0, '%')}${kpi('Putts', last.putts_round, null, false, 0)}</div>
    <p style="margin:6px 0 0"><a class="btn sec" href="#rounds" data-openround="${esc(last.round_id)}">Open round</a>${needs ? `<a class="btn" href="#rounds" data-openround="${esc(last.round_id)}" data-tab="review">Review – ${needs} hole${needs > 1 ? 's' : ''} to check</a>` : ''}</p></div>` : ''}
  ${r18.length ? `<div class="card"><h2>Form <span class="small muted">last 5 rounds vs earlier</span></h2><div class="kpis">${t('stableford_round')}${t('differential')}${t('gir_pct', 0, '%')}${t('fw_pct', 0, '%')}${t('putts_round')}${t('penalties')}</div>
    ${trendChart(r18.slice(-30), metric, A.METRICS[metric][0], metric === 'stableford_round' ? 36 : null)}<p style="margin:4px 0 0"><a href="#stats" data-stats="scoring">All stats ›</a></p></div>` : ''}
  ${fs.length ? `<div class="card"><h2>Where the strokes are</h2>${fs.map((f, i) => `<div class="prio"><span>${i + 1}</span><div><b>${esc(f.title)}</b><div class="small muted">~${fmt(f.strokes_per_round)} strokes/round · ${esc(f.focus).slice(0, 110)}${f.focus.length > 110 ? '…' : ''}</div></div></div>`).join('')}
    <p style="margin:8px 0 0"><a href="#practice" data-practice="focus">Your practice plan ›</a></p></div>` : ''}
  ${th.length ? `<details class="card"><summary>Swing thoughts (${th.length})</summary><div class="thoughts" style="margin-top:10px">${th.map((x, i) => `<div class="thought"><span>${i + 1}</span><p>${esc(x)}</p></div>`).join('')}</div></details>` : ''}
  ${sc.owner ? `<div class="card syncline"><span class="small">Garmin sync · last ${esc(sc.last_sync ? new Date(sc.last_sync).toLocaleDateString() : 'never')}</span><button class="btn sec sm" id="syncNow">Sync now</button><span id="syncMsg" class="small"></span></div>` : ''}`;
}

function killersTrend(ds) {
  const map = F.scoreKillers(ds.holes, ds.shots, F.shortIronRange(DS)), rows = ds.rounds.filter((r) => r.format === '18').map((r) => ({ ...map.get(r.round_id), date: r.date, course: r.course_name })).filter((x) => x.round_id);
  if (rows.length < 3) return '';
  const last = rows.slice(-5), prev = rows.slice(-10, -5), avg = (a, k) => (a.length ? A.mean(a.map((x) => x[k])) : null);
  return `<div class="card"><h2>Score killers</h2><p class="small">Per 18-hole round – after Scott Fawcett's five scoring rules, plus penalty strokes. Short-iron range = your 9-iron distance (${D(F.shortIronRange(DS))}).</p>
    ${table(F.KILLERS.map(([k, l]) => ({ l, last: avg(last, k), prev: avg(prev, k), all: avg(rows, k) })), [['l', 'Per round'], ['last', 'Last 5', n1], ['prev', 'Previous 5', n1], ['all', `All ${rows.length}`, n1]])}
    <h3>Score killers per round</h3>${CHT.bars({ items: rows.map((r) => ({ label: r.date, xl: CHT.shortDate(r.date), value: r.total, tone: SOFT_BAD, note: `${r.date} · ${r.course || ''} · ${fmt(r.total, 0)} score killers` })), digits: 0, aria: 'Score killers in each 18-hole round', caption: 'Tap a bar for the round.' })}</div>`;
}
function bestWorst(r) {
  const basis = r.filter((x) => x.differential !== null).length >= 3 ? 'differential' : 'to_par';
  const sorted = [...r].filter((x) => A.isNum(x[basis])).sort((a, b) => a[basis] - b[basis]);
  const rcols = [['date', 'Date'], ['course_name', 'Course'], ['gross', 'Gross', n0], ['stableford_round', 'Pts', n0], ['differential', 'Diff', n1], ['gir_pct', 'GIR', p0], ['putts_round', 'Putts', n0]];
  return `<div class="card"><h2>Best 5 (by ${basis.replace('_', ' ')})</h2>${table(sorted.slice(0, 5), rcols)}<h2 style="margin-top:14px">Worst 5</h2>${table(sorted.slice(-5).reverse(), rcols)}
  ${note('Score differential normalises for course and tee difficulty – the fair way to compare rounds at different courses.')}</div>`;
}
function pageScoring() {
  const ds = filtered(), r = ds.rounds, h = ds.holes;
  if (!r.length) return noMatch;
  const missing = r.filter((x) => x.stableford_round === null).length, m = segVal('sc_m', 'stableford_round');
  const dist = A.distribution(h), bl = A.blowupSummary(h, r), bp = A.byPar(h), fb = A.frontBack(h, r);
  const courses = [...new Map(r.map((x) => [x.course_id, x.course_name])).entries()].filter(([c]) => c);
  const cid = segVal('sc_course', courses[0]?.[0]), ha = cid ? A.holeAverages(h, cid) : [];
  const cols = ['#1B5E20', P.good, '#90CAF9', '#FFB74D', '#E57373', '#B71C1C'];
  return `${filterSummary(ds)}<div class="kpis">${kpi('Avg Stableford', A.mean(r.map((x) => x.stableford_round)))}${kpi('Avg gross', A.mean(r.map((x) => x.gross)))}${kpi('Avg to par', A.mean(r.map((x) => x.to_par)))}${kpi('Avg differential', A.mean(r.map((x) => x.differential)))}</div>
  ${note(`Garmin doesn't export a Stableford total – all points are <b>reconstructed</b> (WHS playing handicap = 95% of course handicap, strokes by stroke index). ${missing} round(s) can't be reconstructed (add handicap, rating/slope or stroke index in Settings).`)}
  <div class="card"><h2>Is it improving?</h2>${seg('sc_m', [['stableford_round', 'Stableford'], ['gross', 'Gross'], ['to_par', 'To par'], ['differential', 'Differential']], 'stableford_round', 'scroll')}
  ${trendChart(r, m, A.METRICS[m][0], m === 'stableford_round' ? 36 : null)}
  ${table(A.compareWindows(r.map((x) => x[m]), A.METRICS[m][1]), [['window', 'Last N vs previous N'], ['recent', 'Recent', n2], ['prior', 'Previous', n2], ['p', 'p', n2], ['verdict', 'Verdict']])}
  ${note('Welch t-test, p < 0.10. "No clear change" = within normal round-to-round noise; needs 2×N rounds.')}
  ${distChart(r, m)}</div>
  <div class="card"><h2>Consistency</h2><div class="kpis">${['gross', 'stableford_round', 'differential'].map((mm) => { const cc = A.consistency(r, mm); return `<div class="kpi"><div class="l">${A.METRICS[mm][0]} – SD</div><div class="v">${fmt(cc.sd)}</div><div class="d muted">IQR ${fmt(cc.iqr)} · n=${cc.n}</div></div>`; }).join('')}</div></div>
  ${killersTrend(ds)}
  ${bestWorst(r)}
  <div class="card"><h2>Score types per 18 holes</h2>${CHT.strip({ parts: dist.map((d) => ({ label: d.bucket, value: d.per_18, tone: CHT.SCORE_TONES[d.bucket], note: `${d.bucket}: ${fmt(d.per_18, 1)} per 18 holes (${fmt(d.pct, 0)}% of holes)` })), digits: 1, caption: 'Tap a colour for details.' })}
  <div class="kpis">${kpi('Triple+ holes / round', bl.per_round, null, false, 2)}${kpi('Strokes beyond double / rd', bl.beyond_double_per_round, null, false, 2)}${kpi('Blow-ups with a penalty', bl.with_penalty_pct, null, false, 0, '%')}</div></div>
  <div class="card"><h2>By hole par</h2>${table(bp, [['par', 'Par'], ['holes', 'Holes'], ['avg_score', 'Avg', n2], ['avg_to_par', 'To par', n2], ['stableford_avg', 'Pts', n2], ['gir_pct', 'GIR', p0], ['blowup_pct', 'Triple+', p0]])}
  <h3>Front vs back nine (18-hole rounds)</h3>${table(fb, [['nine', ''], ['avg_to_par_per_9', 'To par / 9', n2], ['stableford_per_9', 'Pts / 9', n1], ['putts_per_9', 'Putts / 9', n1]])}</div>
  <div class="card"><h2>By course</h2>${table(A.courseSummary(r), [['course', 'Course'], ['tee', 'Tee'], ['rounds', 'Rds'], ['avg_gross', 'Gross', n1], ['avg_differential', 'Diff', n1], ['avg_stableford', 'Pts', n1], ['rating', 'CR', n1], ['slope', 'Slope', n0]])}
  ${courses.length ? `<h3>Hole by hole</h3>${select('sc_course', courses, cid)}${holeChart(ha)}
  ${table(ha, [['hole', 'Hole'], ['par', 'Par'], ['si', 'SI'], ['played', 'n'], ['avg', 'Avg', n2], ['avg_to_par', 'To par', n2], ['stableford', 'Pts', n2], ['gir_pct', 'GIR', p0]])}` : ''}
  ${note('Compare courses on differential (accounts for rating/slope), not gross.')}</div>`;
}

function pageTee() {
  const ds = filtered(), r = ds.rounds, h = ds.holes, s = ds.shots;
  if (!r.length) return noMatch;
  const drv = A.driving(h, s), fw = A.contrast(h, 'fw_hit', (x) => x.par >= 4), m = segVal('te_m', 'fw_pct');
  return `${filterSummary(ds)}<div class="kpis">${kpi('Fairways', drv.fw_hit_pct, null, true, 0, '%')}${kpi('Penalties / round', A.mean(r.map((x) => x.penalties)), null, false, 2)}${kpi('Missed left', drv.miss_left_pct, null, false, 0, '%')}${kpi('Missed right', drv.miss_right_pct, null, false, 0, '%')}${kpi('Tee shots → penalty', drv.tee_penalty_pct, null, false, 1, '%')}</div>
  <div class="card"><h2>What a missed fairway costs</h2><p>${sgn(fw.to_par_yes)} to par after hitting the fairway vs ${sgn(fw.to_par_no)} after missing it: <b>${n2(fw.delta)}</b> strokes per miss <span class="small muted">(${fw.n_yes} hit / ${fw.n_no} missed)</span>.</p>
  ${note('A personal contrast from your own par 4s and 5s. It overlaps with approach play – Practice → Focus ranks the areas together.')}</div>
  <div class="card"><h2>Trend</h2>${seg('te_m', [['fw_pct', 'Fairways'], ['penalties', 'Penalties']], 'fw_pct')}${trendChart(r, m, A.METRICS[m][0])}</div>
  <div class="card"><h2>Fairway results</h2>${CHT.fairway({ hit: drv.fw_hit_pct, left: drv.miss_left_pct, right: drv.miss_right_pct, holes: drv.fairway_holes })}
  ${table(drv.by_club, [['club', 'Tee club'], ['shots', 'n'], ['median_m', `Median ${UNIT}`, d0], ['sd_m', 'SD', d1], ['lateral_sd_m', 'Lateral SD', d1]])}
  ${note('Fairway results come from your scorecard. Tee-shot distances are GPS total; lateral spread is measured from the usual line of your drives on each hole.')}</div>`;
}

function pageApproach() {
  const ds = filtered(), r = ds.rounds, h = ds.holes, s = ds.shots;
  if (!r.length) return noMatch;
  const gir = A.contrast(h, 'gir_eff'), reach = s.filter((x) => x.category === 'approach' && x.start_to_pin !== null && x.start_to_pin <= 200);
  const bands = A.approachByBand(s, UNIT), byClub = A.approachByClub(s), miss = A.greenMissDirections(s), g1 = A.byPar(h);
  return `${filterSummary(ds)}<div class="kpis">${kpi('GIR', A.mean(h.map((x) => x.gir_eff)) * 100, null, true, 0, '%')}${kpi('Strokes per missed green', gir.delta, null, false, 2)}${kpi(`Long/short SD (${UNIT})`, cv(A.std(reach.map((x) => x.long_short_m))), null, false, 0)}${kpi(`Left/right SD (${UNIT})`, cv(A.std(reach.map((x) => x.lateral_m))), null, false, 0)}</div>
  ${note('GIR is derived (strokes − putts ≤ par − 2); holes with missing or default putts are excluded. If long/short spread is bigger than left/right, distance control is the bigger leak.')}
  <div class="card"><h2>Trend</h2>${trendChart(r, 'gir_pct', A.METRICS.gir_pct[0])}
  <h3>GIR by par</h3>${CHT.tiles(g1.map((x) => ({ label: `Par ${x.par}`, value: x.gir_pct, unit: '%', sub: `${x.holes} holes` })))}</div>
  <div class="card"><h2>By distance</h2><p class="small muted" style="margin:0 0 4px">Green hit %, by distance from the pin</p>${bands.length ? CHT.hbars({ items: bands.map((b) => ({ label: b.band, value: b.green_hit_pct, sub: `n=${b.shots}`, note: `${b.band}: ${fmt(b.green_hit_pct, 0)}% of ${b.shots} shots hit the green` })), unit: '%', digits: 0, max: 100 }) : ''}
  ${table(bands, [['band', 'From'], ['shots', 'n'], ['green_hit_pct', 'Green', p0], ['median_proximity_m', `Prox ${UNIT}`, d0], ['mean_long_short_m', 'Long/short', d1], ['short_pct', 'Short', p0], ['long_pct', 'Long', p0], ['sd_lateral_m', 'L/R SD', d1]])}
  ${note(`Pin = Garmin's pin marker (green centre unless moved on the watch). Green hit uses Garmin's end lie, else within ${D(12)} of the pin. Short/long = more than ${D(10)} from the pin's distance.`)}</div>
  <div class="card"><h2>By club</h2>${table(byClub, [['club', 'Club'], ['shots', 'n'], ['median_start_m', `From ${UNIT}`, d0], ['green_hit_pct', 'Green', p0], ['median_proximity_m', `Prox ${UNIT}`, d0], ['mean_long_short_m', 'Long/short', d1], ['sd_lateral_m', 'L/R SD', d1]])}</div>
  ${miss.length ? `<div class="card"><h2>Missed greens</h2><p class="small muted" style="margin:0 0 4px">Where approach shots finished when they missed the green</p>${CHT.green({ dirs: miss })}</div>` : ''}`;
}

function pageShort() {
  const ds = filtered(), r = ds.rounds;
  if (!r.length) return noMatch;
  const g = F.shortGame(ds.holes, ds.shots, r), U = UNIT, bl = (b) => `${fmt(cv(b.lo_m), 0)}–${fmt(cv(b.hi_m), 0)} ${U}`;
  const tr = g.byRound.filter((x) => x.missed >= 3);
  return `${filterSummary(ds)}<div class="kpis">${kpi('Scrambling', g.scrambling_pct, null, true, 0, '%')}${kpi('Missed greens / round', g.missed_per_round, null, false, 1)}${kpi('Double+ after a miss', g.double_after_miss_pct, null, false, 0, '%')}${kpi('Up & down', g.up_down_pct, null, true, 0, '%')}${kpi('Chips onto the green', g.chip_on_green_pct, null, true, 0, '%')}${kpi('Sand saves', g.sand_save_pct, null, true, 0, '%')}</div>
  ${note(`Scrambling = par or better after missing the green (${g.missed_greens} holes). Up & down = one shot from around the green then one putt (${g.up_down_n} holes with tracked chips). Sand saves: ${g.sand_n} holes with a tracked bunker shot near the green.`)}
  ${tr.length >= 3 ? `<div class="card"><h2>Scrambling by round</h2>${plot([{ x: tr.map((x) => x.date), y: tr.map((x) => x.scrambling), mode: 'lines+markers', line: { color: P.accent, width: 2 }, marker: { size: 6 } }], { height: 230, yaxis: { title: { text: '% of missed greens' }, range: [0, 100] } })}</div>` : ''}
  <div class="card"><h2>Chips and pitches by distance</h2>${table(g.bands.map((b) => ({ ...b, band: bl(b) })), [['band', 'From'], ['shots', 'Shots', n0], ['on_green_pct', 'On green', p0], ['median_left_m', `Left ${UNIT === 'yd' ? 'ft' : 'm'}`, (v) => fmt(pcv(v), 0)]], { empty: 'No tracked shots from around the green yet.' })}
  ${note(`Shots that started within ${D(27.4)} of the pin, from Garmin GPS. "Left" = median distance from the pin after the shot. Chips AutoShot missed aren't counted – add them in Rounds → a round → Review.`)}</div>`;
}

function pagePutting() {
  const ds = filtered(), r = ds.rounds, h = ds.holes;
  if (!r.length) return noMatch;
  const p = A.puttingSummary(h, r), m = segVal('pt_m', 'putts_round'), src = segVal('pt_src', 'user');
  const fp = A.byFirstPuttDistance(h, src, PUNIT()), dist = A.puttsPerHoleDistribution(h);
  return `${filterSummary(ds)}<div class="kpis">${kpi('Putts / round', p.putts_per_round)}${kpi('Putts / GIR', p.putts_per_gir, null, false, 2)}${kpi('1-putt', p.one_putt_pct, null, true, 0, '%')}${kpi('3-putt', p.three_putt_pct, null, false, 1, '%')}${kpi('Putts / hole', p.putts_per_hole, null, false, 2)}${kpi('2-putt', p.two_putt_pct, null, true, 0, '%')}${kpi('3-putts / 18', p.three_putts_per_round, null, false, 2)}${kpi('Holes without usable putts', p.holes_missing_putts, null, false, 0)}</div>
  ${p.suspect_default_holes ? `<div class="warn">${p.suspect_default_holes} holes are excluded because their round shows 2 putts on every hole (looks like Garmin's default). If genuine, confirm them in Rounds → a round → Edit → Holes.</div>` : ''}
  ${note('Putts come from your scorecard entries, not GPS. Putts/round only counts rounds with a putt count on every hole.')}
  <div class="card"><h2>Trend</h2>${seg('pt_m', [['putts_round', 'Putts'], ['putts_per_gir', 'Per GIR'], ['three_putt_pct', '3-putt %'], ['one_putt_pct', '1-putt %']], 'putts_round')}${trendChart(r, m, A.METRICS[m][0])}
  ${dist.length ? plot([{ x: dist.map((d) => d.putts), y: dist.map((d) => d.pct), type: 'bar', marker: { color: P.accent } }], { title: 'Share of holes by putts', height: 220 }) : ''}</div>
  <div class="card"><h2>By first-putt distance</h2>${seg('pt_src', [['user', 'Entered (reliable)'], ['estimated', 'GPS-estimated']], 'user')}
  ${fp.length ? table(fp, [['band', 'Distance'], ['holes', 'Holes'], ['avg_putts', 'Avg putts', n2], ['make_pct', 'Holed', p0], ['three_putt_pct', '3-putt', p0]]) : `<p class="muted">No holes with ${src === 'user' ? 'entered' : 'estimated'} first-putt distances. Add them in Rounds → a round → Edit → Holes to unlock short-putt conversion.</p>`}
  ${note(`GPS estimate = where your approach finished to the pin marker (green centre unless moved); typically ${DP(5)}–${DP(10)} error. The two sources are never mixed.`)}</div>
  <div class="card"><h2>By round</h2>${table([...r].reverse(), [['date', 'Date'], ['course_name', 'Course'], ['putts_round', 'Putts', n0], ['putts_per_gir', '/GIR', n2], ['one_putts', '1-putts', n0], ['three_putts', '3-putts', n0], ['putts_status', 'Status']])}</div>`;
}

function pageClubs() {
  const ds = filtered({ allFormats: true }), scope = segVal('cl_scope', 'both');
  let s = ds.shots;
  if (!s.some((x) => x.club_id)) return '<div class="card">No shots with a club in this selection.</div>';
  if (scope !== 'both') s = s.map((x) => (x.category === scope ? x : { ...x, full_swing: false }));
  const t = A.clubTable(s, ds.clubs).filter((x) => x.category !== 'putter'), gp = A.gapping(t);
  const cmp = ui.cl_cmp || [], tt = t.filter((x) => x.median_m !== null && (!cmp.length || cmp.includes(x.club))).sort((a, b) => a.median_m - b.median_m);
  const tr = [];
  tt.forEach((r) => {
    const col = r.sample === 'insufficient' ? P.muted : r.sample === 'low' ? P.gold : P.accent;
    tr.push({ x: cvA([r.p10_m, r.p90_m]), y: [r.club, r.club], mode: 'lines', line: { color: col, width: 3 }, showlegend: false, hoverinfo: 'skip' });
    tr.push({ x: cvA([r.p25_m, r.p75_m]), y: [r.club, r.club], mode: 'lines', line: { color: col, width: 12 }, opacity: 0.6, showlegend: false, hoverinfo: 'skip' });
  });
  tr.push({ x: tt.map((r) => cv(r.median_m)), y: tt.map((r) => r.club), mode: 'markers', name: 'Median', marker: { color: css('--ink'), size: 9 },
    text: tt.map((r) => `IQR ${d0(r.p25_m)}–${D(r.p75_m)} · n=${r.shots_stock} (${r.sample})`), hovertemplate: `%{y}: %{x:.0f} ${UNIT}<br>%{text}<extra></extra>` });
  const tg = tt.filter((r) => A.isNum(r.target_total_m));
  if (tg.length) tr.push({ x: tg.map((r) => cv(r.target_total_m)), y: tg.map((r) => r.club), mode: 'markers', name: 'Your target total', marker: { symbol: 'diamond-open', size: 11, color: P.bad } });
  const sel = ui.cl_dist || t.filter((x) => x.sample !== 'insufficient').slice(0, 4).map((x) => x.club);
  const stock = A.stockShots(s, ds.clubs).filter((x) => !x.partial && !x.partial_by_intent && sel.includes(x.club));
  const trend = sel.map((c, i) => { const id = ds.clubs.find((x) => x.name === c)?.club_id, d = id ? A.distanceTrend(s, ds.clubs, id) : []; return { x: d.map((p) => p.period), y: d.map((p) => cv(p.median_m)), name: c, mode: 'lines+markers', line: { color: COLORS[i % 12] } }; });
  const insuff = t.filter((x) => x.sample === 'insufficient').map((x) => x.club);
  return `${filterSummary(ds)}<div class="warn"><b>Distances are GPS total (start → where the ball finished), not carry.</b> Roll is included; watch GPS error is a few ${UNIT === 'yd' ? 'yards' : 'metres'} per point. Carry only appears as your own target.</div>
  ${seg('cl_scope', [['both', 'Tee + approach'], ['tee', 'Tee only'], ['approach', 'Approach only']], 'both')}
  <div class="card"><h2>Gapping</h2>${chips('cl_cmp', t.map((x) => x.club))}${plot(tr, { height: Math.max(300, 30 * tt.length + 90), xaxis: { title: { text: `GPS total distance (${UNIT})` } }, margin: { l: 96, r: 10, t: 10, b: 50 }, hovermode: 'closest' })}
  ${note('Thick bar = middle 50% of stock shots, thin = p10–p90, dot = median. Blue ≥20 shots, orange 8–19, grey <8 (not used). Tap clubs above to compare.')}</div>
  <div class="card"><h2>Gaps & overlaps</h2>${table(gp, [['longer', 'Longer'], ['shorter', 'Shorter'], ['gap_m', `Gap ${UNIT}`, d0], ['overlap_pct', 'IQR overlap', p0], ['flag', 'Flag']], { empty: 'Need two clubs with ≥8 stock shots.' })}
  ${note(`Large gap >${D(25)}; overlap when middle-50% ranges overlap by more than half the narrower one, or medians <${D(5)} apart.`)}</div>
  <div class="card"><h2>Club table</h2>${table(t, [['club', 'Club'], ['sample', 'Sample', badge], ['shots_stock', 'Stock', n0], ['median_m', `Median ${UNIT}`, d0], ['p25_m', 'p25', d0], ['p75_m', 'p75', d0], ['p10_m', 'p10', d0], ['p90_m', 'p90', d0], ['sd_m', 'SD', d1], ['cv_pct', 'CV%', n1], ['partial_pct', 'Mishit%', n0], ['partial_by_intent', 'Partial', n0], ['lateral_sd_m', 'L/R SD', d1], ['short_miss_pct', 'Short%', n0], ['long_miss_pct', 'Long%', n0], ['target_carry_m', 'Tgt carry', d0], ['target_total_m', 'Tgt total', d0], ['vs_target_total_m', 'vs tgt', d0], ['inconsistent', 'Inconsistent', (v) => (v ? '<span class="pill mid">yes</span>' : '')], ['shots_all', 'All shots', n0]])}
  ${note('Stock shots exclude penalties, GPS errors, your exclusions, deliberate partial swings (approach with the pin <80% of the club\'s reference distance) and mishits (<60%). Reference = your target total (or carry +5%) if set, else the club\'s 80th percentile.')}
  ${insuff.length ? `<p class="small">Insufficient data (&lt;8 stock shots): ${esc(insuff.join(', '))}</p>` : ''}</div>
  <div class="card"><h2>Distribution & trend</h2>${chips('cl_dist', t.map((x) => x.club), sel)}
  ${sel.length ? plot(sel.map((c, i) => ({ x: stock.filter((x) => x.club === c).map((x) => cv(x.dist_m)), name: c, type: 'box', orientation: 'h', boxpoints: 'all', jitter: 0.4, pointpos: 0, marker: { size: 4, color: COLORS[i % 12] } })), { height: 70 * sel.length + 80, showlegend: false, margin: { l: 96, r: 10, t: 10, b: 40 }, xaxis: { title: { text: UNIT } } }) : ''}
  ${sel.length ? plot(trend, { title: `Median stock distance by quarter (${UNIT})`, height: 260 }) : ''}</div>`;
}

function pageDispersion() {
  const ds = filtered({ allFormats: true }), s = ds.shots;
  if (!s.length) return '<div class="card">No shot data in this selection.</div>';
  const mode = segVal('dp_mode', 'approach'), opts = ds.clubs.filter((c) => c.category !== 'putter' && s.some((x) => x.club_id === c.club_id)).map((c) => c.name);
  const sel = ui.dp_clubs || (mode === 'tee' ? opts.filter((c) => /driver/i.test(c)).slice(0, 1) : opts.slice(5, 6));
  const pts = A.pattern(sel.length ? s.filter((x) => sel.includes(x.club)) : s, mode), st = A.dispersionStats(pts);
  const tr = [...new Set(pts.map((p) => p.club))].map((c, i) => ({ x: pts.filter((p) => p.club === c).map((p) => cv(p.x)), y: pts.filter((p) => p.club === c).map((p) => cv(p.y)), name: c, mode: 'markers', type: 'scatter', marker: { size: 7, color: COLORS[i % 12], opacity: 0.8 }, text: pts.filter((p) => p.club === c).map((p) => `${p.date} · ${D(p.dist_m)}`) }));
  if (st.enough) for (const [q, dash] of [[0.5, 'solid'], [0.9, 'dash']]) { if (q === 0.9 && !st.enough_90) continue; const [ex, ey] = A.ellipse(st.centre, st.cov, q); tr.push({ x: cvA(ex), y: cvA(ey), mode: 'lines', name: `${q * 100}%`, line: { color: css('--ink'), dash, width: 1.5 } }); }
  if (mode === 'approach') tr.push({ x: [0], y: [0], mode: 'markers', name: 'Pin', marker: { symbol: 'x', size: 12, color: P.bad } });
  return `${filterSummary(ds)}<div class="card"><h2>Dispersion by club</h2>${seg('dp_mode', [['approach', 'Approach (vs pin)'], ['tee', 'Tee (vs aim line)']], 'approach')}${chips('dp_clubs', opts, sel)}
  <div class="kpis" style="margin-top:10px">${kpi('Shots', st.n, null, true, 0)}${st.enough ? kpi(`Mean lateral (${UNIT}, + right)`, cv(st.mean_lateral_m)) + kpi(`Lateral SD (${UNIT})`, cv(st.sd_lateral_m)) + kpi('Left / right', null) .replace('–', `${fmt(st.pct_left, 0)}% / ${fmt(st.pct_right, 0)}%`) + kpi(mode === 'approach' ? `Mean long/short (${UNIT})` : `Mean distance (${UNIT})`, cv(st.mean_y_m)) + kpi(`50% radius (${UNIT})`, cv(st.r50_m)) + kpi(`90% radius (${UNIT})`, st.enough_90 ? cv(st.r90_m) : null) + kpi(`50% / 90% area ${UNIT}²`, null).replace('–', `${fmt(area(st.area50_m2), 0)} / ${fmt(area(st.area90_m2), 0)}`) : ''}</div>
  ${st.enough ? '' : `<div class="warn">Dispersion statistics need ≥${A.T.min_shots_dispersion} shots (≥${A.T.min_shots_dispersion_90} for 90%). Showing raw points only.</div>`}
  ${pts.length ? plot(tr, { height: 460, xaxis: { title: { text: `Left (−) / right (+) of target line, ${UNIT}` }, zeroline: true }, yaxis: { title: { text: mode === 'approach' ? `Long (+) / short (−) of pin, ${UNIT}` : `Distance along aim line, ${UNIT}` }, ...(mode === 'approach' ? { scaleanchor: 'x' } : {}) } }, 'tall') : ''}
  ${note('Approach frame: relative to the start→pin line (pin = green centre unless moved). Tee frame: relative to the median direction of your drives on that hole (needs ≥3) – Garmin doesn\'t know your aim. Ellipses: 50%/90% bivariate normal. Shot maps for each round are on the round\'s page; on the course, Play draws this pattern on the hole.')}</div>`;
}
function mapPlot(shots, pins, sat) {
  const s = shots.filter((x) => x.start_lat !== null && x.end_lat !== null);
  if (!s.length) return '<p class="muted">No GPS positions.</p>';
  const tr = [], clubs = [...new Set(s.map((x) => x.club || 'Unassigned'))];
  const feats = [...new Set(s.map((x) => x.course_id))].flatMap((cid) => state.osm?.[cid]?.features || []);
  if (feats.length) {
    const la = s.flatMap((x) => [x.start_lat, x.end_lat]), lo = s.flatMap((x) => [x.start_lon, x.end_lon]), m = 0.0015;
    const box = [Math.min(...la) - m, Math.max(...la) + m, Math.min(...lo) - m, Math.max(...lo) + m];
    const style = { fairway: ['rgba(120,210,120,.28)', 'rgba(120,210,120,.7)'], green: ['rgba(60,230,130,.5)', 'rgba(60,230,130,.95)'], bunker: ['rgba(245,225,165,.7)', 'rgba(245,225,165,1)'], water: ['rgba(70,150,245,.5)', 'rgba(70,150,245,.9)'], tee: ['rgba(200,200,200,.35)', 'rgba(220,220,220,.8)'] };
    for (const kind of ['fairway', 'water', 'bunker', 'tee', 'green']) {
      const lat = [], lon = [];
      for (const f of feats) if (f.kind === kind && f.pts.some(([a, b]) => a >= box[0] && a <= box[1] && b >= box[2] && b <= box[3])) { f.pts.forEach(([a, b]) => { lat.push(a); lon.push(b); }); lat.push(f.pts[0][0], null); lon.push(f.pts[0][1], null); }
      if (lat.length) tr.push({ type: 'scattermap', lat, lon, mode: 'lines', fill: 'toself', fillcolor: style[kind][0], line: { color: style[kind][1], width: 1 }, name: kind, hoverinfo: 'skip', showlegend: false });
    }
  }
  clubs.forEach((c, i) => {
    const g = s.filter((x) => (x.club || 'Unassigned') === c), lat = [], lon = [], txt = [];
    g.forEach((x) => { const t = `H${x.hole} #${x.shot_order} · ${c} · ${D(x.dist_m)}`; lat.push(x.start_lat, x.end_lat, null); lon.push(x.start_lon, x.end_lon, null); txt.push(t, t, null); });
    tr.push({ type: 'scattermap', lat, lon, mode: 'lines', line: { width: 3, color: COLORS[i % 12] }, name: c, text: txt, hoverinfo: 'text' });
    tr.push({ type: 'scattermap', lat: g.map((x) => x.end_lat), lon: g.map((x) => x.end_lon), mode: 'markers', marker: { size: 7, color: COLORS[i % 12] }, showlegend: false, hoverinfo: 'skip' });
  });
  if (pins?.length) tr.push({ type: 'scattermap', lat: pins.map((p) => p.pin_lat), lon: pins.map((p) => p.pin_lon), mode: 'markers+text', text: pins.map((p) => String(p.hole)), textposition: 'top right', textfont: { color: '#fff' }, marker: { size: 10, color: '#fff' }, name: 'Pin' });
  const lats = s.flatMap((x) => [x.start_lat, x.end_lat]), lons = s.flatMap((x) => [x.start_lon, x.end_lon]);
  const clat = A.mean(lats), clon = A.mean(lons), span = Math.max(Math.max(...lats) - Math.min(...lats), (Math.max(...lons) - Math.min(...lons)) * Math.cos(clat * Math.PI / 180), 0.001);
  const zoom = Math.min(18.5, Math.max(11, Math.log2(360 / span) - 1.6));
  const map = { center: { lat: clat, lon: clon }, zoom, style: sat ? 'white-bg' : 'open-street-map' };
  if (sat) map.layers = [{ below: 'traces', sourcetype: 'raster', source: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], sourceattribution: 'Esri World Imagery' }];
  return plot(tr, { map, height: 480, margin: { l: 0, r: 0, t: 0, b: 0 }, legend: { orientation: 'h', y: 1.02, bgcolor: 'rgba(255,255,255,.7)' } }, 'map');
}

function pageSG() {
  const ds = filtered();
  if (!ds.rounds.length) return noMatch;
  const base = segVal('sg_base', 'personal'), res = A.strokesGained(ds, TOUR, base, DS), cov = res.coverage;
  const head = `${filterSummary(ds)}${seg('sg_base', [['personal', 'Personal baseline'], ['tour', 'PGA Tour (reference)']], 'personal')}
  <div class="kpis">${kpi('Complete holes', cov.complete_holes, null, true, 0)}${kpi('Coverage', 100 * cov.coverage, null, true, 0, '%')}${kpi('Holes missing swings', ds.holes.filter((h) => h.swings_missing > 0).length, null, false, 0)}${kpi('Holes missing putts', ds.holes.filter((h) => h.putts_eff === null).length, null, false, 0)}</div>`;
  if (cov.coverage < A.T.sg_min_coverage) return head + `<div class="err">Only ${Math.round(cov.coverage * 100)}% of holes have a complete shot chain (score = tracked swings + putts + penalties, putts recorded, pin known). Strokes gained needs ≥${A.T.sg_min_coverage * 100}% and is <b>not available</b> for this selection. Add the shots AutoShot missed (usually chips) in Rounds → a round → Review.</div>`;
  const sm = A.sgSummary(res), est = A.mean(res.states.filter((x) => x.kind === 'green').map((x) => (x.putt_dist_estimated ? 1 : 0))) || 0;
  const cats = A.SG_CATS, br = res.byRound;
  const roll = cats.map((c, i) => { const v = br.map((r) => r[`${c}_per18`]); return { x: br.map((r) => r.date), y: v.map((_, j) => (j >= 4 ? A.mean(v.slice(Math.max(0, j - 9), j + 1)) : null)), name: c, mode: 'lines', line: { color: COLORS[i] } }; });
  const sw = res.states.filter((x) => x.kind === 'swing' && A.isNum(x.sg));
  const byClub = [...A.groupBy(sw, (x) => `${x.category}|${x.club}`)].map(([k, g]) => ({ category: k.split('|')[0], club: g[0].club, shots: g.length, sg_per_shot: A.mean(g.map((x) => x.sg)), sg_total: A.sum(g.map((x) => x.sg)) })).filter((x) => x.shots >= 5).sort((a, b) => a.sg_per_shot - b.sg_per_shot);
  return head + `<div class="card"><h2>Average per 18 complete holes</h2>${plot([{ x: sm.map((x) => x.category), y: sm.map((x) => x.sg_per_round), type: 'bar', marker: { color: sm.map((x) => ((x.sg_per_round ?? 0) >= 0 ? P.good : P.bad)) }, text: sm.map((x) => sgn(x.sg_per_round)), textposition: 'outside' }], { height: 280 })}
  <p class="small">${base === 'personal' ? 'Zero = your own average across every round stored. Negative recent values = losing strokes vs your usual level; positive = improving.' : 'Versus a PGA Tour player: every amateur category is negative – compare categories with each other, not with zero.'}</p>
  ${note(`Measured: lies and positions from Garmin GPS (straight line to pin). Estimated: ${Math.round(est * 100)}% of putting states use a GPS-estimated first-putt distance. 'unattributed' = penalties recorded on a hole but not against a shot.`)}</div>
  <div class="card"><h2>Rolling 10-round trend</h2>${plot(roll, { height: 280, shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 0, y1: 0, line: { color: '#888' } }] })}
  ${table([...br].reverse(), [['date', 'Date'], ['complete_holes', 'Holes', n0], ...cats.map((c) => [`${c}_per18`, c.replace('Around the green', 'ARG').replace('Off the tee', 'OTT'), (v) => sgn(v)]), ['total_per18', 'Total', (v) => sgn(v)]])}</div>
  <div class="card"><h2>By club</h2>${table(byClub, [['club', 'Club'], ['category', 'Category'], ['shots', 'n', n0], ['sg_per_shot', 'SG/shot', (v) => sgn(v, 3)], ['sg_total', 'Total', (v) => sgn(v)]], { empty: 'Needs ≥5 SG-eligible shots per club.' })}</div>`;
}

function killersCard(rid) {
  const k = F.scoreKillers(DS.holes.filter((h) => h.round_id === rid), DS.shots.filter((s) => s.round_id === rid), F.shortIronRange(DS)).get(rid);
  if (!k) return '';
  return `<h3>Score killers <span class="small muted">${k.total ? `${k.total} this round` : 'none – clean round'}</span></h3><div class="killers">${F.KILLERS.map(([key, label]) => `<div class="${k[key] ? 'hit' : ''}"><b>${k[key]}</b><span>${label}</span></div>`).join('')}</div>`;
}
function sideCard(rid) {
  const sr = (state.journal.sideResults || []).find((x) => x.round_id === rid);
  const cc = (state.journal.course_challenges || []).find((x) => x.round_id === rid), chd = cc ? CH.byKey(cc.key) : null;
  const chal = chd ? `<h3>Round challenge</h3><div class="chal ${cc.achieved ? 'achieved' : 'failed'}"><b>${esc(CH.titleFor(chd, cc.n || 18))}</b><span>${cc.achieved ? 'done ✓' : 'not this time'}</span></div><p class="small muted" style="margin:4px 0 0">${chd.kind === 'zero' ? `${cc.value} ${esc(chd.short)}` : `${cc.value} of ${cc.goal}`}${cc.achieved ? ' · counted as a hit towards your potential' : ''}</p>` : '';
  return chal + (sr ? `<h3>Side games</h3>${EXTRA.play.standingsHtml(sr.game)}` : '');
}
function roundDetail(rid) {
  const row = DS.rounds.find((x) => x.round_id === rid); if (!row) return null;
  const tab = segVal('rd_tab', 'card'), hh = DS.holes.filter((h) => h.round_id === rid).sort((a, b) => a.hole - b.hole), rs = DS.shots.filter((s) => s.round_id === rid);
  const needs = EXTRA.reviewNeeds(DS, rid).filter((x) => x.any).length;
  let body = '';
  if (tab === 'map') {
    body = `<div class="card">${mapPlot(rs.filter((x) => x.category !== 'penalty'), hh.filter((h) => h.pin_lat !== null), segVal('dp_sat', '1') === '1')}${seg('dp_sat', [['1', 'Satellite'], ['0', 'Map']], '1')}${note('Lines = tracked shots coloured by club. Shots AutoShot missed aren\'t shown.')}</div>${row.course_id ? EXTRA.osmCard(row.course_id) : ''}`;
  } else if (tab === 'review') {
    EMBED = rid; ui.rv_round = rid; body = EXTRA.render.review(); SUBWIRE.push('review');
  } else if (tab === 'edit') {
    EMBED = rid; ui.ed_round = rid; body = pageEdit(true);
  } else {
    const use = [...A.groupBy(rs.filter((s) => s.club_id), (s) => s.club)].map(([c, g]) => ({ club: c, shots: g.length })).sort((a, b) => b.shots - a.shots);
    body = `<div class="card"><div class="kpis">${kpi('Gross', row.gross, null, false, 0)}${kpi('Stableford', row.stableford_round, null, true, 0)}${kpi('GIR', row.gir_pct, null, true, 0, '%')}${kpi('Fairways', row.fw_pct, null, true, 0, '%')}${kpi('Putts', row.putts_round, null, false, 0)}${kpi('Penalties', row.penalties, null, false, 0)}${kpi('Differential', row.differential)}${kpi('Playing hcp', row.ph, null, true, 0)}</div>
    <p class="small muted">${esc(row.tee || '?')} tee · CR ${fmt(row.course_rating)} / slope ${fmt(row.slope, 0)} · HI ${fmt(row.hi)} (${esc(row.hi_source || 'none')}) · ${esc(row.stableford_source || 'Stableford not reconstructable')}${state.weather?.[rid] ? ` · ${fmt(state.weather[rid].temp_c, 0)}°C, wind ${fmt(state.weather[rid].wind_kmh, 0)} km/h` : ''}</p>
    <h3>Scorecard</h3>${table(hh, [['hole', 'H'], ['par', 'Par'], ['stroke_index', 'SI', n0], ['strokes', 'Score', n0], ['putts_eff', 'Putts', n0], ['penalties_eff', 'Pen', n0], ['fairway', 'FW'], ['gir_eff', 'GIR', (v) => (v === 1 ? '✓' : v === 0 ? '·' : '–')], ['stableford', 'Pts', n0], ['swings_missing', 'Missing', n0]])}
    ${killersCard(rid)}${sideCard(rid)}${PROG ? PROG.roundPayoffHtml(rid) : ''}
    <h3>Club usage</h3>${table(use, [['club', 'Club'], ['shots', 'Shots', n0]])}
    <details><summary>All shots</summary>${table(rs, [['hole', 'H'], ['shot_order', '#', n0], ['club', 'Club'], ['category', 'Type'], ['start_lie', 'Lie'], ['dist_m', `Dist ${UNIT}`, d0], ['start_to_pin', 'To pin', d0], ['lateral_m', 'Lat', d1], ['excluded_reason', 'Excluded']])}</details>
    ${note('Missing = score − putts − penalties − tracked swings (shots AutoShot didn\'t detect). Add them on the Review tab.')}
    <p><button class="btn" data-share="${esc(rid)}">${icon('share', 18)} Share round card</button></p>
    ${row.origin === 'manual' ? `<p class="small muted">Entered by hand on this phone. <button class="btn sec sm" data-delround="${esc(row.source_id)}">Delete this round</button></p>` : ''}</div>`;
  }
  return `<div id="rdetail"><button class="back" id="rdClose">‹ All rounds</button><h2 class="rtitle">${esc(row.course_name || 'Round')}</h2><p class="small muted" style="margin:0 0 10px">${esc(row.date)}${row.format !== '18' ? ` · ${esc(row.format)} holes` : ''}${row.origin === 'manual' ? ' · entered on phone' : ''}</p>
    ${seg('rd_tab', [['card', 'Scorecard'], ['map', 'Shot map'], ['review', needs ? `Review (${needs})` : 'Review'], ['edit', 'Edit']], 'card', 'scroll')}${body}</div>`;
}
function pageRounds() {
  const open = ui.rd_open && roundDetail(ui.rd_open);
  if (open) return open;
  const ds = filtered(), r = [...ds.rounds].reverse();
  if (!r.length) return noMatch;
  const a = segVal('cmp_a', r[0].round_id), b = segVal('cmp_b', r[1]?.round_id || r[0].round_id), ra = r.find((x) => x.round_id === a), rb = r.find((x) => x.round_id === b);
  const ms = ['gross', 'to_par', 'stableford_round', 'differential', 'gir_pct', 'fw_pct', 'putts_round', 'putts_per_gir', 'three_putts', 'penalties', 'blowups'];
  const cmp = ra && rb ? ms.map((m) => ({ m: A.METRICS[m]?.[0] || m, a: ra[m], b: rb[m], d: A.isNum(ra[m]) && A.isNum(rb[m]) ? rb[m] - ra[m] : null })) : [];
  const ha = ds.holes.filter((h) => h.round_id === a), hb = ds.holes.filter((h) => h.round_id === b);
  const short = (x) => `${x.date} · ${x.course_name || ''} (${x.gross ?? '–'})`;
  return `${filterSummary(ds)}<div class="card"><h2>Round history <span class="small muted">(tap a round)</span></h2>${table(r, [['date', 'Date'], ['course_name', 'Course'], ['format', 'Holes'], ['gross', 'Gross', n0], ['stableford_round', 'Pts', n0], ['differential', 'Diff', n1], ['gir_pct', 'GIR', p0], ['fw_pct', 'FW', p0], ['putts_round', 'Putts', n0], ['penalties', 'Pen', n0], ['chain_coverage', 'Shot chain', (v) => fmt(v * 100, 0, '%')]], { click: true, id: 'roundsTbl' })}</div>
  <div class="card"><h2>Compare two rounds</h2>${select('cmp_a', r.map((x) => [x.round_id, short(x)]), a, 'Round A')}${select('cmp_b', r.map((x) => [x.round_id, short(x)]), b, 'Round B')}
  ${table(cmp, [['m', 'Metric'], ['a', 'A', n1], ['b', 'B', n1], ['d', 'B − A', (v) => sgn(v, 1)]])}
  ${plot([{ x: ha.map((h) => h.hole), y: ha.map((h) => h.to_par), type: 'bar', name: 'A' }, { x: hb.map((h) => h.hole), y: hb.map((h) => h.to_par), type: 'bar', name: 'B' }], { barmode: 'group', height: 240, title: 'To par by hole', xaxis: { dtick: 1 } })}
  ${ra && rb && ra.course_id !== rb.course_id ? note('Different courses – compare the differential rather than gross.') : ''}</div>`;
}

function coachingPriorities() {
  const w = segVal('co_win', '20'), ds = A.filterDataset(DS, { formats: ['18'], lastN: w === 'all' ? null : Number(w) });
  const fs = A.findings(ds, UNIT);
  const head = `${seg('co_win', [['20', 'Last 20 rounds'], ['40', 'Last 40'], ['all', 'All']], '20')}<p class="small muted">Based on ${ds.rounds.length} 18-hole rounds; recomputed after every import or correction.</p>`;
  if (!fs.length) return head + '<div class="card">Needs at least 8 18-hole rounds with scorecard data to rank priorities.</div>';
  const ca = A.clubAttention(ds, 3, UNIT), all18 = DS.rounds.filter((r) => r.format === '18');
  const sust = ['differential', 'stableford_round', 'gir_pct', 'putts_round', 'penalties'].map((m) => { const c = A.compareWindows(all18.map((r) => r[m]), A.METRICS[m][1]); return { m: A.METRICS[m][0], ...Object.fromEntries(c.map((x) => [`w${x.window}`, x.verdict])) }; });
  const vcol = (v) => `<span class="${v === 'improving' ? 'good' : v === 'worse' ? 'bad' : 'muted'}">${esc(v)}</span>`;
  return head + `${PROG ? PROG.levelUpCard(undefined, { link: true }) : ''}<div class="card"><h2>Quick wins: play your best golf more often</h2>${table(fs.map((f, i) => ({ i: i + 1, t: f.title, s: f.strokes_per_round, now: f.current, tgt: f.target, u: f.unit, pat: f.consistency.split(' - ')[0], c: f.confidence })),
    [['i', '#'], ['t', 'Area'], ['s', 'Strokes/rd', n2], ['now', 'Now', (v, r) => fmt(v, 1, r.u === '%' ? '%' : '')], ['tgt', 'Your best ¼', (v, r) => fmt(v, 1, r.u === '%' ? '%' : '')], ['pat', 'Pattern'], ['c', 'Confidence']])}
  ${note('"Strokes/rd" = what you\'d save by playing at the level you already reach in your best 25% of rounds – your data, not a generic amateur norm. Areas overlap, so use the order rather than the sum.')}</div>
  ${fs.map((f, i) => `<div class="card finding"><h3>${i + 1}. ${esc(f.title)} — ~${fmt(f.strokes_per_round)} strokes/round</h3><b class="small">Evidence</b><ul>${f.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
    <p><b>Why it matters:</b> ${esc(f.why)}</p><p><b>Practice focus:</b> ${esc(f.focus)}</p><p><b>Target:</b> ${esc(f.target_text)}</p><p><b>Tracking:</b> ${esc(f.tracking)}</p>
    <p class="small muted">${esc(f.consistency)} · confidence ${esc(f.confidence)}${f.extra?.note ? ` · ${esc(f.extra.note)}` : ''}</p></div>`).join('')}
  <div class="card"><h2>Clubs needing attention</h2>${ca.length ? ca.map((c) => `<p><b>${esc(c.club)}</b><br><span class="small">${c.evidence.map(esc).join(' · ')}</span></p>`).join('') : '<p class="muted">Not enough club data.</p>'}
  ${note('Ranked by distance variability vs the rest of your bag, mishit rate and lateral spread; clubs with <8 stock shots are not ranked.')}</div>
  <div class="card"><h2>Is the improvement sustained?</h2>${table(sust, [['m', 'Metric'], ['w5', '5 rds', vcol], ['w10', '10', vcol], ['w20', '20', vcol], ['w50', '50', vcol]])}${note('Last N 18-hole rounds vs the N before (Welch t-test, p < 0.10).')}</div>`;
}

function pageData() {
  const sc = state.sync || {}, job = sc.last_job, log = state.importLog || [];
  const all = DSDUP || (DSDUP = A.buildDataset(state, { ...BUILD, includeDuplicates: true })), r = all.rounds, h = all.holes, s = all.shots;
  const cov = (a) => (a.length ? `${Math.round(100 * a.filter(Boolean).length / a.length)}%` : '–');
  const comp = r.length ? [
    ['Course rating & slope', cov(r.map((x) => x.course_rating !== null && x.slope !== null)), 'Settings → Courses'], ['Stroke index', cov(h.map((x) => x.stroke_index !== null)), 'Settings → Courses'],
    ['Handicap index at round date', cov(r.map((x) => x.hi !== null)), 'Settings → Handicap'], ['Putts (trusted)', cov(h.map((x) => x.putts_eff !== null)), 'Rounds → a round → Edit → Holes'],
    ['Fairway result (par 4/5)', cov(h.filter((x) => x.par >= 4).map((x) => x.fw_hit !== null)), 'Rounds → a round → Edit → Holes'], ['Shots with a club', cov(s.map((x) => !!x.club_id)), 'Rounds → a round → Edit → Shots'],
    ['Holes with complete shot chain', cov(h.map((x) => x.chain_complete)), 'Rounds → a round → Review']].map(([f, c, fix]) => ({ f, c, fix })) : [];
  const dups = r.filter((x) => x.duplicate_of);
  const issues = (all.issues || []).filter((i) => i.severity !== 'info');
  return `${demoBanner()}<div class="card"><h2>Cloud sync</h2>${sc.owner ? `<p class="small">Repo <b>${esc(sc.owner)}/${esc(sc.repo)}</b> · last sync ${esc(sc.last_sync ? new Date(sc.last_sync).toLocaleString() : 'never')}</p>` : '<p class="small">Not set up – see Settings → Cloud sync and Help.</p>'}
  ${job ? `<div class="${job.status === 'ok' ? 'ok' : 'warn'}">Garmin sync job: <b>${esc(job.status)}</b> at ${esc(job.finished_at || '?')}${job.message ? `<br>${esc(job.message)}` : ''}</div>` : ''}
  <button class="btn" id="syncNow" ${sc.owner ? '' : 'disabled'}>Sync now</button><span id="syncMsg" class="small"></span></div>
  <div class="card"><h2>Import a file</h2><p class="small">Garmin export from the bookmarklet, raw round JSON, or a desktop GolfIQ export. Re-importing is safe: unchanged rounds are skipped, nothing is duplicated.</p>
  <input type="file" id="impFile" accept=".json,application/json" multiple><div id="impMsg" class="small"></div><p class="small"><a href="#help">How to export from Garmin on this phone →</a></p></div>
  <div class="card"><h2>Import history</h2>${table(log.slice(0, 12), [['ts', 'When', (v) => esc(new Date(v).toLocaleString())], ['source', 'Source'], ['new', 'New', n0], ['updated', 'Upd', n0], ['unchanged', 'Same', n0], ['failed', 'Failed', n0]], { empty: 'No imports yet.' })}
  ${log.some((l) => l.errors?.length) ? `<details><summary>Errors</summary><pre class="small" style="white-space:pre-wrap">${esc(log.flatMap((l) => l.errors || []).slice(0, 30).join('\n'))}</pre></details>` : ''}</div>
  <div class="card"><h2>Data completeness</h2><div class="kpis">${kpi('Rounds stored', r.length, null, true, 0)}${kpi('Duplicates hidden', dups.length, null, false, 0)}${kpi('Shots', s.length, null, true, 0)}${kpi('Corrections', state.corrections.filter((c) => c.active).length, null, true, 0)}</div>
  ${table(comp, [['f', 'Field'], ['c', 'Coverage'], ['fix', 'Fix in']])}
  ${issues.length ? `<details><summary>Missing information (${issues.length})</summary>${table(issues.slice(0, 200), [['round_id', 'Round'], ['severity', 'Level'], ['field', 'Field'], ['message', 'Message']])}</details>` : ''}
  ${dups.length ? `<details><summary>Duplicate rounds (${dups.length})</summary>${table(dups, [['date', 'Date'], ['course_name', 'Course'], ['duplicate_of', 'Kept']])}${note('Same course, start within 20 min; the copy with more shots is kept.')}</details>` : ''}</div>
  <div class="card"><h2>Backup & restore</h2><p class="small">Your data exists only on this phone. Save a backup to Files/iCloud Drive regularly – removing the home-screen app or clearing Safari data deletes it.</p>
  <button class="btn" id="bkSave">Save backup</button><label class="btn sec" style="position:relative">Restore…<input type="file" id="bkLoad" accept=".json" style="position:absolute;inset:0;opacity:0"></label>
  <p class="small muted" id="persist"></p><details><summary class="small">Danger zone</summary><button class="btn danger" id="wipe">Delete all data on this phone</button><p class="small muted">Keeps the cloud-sync connection, so Sync now brings your Garmin rounds straight back.</p></details></div>`;
}

function pageEdit(embed = false) {
  if (!DS.rounds.length) return emptyMsg();
  const all = DSDUP || (DSDUP = A.buildDataset(state, { ...BUILD, includeDuplicates: true, includeExcluded: true }));
  const rs = [...all.rounds].reverse(), rid = (embed && EMBED) || segVal('ed_round', rs[0].round_id), row = rs.find((x) => x.round_id === rid) || rs[0];
  const tab = embed && segVal('ed_tab', 'holes') === 'audit' ? 'holes' : segVal('ed_tab', 'holes'), clubs = all.clubs;
  const clubOpts = (cur) => `<option value="">(none)</option>${clubs.map((c) => `<option value="${esc(c.club_id)}" ${c.club_id === cur ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`;
  const lieOpts = (cur) => ['', 'Tee', 'Fairway', 'Rough', 'Sand', 'Recovery', 'Fringe', 'Green', 'Water', 'OB'].map((l) => `<option ${l === (cur || '') ? 'selected' : ''}>${l}</option>`).join('');
  let body = '';
  if (tab === 'round') {
    const v = (k) => esc(row[k] ?? '');
    body = `<form id="roundForm"><div class="row"><div><label class="f">Course name</label><input name="course_name" value="${v('course_name')}"></div><div><label class="f">Tee</label><input name="tee" value="${v('tee')}"></div></div>
    <div class="row"><div><label class="f">Course rating</label><input name="course_rating" type="number" step="0.1" value="${v('course_rating')}"></div><div><label class="f">Slope</label><input name="slope" type="number" step="1" value="${v('slope')}"></div></div>
    <div class="row"><div><label class="f">Handicap index (this round only)</label><input name="handicap_index" type="number" step="0.1" value="${v('handicap_index')}"></div><div><label class="f">Weather</label><input name="weather" value="${v('weather')}"></div></div>
    <label class="f">Conditions (wind, firmness…)</label><input name="conditions" value="${v('conditions')}" style="width:100%"><label class="f">Notes</label><input name="notes" value="${v('notes')}" style="width:100%">
    <p><label><input type="checkbox" name="is_competition" ${row.is_competition ? 'checked' : ''}> Competition round</label> &nbsp; <label><input type="checkbox" name="excluded" ${row.excluded ? 'checked' : ''}> Exclude from analysis</label></p>
    <label class="f">Reason</label><input name="_reason" style="width:100%"><p><button class="btn">Save round changes</button></p></form>${note('Rating/slope here apply to this round only; for every round at a course use Settings → Courses.')}`;
  } else if (tab === 'holes') {
    const hh = all.holes.filter((h) => h.round_id === row.round_id).sort((a, b) => a.hole - b.hole);
    body = `<form id="holeForm"><div class="tbl"><table><thead><tr><th>H</th><th>Par</th><th>Score</th><th>Putts</th><th>Pen</th><th>FW</th><th>GIR override</th><th>1st putt ${PUNIT()}</th><th>Putts ok</th><th>Excl</th></tr></thead><tbody>
    ${hh.map((h) => `<tr data-h="${h.hole}"><td>${h.hole}<br><span class="small muted">${esc(h.putts_status)}</span></td><td><input name="par" type="number" value="${h.par ?? ''}" style="width:52px"></td><td><input name="strokes" type="number" value="${h.strokes ?? ''}" style="width:56px"></td><td><input name="putts" type="number" value="${h.putts ?? ''}" style="width:52px"></td><td><input name="penalties" type="number" value="${h.penalties ?? ''}" style="width:52px"></td>
    <td><select name="fairway">${['', 'HIT', 'LEFT', 'RIGHT', 'SHORT', 'LONG', 'NA'].map((f) => `<option ${f === (h.fairway || '') ? 'selected' : ''}>${f}</option>`).join('')}</select></td>
    <td><select name="gir">${[['', 'auto'], ['1', 'yes'], ['0', 'no']].map(([vv, l]) => `<option value="${vv}" ${String(h.gir === true ? 1 : h.gir === false ? 0 : h.gir ?? '') === vv ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
    <td><input name="first_putt_m" type="number" step="0.5" value="${A.isNum(h.first_putt_m) ? Math.round(pcv(h.first_putt_m) * 10) / 10 : ''}" style="width:64px"></td><td><input type="checkbox" name="putts_confirmed" ${h.putts_confirmed ? 'checked' : ''}></td><td><input type="checkbox" name="excluded" ${h.excluded ? 'checked' : ''}></td></tr>`).join('')}
    </tbody></table></div><label class="f">Reason</label><input name="_reason" style="width:100%"><p><button class="btn">Save hole changes</button></p></form>
    ${note('"Putts ok" confirms a round where every hole really was 2 putts. First-putt distance unlocks putting-by-distance and better strokes gained.')}`;
  } else if (tab === 'shots') {
    const hs = [...new Set(all.shots.filter((s) => s.round_id === row.round_id).map((s) => s.hole))].sort((a, b) => a - b);
    const hole = Number(segVal('ed_hole', hs[0] || 1)), ss = all.shots.filter((s) => s.round_id === row.round_id && s.hole === hole);
    body = `${select('ed_hole', hs.map((x) => [x, `Hole ${x}`]), hole, 'Hole')}<form id="shotForm">${ss.map((s) => `<div class="card" data-k="${esc(s.shot_key)}" style="padding:10px"><b>#${fmt(s.shot_order, 0)}</b> <span class="small muted">${esc(s.category)} · ${D(s.dist_m)} · ${esc(s.source)}${s.excluded_reason && s.excluded_reason !== 'user' ? ` · auto-excluded: ${esc(s.excluded_reason)}` : ''}</span>
      <div class="row"><div><label class="f">Club</label><select name="club_id">${clubOpts(s.club_id)}</select></div><div><label class="f">Type</label><select name="shot_category">${['', 'tee', 'approach', 'recovery', 'around_green', 'putt', 'penalty'].map((c) => `<option ${c === (s.shot_category || '') ? 'selected' : ''} value="${c}">${c || `auto: ${s.category.replace('_', ' ')}`}</option>`).join('')}</select></div></div>
      <div class="row"><div><label class="f">Start lie</label><select name="start_lie">${lieOpts(s.start_lie)}</select></div><div><label class="f">End lie</label><select name="end_lie">${lieOpts(s.end_lie)}</select></div></div>
      <p><label><input type="checkbox" name="excluded" ${s.excluded_reason === 'user' ? 'checked' : ''}> Exclude from analysis</label>${s.source === 'manual' ? ` <button type="button" class="btn sec" data-delshot="${esc(s.shot_key)}">Remove manual shot</button>` : ''}</p></div>`).join('') || '<p class="muted">No shots on this hole.</p>'}
      <label class="f">Reason</label><input name="_reason" style="width:100%"><p><button class="btn">Save shot changes</button></p></form>`;
  } else if (tab === 'add') {
    body = `<form id="addForm"><div class="row"><div><label class="f">Hole</label><input name="hole" type="number" min="1" max="18" value="1"></div><div><label class="f">Shot order (2.5 = between 2 and 3)</label><input name="shot_order" type="number" step="0.5" value="2.5"></div></div>
    <div class="row"><div><label class="f">Club</label><select name="club_id">${clubOpts(null)}</select></div><div><label class="f">Start lie</label><select name="start_lie">${lieOpts('Rough')}</select></div><div><label class="f">End lie</label><select name="end_lie">${lieOpts('Green')}</select></div></div>
    <div class="row"><div><label class="f">Shot distance ${UNIT} (optional)</label><input name="dist_m" type="number"></div><div><label class="f">Distance to pin at start ${UNIT} (enables SG)</label><input name="start_to_pin_m" type="number"></div></div>
    <label class="f">Reason</label><input name="_reason" value="AutoShot missed this shot" style="width:100%"><p><button class="btn">Add shot</button></p></form>
    ${note('A manual shot has no GPS position: it completes the hole\'s shot count but isn\'t on maps or in dispersion.')}`;
  } else {
    const act = state.corrections.filter((c) => c.active).sort((a, b) => b.id - a.id);
    body = `<h3>Active corrections (${act.length})</h3>${table(act, [['id', '#'], ['created_at', 'When', (v) => esc(String(v).slice(0, 16))], ['entity', 'On'], ['key', 'Key', (v) => esc(String(v).slice(-22))], ['field', 'Field'], ['old_value', 'Was', (v) => esc(JSON.stringify(v))], ['value', 'Now', (v) => esc(JSON.stringify(v))], ['reason', 'Reason'], ['id', '', (v) => `<button class="btn sec" data-revert="${v}">Revert</button>`]], { empty: 'None.' })}
    <details><summary>Full audit log (${state.audit.length})</summary>${table([...state.audit].reverse().slice(0, 300), [['ts', 'When', (v) => esc(String(v).slice(0, 16))], ['action', 'Action'], ['entity', 'On'], ['entity_key', 'Key', (v) => esc(String(v ?? '').slice(-22))], ['detail', 'Detail', (v) => `<span class="small">${esc(JSON.stringify(v)).slice(0, 120)}</span>`]])}</details>`;
  }
  const tabs = [['holes', 'Holes'], ['shots', 'Shots'], ['add', 'Add shot'], ['round', 'Round'], ...(embed ? [] : [['audit', 'Audit log']])];
  return `<p class="small muted">Every change is an overlay on the original Garmin record, logged and reversible. Garmin data is never overwritten.${embed ? ' <a href="#corrections">All corrections ›</a>' : ''}</p>
  ${embed ? `<input type="hidden" data-sel="ed_round" value="${esc(row.round_id)}">` : tab !== 'audit' ? select('ed_round', rs.map((x) => [x.round_id, x.label + (x.duplicate_of ? ' [duplicate]' : '') + (x.excluded ? ' [excluded]' : '')]), row.round_id, 'Round') : ''}
  ${seg('ed_tab', tabs, 'holes', 'scroll')}<div class="card">${body}</div>`;
}

function pageSettings() {
  const tab = segVal('st_tab', 'clubs'), st = state.settings;
  let body = '';
  if (tab === 'clubs') {
    const clubs = DS.clubs;
    body = `<form id="clubForm">${clubs.map((c) => `<div class="card" data-c="${esc(c.club_id)}" style="padding:10px"><div class="row"><div><label class="f">Name <span class="muted">(Garmin: ${esc(c.garmin_name || '—')})</span></label><input name="display_name" value="${esc(c.name)}"></div>
      <div><label class="f">Category</label><select name="category">${['driver', 'wood', 'hybrid', 'iron', 'wedge', 'putter', 'other'].map((x) => `<option ${x === c.category ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div>
      <div class="row"><div><label class="f">Target carry ${UNIT}</label><input name="target_carry_m" type="number" value="${inputVal(c.target_carry_m, 0)}"></div><div><label class="f">Your total ${UNIT} <span class="muted">(Play → Caddie: use it instead of GPS)</span></label><input name="target_total_m" type="number" value="${inputVal(c.target_total_m, 0)}"></div><div><label class="f">Order</label><input name="sort_order" type="number" value="${c.sort_order ?? ''}"></div></div>
      <label><input type="checkbox" name="active" ${c.active === 0 ? '' : 'checked'}> In bag</label></div>`).join('')}<p><button class="btn">Save clubs</button></p></form>
      <h3>Add a club</h3><form id="addClub" class="row"><div><input name="name" placeholder="Name"></div><div><select name="category">${['driver', 'wood', 'hybrid', 'iron', 'wedge', 'putter', 'other'].map((x) => `<option>${x}</option>`).join('')}</select></div><div><button class="btn">Add</button></div></form>
      ${note('Garmin exports a club type, not your label – rename to match your bag. Targets are your own numbers; GolfIQ never measures carry. To fix one shot\'s club use Rounds → a round → Edit → Shots.')}`;
  } else if (tab === 'courses') {
    const courses = Object.entries(DS.base.courses), cid = segVal('st_course', courses[0]?.[0]);
    const tees = Object.values(DS.base.tees).filter((t) => t.course_id === cid);
    const holes = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, ...(DS.base.chole[`${cid}|${i + 1}`] || {}) }));
    body = courses.length ? `${select('st_course', courses.map(([id, n]) => [id, n || id]), cid, 'Course')}
      <h3>Tees</h3><form id="teeForm">${tees.map((t) => `<div class="row" data-t="${esc(t.tee)}"><div><label class="f">${esc(t.tee)} <span class="muted">(${t.source})</span> rating</label><input name="rating" type="number" step="0.1" value="${t.rating ?? ''}"></div><div><label class="f">Slope</label><input name="slope" type="number" value="${t.slope ?? ''}"></div></div>`).join('')}
      <div class="row" data-t="__new"><div><label class="f">New tee name</label><input name="tee"></div><div><label class="f">Rating</label><input name="rating" type="number" step="0.1"></div><div><label class="f">Slope</label><input name="slope" type="number"></div></div><p><button class="btn">Save tees</button></p></form>
      <h3>Holes (stroke index is needed for Stableford)</h3><form id="holesForm"><div class="tbl"><table><thead><tr><th>Hole</th><th>Par</th><th>SI</th><th>Source</th></tr></thead><tbody>${holes.map((h) => `<tr data-h="${h.hole}"><td>${h.hole}</td><td><input name="par" type="number" value="${h.par ?? ''}" style="width:60px"></td><td><input name="stroke_index" type="number" value="${h.stroke_index ?? ''}" style="width:60px"></td><td class="small muted">${esc(h.source || '')}</td></tr>`).join('')}</tbody></table></div><p><button class="btn">Save holes</button></p></form>
      ${note('Your values take priority over Garmin\'s for every round on this course and survive future imports.')}` : '<p>No courses yet.</p>';
  } else if (tab === 'hcp') {
    body = `${table([...st.handicaps].reverse(), [['date', 'From'], ['handicap_index', 'Index', n1], ['note', 'Note'], ['date', '', (v) => `<button class="btn sec" data-delhcp="${esc(v)}">Delete</button>`]], { empty: 'No handicap history yet.' })}
      <form id="hcpForm" class="row"><div><label class="f">Effective from</label><input name="date" type="date" required></div><div><label class="f">Handicap index</label><input name="hi" type="number" step="0.1" required></div><div><label class="f">Note</label><input name="note"></div><div><button class="btn">Add</button></div></form>
      ${note('Each round uses the latest index on or before its date. Garmin\'s golf export has no index history – copy it from your Golf Australia / club app.')}`;
  } else {
    const sc = state.sync || {};
    body = `<form id="syncForm"><div class="row"><div><label class="f">GitHub owner (your username)</label><input name="owner" value="${esc(sc.owner || '')}" autocapitalize="off"></div><div><label class="f">Private data repo</label><input name="repo" value="${esc(sc.repo || 'golfiq-data')}" autocapitalize="off"></div></div>
      <div class="row"><div><label class="f">Branch</label><input name="branch" value="${esc(sc.branch || 'main')}"></div><div><label class="f">Folder</label><input name="path" value="${esc(sc.path || 'data')}"></div></div>
      <label class="f">Fine-grained token (read-only, this repo only)</label><input name="token" type="password" value="${esc(sc.token || '')}" style="width:100%" autocomplete="off">
      <p><button class="btn">Save</button></p></form>
      <h3>State key for the sync job</h3><p class="small">The GitHub job encrypts your Garmin login tokens with this key. Generate it here, copy it into the repo secret <code>GOLFIQ_STATE_KEY</code>. You don't need to keep it on the phone.</p>
      <button class="btn sec" id="genKey">Generate key</button><textarea id="keyOut" rows="2" readonly></textarea>
      ${note('The token is stored only on this phone and is used only to read your private repo. It\'s never included in backups.')}`;
  }
  const unitsCard = `<div class="card"><h2>Distance units</h2><div class="seg" id="unitSeg">${[['yd', 'Yards (putts in feet)'], ['m', 'Metres']].map(([v, l]) => `<button data-u="${v}" class="${UNIT === v ? 'on' : ''}">${l}</button>`).join('')}</div><p class="note">Display only – data is stored unchanged, so you can switch any time.</p></div>`;
  const rangeCard = `<div class="card"><h2>Range ball adjustment</h2><label class="f" for="rangeAdj">Extra distance for a course ball (%)</label><input id="rangeAdj" type="number" inputmode="numeric" min="0" max="${B.DRIVER_TEST.adj_max}" step="1" value="${Number(state.settings.range_ball_adj) || 0}" style="width:100%"><p class="note">Range balls and mats usually fly shorter than a course ball. The Driver test and Max out add this percentage to every distance you enter, so your level is closer to the course. 0 means no adjustment (up to ${B.DRIVER_TEST.adj_max}). If a distance comes from a premium ball on a launch monitor, tick Premium ball in the game to skip it.</p></div>`;
  const fl = FEEL.get(), FC = FEEL.COPY.settings;
  const feelCard = `<div class="card"><h2>${FC.title}</h2>
    <label class="sw"><input type="checkbox" id="feelSound" ${fl.sound ? 'checked' : ''}><span><b>${FC.sound}</b><small>${FC.soundNote}</small></span></label>
    <label class="sw"><input type="checkbox" id="feelMotion" ${fl.motion ? 'checked' : ''}><span><b>${FC.motion}</b><small>${FC.motionNote}</small></span></label>
    <p style="margin:6px 0 0"><button type="button" class="btn sec" id="feelTry">${FC.try}</button> <span class="small muted" id="feelTryOut" aria-live="polite"></span></p></div>`;
  const links = `<div class="tiles" style="margin-bottom:12px">${[['data', 'Data & sync'], ['help', 'Help & setup'], ['corrections', 'Corrections log']].map(([k, l]) => `<a class="tile" href="#${k}">${icon(PAGES[k][1])}<span>${l}</span></a>`).join('')}</div>`;
  return `${demoBanner()}${links}${unitsCard}${rangeCard}${feelCard}${seg('st_tab', [['clubs', 'Clubs'], ['courses', 'Courses'], ['hcp', 'Handicap'], ['sync', 'Garmin sync'], ['friends', 'Friends']], 'clubs', 'scroll')}${tab === 'friends' ? COMP.friendsSettings() : `<div class="card">${body}</div>`}`;
}

function pageHelp() {
  return `<div class="card"><h2>Share GolfIQ</h2><p class="small">Send the app to a friend. They get their own empty copy – your rounds stay on your phone and they never see them. Without a Garmin watch they can keep score on the Play page; with one they can follow the same setup you did.</p>
  <button class="btn" id="shareApp">${icon('share', 18)} Share the app</button></div>
  <div class="card"><h2>1 · Keep it on your home screen</h2><p>In Safari tap Share → <b>Add to Home Screen</b> and always open GolfIQ from that icon. Home-screen apps keep their data (Safari can clear site data for pages you don't visit). Save a backup (Data page) to iCloud Drive now and then.</p></div>
  <div class="card"><h2>2 · Get your Garmin data in</h2><h3>Option A – automatic cloud sync (recommended)</h3><p class="small">A scheduled GitHub job logs in to Garmin with your credentials (stored as encrypted GitHub secrets, not in this app), downloads new rounds to your private repo, and this app pulls them with <b>Sync now</b>. Full steps: <code>iphone/SETUP_IPHONE.md</code>.</p>
  <h3>Option B – export bookmarklet (no setup)</h3><ol class="small"><li>Tap <b>Copy bookmarklet</b> below.</li><li>In Safari, bookmark any page (Share → Add Bookmark), name it <b>GolfIQ export</b>.</li><li>Open Bookmarks → Edit → tap <b>GolfIQ export</b> → replace the address with the copied text → Done.</li><li>Sign in at <b>connect.garmin.com</b> in Safari (use “Request Desktop Website” if it pushes you to the app), then open Bookmarks → <b>GolfIQ export</b>.</li><li>Choose how many recent rounds (blank = all), wait, tap <b>Save file</b> → Save to Files.</li><li>Come back here → Data → <b>Import a file</b>.</li></ol>
  <button class="btn" id="copyBm">Copy bookmarklet</button><details><summary class="small">What the bookmarklet does (readable source)</summary><p class="small">Runs only on connect.garmin.com in your signed-in session; reads your scorecards, shots and club list from Garmin's own golf endpoints; builds one JSON file and offers it to save. It sends nothing anywhere else and never sees your password.</p><textarea rows="12" readonly>${esc(BOOKMARKLET_SRC)}</textarea></details></div>
  <div class="card"><h2>Coaching with Claude</h2><p class="small">Practice → Coach notes → <b>Copy briefing for Claude</b> puts your stats, club distances, wedge matrix, practice scores and recent notes on the clipboard. Paste it into a chat with Claude along with your question. Claude's reply ends with a note in GolfIQ's format – copy the reply, then tap <b>Paste note from Claude</b> and the dated feedback, feels and drills are saved in the app.</p>
  <p class="small">Practice → Games, Wedges and Log are for the range; Practice → Swing thoughts holds up to five cues. Your bag (distances, dispersion, wedge matrix) is under Stats → Bag.</p></div>
  <div class="card"><h2>3 · First-time tidy-up</h2><ol class="small"><li>Settings → Clubs: rename to your bag, set categories and optional targets.</li><li>Settings → Handicap: add your index (and past values for accurate historic Stableford).</li><li>Settings → Courses: fill missing rating/slope/stroke index (see Data → completeness).</li></ol></div>
  <div class="card"><h2>How numbers are calculated</h2><ul class="small"><li><b>Distances</b> are GPS total (start → finish), never carry.</li><li><b>Stableford</b> is reconstructed: WHS course handicap = HI × Slope/113 + (CR − Par); playing handicap 95%; strokes by stroke index.</li><li><b>Differential</b> = 113/Slope × (adjusted gross − CR), net double bogey cap.</li><li><b>GIR</b> = strokes − putts ≤ par − 2. Rounds showing 2 putts on every hole are treated as unrecorded until confirmed.</li><li><b>Strokes gained</b> only on holes with a complete shot chain; default baseline is your own average; PGA Tour is reference only.</li><li><b>Coaching</b> targets are the level you already reach in your best 25% of rounds.</li><li>Small samples are flagged: clubs need 8 stock shots (20 = reliable), dispersion 10 (20 for 90%).</li></ul><p class="small muted">Full methodology: docs/METHODOLOGY.md in the project.</p></div>`;
}

// ------------------------------------------------------------------ hubs (tabs inside the five main sections)
const STATS_TABS = [['scoring', 'Scoring'], ['tee', 'Tee'], ['approach', 'Approach'], ['short', 'Short game'], ['putting', 'Putting'], ['sg', 'Strokes gained'], ['handicap', 'Handicap'], ['bag', 'Bag'], ['insights', 'Insights']];
function pageStats() {
  const t = segVal('sx_tab', 'scoring');
  const sub = (key, tabs, dflt, map) => { const v = segVal(key, dflt), k = map[v] ? v : dflt; return seg(key, tabs, dflt) + map[k](); };
  const body = {
    scoring: pageScoring, tee: pageTee, approach: pageApproach, short: pageShort, putting: pagePutting, sg: pageSG,
    handicap: () => EXTRA.render.handicap(),
    bag: () => sub('bag_tab', [['gapping', 'Distances'], ['dispersion', 'Dispersion'], ['wedges', 'Wedge matrix']], 'gapping', { gapping: pageClubs, dispersion: pageDispersion, wedges: () => { SUBWIRE.push('practice'); return EXTRA.practiceWedges(); } }),
    insights: () => sub('in_tab', [['conditions', 'Weather'], ['compare', 'Before & after'], ['bests', 'Personal bests']], 'conditions',
      { conditions: () => { SUBWIRE.push('conditions'); return EXTRA.render.conditions(); }, compare: () => { SUBWIRE.push('compare'); return EXTRA.render.compare(); }, bests: () => EXTRA.render.bests() }),
  }[t] || pageScoring;
  return seg('sx_tab', STATS_TABS, 'scoring', 'scroll tabs') + body();
}
function pagePlayHub() {
  const t = segVal('pl_tab', 'round'), d = state.journal.draft;
  const head = seg('pl_tab', [['round', d ? 'Round' : 'Play'], ['caddie', 'Caddie'], ['plan', 'Strategy card']], 'round', 'tabs');
  if (t === 'caddie') { SUBWIRE.push('caddie'); return head + (DS.rounds.length ? EXTRA.render.caddie() : emptyMsg()); }
  if (t === 'plan') { SUBWIRE.push('playbook'); return head + (DS.rounds.length ? EXTRA.render.playbook() : emptyMsg()); }
  SUBWIRE.push('play'); return head + EXTRA.play.render.play();
}
const RENDER = { home: pageHome, stats: pageStats, rounds: pageRounds, data: pageData, corrections: () => pageEdit(false), settings: pageSettings, help: pageHelp };

// ------------------------------------------------------------------ render + events
function render() {
  refreshPalette();
  let page = (location.hash.slice(1) || 'home').split('?')[0];
  if (MOVED[page]) { const [to, set, hook] = MOVED[page]; Object.assign(ui, set || {}); hook?.(); saveUi(); history.replaceState(null, '', `#${to}`); page = to; }
  const key = RENDER[page] ? page : 'home';
  $('#title').textContent = key === 'rounds' && ui.rd_open ? 'Round' : PAGES[key][0];
  $('#nav').innerHTML = NAV.map(([p, label]) => `<a href="#${p}" class="${p === key ? 'on' : ''}">${icon(PAGES[p][1], 24)}${label}</a>`).join('');
  $('#filterBtn').hidden = !FILTERED.has(key) || !DS.rounds.length || (key === 'rounds' && !!ui.rd_open) || (key === 'stats' && ['handicap', 'insights'].includes(segVal('sx_tab', 'scoring')));
  // Settings and its pages: a back arrow on the left and Done on the right take you back to where you were
  const inSettings = SETTINGS_PAGES.includes(key);
  if (!inSettings) lastMain = location.hash || '#home';
  $('header').classList.toggle('sub', inSettings); $('header').classList.remove('away');
  $('#backBtn').hidden = !inSettings;
  if (inSettings) $('#backBtn').innerHTML = `${icon('back', 24)}${key === 'settings' ? '' : 'Settings'}`;
  const gb = $('#gearBtn'); gb.classList.toggle('done', inSettings); gb.innerHTML = inSettings ? 'Done' : icon('gear', 25);
  gb.setAttribute('href', inSettings ? lastMain : '#settings'); gb.setAttribute('aria-label', inSettings ? 'Close settings' : 'Settings');
  plots.forEach(([id]) => { const e = document.getElementById(id); if (e && window.Plotly) Plotly.purge(e); }); plots = []; SUBWIRE = []; EMBED = null; CHT.resetCharts();
  let html;
  try { html = (!DS.rounds.length && !['data', 'settings', 'help', 'corrections', ...EXTRA.noData].includes(key)) ? emptyMsg() : RENDER[key](); }
  catch (e) { console.error(e); html = `<div class="err">Something went wrong on this page: ${esc(e.message)}</div>`; }
  $('#main').innerHTML = html;
  drawPlots(); CHT.wireCharts($('#main')); wire(key); EXTRA.wire[key]?.(); [...new Set(SUBWIRE)].filter((k) => k !== key).forEach((k) => EXTRA.wire[k]?.()); EXTRA.wireOsm(); PROG?.afterRender();
  $$('[data-share]').forEach((b) => b.addEventListener('click', () => EXTRA.shareRound(b.dataset.share)));
  $$('.seg.scroll, .seg.tabs').forEach((g) => { const b = $('button.on', g); if (b) g.scrollLeft = b.offsetLeft - (g.clientWidth - b.offsetWidth) / 2; });
}
function rerender() { const y = scrollY; render(); scrollTo(0, y); }

function wire(page) {
  $$('[data-seg]').forEach((g) => g.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; ui[g.dataset.seg] = b.dataset.v; saveUi(); rerender(); }));
  $$('[data-sel]').forEach((s) => s.addEventListener('change', () => { ui[s.dataset.sel] = s.value; saveUi(); rerender(); }));
  $$('[data-chips]').forEach((g) => g.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; const k = g.dataset.chips;
    const cur = new Set(ui[k] || $$('.chip.on', g).map((x) => x.dataset.v)); cur.has(b.dataset.v) ? cur.delete(b.dataset.v) : cur.add(b.dataset.v);
    ui[k] = [...cur]; saveUi(); rerender();
  }));
  $('#loadSample')?.addEventListener('click', loadSample);
  $$('[data-removedemo]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Remove all synthetic demo rounds, demo clubs and the demo handicap history?')) return;
    const r = await S.removeDemo(state); rebuild(); toast(`Removed ${r.rounds} demo rounds and ${r.clubs} demo clubs`); render();
  }));
  const on = (id, ev, fn) => { const e = $(id); if (e) e.addEventListener(ev, fn); };
  if (page === 'rounds') {
    $$('#roundsTbl tr.click').forEach((tr) => tr.addEventListener('click', () => {
      const rows = [...filtered().rounds].reverse(); ui.rd_open = rows[Number(tr.dataset.i)].round_id; ui.rd_tab = 'card'; saveUi(); render(); scrollTo(0, 0);
    }));
    on('#rdClose', 'click', () => { ui.rd_open = null; saveUi(); render(); });
    $$('[data-delround]').forEach((b) => b.addEventListener('click', async () => { if (!confirm('Delete this hand-entered round?')) return; await S.deleteBundle(state, b.dataset.delround); ui.rd_open = null; saveUi(); rebuild(); toast('Round deleted'); render(); }));
  }
  // links that open a round, a stats tab or a practice tab
  $$('[data-openround]').forEach((a) => a.addEventListener('click', () => { ui.rd_open = a.dataset.openround; ui.rd_tab = a.dataset.tab || 'card'; saveUi(); }));
  $$('[data-stats]').forEach((a) => a.addEventListener('click', () => { ui.sx_tab = a.dataset.stats; saveUi(); }));
  $$('[data-practice]').forEach((a) => a.addEventListener('click', () => { ui.pr_tab = a.dataset.practice; saveUi(); }));
  GUIDED?.wire();
  on('#syncNow', 'click', async () => {
    const m = $('#syncMsg'); m.textContent = ' Syncing…';
    try { const r = await syncFromGitHub(state, (t) => { m.textContent = ' ' + t; }); rebuild(); toast(`Sync: ${r.new} new, ${r.updated} updated, ${r.unchanged} unchanged${r.failed ? `, ${r.failed} failed` : ''}${r.notesAdded ? `, ${r.notesAdded} coach note(s)` : ''}`); rerender(); }
    catch (e) { m.textContent = ' ' + e.message; }
  });
  if (page === 'settings' || page === 'practice') COMP.wire();
  if (page === 'data') {
    on('#impFile', 'change', async (e) => {
      const m = $('#impMsg'); let tot = { new: 0, updated: 0, unchanged: 0, failed: 0 };
      for (const f of e.target.files) {
        try {
          const json = JSON.parse(await readFile(f));
          if (S.classify(json) === 'backup') { if (confirm(`"${f.name}" is a full GolfIQ backup. Replace ALL data on this phone with it?`)) { await S.restoreBackup(state, json); toast('Backup restored'); } continue; }
          const r = await S.importJson(state, json, `file: ${f.name}`); for (const k in tot) tot[k] += r[k] || 0;
          if (json.failures?.length) toast(`${json.failures.length} rounds had problems in the Garmin export – see Import history`);
        } catch (err) { m.textContent = `${f.name}: ${err.message}`; }
      }
      rebuild(); toast(`Imported: ${tot.new} new, ${tot.updated} updated, ${tot.unchanged} unchanged, ${tot.failed} failed`); rerender();
    });
    on('#bkSave', 'click', () => saveFile(`golfiq-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(S.backupObject(state))));
    on('#bkLoad', 'change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const json = JSON.parse(await readFile(f)); if (S.classify(json) !== 'backup') throw new Error('Not a GolfIQ backup');
        if (!confirm('Replace ALL data on this phone with this backup?')) return; await S.restoreBackup(state, json); rebuild(); toast('Restored'); rerender(); }
      catch (err) { toast(err.message); }
    });
    on('#wipe', 'click', async () => {
      if (!confirm('Delete every round, correction and setting on this phone? (Your cloud-sync connection is kept.) Save a backup first.')) return;
      if (!confirm('Really delete everything?')) return;
      const { owner, repo, branch, path, token } = state.sync || {}; await S.clearAll(); state = await S.loadState(); state.sync = { owner, repo, branch, path, token }; await S.saveSync(state); rebuild(); render();
    });
    navigator.storage?.persisted?.().then((p) => { const e = $('#persist'); if (e) e.textContent = p ? 'Storage is marked persistent.' : 'Tip: open GolfIQ from the home-screen icon so iOS keeps the data.'; });
  }
  if (page === 'corrections' || (page === 'rounds' && ui.rd_open && segVal('rd_tab', 'card') === 'edit')) wireEdit();
  if (page === 'settings') wireSettings();
  if (page === 'help') on('#shareApp', 'click', async () => {
    const url = location.href.split('#')[0], data = { title: 'GolfIQ', text: 'GolfIQ – golf stats, live distances and score keeping. Open in Safari, then Share → Add to Home Screen.', url };
    if (navigator.share) { try { await navigator.share(data); return; } catch (e) { if (e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { prompt('Copy this link:', url); }
  });
  if (page === 'help') on('#copyBm', 'click', async () => { try { await navigator.clipboard.writeText(bookmarkletUrl()); toast('Bookmarklet copied – paste it as the bookmark address'); } catch { prompt('Copy this:', bookmarkletUrl()); } });
}

const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
const keepOrConvert = (txt, storedM) => { const v = numOrNull(txt); if (v === null) return null; return inputVal(storedM, 0) === String(v) ? storedM : uncv(v); };
async function done(msg) { rebuild(); toast(msg); rerender(); }

function wireEdit() {
  const all = DSDUP || A.buildDataset(state, { ...BUILD, includeDuplicates: true, includeExcluded: true }), rid = $('[data-sel=ed_round]')?.value;
  $('#roundForm')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target), r = all.rounds.find((x) => x.round_id === rid), reason = f.get('_reason') || '';
    let n = 0;
    for (const k of ['course_name', 'tee', 'weather', 'conditions', 'notes']) { const v = f.get(k) || null; if ((r[k] ?? null) !== v) { await S.addCorrection(state, 'round', rid, k, v, r[k] ?? null, reason); n++; } }
    for (const k of ['course_rating', 'slope', 'handicap_index']) { const v = numOrNull(f.get(k)); if ((r[k] ?? null) !== v) { await S.addCorrection(state, 'round', rid, k, v, r[k] ?? null, reason); n++; } }
    for (const k of ['is_competition', 'excluded']) { const v = f.get(k) === 'on'; if (!!r[k] !== v) { await S.addCorrection(state, 'round', rid, k, v, !!r[k], reason); n++; } }
    done(`${n} change(s) saved`);
  });
  $('#holeForm')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const reason = new FormData(e.target).get('_reason') || ''; let n = 0;
    for (const tr of $$('tr[data-h]', e.target)) {
      const hole = Number(tr.dataset.h), h = all.holes.find((x) => x.round_id === rid && x.hole === hole), key = A.holeKey(rid, hole);
      const val = (nm) => $(`[name=${nm}]`, tr);
      const changes = { par: numOrNull(val('par').value), strokes: numOrNull(val('strokes').value), putts: numOrNull(val('putts').value), penalties: numOrNull(val('penalties').value),
        fairway: val('fairway').value || null, gir: val('gir').value === '' ? null : val('gir').value === '1', first_putt_m: (() => { const v = numOrNull(val('first_putt_m').value); return v !== null && A.isNum(h.first_putt_m) && Math.round(pcv(h.first_putt_m) * 10) / 10 === v ? h.first_putt_m : puncv(v); })(),
        putts_confirmed: val('putts_confirmed').checked, excluded: val('excluded').checked };
      const before = { par: h.par, strokes: h.strokes, putts: h.putts, penalties: h.penalties, fairway: h.fairway || null, gir: h.gir === null || h.gir === undefined ? null : !!h.gir, first_putt_m: h.first_putt_m, putts_confirmed: !!h.putts_confirmed, excluded: !!h.excluded };
      for (const [k, v] of Object.entries(changes)) if ((before[k] ?? null) !== (v ?? null) && !(k === 'fairway' && before.fairway === 'NA' && v === 'NA')) { await S.addCorrection(state, 'hole', key, k, v, before[k] ?? null, reason); n++; }
    }
    done(`${n} change(s) saved`);
  });
  $('#shotForm')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const reason = new FormData(e.target).get('_reason') || ''; let n = 0;
    for (const card of $$('[data-k]', e.target)) {
      const k = card.dataset.k, s = all.shots.find((x) => x.shot_key === k), g = (nm) => $(`[name=${nm}]`, card);
      const after = { club_id: g('club_id').value || null, shot_category: g('shot_category').value || null, start_lie: g('start_lie').value || null, end_lie: g('end_lie').value || null, excluded: g('excluded').checked };
      const before = { club_id: s.club_id || null, shot_category: s.shot_category || null, start_lie: s.start_lie || null, end_lie: s.end_lie || null, excluded: s.excluded_reason === 'user' };
      for (const [f, v] of Object.entries(after)) if (before[f] !== v) { await S.addCorrection(state, 'shot', k, f, v, before[f], reason); n++; }
    }
    done(`${n} change(s) saved`);
  });
  $$('[data-delshot]').forEach((b) => b.addEventListener('click', async () => { if (confirm('Remove this manually added shot?')) { await S.deleteManualShot(state, b.dataset.delshot); done('Removed'); } }));
  $('#addForm')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const key = await S.addManualShot(state, { round_id: rid, hole: Number(f.get('hole')), shot_order: Number(f.get('shot_order')), club_id: f.get('club_id') || null,
      start_lie: f.get('start_lie') || null, end_lie: f.get('end_lie') || null, dist_m: uncv(numOrNull(f.get('dist_m'))) }, f.get('_reason'));
    const d = uncv(numOrNull(f.get('start_to_pin_m'))); if (d !== null) await S.addCorrection(state, 'shot', key, 'start_to_pin_m', d, null, f.get('_reason'));
    done('Shot added');
  });
  $$('[data-revert]').forEach((b) => b.addEventListener('click', async () => { await S.revertCorrection(state, Number(b.dataset.revert)); done('Reverted'); }));
}

function wireSettings() {
  const st = state.settings;
  $$('#unitSeg button').forEach((b) => b.addEventListener('click', async () => {
    if (st.units === b.dataset.u || (!st.units && b.dataset.u === 'yd')) return;
    st.units = b.dataset.u; await S.saveSettings(state, 'set_units', null, { units: st.units }); done(`Distances now in ${b.dataset.u === 'yd' ? 'yards' : 'metres'}`);
  }));
  const saveFeel = async (patch, msg) => {
    st.feel = { ...FEEL.read(st), ...patch }; FEEL.init(st); await S.saveSettings(state, 'set_feel', null, { feel: st.feel });
    if (st.feel.sound) { FEEL.unlock(); FEEL.play('good'); }
    done(msg);
  };
  $('#feelSound')?.addEventListener('change', (e) => saveFeel({ sound: e.target.checked }, e.target.checked ? 'Sound on' : 'Sound off'));
  $('#feelMotion')?.addEventListener('change', (e) => saveFeel({ motion: e.target.checked }, e.target.checked ? 'Motion on' : 'Motion off'));
  $('#feelTry')?.addEventListener('click', () => {                     // plays every event in turn so you can hear them on this phone
    const out = $('#feelTryOut'), FC2 = FEEL.COPY.settings; if (!out) return;
    if (!FEEL.get().sound) { out.textContent = FC2.tryOff; return; }
    if (!FEEL.unlock()) { out.textContent = FC2.tryNone; return; }
    const names = FEEL.EVENT_NAMES; let i = 0;
    const next = () => { if (!document.body.contains(out) || i >= names.length) { if (document.body.contains(out)) out.textContent = ''; return; } const n = names[i++]; out.textContent = FC2.names[n] || n; FEEL.play(n); setTimeout(next, FEEL.lengthOf(n) * 1000 + 450); };
    next();
  });
  $('#rangeAdj')?.addEventListener('change', async (e) => {
    const v = Math.max(0, Math.min(B.DRIVER_TEST.adj_max, Math.round(Number(e.target.value) || 0)));
    st.range_ball_adj = v; await S.saveSettings(state, 'set_range_adj', null, { range_ball_adj: v }); done(v ? `Range ball adjustment ${v}%` : 'Range ball adjustment off');
  });
  $('#clubForm')?.addEventListener('submit', async (e) => {
    e.preventDefault(); let n = 0;
    for (const card of $$('[data-c]', e.target)) {
      const id = card.dataset.c, c = DS.clubs.find((x) => x.club_id === id), g = (nm) => $(`[name=${nm}]`, card);
      const v = { display_name: g('display_name').value || c.name, category: g('category').value, target_carry_m: keepOrConvert(g('target_carry_m').value, c.target_carry_m), target_total_m: keepOrConvert(g('target_total_m').value, c.target_total_m), sort_order: numOrNull(g('sort_order').value), active: g('active').checked ? 1 : 0 };
      const old = { display_name: c.name, category: c.category, target_carry_m: c.target_carry_m ?? null, target_total_m: c.target_total_m ?? null, sort_order: c.sort_order ?? null, active: c.active === 0 ? 0 : 1 };
      if (JSON.stringify(v) !== JSON.stringify(old)) { st.clubs[id] = { ...(st.clubs[id] || {}), ...v }; await S.saveSettings(state, 'update_club', id, { old, new: v }); n++; }
    }
    done(`${n} club(s) updated`);
  });
  $('#addClub')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target), name = f.get('name'); if (!name) return;
    const id = 'user-' + name.toLowerCase().replace(/\s+/g, '-'); st.clubs[id] = { display_name: name, category: f.get('category'), active: 1, source: 'user' };
    await S.saveSettings(state, 'add_club', id, st.clubs[id]); done(`Added ${name}`);
  });
  $('#teeForm')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const cid = $('[data-sel=st_course]').value;
    for (const row of $$('[data-t]', e.target)) {
      const tee = row.dataset.t === '__new' ? $('[name=tee]', row).value.trim() : row.dataset.t; if (!tee) continue;
      const rating = numOrNull($('[name=rating]', row).value), slope = numOrNull($('[name=slope]', row).value), cur = DS.base.tees[`${cid}|${tee}`];
      if (cur && cur.rating === rating && cur.slope === slope) continue;
      st.tees[`${cid}|${tee}`] = { rating, slope }; await S.saveSettings(state, 'set_course_tee', cid, { tee, rating, slope });
    }
    done('Tees saved');
  });
  $('#holesForm')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const cid = $('[data-sel=st_course]').value;
    const si = $$('tr[data-h] [name=stroke_index]', e.target).map((x) => numOrNull(x.value)).filter((x) => x !== null);
    if (si.length === 18 && new Set(si).size !== 18) { toast('Stroke indexes must be 1–18, each used once'); return; }
    for (const tr of $$('tr[data-h]', e.target)) {
      const k = `${cid}|${tr.dataset.h}`, par = numOrNull($('[name=par]', tr).value), sidx = numOrNull($('[name=stroke_index]', tr).value), cur = DS.base.chole[k] || {};
      if ((cur.par ?? null) === par && (cur.stroke_index ?? null) === sidx) continue;
      st.holes[k] = { par, stroke_index: sidx }; await S.saveSettings(state, 'set_course_hole', cid, { hole: tr.dataset.h, par, si: sidx });
    }
    done('Holes saved');
  });
  $('#hcpForm')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    st.handicaps = st.handicaps.filter((h) => h.date !== f.get('date')).concat([{ date: f.get('date'), handicap_index: Number(f.get('hi')), note: f.get('note') || '' }]).sort((a, b) => a.date.localeCompare(b.date));
    await S.saveSettings(state, 'set_handicap', f.get('date'), { hi: Number(f.get('hi')) }); done('Saved');
  });
  $$('[data-delhcp]').forEach((b) => b.addEventListener('click', async () => { st.handicaps = st.handicaps.filter((h) => h.date !== b.dataset.delhcp); await S.saveSettings(state, 'delete_handicap', b.dataset.delhcp, null); done('Deleted'); }));
  $('#syncForm')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    state.sync = { ...state.sync, owner: f.get('owner').trim(), repo: f.get('repo').trim(), branch: f.get('branch').trim() || 'main', path: f.get('path').trim(), token: f.get('token').trim() };
    await S.saveSync(state); toast('Saved. Go to Data → Sync now.');
  });
  $('#genKey')?.addEventListener('click', async () => { const k = newStateKey(); $('#keyOut').value = k; try { await navigator.clipboard.writeText(k); toast('Key copied'); } catch { /* shown in box */ } });
}

async function loadSample() {
  try {
    const r = await fetch('sample-data.json'); if (!r.ok) throw new Error('sample-data.json not found next to the app');
    const json = await r.json(); await S.restoreBackup(state, json); rebuild(); toast('Synthetic demo loaded – replace it with your data any time (Data → Import / Sync, or restore a backup).'); render();
  } catch (e) { toast(e.message); }
}

// ------------------------------------------------------------------ boot
$('#filterBtn').addEventListener('click', filterSheet);
$('#gearBtn').innerHTML = icon('gear', 25);
$('#backBtn').addEventListener('click', () => { const k = (location.hash.slice(1) || 'home').split('?')[0]; location.hash = k === 'settings' ? lastMain : '#settings'; });
// the header slides away while you scroll down and comes back as soon as you scroll up
{ let y0 = scrollY; addEventListener('scroll', () => { const y = scrollY, h = $('header'); if (y < 50 || y < y0 - 6) h.classList.remove('away'); else if (y > y0 + 6 && !document.querySelector('.sheet.open, #sheet.open')) h.classList.add('away'); if (Math.abs(y - y0) > 6) y0 = y; }, { passive: true }); }
// bottom bar: Play opens the live round, Rounds goes back to the list (like tapping a tab bar twice on iOS)
$('#nav').addEventListener('click', (e) => { const h = e.target.closest('a')?.getAttribute('href'); if (h === '#play') ui.pl_tab = 'round'; if (h === '#rounds') ui.rd_open = null; saveUi(); if (h === location.hash) render(); });
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') $('#sheet').classList.remove('open'); });
addEventListener('hashchange', () => { if (COMP?.handleInvite()) { render(); return; } scrollTo(0, 0); render(); });
(async () => {
  state = await S.loadState(); S.requestPersistence(); rebuild();
  const ctx = { A, S, $, $$, esc, fmt, sgn, note, table, kpi, plot, seg, segVal, select, chips, toast, saveFile, readFile, n0, n1, n2, p0, COLORS, P, css,
    cv, uncv, pcv, puncv, D, DP, d0, d1, numOrNull, badge, trendChart, mapPlot, filterSummary, filtered, coachingPriorities, done, rerender, render, saveUi,
    get state() { return state; }, get DS() { return DS; }, get embedRound() { return EMBED; }, get E() { return expectedFn(); }, get compete() { return COMP; }, get progress() { return PROG; }, get guided() { return GUIDED; }, get UNIT() { return UNIT; }, get PUNIT() { return PUNIT(); }, get ui() { return ui; } };
  COMP = registerCompete(ctx); COMP.handleInvite(); PROG = registerProgress(ctx); GUIDED = registerGuided(ctx);
  EXTRA = registerPages(ctx);
  const PL = registerPlay(ctx); Object.assign(EXTRA.pages, PL.pages); Object.assign(EXTRA.render, PL.render); Object.assign(EXTRA.wire, PL.wire); EXTRA.noData.push(...PL.noData); EXTRA.play = PL;
  for (const k of ['practice']) { PAGES[k] = EXTRA.pages[k]; RENDER[k] = EXTRA.render[k]; }
  PAGES.play = ['Play', 'flag']; RENDER.play = pagePlayHub; EXTRA.noData.push('home');
  if (window.Plotly || document.readyState === 'complete') render(); else addEventListener('load', render, { once: true });
  window.__golfiq = { get state() { return state; }, get ds() { return DS; }, A, get extra() { return EXTRA; }, get guided() { return GUIDED; }, get compete() { return COMP; }, get progress() { return PROG; } };
})();
