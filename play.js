// GolfIQ "Play" page: live distances from the phone's GPS, your shot pattern drawn on the course,
// and hole-by-hole score entry (score, putts, fairway, penalties) that saves as a normal round.
import * as F from './features.js';
import * as HM from './holemap.js';
import * as ST from './strategy.js';
import { registerFriends } from './friends.js';

export function registerPlay(c) {
  const { A, S, $, $$, esc, fmt, note, plot, seg, segVal, select, toast, COLORS } = c;
  const J = () => c.state.journal, D = () => J().draft;
  const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  let fix = null, watchId = null, lastDraw = 0, gpsErr = '';      // latest GPS fix (not stored anywhere)

  const saveDraft = () => S.saveJournal(c.state);
  const FR = registerFriends(c);
  const courses = () => [...new Map(c.DS.rounds.filter((r) => r.course_id).map((r) => [r.course_id, r])).values()].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // ------------------------------------------------------------ start a round
  function startCard() {
    const cs = courses(), sel = segVal('pl_course', cs[0]?.course_id || 'new'), last = cs.find((x) => x.course_id === sel);
    return `<div class="card"><h2>Start a round</h2><p class="small">Keep score as you play – strokes, putts, fairways and penalties – with live distances and your shot patterns on the map. It saves as a normal round, so every page of GolfIQ works without a Garmin watch.</p>
      <form id="plStart">${select('pl_course', [...cs.map((x) => [x.course_id, x.course_name]), ['new', 'New course…']], sel, 'Course')}
      ${sel === 'new' ? '<label class="f">Course name</label><input name="name" required style="width:100%">' : ''}
      <div class="row"><div><label class="f">Tee</label><input name="tee" value="${esc(last?.tee || '')}"></div><div><label class="f">Course rating</label><input name="rating" type="number" step="0.1" inputmode="decimal" value="${last?.course_rating ?? ''}"></div><div><label class="f">Slope</label><input name="slope" type="number" inputmode="numeric" value="${last?.slope ?? ''}"></div></div>
      <div class="row"><div><label class="f">Holes</label><select name="n"><option value="18">18</option><option value="9">9</option></select></div><div><label class="f">Starting hole</label><select name="first"><option>1</option><option>10</option></select></div></div>
      ${FR.startFields()}
      <p><button class="btn">Start round</button></p></form>
      ${note('Rating and slope are on the scorecard; they are needed for your handicap and Stableford. If you also track this round on a Garmin watch, the synced Garmin round replaces this one automatically (same course and start time).')}</div>`;
  }
  async function start(e) {
    e.preventDefault(); const f = new FormData(e.target), cid = $('[data-sel=pl_course]').value, ex = courses().find((x) => x.course_id === cid);
    const known = ex ? F.courseHoles(c.DS, cid) : {}, holes = {};
    for (let i = 1; i <= 18; i++) holes[i] = { par: known[i]?.par || 4, si: known[i]?.si || null, strokes: 0, putts: null, fairway: null, penalties: 0 };
    J().draft = { id: `m${Date.now()}`, start: localNow(), course_id: ex ? cid : null, course_name: ex ? ex.course_name : String(f.get('name')).trim(), courseGlobalId: ex && cid.startsWith('garmin-') ? cid.slice(7) : null,
      tee: f.get('tee') || null, rating: c.numOrNull(f.get('rating')), slope: c.numOrNull(f.get('slope')), n: Number(f.get('n')), first: Number(f.get('first')), hole: Number(f.get('first')), holes, side: FR.readStart(f) };
    await saveDraft(); c.rerender();
    if (J().draft.side?.wantLive && c.state.cloud?.group) $('#liveStart')?.click();
  }

  // ------------------------------------------------------------ GPS
  function startGps() {
    if (!navigator.geolocation) { gpsErr = 'This browser has no location service'; return; }
    if (watchId !== null) return;
    watchId = navigator.geolocation.watchPosition((p) => {
      const first = !fix, moved = fix ? A.haversine(fix.lat, fix.lon, p.coords.latitude, p.coords.longitude) : 1e9;
      if (!first && moved <= 6) { fix.acc = p.coords.accuracy; return; }           // ignore GPS jitter while standing still
      if (!first && Date.now() - lastDraw <= 4000) return;                          // redraw at most every 4 s while walking
      fix = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() }; gpsErr = '';
      if ((location.hash.slice(1) || '').startsWith('play') && !dragging && !document.activeElement?.matches?.('input,select,textarea')) c.rerender();
    }, (e) => { gpsErr = e.code === 1 ? 'Location permission was declined – allow it for this site in Settings → Safari → Location' : 'No GPS signal yet'; if ((location.hash.slice(1) || '') === 'play') c.rerender(); },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
  }
  function stopGps() { if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; } }

  // ------------------------------------------------------------ live view for the current hole
  let live = null, dragging = false;                                   // what the hole map is showing right now
  let patCache = { ds: null, m: new Map() };
  const rawOf = (cid) => { if (patCache.ds !== c.DS) patCache = { ds: c.DS, m: new Map(), raw: new Map(), ratio: null }; if (!patCache.raw.has(cid)) patCache.raw.set(cid, F.clubPattern(c.DS, cid)); return patCache.raw.get(cid); };
  // your real pattern when the club has enough shots with direction, otherwise an estimate from your other clubs' spread
  const patternOf = (cid) => {
    if (String(cid).startsWith('w:')) {                               // a part swing from the wedge matrix
      const w = wedgeRows().find((x) => x.key === cid); if (!w) return { pts: [], stats: { n: 0, enough: false }, median_m: null };
      const ck = `${cid}@${w.carry_m}`; if (patCache.m.has(ck)) return patCache.m.get(ck);
      const p = F.wedgePattern(patternOf(w.club_id), w.carry_m, patCache.ratio ?? F.lateralRatio(c.DS, rawOf)); patCache.m.set(ck, p); return p;
    }
    const raw = rawOf(cid); if (patCache.m.has(cid)) return patCache.m.get(cid);
    if (patCache.ratio === null) patCache.ratio = F.lateralRatio(c.DS, rawOf);
    const p = raw.stats.enough ? raw : (F.estimatedPattern(raw, patCache.ratio) || raw); patCache.m.set(cid, p); return p;
  };
  const playClubs = () => c.DS.clubs.filter((x) => x.category !== 'putter' && x.active !== 0 && (A.isNum(x.target_total_m) || c.DS.shots.some((s) => s.club_id === x.club_id)));
  const clubName = (id) => c.DS.clubs.find((x) => x.club_id === id)?.name || id;
  const wedgeRows = () => F.wedgeRowsOf(J().wedge?.entries, clubName);
  const labelOf = (id) => { if (!String(id).startsWith('w:')) return clubName(id); const w = wedgeRows().find((x) => x.key === id); return w ? `${w.club} · ${w.length}` : id; };
  const featsFor = (d) => (d.course_id && c.state.osm[d.course_id]?.features) || c.state.osm.__live?.features || [];
  const osmEntry = (d) => (d.course_id ? c.state.osm[d.course_id] : null) || c.state.osm.__live || null;

  // Longest club you'd normally hit from here (driver only from the tee) – sets where the aim starts on long holes.
  function reach(onTee) {
    const rec = F.recommendClubs(c.DS, 0, 1);
    const ok = rec.filter((r) => r.kind === 'gps' && (onTee || !/driver/i.test(c.DS.clubs.find((x) => x.club_id === r.club_id)?.category || '')));
    return ok.length ? Math.max(...ok.map((r) => r.median_m)) : null;
  }
  function defaultAim(pos, green, line, onTee) {
    const dist = A.haversine(pos[0], pos[1], green[0], green[1]), r = reach(onTee);
    if (!r || dist <= r + c.uncv(15)) return green;
    return HM.pointAlongHole(pos, green, line, r);
  }

  // Everything that depends on the aim point: club odds, the chosen club's pattern and where it would finish.
  // Plays-like for a shot from pos to a point: terrain height difference + wind/temperature now + course altitude.
  function conditions(L, to) {
    const z0 = L.grid ? ST.elevAt(L.grid, L.pos[0], L.pos[1]) : null, z1 = L.grid ? ST.elevAt(L.grid, to[0], to[1]) : null;
    return ST.playsLike(A.haversine(L.pos[0], L.pos[1], to[0], to[1]), { dz_m: A.isNum(z0) && A.isNum(z1) ? z1 - z0 : null, wind_kmh: L.wx?.wind_kmh, wind_from: L.wx?.wind_from,
      bearing: A.bearing(L.pos[0], L.pos[1], to[0], to[1]), temp_c: L.wx?.temp_c, alt_m: z0 });
  }
  function model(L) {
    const aimDist = A.haversine(L.pos[0], L.pos[1], L.aim[0], L.aim[1]), pl = conditions(L, L.aim), adj = (y) => ST.groundDistance(y, pl.parts.elev, pl.factor);
    const rec = F.recommendClubs(c.DS, pl.plays_m, c.uncv(10), wedgeRows()).filter((r) => r.kind === 'wedge' || L.clubs.some((x) => x.club_id === r.club_id));
    const nearFeats = L.feats.length && L.feats.some((f) => f.kind !== 'hole' && A.haversine(L.aim[0], L.aim[1], f.pts[0][0], f.pts[0][1]) < 600) ? L.feats : null;
    const top = rec.filter((r) => r.prob > 0).slice(0, 3);
    for (const r of top) { const pt = patternOf(r.club_id); r.out = nearFeats && pt.stats.enough ? HM.outcomes(HM.placePattern(L.pos, L.aim, pt.pts, adj), nearFeats) : null; }
    const safer = top.length > 1 && top.every((r) => r.out) ? [...top].filter((r) => r.prob >= 0.25).sort((a, b) => a.out.trouble - b.out.trouble)[0] : null;
    const cid = (L.club && (L.clubs.some((x) => x.club_id === L.club) || String(L.club).startsWith('w:'))) ? L.club : (rec[0]?.club_id || null);
    const club = cid ? { club_id: cid, name: labelOf(cid) } : null, pt = cid ? patternOf(cid) : null;
    let pat = null, out = null;
    if (pt?.stats.enough) {
      const dots = pt.estimated ? [] : HM.placePattern(L.pos, L.aim, pt.pts.slice(-60), adj);
      pat = { ell50: HM.placeEllipse(L.pos, L.aim, pt.stats, 0.5, adj), ell90: pt.stats.enough_90 ? HM.placeEllipse(L.pos, L.aim, pt.stats, 0.9, adj) : null, estimated: !!pt.estimated,
        dots: dots.map((p) => { const sf = nearFeats ? F.surfaceAt(p[0], p[1], nearFeats) : null; return { p, bad: sf === 'bunker' || sf === 'water' || sf === 'trees' }; }) };
      out = nearFeats ? (top.find((r) => r.club_id === cid)?.out || HM.outcomes(HM.placePattern(L.pos, L.aim, pt.pts, adj), nearFeats)) : null;
      pat.risk = out ? out.trouble : null;
    } else if (pt && A.isNum(pt.median_m)) {
      const br = A.bearing(L.pos[0], L.pos[1], L.aim[0], L.aim[1]);
      pat = { arc: Array.from({ length: 17 }, (_, i) => F.destination(L.pos[0], L.pos[1], br - 8 + i, adj(pt.median_m))) };
    }
    return { aimDist, pl, rec, top, safer, cid, club, pt, pat, out };
  }

  const PCT = (v) => `${Math.round(v)}%`;
  function outBar(o) {
    const seg = [['green', '#5fbf4f', 'green'], ['fairway', '#a3d36c', 'fairway'], ['rough', '#6fa64a', 'rough'], ['trees', '#24552a', 'trees'], ['bunker', '#e6cf86', 'bunker'], ['water', '#3d8bd0', 'water']].filter(([k]) => o[k] >= 0.5);
    return `<div class="obar">${seg.map(([k, col]) => `<i style="width:${o[k]}%;background:${col}"></i>`).join('')}</div><div class="olegend">${seg.map(([k, col, l]) => `<span><b style="background:${col}"></b>${l} ${PCT(o[k])}</span>`).join('')}</div>`;
  }
  function recHtml(L, m) {
    const U = c.UNIT, tol = `±10 ${U}`;
    const trouble = (o) => (o ? `<span class="pill ${o.trouble >= 25 ? 'bad' : o.trouble >= 10 ? 'mid' : 'good'}">trouble ${PCT(o.trouble)}</span>` : '');
    const rows = m.top.map((r) => `<button type="button" class="recrow ${r.club_id === m.cid ? 'on' : ''}" data-club="${esc(r.club_id)}"><span class="rc">${r === m.top[0] ? '★ ' : ''}${esc(r.club)}${m.safer && m.safer !== m.top[0] && r === m.safer ? ' <em>safer</em>' : ''}</span>
      <span class="rp">${PCT(r.prob * 100)} <small>within ${tol}${Math.abs(m.pl.plays_m - m.aimDist) >= 0.9 ? ' of plays-like' : ''}</small></span><span class="rd small muted">${r.kind === 'wedge' ? `carries ${c.d0(r.median_m)} ${U} (range)` : r.source === 'mine' ? `your ${c.d0(r.median_m)} ${U}` : `usually ${c.d0(r.median_m)} ${U}`}</span>${trouble(r.out)}</button>`).join('');
    const s = m.pt?.stats;
    const patNote = !m.club ? '' : m.pt?.partial_swing ? `<b>${esc(m.club.name)}</b>: carries ${c.d0(m.pt.median_m)} ${U} from your wedge matrix; the spread is your full-swing pattern with that wedge${m.pt.estimated ? ' (estimated)' : ''}, scaled down to this distance.`
      : m.pt?.estimated ? `<b>${esc(m.club.name)}</b>: estimated pattern (dashed) – only ${m.pt.real_n} of ${A.T.min_shots_dispersion} shots with direction so far, so the spread is borrowed from your other clubs: usually ${c.d0(m.pt.median_m)} ${U}, about ${c.d0(s.sd_lateral_m)} ${U} either side.`
      : s?.enough ? `<b>${esc(m.club.name)}</b> from here: usually ${c.d0(s.mean_y_m)} ${U}, half within ${c.d0(s.r50_m)} ${U} of that${Math.abs(s.mean_lateral_m) >= 3 ? `, tending ${c.d0(Math.abs(s.mean_lateral_m))} ${U} ${s.mean_lateral_m > 0 ? 'right' : 'left'}` : ''} (${s.n} shots).`
      : A.isNum(m.pt?.median_m) ? `<b>${esc(m.club.name)}</b>: usually ${c.d0(m.pt.median_m)} ${U}. Not enough shots with direction yet for a pattern (${s?.n || 0} of ${A.T.min_shots_dispersion}) – the arc shows distance only.` : `No tracked shots with ${esc(m.club.name)} yet.`;
    const others = L.clubs.filter((x) => !m.top.some((r) => r.club_id === x.club_id));
    const pls = Math.abs(m.pl.plays_m - m.aimDist) >= 0.9 ? ` <span class="pl">plays ${c.d0(m.pl.plays_m)}</span>` : '';
    return `<div class="aimline"><span>To aim <b>${c.d0(m.aimDist)}</b> ${U}${pls}</span>${L.green && A.haversine(L.aim[0], L.aim[1], L.green[0], L.green[1]) > 4 ? `<span>then <b>${c.d0(A.haversine(L.aim[0], L.aim[1], L.green[0], L.green[1]))}</b> ${U} to the green</span>` : '<span>at the green</span>'}</div>
      ${rows ? `<div class="recs">${rows}</div>` : `<p class="small muted">None of your clubs reach ${c.d0(m.aimDist)} ${U} often enough to rate (needs ${A.T.min_shots_club_stats}+ stock shots per club).</p>`}
      ${m.out ? `<p class="small" style="margin:10px 0 4px">${m.pt?.partial_swing ? `Your ${esc(labelOf(m.pt.base_id || '') || 'wedge')} pattern scaled to this swing, hit at this aim, would finish:` : m.pt?.estimated ? `An estimated ${esc(m.club.name)} pattern, hit at this aim, would finish:` : `If your ${m.out.n} recorded ${esc(m.club.name)} shots were hit at this aim, they'd finish:`}</p>${outBar(m.out)}` : ''}
      ${patNote ? `<p class="small" style="margin:8px 0">${patNote}</p>` : ''}
      <p class="small" style="margin:8px 0 0"><a href="#play" data-cdedit>Edit club distances</a> <span class="muted">– GPS by default, or your own numbers</span></p>
      ${others.length ? `<details class="small"><summary>Other clubs</summary><div class="chips">${others.map((x) => `<button type="button" class="chip ${x.club_id === m.cid ? 'on' : ''}" data-club="${esc(x.club_id)}">${esc(x.name)}</button>`).join('')}</div></details>` : ''}`;
  }

  function liveCard(d) {
    const U = c.UNIT, hole = d.hole, known = d.course_id ? F.courseHoles(c.DS, d.course_id) : {}, feats = featsFor(d);
    const mode = segVal('pl_pos', 'gps'), gpsPos = fix ? [fix.lat, fix.lon] : null;
    const ht = HM.holeTargets(known[hole], feats, hole, gpsPos), par = d.holes[hole].par;
    // more than ~1.5 km from the hole (e.g. planning at home): show it from the tee instead of a line across town
    const farAway = gpsPos && (ht.green || ht.tee) && A.haversine(gpsPos[0], gpsPos[1], ...(ht.green || ht.tee)) > 1500;
    const usingTee = mode === 'tee' || !fix || farAway;
    const pos = !usingTee ? gpsPos : ht.tee;
    let green = ht.green, targetLabel = 'Middle of green', alts = [];
    if (!green && pos && feats.length) { alts = F.nearestGreens(pos[0], pos[1], feats); const i = Math.min(Number(c.ui.pl_green) || 0, alts.length - 1); if (alts.length) { green = alts[i].pin; targetLabel = `Green ${i + 1} of ${alts.length} nearest`; } }
    const holeLen = ht.tee && green ? A.haversine(ht.tee[0], ht.tee[1], green[0], green[1]) : null;
    const gpsLine = fix ? `GPS ±${fmt(c.cv(fix.acc), 0)} ${U}` : (gpsErr || 'Waiting for GPS…');
    const head = `<div class="card playcard"><div class="rv-h"><h2 style="margin:0">Hole ${hole} <span class="small muted">· par ${par}${holeLen ? ` · ${c.d0(holeLen)} ${U}` : ''}</span></h2><span class="small muted">${esc(gpsLine)}</span></div>
      ${seg('pl_pos', [['gps', 'My position'], ['tee', 'From the tee']], 'gps')}`;
    live = null;
    if (!pos) return head + `<p class="muted">${farAway ? 'You are a long way from this hole and GolfIQ doesn\'t know where its tee is yet.' : mode === 'tee' ? 'No tee position known for this hole yet. It comes from your earlier tracked rounds here, or from the course outline once it has been mapped.' : esc(gpsLine)}</p>${osmHint(d, gpsPos)}</div>`;
    if (!green) return head + `<p class="muted">GolfIQ doesn't know where this green is yet. It learns green positions from your tracked rounds on a course, or from the downloaded course outline.</p>${osmHint(d, pos)}</div>`;
    const dist = A.haversine(pos[0], pos[1], green[0], green[1]), fb = F.greenFrontBack(pos[0], pos[1], green, feats);
    const onTee = usingTee || (ht.tee && A.haversine(pos[0], pos[1], ht.tee[0], ht.tee[1]) < 25);
    const saved = d.aim?.[hole], aim = saved && A.haversine(saved.from[0], saved.from[1], pos[0], pos[1]) <= 25 ? saved.pt : defaultAim(pos, green, ht.line, onTee);
    const clubKey = `${d.id}|${hole}`, clubs = playClubs();
    live = { d, hole, pos, green, aim, feats, line: ht.line, clubs, club: c.ui.pl_club_hole === clubKey ? c.ui.pl_club : null, custom: !!saved && aim === saved.pt };
    live.wx = weatherNow(d, pos); live.grid = Object.values(c.state.elev || {}).find((g) => ST.gridCovers(g, [pos, green, aim])) || null;
    const m = model(live);
    const ell = m.pat?.ell90 || m.pat?.ell50 || m.pat?.arc || [];
    const fr = HM.makeFrame(pos, green, [aim, ...ell.filter((_, i) => i % 6 === 0)]);
    const hasMap = feats.length && feats.some((f) => f.kind !== 'hole' && inFrame(fr, f.pts));
    const style = segVal('pl_style', hasMap ? 'map' : 'sat') === 'map' && hasMap ? 'map' : 'sat';
    live.fr = fr; if (!live.grid) fetchElev(fr);
    const pg = conditions(live, green), pp = pg.parts, U2 = (v) => `${v > 0 ? '+' : '−'}${c.d0(Math.abs(v))}`;
    const plBits = [Math.abs(pp.elev) >= 0.9 ? `${pp.elev > 0 ? 'uphill' : 'downhill'} ${U2(pp.elev)}` : null, Math.abs(pp.wind) >= 0.9 ? `wind ${U2(pp.wind)}` : null,
      Math.abs(pp.temp) >= 0.9 ? `${fmt(live.wx.temp_c, 0)}°C ${U2(pp.temp)}` : null, Math.abs(pp.alt) >= 0.9 ? `altitude ${U2(pp.alt)}` : null].filter(Boolean);
    const stat = HM.staticSvg(fr, { feats, style, tileList: style === 'sat' ? HM.tiles(fr, pos[0]) : null, green, tee: usingTee ? null : ht.tee, line: ht.line, pos, posLabel: usingTee ? 'Tee' : '', unit: U, cv: c.cv, rings: dist + 40 });
    const dyn = HM.dynamicSvg(fr, { pos, aim, green, pat: m.pat, cv: c.cv, unit: U, clubName: m.club?.name });
    lastDraw = Date.now();
    const o = osmEntry(d), stale = o && o.features?.length && (o.v || 1) < F.OSM_VERSION;
    return head + `<div class="yard"><div><span>${fb ? 'Front' : ''}</span><b class="sm">${fb ? c.d0(Math.max(fb.front_m, 0)) : ''}</b></div><div><span>${esc(targetLabel)}</span><b>${c.d0(dist)}<i>${U}</i></b></div><div><span>${fb ? 'Back' : ''}</span><b class="sm">${fb ? c.d0(fb.back_m) : ''}</b></div></div>
      <div class="playslike">${plBits.length ? `Plays like <b>${c.d0(pg.plays_m)}</b> ${U} <span class="muted">(${plBits.join(' · ')})</span>` : `<span class="muted">${live.grid || live.wx ? 'Plays as it measures' : 'Plays-like: waiting for terrain and weather'}</span>`}${live.wx ? ` <span class="muted">· wind ${fmt(live.wx.wind_kmh, 0)} km/h from ${compass(live.wx.wind_from)}</span>` : ''}</div>
      ${alts.length > 1 ? seg('pl_green', alts.map((a, i) => [i, `${c.d0(a.dist_m)} ${U}`]), 0) : ''}
      ${usingTee && mode !== 'tee' ? `<p class="small muted">${farAway ? `You're ${fmt(A.haversine(gpsPos[0], gpsPos[1], ...(ht.green || ht.tee)) / 1000, 1)} km from this hole` : 'No GPS fix yet'} – showing the view from the tee.</p>` : ''}
      <div class="hmwrap">${HM.svg(fr, stat, dyn, style)}
        <div class="hmtools">${hasMap ? `<div class="seg mini" data-seg="pl_style">${[['map', 'Course'], ['sat', 'Satellite']].map(([v, l]) => `<button data-v="${v}" class="${style === v ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
        <button type="button" class="hmbtn" id="plAimReset" ${live.custom ? '' : 'hidden'}>Reset aim</button></div>
        ${style === 'sat' ? '<span class="hmcredit">Imagery © Esri</span>' : '<span class="hmcredit">© OpenStreetMap</span>'}</div>
      <p class="small muted hmhint">Put your thumb on the handle under the white ring and drag – the ring stays visible above your thumb. The shaded area is where this club usually finishes from there: green = little trouble, amber = some, red = a lot; red dots are past shots that would end in trouble. Rings every ${U === 'yd' ? '50 yd' : '50 m'} from you.</p>
      <div id="plRec">${recHtml(live, m)}</div>
      ${feats.some((f) => f.kind === 'fairway' || f.kind === 'green') ? `<details class="strat" id="plStrat"><summary>Compare strategies from here</summary><div id="plStratBody" class="small muted">Working it out…</div></details>` : ''}
      ${note(`Shaded shape = where your shots with the club have finished (inner: half of them, dashed: 90%; a dashed inner line means estimated from your other clubs), hit from ${usingTee ? 'the tee' : 'where you are'} along the white line; dots are your last ${Math.min(m.pt?.pts.length || 0, 60)}. "Within ±10 ${U}" = share of your stock shots with that club finishing that close to the aim distance. Trouble = bunker, water or trees on the mapped outline. Plays-like adds the height difference (terrain model, ~30–90 m grid, so small bumps don't show), wind and temperature now (Open-Meteo) and altitude, using caddie rules of thumb: 1 m up = 1 m longer, about +1% per mph into the wind and −0.5% per mph downwind, ~0.12% per °C from 21°C, 1.16% per 1000 ft of altitude. Garmin records total distance (carry + roll), so carrying a hazard can only be estimated. Phone GPS is good to a few ${U === 'yd' ? 'yards' : 'metres'} – check your competition's rules on distance devices.`)}
      ${stale ? `<p class="small" style="margin-top:8px">${d.course_id ? `<button class="btn sec sm" type="button" data-osm="${esc(d.course_id)}">Refresh course outline</button>` : '<button class="btn sec sm" type="button" id="plOsmHere">Refresh course outline</button>'} <span data-osmmsg id="plOsmMsg"></span> adds trees and hole lines.</p>` : osmHint(d, pos)}</div>`;
  }
  const compass = (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg % 360) + 360) % 360 / 45) % 8];
  let wxBusy = false, elevBusy = new Set();
  function weatherNow(d, pos) {
    const w = d.wx; if (w && Date.now() - w.t < 45 * 60e3) return w;
    if (!wxBusy && navigator.onLine !== false) {
      wxBusy = true;
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${pos[0].toFixed(4)}&longitude=${pos[1].toFixed(4)}&current=temperature_2m,wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh`)
        .then((r) => (r.ok ? r.json() : null)).then(async (j) => { if (j?.current && D()) { D().wx = { t: Date.now(), temp_c: j.current.temperature_2m, wind_kmh: j.current.wind_speed_10m, wind_from: j.current.wind_direction_10m }; await saveDraft(); if (!dragging) c.rerender(); } })
        .catch(() => {}).finally(() => { wxBusy = false; });
    }
    return w || null;
  }
  function fetchElev(fr) {
    const spec = ST.elevGridSpec(fr), key = `${spec.lat0.toFixed(4)},${spec.lon0.toFixed(4)},${spec.lat1.toFixed(4)},${spec.lon1.toFixed(4)}`;
    if (elevBusy.has(key) || navigator.onLine === false) return; elevBusy.add(key);
    fetch(ST.elevUrl(spec.points)).then((r) => (r.ok ? r.json() : null)).then(async (j) => {
      if (!Array.isArray(j?.elevation) || j.elevation.length !== spec.points.length) return;
      const { points, ...g } = spec; c.state.elev[key] = { ...g, values: j.elevation, fetched: new Date().toISOString() }; await S.saveElev(c.state); if (!dragging) c.rerender();
    }).catch(() => {});
  }
  function strategyHtml() {
    if (!live) return '';
    const L = live, near = L.feats.filter((f) => f.kind !== 'hole');
    const pl = conditions(L, L.green), z = (p) => (L.grid ? ST.elevAt(L.grid, p[0], p[1]) : null), z0 = z(L.pos);
    const res = ST.predict({ ds: c.DS, patternOf, pos: L.pos, green: L.green, line: L.line, feats: near, E: c.E, clubs: L.clubs, factor: pl.factor, dz: (p) => { const v = z(p); return A.isNum(v) && A.isNum(z0) ? v - z0 : 0; } });
    if (!res.length) return `<p class="muted">Needs clubs with at least ${A.T.min_shots_dispersion} tracked shots with direction.</p>`;
    const U = c.UNIT;
    return `<p>Expected strokes to finish the hole if you hit each club from here, aimed along the hole (or at the green when it gets there), using your own shot patterns, the mapped outline and ${c.E.personal ? 'your' : 'the tour'} strokes-gained baseline.</p>
      <div class="recs">${res.slice(0, 6).map((r, i) => `<button type="button" class="recrow" data-usestrat="${i}"><span class="rc">${i ? '' : '★ '}${esc(r.club)}${r.goes_for_green ? ' <em>at green</em>' : ''}</span><span class="rp">${fmt(r.expected, 2)} <small>strokes</small></span><span class="rd small muted">${i ? `+${fmt(r.vs_best, 2)} vs best` : 'best option'}</span>${r.out ? `<span class="pill ${r.out.trouble >= 25 ? 'bad' : r.out.trouble >= 10 ? 'mid' : 'good'}">trouble ${fmt(r.out.trouble, 0)}%</span>` : ''}</button>`).join('')}</div>
      <p class="small muted" style="margin:6px 0 0">Tap a club to aim with it.</p>
      <p class="muted">Differences under ~0.05 strokes are within the noise. Based on ${res[0].n} ${esc(res[0].club)} shots. Water counts a penalty and a drop; trees play as a recovery shot.</p>`;
  }
  const inFrame = (fr, pts) => pts.some(([la, lo]) => { const [x, y] = fr.xy(la, lo); return x > 0 && x < fr.w && y > 0 && y < fr.h; });
  function osmHint(d, pos) {
    const have = osmEntry(d);
    if (have?.features?.length) return '';
    if (d.course_id) return `<p class="small" style="margin-top:10px"><button class="btn sec sm" type="button" data-osm="${esc(d.course_id)}">Download course outline</button> <span data-osmmsg></span> to draw the hole and get front/back and trouble percentages.</p>`;
    return pos ? `<p class="small" style="margin-top:10px"><button class="btn sec sm" type="button" id="plOsmHere">Download course outline around me</button> <span id="plOsmMsg"></span></p>` : '';
  }
  // redraw only what the aim point changes (no full page render, so dragging stays smooth)
  function refreshAim() {
    if (!live?.fr) return;
    const m = model(live), U = c.UNIT;
    $('#hmDyn').innerHTML = HM.dynamicSvg(live.fr, { pos: live.pos, aim: live.aim, green: live.green, pat: m.pat, cv: c.cv, unit: U, clubName: m.club?.name, pad: live.padOff });
    $('#plRec').innerHTML = recHtml(live, m);
    const rb = $('#plAimReset'); if (rb) rb.hidden = !live.custom;
  }
  function wireMap() {
    const el = $('#hm'); if (!el || !live) return;
    const toVB = (ev) => { const r = el.getBoundingClientRect(); return [(ev.clientX - r.left) * HM.W / r.width, (ev.clientY - r.top) * HM.H / r.height]; };
    let raf = 0, last = null, off = 0;
    // the aim sits above your thumb (or below it near the bottom edge), so your finger never covers it
    const move = (ev) => { last = toVB(ev); if (raf) return; raf = requestAnimationFrame(() => { raf = 0; live.aim = live.fr.fromXY(last[0], last[1] - off); live.custom = true; live.club = null; refreshAim(); }); };
    el.addEventListener('pointerdown', (ev) => {
      dragging = true; try { el.setPointerCapture(ev.pointerId); } catch { /* old Safari */ }
      const [, y] = toVB(ev), [, ay] = live.fr.xy(...live.aim);
      off = ev.pointerType === 'mouse' ? 0 : (live.padOff ?? HM.padOffset(ay, live.fr.h));
      if (ev.pointerType !== 'mouse' && Math.abs(y - (ay + off)) > 90) off = y - HM.PAD >= 14 ? HM.PAD : -HM.PAD;    // started away from the handle: aim goes just above the thumb
      live.padOff = off; move(ev); ev.preventDefault();
    });
    // iOS: stop double-tap zoom, pinch and page scroll while working on the map (pointer events still arrive)
    for (const t of ['touchstart', 'touchmove', 'touchend']) el.addEventListener(t, (ev) => { if (ev.cancelable) ev.preventDefault(); }, { passive: false });
    for (const t of ['gesturestart', 'gesturechange', 'dblclick']) el.addEventListener(t, (ev) => ev.preventDefault());
    el.addEventListener('pointermove', (ev) => { if (dragging) move(ev); });
    const end = async () => {
      if (!dragging) return; dragging = false; live.padOff = null; refreshAim();
      const d = live.d; d.aim = d.aim || {}; d.aim[live.hole] = { pt: live.aim, from: live.pos };
      c.ui.pl_club = null; c.saveUi(); await saveDraft();
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    $('#plRec')?.addEventListener('click', (e) => {
      if (e.target.closest('[data-cdedit]')) { e.preventDefault(); c.ui.pl_tab = 'caddie'; c.saveUi(); c.rerender(); setTimeout(() => $('#cdDistances')?.scrollIntoView({ block: 'start' }), 50); return; }
      const b = e.target.closest('[data-club]'); if (!b) return;
      live.club = b.dataset.club; c.ui.pl_club = b.dataset.club; c.ui.pl_club_hole = `${live.d.id}|${live.hole}`; c.saveUi(); refreshAim();
    });
    const st = $('#plStrat');
    st?.addEventListener('toggle', () => {
      if (!st.open) return;
      setTimeout(() => {
        try { const L = live, body = $('#plStratBody'); body.className = 'small'; body.innerHTML = strategyHtml(); 
          $$('[data-usestrat]', body).forEach((b) => b.addEventListener('click', async () => {
            const near = L.feats.filter((f) => f.kind !== 'hole'), pl = conditions(L, L.green);
            const r = ST.predict({ ds: c.DS, patternOf, pos: L.pos, green: L.green, line: L.line, feats: near, E: c.E, clubs: L.clubs, factor: pl.factor })[Number(b.dataset.usestrat)]; if (!r) return;
            L.aim = r.aim; L.custom = true; L.club = r.club_id; const d = L.d; d.aim = d.aim || {}; d.aim[L.hole] = { pt: r.aim, from: L.pos };
            c.ui.pl_club = r.club_id; c.ui.pl_club_hole = `${d.id}|${L.hole}`; c.saveUi(); await saveDraft(); refreshAim(); $('#hm').scrollIntoView({ behavior: 'smooth', block: 'center' });
          }));
        } catch (e) { $('#plStratBody').textContent = `Could not compare: ${e.message}`; }
      }, 30);
    });
    $('#plAimReset')?.addEventListener('click', async () => { if (live.d.aim) delete live.d.aim[live.hole]; c.ui.pl_club = null; c.saveUi(); await saveDraft(); c.rerender(); });
  }

  // ------------------------------------------------------------ score entry
  function scoreCard(d) {
    const h = d.holes[d.hole], order = Array.from({ length: d.n }, (_, i) => ((d.first - 1 + i) % 18) + 1), idx = order.indexOf(d.hole);
    const played = order.filter((n) => d.holes[n].strokes > 0), tot = A.sum(played.map((n) => d.holes[n].strokes)), par = A.sum(played.map((n) => d.holes[n].par));
    const putts = played.map((n) => d.holes[n].putts).filter(A.isNum), fw = played.filter((n) => d.holes[n].par >= 4 && d.holes[n].fairway);
    const step = (key, label, val, min) => `<div class="step"><span>${label}</span><div><button type="button" data-step="${key}" data-d="-1" aria-label="less">−</button><b>${val ?? '–'}</b><button type="button" data-step="${key}" data-d="1" aria-label="more">+</button></div></div>`;
    return `<div class="card"><div class="rv-h"><h2 style="margin:0">Score – hole ${d.hole}</h2><span class="small muted">${idx + 1} of ${d.n}</span></div>
      <div class="seg" id="plPar">${[3, 4, 5].map((p) => `<button data-par="${p}" class="${h.par === p ? 'on' : ''}">Par ${p}</button>`).join('')}</div>
      <div class="steps2">${step('strokes', 'Score', h.strokes || null)}${step('putts', 'Putts', h.putts)}${step('penalties', 'Penalties', h.penalties)}</div>
      ${h.par >= 4 ? `<label class="f">Fairway</label><div class="seg" id="plFw">${[['LEFT', 'Missed left'], ['HIT', 'Hit'], ['RIGHT', 'Missed right']].map(([v, l]) => `<button data-fw="${v}" class="${h.fairway === v ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
      <div class="row" style="margin-top:6px"><button class="btn sec" id="plPrev" ${idx === 0 ? 'disabled' : ''}>‹ Previous</button><button class="btn" id="plNext">${idx === d.n - 1 ? 'Review & finish' : 'Next hole ›'}</button></div></div>
      <div class="card"><h2>${esc(d.course_name)}</h2><div class="kpis"><div class="kpi"><div class="l">Thru ${played.length}</div><div class="v">${played.length ? tot : '–'} <span class="small ${tot - par > 0 ? '' : 'bad'}">${played.length ? (tot - par > 0 ? '+' : '') + (tot - par === 0 ? 'E' : tot - par) : ''}</span></div></div>
      <div class="kpi"><div class="l">Putts</div><div class="v">${putts.length ? A.sum(putts) : '–'}</div></div><div class="kpi"><div class="l">Fairways</div><div class="v">${fw.length ? `${fw.filter((n) => d.holes[n].fairway === 'HIT').length}/${fw.length}` : '–'}</div></div>
      <div class="kpi"><div class="l">Penalties</div><div class="v">${A.sum(played.map((n) => d.holes[n].penalties || 0))}</div></div></div>
      <div class="strip">${order.map((n) => { const x = d.holes[n], tp = x.strokes ? x.strokes - x.par : null; return `<button type="button" data-goto="${n}" class="${n === d.hole ? 'cur' : ''} ${tp === null ? '' : tp < 0 ? 'under' : tp === 0 ? 'even' : tp === 1 ? 'bogey' : 'worse'}"><i>${n}</i>${x.strokes || '·'}</button>`; }).join('')}</div>
      <p style="margin-top:12px"><button class="btn" id="plFinish" ${played.length ? '' : 'disabled'}>Finish &amp; save round</button><button class="btn sec" id="plDiscard">Discard</button></p>
      ${note('Saved on this phone as you go – closing the app mid-round loses nothing. Finishing adds the round to your history; you can still edit it later in Rounds → the round → Edit.')}</div>`;
  }

  function pagePlay() {
    const d = D();
    if (!d) { stopGps(); return FR.joinCard() + startCard(); }
    startGps();
    return liveCard(d) + scoreCard(d) + FR.groupCard(d) + (J().joined ? FR.joinCard() : '');
  }
  function wirePlay() {
    const d = D(), re = async () => { await saveDraft(); c.rerender(); };
    $('#plStart')?.addEventListener('submit', start);
    FR.wireJoin();
    if (!d) return;
    FR.wireGroup(d, re);
    const h = d.holes[d.hole], order = Array.from({ length: d.n }, (_, i) => ((d.first - 1 + i) % 18) + 1);
    $$('#plPar button').forEach((b) => b.addEventListener('click', () => { h.par = Number(b.dataset.par); if (h.par === 3) h.fairway = null; re(); }));
    $$('[data-step]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.step, dlt = Number(b.dataset.d);
      if (k === 'strokes') h.strokes = Math.max(0, (h.strokes || (dlt > 0 ? h.par - 1 : 0)) + dlt);
      else if (k === 'putts') h.putts = Math.max(0, (h.putts ?? (dlt > 0 ? 1 : 0)) + dlt);
      else h.penalties = Math.max(0, (h.penalties || 0) + dlt);
      re();
    }));
    $$('#plFw button').forEach((b) => b.addEventListener('click', () => { h.fairway = h.fairway === b.dataset.fw ? null : b.dataset.fw; re(); }));
    const go = (n) => { d.hole = n; re().then(() => scrollTo(0, 0)); };
    $('#plPrev')?.addEventListener('click', () => go(order[Math.max(0, order.indexOf(d.hole) - 1)]));
    $('#plNext')?.addEventListener('click', () => { const i = order.indexOf(d.hole); if (i < d.n - 1) go(order[i + 1]); else $('#plFinish').scrollIntoView({ behavior: 'smooth' }); });
    $$('[data-goto]').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.goto))));
    wireMap();
    $('#plOsmHere')?.addEventListener('click', async (e) => {
      const p = fix ? [fix.lat, fix.lon] : null; if (!p) return; e.target.disabled = true; $('#plOsmMsg').textContent = 'Downloading…';
      try { const m = 0.012, bb = [p[0] - m, p[1] - m / Math.cos(p[0] * Math.PI / 180), p[0] + m, p[1] + m / Math.cos(p[0] * Math.PI / 180)];
        const r = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(F.overpassQuery(bb))}`); if (!r.ok) throw new Error(`HTTP ${r.status}`);
        c.state.osm.__live = { v: F.OSM_VERSION, fetched_at: new Date().toISOString(), features: F.parseOverpass(await r.json()) }; await S.saveOsm(c.state);
        toast(c.state.osm.__live.features.length ? 'Course outlines downloaded' : 'This course is not mapped in OpenStreetMap yet'); c.rerender();
      } catch (err) { $('#plOsmMsg').textContent = `Map service unavailable (${err.message})`; e.target.disabled = false; }
    });
    $('#plDiscard')?.addEventListener('click', async () => { if (!confirm('Discard this round? The scores entered so far will be lost.')) return; J().draft = null; stopGps(); await saveDraft(); c.rerender(); });
    $('#plFinish')?.addEventListener('click', async () => {
      const n = order.filter((x) => d.holes[x].strokes > 0).length;
      if (n < d.n && !confirm(`Only ${n} of ${d.n} holes have a score. Save the round with ${n} holes?`)) return;
      const res = await S.mergeBundles(c.state, [F.manualBundle(d)], 'entered on phone');
      if (res.failed) { toast(`Could not save: ${res.errors[0]}`); return; }
      const rid = `garmin-${d.id}`;
      if (d.side) { J().sideResults = J().sideResults || []; J().sideResults.push({ round_id: rid, date: d.start.slice(0, 10), course: d.course_name, game: FR.gameOf(d, d.side, Object.fromEntries(order.filter((n) => d.holes[n].strokes > 0).map((n) => [n, d.holes[n].strokes]))) }); }
      J().draft = null; stopGps(); await saveDraft(); c.ui.rd_open = rid; c.saveUi(); c.done('Round saved'); location.hash = '#rounds';
    });
  }
  return { pages: { play: ['Play', 'flag'] }, render: { play: pagePlay }, wire: { play: wirePlay }, noData: ['play'], standingsHtml: FR.standingsHtml, _setFix: (f) => { fix = f; } };
}
