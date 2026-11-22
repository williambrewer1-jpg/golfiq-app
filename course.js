// BreakingPar Course view: the hole on one full-screen map while you play – live GPS yardages, an aim you can move,
// the shot pattern for the club in hand, and a bottom sheet with the club, strategy and score (plan: claude/course-view-plan.md).
// Rendering and wiring only; the maths lives in holemap.js, features.js and strategy.js, the round in play.js.
import * as F from './features.js';
import * as HM from './holemap.js';
import * as ST from './strategy.js';
import * as FEEL from './feel.js';
import * as SH from './shots.js';
import { registerTrack } from './track.js';
import { registerStrategy, HOLD_MS } from './strategyview.js';

// ---- tunable numbers (plan section 10 and 4.x)
export const CV_AUTO_OPEN = true;               // opens by itself whenever a round is in progress
export const GPS_REDRAW_MS = 1000;              // live updates at most once a second
export const GPS_GOOD_M = 10;                   // GPS dot: good at 10 m or better
export const FAR_AWAY_M = 1500;                 // further than this from the hole: preview from the tee
export const ON_TEE_M = 25;                     // within this of the tee counts as on the tee
export const VIEW_MARGIN_PX = 24;               // redraw the map when you walk this close to the edge of the clear area
export const HANDLE_GRAB_PX = 44;               // a press this close to the handle (or the aim ring) drags the aim
export const TAP_SLOP_PX = 10;                  // movement under this is a tap, not a drag
export const SWIPE_PX = 50;                     // a sideways swipe on the top bar this long changes hole
export const SHEET_DRAG_PX = 40;                // dragging the sheet handle this far changes its height
export const MAP_MAX_K = 8;
export const REZOOM_RATIO = 1.4;                // Shot zoom: rebuild the map when the right scale for where you are now differs by this much
export const BOTTOM_CLEAR_PX = 34;             // extra room above the sheet so your own dot is never under it                     // pixels per metre: the Green zoom never goes closer than this
export const NEXT_TEE_M = 40;                   // "Go to hole N?" when the hole has a score and you are this close to the next tee
export const PINCH_MIN_K = 0.4;                 // pinch and pan: furthest out (pixels per metre; about 1 km across a phone)
export const PINCH_MAX_K = 16;                  // and closest in (about 25 m across a phone)
export const SHEETS = ['peek', 'half', 'full'];
export const TABS = ['club', 'strategy', 'score', 'card'];      // the sheet's height (handle) and its content (tabs) are independent

