// GolfIQ "Play" page: live distances from the phone's GPS, your shot pattern drawn on the course,
// and hole-by-hole score entry (score, putts, fairway, penalties) that saves as a normal round.
import * as F from './features.js';

export function registerPlay(c) {
  const { A, S, $, $$, esc, fmt, note, plot, seg, segVal, select, toast, COLORS } = c;
  const J = () => c.state.journal, D = () => J().draft;
  const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  let fix = null, watchId = null, lastDraw = 0, gpsErr = '';      // latest GPS fix (not stored anywhere)

  const saveDraft = () => S.saveJournal(c.state);
  const courses = () => [...new Map(c.DS.rounds.filter((r) => r.course_id).map((r) => [r.course_id, r])).values()].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // ------------------------------------------------------------ start a round
  function startCard() {
    const cs = courses(), sel = segVal('pl_course', cs[0]?.course_id || 'new'), last = cs.find((x) => x.course_id === sel);
    return `<div class="card"><h2>Start a round</h2><p class="small">Keep score as you play – strokes, putts, fairways and penalties – with live distances and your shot patterns on the map. It saves as a normal round, so every page of GolfIQ works without a Garmin watch.</p>
      <form id="plStart">${select('pl_course', [...cs.map((x) => [x.course_id, x.course_name]), ['new', 'New course…']], sel, 'Course')}
      ${sel === 'new' ? '<label class="f">Course name</label><input name="name" required style="width:100%">' : ''}
      <div class="row"><div><label class="f">Tee</label><input name="tee" value="${esc(last?.tee || '')}"></div><div><label class="f">Course rating</label><input name="rating" type="number" step="0.1" inputmode="decimal" value="${last?.course_rating ?? ''}"></div><div><label class="f">Slope</label><input name="slope" type="number" inputmode="numeric" value="${last?.slope ?? ''}"></div></div>
      <div class="row"><div><label class="f">Holes</label><select name="n"><option value="18">18</option><option value="9">9</option></select></div><div><label class="f">Starting hole</label><select name="first"><option>1</option><option>10</option></select></div></div>
      <p><button class="btn">Start round</button></p></form>
      ${note('Rating and slope are on the scorecard; they are needed for your handicap and Stableford. If you also track this round on a Garmin watch, the synced Garmin round replaces this one automatically (same course and start time).')}</div>`;
  }
  async function start(e) {
    e.preventDefault(); const f = new FormData(e.target), cid = $('[data-sel=pl_course]').value, ex = courses().find((x) => x.course_id === cid);
    const known = ex ? F.courseHoles(c.DS, cid) : {}, holes = {};
    for (let i = 1; i <= 18; i++) holes[i] = { par: known[i]?.par || 4, si: known[i]?.si || null, strokes: 0, putts: null, fairway: null, penalties: 0 };
    J().draft = { id: `m${Date.now()}`, start: localNow(), course_id: ex ? cid : null, course_name: ex ? ex.course_name : String(f.get('name')).trim(), courseGlobalId: ex && cid.startsWith('garmin-') ? cid.slice(7) : null,
      tee: f.get('tee') || null, rating: c.numOrNull(f.get('rating')), slope: c.numOrNull(f.get('slope')), n: Number(f.get('n')), first: Number(f.get('first')), hole: Number(f.get('first')), holes };
    await saveDraft(); c.rerender();
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
      if ((location.hash.slice(1) || '') === 'play' && !document.activeElement?.matches?.('input,select,textarea')) c.rerender();
    }, (e) => { gpsErr = e.code === 1 ? 'Location permission was declined – allow it for this site in Settings → Safari → Location' : 'No GPS signal yet'; if ((location.hash.slice(1) || '') === 'play') c.rerender(); },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
  }
  function stopGps() { if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; } }

  // ------------------------------------------------------------ live view for the current hole
  function liveCard(d) {
    const U = c.UNIT, hole = d.hole, known = d.course_id ? F.courseHoles(c.DS, d.course_id) : {}, kh = known[hole] || null;
    const feats = (d.course_id && c.state.osm[d.course_id]?.features) || c.state.osm.__live?.features || [];
    const mode = segVal('pl_pos', 'gps'), usingTee = mode === 'tee' || !fix;
    const pos = !usingTee ? [fix.lat, fix.lon] : kh?.tee || null;
    let target = kh?.pin || null, targetLabel = 'middle of the green', alts = [];
    if (!target && pos && feats.length) { alts = F.nearestGreens(pos[0], pos[1], feats); const i = Math.min(Number(c.ui.pl_green) || 0, alts.length - 1); if (alts.length) { target = alts[i].pin; targetLabel = `green ${i + 1} of ${alts.length} nearest (mapped)`; } }
    const gpsLine = fix ? `GPS ±${fmt(c.cv(fix.acc), 0)} ${U}` : (gpsErr || 'Waiting for GPS…');
    const head = `<div class="card"><div class="rv-h"><h2 style="margin:0">Hole ${hole}${kh ? ` <span class="small muted">par ${d.holes[hole].par}</span>` : ''}</h2><span class="small muted">${esc(gpsLine)}</span></div>
      ${seg('pl_pos', [['gps', 'My position'], ['tee', 'From the tee']], 'gps')}`;
    if (!pos) return head + `<p class="muted">${mode === 'tee' ? 'No tee position known for this hole yet (it comes from your earlier tracked rounds here).' : esc(gpsLine)}</p>${osmHint(d, null)}</div>`;
    if (!target) return head + `<p class="muted">GolfIQ doesn't know where this green is yet. It learns green positions from tracked rounds on a course, or from downloaded course outlines.</p>${osmHint(d, pos)}</div>`;
    const dist = A.haversine(pos[0], pos[1], target[0], target[1]), br = A.bearing(pos[0], pos[1], target[0], target[1]), fb = F.greenFrontBack(pos[0], pos[1], target, feats);
    // club: recommended for the distance unless one is chosen
    const wrows = [...F.wedgeMatrix(J().wedge.entries).values()].map((w) => ({ club: c.DS.clubs.find((x) => x.club_id === w.club_id)?.name || w.club_id, length: w.length, carry_m: w.carry_m, n: w.sessions }));
    const rec = F.recommendClubs(c.DS, dist, c.uncv(10), wrows).filter((r) => r.kind === 'gps');
    const clubs = c.DS.clubs.filter((x) => x.category !== 'putter' && x.active !== 0 && c.DS.shots.some((s) => s.club_id === x.club_id));
    const cid = (c.ui.pl_club && c.ui.pl_club_hole === `${d.id}|${hole}` && clubs.some((x) => x.club_id === c.ui.pl_club)) ? c.ui.pl_club : (rec[0]?.club_id || clubs[0]?.club_id || null);
    const club = clubs.find((x) => x.club_id === cid), pat = cid ? F.clubPattern(c.DS, cid) : null, aim = Number(c.ui.pl_aim_hole === `${d.id}|${hole}` ? c.ui.pl_aim : 0) || 0;
    const aimBr = br + (dist > 1 ? Math.atan2(c.uncv(aim), dist) * 180 / Math.PI : 0);
    const tr = [], style = { fairway: ['rgba(120,210,120,.28)', 'rgba(150,225,150,.8)'], green: ['rgba(60,230,130,.5)', 'rgba(90,240,150,1)'], bunker: ['rgba(245,225,165,.75)', 'rgba(245,225,165,1)'], water: ['rgba(70,150,245,.5)', 'rgba(70,150,245,.9)'], tee: ['rgba(210,210,210,.3)', 'rgba(230,230,230,.8)'] };
    const span = Math.max(dist, pat?.p90_m || 0) + 60, near = (p) => A.haversine(pos[0], pos[1], p[0], p[1]) < span * 1.3;
    for (const kind of ['fairway', 'water', 'bunker', 'tee', 'green']) {
      const lat = [], lon = [];
      for (const f of feats) if (f.kind === kind && f.pts.some(near)) { f.pts.forEach(([a, b]) => { lat.push(a); lon.push(b); }); lat.push(f.pts[0][0], null); lon.push(f.pts[0][1], null); }
      if (lat.length) tr.push({ type: 'scattermap', lat, lon, mode: 'lines', fill: 'toself', fillcolor: style[kind][0], line: { color: style[kind][1], width: 1 }, hoverinfo: 'skip', showlegend: false });
    }
    tr.push({ type: 'scattermap', lat: [pos[0], target[0]], lon: [pos[1], target[1]], mode: 'lines', line: { color: 'rgba(255,255,255,.75)', width: 1.5 }, hoverinfo: 'skip', showlegend: false });
    let patNote = '';
    if (pat && pat.stats.enough) {
      for (const [q, fill] of [[0.9, 'rgba(255,214,64,.16)'], [0.5, 'rgba(255,214,64,.34)']]) {
        if (q === 0.9 && !pat.stats.enough_90) continue;
        const [ex, ey] = A.ellipse(pat.stats.centre, pat.stats.cov, q), pts = ex.map((x, i) => F.offsetPoint(pos[0], pos[1], aimBr, ey[i], x));
        tr.push({ type: 'scattermap', lat: pts.map((p) => p[0]), lon: pts.map((p) => p[1]), mode: 'lines', fill: 'toself', fillcolor: fill, line: { color: 'rgba(255,214,64,.95)', width: q === 0.5 ? 2 : 1 }, name: `${q * 100}% of ${club.name}`, hoverinfo: 'name' });
      }
      const dots = pat.pts.slice(-60).map((p) => F.offsetPoint(pos[0], pos[1], aimBr, p.y, p.x));
      tr.push({ type: 'scattermap', lat: dots.map((p) => p[0]), lon: dots.map((p) => p[1]), mode: 'markers', marker: { size: 5, color: 'rgba(255,255,255,.8)' }, name: 'Your past shots', hoverinfo: 'skip' });
      const s = pat.stats;
      patNote = `<b>${esc(club.name)}</b>: usually ${c.d0(s.mean_y_m)} ${U}, half of shots within ${c.d0(s.r50_m)} ${U} of that${Math.abs(s.mean_lateral_m) >= 3 ? `, tending ${c.d0(Math.abs(s.mean_lateral_m))} ${U} ${s.mean_lateral_m > 0 ? 'right' : 'left'}` : ''} · ${Math.round(s.pct_left)}% left / ${Math.round(s.pct_right)}% right (n=${s.n})`;
    } else if (pat && A.isNum(pat.median_m)) {
      const arc = Array.from({ length: 21 }, (_, i) => F.destination(pos[0], pos[1], aimBr - 12 + i * 1.2, pat.median_m));
      tr.push({ type: 'scattermap', lat: arc.map((p) => p[0]), lon: arc.map((p) => p[1]), mode: 'lines', line: { color: 'rgba(255,214,64,.95)', width: 2.5 }, name: `${club.name} usual distance`, hoverinfo: 'name' });
      patNote = `<b>${esc(club.name)}</b>: usually ${c.d0(pat.median_m)} ${U} (${c.d0(pat.p10_m)}–${c.d0(pat.p90_m)}). Not enough shots with direction data for a pattern yet (${pat.stats.n} of ${A.T.min_shots_dispersion} needed) – the line shows distance only.`;
    } else if (club) patNote = `No tracked shots with ${esc(club.name)} yet.`;
    tr.push({ type: 'scattermap', lat: [target[0]], lon: [target[1]], mode: 'markers', marker: { size: 13, color: '#ffd640' }, name: 'Green', hoverinfo: 'name' });
    tr.push({ type: 'scattermap', lat: [pos[0]], lon: [pos[1]], mode: 'markers', marker: { size: 13, color: '#ffffff' }, name: usingTee ? 'Tee' : 'You', hoverinfo: 'name' });
    const mid = F.destination(pos[0], pos[1], br, dist / 2), zoom = Math.min(19, Math.max(14, Math.log2(40075000 * Math.cos(mid[0] * Math.PI / 180) / (span * 2.2)) - 0.2));
    const map = { center: { lat: mid[0], lon: mid[1] }, zoom, bearing: ((br % 360) + 360) % 360, style: 'white-bg', layers: [{ below: 'traces', sourcetype: 'raster', source: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], sourceattribution: 'Esri World Imagery' }] };
    lastDraw = Date.now();
    return head + `<div class="yard"><div><span>${fb ? 'Front' : ''}</span><b class="sm">${fb ? c.d0(Math.max(fb.front_m, 0)) : ''}</b></div><div><span>${esc(targetLabel)}</span><b>${c.d0(dist)}<i>${U}</i></b></div><div><span>${fb ? 'Back' : ''}</span><b class="sm">${fb ? c.d0(fb.back_m) : ''}</b></div></div>
      ${alts.length > 1 ? seg('pl_green', alts.map((a, i) => [i, `${c.d0(a.dist_m)} ${U}`]), 0) : ''}
      ${usingTee && mode !== 'tee' ? '<p class="small muted">No GPS fix yet – showing the view from the tee.</p>' : ''}
      ${plot(tr, { map, height: 430, margin: { l: 0, r: 0, t: 0, b: 0 }, showlegend: false }, 'map')}
      <label class="f">Club</label><div class="chips" id="plClubs">${clubs.map((x) => `<button type="button" class="chip ${x.club_id === cid ? 'on' : ''}" data-club="${esc(x.club_id)}">${esc(x.name)}${rec[0]?.club_id === x.club_id ? ' ★' : ''}</button>`).join('')}</div>
      ${patNote ? `<p class="small" style="margin:8px 0">${patNote}</p>` : ''}
      <label class="f">Aim: ${aim === 0 ? 'at the green centre' : `${Math.abs(aim)} ${U} ${aim > 0 ? 'right' : 'left'} of centre`}</label><input type="range" id="plAim" min="-40" max="40" step="2" value="${aim}">
      ${note(`Yellow shape = where your ${club ? esc(club.name) : 'club'} shots have finished (inner: half of them, outer: 90%), placed from ${usingTee ? 'the tee' : 'where you are standing'} along your aim line; white dots are your last ${Math.min(pat?.pts.length || 0, 60)} shots. Slide the aim to see what keeps the pattern out of trouble. ★ = best odds for this distance. Distances are straight-line to the ${esc(targetLabel)}${kh?.pin ? ' (where Garmin placed the pin marker in your earlier rounds)' : ''}; phone GPS is typically good to a few ${U === 'yd' ? 'yards' : 'metres'} – not for competition use where distance devices are restricted.`)}
      ${osmHint(d, pos)}</div>`;
  }
  function osmHint(d, pos) {
    const have = d.course_id ? c.state.osm[d.course_id] : c.state.osm.__live;
    if (have?.features?.length) return '';
    if (d.course_id) return `<p class="small" style="margin-top:10px"><button class="btn sec sm" type="button" data-osm="${esc(d.course_id)}">Download course outlines</button> <span data-osmmsg></span> to see fairways, greens and bunkers under your pattern and get front/back distances.</p>`;
    return pos ? `<p class="small" style="margin-top:10px"><button class="btn sec sm" type="button" id="plOsmHere">Download course outlines around me</button> <span id="plOsmMsg"></span></p>` : '';
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
      ${note('Saved on this phone as you go – closing the app mid-round loses nothing. Finishing adds the round to your history; you can still edit it under Corrections.')}</div>`;
  }

  function pagePlay() {
    const d = D();
    if (!d) { stopGps(); return startCard(); }
    startGps();
    return liveCard(d) + scoreCard(d);
  }
  function wirePlay() {
    const d = D(), re = async () => { await saveDraft(); c.rerender(); };
    $('#plStart')?.addEventListener('submit', start);
    if (!d) return;
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
    $$('#plClubs [data-club]').forEach((b) => b.addEventListener('click', () => { c.ui.pl_club = b.dataset.club; c.ui.pl_club_hole = `${d.id}|${d.hole}`; c.saveUi(); c.rerender(); }));
    $('#plAim')?.addEventListener('change', (e) => { c.ui.pl_aim = Number(e.target.value); c.ui.pl_aim_hole = `${d.id}|${d.hole}`; c.saveUi(); c.rerender(); });
    $('#plOsmHere')?.addEventListener('click', async (e) => {
      const p = fix ? [fix.lat, fix.lon] : null; if (!p) return; e.target.disabled = true; $('#plOsmMsg').textContent = 'Downloading…';
      try { const m = 0.012, bb = [p[0] - m, p[1] - m / Math.cos(p[0] * Math.PI / 180), p[0] + m, p[1] + m / Math.cos(p[0] * Math.PI / 180)];
        const r = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(F.overpassQuery(bb))}`); if (!r.ok) throw new Error(`HTTP ${r.status}`);
        c.state.osm.__live = { fetched_at: new Date().toISOString(), features: F.parseOverpass(await r.json()) }; await S.saveOsm(c.state);
        toast(c.state.osm.__live.features.length ? 'Course outlines downloaded' : 'This course is not mapped in OpenStreetMap yet'); c.rerender();
      } catch (err) { $('#plOsmMsg').textContent = `Map service unavailable (${err.message})`; e.target.disabled = false; }
    });
    $('#plDiscard')?.addEventListener('click', async () => { if (!confirm('Discard this round? The scores entered so far will be lost.')) return; J().draft = null; stopGps(); await saveDraft(); c.rerender(); });
    $('#plFinish')?.addEventListener('click', async () => {
      const n = order.filter((x) => d.holes[x].strokes > 0).length;
      if (n < d.n && !confirm(`Only ${n} of ${d.n} holes have a score. Save the round with ${n} holes?`)) return;
      const res = await S.mergeBundles(c.state, [F.manualBundle(d)], 'entered on phone');
      if (res.failed) { toast(`Could not save: ${res.errors[0]}`); return; }
      const rid = `garmin-${d.id}`; J().draft = null; stopGps(); await saveDraft(); c.ui.rd_open = rid; c.saveUi(); c.done('Round saved'); location.hash = '#rounds';
    });
  }
  return { pages: { play: ['Play', 'flag'] }, render: { play: pagePlay }, wire: { play: wirePlay }, noData: ['play'], _setFix: (f) => { fix = f; } };
}
