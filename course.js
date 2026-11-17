// BreakingPar Course view: the hole on one full-screen map while you play – live GPS yardages, an aim you can move,
// the shot pattern for the club in hand, and a bottom sheet with the club, strategy and score (plan: claude/course-view-plan.md).
// Rendering and wiring only; the maths lives in holemap.js, features.js and strategy.js, the round in play.js.
import * as F from './features.js';
import * as HM from './holemap.js';
import * as ST from './strategy.js';
import * as FEEL from './feel.js';

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
export const BOTTOM_CLEAR_PX = 34;             // extra room above the sheet so your own dot is never under it                     // pixels per metre: the Green zoom never goes closer than this
export const SHEETS = ['peek', 'half', 'full'];
export const TABS = ['club', 'strategy', 'score'];

export function registerCourse(c, P) {
  const { A, $, $$, esc, toast } = c;
  const T = FEEL.COPY.course, U = () => c.UNIT;
  let L = null, M = null, wake = null, raf = 0, lastLive = 0, timer = 0, dragging = false, st = null;
  let insets = { t: 128, b: 196 };                // measured after the first draw
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
  function where(d) {
    const fix = P.fix(), known = d.course_id ? F.courseHoles(c.DS, d.course_id) : {}, feats = P.featsFor(d);
    const gpsPos = fix ? [fix.lat, fix.lon] : null, ht = HM.holeTargets(known[d.hole], feats, d.hole, gpsPos);
    const farAway = gpsPos && (ht.green || ht.tee) && A.haversine(gpsPos[0], gpsPos[1], ...(ht.green || ht.tee)) > FAR_AWAY_M;
    const usingTee = c.ui.pl_pos === 'tee' || !fix || !!farAway;
    const pos = usingTee ? ht.tee : gpsPos;
    let green = ht.green;
    if (!green && pos && feats.length) { const alts = F.nearestGreens(pos[0], pos[1], feats); if (alts.length) green = alts[0].pin; }
    return { fix, known, feats, gpsPos, ht, farAway, usingTee, pos, green };
  }
  // what is missing, in one short line
  function missingLine(w) {
    const bits = [], err = P.gpsErr();
    if (!w.fix) bits.push(/declined/i.test(err) ? T.missing.declined : T.missing.gps);
    else if (w.farAway) bits.push(T.missing.far((A.haversine(w.gpsPos[0], w.gpsPos[1], ...(w.ht.green || w.ht.tee)) / 1000).toFixed(1)));
    if (!w.fix && w.pos) bits.push(T.missing.tee);
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
    return HM.dynamicSvg(L.fr, { pos: L.pos, aim: L.aim, green: L.green, pat: M.pat, cv: c.cv, unit: U(), clubName: M.club?.name, big: true,
      pad: L.padOff ?? HM.padOffset(ay, viewBottom()), live: { rings: M ? A.haversine(L.pos[0], L.pos[1], L.green[0], L.green[1]) + 40 : 0, acc: L.usingTee ? null : P.fix()?.acc } });
  }

  // Build the map for the current hole: frame, static layer, moving layer. Called on open, hole change, zoom, recentre,
  // and when you walk out of the picture – never on every GPS fix.
  function drawMap() {
    const d = P.D(), root = $('#cvRoot'), box = $('#cvMap'); if (!d || !root || !box) return;
    const w = where(d);
    if (!w.pos || !w.green) {
      L = null; M = null; P.setLive(null);
      box.innerHTML = `<div class="cv-empty"><p>${esc(w.pos ? T.missing.green : T.noPos)}</p></div>`;
      chrome(w); return;
    }
    const saved = d.aim?.[d.hole], onTee = w.usingTee || (w.ht.tee && A.haversine(w.pos[0], w.pos[1], w.ht.tee[0], w.ht.tee[1]) < ON_TEE_M);
    // an aim you have set stays fixed on the ground; an untouched one follows you (decided with Wills, 17 Nov 2026)
    const custom = !!saved, aim = custom ? saved.pt : P.defaultAim(w.pos, w.green, w.ht.line, onTee);
    const clubKey = `${d.id}|${d.hole}`;
    L = { d, hole: d.hole, pos: w.pos, green: w.green, aim, feats: w.feats, line: w.ht.line, tee: w.ht.tee, clubs: P.playClubs(), usingTee: w.usingTee, onTee,
      club: c.ui.pl_club_hole === clubKey ? c.ui.pl_club : null, custom, greenPts: HM.greenOutline(w.green, w.feats) };
    L.wx = P.weatherNow(d, w.pos); L.grid = Object.values(c.state.elev || {}).find((g) => ST.gridCovers(g, [w.pos, w.green, aim])) || null;
    M = P.model(L);
    const ell = M.pat?.ell90 || M.pat?.ell50 || M.pat?.arc || [];
    const zp = HM.zoomPoints(zoom(), { pos: L.pos, aim: L.aim, green: L.green, tee: L.tee, line: L.line, greenPts: L.greenPts, extra: ell.filter((_, i) => i % 6 === 0) });
    const W = root.clientWidth || innerWidth, H = root.clientHeight || innerHeight;
    L.fr = HM.makeFrame(L.pos, L.green, zp.pts, W, H, { inset: { t: insets.t, b: insets.b + BOTTOM_CLEAR_PX, l: 0, r: 0 }, exact: zp.exact, maxK: MAP_MAX_K });
    if (!L.grid) P.fetchElev(L.fr);
    const hasMap = w.feats.some((f) => f.kind !== 'hole');
    const style = c.ui.pl_style === 'sat' || !hasMap ? 'sat' : 'map';
    const stat = HM.staticSvg(L.fr, { feats: w.feats, style, tileList: style === 'sat' ? HM.tiles(L.fr, L.pos[0]) : null, green: L.green, tee: L.usingTee ? null : L.tee, line: L.line, pos: L.pos, unit: U(), cv: c.cv, noPos: true });
    box.innerHTML = HM.svg(L.fr, stat, dynHtml(), style).replace('class="holemap', 'class="holemap cv-svg') + `<span class="hmcredit">${style === 'sat' ? 'Imagery © Esri' : '© OpenStreetMap'}</span>`;
    P.setLive(L); lastLive = Date.now();
    chrome(w);
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
    const y = yards(), yb = $('#cvYards');
    yb.hidden = !L;
    if (L) yb.innerHTML = `${y.front !== null ? `<div class="f"><span>${T.front}</span><b>${yd(y.front)}</b></div>` : ''}<div class="m"><span>${y.front !== null ? T.middle : T.toGreen}</span><b>${yd(y.mid)}</b></div>${y.back !== null ? `<div class="b"><span>${T.back}</span><b>${yd(y.back)}</b></div>` : ''}`;
    peek();
  }
  function peek() {
    const d = P.D(), el = $('#cvPeek'); if (!d || !el) return;
    const h = d.holes[d.hole], pl = M?.pl, aimD = M?.aimDist;
    const plays = !M ? '' : Math.abs(pl.plays_m - aimD) >= 0.9 ? T.plays(yd(pl.plays_m)) : (L.grid || L.wx) ? T.playsFlat : '';
    const tr = M?.out ? T.trouble(Math.round(M.out.trouble)) : M ? T.noTrouble : '';
    const parts = pl?.parts, bits = !parts ? [] : [Math.abs(parts.elev) >= 0.9 ? `${parts.elev > 0 ? 'uphill' : 'downhill'} ${sg(parts.elev)}` : null, Math.abs(parts.wind) >= 0.9 ? `wind ${sg(parts.wind)}` : null,
      Math.abs(parts.temp) >= 0.9 ? `${Math.round(L.wx?.temp_c)}°C ${sg(parts.temp)}` : null, Math.abs(parts.alt) >= 0.9 ? `altitude ${sg(parts.alt)}` : null].filter(Boolean);
    const sc = h.strokes > 0 ? T.scoreHole(h.strokes, P.toParText(h.strokes - h.par)) : T.score;
    el.innerHTML = `<div class="cv-prow">
        <button type="button" class="cv-club" data-cvpeekclub aria-label="${esc(T.pickClub)}"><b>${esc(M?.club?.name || T.noClub)}</b><span>▾</span></button>
        <div class="cv-pnum">${M ? `<b>${yd(aimD)}</b><span>${esc(U())} to aim</span>` : ''}</div></div>
      ${plays || tr ? `<div class="cv-prow2">${plays ? `<button type="button" class="cv-plays" data-cvplays>${esc(plays)}</button>` : ''}${tr ? `<span class="cv-trbl">${esc(tr)}</span>` : ''}</div>` : ''}
      ${c.ui.pl_plays_open && bits.length ? `<p class="cv-why">${esc(bits.join(' · '))}${L?.wx ? ` · wind ${Math.round(L.wx.wind_kmh)} km/h from ${P.compass(L.wx.wind_from)}` : ''}</p>` : ''}
      <div class="cv-pbtns"><button type="button" class="btn cv-big" data-cvscore>${esc(sc)}</button></div>`;
  }
  const sg = (v) => `${v > 0 ? '+' : '−'}${yd(Math.abs(v))}`;

  // ------------------------------------------------------------ the sheet body (half: tabs; full: the scorecard)
  function sheetBody() {
    const d = P.D(); if (!d) return '';
    if (sheet() === 'full') return `<div class="cv-card">${P.scoreSummaryHtml(d)}</div>${P.groupHtml(d)}<button type="button" class="btn sec cv-back" data-cvsheet="peek">${esc(T.backToMap)}</button>`;
    if (sheet() !== 'half') return '';
    const tb = `<div class="seg cv-tabs" role="tablist">${TABS.map((k) => `<button type="button" role="tab" data-cvtab="${k}" class="${tab() === k ? 'on' : ''}">${esc(T.tabs[k])}</button>`).join('')}</div>`;
    if (tab() === 'score') return tb + `<div class="cv-card cv-score">${P.scoreEntryHtml(d)}</div>`;
    if (tab() === 'strategy') return tb + `<div class="cv-card small" id="cvStrat">${esc(T.working)}</div>`;
    const seg = (key, opts, val) => `<div class="seg">${opts.map(([v, l]) => `<button type="button" data-${key}="${v}" class="${val === v ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
    const hasMap = L?.feats.some((f) => f.kind !== 'hole');
    return tb + (L && M ? `<div id="plRec" class="cv-card">${P.recHtml(L, M)}</div>` : `<p class="small muted">${esc(T.noGreen)}</p>`)
      + `<div class="cv-card"><label class="f">${esc(T.from)}</label>${seg('cvpos', [['gps', T.fromGps], ['tee', T.fromTee]], c.ui.pl_pos === 'tee' ? 'tee' : 'gps')}
        ${hasMap ? `<label class="f">${esc(T.style)}</label>${seg('cvstyle', [['map', T.styleMap], ['sat', T.styleSat]], c.ui.pl_style === 'sat' ? 'sat' : 'map')}` : ''}
        ${P.osmHint(d, L?.pos || null)}</div>`;
  }
  function refreshSheet() {
    const root = $('#cvRoot'), body = $('#cvBody'); if (!root || !body) return;
    root.dataset.sheet = sheet();
    $('#cvHandle')?.setAttribute('aria-expanded', String(sheet() !== 'peek'));
    body.innerHTML = sheetBody(); body.scrollTop = 0;
    if (sheet() === 'full') P.wireGroup(P.D(), async () => { await P.saveDraft(); c.rerender(); });
    if (sheet() === 'half' && tab() === 'strategy') setTimeout(strategy, 30);
    chrome();
  }
  function strategy() {
    const el = $('#cvStrat'); if (!el) return;
    try { el.innerHTML = L ? P.strategyHtml() : esc(T.noGreen); } catch (e) { el.textContent = `Could not compare: ${e.message}`; }
  }
  function setSheet(s, t = null) { c.ui.pl_sheet = s; if (t) c.ui.pl_stab = t; c.saveUi(); refreshSheet(); }

  // ------------------------------------------------------------ live updates (GPS) and aim changes: moving layer only
  function live() {
    const d = P.D(); if (!active() || !d) return;
    const w = where(d);
    // the picture itself changes (first fix, switched to/from the tee view, walked out of the frame): rebuild the map
    if (!L || !w.pos || !w.green || w.usingTee !== L.usingTee || (!w.usingTee && !HM.inView2(L.fr, w.pos, VIEW_MARGIN_PX))) { drawMap(); return; }
    if (!w.usingTee) {
      L.pos = w.pos;
      L.onTee = !!(L.tee && A.haversine(L.pos[0], L.pos[1], L.tee[0], L.tee[1]) < ON_TEE_M);
      if (!L.custom) L.aim = P.defaultAim(L.pos, L.green, L.line, L.onTee);
      M = P.model(L);
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
    M = P.model(L);
    $('#hmDyn').innerHTML = dynHtml(); peek();
    const rec = $('#plRec'); if (rec) rec.innerHTML = P.recHtml(L, M);
  }
  async function saveAim() {
    const d = L.d; d.aim = d.aim || {}; d.aim[L.hole] = { pt: L.aim, from: L.pos };
    c.ui.pl_club = L.club; c.ui.pl_club_hole = L.club ? `${d.id}|${L.hole}` : null; c.saveUi(); await P.saveDraft();
  }
  async function recentre() {
    const d = P.D(); if (d?.aim) delete d.aim[d.hole];
    c.ui.pl_club = null; c.saveUi(); await P.saveDraft(); L = null; drawMap();
  }
  async function goHole(n) {
    const d = P.D(); if (!d || !d.holes[n]) return;
    d.hole = n; if (d.aim) delete d.aim[n]; c.ui.pl_club = null; c.saveUi(); L = null;
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
      </div>
      <div class="cv-yards" id="cvYards" hidden></div>
      <div class="cv-sheet" id="cvSheet">
        <div class="cv-tools"><button type="button" class="cv-tbtn" data-cvzoom aria-label="${esc(T.zoomLabel)}"><small>${esc(T.zoomLabel)}</small>${esc(T.zoom(zoom()))}</button>
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
    if (sheet() === 'full') P.wireGroup(d, async () => { await P.saveDraft(); c.rerender(); });
    if (sheet() === 'half' && tab() === 'strategy') setTimeout(strategy, 30);
    const sh = $('#cvSheet');
    P.wireScore(sh, d, { re: async () => { await P.saveDraft(); refreshSheet(); }, go: goHole, end: () => setSheet('full') });
    sh.addEventListener('click', async (e) => {
      const b = e.target.closest('button,a'); if (!b) return;
      if (b.dataset.cvtab) { setSheet('half', b.dataset.cvtab); return; }
      if (b.dataset.cvsheet) { setSheet(b.dataset.cvsheet); return; }
      if (b.hasAttribute('data-cvpeekclub')) { setSheet('half', 'club'); return; }
      if (b.hasAttribute('data-cvscore')) { setSheet('half', 'score'); return; }
      if (b.hasAttribute('data-cvplays')) { c.ui.pl_plays_open = !c.ui.pl_plays_open; c.saveUi(); peek(); return; }
      if (b.dataset.cvpos) { c.ui.pl_pos = b.dataset.cvpos; c.saveUi(); L = null; drawMap(); refreshSheet(); return; }
      if (b.dataset.cvstyle) { c.ui.pl_style = b.dataset.cvstyle; c.saveUi(); drawMap(); refreshSheet(); return; }
      if (b.id === 'plOsmHere') { P.osmHere(e); return; }
      if (b.hasAttribute('data-cdedit')) { e.preventDefault(); c.ui.pl_tab = 'caddie'; c.saveUi(); c.rerender(); setTimeout(() => $('#cdDistances')?.scrollIntoView({ block: 'start' }), 50); return; }
      if (b.dataset.club && b.closest('#plRec') && L) { L.club = b.dataset.club; await saveAim(); aimMoved(); return; }
      if (b.dataset.usestrat !== undefined && L) {
        const r = P.stratPick(L, Number(b.dataset.usestrat)); if (!r) return;
        L.aim = r.aim; L.custom = true; L.club = r.club_id; await saveAim(); setSheet('peek'); aimMoved();
      }
    });
    // the sheet handle: tap steps up (peek → half → full → peek); drag up or down to change height
    const hd = $('#cvHandle'); let hy = null;
    hd.addEventListener('pointerdown', (e) => { hy = e.clientY; try { hd.setPointerCapture(e.pointerId); } catch { /* old Safari */ } });
    hd.addEventListener('pointerup', (e) => {
      if (hy === null) return; const dy = e.clientY - hy, i = SHEETS.indexOf(sheet()); hy = null;
      if (Math.abs(dy) < SHEET_DRAG_PX) setSheet(SHEETS[(i + 1) % SHEETS.length]);
      else setSheet(SHEETS[Math.max(0, Math.min(2, i + (dy < 0 ? 1 : -1) * (Math.abs(dy) > 220 ? 2 : 1)))]);
    });
    hd.addEventListener('pointercancel', () => { hy = null; });
    // top bar: close, previous / next hole (arrows or a sideways swipe), GPS accuracy
    const top = $('#cvTop'); let sx = null;
    top.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
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
        const z = HM.ZOOMS[(HM.ZOOMS.indexOf(zoom()) + 1) % HM.ZOOMS.length]; c.ui.pl_zoom = z; c.saveUi();
        b.innerHTML = `<small>${esc(T.zoomLabel)}</small>${esc(T.zoom(z))}`; drawMap();
      }
    });
    wireMap($('#cvMap'));
  }
  function measure() {
    const top = $('#cvTop'), pk = $('#cvSheet'); if (!top || !pk) return false;
    const r = $('#cvRoot').getBoundingClientRect(), t = Math.round(top.getBoundingClientRect().bottom - r.top) + 8;
    const b = Math.round(r.bottom - ($('#cvPeek').getBoundingClientRect().top - 22));
    const changed = Math.abs(t - insets.t) > 8 || Math.abs(b - insets.b) > 8;
    if (changed) insets = { t, b };
    return changed;
  }

  // Tap the map to move the aim there; press near the handle (or the aim ring) and drag to fine-tune.
  function wireMap(el) {
    if (!el) return;
    const toXY = (ev) => { const s = el.querySelector('svg'), r = (s || el).getBoundingClientRect(); return [(ev.clientX - r.left) * (L?.fr.w || r.width) / r.width, (ev.clientY - r.top) * (L?.fr.h || r.height) / r.height]; };
    const set = (x, y) => { L.aim = L.fr.fromXY(x, y); L.custom = true; L.club = null; };
    const move = (p) => { st.last = p; if (raf) return; raf = requestAnimationFrame(() => { raf = 0; if (!st || !L) return; set(st.last[0], st.last[1] - st.off); aimMoved(); }); };
    el.addEventListener('pointerdown', (ev) => {
      if (!L || ev.target.closest('.hmcredit')) return;
      const p = toXY(ev), [ax, ay] = L.fr.xy(...L.aim), off = L.padOff ?? HM.padOffset(ay, viewBottom());
      const near = Math.hypot(p[0] - ax, p[1] - (ay + off)) < HANDLE_GRAB_PX || Math.hypot(p[0] - ax, p[1] - ay) < HANDLE_GRAB_PX * 0.7;
      st = { start: p, last: p, near, moved: false, off: near ? (Math.hypot(p[0] - ax, p[1] - ay) < HANDLE_GRAB_PX * 0.7 ? p[1] - ay : off) : 0, id: ev.pointerId };
      if (near) { dragging = true; P.setDragging(true); L.padOff = off; }
      try { el.setPointerCapture(ev.pointerId); } catch { /* old Safari */ }
      ev.preventDefault();
    });
    el.addEventListener('pointermove', (ev) => {
      if (!st || !L) return; const p = toXY(ev);
      if (!st.moved && Math.hypot(p[0] - st.start[0], p[1] - st.start[1]) > TAP_SLOP_PX) {
        st.moved = true;
        if (!st.near) {                                   // a drag that starts away from the handle: the aim sits just above the thumb, as before
          st.off = ev.pointerType === 'mouse' ? 0 : (p[1] - HM.PAD >= (L.fr.view?.t || 0) + 14 ? HM.PAD : -HM.PAD);
          L.padOff = st.off; dragging = true; P.setDragging(true);
        }
      }
      if (dragging) move(p);
    });
    const end = async (ev) => {
      if (!st || !L) { st = null; return; }
      const s = st; st = null;
      if (!s.moved && !s.near && ev.type === 'pointerup') { set(s.start[0], s.start[1]); FEEL.play('tap'); }
      else if (!dragging) return;
      dragging = false; P.setDragging(false); L.padOff = null; aimMoved(); await saveAim();
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    // iOS: no double-tap zoom, pinch or page scroll on the map (pointer events still arrive)
    for (const t of ['touchstart', 'touchmove', 'touchend']) el.addEventListener(t, (ev) => { if (ev.cancelable) ev.preventDefault(); }, { passive: false });
    for (const t of ['gesturestart', 'gesturechange', 'dblclick']) el.addEventListener(t, (ev) => ev.preventDefault());
  }
  addEventListener('resize', () => { if (active()) { measure(); drawMap(); } });

  return { active, render, wire, onFix, redraw: () => { if (active()) drawMap(); }, release, _state: () => ({ L, M, insets, wake: !!wake }) };
}
