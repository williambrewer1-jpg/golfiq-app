// BreakingPar's own charts for Rounds and Stats: SVG strings, no library, colours from the theme (CSS variables), no zoom.
// Every builder returns an HTML string and registers what the pointer handlers need; render() calls resetCharts() first and wireCharts() after the page is in the DOM.
// Plan: claude/stats-charts-plan.md. Styles live in index.html under "charts (charts.js)".
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const f1 = (n) => Math.round(n * 10) / 10;
const num = (v, d = 1) => (isNum(v) ? v.toFixed(d) : '–');

// ------------------------------------------------------------------ tones (all theme variables, so dark mode follows with no redraw)
export const TONE = { accent: 'var(--accent)', gold: 'var(--gold)', good: 'var(--good)', bad: 'var(--bad)', warn: 'var(--warn)', muted: 'var(--muted)', ink: 'var(--ink)', line: 'var(--line)', flag: 'var(--flag)' };
const tone = (t) => TONE[t] || t || TONE.accent;

// ------------------------------------------------------------------ registry (rebuilt at every render)
let REG = [];
export const resetCharts = () => { REG = []; };
function reg(spec) { const id = `ch${REG.length}`; REG.push({ ...spec, id }); return id; }

// ------------------------------------------------------------------ scales and labels
/** A tidy axis: about `n` gridlines at round numbers that cover [lo, hi]. */
export function niceScale(lo, hi, n = 3) {
  if (!isNum(lo) || !isNum(hi)) return { lo: 0, hi: 1, step: 1, ticks: [0, 1] };
  if (hi < lo) [lo, hi] = [hi, lo];
  if (lo === hi) { const d = Math.abs(lo) * 0.1 || 1; lo -= d; hi += d; }
  const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw)), fr = raw / mag;
  const step = (fr < 1.5 ? 1 : fr < 3 ? 2 : fr < 7 ? 5 : 10) * mag, a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step, ticks = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(Math.round(v * 1e9) / 1e9);
  return { lo: a, hi: b, step, ticks };
}
const tickText = (t, step) => (step >= 1 ? String(Math.round(t)) : t.toFixed(step >= 0.1 ? 1 : 2));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDate(iso, withYear = false) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if (!m) return String(iso ?? '');
  return `${+m[3]} ${MON[+m[2] - 1] || ''}${withYear ? ` ${m[1].slice(2)}` : ''}`;
}
/** First and last date under a chart; the year shows only when the span crosses one. */
function dateLabels(first, last, x0, x1) {
  const y = (s) => String(s || '').slice(0, 4), wy = y(first) !== y(last);
  return first === undefined ? [] : [{ x: x0, text: shortDate(first, wy), anchor: 'start' }, ...(x1 > x0 ? [{ x: x1, text: shortDate(last, wy), anchor: 'end' }] : [])];
}
/** Histogram bins of equal width. */
export function bin(values, width) {
  const v = values.filter(isNum); if (!v.length || !(width > 0)) return [];
  const lo = Math.floor(Math.min(...v) / width + 1e-9) * width, hi = Math.floor(Math.max(...v) / width + 1e-9) * width, out = [];
  for (let b = lo; b <= hi + 1e-9; b += width) out.push({ lo: Math.round(b * 1e6) / 1e6, hi: Math.round((b + width) * 1e6) / 1e6, count: 0 });
  for (const x of v) out[Math.min(out.length - 1, Math.max(0, Math.floor((x - lo) / width + 1e-9)))].count++;
  return out;
}
/** Rolling mean over the last `w` values; null until a full window exists. */
export const rolling = (vals, w) => vals.map((_, i) => (i + 1 >= w ? mean(vals.slice(i + 1 - w, i + 1)) : null));
/** Window sizes a trend chart can offer for n rounds. */
export const trendWins = (n) => [5, 10, 20].filter((w) => w <= n);

