// Guided practice play: one step per screen, big thumb buttons, draft saved after every step, result screen with tier and potential credit.
import * as B from './bench.js';
import * as F from './features.js';
import * as G from './games.js';

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
  const draft = () => J().game_draft || null;
  async function answer(v) {
    const d = draft(); if (!d) return; const g = gameOf(d.game), list = G.steps(g, { seed: d.seed, unitM: d.unitM }), sc0 = G.scoreOf(g, list, d.answers);
    if (sc0.done) return; d.answers.push(v); await save();
    if (G.scoreOf(g, list, d.answers).done) return finish(); render();
  }
  async function undo() { const d = draft(); if (!d || !d.answers.length) return; d.answers.pop(); await save(); render(); }
  async function quit() { if (!confirm('Stop this game? Nothing is saved.')) return; J().game_draft = null; await save(); c.rerender(); }
  async function finish() {
    const d = draft(), g = gameOf(d.game); const before = G.bestScore(g, J().results || []), v0 = c.progress.data(), led0 = v0.plan.ledger.find((x) => x.game === g.id);
    const res = G.resultFromDraft(d, g, { date: today() }); J().results.push(res); J().game_draft = null;
    const up = G.tierUp(g, before, res.score, unitM());
    c.ui.game_result = { id: res.id, prev_best: before, pot_before: v0.fc.ok ? v0.fc.potential : null, hits_before: led0 ? led0.hits : null, up: up?.key || null, session_id: res.session_id || null };
    c.saveUi(); await save(); c.compete.onScore(res); if (c.guided?.afterResult) c.guided.afterResult(res);
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
      <div class="row"><button class="btn" data-gpagain="${esc(g.id)}">Play again</button><button class="btn sec" data-gpnext="${esc(g.id)}">Next game</button><button class="btn sec" data-gpdone>Done</button></div></div>`;
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
  const screen = () => (draft() ? playScreen() : c.ui.game_result ? resultScreen() : '');
  function render() { const e = $('#gpRoot'); if (!e) { c.rerender(); return; } const html = draft() ? playScreen() : resultScreen(); e.outerHTML = html; wire(); }

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
    $$('[data-gpdone]').forEach((b) => b.addEventListener('click', () => { c.ui.game_result = null; c.saveUi(); c.rerender(); }));
  }
  return { start, screen, launcher, wire, draft, info, canGuide, nextGame };
}
