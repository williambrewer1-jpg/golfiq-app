// GolfIQ pages: caddie, post-round review, handicap, conditions, before/after, playbook, personal bests,
// practice (games, log, wedge matrix), coach hub (priorities, notes from Claude, swing thoughts), share card, course maps.
import * as F from './features.js';

export function registerPages(c) {
  const { A, S, $, $$, esc, fmt, sgn, note, table, kpi, plot, seg, segVal, select, chips, toast, n0, n1, n2, p0, COLORS } = c;
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const J = () => c.state.journal;
  const saveJ = async (msg) => { await S.saveJournal(c.state); if (msg) toast(msg); c.rerender(); };
  const clubName = (id) => c.DS.clubs.find((x) => x.club_id === id)?.name || id;
  const vclass = (v) => (['improving', 'better'].includes(v) ? 'good' : v === 'worse' ? 'bad' : 'muted');
  const vcol = (v) => `<span class="${vclass(v)}">${esc(v ?? '–')}</span>`;
  const emptyCard = (t) => `<div class="card"><p class="muted">${t}</p></div>`;

  // ================================================================ 1. Caddie
  function pageCaddie() {
    const U = c.UNIT, dist = Number(c.ui.cd_dist) || 150, tol = Number(segVal('cd_tol', 10));
    const cells = F.wedgeMatrix(J().wedge.entries), wrows = [...cells.values()].map((w) => ({ club: clubName(w.club_id), length: w.length, carry_m: w.carry_m, n: w.sessions }));
    const rec = F.recommendClubs(c.DS, c.uncv(dist), c.uncv(tol), wrows), gps = rec.filter((r) => r.kind === 'gps'), wd = rec.filter((r) => r.kind === 'wedge');
    const top = gps[0];
    const row = (r, i) => `<div class="rec ${i === 0 ? 'top' : ''}"><div class="rec-h"><b>${esc(r.club)}</b><span class="pill ${r.prob >= 0.5 ? 'good' : r.prob >= 0.25 ? 'mid' : ''}">${Math.round(r.prob * 100)}% within ±${tol} ${U}</span></div>
      <div class="bar"><i style="width:${Math.round(r.prob * 100)}%"></i></div>
      <div class="small muted">Usually ${c.d0(r.median_m)} ${U} (middle half ${c.d0(r.p25_m)}–${c.d0(r.p75_m)}) · ${Math.round(r.short_pct * 100)}% short, ${Math.round(r.long_pct * 100)}% long${A.isNum(r.lateral_sd_m) ? ` · L/R spread ±${c.d0(r.lateral_sd_m)} ${U}` : ''} · n=${r.n}${r.sample === 'low' ? ' (low sample)' : ''}</div></div>`;
    return `<div class="card"><h2>What club for…</h2>
      <div class="bigin"><input id="cdDist" type="number" inputmode="numeric" value="${dist}" aria-label="Distance"><span>${U}</span></div>
      <input id="cdRange" type="range" min="${U === 'yd' ? 30 : 25}" max="${U === 'yd' ? 280 : 255}" step="1" value="${dist}">
      ${seg('cd_tol', [[5, `±5 ${U}`], [10, `±10 ${U}`], [15, `±15 ${U}`]], 10)}
      ${top ? `<p class="lead">Best odds: <b>${esc(top.club)}</b> – ${Math.round(top.prob * 100)}% of your stock shots with it finish within ${tol} ${U} of ${dist}.</p>` : '<p class="muted">No club with at least 8 stock shots yet.</p>'}</div>
      ${gps.length ? `<div class="card"><h2>Your clubs at ${dist} ${U}</h2>${gps.filter((r) => r.prob > 0 || Math.abs(r.diff_m) < c.uncv(25)).slice(0, 6).map(row).join('') || '<p class="muted">Nothing in your bag is close to this distance.</p>'}
      ${note('Based on GPS total distance of your stock tee and approach shots (not carry, no wind/slope/lie adjustment). Percent = share of those shots that finished within the tolerance of this distance.')}</div>` : ''}
      ${wd.length ? `<div class="card"><h2>Part-swing wedges near ${dist} ${U}</h2>${wd.map((r) => `<p style="margin:6px 0"><b>${esc(r.club)}</b> – carries ${c.d0(r.median_m)} ${U} <span class="small muted">(${sgn(c.cv(r.diff_m), 0)} ${U} vs target, from your wedge matrix)</span></p>`).join('')}</div>` : ''}`;
  }
  function wireCaddie() {
    const set = (v) => { c.ui.cd_dist = Math.max(1, Number(v) || 150); c.saveUi(); c.rerender(); };
    $('#cdDist')?.addEventListener('change', (e) => set(e.target.value));
    $('#cdRange')?.addEventListener('change', (e) => set(e.target.value));
    $('#cdRange')?.addEventListener('input', (e) => { $('#cdDist').value = e.target.value; });
  }

  // ================================================================ 2. Post-round review
  function reviewNeeds(ds, rid) {
    const hh = ds.holes.filter((h) => h.round_id === rid).sort((a, b) => a.hole - b.hole), ss = ds.shots.filter((s) => s.round_id === rid);
    return hh.map((h) => {
      const shots = ss.filter((s) => s.hole === h.hole).sort((a, b) => a.shot_order - b.shot_order);
      const noClub = shots.filter((s) => !s.club_id && !['penalty', 'putt'].includes(s.category));
      const need = { hole: h, shots, noClub, missing: Math.max(0, h.swings_missing || 0), putts: h.putts_status === 'missing' || h.putts_status === 'suspect_default',
        firstPutt: h.putts_eff > 0 && h.first_putt_m === null };
      need.any = need.missing > 0 || need.noClub.length > 0 || need.putts || need.firstPutt;
      return need;
    });
  }
  function pageReview() {
    const rounds = [...c.DS.rounds].reverse(); if (!rounds.length) return emptyCard('No rounds yet.');
    const rid = segVal('rv_round', rounds[0].round_id), row = rounds.find((r) => r.round_id === rid) || rounds[0];
    const needs = reviewNeeds(c.DS, row.round_id), todo = needs.filter((n) => n.any), U = c.UNIT, PU = c.PUNIT;
    const hh = needs.map((n) => n.hole), complete = hh.filter((h) => h.chain_complete).length, fp = hh.filter((h) => h.first_putt_m !== null).length;
    const clubOpts = (cur) => `<option value="">Club…</option>${c.DS.clubs.filter((x) => x.active !== 0).map((x) => `<option value="${esc(x.club_id)}" ${x.club_id === cur ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}`;
    const wedge = c.DS.clubs.find((x) => x.category === 'wedge' && x.active !== 0);
    const card = (n) => {
      const h = n.hole, last = n.shots.filter((s) => !['putt', 'penalty'].includes(s.category)).slice(-1)[0];
      return `<div class="card rv" data-h="${h.hole}"><div class="rv-h"><b>Hole ${h.hole}</b><span class="small muted">Par ${h.par ?? '?'} · score ${h.strokes} · ${h.putts_eff ?? '?'} putts${h.penalties_eff ? ` · ${h.penalties_eff} pen` : ''}</span></div>
        <div class="chips ro">${n.shots.filter((s) => s.category !== 'penalty').map((s) => `<span class="chip ${s.club_id ? '' : 'warnchip'}">#${fmt(s.shot_order, 0)} ${esc(s.club_id ? s.club : 'no club')} ${A.isNum(s.dist_m) ? c.d0(s.dist_m) + ' ' + U : ''}</span>`).join('') || '<span class="small muted">No shots tracked</span>'}</div>
        ${n.noClub.map((s) => `<label class="f">Club for shot #${fmt(s.shot_order, 0)} (${A.isNum(s.dist_m) ? c.D(s.dist_m) : s.category})</label><select name="club" data-k="${esc(s.shot_key)}">${clubOpts(null)}</select>`).join('')}
        ${Array.from({ length: Math.min(n.missing, 4) }, (_, i) => `<div class="miss"><label class="f">Shot AutoShot missed ${n.missing > 1 ? `(${i + 1} of ${n.missing})` : ''}</label><div class="row"><div><select name="mclub">${clubOpts(wedge?.club_id)}</select></div>
          <div><select name="mlie">${['Rough', 'Fairway', 'Sand', 'Fringe', 'Recovery'].map((l) => `<option>${l}</option>`).join('')}</select></div><div><input name="mpin" type="number" inputmode="decimal" placeholder="to pin, ${U}"></div></div></div>`).join('')}
        ${n.missing > 4 ? `<p class="small muted">${n.missing} shots missing – add the rest in Corrections.</p>` : ''}
        ${n.putts ? `<label class="f">Putts on this hole</label><input name="putts" type="number" inputmode="numeric" value="${h.putts ?? ''}" style="width:90px">` : ''}
        ${n.firstPutt ? `<label class="f">First putt distance (${PU})${A.isNum(h.first_putt_est_m) ? ` – GPS guess ${c.DP(h.first_putt_est_m)}` : ''}</label><input name="fp" type="number" inputmode="decimal" step="0.5" style="width:110px" placeholder="${PU}">` : ''}
        <input type="hidden" name="lastorder" value="${last ? last.shot_order : 0}"></div>`;
    };
    return `${select('rv_round', rounds.map((r) => [r.round_id, r.label]), row.round_id, 'Round')}
      <div class="kpis" style="margin-top:10px">${kpi('Holes fully tracked', complete, null, true, 0).replace('</div></div>', ` / ${hh.length}</div></div>`)}${kpi('First putts entered', fp, null, true, 0).replace('</div></div>', ` / ${hh.length}</div></div>`)}</div>
      ${note('A few minutes here after each round makes putting stats and strokes gained far more complete. Every field is optional – fill what you remember.')}
      ${todo.length ? `<form id="rvForm">${todo.map(card).join('')}<label class="f">Reason (optional)</label><input name="_reason" value="post-round review" style="width:100%"><p><button class="btn">Save review</button></p></form>`
    : '<div class="ok">Nothing to fix on this round – every hole has clubs, a complete shot chain and a first-putt distance.</div>'}`;
  }
  function wireReview() {
    $('#rvForm')?.addEventListener('submit', async (e) => {
      e.preventDefault(); const rid = $('[data-sel=rv_round]').value, reason = new FormData(e.target).get('_reason') || 'post-round review'; let n = 0;
      for (const card of $$('.rv', e.target)) {
        const hole = Number(card.dataset.h), h = c.DS.holes.find((x) => x.round_id === rid && x.hole === hole), key = A.holeKey(rid, hole);
        for (const sel of $$('select[name=club]', card)) if (sel.value) { await S.addCorrection(c.state, 'shot', sel.dataset.k, 'club_id', sel.value, null, reason); n++; }
        const miss = $$('.miss', card), lastOrder = Number($('[name=lastorder]', card).value) || 0;
        for (let i = 0; i < miss.length; i++) {
          const club = $('[name=mclub]', miss[i]).value, pin = c.uncv(c.numOrNull($('[name=mpin]', miss[i]).value));
          if (!club && pin === null) continue;
          const k = await S.addManualShot(c.state, { round_id: rid, hole, shot_order: lastOrder + (i + 1) / (miss.length + 1), club_id: club || null, start_lie: $('[name=mlie]', miss[i]).value,
            end_lie: i === miss.length - 1 ? 'Green' : 'Rough', dist_m: null }, reason);
          if (pin !== null) await S.addCorrection(c.state, 'shot', k, 'start_to_pin_m', pin, null, reason);
          n++;
        }
        const putts = $('[name=putts]', card); if (putts && putts.value !== '' && Number(putts.value) !== h.putts) { await S.addCorrection(c.state, 'hole', key, 'putts', Number(putts.value), h.putts, reason); n++; }
        else if (putts && putts.value !== '' && h.putts_status === 'suspect_default') { await S.addCorrection(c.state, 'hole', key, 'putts_confirmed', true, false, reason); n++; }
        const fp = $('[name=fp]', card); if (fp && fp.value !== '') { await S.addCorrection(c.state, 'hole', key, 'first_putt_m', c.puncv(Number(fp.value)), null, reason); n++; }
      }
      c.done(`${n} item(s) saved`);
    });
  }

  // ================================================================ 3. Handicap
  function pageHandicap() {
    const r = c.DS.rounds.filter((x) => x.format !== 'partial'), withD = r.filter((x) => A.isNum(x.differential_for_index));
    if (!withD.length) return emptyCard('Needs 9- or 18-hole rounds with course rating and slope. Add missing ratings in Settings → Courses.');
    const cur = withD[withD.length - 1].index_after, official = [...(c.state.settings.handicaps || [])].sort((a, b) => a.date.localeCompare(b.date));
    const off = official.length ? official[official.length - 1] : null, last20 = withD.slice(-20), counting = A.whsCounting(last20.map((x) => x.differential_for_index));
    const pts = withD.filter((x) => A.isNum(x.index_after));
    const tr = [{ x: pts.map((x) => x.date), y: pts.map((x) => x.index_after), mode: 'lines+markers', name: 'GolfIQ index', line: { color: '#1b7f4b', width: 2.5 }, marker: { size: 5 } },
      { x: withD.map((x) => x.date), y: withD.map((x) => x.differential_for_index), mode: 'markers', name: 'Round differential', marker: { color: '#B0BEC5', size: 6 } }];
    if (official.length) tr.push({ x: official.map((h) => h.date), y: official.map((h) => h.handicap_index), mode: 'lines+markers', name: 'Official (entered)', line: { color: '#FB8C00', dash: 'dot', shape: 'hv' } });
    const est = r.filter((x) => String(x.hi_source || '').startsWith('GolfIQ')).length, prov = r.filter((x) => String(x.differential_source || '').startsWith('provisional')).length;
    return `<div class="kpis">${kpi('GolfIQ index', cur)}<div class="kpi"><div class="l">Official index</div><div class="v">${off ? fmt(off.handicap_index) : '–'}</div><div class="d muted">${off ? 'from ' + esc(off.date) : 'add in Settings'}</div></div>
      ${kpi('Differentials used', withD.length, null, true, 0)}${A.isNum(cur) && off ? kpi('GolfIQ − official', cur - off.handicap_index, null, false, 1) : ''}</div>
      ${withD.length < 3 ? '<div class="warn">An index needs at least 3 scored rounds.</div>' : ''}
      <div class="card"><h2>Index over time</h2>${plot(tr, { height: 300, yaxis: { title: { text: 'Index / differential' } } })}
      ${note('WHS method: average of your lowest 8 of the last 20 score differentials (fewer rounds use the WHS small-sample table). 9-hole rounds count the WHS way: the nine you played plus your expected score for the other nine, based on your index at the time (0.52 × index + 1.2, the published approximation of the WHS table). Not applied: playing-conditions adjustment, soft/hard caps and exceptional-score reductions – so expect small differences from your official index.')}</div>
      <div class="card"><h2>Last ${last20.length} differentials</h2>${table([...last20].map((x, i) => ({ ...x, counts: counting.has(i) })).reverse(), [['date', 'Date'], ['course_name', 'Course'], ['format', 'Holes'], ['gross', 'Gross', n0], ['differential_for_index', 'Diff', n1], ['counts', 'Counts', (v) => (v ? '●' : '')], ['index_after', 'Index after', n1], ['hi_source', 'Handicap used', (v) => `<span class="small">${esc(v || 'none')}</span>`]])}
      ${note(`● = one of the lowest that make up the index. ${est} round(s) had no official index entered, so GolfIQ used its own estimate from your earlier rounds to reconstruct Stableford.${prov ? ` ${prov} early round(s) use a provisional differential (par+5 cap) because no handicap or stroke index was available yet.` : ''}`)}</div>`;
  }

  // ================================================================ 4. Conditions (weather)
  async function fetchWeather(progress) {
    const todo = c.DS.rounds.filter((r) => !c.state.weather[r.round_id] && r.start_time_local);
    let ok = 0, fail = 0, lastErr = '';
    for (let i = 0; i < todo.length; i++) {
      const r = todo[i], loc = F.roundLocation(c.DS, r.round_id); if (!loc) { fail++; continue; }
      const day = r.date, ageDays = (Date.now() - Date.parse(day)) / 864e5;
      const q = `latitude=${loc.lat.toFixed(4)}&longitude=${loc.lon.toFixed(4)}&start_date=${day}&end_date=${day}&hourly=temperature_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation&timezone=auto`;
      const urls = ageDays <= 85 ? [`https://api.open-meteo.com/v1/forecast?${q}`, `https://archive-api.open-meteo.com/v1/archive?${q}`] : [`https://archive-api.open-meteo.com/v1/archive?${q}`, `https://api.open-meteo.com/v1/forecast?${q}`];
      let w = null;
      for (const u of urls) { try { const res = await fetch(u); if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; } w = F.summariseWeather(await res.json(), r.start_time_local, r.holes_played); if (w) break; lastErr = 'no hourly data for that day'; } catch (e) { lastErr = e.message; } }
      if (w) { c.state.weather[r.round_id] = { ...w, source: 'open-meteo', fetched_at: new Date().toISOString() }; ok++; } else fail++;
      progress?.(`${i + 1}/${todo.length}`);
      if (i % 10 === 9) await S.saveWeather(c.state);
      await new Promise((res) => setTimeout(res, 120));
    }
    await S.saveWeather(c.state);
    return { ok, fail, lastErr };
  }
  const compass = (d) => (A.isNum(d) ? ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(d / 45) % 8] : '–');
  function pageConditions() {
    const W = c.state.weather, rounds = [...c.DS.rounds].reverse(), missing = rounds.filter((r) => !W[r.round_id]).length, have = rounds.length - missing;
    const fx = F.weatherEffects(c.DS, W);
    const cols = [['label', 'Conditions'], ['rounds', 'Rds', n0], ['differential', 'Diff', n1], ['to_par', 'To par', n1], ['fw_pct', 'FW', p0], ['gir_pct', 'GIR', p0], ['putts', 'Putts', n1]];
    return `<div class="card"><h2>Weather for your rounds</h2><p class="small">Temperature and wind during each round, looked up from the open weather archive (Open-Meteo) using the course location and tee time. ${have} of ${rounds.length} rounds have weather.</p>
      <button class="btn" id="wxFetch" ${missing ? '' : 'disabled'}>${missing ? `Fetch weather for ${missing} round${missing > 1 ? 's' : ''}` : 'All rounds up to date'}</button> <span id="wxMsg" class="small"></span>
      ${note('Only the course coordinates and date are sent to the weather service. Values are regional model data (roughly 10 km grid), not an on-course measurement.')}</div>
      ${fx.rounds < 5 ? emptyCard('Effects appear once at least 5 rounds have weather.') : `
      <div class="card"><h2>Do your distances change with conditions?</h2>
      ${fx.temp ? `<p><b>Temperature:</b> your stock distances are <b>${sgn(fx.temp.pct_per_10c, 1)}%</b> per 10°C warmer <span class="small muted">(${fx.temp.n} rounds, ${fmt(fx.temp.range[0], 0)}–${fmt(fx.temp.range[1], 0)}°C, correlation ${fmt(fx.temp.r, 2)})</span>. ${Math.abs(fx.temp.r) < 0.3 ? 'That relationship is weak in your data – treat it as noise for now.' : `On a ${c.D(137)} shot that's about ${fmt(Math.abs(fx.temp.pct_per_10c) / 100 * c.cv(137), 0)} ${c.UNIT} per 10°C.`}</p>` : '<p class="muted">Temperature effect needs 8+ rounds with weather and club data.</p>'}
      ${fx.wind ? `<p><b>Wind:</b> in windy rounds (20+ km/h, n=${fx.wind.n_windy}) your stock distances average <b>${sgn(fx.wind.windy_rel - fx.wind.calm_rel, 1)}%</b> versus calm rounds (&lt;15 km/h, n=${fx.wind.n_calm})${A.isNum(fx.wind.p) ? ` <span class="small muted">(p=${fmt(fx.wind.p, 2)}${fx.wind.p >= 0.1 ? ' – not a clear difference' : ''})</span>` : ''}.</p>` : '<p class="muted">Wind effect needs at least 3 calm and 3 windy rounds.</p>'}
      ${fx.points.length >= 5 ? plot([{ x: fx.points.map((p) => p.t), y: fx.points.map((p) => p.rel), mode: 'markers', type: 'scatter', marker: { size: 8, color: fx.points.map((p) => p.w), colorscale: 'Viridis', showscale: true, colorbar: { title: { text: 'km/h' }, thickness: 10 } }, text: fx.points.map((p) => `${fmt(p.w, 0)} km/h wind · ${p.n} shots`), hovertemplate: '%{x:.0f}°C: %{y:+.1f}%<br>%{text}<extra></extra>' }], { height: 280, xaxis: { title: { text: 'Temperature during round (°C)' } }, yaxis: { title: { text: 'Distance vs your normal (%)' } } }) : ''}
      ${note('Each dot is one round: the average of that round\'s stock shots relative to each club\'s usual distance. Headwind and tailwind holes cancel out, so this shows the overall effect of a windy or hot day, not a per-shot adjustment.')}</div>
      <div class="card"><h2>Scoring by wind</h2>${table(fx.score_wind, cols)}<h3>Scoring by temperature</h3>${table(fx.score_temp, cols)}</div>`}
      <div class="card"><h2>Rounds</h2>${table(rounds.filter((r) => W[r.round_id]).slice(0, 60).map((r) => ({ ...r, ...W[r.round_id] })), [['date', 'Date'], ['course_name', 'Course'], ['temp_c', '°C', n0], ['wind_kmh', 'Wind km/h', n0], ['gust_kmh', 'Gusts', n0], ['wind_dir', 'From', compass], ['rain_mm', 'Rain mm', n1], ['differential', 'Diff', n1]], { empty: 'No weather fetched yet.' })}</div>`;
  }
  function wireConditions() {
    $('#wxFetch')?.addEventListener('click', async (e) => {
      e.target.disabled = true; const m = $('#wxMsg');
      const r = await fetchWeather((t) => { m.textContent = t; });
      toast(`Weather: ${r.ok} fetched${r.fail ? `, ${r.fail} failed (${r.lastErr})` : ''}`); c.rerender();
    });
  }

  // ================================================================ 5. Before / after
  function pageCompare() {
    const markers = [...J().markers].sort((a, b) => b.date.localeCompare(a.date)), sel = segVal('cmp_marker', markers[0]?.id || 'custom');
    const date = sel === 'custom' ? (c.ui.cmp_date || today()) : (markers.find((m) => m.id === sel)?.date || today());
    const win = segVal('cmp_win', 'all'), res = F.comparePeriods(c.DS, date, win === 'all' ? null : Number(win)), U = c.UNIT;
    return `<div class="card"><h2>Timeline</h2><p class="small">Mark when something changed – new clubs, a re-shaft, a lesson or swing change – then compare your golf before and after.</p>
      ${markers.length ? table(markers, [['date', 'Date'], ['type', 'Type'], ['label', 'What changed'], ['id', '', (v) => `<button class="btn sec sm" data-delmarker="${esc(v)}">Delete</button>`]]) : ''}
      <form id="mkForm" class="row"><div><label class="f">Date</label><input name="date" type="date" value="${today()}" required></div><div><label class="f">Type</label><select name="type">${['Equipment', 'Lesson', 'Swing change', 'Other'].map((t) => `<option>${t}</option>`).join('')}</select></div>
      <div style="flex:2"><label class="f">What changed</label><input name="label" placeholder="e.g. new wedges" required></div><div><button class="btn">Add</button></div></form></div>
      <div class="card"><h2>Compare</h2>${select('cmp_marker', [...markers.map((m) => [m.id, `${m.date} · ${m.label}`]), ['custom', 'Custom date…']], sel, 'Before / after')}
      ${sel === 'custom' ? `<label class="f">Date</label><input type="date" id="cmpDate" value="${esc(date)}">` : ''}
      ${seg('cmp_win', [['all', 'All rounds'], ['10', '10 each side'], ['5', '5 each side']], 'all')}
      <p class="small muted">${res.n_before} rounds before · ${res.n_after} rounds on/after ${esc(date)} (18-hole rounds)</p>
      ${table(res.metrics.filter((m) => m.n_before || m.n_after), [['label', 'Metric'], ['before', 'Before', n1], ['after', 'After', n1], ['delta', 'Change', (v) => sgn(v, 1)], ['p', 'p', n2], ['verdict', 'Verdict', vcol]])}
      ${note('Welch t-test, p < 0.10 for "better"/"worse". With few rounds on one side most changes will read "no clear change" – that is the honest answer, not a fault.')}</div>
      <div class="card"><h2>Club distances before vs after</h2>${table(res.clubs, [['club', 'Club'], ['before_m', `Before ${U}`, c.d0], ['after_m', `After ${U}`, c.d0], ['delta_m', 'Change', (v) => sgn(c.cv(v), 0)], ['cv_before', 'CV% before', n1], ['cv_after', 'CV% after', n1], ['n_before', 'n', n0], ['n_after', 'n', n0]], { empty: 'No club data on both sides of this date.' })}
      ${note('Median GPS total of stock shots. CV% = distance consistency (lower is tighter).')}</div>`;
  }
  function wireCompare() {
    $('#mkForm')?.addEventListener('submit', async (e) => { e.preventDefault(); const f = new FormData(e.target); const id = `m${Date.now()}`;
      J().markers.push({ id, date: f.get('date'), type: f.get('type'), label: f.get('label') }); c.ui.cmp_marker = id; c.saveUi(); await saveJ('Marker added'); });
    $$('[data-delmarker]').forEach((b) => b.addEventListener('click', async () => { J().markers = J().markers.filter((m) => m.id !== b.dataset.delmarker); if (c.ui.cmp_marker === b.dataset.delmarker) delete c.ui.cmp_marker; c.saveUi(); await saveJ('Deleted'); }));
    $('#cmpDate')?.addEventListener('change', (e) => { c.ui.cmp_date = e.target.value; c.saveUi(); c.rerender(); });
  }

  // ================================================================ 7. Course maps (OpenStreetMap)
  async function fetchCourseMap(courseId) {
    const bb = F.courseBBox(c.DS, courseId); if (!bb) throw new Error('Not enough GPS points for this course');
    const q = F.overpassQuery(bb); let lastErr = '';
    for (const host of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
      try {
        const r = await fetch(`${host}?data=${encodeURIComponent(q)}`); if (!r.ok) { lastErr = `HTTP ${r.status}`; continue; }
        const feats = F.parseOverpass(await r.json());
        c.state.osm[courseId] = { fetched_at: new Date().toISOString(), features: feats }; await S.saveOsm(c.state);
        return feats;
      } catch (e) { lastErr = e.message; }
    }
    throw new Error(`Map service unavailable (${lastErr})`);
  }
  function osmCard(courseId) {
    const o = c.state.osm[courseId], n = (k) => o?.features.filter((f) => f.kind === k).length || 0;
    const ms = o ? F.mapStats(c.DS, courseId, o.features) : null;
    return `<div class="card"><h2>Course outlines</h2>${o ? `<p class="small">${n('green')} greens, ${n('fairway')} fairways, ${n('bunker')} bunkers, ${n('water')} water areas from OpenStreetMap (downloaded ${esc(o.fetched_at.slice(0, 10))}). They are drawn on your shot maps for this course.</p>` : '<p class="small">Download fairway, green, bunker and water outlines for this course from OpenStreetMap to draw them on your shot maps and measure where shots really finished.</p>'}
      <button class="btn ${o ? 'sec' : ''}" data-osm="${esc(courseId)}">${o ? 'Refresh outlines' : 'Download course outlines'}</button> <span class="small" data-osmmsg></span>
      ${o && !o.features.length ? '<div class="warn" style="margin-top:8px">This course has not been mapped in OpenStreetMap yet, so there are no outlines to show.</div>' : ''}
      ${ms ? `<h3>Where your shots finished (by the map)</h3><div class="kpis">${ms.has_fairways ? kpi('Tee shots on fairway', ms.tee_fairway_pct, null, true, 0, '%') + kpi('Tee shots in bunker', ms.tee_bunker_pct, null, false, 0, '%') : ''}${kpi('Approaches on green', ms.appr_green_pct, null, true, 0, '%')}${kpi('Approaches in bunker', ms.appr_bunker_pct, null, false, 0, '%')}</div>
      ${note(`Map-based: GPS end point inside the mapped outline (${ms.tee_n} tee shots, ${ms.appr_n} approaches from ≤${c.D(200)}). Garmin's own lie data says ${fmt(ms.garmin_green_pct, 0)}% of those approaches finished on the green. Watch GPS is accurate to a few ${c.UNIT === 'yd' ? 'yards' : 'metres'}, so edge cases can fall either way, and outline quality depends on volunteer mapping.`)}` : ''}
      ${note('Only the course\'s bounding box is sent to the map service. Map data © OpenStreetMap contributors.')}</div>`;
  }
  function wireOsm() {
    $$('[data-osm]').forEach((b) => b.addEventListener('click', async () => {
      const m = b.parentElement.querySelector('[data-osmmsg]'); b.disabled = true; if (m) m.textContent = 'Downloading…';
      try { const f = await fetchCourseMap(b.dataset.osm); toast(f.length ? `${f.length} course features downloaded` : 'This course is not mapped in OpenStreetMap yet'); c.rerender(); }
      catch (e) { if (m) m.textContent = e.message; b.disabled = false; }
    }));
  }

  // ================================================================ 6. Course playbook
  function pagePlaybook() {
    const courses = [...new Map(c.DS.rounds.filter((r) => r.course_id).map((r) => [r.course_id, r.course_name])).entries()]
      .map(([id, name]) => [id, `${name} (${c.DS.rounds.filter((r) => r.course_id === id).length})`]).sort((a, b) => Number(b[1].match(/\((\d+)\)$/)[1]) - Number(a[1].match(/\((\d+)\)$/)[1]));
    if (!courses.length) return emptyCard('No courses yet.');
    const cid = segVal('pb_course', courses[0][0]), pb = F.playbook(c.DS, cid), U = c.UNIT;
    const hole = (h) => `<div class="card pb"><div class="rv-h"><b>Hole ${h.hole}</b><span class="small muted">Par ${h.par ?? '?'}${h.si ? ` · SI ${h.si}` : ''} · played ${h.n}×</span><span class="pill ${h.avg_to_par >= 1.5 ? 'bad' : h.avg_to_par <= 0.6 ? 'good' : 'mid'}">${sgn(h.avg_to_par, 2)} avg</span></div>
      <div class="statline"><span>GIR <b>${fmt(h.gir_pct, 0, '%')}</b></span>${h.par >= 4 ? `<span>Fairway <b>${fmt(h.fw_pct, 0, '%')}</b></span>` : ''}<span>Putts <b>${fmt(h.putts, 2)}</b></span><span>Triple+ <b>${fmt(h.blowup_pct, 0, '%')}</b></span>${A.isNum(h.stableford) ? `<span>Pts <b>${fmt(h.stableford, 2)}</b></span>` : ''}</div>
      ${h.clubs.length ? table(h.clubs.slice(0, 4), [['club', 'Tee club'], ['n', 'n', n0], ['avg_to_par', 'To par', (v) => sgn(v, 2)], ...(h.par >= 4 ? [['fw_pct', 'FW', p0]] : [['gir_pct', 'Green', p0]]), ['pen_pct', 'Pen', p0], ['median_m', U, c.d0]]) : ''}
      ${h.tips.length ? `<ul class="tips">${h.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}</div>`;
    return `${select('pb_course', courses, cid, 'Course')}
      <div class="kpis" style="margin-top:10px">${kpi('Rounds here', pb.rounds, null, true, 0)}<div class="kpi"><div class="l">Costing you most</div><div class="v sm">${pb.hardest.map((h) => `#${h}`).join(' · ') || '–'}</div></div><div class="kpi"><div class="l">Your best holes</div><div class="v sm">${pb.easiest.map((h) => `#${h}`).join(' · ') || '–'}</div></div></div>
      ${note('Suggestions only appear where your own rounds support them (e.g. a tee club needs 3+ plays to be compared). With few rounds on a course, treat everything as a hint.')}
      ${pb.holes.map(hole).join('')}${osmCard(cid)}`;
  }

  // ================================================================ 9. Personal bests
  function pageBests() {
    const b = F.personalBests(c.DS);
    const rec = (label, value, sub) => `<div class="best"><div><div class="l">${esc(label)}</div><div class="small muted">${esc(sub || '')}</div></div><div class="v">${value}</div></div>`;
    return `<div class="card"><h2>Records</h2>${b.records.map((r) => rec(r.label, (r.label === 'Best score to par' ? sgn(r.value, 0) : fmt(r.value, r.d)) + r.unit, `${r.date} · ${r.course || ''}`)).join('') || '<p class="muted">Needs an 18-hole round.</p>'}
      ${b.best_nine ? rec('Best nine', sgn(b.best_nine.to_par, 0), `${b.best_nine.date} · ${b.best_nine.nine} nine`) : ''}
      ${b.longest_drive ? rec('Longest tee shot', c.D(b.longest_drive.dist_m), `${b.longest_drive.date} · hole ${b.longest_drive.hole} · ${b.longest_drive.club || ''} (GPS total)`) : ''}</div>
      <div class="card"><h2>Streaks</h2>${rec('Holes without a 3-putt', b.streaks.no_three_putt_holes, 'longest run')}${rec('Holes at bogey or better', b.streaks.bogey_or_better_holes, 'longest run')}${rec('Holes at par or better', b.streaks.par_or_better_holes, 'longest run')}${rec('Rounds without a penalty', b.streaks.rounds_without_penalty, 'in a row')}</div>
      ${b.milestones.length ? `<div class="card"><h2>Milestones</h2>${b.milestones.map((m) => rec(m.label, `${m.times}×`, `first on ${m.date}`)).join('')}</div>` : ''}
      <div class="card"><h2>Career totals</h2><div class="kpis">${kpi('Rounds', b.totals.rounds, null, true, 0)}${kpi('Holes', b.totals.holes, null, true, 0)}${kpi('Birdies or better', b.totals.birdies, null, true, 0)}${kpi('Pars', b.totals.pars, null, true, 0)}${kpi('Courses', b.totals.courses, null, true, 0)}${kpi('Shots tracked', b.totals.shots, null, true, 0)}</div></div>`;
  }

  // ================================================================ 10. Share card
  async function shareRound(rid) {
    const r = c.DS.rounds.find((x) => x.round_id === rid); if (!r) return;
    const hh = c.DS.holes.filter((h) => h.round_id === rid).sort((a, b) => a.hole - b.hole), w = c.state.weather[rid];
    const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1350; const g = cv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 1350); grad.addColorStop(0, '#0a3d2b'); grad.addColorStop(1, '#05201a'); g.fillStyle = grad; g.fillRect(0, 0, 1080, 1350); g.strokeStyle = '#c9a43a'; g.lineWidth = 4; g.strokeRect(28, 28, 1024, 1294);
    const font = (s, wt = 600) => { g.font = s >= 42 ? `${wt} ${s}px Didot, "Bodoni 72", Baskerville, "Hoefler Text", Georgia, serif` : `${wt} ${s}px -apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif`; };
    g.fillStyle = 'rgba(255,255,255,.65)'; font(34, 500); g.fillText(new Date(r.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), 72, 120);
    g.fillStyle = '#fff'; font(58, 700); let name = r.course_name || 'Round'; while (g.measureText(name).width > 936 && name.length > 8) name = name.slice(0, -2); g.fillText(name === (r.course_name || 'Round') ? name : name + '…', 72, 196);
    g.fillStyle = 'rgba(255,255,255,.65)'; font(32, 500); g.fillText([r.tee ? `${r.tee} tees` : null, A.isNum(r.par_played) ? `Par ${r.par_played}` : null, w ? `${fmt(w.temp_c, 0)}°C, wind ${fmt(w.wind_kmh, 0)} km/h` : null].filter(Boolean).join('  ·  '), 72, 250);
    g.fillStyle = '#fff'; font(300, 800); g.fillText(String(r.gross), 64, 560);
    const gw = g.measureText(String(r.gross)).width; g.fillStyle = '#f2cf4a'; font(88, 700); g.fillText(A.isNum(r.to_par) ? (r.to_par > 0 ? `+${r.to_par}` : r.to_par === 0 ? 'E' : String(r.to_par)) : '', 96 + gw, 470);
    if (A.isNum(r.stableford_round)) { g.fillStyle = 'rgba(255,255,255,.75)'; font(44, 600); g.fillText(`${r.stableford_round} pts`, 100 + gw, 548); }
    const stats = [['GIR', A.isNum(r.gir_n) ? `${r.gir_n}/${r.gir_holes}` : '–'], ['Fairways', A.isNum(r.fw_n) ? `${r.fw_n}/${r.fw_holes}` : '–'], ['Putts', A.isNum(r.putts_round) ? String(r.putts_round) : '–'], ['Penalties', A.isNum(r.penalties) ? String(r.penalties) : '–'],
      ['Birdies', String(r.birdies_or_better)], ['Pars', String(r.pars)], ['Differential', fmt(r.differential, 1)], ['Index used', fmt(r.hi, 1)]];
    stats.forEach(([l, v], i) => { const x = 72 + (i % 4) * 240, y = 690 + Math.floor(i / 4) * 150; g.fillStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.roundRect(x, y, 216, 124, 22); g.fill();
      g.fillStyle = 'rgba(255,255,255,.6)'; font(26, 500); g.fillText(l, x + 22, y + 44); g.fillStyle = '#fff'; font(46, 700); g.fillText(v, x + 22, y + 98); });
    const col = (tp) => (tp <= -1 ? '#43c77a' : tp === 0 ? '#5b8dd6' : tp === 1 ? '#e0a23a' : tp === 2 ? '#e0685c' : '#b0302a');
    const n = hh.length, per = Math.ceil(n / 2) || 1, bw = Math.min(100, 936 / per - 8);
    hh.forEach((h, i) => { const x = 72 + (i % per) * (bw + 8), y = 1030 + Math.floor(i / per) * 128; g.fillStyle = A.isNum(h.to_par) ? col(h.to_par) : '#555'; g.beginPath(); g.roundRect(x, y, bw, 92, 14); g.fill();
      g.fillStyle = 'rgba(255,255,255,.75)'; font(20, 600); g.fillText(String(h.hole), x + 10, y + 26); g.fillStyle = '#fff'; font(42, 700); const t = String(h.strokes); g.fillText(t, x + (bw - g.measureText(t).width) / 2, y + 72); });
    g.fillStyle = 'rgba(255,255,255,.5)'; font(26, 600); g.fillText('GolfIQ', 72, 1310); font(24, 500); let lx = 1008; for (const [lab, tp] of [['worse', 3], ['double', 2], ['bogey', 1], ['par', 0], ['birdie', -1]]) { g.fillStyle = 'rgba(255,255,255,.6)'; const wd = g.measureText(lab).width; lx -= wd; g.fillText(lab, lx, 1310); lx -= 30; g.fillStyle = col(tp); g.beginPath(); g.roundRect(lx, 1291, 20, 20, 5); g.fill(); lx -= 22; }
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png')), file = new File([blob], `golfiq-${r.date}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: r.label }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  }

  // ================================================================ Practice: games, log, wedge matrix
  const allGames = () => [...F.DEFAULT_GAMES, ...J().games];
  function practiceGames() {
    const games = F.gameStats(allGames(), J().results), gid = segVal('pg_game', games[0].id), g = games.find((x) => x.id === gid) || games[0];
    const cats = [...new Set(games.map((x) => x.cat))];
    return `<div class="card"><h2>Record a score</h2><form id="pgForm">${select('pg_game', cats.flatMap((cat) => games.filter((x) => x.cat === cat).map((x) => [x.id, `${cat} · ${x.name}`])), g.id, 'Game')}
      <p class="small" style="margin:8px 0"><b>How to play:</b> ${esc(g.how || '')} <span class="muted">(${g.better === 'lower' ? 'lower is better' : 'higher is better'})</span></p>
      <div class="row"><div><label class="f">Date</label><input name="date" type="date" value="${today()}" required></div><div><label class="f">Score (${esc(g.unit || '')})</label><input name="score" type="number" inputmode="decimal" step="any" ${g.max ? `max="${g.max}"` : ''} min="0" required></div></div>
      <label class="f">Note (optional)</label><input name="note" style="width:100%" placeholder="conditions, feel, club used…"><p><button class="btn">Save score</button></p></form></div>
      <div class="card"><h2>${esc(g.name)}</h2>${g.n ? `<div class="kpis">${kpi('Best', g.best, null, true, 0)}${kpi('Last 5 average', g.avg5, A.isNum(g.prev5) ? g.avg5 - g.prev5 : null, g.better !== 'lower')}${kpi('Played', g.n, null, true, 0)}</div>
        ${g.n >= 2 ? plot([{ x: g.results.map((r) => r.date), y: g.results.map((r) => r.score), mode: 'lines+markers', line: { color: '#1b7f4b', width: 2.5 }, marker: { size: 7 } }], { height: 220, yaxis: { title: { text: g.unit || 'score' }, ...(g.better === 'lower' ? { autorange: 'reversed' } : {}) } }) : ''}
        ${table([...g.results].reverse().slice(0, 15), [['date', 'Date'], ['score', 'Score', (v) => fmt(v, Number.isInteger(v) ? 0 : 1) + (g.max ? ` / ${g.max}` : '')], ['note', 'Note'], ['id', '', (v) => `<button class="btn sec sm" data-delres="${esc(v)}">Delete</button>`]])}` : '<p class="muted">No scores yet for this game.</p>'}</div>
      <div class="card"><h2>All games</h2>${table(games, [['cat', 'Type'], ['name', 'Game'], ['n', 'Played', n0], ['best', 'Best', (v) => fmt(v, 0)], ['avg5', 'Last 5', n1], ['trend', 'Trend', vcol]])}
      <details><summary>Add your own game</summary><form id="pgNew"><div class="row"><div><label class="f">Name</label><input name="name" required></div><div><label class="f">Type</label><select name="cat">${['Putting', 'Chipping', 'Range', 'Other'].map((x) => `<option>${x}</option>`).join('')}</select></div></div>
      <div class="row"><div><label class="f">Scoring</label><select name="better"><option value="higher">Higher is better</option><option value="lower">Lower is better</option></select></div><div><label class="f">Max score (optional)</label><input name="max" type="number"></div></div>
      <label class="f">How to play</label><input name="how" style="width:100%"><p><button class="btn sec">Add game</button></p></form>
      ${J().games.length ? `<p class="small">Your games: ${J().games.map((x) => `${esc(x.name)} <button class="btn sec sm" data-delgame="${esc(x.id)}">remove</button>`).join(' ')}</p>` : ''}</details></div>`;
  }
  const FOCUS = [['penalties', 'Penalty avoidance / course management', 'penalties'], ['three_putts', 'Lag putting', 'three_putt_pct'], ['short_putts', 'Short putting', 'one_putt_pct'], ['fairways', 'Driving accuracy', 'fw_pct'],
    ['gir', 'Approach play', 'gir_pct'], ['scrambling', 'Short game', null], ['wedges', 'Wedge distances', null], ['blowups', 'Decision making', 'blowups'], ['swing', 'Swing change / technique', null], ['other', 'Other', null]];
  function practiceLog() {
    const ses = [...J().sessions].sort((a, b) => b.date.localeCompare(a.date)), since = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
    const r18 = c.DS.rounds.filter((r) => r.format === '18');
    const rows = FOCUS.map(([k, label, metric]) => {
      const mine = ses.filter((s) => s.focus === k); if (!mine.length) return null;
      const v = metric ? A.compareWindows(r18.map((r) => r[metric]), A.METRICS[metric][1], [5])[0] : null;
      return { label, m30: A.sum(mine.filter((s) => s.date >= since(30)).map((s) => s.minutes)), m90: A.sum(mine.filter((s) => s.date >= since(90)).map((s) => s.minutes)), sessions: mine.length,
        metric: metric ? A.METRICS[metric][0] : '–', verdict: v ? v.verdict : 'not tracked on course' };
    }).filter(Boolean);
    const pri = c.DS.rounds.length ? A.findings(A.filterDataset(c.DS, { formats: ['18'], lastN: 20 }), c.UNIT).slice(0, 3) : [];
    return `<div class="card"><h2>Log a practice session</h2><form id="psForm"><div class="row"><div><label class="f">Date</label><input name="date" type="date" value="${today()}" required></div><div><label class="f">Minutes</label><input name="minutes" type="number" inputmode="numeric" value="45" required></div></div>
      <label class="f">Focus</label><select name="focus">${FOCUS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      ${pri.length ? `<p class="small muted" style="margin:6px 0">Your current top priorities: ${pri.map((f) => esc(f.title)).join(' · ')}</p>` : ''}
      <label class="f">What you did</label><input name="notes" style="width:100%" placeholder="drills, feels, what worked"><p><button class="btn">Save session</button></p></form></div>
      <div class="card"><h2>Is the practice showing up on the course?</h2>${table(rows, [['label', 'Focus'], ['m30', 'Min (30 d)', n0], ['m90', 'Min (90 d)', n0], ['sessions', 'Sessions', n0], ['metric', 'On-course metric'], ['verdict', 'Last 5 vs previous 5', vcol]], { empty: 'Log a session to start tracking.' })}
      ${note('The verdict is your on-course trend for the matching stat (last 5 rounds vs the 5 before). It shows whether the number moved – it cannot prove the practice caused it.')}</div>
      <div class="card"><h2>History</h2>${table(ses.slice(0, 40), [['date', 'Date'], ['focus', 'Focus', (v) => esc(FOCUS.find((f) => f[0] === v)?.[1] || v)], ['minutes', 'Min', n0], ['notes', 'Notes'], ['id', '', (v) => `<button class="btn sec sm" data-delses="${esc(v)}">Delete</button>`]], { empty: 'No sessions yet.' })}</div>`;
  }
  function practiceWedges() {
    const W = J().wedge, U = c.UNIT, cells = F.wedgeMatrix(W.entries), med = new Map(A.clubTable(c.DS.shots, c.DS.clubs).map((x) => [x.club_id, x.median_m ?? 0]));
    const clubs = c.DS.clubs.filter((x) => x.category === 'wedge' && x.active !== 0).sort((a, b) => (b.target_carry_m ?? med.get(b.club_id) ?? 0) - (a.target_carry_m ?? med.get(a.club_id) ?? 0));
    const extra = [...new Set(W.entries.map((e) => e.club_id))].filter((id) => !clubs.some((x) => x.club_id === id)).map((id) => ({ club_id: id, name: clubName(id) }));
    const rows = [...clubs, ...extra], ladder = F.wedgeLadder(cells, clubName), big = c.uncv(15), small = c.uncv(4);
    if (!rows.length) return emptyCard('No wedges found. In Settings → Clubs set the category of your PW/GW/SW/LW to "wedge" and they will appear here.');
    const cell = (cl, len) => { const v = cells.get(`${cl.club_id}|${len}`); return v ? `<b>${c.d0(v.carry_m)}</b>${A.isNum(v.prev_m) && Math.abs(v.carry_m - v.prev_m) >= 0.5 ? `<br><span class="small ${v.carry_m > v.prev_m ? 'good' : 'bad'}">${sgn(c.cv(v.carry_m - v.prev_m), 0)}</span>` : ''}` : '<span class="muted">–</span>'; };
    const hist = segVal('wg_hist', rows[0].club_id), hcells = W.lengths.map((l) => cells.get(`${hist}|${l}`)).filter(Boolean);
    return `<div class="card"><h2>Your wedge matrix <span class="small muted">(${U}, carry)</span></h2><div class="tbl"><table class="matrix"><thead><tr><th>Club</th>${W.lengths.map((l) => `<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>
      ${rows.map((cl) => `<tr><td>${esc(cl.name)}</td>${W.lengths.map((l) => `<td>${cell(cl, l)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${note('Latest session per cell; the small number is the change from the session before. These are carry distances you measured on the range – unlike the GPS totals elsewhere in the app.')}</div>
      <div class="card"><h2>Enter a range session</h2><form id="wgForm"><label class="f">Date</label><input name="date" type="date" value="${today()}" required>
      <div class="tbl" style="margin-top:8px"><table class="matrix"><thead><tr><th>Club</th>${W.lengths.map((l) => `<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>
      ${rows.map((cl) => `<tr><td>${esc(cl.name)}</td>${W.lengths.map((l) => `<td><input type="number" inputmode="decimal" data-club="${esc(cl.club_id)}" data-len="${esc(l)}" placeholder="${cells.has(`${cl.club_id}|${l}`) ? c.d0(cells.get(`${cl.club_id}|${l}`).carry_m) : ''}" style="width:58px;padding:8px 6px;text-align:center"></td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="small muted">Enter the average carry for each swing length (${U}). Leave cells blank to skip them.</p><p><button class="btn">Save session</button></p></form>
      <details><summary>Change swing lengths</summary><form id="wgLen"><label class="f">Swing lengths, shortest to longest (comma separated)</label><input name="lengths" value="${esc(W.lengths.join(', '))}" style="width:100%"><p class="small muted">e.g. 7:30, 9:00, 10:30 – or add Full as a fourth.</p><p><button class="btn sec">Save lengths</button></p></form></details></div>
      <div class="card"><h2>Distance ladder</h2>${table(ladder, [['carry_m', U, (v) => `<b>${c.d0(v)}</b>`], ['club', 'Club'], ['length', 'Swing'], ['gap_m', 'Gap', (v) => (A.isNum(v) ? `${c.d0(v)}${v > big ? ' <span class="pill bad">gap</span>' : v < small ? ' <span class="pill mid">overlap</span>' : ''}` : '')], ['date', 'Measured']], { empty: 'Enter a session to build your ladder.' })}
      ${note(`Every club and swing length sorted by carry. "gap" = more than ${c.D(big)} to the next shot up; "overlap" = less than ${c.D(small)}.`)}</div>
      <div class="card"><h2>Tracking</h2>${select('wg_hist', rows.map((x) => [x.club_id, x.name]), hist, 'Club')}
      ${hcells.some((h) => h.history.length >= 2) ? plot(hcells.map((h, i) => ({ x: h.history.map((p) => p.date), y: h.history.map((p) => c.cv(p.carry_m)), name: h.length, mode: 'lines+markers', line: { color: COLORS[i % 12] } })), { height: 240, yaxis: { title: { text: `Carry (${U})` } } }) : '<p class="muted small">A trend appears after two sessions.</p>'}
      ${table(W.entries.filter((e) => e.club_id === hist).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30), [['date', 'Date'], ['length', 'Swing'], ['carry_m', U, c.d0], ['id', '', (v) => `<button class="btn sec sm" data-delwg="${esc(v)}">Delete</button>`]], { empty: 'No entries for this club.' })}</div>`;
  }
  function pagePractice() {
    const tab = segVal('pr_tab', 'games');
    return `${seg('pr_tab', [['games', 'Games'], ['wedges', 'Wedge matrix'], ['log', 'Practice log']], 'games')}${tab === 'games' ? practiceGames() : tab === 'wedges' ? practiceWedges() : practiceLog()}`;
  }
  function wirePractice() {
    $('#pgForm')?.addEventListener('submit', async (e) => { e.preventDefault(); const f = new FormData(e.target);
      J().results.push({ id: `r${Date.now()}`, game: $('[data-sel=pg_game]').value, date: f.get('date'), score: Number(f.get('score')), note: f.get('note') || '' }); await saveJ('Score saved'); });
    $$('[data-delres]').forEach((b) => b.addEventListener('click', async () => { J().results = J().results.filter((r) => r.id !== b.dataset.delres); await saveJ('Deleted'); }));
    $('#pgNew')?.addEventListener('submit', async (e) => { e.preventDefault(); const f = new FormData(e.target), id = `g${Date.now()}`;
      J().games.push({ id, name: f.get('name'), cat: f.get('cat'), better: f.get('better'), max: c.numOrNull(f.get('max')), how: f.get('how') || '', unit: c.numOrNull(f.get('max')) ? `/ ${f.get('max')}` : 'score' }); c.ui.pg_game = id; c.saveUi(); await saveJ('Game added'); });
    $$('[data-delgame]').forEach((b) => b.addEventListener('click', async () => { if (!confirm('Remove this game and its scores?')) return; J().games = J().games.filter((g) => g.id !== b.dataset.delgame); J().results = J().results.filter((r) => r.game !== b.dataset.delgame); delete c.ui.pg_game; c.saveUi(); await saveJ('Removed'); }));
    $('#psForm')?.addEventListener('submit', async (e) => { e.preventDefault(); const f = new FormData(e.target);
      J().sessions.push({ id: `s${Date.now()}`, date: f.get('date'), minutes: Number(f.get('minutes')) || 0, focus: f.get('focus'), notes: f.get('notes') || '' }); await saveJ('Session saved'); });
    $$('[data-delses]').forEach((b) => b.addEventListener('click', async () => { J().sessions = J().sessions.filter((s) => s.id !== b.dataset.delses); await saveJ('Deleted'); }));
    $('#wgForm')?.addEventListener('submit', async (e) => { e.preventDefault(); const date = new FormData(e.target).get('date'); let n = 0;
      for (const inp of $$('input[data-club]', e.target)) { const v = c.numOrNull(inp.value); if (v === null || v <= 0) continue; J().wedge.entries.push({ id: `w${Date.now()}${n}`, date, club_id: inp.dataset.club, length: inp.dataset.len, carry_m: c.uncv(v) }); n++; }
      await saveJ(n ? `${n} distances saved` : 'Nothing entered'); });
    $('#wgLen')?.addEventListener('submit', async (e) => { e.preventDefault(); const l = String(new FormData(e.target).get('lengths')).split(',').map((x) => x.trim()).filter(Boolean).slice(0, 6); if (l.length) { J().wedge.lengths = l; await saveJ('Swing lengths updated'); } });
    $$('[data-delwg]').forEach((b) => b.addEventListener('click', async () => { J().wedge.entries = J().wedge.entries.filter((x) => x.id !== b.dataset.delwg); await saveJ('Deleted'); }));
  }

  // ================================================================ Coach hub: priorities, notes from Claude, swing thoughts
  function briefing() {
    const ds = c.DS, U = c.UNIT, r18 = ds.rounds.filter((r) => r.format === '18'), last = r18.slice(-10), k = Object.fromEntries(A.kpiTable(r18, 5).map((x) => [x.metric, x]));
    const f1 = (v, d = 1) => (A.isNum(v) ? v.toFixed(d) : '–'), L = [];
    const idx = r18.length ? r18[r18.length - 1] : null;
    L.push(`# My golf data (from GolfIQ, ${today()})`, '', `Rounds stored: ${ds.rounds.length} (${r18.length} full 18-hole). Handicap index used: ${f1(idx?.hi)} (${idx?.hi_source || 'none'}); GolfIQ-calculated index: ${f1(idx?.index_after)}.`, '');
    L.push('## Last 5 rounds vs earlier rounds', ...['gross', 'stableford_round', 'differential', 'gir_pct', 'fw_pct', 'putts_round', 'three_putt_pct', 'penalties'].map((m) => `- ${k[m].label}: ${f1(k[m].recent)} (earlier ${f1(k[m].baseline)})`), '');
    L.push('## Recent rounds', ...last.reverse().map((r) => `- ${r.date} ${r.course_name}: ${r.gross} (${r.to_par > 0 ? '+' : ''}${r.to_par}), ${f1(r.stableford_round, 0)} pts, GIR ${f1(r.gir_pct, 0)}%, FW ${f1(r.fw_pct, 0)}%, ${f1(r.putts_round, 0)} putts, ${f1(r.penalties, 0)} pen`), '');
    const fs = r18.length ? A.findings(A.filterDataset(ds, { formats: ['18'], lastN: 20 }), U) : [];
    if (fs.length) L.push('## Where I lose strokes (last 20 rounds, vs my own best-quartile level)', ...fs.map((f, i) => `${i + 1}. ${f.title}: ~${f1(f.strokes_per_round)} strokes/round. ${f.evidence.join('; ')}`), '');
    const t = A.clubTable(ds.shots, ds.clubs).filter((x) => x.category !== 'putter' && x.sample !== 'insufficient');
    if (t.length) L.push(`## Club distances (GPS total, ${U}; median, middle 50%, consistency CV%, mishit %)`, ...t.map((x) => `- ${x.club}: ${c.d0(x.median_m)} (${c.d0(x.p25_m)}–${c.d0(x.p75_m)}), CV ${f1(x.cv_pct)}%, mishit ${f1(x.partial_pct, 0)}%, n=${x.shots_stock}${A.isNum(x.lateral_sd_m) ? `, L/R SD ${c.d0(x.lateral_sd_m)}` : ''}`), '');
    const lad = F.wedgeLadder(F.wedgeMatrix(J().wedge.entries), clubName);
    if (lad.length) L.push(`## Wedge matrix (range carry, ${U})`, ...lad.map((w) => `- ${w.club} ${w.length}: ${c.d0(w.carry_m)}`), '');
    const games = F.gameStats(allGames(), J().results).filter((g) => g.n);
    if (games.length) L.push('## Practice games', ...games.map((g) => `- ${g.name}: last ${g.last.score}${g.max ? '/' + g.max : ''}, best ${g.best}, last-5 avg ${f1(g.avg5)} (${g.better} is better, played ${g.n}×)`), '');
    if (J().thoughts.filter(Boolean).length) L.push('## My current swing thoughts', ...J().thoughts.filter(Boolean).map((x) => `- ${x}`), '');
    const notes = [...J().notes].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
    if (notes.length) L.push('## Your last coaching notes to me', ...notes.map((n) => `- ${n.date} ${n.title}: ${n.feedback}${n.feels?.length ? ` Feels: ${n.feels.join('; ')}.` : ''}${n.drills?.length ? ` Drills: ${n.drills.map((d) => d.name).join(', ')}.` : ''}`), '');
    L.push('## How to reply', 'You are my golf coach. After your advice, finish with a note I can paste into GolfIQ, as one JSON object in a code block, in exactly this shape (2–4 feels, 1–4 drills, today\'s date unless I say otherwise):', '', '```json', F.COACH_FORMAT, '```');
    return L.join('\n');
  }
  function coachNotes() {
    const notes = [...J().notes].sort((a, b) => b.date.localeCompare(a.date) || String(b.added_at).localeCompare(String(a.added_at)));
    const card = (n) => `<div class="card notecard"><div class="rv-h"><b>${esc(n.title)}</b><span class="small muted">${esc(n.date)}${n.focus ? ` · ${esc(n.focus)}` : ''}</span></div>
      ${n.feedback ? `<p>${esc(n.feedback)}</p>` : ''}
      ${n.feels?.length ? `<h3>Feels</h3><ul class="tips">${n.feels.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      ${n.drills?.length ? `<h3>Drills</h3>${n.drills.map((d) => `<div class="drill"><b>${esc(d.name)}</b>${d.reps ? ` <span class="pill">${esc(d.reps)}</span>` : ''}${d.how ? `<br><span class="small">${esc(d.how)}</span>` : ''}</div>`).join('')}` : ''}
      <p class="small muted" style="margin:10px 0 0">${esc(n.source === 'me' ? 'Written by you' : 'From Claude')} <button class="btn sec sm" data-delnote="${esc(n.id)}">Delete</button></p></div>`;
    return `<div class="card"><h2>Coaching with Claude</h2><ol class="small steps"><li>Tap <b>Copy briefing</b> and paste it into your chat with Claude, with your question or a description of what you're seeing.</li><li>Claude replies with advice and a note in GolfIQ's format.</li><li>Copy Claude's reply, come back here and tap <b>Paste note</b>.</li></ol>
      <button class="btn" id="cnBrief">Copy briefing for Claude</button><button class="btn sec" id="cnPaste">Paste note from Claude</button>
      <details id="cnManual"><summary class="small">Paste manually / write your own note</summary><textarea id="cnText" rows="5" placeholder="Paste Claude's reply here (the JSON note can be anywhere in the text)"></textarea><p><button class="btn sec" id="cnImport">Import pasted text</button></p>
      <form id="cnOwn"><div class="row"><div><label class="f">Date</label><input name="date" type="date" value="${today()}"></div><div style="flex:2"><label class="f">Title</label><input name="title" required></div></div>
      <label class="f">Feedback / what I noticed</label><textarea name="feedback" rows="3" style="font:15px inherit"></textarea><label class="f">Feels (one per line)</label><textarea name="feels" rows="2" style="font:15px inherit"></textarea>
      <label class="f">Drills (one per line)</label><textarea name="drills" rows="2" style="font:15px inherit"></textarea><p><button class="btn sec">Save my note</button></p></form></details>
      ${note('The briefing contains your stats, club distances, practice scores and recent notes – nothing is sent anywhere until you paste it yourself. If you use cloud sync, notes saved in your private repo at data/coach/notes.json are also imported on Sync.')}</div>
      ${notes.length ? notes.map(card).join('') : emptyCard('No coaching notes yet.')}`;
  }
  function coachThoughts() {
    const t = J().thoughts, edit = c.ui.th_edit;
    if (edit || !t.filter(Boolean).length) return `<div class="card"><h2>Swing thoughts</h2><p class="small">Up to five short cues for when you're struggling. Keep each to a few words you can act on.</p><form id="thForm">${[0, 1, 2, 3, 4].map((i) => `<label class="f">${i + 1}</label><input name="t${i}" maxlength="90" value="${esc(t[i] || '')}" style="width:100%">`).join('')}<p><button class="btn">Save</button></p></form></div>`;
    return `<div class="thoughts">${t.filter(Boolean).map((x, i) => `<div class="thought"><span>${i + 1}</span><p>${esc(x)}</p></div>`).join('')}</div><p><button class="btn sec" id="thEdit">Edit swing thoughts</button></p>${note('Tip: ask Claude to distil its latest coaching note into swing thoughts, then update these.')}`;
  }
  function pageCoach() {
    const tab = segVal('coach_tab', 'priorities');
    return `${seg('coach_tab', [['priorities', 'Priorities'], ['notes', 'Coach notes'], ['thoughts', 'Swing thoughts']], 'priorities')}${tab === 'notes' ? coachNotes() : tab === 'thoughts' ? coachThoughts() : c.coachingPriorities()}`;
  }
  async function importNotes(text) {
    const parsed = F.parseCoachNotes(text);
    if (!parsed.length) { toast('No GolfIQ note found in that text. Ask Claude to include the JSON note.'); return; }
    const n = S.addCoachNotes(c.state, parsed, 'claude'); await saveJ(n ? `${n} note(s) added` : 'That note is already saved');
  }
  function wireCoach() {
    $('#cnBrief')?.addEventListener('click', async () => { const t = briefing(); try { await navigator.clipboard.writeText(t); toast('Briefing copied – paste it into your chat with Claude'); } catch { $('#cnManual').open = true; $('#cnText').value = t; toast('Copy the text from the box below'); } });
    $('#cnPaste')?.addEventListener('click', async () => { try { const t = await navigator.clipboard.readText(); if (!t) throw new Error('empty'); await importNotes(t); } catch { $('#cnManual').open = true; $('#cnText').focus(); toast('Paste Claude\'s reply into the box, then tap Import'); } });
    $('#cnImport')?.addEventListener('click', () => importNotes($('#cnText').value));
    $('#cnOwn')?.addEventListener('submit', async (e) => { e.preventDefault(); const f = new FormData(e.target), lines = (k) => String(f.get(k) || '').split('\n').map((x) => x.trim()).filter(Boolean);
      S.addCoachNotes(c.state, [{ date: f.get('date') || today(), title: f.get('title'), feedback: f.get('feedback') || '', feels: lines('feels'), drills: lines('drills').map((name) => ({ name })), focus: '' }], 'me'); await saveJ('Note saved'); });
    $$('[data-delnote]').forEach((b) => b.addEventListener('click', async () => { if (!confirm('Delete this note?')) return; J().notes = J().notes.filter((n) => n.id !== b.dataset.delnote); await saveJ('Deleted'); }));
    $('#thForm')?.addEventListener('submit', async (e) => { e.preventDefault(); const f = new FormData(e.target); J().thoughts = [0, 1, 2, 3, 4].map((i) => String(f.get(`t${i}`) || '').trim()).filter(Boolean); c.ui.th_edit = false; c.saveUi(); await saveJ('Swing thoughts saved'); });
    $('#thEdit')?.addEventListener('click', () => { c.ui.th_edit = true; c.saveUi(); c.rerender(); });
  }

  return {
    pages: { caddie: ['Caddie', 'target'], review: ['Post-round review', 'check'], handicap: ['Handicap', 'trend'], conditions: ['Conditions', 'wind'], compare: ['Before & after', 'swap'], playbook: ['Course playbook', 'flag'],
      bests: ['Personal bests', 'trophy'], practice: ['Practice', 'dumbbell'], coaching: ['Coach', 'compass'] },
    render: { caddie: pageCaddie, review: pageReview, handicap: pageHandicap, conditions: pageConditions, compare: pageCompare, playbook: pagePlaybook, bests: pageBests, practice: pagePractice, coaching: pageCoach },
    wire: { caddie: wireCaddie, review: wireReview, conditions: wireConditions, compare: wireCompare, practice: wirePractice, coaching: wireCoach },
    noData: ['practice', 'coaching'],        // usable before any rounds are imported
    shareRound, wireOsm, osmCard, fetchWeather, briefing, reviewNeeds,
  };
}