export function registerCourse(c, P) {
  const { A, $, $$, esc, toast } = c;
  const T = FEEL.COPY.course, U = () => c.UNIT;
  let L = null, M = null, V = null, wake = null, raf = 0, lastLive = 0, timer = 0, dragging = false, st = null;
  let insets = { t: 128, b: 196, l: 0 };                // measured after the first draw
  let UV = null;                                        // a view you pinched or panned to: { hole, fr }; kept until Recentre, Zoom or another hole
  let offer = null, markable = null;                    // the next-hole banner and the mark green / tee buttons, worked out in chrome()
  const active = () => !!document.getElementById('cvRoot');
  const sheet = () => (SHEETS.includes(c.ui.pl_sheet) ? c.ui.pl_sheet : 'peek');
  const tab = () => (TABS.includes(c.ui.pl_stab) ? c.ui.pl_stab : 'club');
  const zoom = () => (HM.ZOOMS.includes(c.ui.pl_zoom) ? c.ui.pl_zoom : 'shot');
  const yd = (m) => c.d0(m);

  // ------------------------------------------------------------ screen wake lock (feature-detected; nothing shown when missing)
  async function lock() {
    if (wake || document.visibilityState !== 'visible' || !navigator.wakeLock?.request) return;
    try { wake = await navigator.wakeLock.request('screen'); wake.addEventListener?.('release', () => { wake = null; }); } catch { wake = null; }
  }
  function release() { const w = wake; wake = null; try { w?.release?.(); } catch { /* already released */ } }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && active()) lock(); else if (document.visibilityState !== 'visible') release(); });
  addEventListener('hashchange', () => setTimeout(() => { if (!active()) release(); }, 0));

  // ------------------------------------------------------------ the live picture of the hole
  const marks = (d) => { const k = HM.markKey(d); return (k && c.state.journal.course_marks?.[k]) || {}; };
  function where(d) {
    const fix = P.fix(), known = d.course_id ? F.courseHoles(c.DS, d.course_id) : {}, feats = P.featsFor(d);
    const gpsPos = fix ? [fix.lat, fix.lon] : null, ht = HM.withMarks(HM.holeTargets(known[d.hole], feats, d.hole, gpsPos), marks(d)[d.hole]);
    const farAway = gpsPos && (ht.green || ht.tee) && A.haversine(gpsPos[0], gpsPos[1], ...(ht.green || ht.tee)) > FAR_AWAY_M;
    // tracking: once a shot has been played, a known ball you are not standing by (marked on the map, a drop, a replay
    // after out of bounds) is where the map measures from
    const h = d.holes[d.hole], ball = d.track && h.shots?.length ? SH.ballPos(h, ht.tee) : null;
    const usingBall = !!ball && c.ui.pl_pos !== 'tee' && (!fix || fix.acc > SH.POOR_GPS_M || A.haversine(gpsPos[0], gpsPos[1], ball[0], ball[1]) > SH.BALL_NEAR_M);
    const usingTee = usingBall || c.ui.pl_pos === 'tee' || !fix || !!farAway;
    const pos = usingBall ? ball : usingTee ? ht.tee : gpsPos;
    let green = ht.green;
    if (!green && pos && feats.length) { const alts = F.nearestGreens(pos[0], pos[1], feats); if (alts.length) green = alts[0].pin; }
    return { fix, known, feats, gpsPos, ht, farAway, usingTee, usingBall, pos, green };
  }
  // what is missing, in one short line
  function missingLine(w) {
    const bits = [], err = P.gpsErr();
    if (!w.fix) bits.push(/declined/i.test(err) ? T.missing.declined : T.missing.gps);
    else if (w.farAway) bits.push(T.missing.far((A.haversine(w.gpsPos[0], w.gpsPos[1], ...(w.ht.green || w.ht.tee)) / 1000).toFixed(1)));
    if (w.usingBall) bits.push(FEEL.COPY.track.fromBall);
    else if (!w.fix && w.pos) bits.push(T.missing.tee);
    if (!w.feats.some((f) => f.kind !== 'hole')) bits.push(T.missing.map);
    else if (L && !L.grid && !L.wx) bits.push(T.missing.terrain);
    const s = bits.slice(0, 2).join(' · ');
    return s ? s[0].toUpperCase() + s.slice(1) : '';
  }
  function yards() {
    if (!L) return { mid: null };
    const mid = A.haversine(L.pos[0], L.pos[1], L.green[0], L.green[1]);
    const e = HM.greenEdges(L.pos, L.green, L.greenPts) || (L.greenPts ? F.greenFrontBack(L.pos[0], L.pos[1], L.green, L.feats) : null);
    return { mid, front: e ? Math.max(0, e.front_m) : null, back: e ? e.back_m : null };
  }
  const viewBottom = () => (L?.fr?.view ? L.fr.view.t + L.fr.view.h : innerHeight);
  function dynHtml() {
    const [, ay] = L.fr.xy(...L.aim);
    const quiet = TR.quiet();
    return SV.labelsSvg(L.fr) + TR.shotsSvg(L.fr, L.d) + HM.dynamicSvg(L.fr, { pos: L.pos, aim: L.aim, green: L.green, pat: quiet ? null : V || M.pat, cv: c.cv, unit: U(), clubName: quiet ? null : M.club?.name, big: true,
      pad: L.padOff ?? HM.padOffset(ay, viewBottom()), live: { rings: M ? A.haversine(L.pos[0], L.pos[1], L.green[0], L.green[1]) + 40 : 0, acc: L.usingTee ? null : P.fix()?.acc } }) + SV.measureSvg(L.fr);
  }

  // ------------------------------------------------------------ the shot pattern as drawn in the Course view (plan section 5)
  const showShots = () => !!c.ui.pl_shots;
  function remodel() { M = P.model(L); V = pview(); }
  // How sure the pattern is: 'own' (from your shots), 'estimated' (spread borrowed from your other clubs), 'distance' (arc only), 'none'
  const kindOf = HM.patternKind;
  function pview() {
    const pt = M?.pt, kind = kindOf(pt); if (!L || !M || kind === 'none') return null;
    const adj = M.adj, ticks = pt.partial_swing ? null : HM.rangeTicks(L.pos, L.aim, pt.p25_m, pt.p75_m, adj);
    if (kind === 'distance') {
      const br = A.bearing(L.pos[0], L.pos[1], L.aim[0], L.aim[1]);
      return { v2: true, kind, ticks, arc: Array.from({ length: 17 }, (_, i) => F.destination(L.pos[0], L.pos[1], br - 8 + i, adj(pt.median_m))) };
    }
    const cor = HM.corridor(L.pos, L.aim, pt.stats, adj); if (!cor) return null;
    const haz = M.nearFeats ? HM.clipZone(cor.outer || cor.inner, M.nearFeats) : [];
    const miss = kind === 'own' ? HM.missOffset(pt.stats, M.aimDist, adj) : null;
    return { v2: true, kind, ticks, ...cor, haz, miss, risk: M.pat?.risk ?? null, dots: kind === 'own' && showShots() ? (M.pat?.dots || []) : [] };
  }
  const SURF = [['fairway', '#a3d36c'], ['green', '#5fbf4f'], ['rough', '#6fa64a'], ['bunker', '#e6cf86'], ['water', '#3d8bd0'], ['trees', '#24552a']];
  const TROUBLE = new Set(['bunker', 'water', 'trees']);
  function outcomeHtml() {
    const o = M?.out; if (!o) return '';
    const seg = SURF.map(([k, col]) => ({ k, col, v: o[k] || 0 })).filter((x) => x.v >= 0.5).sort((a, b) => b.v - a.v);
    const open = !!c.ui.pl_out_open, shown = open ? seg : seg.slice(0, 2), more = seg.length - shown.length;
    const bar = seg.map((x) => `<i class="${TROUBLE.has(x.k) ? 'tr' : ''}" style="width:${x.v.toFixed(1)}%;background-color:${x.col}"></i>`).join('');
    return `<button type="button" class="cv-out" data-cvout aria-expanded="${open}"><span class="cv-otop"><span class="cv-obar">${bar}</span><span class="t">${esc(T.trouble(Math.round(o.trouble)))}</span></span>
      <span class="cv-oleg">${shown.map((x) => `<span><b class="${TROUBLE.has(x.k) ? 'tr' : ''}" style="background-color:${x.col}"></b>${esc(T.surf[x.k])} ${Math.round(x.v)}%</span>`).join('')}${more ? `<span class="m">${esc(T.more(more))}</span>` : ''}</span></button>`;
  }
  function sureText() {
    const pt = M?.pt, k = kindOf(pt);
    if (k === 'own') return T.sure.own(pt.stats.n);
    if (k === 'estimated') return T.sure.est;
    if (k === 'distance') return T.sure.dist(Math.max(1, A.T.min_shots_dispersion - (pt.real_n ?? pt.stats?.n ?? 0)));
    return M?.club ? T.sure.none : '';
  }
  function missHtml() {
    const m = V?.miss; if (!m?.show || !M?.club) return '';
    if (L.adjusted) return `<p class="cv-miss">${esc(T.adjusted)}</p>`;
    const u = U(), side = Math.round(c.cv(Math.abs(m.right_m))), lng = m.long_m === null ? 0 : Math.round(c.cv(Math.abs(m.long_m)));
    const parts = [side ? `${side} ${u} ${m.right_m > 0 ? 'right' : 'left'}` : null, lng ? `${lng} ${m.long_m > 0 ? 'long' : 'short'}` : null].filter(Boolean);
    if (!parts.length) return '';
    return `<div class="cv-miss"><span>${esc(T.miss(M.club.name, parts.join(' and ')))}</span>${m.allow ? `<button type="button" class="btn sec" data-cvallow>${esc(T.allow)}</button>` : ''}</div>`;
  }
  function rangeText() {
    const pt = M?.pt; if (!pt || pt.partial_swing || !A.isNum(pt.p25_m) || !A.isNum(pt.p75_m)) return '';
    return T.usual(yd(M.adj(pt.p25_m)), yd(M.adj(pt.p75_m)), U());
  }

  // Build the map for the current hole: frame, static layer, moving layer. Called on open, hole change, zoom, recentre,
  // and when you walk out of the picture – never on every GPS fix.
  function drawMap() {
    const d = P.D(), root = $('#cvRoot'), box = $('#cvMap'); if (!d || !root || !box) return;
    const w = where(d);
    if (!w.pos || !w.green) {
      L = null; M = null; V = null; P.setLive(null);
      const ms = P.mapStatus(d);
      box.innerHTML = `<div class="cv-empty"><p>${esc(!w.pos ? T.noPos : ms?.state === 'loading' ? T.mapLoading : ms?.state === 'failed' ? T.mapFailed : T.missing.green)}</p></div>`;
      chrome(w); return;
    }
    const saved = d.aim?.[d.hole], onTee = w.usingTee || (w.ht.tee && A.haversine(w.pos[0], w.pos[1], w.ht.tee[0], w.ht.tee[1]) < ON_TEE_M);
    // an aim you have set stays fixed on the ground; an untouched one follows you (decided with Wills, 17 Nov 2026)
    const custom = !!saved, aim = custom ? saved.pt : P.defaultAim(w.pos, w.green, w.ht.line, onTee);
    const clubKey = `${d.id}|${d.hole}`;
    L = { d, hole: d.hole, pos: w.pos, green: w.green, aim, feats: w.feats, line: w.ht.line, tee: w.ht.tee, clubs: P.playClubs(), usingTee: w.usingTee, onTee,
      club: c.ui.pl_club_hole === clubKey ? c.ui.pl_club : null, custom, adjusted: !!(custom && saved.adjusted), greenPts: HM.greenOutline(w.green, w.feats) };
    L.wx = P.weatherNow(d, w.pos); L.grid = Object.values(c.state.elev || {}).find((g) => ST.gridCovers(g, [w.pos, w.green, aim])) || null;
    remodel();
    L.fr = frameFor();
    if (!L.grid) P.fetchElev(L.fr);
    const hasMap = w.feats.some((f) => f.kind !== 'hole');
    const style = c.ui.pl_style === 'sat' || !hasMap ? 'sat' : 'map';
    const stat = HM.staticSvg(L.fr, { feats: w.feats, style, tileList: style === 'sat' ? HM.tiles(L.fr, L.pos[0]) : null, green: L.green, tee: L.usingTee ? null : L.tee, line: L.line, pos: L.pos, unit: U(), cv: c.cv, noPos: true });
    box.innerHTML = HM.svg(L.fr, stat, dynHtml(), style).replace('class="holemap', 'class="holemap cv-svg') + `<span class="hmcredit">${style === 'sat' ? 'Imagery © Esri' : '© OpenStreetMap'}</span>`;
    P.setLive(L); lastLive = Date.now();
    chrome(w);
  }

  function frameFor() {
    if (UV && UV.hole === L.hole && UV.usingTee === L.usingTee) return UV.fr;
    UV = null;
    const root = $('#cvRoot'), ell = M?.pat?.ell90 || M?.pat?.ell50 || M?.pat?.arc || [];
    const zp = HM.zoomPoints(zoom(), { pos: L.pos, aim: L.aim, green: L.green, tee: L.tee, line: L.line, greenPts: L.greenPts, extra: ell.filter((_, i) => i % 6 === 0) });
    const W = root?.clientWidth || innerWidth, H = root?.clientHeight || innerHeight;
    return HM.makeFrame(L.pos, L.green, zp.pts, W, H, { inset: { t: insets.t, b: insets.b + BOTTOM_CLEAR_PX, l: insets.l, r: 0 }, exact: zp.exact, pad: zp.pad, maxK: MAP_MAX_K });
  }

  // ------------------------------------------------------------ chrome: top bar, green distances, peek
  function chrome(w = null) {
    const d = P.D(); if (!d || !active()) return;
    w = w || where(d);
    const h = d.holes[d.hole], t = P.scoreTotals(d), holeLen = w.ht.tee && w.green ? A.haversine(w.ht.tee[0], w.ht.tee[1], w.green[0], w.green[1]) : null;
    const si = h.si || w.known[d.hole]?.si || null;
    $('#cvTitle').innerHTML = `${esc(T.hole(d.hole))} <span>· ${esc(T.par(h.par))}${si ? ` · ${esc(T.si(si))}` : ''}</span>`;
    const acc = w.fix ? `${yd(w.fix.acc)} ${U()}` : '';
    const gq = !w.fix ? 'none' : w.fix.acc <= GPS_GOOD_M ? 'good' : 'weak';
    $('#cvSub').innerHTML = `${holeLen ? `<span>${yd(holeLen)} ${U()}</span>` : ''}<span>${esc(T.thru(P.toParText(t.toPar), t.played.length))}</span>
      <button type="button" class="cv-gps ${gq}" data-cvgps aria-label="GPS accuracy"><i></i>${esc(gq === 'none' ? T.gps.none : gq === 'good' ? T.gps.good(acc) : T.gps.weak(acc))}</button>`;
    const msg = missingLine(w); $('#cvMsg').textContent = msg; $('#cvMsg').hidden = !msg;
    const tip = SV.chip(), tipEl = $('#cvTip'), had = !!tipEl.firstChild;
    if (tipEl.innerHTML !== tip) tipEl.innerHTML = tip;
    if (had !== !!tip && L && measure()) { setTimeout(drawMap, 0); }
    const had2 = `${offer}|${markable?.green}|${markable?.tee}`;
    offer = nextOffer(d, w); markable = markOffer(d, w);
    if (had2 !== `${offer}|${markable?.green}|${markable?.tee}` && L) setTimeout(() => { if (measure()) drawMap(); }, 0);
    const y = yards(), yb = $('#cvYards');
    yb.hidden = !L;
    if (L) yb.innerHTML = `${y.front !== null ? `<div class="f"><span>${T.front}</span><b>${yd(y.front)}</b></div>` : ''}<div class="m"><span>${y.front !== null ? T.middle : T.toGreen}</span><b>${yd(y.mid)}</b></div>${y.back !== null ? `<div class="b"><span>${T.back}</span><b>${yd(y.back)}</b></div>` : ''}`;
    peek();
  }
  // "Go to hole 8?": the hole has a score and you are standing by the next tee. One tap, never automatic.
  function nextOffer(d, w) {
    const o = P.holeOrder(d), n = o[o.indexOf(d.hole) + 1];
    if (n === undefined || !(d.holes[d.hole].strokes > 0) || !w.fix || w.fix.acc > NEXT_TEE_M || c.ui.pl_next_off === `${d.id}|${n}`) return null;
    const tee = HM.withMarks(HM.holeTargets(w.known[n], w.feats, n, w.gpsPos), marks(d)[n]).tee;
    return tee && A.haversine(w.gpsPos[0], w.gpsPos[1], tee[0], tee[1]) <= NEXT_TEE_M ? n : null;
  }
  // Mark this green / tee (plan 4.5): offered only for what is not known. The tee only before the hole has been started.
  function markOffer(d, w) {
    if (P.mapStatus(d)) return null;                     // still downloading, or the map server was busy: the map may know this hole
    const h = d.holes[d.hole], tee = !w.ht.tee && !(h.strokes > 0) && !h.shots?.length;
    if (w.ht.green && !tee) return null;
    return { green: !w.ht.green, tee, ready: !!w.fix && w.fix.acc <= SH.POOR_GPS_M };
  }
  function bannerHtml(d) {
    const h = d.holes[d.hole], out = [];
    if (P.mapStatus(d)?.state === 'failed') out.push(`<div class="cv-marks" id="cvMapFail"><div class="row"><button type="button" class="btn sec" data-cvmapretry>${esc(T.mapRetry)}</button></div><p class="small muted">${esc(P.mapStatus(d).msg)}</p></div>`);
    if (offer && !(TR.on(d) && h.done)) out.push(`<div class="cv-next" id="cvNext"><button type="button" class="btn cv-big" data-cvnext="${offer}">${esc(T.nextAsk(offer))}</button><button type="button" class="btn sec" data-cvnextno>${esc(T.nextNo)}</button></div>`);
    if (markable && !TR.marking()) {
      const btn = (k, label) => `<button type="button" class="btn sec" data-cvmark="${k}"${markable.ready ? '' : ' disabled'}>${esc(label)}</button>`;
      out.push(`<div class="cv-marks" id="cvMarks"><div class="row">${markable.green ? btn('green', T.markGreen) : ''}${markable.tee ? btn('tee', T.markTee) : ''}</div>
        <p class="small muted">${esc(markable.ready ? T.markNote : T.markWait(`${yd(SH.POOR_GPS_M)} ${U()}`))}</p></div>`);
    }
    return out.join('');
  }
  async function markHere(kind) {
    const d = P.D(), f = P.fix(), key = HM.markKey(d); if (!d || !key || !f || f.acc > SH.POOR_GPS_M) return;
    const J = c.state.journal; J.course_marks = J.course_marks || {}; J.course_marks[key] = J.course_marks[key] || {};
    const m = J.course_marks[key][d.hole] = { ...(J.course_marks[key][d.hole] || {}) };
    m[kind] = [f.lat, f.lon]; m[`${kind}_at`] = new Date().toISOString();
    await P.saveDraft(); FEEL.play('tap'); toast(kind === 'green' ? T.markedGreen(d.hole) : T.markedTee(d.hole)); L = null; drawMap();
  }
  async function forgetMarks() {
    const d = P.D(), key = HM.markKey(d), all = c.state.journal.course_marks?.[key]; if (!all?.[d.hole]) return;
    delete all[d.hole]; await P.saveDraft(); toast(T.forgot); L = null; drawMap(); refreshSheet();
  }
  function peek() {
    const d = P.D(), el = $('#cvPeek'); if (!d || !el) return;
    const h = d.holes[d.hole], pl = M?.pl, aimD = M?.aimDist;
    const plays = !M ? '' : Math.abs(pl.plays_m - aimD) >= 0.9 ? T.plays(yd(pl.plays_m)) : (L.grid || L.wx) ? T.playsFlat : '';
    const tr = M?.out ? T.trouble(Math.round(M.out.trouble)) : M ? T.noTrouble : '';
    const parts = pl?.parts, bits = !parts ? [] : [Math.abs(parts.elev) >= 0.9 ? `${parts.elev > 0 ? 'uphill' : 'downhill'} ${sg(parts.elev)}` : null, Math.abs(parts.wind) >= 0.9 ? `wind ${sg(parts.wind)}` : null,
      Math.abs(parts.temp) >= 0.9 ? `${Math.round(L.wx?.temp_c)}°C ${sg(parts.temp)}` : null, Math.abs(parts.alt) >= 0.9 ? `altitude ${sg(parts.alt)}` : null].filter(Boolean);
    const sc = h.strokes > 0 ? T.scoreHole(h.strokes, P.toParText(h.strokes - h.par)) : T.score;
    const info = `<div class="cv-prow">
        <button type="button" class="cv-club" data-cvpeekclub aria-label="${esc(T.pickClub)}"><b>${esc(M?.club?.name || T.noClub)}</b><span>▾</span></button>
        <div class="cv-pnum">${M ? `<b>${yd(aimD)}</b><span>${esc(U())} to aim</span>` : ''}</div>${!plays && rangeText() ? `<span class="cv-range">${esc(rangeText())}</span>` : ''}</div>
      ${plays ? `<div class="cv-prow2"><button type="button" class="cv-plays" data-cvplays>${esc(plays)}</button>${rangeText() ? `<span class="cv-range">${esc(rangeText())}</span>` : ''}</div>` : ''}
      ${M?.out ? outcomeHtml() : M ? `<p class="cv-sure">${esc(sureText() || tr)}</p>` : ''}
      ${missHtml()}
      ${c.ui.pl_plays_open && bits.length ? `<p class="cv-why">${esc(bits.join(' · '))}${L?.wx ? ` · wind ${Math.round(L.wx.wind_kmh)} km/h from ${P.compass(L.wx.wind_from)}` : ''}</p>` : ''}`;
    el.dataset.track = TR.on(d) ? 'on' : '';
    el.innerHTML = bannerHtml(d) + (TR.peek(info) ?? info + `<div class="cv-pbtns"><button type="button" class="btn cv-big" data-cvscore>${esc(sc)}</button><button type="button" class="btn sec cv-card-btn" data-cvcard><small>${esc(T.tabs.card)}</small>${esc(cardSub(d))}</button></div>`);
  }
  const cardSub = (d) => { const t = P.scoreTotals(d); return t.played.length ? T.thruShort(P.toParText(t.toPar), t.played.length) : T.noHoles; };
  const sg = (v) => `${v > 0 ? '+' : '−'}${yd(Math.abs(v))}`;

  // ------------------------------------------------------------ the sheet body (half: tabs; full: the scorecard)
  function sheetBody() {
    const d = P.D(); if (!d) return '';
    if (sheet() === 'peek') return '';
    const back = `<button type="button" class="btn sec cv-back" data-cvsheet="peek">${esc(T.backToMap)}</button>`;
    const tb = `<div class="seg cv-tabs" role="tablist">${TABS.map((k) => `<button type="button" role="tab" data-cvtab="${k}" class="${tab() === k ? 'on' : ''}">${esc(T.tabs[k])}</button>`).join('')}</div>`;
    if (tab() === 'card') return tb + `<div class="cv-card">${P.scoreSummaryHtml(d)}</div>${P.groupHtml(d)}${back}`;
    if (tab() === 'score') { const top = TR.scoreTop(d); return tb + top + `<div class="cv-card cv-score">${P.scoreEntryHtml(d, { chip: !top })}</div>` + TR.scoreBottom(d) + `<button type="button" class="btn sec cv-tocard" data-cvtab="card">${esc(T.toCard)}</button>${back}`; }
    if (tab() === 'strategy') return tb + SV.tab() + back;
    const seg = (key, opts, val) => `<div class="seg">${opts.map(([v, l]) => `<button type="button" data-${key}="${v}" class="${val === v ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
    const hasMap = L?.feats.some((f) => f.kind !== 'hole');
    const sure = sureText(), own = kindOf(M?.pt) === 'own';
    const how = M?.club ? `<div class="cv-card cv-how"><p><b>${esc(M.club.name)}</b> · ${esc(sure)}${rangeText() ? ` · ${esc(rangeText())}` : ''}</p>
        ${own ? `<button type="button" class="btn sec" data-cvshots aria-pressed="${showShots()}">${esc(showShots() ? T.hideShots : T.showShots)}</button><p class="small muted">${esc(T.shotsNote)}</p>` : ''}</div>` : '';
    return tb + how + (L && M ? `<div id="plRec" class="cv-card">${P.recHtml(L, M)}</div>` : `<p class="small muted">${esc(T.noGreen)}</p>`)
      + `<div class="cv-card"><label class="f">${esc(T.from)}</label>${seg('cvpos', [['gps', T.fromGps], ['tee', T.fromTee]], c.ui.pl_pos === 'tee' ? 'tee' : 'gps')}
        ${hasMap ? `<label class="f">${esc(T.style)}</label>${seg('cvstyle', [['map', T.styleMap], ['sat', T.styleSat]], c.ui.pl_style === 'sat' ? 'sat' : 'map')}` : ''}
        ${P.osmHint(d, L?.pos || null)}${markedHtml(d)}</div>${back}`;
  }
  function markedHtml(d) {
    const m = marks(d)[d.hole], w = m ? where(d) : null; if (!w || (!w.ht.marked.green && !w.ht.marked.tee)) return '';
    const what = w.ht.marked.green && w.ht.marked.tee ? 'green and tee' : w.ht.marked.green ? 'green' : 'tee';
    return `<p class="small muted" style="margin-top:10px">${esc(T.marks(what))}</p><button type="button" class="btn sec" data-cvforget>${esc(T.forgetMarks)}</button>`;
  }
  // Redraw the sheet. A change inside the same tab (a stepper, Fairway, Par) keeps the scroll position; a new tab starts at the top.
  let shown = '';
  function refreshSheet() {
    const root = $('#cvRoot'), body = $('#cvBody'); if (!root || !body) return;
    const view = `${sheet()}|${tab()}|${P.D()?.hole}`, keep = view === shown ? body.scrollTop : 0; shown = view;
    root.dataset.sheet = sheet();
    $('#cvHandle')?.setAttribute('aria-expanded', String(sheet() !== 'peek'));
    body.innerHTML = sheetBody(); body.scrollTop = keep;
    if (sheet() !== 'peek' && tab() === 'card') P.wireGroup(P.D(), async () => { await P.saveDraft(); c.rerender(); });
    if (sheet() !== 'peek' && tab() === 'strategy') setTimeout(strategy, 30);
    chrome();
  }
  function strategy() {
    const el = $('#cvStrat'); if (!el) return;
    try { el.innerHTML = L ? P.strategyHtml() : esc(T.noGreen); } catch (e) { el.textContent = `Could not compare: ${e.message}`; }
  }
  function setSheet(s, t = null) { c.ui.pl_sheet = s; if (t) c.ui.pl_stab = t; c.saveUi(); refreshSheet(); }
  const open = (t) => setSheet(sheet() === 'full' ? 'full' : 'half', t);        // a tab keeps the height you chose

  // ------------------------------------------------------------ live updates (GPS) and aim changes: moving layer only
  function live() {
    const d = P.D(); if (!active() || !d) return;
    const w = where(d);
    // the picture itself changes (first fix, switched to/from the tee view, walked out of the frame): rebuild the map
    if (!L || !w.pos || !w.green || w.usingTee !== L.usingTee || (!w.usingTee && !UV && !HM.inView2(L.fr, w.pos, VIEW_MARGIN_PX))) { drawMap(); return; }
    if (!w.usingTee) {
      L.pos = w.pos;
      L.onTee = !!(L.tee && A.haversine(L.pos[0], L.pos[1], L.tee[0], L.tee[1]) < ON_TEE_M);
      if (!L.custom) L.aim = P.defaultAim(L.pos, L.green, L.line, L.onTee);
      remodel();
      // Shot zoom follows you: once you have walked on far enough that the picture is much too wide (or tight), rebuild it
      if (zoom() === 'shot' && !UV) { const k = frameFor().k / L.fr.k; if (k > REZOOM_RATIO || k < 1 / REZOOM_RATIO) { drawMap(); return; } }
    }
    $('#hmDyn').innerHTML = dynHtml();
    chrome(w);
    const rec = $('#plRec'); if (rec) rec.innerHTML = P.recHtml(L, M);
    lastLive = Date.now();
  }
  function onFix() {
    if (!active()) return;
    const wait = GPS_REDRAW_MS - (Date.now() - lastLive);
    if (wait <= 0 && !dragging) { live(); return; }
    clearTimeout(timer); timer = setTimeout(() => { if (!dragging) live(); else onFix(); }, Math.max(wait, 50));
  }
  function aimMoved() {
    if (!L) return;
    remodel();
    $('#hmDyn').innerHTML = dynHtml(); peek();
    const rec = $('#plRec'); if (rec) rec.innerHTML = P.recHtml(L, M);
  }
  function toggleShots() { c.ui.pl_shots = !showShots(); c.saveUi(); if (L) { V = pview(); $('#hmDyn').innerHTML = dynHtml(); } }
  async function saveAim() {
    const d = L.d; d.aim = d.aim || {}; d.aim[L.hole] = { pt: L.aim, from: L.pos }; if (L.adjusted) d.aim[L.hole].adjusted = true;
    c.ui.pl_club = L.club; c.ui.pl_club_hole = L.club ? `${d.id}|${L.hole}` : null; c.saveUi(); await P.saveDraft();
  }
  async function recentre() {
    const d = P.D(); if (d?.aim) delete d.aim[d.hole];
    c.ui.pl_club = null; c.saveUi(); await P.saveDraft(); L = null; UV = null; zoomLabel(); drawMap();
  }
  function zoomLabel() { const b = $('[data-cvzoom]'); if (b) b.innerHTML = `<small>${esc(T.zoomLabel)}</small>${esc(T.zoom(UV ? 'free' : zoom()))}`; }
  async function goHole(n) {
    const d = P.D(); if (!d || !d.holes[n]) return;
    d.hole = n; if (d.aim) delete d.aim[n]; c.ui.pl_club = null; c.saveUi(); L = null; UV = null;
    await P.saveDraft(); c.rerender();
  }
  function stepHole(dir) {
    const d = P.D(), o = P.holeOrder(d), i = o.indexOf(d.hole), j = i + dir;
    if (j >= 0 && j < o.length) goHole(o[j]);
  }

  // ------------------------------------------------------------ render + wire
  function render(d) {
    return `<div class="cv" id="cvRoot" data-sheet="${sheet()}">
      <div class="cv-map" id="cvMap"></div>
      <div class="cv-top" id="cvTop">
        <div class="cv-trow"><button type="button" class="cv-ibtn" data-cvclose aria-label="${esc(T.close)}">✕</button>
          <button type="button" class="cv-ibtn" data-cvstep="-1" aria-label="${esc(T.prev)}">‹</button>
          <h2 id="cvTitle">${esc(T.hole(d.hole))}</h2>
          <button type="button" class="cv-ibtn" data-cvstep="1" aria-label="${esc(T.next)}">›</button></div>
        <div class="cv-sub" id="cvSub"></div>
        <p class="cv-msg" id="cvMsg" hidden></p>
        <div id="cvTip"></div>
      </div>
      <div class="cv-yards" id="cvYards" hidden></div>
      <div class="cv-sheet" id="cvSheet">
        <div class="cv-tools"><button type="button" class="cv-tbtn" data-cvzoom aria-label="${esc(T.zoomLabel)}"><small>${esc(T.zoomLabel)}</small>${esc(T.zoom(UV && UV.hole === d.hole ? 'free' : zoom()))}</button>
          <button type="button" class="cv-tbtn" data-cvrecentre>${esc(T.recentre)}</button></div>
        <button type="button" class="cv-handle" id="cvHandle" aria-label="${esc(T.sheet)}" aria-expanded="${sheet() !== 'peek'}"><i></i></button>
        <div class="cv-peek" id="cvPeek"></div>
        <div class="cv-body" id="cvBody">${sheetBody()}</div>
      </div></div>`;
  }
  function wire(d) {
    const root = $('#cvRoot'); if (!root) return;
    lock();
    measure(); drawMap();
    // the real top bar and peek heights (safe areas differ by phone): redraw once if the guess was off
    if (measure()) drawMap();
    shown = `${sheet()}|${tab()}|${d.hole}`;
    if (sheet() !== 'peek' && tab() === 'card') P.wireGroup(d, async () => { await P.saveDraft(); c.rerender(); });
    if (sheet() !== 'peek' && tab() === 'strategy') setTimeout(strategy, 30);
    const sh = $('#cvSheet');
    P.wireScore(sh, d, { re: async () => { await P.saveDraft(); refreshSheet(); }, go: goHole, end: () => open('card') });
    sh.addEventListener('click', async (e) => {
      const b = e.target.closest('button,a'); if (!b) return;
      if (b.dataset.tr) { if (!b.disabled) TR.click(b); return; }
      if (b.dataset.sgclub) { SV.click(b); return; }
      const dh = P.D(), hh = dh?.holes[dh.hole];
      if (TR.on(dh) && hh?.shots?.length && (b.dataset.step || b.dataset.fw)) SH.correct(hh, b.dataset.step || 'fairway');
      if (b.dataset.cvtab) { open(b.dataset.cvtab); return; }
      if (b.dataset.cvsheet) { setSheet(b.dataset.cvsheet); return; }
      if (b.hasAttribute('data-cvpeekclub')) { open('club'); return; }
      if (b.hasAttribute('data-cvscore')) { open('score'); return; }
      if (b.hasAttribute('data-cvcard')) { open('card'); return; }
      if (b.dataset.cvnext) { FEEL.play('tap'); goHole(Number(b.dataset.cvnext)); return; }
      if (b.hasAttribute('data-cvnextno')) { const o = P.holeOrder(dh); c.ui.pl_next_off = `${dh.id}|${o[o.indexOf(dh.hole) + 1]}`; c.saveUi(); offer = null; peek(); if (measure()) drawMap(); return; }
      if (b.hasAttribute('data-cvmapretry')) { P.retryMap(); return; }
      if (b.dataset.cvmark) { if (!b.disabled) markHere(b.dataset.cvmark); return; }
      if (b.hasAttribute('data-cvforget')) { forgetMarks(); return; }
      if (b.hasAttribute('data-cvplays')) { c.ui.pl_plays_open = !c.ui.pl_plays_open; c.saveUi(); peek(); return; }
      if (b.hasAttribute('data-cvout')) { c.ui.pl_out_open = !c.ui.pl_out_open; c.saveUi(); peek(); return; }
      if (b.hasAttribute('data-cvshots')) { toggleShots(); refreshSheet(); return; }
      if (b.hasAttribute('data-cvallow') && L && M?.pt) { L.aim = HM.allowForMiss(L.pos, L.aim, M.pt.stats, M.adj); L.custom = true; L.adjusted = true; await saveAim(); aimMoved(); FEEL.play('tap'); return; }
      if (b.dataset.cvpos) { c.ui.pl_pos = b.dataset.cvpos; c.saveUi(); L = null; drawMap(); refreshSheet(); return; }
      if (b.dataset.cvstyle) { c.ui.pl_style = b.dataset.cvstyle; c.saveUi(); drawMap(); refreshSheet(); return; }
      if (b.id === 'plOsmHere') { P.osmHere(e); return; }
      if (b.hasAttribute('data-cdedit')) { e.preventDefault(); c.ui.pl_tab = 'caddie'; c.saveUi(); c.rerender(); setTimeout(() => $('#cdDistances')?.scrollIntoView({ block: 'start' }), 50); return; }
      if (b.dataset.club && b.closest('#plRec') && L) { L.club = b.dataset.club; await saveAim(); aimMoved(); refreshSheet(); return; }
      if (b.dataset.usestrat !== undefined && L) {
        const r = P.stratPick(L, Number(b.dataset.usestrat)); if (!r) return;
        L.aim = r.aim; L.custom = true; L.club = r.club_id; await saveAim(); setSheet('peek'); aimMoved();
      }
    });
    for (const ev of ['input', 'change']) sh.addEventListener(ev, (e) => { TR.change(e.target); });
    // the sheet handle: a tap opens or closes the panel; drag up for full height, down to close
    const hd = $('#cvHandle'); let hy = null;
    hd.addEventListener('pointerdown', (e) => { hy = e.clientY; try { hd.setPointerCapture(e.pointerId); } catch { /* old Safari */ } });
    hd.addEventListener('pointerup', (e) => {
      if (hy === null) return; const dy = e.clientY - hy, i = SHEETS.indexOf(sheet()); hy = null;
      if (Math.abs(dy) < SHEET_DRAG_PX) setSheet(sheet() === 'peek' ? 'half' : 'peek');
      else setSheet(SHEETS[Math.max(0, Math.min(2, i + (dy < 0 ? 1 : -1) * (Math.abs(dy) > 220 ? 2 : 1)))]);
    });
    hd.addEventListener('pointercancel', () => { hy = null; });
    // top bar: close, previous / next hole (arrows or a sideways swipe), GPS accuracy
    const top = $('#cvTop'); let sx = null;
    top.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-cvtip') || b.dataset.cvtipx) { SV.click(b); return; }
      if (b.hasAttribute('data-cvclose')) { c.ui.pl_cv_off = d.id; c.saveUi(); release(); c.rerender(); scrollTo(0, 0); return; }
      if (b.dataset.cvstep) { stepHole(Number(b.dataset.cvstep)); return; }
      if (b.hasAttribute('data-cvgps')) { const f = P.fix(); toast(f ? T.gps.tip(`${yd(f.acc)} ${U()}`) : (P.gpsErr() || T.missing.gps)); }
    });
    top.addEventListener('pointerdown', (e) => { sx = e.clientX; });
    top.addEventListener('pointerup', (e) => { if (sx !== null && Math.abs(e.clientX - sx) > SWIPE_PX) stepHole(e.clientX < sx ? 1 : -1); sx = null; });
    root.querySelector('.cv-tools').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-cvrecentre')) { recentre(); return; }
      if (b.hasAttribute('data-cvzoom')) {
        // after a pinch, the first tap goes back to the preset you were on; after that it steps through them
        if (!UV) { c.ui.pl_zoom = HM.ZOOMS[(HM.ZOOMS.indexOf(zoom()) + 1) % HM.ZOOMS.length]; c.saveUi(); }
        UV = null; zoomLabel(); drawMap();
      }
    });
    wireMap($('#cvMap'));
  }
  function measure() {
    const top = $('#cvTop'), pk = $('#cvSheet'); if (!top || !pk) return false;
    const r = $('#cvRoot').getBoundingClientRect(), t = Math.round(top.getBoundingClientRect().bottom - r.top) + 8;
    const b = Math.round(r.bottom - ($('#cvPeek').getBoundingClientRect().top - 22));
    const yb = $('#cvYards'), l = yb && !yb.hidden ? Math.round(yb.getBoundingClientRect().right - r.left) + 4 : 0;   // keep the hole clear of the yardages
    if ($('#cvYards')) $('#cvYards').style.top = `${t - 4}px`;
    const changed = Math.abs(t - insets.t) > 8 || Math.abs(b - insets.b) > 8 || Math.abs(l - insets.l) > 8;
    if (changed) insets = { t, b, l };
    return changed;
  }

  // Tap the map to move the aim there; press near the handle (or the aim ring) and drag to fine-tune. A drag that starts
  // anywhere else pans the map; two fingers pinch-zoom it. While the fingers move only the picture is stretched (cheap);
  // when they lift, the map is drawn again for the new view so text and lines are their proper size.
  function wireMap(el) {
    if (!el) return;
    const toXY = (ev) => { const s = el.querySelector('svg'), r = (s || el).getBoundingClientRect(); return [(ev.clientX - r.left) * (L?.fr.w || r.width) / r.width, (ev.clientY - r.top) * (L?.fr.h || r.height) / r.height]; };
    const set = (x, y) => { L.aim = L.fr.fromXY(x, y); L.custom = true; L.adjusted = false; L.club = null; };
    const move = (p) => { st.last = p; if (raf) return; raf = requestAnimationFrame(() => { raf = 0; if (!st || !L) return; set(st.last[0], st.last[1] - st.off); aimMoved(); }); };
    const pts = new Map();                                     // fingers on the map: pointerId -> [x, y] in map units
    let gs = null;                                             // a pan or pinch in progress: { s, vx, vy, ... }
    const clampS = (s) => Math.max(PINCH_MIN_K / L.fr.k, Math.min(PINCH_MAX_K / L.fr.k, s));
    const view = () => { const svg = el.querySelector('svg'); if (!svg || !gs || !L) return; svg.setAttribute('viewBox', `${gs.vx.toFixed(1)} ${gs.vy.toFixed(1)} ${(L.fr.w / gs.s).toFixed(1)} ${(L.fr.h / gs.s).toFixed(1)}`); };
    let vraf = 0; const paint = () => { if (!vraf) vraf = requestAnimationFrame(() => { vraf = 0; view(); }); };
    // (re)start the gesture from the fingers now down, keeping the current stretch: the map point under them stays put
    const regrip = () => {
      const g = gs || { s: 1, vx: 0, vy: 0 }, ps = [...pts.values()];
      const m = ps.length > 1 ? [(ps[0][0] + ps[1][0]) / 2, (ps[0][1] + ps[1][1]) / 2] : ps[0];
      gs = { s: g.s, vx: g.vx, vy: g.vy, s0: g.s, d0: ps.length > 1 ? Math.hypot(ps[0][0] - ps[1][0], ps[0][1] - ps[1][1]) || 1 : null, q: [m[0] / g.s + g.vx, m[1] / g.s + g.vy], two: ps.length > 1 || g.two };
    };
    const startGesture = () => { clearTimeout(st?.hold); dragging = true; P.setDragging(true); regrip(); };
    const finishGesture = () => {
      const g = gs; gs = null; dragging = false; P.setDragging(false);
      if (!L || !g || (g.s === 1 && Math.abs(g.vx) < 0.5 && Math.abs(g.vy) < 0.5)) { const svg = el.querySelector('svg'); if (svg && L) svg.setAttribute('viewBox', `0 0 ${L.fr.w} ${L.fr.h}`); return; }
      UV = { hole: L.hole, usingTee: L.usingTee, fr: L.fr.scaled(g.s, g.vx, g.vy) };
      if (g.two) FEEL.play('step');
      zoomLabel(); drawMap();
    };
    el.addEventListener('pointerdown', (ev) => {
      if (!L || ev.target.closest('.hmcredit')) return;
      const p = toXY(ev); pts.set(ev.pointerId, p);
      try { el.setPointerCapture(ev.pointerId); } catch { /* old Safari, or a synthetic pointer */ }
      ev.preventDefault();
      if (pts.size > 1) {                                       // a second finger: pinch (unless the first one is moving the aim)
        if (st?.near && st.moved) return;
        if (st) { clearTimeout(st.hold); if (st.near) { L.padOff = null; } st = null; }
        startGesture(); return;
      }
      const [ax, ay] = L.fr.xy(...L.aim), off = L.padOff ?? HM.padOffset(ay, viewBottom());
      const near = Math.hypot(p[0] - ax, p[1] - (ay + off)) < HANDLE_GRAB_PX || Math.hypot(p[0] - ax, p[1] - ay) < HANDLE_GRAB_PX * 0.7;
      st = { start: p, last: p, near, moved: false, off: near ? (Math.hypot(p[0] - ax, p[1] - ay) < HANDLE_GRAB_PX * 0.7 ? p[1] - ay : off) : 0, id: ev.pointerId };
      if (near) { dragging = true; P.setDragging(true); L.padOff = off; }
      // tap and hold (not on the aim): a marker with the distance from you and on to the green, until the next tap
      else if (!TR.marking()) { const s0 = st; s0.hold = setTimeout(() => { if (st === s0 && !s0.moved && L) { s0.held = true; SV.setMeasure(L.fr.fromXY(s0.start[0], s0.start[1])); $('#hmDyn').innerHTML = dynHtml(); } }, HOLD_MS); }
    });
    el.addEventListener('pointermove', (ev) => {
      if (!L || !pts.has(ev.pointerId)) return; const p = toXY(ev); pts.set(ev.pointerId, p);
      if (gs) {
        const ps = [...pts.values()];
        if (ps.length > 1 && gs.d0) gs.s = clampS(gs.s0 * Math.hypot(ps[0][0] - ps[1][0], ps[0][1] - ps[1][1]) / gs.d0);
        const m = ps.length > 1 ? [(ps[0][0] + ps[1][0]) / 2, (ps[0][1] + ps[1][1]) / 2] : ps[0];
        gs.vx = gs.q[0] - m[0] / gs.s; gs.vy = gs.q[1] - m[1] / gs.s; paint(); return;
      }
      if (!st) return;
      if (!st.moved && Math.hypot(p[0] - st.start[0], p[1] - st.start[1]) > TAP_SLOP_PX) {
        st.moved = true; clearTimeout(st.hold);
        if (!st.near) { if (st.held) return; pts.set(ev.pointerId, st.start); startGesture(); pts.set(ev.pointerId, p); st = null; gs.vx = gs.q[0] - p[0] / gs.s; gs.vy = gs.q[1] - p[1] / gs.s; paint(); return; }
      }
      if (dragging) move(p);
    });
    const end = async (ev) => {
      if (!pts.has(ev.pointerId)) return;
      pts.delete(ev.pointerId);
      if (gs) { if (pts.size) regrip(); else finishGesture(); return; }
      if (!st || !L) { st = null; return; }
      const s = st; st = null; clearTimeout(s.hold);
      if (s.held) return;                                        // the hold placed a measure marker; nothing else
      if (!s.moved && ev.type === 'pointerup') {                // a tap: on the pattern shows or hides your shots; elsewhere moves the aim
        dragging = false; P.setDragging(false); L.padOff = null;
        const at = L.fr.fromXY(s.start[0], s.start[1]);
        if (TR.marking()) { TR.mapTap(at); return; }
        if (SV.measuring()) { SV.setMeasure(null); $('#hmDyn').innerHTML = dynHtml(); return; }   // the next tap clears the marker
        if (V?.kind === 'own' && V.inner && F.pointInPolygon(at[0], at[1], V.inner)) { toggleShots(); if ($('[data-cvshots]')) refreshSheet(); return; }
        if (s.near) { aimMoved(); return; }
        set(s.start[0], s.start[1]); FEEL.play('tap'); aimMoved(); await saveAim(); return;
      }
      if (!dragging) return;
      dragging = false; P.setDragging(false); L.padOff = null; aimMoved(); await saveAim();
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    // iOS: no double-tap zoom, page pinch or page scroll on the map (pointer events still arrive)
    for (const t of ['touchstart', 'touchmove', 'touchend']) el.addEventListener(t, (ev) => { if (ev.cancelable) ev.preventDefault(); }, { passive: false });
    for (const t of ['gesturestart', 'gesturechange', 'dblclick']) el.addEventListener(t, (ev) => ev.preventDefault());
  }
  addEventListener('resize', () => { if (active()) { measure(); drawMap(); } });

  // ------------------------------------------------------------ shot tracking (track.js)
  const nextHole = () => { const d = P.D(), o = P.holeOrder(d), i = o.indexOf(d.hole); if (i < o.length - 1) goHole(o[i + 1]); else open('card'); };
  const SV = registerStrategy(c, {
    D: P.D, L: () => L, M: () => M, V: () => V, yards, reach: P.reach, wedgeRows: P.wedgeRows, save: P.saveDraft, open, compass: P.compass,
    si: () => { const d = P.D(); return d.holes[d.hole].si || where(d).known[d.hole]?.si || null; },
    quiet: () => TR.quiet(), chrome: () => chrome(),
    // what a hazard label must not cover: the aim with its club label, and the two distance tags (as holemap draws them)
    obstacles: (fr) => {
      if (!L) return [];
      const [px, py] = fr.xy(...L.pos), [ax, ay] = fr.xy(...L.aim), [gx, gy] = fr.xy(...L.green), TS = 28, tw = TS / 1.5 * 4, th = TS * 1.45;
      const off = L.padOff ?? HM.padOffset(ay, viewBottom());
      return [{ x: ax - 75, y: ay - 40, w: 150, h: 54 }, { x: ax - 30, y: ay + off - 30, w: 60, h: 60 }, { x: px - 16, y: py - 16, w: 32, h: 32 }, { x: (px + ax) / 2 + TS * 1.45 - tw / 2, y: (py + ay) / 2 - th / 2, w: tw, h: th },
        { x: (ax + gx) / 2 + TS * 1.45 - tw / 2, y: (ay + gy) / 2 - th / 2, w: tw, h: th }];
    },
    useClub: async (id) => { if (!L) return; L.club = id; await saveAim(); aimMoved(); open('club'); },
  });
  const TR = registerTrack(c, {
    D: P.D, L: () => L, M: () => M, where, fix: P.fix, clubs: P.playClubs, label: P.labelOf, save: P.saveDraft, open, next: nextHole,
    peek: () => peek(), refreshSheet: () => refreshSheet(), dyn: () => { if (L && $('#hmDyn')) $('#hmDyn').innerHTML = dynHtml(); },
    remeasure: () => { if (measure()) drawMap(); },
    // after a shot is closed, a penalty or an undo: aim and club start again from where the ball is now
    reset: () => { const d = P.D(); if (d?.aim) delete d.aim[d.hole]; c.ui.pl_club = null; c.saveUi(); L = null; UV = null; zoomLabel(); drawMap(); peek(); },
    roundLine: (d) => P.challengeHtml(d) + P.paceHtml(d),
    onGreen: () => !!(L && !L.usingTee && L.greenPts && P.fix() && P.fix().acc <= SH.POOR_GPS_M && F.pointInPolygon(L.pos[0], L.pos[1], L.greenPts)),
    nearGreen: (m) => !!(L && L.green && A.haversine(L.pos[0], L.pos[1], L.green[0], L.green[1]) <= m),
  });

  return { active, render, wire, onFix, redraw: () => { if (active()) drawMap(); }, release, _state: () => ({ L, M, V, insets, wake: !!wake, UV, offer, markable }), _sv: () => SV };
}
