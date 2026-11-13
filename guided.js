// Guided practice play: one step per screen, big thumb buttons, draft saved after every step, result screen with tier and potential credit.
import * as B from './bench.js';
import * as F from './features.js';
import * as G from './games.js';
import * as SS from './sessions.js';

export function registerGuided(c) {
  const { esc, fmt, $, $$ } = c;
  const J = () => c.state.journal;
  const unitM = () => (c.UNIT === 'yd' ? 0.9144 : 1);
  const games = () => [...F.DEFAULT_GAMES, ...(J().games || [])];
  const gameOf = (id) => games().find((g) => g.id === id);
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const save = () => c.S.saveJournal(c.state);
  const sc = (v) => (Number.isInteger(v) ? String(v) : fmt(v, 1));
  const canGuide = (id) => G.GUIDED.has(id);

  // what the golfer is aiming at in this game: the target for the skill's next handicap step, and where the plan stands
  function info(id) {
    const v = c.progress.data(); let hit = null;
    for (const s of v.sk.skills) for (const sub of s.subs) { const g = sub.games.find((x) => x.id === id); if (g && !hit) hit = { target: g.target, skill: s.title, skill_h: s.target, sub: sub.title, full_key: sub.full_key }; }
    const led = v.plan.ledger.find((x) => x.game === id) || null;
    return { ...(hit || {}), ledger: led, potential: v.fc.ok ? v.fc.potential : null };
  }
  const tierChip = (t) => (t ? `<span class="tier ${t.key}">${esc(t.name)}</span>` : '');

  // ------------------------------------------------------------ starting, stepping, finishing
  async function start(id, opts = {}) {
    const g = gameOf(id); if (!g || !canGuide(id)) { c.ui.pr_tab = 'games'; c.ui.pg_game = id; c.saveUi(); c.rerender(); return; }
    J().game_draft = G.newDraft(g, { unitM: unitM(), pressure: !!opts.pressure, session_id: opts.session_id || null, ghost: opts.ghost || null });
    c.ui.pr_tab = 'games'; c.ui.pg_game = id; c.ui.game_result = null; c.saveUi(); await save();
    if (location.hash !== '#practice') location.hash = '#practice'; else c.rerender();
    scrollTo(0, 0);
  }
  const draft = () => J().game_draft || null, draft0 = draft, run = () => J().session_run || null;
  async function answer(v) {
    const d = draft(); if (!d) return; const g = gameOf(d.game), list = G.steps(g, { seed: d.seed, unitM: d.unitM }), sc0 = G.scoreOf(g, list, d.answers);
    if (sc0.done) return; d.answers.push(v); await save();
    if (G.scoreOf(g, list, d.answers).done) return finish(); render();
  }
  async function undo() { const d = draft(); if (!d || !d.answers.length) return; d.answers.pop(); await save(); render(); }
  async function quit() { if (!confirm(run() ? 'Stop this session? Games you finished are kept.' : 'Stop this game? Nothing is saved.')) return; J().game_draft = null; if (draft0()?.session_id || run()) endSession(true); await save(); c.rerender(); }
  async function finish() {
    const d = draft(), g = gameOf(d.game); const before = G.bestScore(g, J().results || []), v0 = c.progress.data(), led0 = v0.plan.ledger.find((x) => x.game === g.id);
    const res = G.resultFromDraft(d, g, { date: today() }); afterResult(res); J().results.push(res); J().game_draft = null;
    const up = G.tierUp(g, before, res.score, unitM());
    c.ui.game_result = { id: res.id, prev_best: before, pot_before: v0.fc.ok ? v0.fc.potential : null, hits_before: led0 ? led0.hits : null, up: up?.key || null, session_id: res.session_id || null };
    c.saveUi(); await save(); c.compete.onScore(res);
    c.toast(up ? `${up.name} tier reached – ${g.name}` : `Saved: ${sc(res.score)}`); c.rerender(); scrollTo(0, 0);
  }

  // ------------------------------------------------------------ screens
  function playScreen() {
    const d = draft(), g = gameOf(d.game), list = G.steps(g, { seed: d.seed, unitM: d.unitM }), a = d.answers, sc0 = G.scoreOf(g, list, a), i = a.length, step = list[Math.min(i, list.length - 1)];
    const inf = info(g.id), lower = g.better === 'lower', last = i === list.length - 1 && !G.isOpen(g.id), pr = d.pressure && last;
    const dots = list.slice(0, G.isOpen(g.id) ? Math.max(10, i + 1) : list.length).map((s, k) => `<i class="${k < i ? (list[k].input === 'strokes' ? 'done' : a[k] ? 'hit' : 'miss') : k === i ? 'now' : ''}"></i>`).join('');
    const btns = step.input === 'strokes'
      ? [1, 2, 3, 4, 5].map((n) => `<button class="gp-b ${n <= (step.par || 2) ? 'good' : ''}" data-gp="${n}">${n === 5 ? '5+' : n}</button>`).join('')
      : `<button class="gp-b miss" data-gp="0">Miss</button><button class="gp-b hit" data-gp="1">${/holed|Holed/.test(step.sub) ? 'Holed' : 'Hit'}</button>`;
    const tgt = inf.target !== undefined && inf.target !== null ? `Target ${sc(inf.target)}${lower ? ' or fewer' : '+'} · a ${inf.skill_h}-handicapper` : '';
    return `<div class="card gp" id="gpRoot"><div class="gp-top"><button class="btn sec sm" data-gpquit>Quit</button><b>${esc(g.name)}</b><span class="small muted">~${G.minutesFor(g.id)} min</span></div>
      <div class="gp-dots">${dots}</div>
      ${pr ? '<div class="gp-pressure">Pressure shot: it counts double</div>' : ''}
      <div class="gp-main"><div class="gp-prompt">${esc(step.prompt)}</div><div class="gp-sub">${esc(step.sub || '')}</div></div>
      <div class="gp-btns ${step.input === 'strokes' ? 'five' : 'two'}">${btns}</div>
      <div class="gp-foot"><button class="btn sec" data-gpundo ${i ? '' : 'disabled'}>Undo</button><div><b>Score ${sc(sc0.score)}</b>${g.max && !G.isOpen(g.id) ? ` <span class="muted">after ${i} of ${list.length}</span>` : ''}<div class="small muted">${esc(tgt)}</div></div></div></div>`;
  }
  function sesButtons(g) {
    const r = run();
    if (r && c.ui.game_result?.session_id === r.id) { const last = r.i + 1 >= r.queue.length, nx = gameOf(r.queue[r.i + 1]);
      return `<p class="small muted" style="margin:0 0 6px">Session: game ${r.i + 1} of ${r.queue.length}</p><div class="row">${last ? '<button class="btn" data-gpsesend>Finish session</button>' : `<button class="btn" data-gpsesnext>Next: ${esc(nx?.name || '')}</button>`}</div>`; }
    return `<div class="row"><button class="btn" data-gpagain="${esc(g.id)}">Play again</button><button class="btn sec" data-gpnext="${esc(g.id)}">Next game</button><button class="btn sec" data-gpdone>Done</button></div>`;
  }
  function resultScreen() {
    const r = (J().results || []).find((x) => x.id === c.ui.game_result?.id), info0 = c.ui.game_result;
    if (!r) { c.ui.game_result = null; return ''; }
    const g = gameOf(r.game), u = unitM(), t = G.tierFor(g, r.score, u), inf = info(g.id), lv = c.compete.lvl(g.id, r.score);
    const list = G.steps(g, { seed: r.seed, unitM: u }) || [], pr = r.pressure ? G.pressureOf(g, list, r.detail || []) : null;
    const lower = g.better === 'lower', beat = inf.target !== undefined && inf.target !== null ? (lower ? r.score <= inf.target : r.score >= inf.target) : null;
    const led = inf.ledger, hitsNow = led ? led.hits : null, potNow = inf.potential;
    let credit = '';
    if (led && beat) credit = `That's hit ${Math.min(hitsNow, led.need)} of ${led.need} for ${esc(led.title)}. ${potNow !== null && info0.pot_before !== null ? `Potential now ${fmt(potNow, 1)}${Math.abs(potNow - info0.pot_before) >= 0.05 ? ` (was ${fmt(info0.pot_before, 1)})` : ''}.` : ''}`;
    else if (led) credit = `Not a hit yet. Aim for ${sc(inf.target)}${lower ? ' or fewer' : '+'} to count towards ${esc(led.title)} (${Math.min(hitsNow, led.need)} of ${led.need} so far).`;
    else if (inf.skill) credit = 'This game is not one of your two focus areas right now, so it does not move your potential.';
    const nextT = t?.next ? `Next: <b>${t.next.name}</b> at ${sc(t.next.score)}${lower ? ' or fewer' : '+'}` : t?.tier ? 'Top tier reached' : '';
    const fresh = info0.up ? `<div class="gp-up">New tier: ${esc(t.tier.name)}</div>` : '';
    return `<div class="card gp-res" id="gpRoot"><h2>${esc(g.name)}</h2>${fresh}
      <div class="gp-score"><b>${sc(r.score)}</b>${g.max ? `<span> / ${g.max}</span>` : ''} ${tierChip(t?.tier)}</div>
      ${lv ? `<p class="small" style="margin:0 0 6px">Handicap level: <b>${esc(lv.label)}</b>${info0.prev_best !== null && info0.prev_best !== undefined ? ` · your best before was ${sc(info0.prev_best)}` : ''}</p>` : ''}
      ${nextT ? `<p class="small" style="margin:0 0 6px">${nextT}</p>` : ''}
      ${beat !== null ? `<p class="small" style="margin:0 0 6px">${beat ? '✓ You beat' : 'Beat'} the ${inf.skill_h}-handicapper: ${sc(inf.target)}${lower ? ' or fewer' : '+'}.</p>` : ''}
      ${pr ? `<p class="small" style="margin:0 0 6px">${esc(pr.label)}.${pr.hit ? ' Counts as 1.5 hits.' : ''}</p>` : ''}
      ${credit ? `<p class="small" style="margin:0 0 8px">${credit}</p>` : ''}
      ${sesButtons(g)}</div>`;
  }
  // the launcher at the top of the Games tab: tier ladder, pressure toggle and a Play button
  function launcher(g) {
    const u = unitM(), ts = G.tierScores(g, u), best = G.bestScore(g, J().results || []), cur = best !== null ? G.tierFor(g, best, u) : null, inf = info(g.id);
    const ladder = ts ? `<div class="tiers">${ts.map((t) => `<span class="tier ${t.key} ${cur?.tier && G.TIERS.findIndex((x) => x.key === cur.tier.key) >= G.TIERS.findIndex((x) => x.key === t.key) ? 'on' : ''}">${t.name} <b>${sc(t.score)}</b></span>`).join('')}</div>
      <p class="small muted" style="margin:4px 0 8px">Tiers: the score of a 20, 10, 5 and 0 handicapper.${cur?.next ? ` Next tier: ${cur.next.name} at ${sc(cur.next.score)}.` : ''}</p>` : '';
    const beat = inf.target !== undefined && inf.target !== null ? `<p class="small" style="margin:0 0 8px">Beat the ${inf.skill_h}-handicapper: <b>${sc(inf.target)}${g.better === 'lower' ? ' or fewer' : '+'}</b> (${esc(inf.sub)}).</p>` : '';
    if (!canGuide(g.id)) return '';
    return `${ladder}${beat}<label class="f" style="display:flex;gap:8px;align-items:center;margin:4px 0 10px"><input type="checkbox" id="gpPressure" style="width:22px;height:22px;flex:0 0 auto"> <span>Pressure finish: the last ${g.id === 'putt-streak' ? 'putt ends it' : 'step counts double'}</span></label>
      <p style="margin:0 0 6px"><button class="btn" data-gpstart="${esc(g.id)}">Play guided · ~${G.minutesFor(g.id)} min</button></p>`;
  }
  const screen = () => (draft() ? playScreen() : c.ui.game_result ? resultScreen() : c.ui.session_summary ? summaryScreen() : '');
  function render() { const e = $('#gpRoot'); if (!e) { c.rerender(); return; } const html = draft() ? playScreen() : c.ui.game_result ? resultScreen() : summaryScreen(); e.outerHTML = html; wire(); }


  // ------------------------------------------------------------ the daily challenge
  const focusGames = () => { const v = c.progress.data(); return v.sk.skills.filter((s) => (v.sk.focus || []).includes(s.key)).flatMap((s) => s.subs.flatMap((x) => x.games.map((g) => g.id))); };
  function dailyPick() {
    const d = today(); if (J().daily_pick?.date === d) return J().daily_pick;
    const pick = { date: d, ...SS.dailyChallenge(d, { focusGames: focusGames(), pool: B.CHALLENGE_POOL }) }; J().daily_pick = pick; return pick;
  }
  function afterResult(res) {
    const d = today(), pick = dailyPick(); J().daily = J().daily || {};
    if (res.date === d && res.game === pick.game && !J().daily[d]) { res.challenge = 'daily'; J().daily[d] = res.id; }
    if (res.session_id && run() && run().id === res.session_id) run().results.push(res.id);
  }
  function dailyCard(where = 'games') {
    if (!c.DS.rounds.length && !(J().results || []).length) return '';
    const d = today(), pick = dailyPick(), g = gameOf(pick.game); if (!g) return '';
    const done = !!(J().daily || {})[d], streak = SS.dailyStreak(J().daily || {}, d), inf = info(g.id), lower = g.better === 'lower';
    return `<div class="card gp-daily" data-daily="${esc(g.id)}"><div class="rv-h"><h2 style="margin:0">Today's challenge</h2><span class="small muted">${streak ? `${streak}-day streak` : 'no streak yet'}</span></div>
      <p style="margin:6px 0 4px"><b>${esc(g.name)}</b>${pick.focus ? ' <span class="tag">focus area</span>' : ''}</p>
      <p class="small muted" style="margin:0 0 8px">${inf.target !== undefined && inf.target !== null ? `Target ${sc(inf.target)}${lower ? ' or fewer' : '+'} · ` : ''}about ${G.minutesFor(g.id)} min${done ? ' · done today ✓' : ''}</p>
      ${done ? '' : `<button class="btn" data-gpdaily="${esc(g.id)}">Play today's challenge</button>`}</div>`;
  }
  function homeCard() {
    if (!c.DS.rounds.length && !(J().results || []).length) return '';
    return dailyCard('home');
  }

  // ------------------------------------------------------------ sessions: 30, 45 or 60 minutes of back-to-back guided games
  const sessionPlan = (m) => SS.buildSession({ minutes: m, ratings: c.progress.data().sk, results: J().results || [], today: today(), pool: B.CHALLENGE_POOL });
  function sessionCard() {
    if (!c.DS.rounds.length && !(J().results || []).length) return '';
    return `<div class="card"><h2>Build my session</h2><p class="small muted" style="margin:0 0 8px">Games for your two focus areas, weakest first, played back to back.</p>
      <div class="gp-ses">${[30, 45, 60].map((m) => { const p = sessionPlan(m); return `<button class="btn sec" data-gpses="${m}"><b>${m} min</b><small>${p.games.length} games · ${esc(p.games.map((x) => x.name).join(', '))}</small></button>`; }).join('')}</div></div>`;
  }
  async function startSession(minutes) {
    const plan = sessionPlan(minutes); if (!plan.games.length) return; const id = `ses${Date.now()}`;
    J().session_run = { id, minutes, queue: plan.games.map((g) => g.id), i: 0, results: [], started: new Date().toISOString(), total: plan.total, skill: plan.games[0].skill };
    await start(plan.games[0].id, { session_id: id });
  }
  async function sesNext() { const r = run(); if (!r) return; r.i++; await start(r.queue[r.i], { session_id: r.id }); }
  async function endSession(quiet) {
    const r = run(); if (!r) return; const rs = (J().results || []).filter((x) => r.results.includes(x.id)); J().session_run = null;
    if (rs.length) {
      J().sessions.push({ id: r.id, date: today(), minutes: r.total, focus: SS.SESSION_SKILL_FOCUS[r.skill] || 'other', notes: `Guided session: ${rs.map((x) => gameOf(x.game)?.name).join(', ')}`, guided: true, results: r.results });
      if (!quiet) c.ui.session_summary = r.id;
    }
    c.ui.game_result = null; c.saveUi(); await save(); if (!quiet) { c.rerender(); scrollTo(0, 0); }
  }
  function summaryScreen() {
    const ses = (J().sessions || []).find((x) => x.id === c.ui.session_summary); if (!ses) { c.ui.session_summary = null; return ''; }
    const v = c.progress.data(), rs = (ses.results || []).map((id) => (J().results || []).find((x) => x.id === id)).filter(Boolean);
    const rows = rs.map((r) => { const g = gameOf(r.game), t = G.tierFor(g, r.score, unitM()), inf = info(g.id), lower = g.better === 'lower', hit = inf.target !== undefined && inf.target !== null && (lower ? r.score <= inf.target : r.score >= inf.target);
      return `<div class="gp-sumrow"><div><b>${esc(g.name)}</b><div class="small muted">${hit ? '✓ hit the target' : inf.target != null ? `target ${sc(inf.target)}${lower ? ' or fewer' : '+'}` : ''}</div></div><div class="gp-sumscore"><b>${sc(r.score)}</b>${tierChip(t?.tier)}</div></div>`; }).join('');
    const hits = rs.filter((r) => { const g = gameOf(r.game), inf = info(g.id); return inf.target != null && (g.better === 'lower' ? r.score <= inf.target : r.score >= inf.target); }).length;
    return `<div class="card gp-res" id="gpRoot"><h2>Session done</h2><p class="small muted" style="margin:0 0 8px">${rs.length} games · about ${ses.minutes} min</p>${rows}
      <p class="small" style="margin:10px 0 4px">${hits} of ${rs.length} targets hit.${v.fc.ok ? ` Potential now <b>${fmt(v.fc.potential, 1)}</b> (now ${fmt(v.fc.current, 1)}).` : ''}</p>
      <p class="small" style="margin:0 0 8px">Practice streak: <b>${v.st.current} week${v.st.current === 1 ? '' : 's'}</b>.</p>
      <button class="btn" data-gpdone>Done</button></div>`;
  }

  function nextGame(id) {
    const v = c.progress.data(), g0 = v.plan.ledger.map((x) => x.game).filter((x) => x !== id && canGuide(x));
    if (g0.length) return g0[0];
    const ids = F.DEFAULT_GAMES.filter((g) => canGuide(g.id)).map((g) => g.id), i = ids.indexOf(id); return ids[(i + 1) % ids.length];
  }
  function wire() {
    $$('[data-gp]').forEach((b) => b.addEventListener('click', () => answer(Number(b.dataset.gp)), { once: true }));
    $('[data-gpundo]')?.addEventListener('click', undo); $('[data-gpquit]')?.addEventListener('click', quit);
    $$('[data-gpstart]').forEach((b) => b.addEventListener('click', () => start(b.dataset.gpstart, { pressure: !!$('#gpPressure')?.checked })));
    $$('[data-gpagain]').forEach((b) => b.addEventListener('click', () => start(b.dataset.gpagain)));
    $$('[data-gpnext]').forEach((b) => b.addEventListener('click', () => start(nextGame(b.dataset.gpnext))));
    $$('[data-gpdone]').forEach((b) => b.addEventListener('click', () => { c.ui.game_result = null; c.ui.session_summary = null; c.saveUi(); c.rerender(); }));
    $$('[data-gpses]').forEach((b) => b.addEventListener('click', () => startSession(Number(b.dataset.gpses))));
    $$('[data-gpdaily]').forEach((b) => b.addEventListener('click', () => start(b.dataset.gpdaily)));
    $$('[data-gpsesnext]').forEach((b) => b.addEventListener('click', sesNext)); $$('[data-gpsesend]').forEach((b) => b.addEventListener('click', () => endSession(false)));
  }
  return { start, screen, launcher, wire, draft, info, canGuide, nextGame, sessionCard, dailyCard, homeCard, dailyPick, startSession, afterResult };
}