// ------------------------------------------------------------------ line engine (trend, line, handicap, sparks)
/** series: [{ kind: 'line'|'dots'|'step', tone, pts: [{x, y, hot}], area, dash, label, scrub, r }]. Returns { svg, snap } where snap = the scrub series' pixel positions. */
function lineSvg(o) {
  const { series, ref = null, vbh = 140, xl = [], yRange = null } = o, VW = 330, L = 30, R = 10, T = 10, B = 22, W = VW - L - R, H = vbh - T - B;
  const ok = (p) => isNum(p.x) && isNum(p.y), all = series.flatMap((s) => s.pts.filter(ok));
  if (!all.length) return { svg: '', snap: [], vbw: VW };
  let lo = Math.min(...all.map((p) => p.y)), hi = Math.max(...all.map((p) => p.y));
  if (isNum(ref)) { lo = Math.min(lo, ref); hi = Math.max(hi, ref); }
  if (yRange) [lo, hi] = yRange;
  const sc = niceScale(lo, hi, 3), xs = all.map((p) => p.x), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const X = (x) => (x1 === x0 ? L + W / 2 : L + (x - x0) / (x1 - x0) * W), Y = (y) => T + H - (y - sc.lo) / (sc.hi - sc.lo) * H;
  let g = '';
  for (const t of sc.ticks) g += `<line class="grid" x1="${L}" x2="${L + W}" y1="${f1(Y(t))}" y2="${f1(Y(t))}"/><text class="tick" x="${L - 6}" y="${f1(Y(t)) + 4}" text-anchor="end">${tickText(t, sc.step)}</text>`;
  if (isNum(ref)) g += `<line class="ref" x1="${L}" x2="${L + W}" y1="${f1(Y(ref))}" y2="${f1(Y(ref))}"/><text class="tick gold" x="${L + W}" y="${f1(Y(ref)) - 4}" text-anchor="end">${esc(o.refLabel ?? ref)}</text>`;
  let area = '', body = '', labels = '';
  for (const s of series) {
    const pts = s.pts.filter(ok), col = tone(s.tone);
    if (!pts.length) continue;
    if (s.kind === 'dots') {
      body += pts.map((p) => (p.hot ? `<circle cx="${f1(X(p.x))}" cy="${f1(Y(p.y))}" r="4.5" style="fill:var(--gold);stroke:var(--card);stroke-width:1.5"/>` : `<circle cx="${f1(X(p.x))}" cy="${f1(Y(p.y))}" r="${s.r || 2.6}" style="fill:${col};fill-opacity:${s.opacity ?? 0.5}"/>`)).join('');
    } else if (s.kind === 'step') {
      let d = `M${f1(X(pts[0].x))} ${f1(Y(pts[0].y))}`; for (let i = 1; i < pts.length; i++) d += `L${f1(X(pts[i].x))} ${f1(Y(pts[i - 1].y))}L${f1(X(pts[i].x))} ${f1(Y(pts[i].y))}`;
      d += `L${L + W} ${f1(Y(pts[pts.length - 1].y))}`; body += `<path class="ln dash" d="${d}" style="stroke:${col};stroke-width:${s.width || 1.8}"/>`;
    } else {
      if (pts.length > 1) {
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${f1(X(p.x))} ${f1(Y(p.y))}`).join('');
        if (s.area) area += `<path d="${d}L${f1(X(pts[pts.length - 1].x))} ${T + H}L${f1(X(pts[0].x))} ${T + H}Z" style="fill:${col};fill-opacity:.09"/>`;
        body += `<path class="ln" pathLength="1" d="${d}" style="stroke:${col};stroke-width:${s.width || 2.5}"/>`;
      } else body += `<circle cx="${f1(X(pts[0].x))}" cy="${f1(Y(pts[0].y))}" r="3.5" style="fill:${col}"/>`;
      if (s.markers) body += pts.map((p) => `<circle cx="${f1(X(p.x))}" cy="${f1(Y(p.y))}" r="${s.markers}" style="fill:${col}"/>`).join('');
    }
    if (s.label) { const last = pts[pts.length - 1]; labels += `<text class="tick" x="${Math.min(L + W, f1(X(last.x)))}" y="${f1(Y(last.y)) - 7}" text-anchor="end" style="fill:${col}">${esc(s.label)}</text>`; }
  }
  const xlab = xl.map((l) => `<text class="tick" x="${f1(X(l.x))}" y="${vbh - 4}" text-anchor="${l.anchor || 'middle'}">${esc(l.text)}</text>`).join('');
  const sd = series.find((s) => s.scrub) || null, snap = sd ? sd.pts.filter(ok).map((p) => ({ x: X(p.x), y: Y(p.y), src: p })) : [];
  const svg = `<svg viewBox="0 0 ${VW} ${vbh}" aria-hidden="true" focusable="false">${g}${area}${body}${labels}${xlab}<line class="ch-cur" x1="0" x2="0" y1="${T}" y2="${T + H}"/><circle class="ch-dot" r="5" cx="0" cy="0"/></svg>`;
  return { svg, snap, vbw: VW, X, Y };
}

// ------------------------------------------------------------------ trend: headline number, rolling average, scrub
/** rounds: [{ date, label, <metric> }]; metric: key; hib: higher is better; win: 5 | 10 | 20 (0 or too large = dots only). */
export function trend({ rounds, metric, label = '', unit = '', hib = true, ref = null, win = 5, digits }) {
  const pts = rounds.map((r) => ({ v: r[metric], date: r.date, text: r.label || r.date })).filter((p) => isNum(p.v));
  if (!pts.length) return '<p class="muted small">No data for this metric yet.</p>';
  const d = digits ?? (unit === '%' ? 0 : 1), vals = pts.map((p) => p.v), n = pts.length, w = win > 0 && win <= n ? win : 0, roll = w ? rolling(vals, w) : vals.map(() => null);
  const cur = w ? roll[n - 1] : mean(vals), delta = w && n >= 2 * w ? mean(vals.slice(-w)) - mean(vals.slice(-2 * w, -w)) : null;
  const dir = delta === null || Math.abs(delta) < 1e-9 ? null : (delta > 0) === hib ? 'good' : 'bad';
  const sub = delta === null ? `${n} round${n === 1 ? '' : 's'}${w ? '' : ' so far'}` : dir === null ? `no change vs previous ${w}` : `<span class="${dir}">${delta > 0 ? '▲' : '▼'} ${num(Math.abs(delta), d)}</span> vs previous ${w}`;
  const subText = delta === null ? sub : dir === null ? sub : `${delta > 0 ? 'up' : 'down'} ${num(Math.abs(delta), d)} on the previous ${w}`;
  const series = [{ kind: 'dots', tone: 'muted', pts: pts.map((p, i) => ({ x: i, y: p.v })), opacity: 0.5, scrub: true }];
  if (w) series.push({ kind: 'line', tone: 'accent', area: true, pts: roll.map((y, i) => ({ x: i, y })).filter((p) => p.y !== null) });
  const chart = lineSvg({ series, ref, xl: dateLabels(pts[0].date, pts[n - 1].date, 0, n - 1) });
  const reads = pts.map((p, i) => ({ big: num(p.v, d), lab: `Round ${i + 1}`, sub: `${p.text}${roll[i] !== null ? ` · ${w}-rd avg ${num(roll[i], d)}` : ''}` }));
  const id = reg({ kind: 'scrub', snap: chart.snap, reads, vbw: chart.vbw });
  const lab = `${label}${w ? ` · ${w}-round avg` : ' · average'}`;
  return `<div class="ch ch-trend" id="${id}" role="img" aria-label="${esc(`${label} ${w ? `${w}-round average` : 'average'} ${num(cur, d)}${unit ? ' ' + unit : ''}${subText ? ', ' + subText : ''}. ${n} rounds.`)}">
    <div class="ch-lab">${esc(lab)}</div><div class="ch-head"><span class="ch-big">${num(cur, d)}</span>${unit ? `<span class="ch-unit">${esc(unit)}</span>` : ''}</div>
    <div class="ch-sub">${sub}</div>${chart.svg}<div class="ch-cap">Press and drag across the chart to see each round.</div></div>`;
}

// ------------------------------------------------------------------ line: a plain line (or several series) with scrub
/** series as in lineSvg; reads(i) -> { cap } text for point i of the scrub series; caption = the resting caption. */
export function line({ series, unit = '', ref = null, refLabel, yRange = null, reads, caption = 'Press and drag across the chart for details.', xKind = 'index', aria = '', digits = 1, height = 140 }) {
  const live = series.filter((s) => s.pts.some((p) => isNum(p.x) && isNum(p.y)));
  if (!live.length) return '';
  if (!live.some((s) => s.scrub)) live[0].scrub = true;
  const xs = live.flatMap((s) => s.pts.filter((p) => isNum(p.x)).map((p) => p.x)), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const dateOf = (x) => new Date(x).toISOString().slice(0, 10), xl = xKind === 'date' ? dateLabels(dateOf(x0), dateOf(x1), x0, x1) : [];
  const chart = lineSvg({ series: live, ref, refLabel, yRange, xl, vbh: height }), sd = live.find((s) => s.scrub).pts.filter((p) => isNum(p.x) && isNum(p.y));
  const rd = sd.map((p, i) => ({ cap: reads ? reads(p, i) : `${num(p.y, digits)}${unit}` }));
  const id = reg({ kind: 'scrub', snap: chart.snap, reads: rd, vbw: chart.vbw });
  return `<div class="ch" id="${id}" role="img" aria-label="${esc(aria)}">${chart.svg}<div class="ch-cap">${esc(caption)}</div></div>`;
}

// ------------------------------------------------------------------ bars: vertical bars, tap for the detail
/** items: [{ label, value, note, tone, hot, xl }]. */
export function bars({ items, unit = '', digits = 1, valueLabels, height = 130, caption = 'Tap a bar for details.', aria = '', zero = true, ref = null }) {
  const its = items.filter((it) => isNum(it.value));
  if (!its.length) return '';
  const VW = 330, L = 30, R = 8, T = 16, B = 22, W = VW - L - R, H = height - T - B, n = its.length;
  let lo = Math.min(...its.map((i) => i.value)), hi = Math.max(...its.map((i) => i.value));
  if (zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  const sc = niceScale(lo, hi, 3), Y = (v) => T + H - (v - sc.lo) / (sc.hi - sc.lo) * H, slot = W / n, bw = Math.min(slot * 0.72, 30), showVals = valueLabels ?? n <= 12, y0 = Y(Math.max(sc.lo, Math.min(0, sc.hi)));
  let g = sc.ticks.map((t) => `<line class="grid" x1="${L}" x2="${L + W}" y1="${f1(Y(t))}" y2="${f1(Y(t))}"/><text class="tick" x="${L - 6}" y="${f1(Y(t)) + 4}" text-anchor="end">${tickText(t, sc.step)}</text>`).join('');
  if (isNum(ref)) g += `<line class="ref" x1="${L}" x2="${L + W}" y1="${f1(Y(ref))}" y2="${f1(Y(ref))}"/>`;
  let body = '', xl = '';
  its.forEach((it, i) => {
    const cx = L + slot * i + slot / 2, x = cx - bw / 2, top = Y(it.value), y = Math.min(top, y0), h = Math.max(1, Math.abs(y0 - top)), neg = it.value < 0;
    body += `<g class="ch-bar${it.hot ? ' hot' : ''}" data-i="${i}"><rect class="hit" x="${f1(L + slot * i)}" y="${T - 12}" width="${f1(slot)}" height="${H + 12}"/><rect class="b" x="${f1(x)}" y="${f1(y)}" width="${f1(bw)}" height="${f1(h)}" rx="${Math.min(3, bw / 2)}" style="fill:${tone(it.tone)}"/>`
      + (showVals ? `<text class="val" x="${f1(cx)}" y="${f1(neg ? y + h + 11 : y - 4)}" text-anchor="middle">${num(it.value, digits)}</text>` : '') + '</g>';
    if (n <= 12) xl += `<text class="tick" x="${f1(cx)}" y="${height - 4}" text-anchor="middle">${esc(it.xl ?? it.label)}</text>`;
  });
  if (n > 12) xl = `<text class="tick" x="${L}" y="${height - 4}" text-anchor="start">${esc(its[0].xl ?? its[0].label)}</text><text class="tick" x="${L + W}" y="${height - 4}" text-anchor="end">${esc(its[n - 1].xl ?? its[n - 1].label)}</text>`;
  const caps = its.map((it) => it.note ?? `${it.label} · ${num(it.value, digits)}${unit}`), id = reg({ kind: 'tap', sel: '.ch-bar', caps });
  return `<div class="ch" id="${id}" role="img" aria-label="${esc(aria || `Bar chart, ${n} bars`)}"><svg viewBox="0 0 ${VW} ${height}" aria-hidden="true" focusable="false">${g}<line class="base" x1="${L}" x2="${L + W}" y1="${f1(y0)}" y2="${f1(y0)}"/>${body}${xl}</svg><div class="ch-cap">${esc(caption)}</div></div>`;
}

// ------------------------------------------------------------------ golf-native pieces
/** Colours for score types, defined once so every chart agrees (all from the theme). */
export const SCORE_TONES = {
  'Eagle+': 'var(--accent)', Birdie: 'var(--accent)', Par: 'color-mix(in srgb, var(--good) 35%, var(--card))', Bogey: 'var(--flag)',
  Double: 'color-mix(in srgb, var(--bad) 55%, var(--card))', 'Triple+': 'var(--bad)',
};
const key = (rows) => rows.map((r) => `<span><i style="background:${tone(r.tone)}"></i>${esc(r.label)} <b>${esc(r.text)}</b></span>`).join('');

/** One 100% strip split into parts (score types, putts per hole), with a key underneath. parts: [{ label, value, tone, note }]. */
export function strip({ parts, digits = 1, unit = '', aria = '', caption = 'Tap a part for details.' }) {
  const ps = parts.filter((p) => isNum(p.value) && p.value > 0);
  if (!ps.length) return '';
  const caps = ps.map((p) => p.note ?? `${p.label}: ${num(p.value, digits)}${unit}`), id = reg({ kind: 'tap', sel: '.ch-seg', caps });
  return `<div class="ch" id="${id}" role="img" aria-label="${esc(aria || ps.map((p) => `${p.label} ${num(p.value, digits)}${unit}`).join(', '))}"><div class="ch-strip">${ps.map((p, i) => `<button type="button" class="ch-seg" data-i="${i}" style="flex:${p.value};background:${tone(p.tone)}" aria-label="${esc(caps[i])}"></button>`).join('')}</div>
    <div class="ch-key">${key(ps.map((p) => ({ ...p, text: num(p.value, digits) + unit })))}</div><div class="ch-cap">${esc(caption)}</div></div>`;
}

/** Stat tiles in the app's own tile style. items: [{ label, value, unit, sub, digits }]. */
export function tiles(items, digits = 0) {
  const its = items.filter((i) => i);
  return its.length ? `<div class="kpis">${its.map((i) => `<div class="kpi"><div class="l">${esc(i.label)}</div><div class="v">${isNum(i.value) ? num(i.value, i.digits ?? digits) + (i.unit ? esc(i.unit) : '') : '–'}</div>${i.sub ? `<div class="d muted">${esc(i.sub)}</div>` : ''}</div>`).join('')}</div>` : '';
}

/** Tone class for a to-par value: an average such as 0.8 or a single hole such as +1. */
export const holeTone = (v) => (!isNum(v) ? 'n' : v < -0.25 ? 'a' : v < 0.5 ? 'p' : v < 1.25 ? 'b' : v < 2.25 ? 'd' : 't');
/** A scorecard laid out as coloured cells, nine to a row. groups: [{ title, rows: [{ name, kind: 'score'|'diff', cells: [{ hole, value, detail }] }] }]. */
export function holeGrid({ groups, digits = 1, caption = 'Tap a hole for details.', aria = 'Holes coloured by score to par' }) {
  const gs = groups.filter((g) => g.rows.some((r) => r.cells.length));
  if (!gs.length) return '';
  const caps = []; let i = 0;
  const body = gs.map((g) => {
    const named = g.rows.some((r) => r.name);
    const rows = g.rows.map((r) => `${named ? `<div class="rn">${esc(r.name || '')}</div>` : ''}${r.cells.map((c) => {
      caps.push(c.detail ?? `Hole ${c.hole}: ${sgnTxt(c.value, digits)}`);
      const cls = r.kind === 'diff' ? (!isNum(c.value) || Math.abs(c.value) < 1e-9 ? 'df0' : c.value < 0 ? 'dfg' : 'dfb') : `h${holeTone(c.value)}`;
      return `<button type="button" class="ch-hole ${cls}" data-i="${i++}"><span>${esc(c.hole)}</span><b>${isNum(c.value) ? sgnTxt(c.value, digits) : '–'}</b></button>`;
    }).join('')}`).join('');
    return `${g.title ? `<div class="ch-nine">${esc(g.title)}</div>` : ''}<div class="ch-holes${named ? ' named' : ''}">${rows}</div>`;
  }).join('');
  const id = reg({ kind: 'tap', sel: '.ch-hole', caps });
  return `<div class="ch" id="${id}" role="img" aria-label="${esc(aria)}">${body}<div class="ch-cap">${esc(caption)}</div></div>`;
}
const sgnTxt = (v, d = 1) => (isNum(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d) : '–');

/** Horizontal bars, one per row. diverging = around zero (green to the right, red to the left). items: [{ label, value, sub, note, tone }]. */
export function hbars({ items, unit = '', digits = 0, diverging = false, signed = false, aria = '', caption = 'Tap a row for details.', max = null }) {
  const its = items.filter((it) => isNum(it.value));
  if (!its.length) return '';
  const span = max ?? (Math.max(...its.map((it) => Math.abs(it.value))) || 1);
  const rows = its.map((it, i) => {
    const w = Math.min(100, Math.abs(it.value) / span * (diverging ? 50 : 100)), neg = it.value < 0;
    const style = diverging ? `${neg ? `right:50%` : `left:50%`};width:${f1(w)}%;background:${tone(it.tone || (neg ? 'bad' : 'good'))}` : `left:0;width:${f1(w)}%;background:${tone(it.tone || 'accent')}`;
    return `<button type="button" class="ch-hrow" data-i="${i}"><span class="hl">${esc(it.label)}</span><span class="ht"><i style="${style}"></i>${diverging ? '<u></u>' : ''}</span><span class="hv">${signed || diverging ? sgnTxt(it.value, digits) : num(it.value, digits)}${unit}${it.sub ? `<em>${esc(it.sub)}</em>` : ''}</span></button>`;
  }).join('');
  const caps = its.map((it) => it.note ?? `${it.label}: ${signed || diverging ? sgnTxt(it.value, digits) : num(it.value, digits)}${unit}`), id = reg({ kind: 'tap', sel: '.ch-hrow', caps });
  return `<div class="ch" id="${id}" role="img" aria-label="${esc(aria || `Bar chart, ${its.length} rows`)}"><div class="ch-hbars">${rows}</div><div class="ch-cap">${esc(caption)}</div></div>`;
}

const pctTxt = (v) => (isNum(v) ? `${Math.round(v)}%` : '–');
/** A fairway with the three outcomes written where they happen. */
export function fairway({ hit, left, right, holes = null }) {
  if (![hit, left, right].some(isNum)) return '';
  const n = isNum(holes) ? ` of ${holes} par 4s and 5s` : '', caps = [`Fairway hit: ${pctTxt(hit)}${n}`, `Missed left: ${pctTxt(left)}${n}`, `Missed right: ${pctTxt(right)}${n}`], id = reg({ kind: 'tap', sel: '.ch-zone', caps });
  const zone = (i, x, w, big, name, col) => `<g class="ch-zone" data-i="${i}"><rect class="hit" x="${x}" y="0" width="${w}" height="120"/><text class="big" x="${x + w / 2}" y="58" text-anchor="middle" style="fill:${col}">${pctTxt(big)}</text><text class="tick" x="${x + w / 2}" y="76" text-anchor="middle">${name}</text></g>`;
  return `<div class="ch" id="${id}" role="img" aria-label="${esc(`Fairways: hit ${pctTxt(hit)}, missed left ${pctTxt(left)}, missed right ${pctTxt(right)}`)}"><svg viewBox="0 0 330 120" aria-hidden="true" focusable="false">
    <rect width="330" height="120" rx="12" style="fill:color-mix(in srgb, var(--good) 12%, var(--card))"/><path d="M118 120 C124 78 112 38 130 0 L200 0 C218 38 206 78 212 120Z" style="fill:color-mix(in srgb, var(--good) 38%, var(--card))"/>
    <rect x="140" y="106" width="50" height="8" rx="4" style="fill:var(--card);fill-opacity:.8"/>${zone(1, 0, 118, left, 'missed left', 'var(--warn)')}${zone(0, 118, 94, hit, 'fairway', 'var(--accent)')}${zone(2, 212, 118, right, 'missed right', 'var(--warn)')}</svg><div class="ch-cap">Tap an area for details.</div></div>`;
}

/** A green seen from the tee: where approach misses finish. dirs: [{ direction: 'Short'|'Long'|'Left'|'Right', pct, count }]. */
export function green({ dirs }) {
  const by = Object.fromEntries((dirs || []).map((d) => [d.direction, d])); if (!dirs?.length) return '';
  const top = Math.max(...dirs.map((d) => d.pct || 0)), tot = dirs.reduce((s, d) => s + (d.count || 0), 0);
  const order = ['Long', 'Left', 'Right', 'Short'], caps = order.map((k) => `${k}: ${pctTxt(by[k]?.pct)} of missed greens (${by[k]?.count ?? 0} of ${tot})`), id = reg({ kind: 'tap', sel: '.ch-zone', caps });
  const pos = { Long: [165, 22, 120, 4, 330, 36], Left: [48, 70, 0, 38, 96, 54], Short: [165, 127, 120, 106, 330, 42], Right: [282, 70, 234, 38, 96, 54] };
  const z = (k, i) => { const d = by[k] || {}, [cx, cy, hx, hy, hw, hh] = pos[k], dom = d.pct === top && top > 0;
    return `<g class="ch-zone" data-i="${i}"><rect class="hit" x="${hx}" y="${hy - (k === 'Short' ? 0 : 0)}" width="${hw}" height="${hh}"/><text class="big" x="${cx}" y="${cy}" text-anchor="middle" style="fill:${dom ? 'var(--bad)' : 'var(--ink)'}">${pctTxt(d.pct)}</text><text class="tick" x="${cx}" y="${cy + 13}" text-anchor="middle">${k.toLowerCase()}</text></g>`; };
  return `<div class="ch" id="${id}" role="img" aria-label="${esc(`Missed greens: ${order.map((k) => `${k.toLowerCase()} ${pctTxt(by[k]?.pct)}`).join(', ')}`)}"><svg viewBox="0 0 330 148" aria-hidden="true" focusable="false">
    <rect width="330" height="148" rx="12" style="fill:color-mix(in srgb, var(--good) 8%, var(--card))"/><ellipse cx="165" cy="74" rx="66" ry="30" style="fill:color-mix(in srgb, var(--good) 40%, var(--card))"/>
    <line x1="165" y1="74" x2="165" y2="58" style="stroke:var(--ink);stroke-width:1.5"/><path d="M165 58 L177 63 L165 68Z" style="fill:var(--gold)"/><circle cx="165" cy="74" r="2.5" style="fill:var(--ink)"/>${order.map((k, i) => z(k, i)).join('')}</svg><div class="ch-cap">Tap a side for details.</div></div>`;
}

// ------------------------------------------------------------------ wiring
/** Attach pointer and tap handlers to every chart registered since the last resetCharts(). Safe to call more than once. */
export function wireCharts(root = document) {
  for (const s of REG) {
    const el = root.querySelector(`#${s.id}`); if (!el || el.dataset.wired) continue; el.dataset.wired = '1';
    if (s.kind === 'scrub') wireScrub(el, s); else wireTap(el, s);
  }
}
function wireScrub(el, s) {
  const svg = el.querySelector('svg'); if (!svg || !s.snap.length) return;
  const cur = svg.querySelector('.ch-cur'), dot = svg.querySelector('.ch-dot'), out = { big: el.querySelector('.ch-big'), lab: el.querySelector('.ch-lab'), sub: el.querySelector('.ch-sub'), cap: el.querySelector('.ch-cap') }, orig = {};
  for (const k in out) if (out[k]) orig[k] = out[k].innerHTML;
  const at = (cx) => { const r = svg.getBoundingClientRect(), x = (cx - r.left) / (r.width || 1) * s.vbw; let b = 0; s.snap.forEach((p, i) => { if (Math.abs(p.x - x) < Math.abs(s.snap[b].x - x)) b = i; }); return b; };
  const show = (i) => { const p = s.snap[i], r = s.reads[i]; cur.setAttribute('x1', p.x); cur.setAttribute('x2', p.x); dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y); cur.style.opacity = 1; dot.style.opacity = 1; for (const k in out) if (out[k] && r[k] !== undefined) out[k].textContent = r[k]; };
  const restore = () => { cur.style.opacity = 0; dot.style.opacity = 0; for (const k in out) if (out[k]) out[k].innerHTML = orig[k]; };
  let sticky = -1, down = false, moved = false, x0 = 0;
  svg.addEventListener('pointerdown', (e) => { down = true; moved = false; x0 = e.clientX; try { svg.setPointerCapture(e.pointerId); } catch { /* not needed for touch */ } });
  svg.addEventListener('pointermove', (e) => { if (!down) return; if (!moved && Math.abs(e.clientX - x0) > 4) moved = true; if (moved) show(at(e.clientX)); });
  svg.addEventListener('pointerup', (e) => {
    if (!down) return; down = false;
    if (moved) { sticky = -1; restore(); return; }          // a drag shows the round under your finger and lets go when you lift
    const i = at(e.clientX); if (sticky === i) { sticky = -1; restore(); } else { sticky = i; show(i); }   // a tap keeps that round up until you tap again
  });
  svg.addEventListener('pointercancel', () => { down = false; if (sticky >= 0) show(sticky); else restore(); });   // the page started to scroll
}
function wireTap(el, s) {
  const cap = el.querySelector('.ch-cap'); if (!cap) return; const orig = cap.textContent; let sel = -1;
  el.addEventListener('click', (e) => {
    const g = e.target.closest(s.sel); if (!g || !el.contains(g)) return; const i = +g.dataset.i;
    el.querySelectorAll(`${s.sel}.on`).forEach((x) => x.classList.remove('on'));
    if (sel === i) { sel = -1; cap.textContent = orig; } else { sel = i; g.classList.add('on'); cap.textContent = s.caps[i]; }
  });
}
