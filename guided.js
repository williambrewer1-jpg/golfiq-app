// Guided practice play: one step per screen, big thumb buttons, draft saved after every step, result screen with tier and potential credit.
import * as B from './bench.js';
import * as F from './features.js';
import * as G from './games.js';
import * as SS from './sessions.js';
import * as ST from './skillstest.js';
import * as LG from './league.js';
import * as FEEL from './feel.js';
import * as LV from './level.js';
import { icon, shotArt } from './icons.js';

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
  // the speaker toggle on the game screen: switches sound for every game, saved with the Settings switch. The icon and the label both show the state.
  const soundBtn = () => { const on = FEEL.get().sound, t = on ? FEEL.COPY.sound.on : FEEL.COPY.sound.off; return `<button type="button" class="gp-snd" id="gpSound" data-gpsound aria-pressed="${on}" aria-label="${t}" title="${t}">${icon(on ? 'sound' : 'soundoff', 22)}</button>`; };
  async function toggleSound() {
    const st = c.state.settings, on = !FEEL.get().sound;
    st.feel = { ...FEEL.read(st), sound: on }; FEEL.init(st); await c.S.saveSettings(c.state, 'set_feel', null, { feel: st.feel });
    if (on) { FEEL.unlock(); FEEL.play('tap'); }
    const b = $('#gpSound'); if (b) b.outerHTML = soundBtn(); $('#gpSound')?.addEventListener('click', toggleSound);
  }
  // audio can only start after a tap: wake it on the first tap of any game button (and again later if the phone suspended it)
  document.addEventListener('click', (e) => { if (e.target.closest?.('#gpRoot button, #gpRoot input, [data-gpstart], [data-gpagain], [data-gpnext], [data-gpses], [data-gpdaily], [data-gpwelcome], [data-gptest]')) FEEL.unlock(); }, true);

  // what the golfer is aiming at in this game: the target for the skill's next handicap step, and where the plan stands
  function info(id) {
    const v = c.progress.data(); let hit = null;
    for (const s of v.sk.skills) for (const sub of s.subs) { const g = sub.games.find((x) => x.id === id); if (g && !hit) hit = { target: g.target, skill: s.title, skill_h: s.target, sub: sub.title, full_key: sub.full_key }; }
    const led = v.plan.ledger.find((x) => x.game === id) || null;
    return { ...(hit || {}), ledger: led, potential: v.fc.ok ? v.fc.potential : null };
  }
  // a welcome-back game is played against the golfer's own median, which the draft carries (retention plan 5.2)
  const withTarget = (d, inf) => (d?.welcome_back && Number.isFinite(d.target) ? { ...inf, target: d.target } : inf);
  const tierChip = (t) => (t ? `<span class="tier ${t.key}">${esc(t.name)}</span>` : '');

  // ------------------------------------------------------------ starting, stepping, finishing
  async function start(id, opts = {}) {
    seq++; busy = false; view.banner = null; timers.forEach(clearTimeout); timers = [];
    const g = gameOf(id); if (!g || !canGuide(id)) { c.ui.pr_tab = 'games'; c.ui.pg_game = id; c.saveUi(); c.rerender(); return; }
    J().game_draft = G.newDraft(g, { unitM: unitM(), pressure: !!opts.pressure, session_id: opts.session_id || null, ghost: opts.ghost || null, seed: opts.ghost?.seed, adj: c.state.settings?.range_ball_adj, welcome_back: !!opts.welcome_back, target: opts.target });
    c.ui.pr_tab = 'games'; c.ui.pg_game = id; c.ui.game_result = null; c.saveUi(); await save();
    if (location.hash !== '#practice') location.hash = '#practice'; else c.rerender();
    scrollTo(0, 0);
  }
  const draft = () => J().game_draft || null, draft0 = draft, run = () => J().session_run || null;

  // ------------------------------------------------------------ one tap: record it at once, answer back on screen, then move on
  // The answer is saved the moment the button is pressed. Only the screen waits (FEEL.feedbackMs, about 450 ms) so the verdict can be read; taps in that
  // window are ignored, so a double tap can never answer two balls.
  let busy = false, seq = 0, timers = [], posting = null;     // posting: the score being shared with the group, so the league chip waits for it
  const view = { banner: null };                                                 // the mid-game banner, kept across the re-render so it does not restart
  const later = (ms, f) => { const t = seq; timers.push(setTimeout(() => { if (t === seq) f(); }, ms)); };
  const word = (key) => FEEL.COPY.verdict[key] || key;
  const artFor = (g, step) => ({ 'putt-lag': 'lag', 'chip-updown': 'chip', 'chip-par18': 'chip', 'chip-zone': 'zone', 'range-greens': 'target', 'range-wedge': 'target', 'range-fairways': 'fairway', 'range-driver': 'drive', 'range-speed': 'long' })[g.id]
    || (g.id === 'range-round' ? (/tee shot/i.test(step.prompt) ? 'fairway' : 'target') : 'putt');
  const barOf = (g, list, answers, score, inf) => (G.isOpen(g.id) ? Math.min(1, score / (Number.isFinite(inf.target) && inf.target > 0 ? inf.target : 10)) : Math.min(1, answers.length / list.length));
  const scoreText = (g, v, i) => (G.isDistance(g) && !i ? '–' : sc(v));
  // if anything goes wrong while the tap is being saved, the screen must not stay locked
  async function answer(v, ball, btn) { if (busy) return; try { await answerNow(v, ball, btn); } catch (e) { busy = false; $('#gpRoot')?.removeAttribute('data-busy'); $('#gpSheet')?.classList.remove('gp-locked'); throw e; } }
  async function answerNow(v, ball, btn) {
    busy = true; const tap0 = Date.now();
    const d = draft(); if (!d) return; const g = gameOf(d.game), list = G.steps(g, { seed: d.seed, unitM: d.unitM }), sc0 = G.scoreOf(g, list, d.answers);
    if (sc0.done) return;
    const k = d.answers.length, step = list[k], inf = withTarget(d, info(g.id));
    d.answers.push(v); if (ball) (d.balls = d.balls || []).push(ball);
    const sc1 = G.scoreOf(g, list, d.answers), out = G.outcomeOf(g, step, v, { ball, before: d.answers.slice(0, k) });
    const streak = G.streakOf(g, list, d.answers, d.balls), passed = G.targetPassed(g, list, d.answers, d.balls, inf.target), mile = out.good === true && G.STREAK_MILESTONES.includes(streak), ms = FEEL.feedbackMs();
    // sound: a soft click, then the verdict; a milestone sound lands just after the verdict, and the light "step" tick comes when the next step arrives
    FEEL.play('tap'); if (out.good === true) FEEL.play('good'); else if (out.good === false) FEEL.play('miss');
    const moment = passed ? () => FEEL.play('target') : mile ? () => FEEL.play('streak', { level: FEEL.streakLevel(streak) }) : null;
    if (moment) later(330, moment);
    const text = passed ? FEEL.COPY.reachedTarget : mile ? FEEL.COPY.streak(streak) : '';
    if (text) view.banner = { text, t0: Date.now() };
    feedbackDom({ k, out, sc0, sc1, streak, mile, passed, text, btn, g, list, d, inf });
    if (sc1.done) { await save(); return finish({ delay: Math.max(0, ms - (Date.now() - tap0)) }); }     // the wait counts from the tap, not from the end of the saves
    later(Math.max(0, ms - 220), () => FEEL.pulse($('#gpMain'), 'slide-out'));
    later(ms, () => { busy = false; if (!draft()) return; if (!moment) FEEL.play('step'); render(); FEEL.pulse($('#gpMain'), 'slide-next'); });
    await save();
  }
  // everything the golfer sees change at the moment of the tap, done in place on the screen that is already up
  function feedbackDom({ k, out, sc0, sc1, streak, mile, text, btn, g, list, d, inf }) {
    const root = $('#gpRoot'); if (!root) return;
    $('#gpSheet')?.classList.add('gp-locked'); root.setAttribute('data-busy', '1');
    if (btn) FEEL.pulse(btn, out.good === false ? 'shake' : 'pop');
    const dots = $$('#gpRoot .gp-dots i'); if (dots[k]) dots[k].className = out.good === true ? 'hit' : out.good === false ? 'miss' : 'done'; if (dots[k + 1]) dots[k + 1].className = 'now';
    const ve = $('#gpVerdict');
    if (ve) { ve.className = `gp-verdict ${out.good === true ? 'good' : out.good === false ? 'miss' : ''}`; ve.innerHTML = `<span>${out.good === true ? '<i class="gp-ball"></i>' : ''}${out.good === true ? icon('tick', 22) : out.good === false ? icon('cross', 22) : ''}${esc(word(out.key))}</span>`; FEEL.pulse(ve, 'rise'); const ball = ve.querySelector('.gp-ball'); if (ball) FEEL.pulse(ball, 'drop'); }
    $('#gpBar')?.style.setProperty('--p', String(barOf(g, list, d.answers, sc1.score, inf)));
    $('#gpBar')?.parentElement?.setAttribute('aria-valuenow', String(Math.round(barOf(g, list, d.answers, sc1.score, inf) * 100)));
    const se = $('#gpScore'); if (se) { const from = G.isDistance(g) && !k ? sc1.score : sc0.score; FEEL.countUp(se, from, sc1.score, 300, (v) => sc(Math.round(v * 10) / 10)); }
    const sl = $('#gpScoreLbl'); if (sl) sl.textContent = scoreLabel(g, d.answers.length, list.length);
    const st = $('#gpStreak'); if (st) { st.hidden = streak < 2; const n = st.querySelector('b'); if (n) n.textContent = String(streak); if (mile) FEEL.pulse(st, 'flame'); }
    const bn = $('#gpBanner'); if (bn && text) { bn.hidden = true; bn.textContent = text; bn.style.animationDelay = ''; void bn.offsetWidth; bn.hidden = false; }
  }
  const scoreLabel = (g, i, n) => `${G.isDistance(g) ? `${g.id === 'range-speed' ? 'Longest' : 'Average'} ${c.UNIT}` : 'Score'}${(g.max || G.isDistance(g)) && !G.isOpen(g.id) ? ` · after ${i} of ${n}` : ''}`;
  async function undo() { if (busy) return; const d = draft(); if (!d || !d.answers.length) return; FEEL.play('tap'); d.answers.pop(); d.balls?.pop(); view.banner = null; await save(); render(); }
  // Driver test / Max out: the distance the golfer set (slider or typed), plus where it finished, becomes one ball
  const distLimits = (d, g) => { const start = distStart(d, g), step = B.DRIVER_TEST.step; return { min: Math.max(step, Math.round(start * 0.5 / step) * step), max: Math.round(start * 1.5 / step) * step, start }; };
  function distStart(d, g) {                                     // where the slider opens: the last ball, else the usual driver distance, else the table value for a mid handicap
    const last = (d.balls || []).slice(-1)[0]; if (last) return Math.round(last.d);
    const sub = c.progress.data().sk.skills.find((s) => s.key === 'driving')?.subs.find((x) => x.key === 'distance');
    const usual = sub && Number.isFinite(sub.you) ? sub.you : B.driverYd(15) * 0.9144 / d.unitM;
    return Math.round(usual / B.DRIVER_TEST.step) * B.DRIVER_TEST.step;
  }
  async function answerBall(result, btn) {
    if (busy) return; const d = draft(); if (!d) return; const g = gameOf(d.game), inp = $('#gpDtype'), sl = $('#gpDist');
    const typed = inp && inp.value !== '' ? Number(inp.value) : NaN, dist = Number.isFinite(typed) && typed > 0 ? typed : Number(sl?.value);
    if (!Number.isFinite(dist) || dist <= 0) { c.toast('Enter how far it went'); render(); return; }
    const ball = { d: Math.round(dist), r: result, a: d.premium ? 0 : d.adj || 0 };
    await answer(G.ballValue(ball, d.unitM), ball, btn);
  }
  async function quit() { if (busy) return; if (!confirm(run() ? 'Stop this session? Games you finished are kept.' : 'Stop this game? Nothing is saved.')) return; seq++; timers.forEach(clearTimeout); timers = []; J().game_draft = null; if (draft0()?.session_id || run()) endSession(true); await save(); c.rerender(); }
  // a saved result's tier: benchmark games use the handicap table, own-history games judge it against the scores before it
  const tierOf = (g, r) => (G.isOwn(g) ? G.tierFor(g, r.score, unitM(), G.scoresBefore(g, J().results || [], r.id)) : G.tierFor(g, r.score, unitM()));
  async function finish(opts = {}) {
    const d = draft(), g = gameOf(d.game); const before = G.bestScore(g, J().results || []), v0 = c.progress.data(), led0 = v0.plan.ledger.find((x) => x.game === g.id), inf0 = info(g.id);
    const res = G.resultFromDraft(d, g, { date: today() }); afterResult(res); J().results.push(res); J().game_draft = null;
    const up = G.isOwn(g) ? G.ownTierUp(g, J().results, res.id) : G.tierUp(g, before, res.score, unitM());
    c.ui.game_result = { id: res.id, prev_best: before, target_before: Number.isFinite(d.target) ? d.target : Number.isFinite(inf0.target) ? inf0.target : null, level_before: Number.isFinite(inf0.skill_h) ? inf0.skill_h : null, streak_before: v0.st ? v0.st.current : null, pot_before: v0.fc.ok ? v0.fc.potential : null, hits_before: led0 ? led0.hits : null, up: up?.key || null, session_id: res.session_id || null, ghost: d.ghost ? { nick: d.ghost.nick, score: d.ghost.score, ...LG.finalCompare(g, res.score, d.ghost.score) } : null };
    c.saveUi(); await save(); posting = { id: res.id, p: c.compete.onScore(res) };
    // the result is already saved; with a delay only the screen waits, so the last verdict can be read before the result appears
    const show = () => { busy = false; c.toast(up ? `${up.name} tier reached – ${g.name}` : `Saved: ${sc(res.score)}`); c.rerender(); scrollTo(0, 0); };
    if (opts.delay > 0) later(opts.delay, show); else show();
  }

  // ------------------------------------------------------------ screens
  function playScreen() {
    const d = draft(), g = gameOf(d.game), list = G.steps(g, { seed: d.seed, unitM: d.unitM }), a = d.answers, sc0 = G.scoreOf(g, list, a), i = a.length, step = list[Math.min(i, list.length - 1)];
    const inf = withTarget(d, info(g.id)), lower = g.better === 'lower', open = G.isOpen(g.id), last = i === list.length - 1 && !open, pr = d.pressure && last;
    const isD = step.input === 'distance', bl = d.balls || [], un = d.unitM === 1 ? 'm' : 'yd';
    const outs = a.map((v, k) => G.outcomeOf(g, list[k], v, { ball: bl[k], before: a.slice(0, k) }));
    const dots = list.slice(0, open ? Math.max(10, i + 1) : list.length).map((s, k) => `<i class="${k < i ? (outs[k].good === true ? 'hit' : outs[k].good === false ? 'miss' : 'done') : k === i ? 'now' : ''}"></i>`).join('');
    let dist = '';
    if (isD) {
      const lim = distLimits(d, g);
      dist = `<div class="gp-dist"><div class="gp-dnum"><b id="gpDnum">${lim.start}</b> <span>${un}</span></div>
        <input type="range" id="gpDist" min="${lim.min}" max="${lim.max}" step="${B.DRIVER_TEST.step}" value="${lim.start}" aria-label="How far it went (${un})">
        <label class="f" for="gpDtype">Or type the exact number (launch monitor)</label><input type="number" id="gpDtype" inputmode="decimal" min="1" placeholder="${un}">
        ${d.adj > 0 ? `<label class="gp-prem"><input type="checkbox" id="gpPrem" ${d.premium ? 'checked' : ''}> <span>Premium ball: skip the ${d.adj}% range-ball adjustment</span></label>` : ''}</div>`;
    }
    const X = icon('cross', 22), T = icon('tick', 22);
    const btns = isD
      ? (step.results ? `<button class="gp-b hit" data-gpball="f">${T}<span>Fairway</span></button><button class="gp-b" data-gpball="m">${X}<span>Missed</span></button><button class="gp-b miss" data-gpball="w">${X}<span>Wide</span></button>` : `<button class="gp-b hit" data-gpball="f">Save ball</button>`)
      : step.input === 'strokes'
      ? [1, 2, 3, 4, 5].map((n) => `<button class="gp-b ${n <= (step.par || 2) ? 'good' : ''}" data-gp="${n}">${n === 5 ? '5+' : n}</button>`).join('')
      : `<button class="gp-b miss" data-gp="0">${X}<span>Miss</span></button><button class="gp-b hit" data-gp="1">${T}<span>${/holed|Holed/.test(step.sub) ? 'Holed' : 'Hit'}</span></button>`;
    const gh = d.ghost && i > 0 ? LG.compareAt(g, a, d.ghost.detail, i) : null;
    const ghostLine = d.ghost ? `<div class="gp-ghost ${gh ? gh.state : 'level'}">${esc(d.ghost.nick)}${gh ? ` had ${sc(gh.ghost)} after ${i} · ${gh.state === 'level' ? 'you are level' : `you are ${gh.state} by ${sc(Math.abs(gh.diff))}`}` : `'s ${sc(d.ghost.score)} to beat`}</div>` : '';
    const tgt = d.welcome_back && Number.isFinite(d.target) ? FEEL.COPY.welcome.target(sc(d.target)) : inf.target !== undefined && inf.target !== null ? FEEL.COPY.target(sc(inf.target), inf.skill_h, lower) : '';
    const streak = G.streakOf(g, list, a, bl), prog = barOf(g, list, a, sc0.score, inf), ban = view.banner && Date.now() - view.banner.t0 < 1450 ? view.banner : null;
    return `<div class="gp gp-full${pr ? ' gp-pr' : ''}" id="gpRoot"${busy ? ' data-busy="1"' : ''}>
      <div class="gp-top"><button type="button" class="gp-x" data-gpquit aria-label="Close game" title="Close">${icon('cross', 22)}</button>
        <div class="gp-bar" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(prog * 100)}"><i id="gpBar" class="fx-fill" style="--p:${prog}"></i></div>${soundBtn()}</div>
      <div class="gp-strip"><div class="gp-sc"><div class="gp-name">${esc(g.name)}</div><b id="gpScore">${scoreText(g, sc0.score, i)}</b><span id="gpScoreLbl">${scoreLabel(g, i, list.length)}</span></div>
        <div class="gp-side"><span class="gp-streak" id="gpStreak" ${streak >= 2 ? '' : 'hidden'}>${icon('flame', 18)}<b>${streak}</b></span><span class="gp-tgt">${esc(tgt)}</span></div>
        <div class="gp-banner" id="gpBanner" ${ban ? `style="animation-delay:-${Date.now() - ban.t0}ms"` : 'hidden'}>${ban ? esc(ban.text) : ''}</div></div>
      <div class="gp-dots">${dots}</div>
      ${ghostLine}${pr ? `<div class="gp-pressure">${esc(G.pressureBanner(g))}</div>` : ''}
      <div class="gp-main" id="gpMain"><div class="gp-art">${shotArt(artFor(g, step))}</div><div class="gp-prompt">${esc(step.prompt)}</div><div class="gp-sub">${esc(step.sub || '')}</div><div class="gp-verdict" id="gpVerdict" aria-live="polite"></div></div>
      <div class="gp-sheet${busy ? ' gp-locked' : ''}" id="gpSheet">${dist}<div class="gp-btns ${isD ? (step.results ? 'three' : 'one') : step.input === 'strokes' ? 'five' : 'two'}">${btns}</div>
        <div class="gp-foot"><button class="btn sec" data-gpundo ${i ? '' : 'disabled'}>Undo</button></div></div></div>`;
  }
  function sesButtons(g) {
    const r = run();
    if (r && c.ui.game_result?.session_id === r.id) { const last = r.i + 1 >= r.queue.length, nx = gameOf(r.queue[r.i + 1]);
      return `<p class="small muted" style="margin:0 0 6px">${r.kind === 'test' ? 'Skills test' : 'Session'}: game ${r.i + 1} of ${r.queue.length}</p><div class="row">${last ? `<button class="btn" data-gpsesend>${r.kind === 'test' ? 'Finish test' : 'Finish session'}</button>` : `<button class="btn" data-gpsesnext>Next: ${esc(nx?.name || '')}</button>`}</div>`; }
    return `<div class="row"><button class="btn" data-gpagain="${esc(g.id)}">Play again</button><button class="btn sec" data-gpnext="${esc(g.id)}">Next game</button><button class="btn sec" data-gpdone>Done</button></div>`;
  }
  // ---- the result screen: verdict, score counting up, tier badge, rewards, confetti, buttons (plan 5.2). Plain wording stays in feel.js COPY.
  const rnd1 = (n) => Math.round(n * 10) / 10;
  function leagueChip(L) {
    const K = FEEL.COPY.rewards;
    return L.full ? `<div class="l">${esc(K.leagueFull)}</div><div class="v">+0</div><div class="s">${esc(K.leagueFullNote)}</div>`
      : `<div class="l">League</div><div class="v">+${L.pts}</div><div class="s">${esc(K.leagueTotal(L.total, L.rank, L.n))}</div>`;
  }
  function resultScreen() {
    const info0 = c.ui.game_result, r = (J().results || []).find((x) => x.id === info0?.id);
    if (!r) { c.ui.game_result = null; return ''; }
    const K = FEEL.COPY, g = gameOf(r.game), u = unitM(), t = tierOf(g, r), inf = info(g.id), lv = c.compete.lvl(g.id, r.score);
    const list = G.steps(g, { seed: r.seed, unitM: u }) || [], pr = r.pressure ? G.pressureOf(g, list, r.detail || [], r.balls) : null, un = u === 1 ? 'm' : 'yd';
    const lower = g.better === 'lower', target = Number.isFinite(info0.target_before) ? info0.target_before : inf.target ?? null, verdict = G.verdictOf(g, r.score, { target, prevBest: info0.prev_best }), beat = target !== null ? verdict.met : null, lvT = Number.isFinite(info0.level_before) ? info0.level_before : inf.skill_h;
    const led = inf.ledger, potNow = inf.potential, anim = !info0.seen && FEEL.revealMs(100) > 0;
    // the potential counts hits against the skill target, so a welcome-back game (played against the golfer's own median) is judged on that target here
    const beatP = r.welcome_back ? (Number.isFinite(inf.target) ? (lower ? r.score <= inf.target : r.score >= inf.target) : null) : beat;
    const at = (cls, i) => `class="${cls}${anim ? ' fx-rise' : ''}"${anim ? ` style="--i:${i}"` : ''}`;
    const short = !verdict.met && verdict.diff > 0 ? (lower ? K.over(sc(verdict.diff)) : K.short(sc(verdict.diff))) : '';
    const vText = verdict.pb ? K.best : verdict.met ? K.met : short || K.done, vSub = verdict.pb ? (verdict.met ? K.met : short) : '';
    const own = G.isOwn(g);
    const nextT = t?.next ? `Next: <b>${t.next.name}</b> at ${sc(t.next.score)}${lower ? ' or fewer' : '+'}${own ? ` (${t.next.note})` : ''}` : t?.tier ? 'Top tier reached' : own ? `Tiers for this game come from your own scores, and start once you have ${G.OWN.min_scores}.` : '';
    const badge = t?.tier ? `<span class="gp-badge ${t.tier.key}${anim ? ' fx-stamp' : ''}" id="gpBadge"${anim ? ` style="--d:${FEEL.revealMs(900)}ms"` : ''}>${info0.up ? `New tier: ${esc(t.tier.name)}` : `${esc(t.tier.name)} tier`}</span>` : '';
    // rewards: practice streak, potential credit, league points
    const rw = []; let i = 5; const rwAt = (extra = '') => at(`gp-rw${extra}`, i++);
    const lvl = c.progress.data().lv, pts = LV.pointsFor(lvl, r.id), capped = pts === 0 && lvl.today >= LV.DAILY_CAP;
    if (pts > 0 || capped) rw.push(`<div ${rwAt(pts > 0 ? ' up' : '')} id="gpRPtsBox"><div class="l">${esc(K.rewards.points)}</div><div class="v"><span id="gpRPts" data-to="${pts}">+${pts}</span></div><div class="s">${esc(capped ? K.rewards.pointsFull : K.rewards.pointsNote(lvl.points, lvl.toNext, lvl.next?.name))}</div></div>`);
    const st = c.progress.data().st, stNow = st ? st.current : 0, stBefore = Number.isFinite(info0.streak_before) ? info0.streak_before : stNow;
    if (stNow >= 1) rw.push(`<div ${rwAt(stNow > stBefore ? ' up' : '')} id="gpRStreakBox"><div class="l">${esc(K.rewards.streak)}</div><div class="v">${icon('flame', 22)}<span id="gpRStreak" data-from="${stBefore}" data-to="${stNow}">${stNow}</span></div><div class="s">${K.rewards.weeks(stNow)} in a row</div></div>`);
    let potBefore = null, potTo = null, showNote = false;
    if (led) {
      const hits = rnd1(Math.min(led.hits, led.need)), moved = potNow !== null && Number.isFinite(info0.pot_before) && Math.abs(potNow - info0.pot_before) >= 0.05;
      if (moved) { potBefore = info0.pot_before; potTo = potNow; }
      showNote = potNow !== null && beatP === true;
      rw.push(`<div ${rwAt(beatP ? ' up' : '')}><div class="l">${esc(led.title)}</div><div class="v">${beatP ? K.rewards.hit(sc(hits), led.need) : K.rewards.of(sc(hits), led.need)}</div>
        <div class="s">${beatP ? (potNow === null ? '' : `${K.rewards.potential} ${moved ? `<s>${fmt(potBefore, 1)}</s> → ` : ''}<b id="gpRPot" data-from="${moved ? potBefore : potNow}" data-to="${potNow}">${fmt(potNow, 1)}</b>`) : K.rewards.noHit}</div></div>`);
    }
    if (c.compete.groupOn()) rw.push(`<div class="gp-rw" id="gpRLeague"${info0.league ? '' : ' hidden'}>${info0.league ? leagueChip(info0.league) : ''}</div>`);
    let credit = '';
    if (led && !beatP) credit = `Aim for ${sc(inf.target)}${lower ? ' or fewer' : '+'} to count towards ${esc(led.title)}.`;
    else if (!led && inf.skill && !r.welcome_back) credit = 'This game is not one of your two focus areas right now, so it does not move your potential.';
    const det = [
      g.id === 'range-driver' && r.balls ? `Average distance <b>${sc(r.avg_dist)} ${un}</b> · fairways <b>${r.fairways} of ${r.balls.length}</b> · wide <b>${r.wides}</b>. The score counts a miss as 20 yd less and a wide ball as half.` : '',
      g.id === 'range-speed' && r.balls ? `Your balls: ${r.balls.map((b) => sc(Math.round(G.adjusted(b) * 10) / 10)).join(' · ')} ${un}` : '',
      info0.prev_best !== null && info0.prev_best !== undefined && !verdict.pb ? `Your best before was ${sc(info0.prev_best)}.` : '',
      r.welcome_back && target !== null ? `${beat ? '✓ ' : ''}${K.welcome.beat(sc(target))}` : beat !== null ? `${beat ? '✓ You beat' : 'Beat'} the ${lvT}-handicapper: ${sc(target)}${lower ? ' or fewer' : '+'}.` : '',
      info0.ghost ? `<b>${info0.ghost.state === 'won' ? `You beat ${esc(info0.ghost.nick)}` : info0.ghost.state === 'lost' ? `${esc(info0.ghost.nick)} wins` : `Level with ${esc(info0.ghost.nick)}`}</b> · ${sc(r.score)} to ${sc(info0.ghost.score)}` : '',
      pr ? `${esc(pr.label)}.${pr.hit ? ' Counts as 1.5 hits.' : ''}` : '', credit,
    ].filter(Boolean).map((x) => `<p class="small" style="margin:0 0 6px">${x}</p>`).join('');
    return `<div class="card gp-res gp-rv" id="gpRoot" data-rid="${esc(r.id)}"${info0.seen ? '' : ' data-reveal="1"'}>
      <div class="gp-hero"><canvas class="gp-confetti" id="gpConf" aria-hidden="true"></canvas>
        <div ${at('gp-rname', 0)}>${esc(g.name)}</div>
        <div ${at(`gp-rverdict ${verdict.key}`, 1)} id="gpVerdictL">${esc(vText)}</div>${vSub ? `<div ${at('gp-rsub', 1)}>${esc(vSub)}</div>` : ''}${r.welcome_back ? `<div ${at('gp-rsub', 1)}>${esc(K.welcome.back)}</div>` : ''}
        <div ${at('gp-score', 2)}><b id="gpRNum" data-to="${r.score}">${sc(r.score)}</b>${g.max ? `<span> / ${g.max}</span>` : G.isDistance(g) ? `<span> ${un}</span>` : ''}</div>
        ${lv ? `<div ${at('gp-rlevel', 3)}>${esc(K.level(lv.h))}</div>` : ''}
        ${badge || nextT ? `<div class="gp-badgewrap">${badge}${nextT ? `<div ${at('gp-rnext', 4)}>${nextT}</div>` : ''}</div>` : ''}</div>
      <div class="gp-rbody">${rw.length ? `<div class="gp-rewards">${rw.join('')}</div>${showNote ? `<p class="gp-rwn">${esc(K.rewards.note)}</p>` : ''}` : ''}
        <div ${at('gp-rbtn', i)}>${sesButtons(g)}</div>
        ${det ? `<div class="gp-rdet">${det}</div>` : ''}</div></div>`;
  }
  // the reveal: the score counts up, then the badge lands with its sound and the confetti, then the rewards count. Everything waits on FEEL.revealMs, so a test can ask for the finished screen at once.
  function reveal() {
    const root = $('#gpRoot.gp-rv[data-reveal]'), info0 = c.ui.game_result; if (!root || !info0 || info0.seen) return;
    const r = (J().results || []).find((x) => x.id === info0.id); if (!r) return;
    info0.seen = true; root.removeAttribute('data-reveal'); c.saveUi();
    const g = gameOf(r.game), inf = info(g.id), ms = FEEL.revealMs, animated = ms(100) > 0, live = () => $('#gpRoot.gp-rv')?.dataset.rid === r.id, at = (t, f) => later(t, () => { if (live()) f(); });
    const verdict = G.verdictOf(g, r.score, { target: Number.isFinite(info0.target_before) ? info0.target_before : inf.target ?? null, prevBest: info0.prev_best }), cel = G.celebrationOf({ verdict, tierUp: !!info0.up });
    const num = $('#gpRNum'), to = r.score, nf = (v) => (Number.isInteger(to) ? String(Math.round(v)) : fmt(v, 1));
    const st = $('#gpRStreak'), pot = $('#gpRPot'), pts = $('#gpRPts');
    if (animated) { if (num) num.textContent = nf(0); if (pts) pts.textContent = '+0'; if (st) st.textContent = st.dataset.from; if (pot) pot.textContent = fmt(Number(pot.dataset.from), 1); }
    const pulse = (el, kind) => { el?.classList.remove('fx-rise'); FEEL.pulse(el, kind); };      // the rise has finished by now; one animation at a time
    at(ms(180), () => num && FEEL.countUp(num, 0, to, ms(700), nf));
    at(ms(900), () => {
      FEEL.play(cel.sound);
      if (cel.confetti) FEEL.confetti($('#gpConf'));
      if (pts && Number(pts.dataset.to) > 0) { FEEL.countUp(pts, 0, Number(pts.dataset.to), ms(700), (v) => `+${Math.round(v)}`); pulse($('#gpRPtsBox'), 'pop'); }
      if (cel.sound !== 'finish') pulse($('#gpVerdictL'), 'pop');
      if (st && Number(st.dataset.to) > Number(st.dataset.from)) { FEEL.countUp(st, Number(st.dataset.from), Number(st.dataset.to), ms(500)); pulse($('#gpRStreakBox'), 'flame'); }
      if (pot && Number(pot.dataset.to) < Number(pot.dataset.from)) FEEL.countUp(pot, Number(pot.dataset.from), Number(pot.dataset.to), ms(700), (v) => fmt(v, 1));
    });
    // a hit that lowers the potential target earns the unlock sound, once the number has come down
    if (pot && verdict.met && Number(pot.dataset.to) < Number(pot.dataset.from) - 0.049) at(ms(1700), () => FEEL.play('unlock'));
    at(ms(1800), () => { $('#gpRoot')?.setAttribute('data-revealed', '1'); });
  }
  // this week's league points for a shared score: only once the group has the score, so the number is never a guess
  async function loadLeague() {
    const info0 = c.ui.game_result; if (!info0 || info0.league !== undefined || !c.compete.groupOn() || !$('#gpRLeague')) return;
    info0.league = null;
    try {
      const r = (J().results || []).find((x) => x.id === info0.id); if (!r) return;
      if (posting && posting.id === info0.id) await posting.p;
      const rows = await c.compete.weekScores(B.isoWeek(new Date(`${r.date}T12:00:00`))), uid = c.compete.myUid(), mine = rows.filter((x) => x.uid === uid);
      const me = LG.league(rows).find((x) => x.uid === uid), shared = mine.some((x) => x.game === r.game && x.score === r.score && x.date === r.date);
      if (!me || !shared) return;
      const counted = mine.length <= LG.LEAGUE.cap, table = LG.league(rows);
      info0.league = { pts: counted ? LG.points({ hit: shareInfo(r).hit, pressure: !!r.pressure }) : 0, total: me.points, rank: me.rank, n: table.length, full: !counted };
    } catch { return; }
    const el = $('#gpRLeague'); if (el && c.ui.game_result === info0 && info0.league) { el.innerHTML = leagueChip(info0.league); el.hidden = false; FEEL.pulse(el, 'rise'); }
  }
  // the launcher at the top of the Games tab: tier ladder, pressure toggle and a Play button
  function launcher(g) {
    const u = unitM(), st = G.tierState(g, J().results || [], u), inf = info(g.id), rk = (t) => G.TIERS.findIndex((x) => x.key === t.key);
    const note = st.own ? 'Tiers come from your own scores: your median, your best quarter and a new personal best. They rise as you improve.' : 'Tiers: the score of a 20, 10, 5 and 0 handicapper.';
    const ladder = st.ladder ? `<div class="tiers">${st.ladder.map((t) => `<span class="tier ${t.key} ${st.tier && rk(st.tier) >= rk(t) ? 'on' : ''}">${t.name} <b>${sc(t.score)}</b></span>`).join('')}</div>
      <p class="small muted" style="margin:4px 0 8px">${note}${st.next ? ` Next tier: ${st.next.name} at ${sc(st.next.score)}.` : ''}</p>`
      : st.own ? `<p class="small muted" style="margin:4px 0 8px">Play ${st.need} more time${st.need === 1 ? '' : 's'} and BreakingPar will set your own tiers from your scores.</p>` : '';
    const beat = inf.target !== undefined && inf.target !== null ? `<p class="small" style="margin:0 0 8px">Beat the ${inf.skill_h}-handicapper: <b>${sc(inf.target)}${g.better === 'lower' ? ' or fewer' : '+'}</b> (${esc(inf.sub)}).</p>` : '';
    if (!canGuide(g.id)) return '';
    return `${ladder}${beat}<label class="f" style="display:flex;gap:8px;align-items:center;margin:4px 0 10px"><input type="checkbox" id="gpPressure" style="width:22px;height:22px;flex:0 0 auto"> <span>Pressure finish: ${esc(G.pressureRule(g))}</span></label>
      ${c.compete.groupOn() ? `<div id="gpGhost" data-ghostgame="${esc(g.id)}"></div>` : ''}
      <p style="margin:0 0 6px"><button class="btn" data-gpstart="${esc(g.id)}">Play guided · ~${G.minutesFor(g.id)} min</button></p>`;
  }
  const screen = () => (draft() ? playScreen() : c.ui.game_result ? resultScreen() : c.ui.test_summary ? testSummary() : c.ui.session_summary ? summaryScreen() : '');
  function render() { const e = $('#gpRoot'); if (!e) { c.rerender(); return; } const html = draft() ? playScreen() : c.ui.game_result ? resultScreen() : c.ui.test_summary ? testSummary() : summaryScreen(); e.outerHTML = html; wire(); }


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
  // ------------------------------------------------------------ welcome back (retention plan 5.2): after 14 days away, one easy game in place of the daily challenge
  const welcomeInfo = () => SS.welcomeBack({ results: J().results || [], sessions: J().sessions || [], rounds: c.DS.rounds, today: today(), games: games(), unitM: unitM(), tierScores: G.tierScores });
  function welcomeCard(w) {
    const g = gameOf(w.game), K = FEEL.COPY.welcome; if (!g) return '';
    return `<div class="card gp-daily gp-welcome" data-welcome="${esc(g.id)}"><h2 style="margin:0 0 4px">${esc(K.title)}</h2>
      <p class="small" style="margin:0 0 2px">${esc(K.line(g.name, G.minutesFor(g.id)))}</p><p class="small muted" style="margin:0 0 8px">${esc(w.basis === 'median' ? K.goal(sc(w.target)) : K.goalNew(sc(w.target)))}</p>
      <button class="btn" data-gpwelcome="${esc(g.id)}" data-wbtarget="${w.target}">${esc(K.play)}</button></div>`;
  }
  function homeCard() {
    if (!c.DS.rounds.length && !(J().results || []).length) return '';
    const due = ST.due(J().skills_tests || [], today());
    return (due.show ? `<div class="card gp-test"><h2 style="margin:0 0 4px">Time for your monthly skills test</h2><p class="small muted" style="margin:0 0 8px">${testGames()}, about ${ST.TEST_MINUTES} minutes. It re-rates your practice levels.</p><button class="btn" data-gptest>Start the skills test</button></div>` : '') + (welcomeInfo() ? welcomeCard(welcomeInfo()) : dailyCard('home'));
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
      const test = r.kind === 'test';
      J().sessions.push({ id: r.id, date: today(), minutes: r.total, focus: test ? 'other' : SS.SESSION_SKILL_FOCUS[r.skill] || 'other', notes: test ? 'Monthly skills test' : `Guided session: ${rs.map((x) => gameOf(x.game)?.name).join(', ')}`, guided: true, results: r.results,
        ...(test ? {} : { complete: rs.length >= (r.queue || []).length }) });      // complete: every game in the session was finished; it earns a streak freeze
      if (test && rs.length >= ST.TEST_GAMES.length) {
        const scores = Object.fromEntries(rs.map((x) => [x.game, x.score])), rated = ST.rate(scores, games(), unitM());
        (J().skills_tests = J().skills_tests || []).push({ id: r.id, date: today(), results: r.results, ratings: rated.ratings, per_game: rated.per_game });
        if (!quiet) c.ui.test_summary = r.id;
      } else if (!quiet) c.ui.session_summary = r.id;
    }
    c.ui.game_result = null; c.saveUi(); await save(); if (!quiet) { c.rerender(); scrollTo(0, 0); }
  }
  function summaryScreen() {
    const ses = (J().sessions || []).find((x) => x.id === c.ui.session_summary); if (!ses) { c.ui.session_summary = null; return ''; }
    const v = c.progress.data(), rs = (ses.results || []).map((id) => (J().results || []).find((x) => x.id === id)).filter(Boolean);
    const rows = rs.map((r) => { const g = gameOf(r.game), t = tierOf(g, r), inf = info(g.id), lower = g.better === 'lower', hit = inf.target !== undefined && inf.target !== null && (lower ? r.score <= inf.target : r.score >= inf.target);
      return `<div class="gp-sumrow"><div><b>${esc(g.name)}</b><div class="small muted">${hit ? '✓ hit the target' : inf.target != null ? `target ${sc(inf.target)}${lower ? ' or fewer' : '+'}` : ''}</div></div><div class="gp-sumscore"><b>${sc(r.score)}</b>${tierChip(t?.tier)}</div></div>`; }).join('');
    const hits = rs.filter((r) => { const g = gameOf(r.game), inf = info(g.id); return inf.target != null && (g.better === 'lower' ? r.score <= inf.target : r.score >= inf.target); }).length;
    return `<div class="card gp-res" id="gpRoot"><h2>Session done</h2><p class="small muted" style="margin:0 0 8px">${rs.length} games · about ${ses.minutes} min</p>${rows}
      <p class="small" style="margin:10px 0 4px">${hits} of ${rs.length} targets hit.${v.fc.ok ? ` Potential now <b>${fmt(v.fc.potential, 1)}</b> (now ${fmt(v.fc.current, 1)}).` : ''}</p>
      <p class="small" style="margin:0 0 8px">Practice streak: <b>${v.st.current} week${v.st.current === 1 ? '' : 's'}</b>.</p>
      <button class="btn" data-gpdone>Done</button></div>`;
  }

  // ------------------------------------------------------------ monthly skills test
  const testGames = () => `${['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'][ST.TEST_GAMES.length] || ST.TEST_GAMES.length} games`;
  const lastOf = (test) => ST.lastTest(J().skills_tests || [], test ? test.id : null);
  const dHtml = (v) => (v === null || v === undefined ? '–' : v >= 25 ? '25+' : v <= 0 ? 'scratch' : `≈${Math.round(v)}`);
  const chg = (x) => (x.change === null ? '' : Math.abs(x.change) < 0.5 ? 'same' : x.change > 0 ? `<span class="good">${fmt(x.change, 1)} better</span>` : `<span class="bad">${fmt(-x.change, 1)} worse</span>`);
  function testCard() {
    if (!c.DS.rounds.length && !(J().results || []).length) return '';
    const tests = J().skills_tests || [], last = lastOf(null), due = ST.due(tests, today());
    return `<div class="card gp-test"><div class="rv-h"><h2 style="margin:0">Monthly skills test</h2><span class="small muted">${last ? `last ${esc(last.date)}` : 'not done yet'}</span></div>
      <p class="small muted" style="margin:6px 0 8px">${testGames()}, about ${ST.TEST_MINUTES} minutes: ${ST.TEST_GAMES.map((id) => esc(gameOf(id)?.name || id)).join(', ')}. It gives you a practice handicap for putting, short game, approach and driving, and re-rates your practice levels.</p>
      ${due.done ? '<p class="small" style="margin:0 0 6px">This month\'s test is done ✓. You can run it again if you like.</p>' : ''}<button class="btn ${due.done ? 'sec' : ''}" data-gptest>Start the skills test</button></div>`;
  }
  async function startTest() {
    const id = `test${Date.now()}`; J().session_run = { id, kind: 'test', minutes: ST.TEST_MINUTES, queue: [...ST.TEST_GAMES], i: 0, results: [], started: new Date().toISOString(), total: ST.TEST_MINUTES, skill: null };
    await start(ST.TEST_GAMES[0], { session_id: id });
  }
  function testSummary() {
    const t = (J().skills_tests || []).find((x) => x.id === c.ui.test_summary); if (!t) { c.ui.test_summary = null; return ''; }
    const prev = lastOf(t), cmp = ST.compare(t, prev), rated = cmp.filter((x) => x.now !== null);
    const games_ = ST.TEST_GAMES.map((id) => { const pg = t.per_game[id], g = gameOf(id); return pg ? `<div class="gp-sumrow"><div><b>${esc(g?.name || id)}</b><div class="small muted">${esc(pg.label || '')}</div></div><div class="gp-sumscore"><b>${sc(pg.score)}</b></div></div>` : ''; }).join('');
    const radar = (ids) => [{ type: 'scatterpolar', r: rated.map((x) => ST.radarValue(x.now)), theta: rated.map((x) => x.title), fill: 'toself', name: 'This test', line: { color: '#1b7f4b' } },
      ...(prev ? [{ type: 'scatterpolar', r: rated.map((x) => ST.radarValue(x.before)), theta: rated.map((x) => x.title), fill: 'none', name: `Last test (${prev.date})`, line: { color: '#9a9a8a', dash: 'dot' } }] : [])];
    return `<div class="card gp-res" id="gpRoot"><h2>Skills test done</h2><p class="small muted" style="margin:0 0 8px">${t.date}. ${prev ? `Compared with ${esc(prev.date)}.` : 'This is your first test, so there is nothing to compare with yet.'}</p>
      <div class="gp-radar">${rated.length >= 3 ? c.plot(radar(), { height: 270, margin: { t: 20, b: 20, l: 40, r: 40 }, polar: { radialaxis: { range: [0, 36], showticklabels: false } }, showlegend: !!prev, legend: { orientation: 'h', y: -0.1 } }) : ''}</div>
      <div class="tbl"><table><thead><tr><th>Skill</th><th>Practice handicap</th>${prev ? '<th>Last test</th><th>Change</th>' : ''}</tr></thead><tbody>${cmp.map((x) => `<tr><td>${esc(x.title)}</td><td>${x.now === null ? '<span class="muted">not in the test</span>' : dHtml(x.now)}</td>${prev ? `<td>${dHtml(x.before)}</td><td>${chg(x)}</td>` : ''}</tr>`).join('')}</tbody></table></div>
      <h3 style="margin:12px 0 4px">Your scores</h3>${games_}
      <p class="small muted" style="margin:10px 0">These scores are saved as normal results, so your practice levels now use them.</p><button class="btn" data-gpdone>Done</button></div>`;
  }

  // friends' guided scores this week for this game: play the same steps and see who is ahead after each one
  let ghosts = [];
  async function loadGhosts() {
    const el = $('#gpGhost'); if (!el) return; const g = gameOf(el.dataset.ghostgame); if (!g) return;
    try {
      ghosts = LG.ghostsFor(await c.compete.weekScores(B.isoWeek()), g, c.compete.myUid());
      const cur = $('#gpGhost'); if (!cur || cur.dataset.ghostgame !== g.id) return;
      cur.innerHTML = ghosts.map((x, i) => `<button class="btn sec" data-gpghost="${i}">Play against ${esc(x.nick)}'s ${sc(x.score)}</button>`).join('');
      $$('[data-gpghost]').forEach((b) => b.addEventListener('click', () => start(g.id, { ghost: ghosts[Number(b.dataset.gpghost)] })));
    } catch (e) { const cur = $('#gpGhost'); if (cur) cur.innerHTML = ''; }
  }
  // what a posted score also carries: did it beat your own target, and which tier it reached
  function shareInfo(res) {
    const g = gameOf(res.game); if (!g) return {}; const inf = info(g.id), out = {};
    if (inf.target !== undefined && inf.target !== null) out.hit = g.better === 'lower' ? res.score <= inf.target : res.score >= inf.target;
    const t = tierOf(g, res)?.tier; if (t) out.tier = t.key; return out;
  }
  function nextGame(id) {
    const v = c.progress.data(), g0 = v.plan.ledger.map((x) => x.game).filter((x) => x !== id && canGuide(x));
    if (g0.length) return g0[0];
    const ids = F.DEFAULT_GAMES.filter((g) => canGuide(g.id)).map((g) => g.id), i = ids.indexOf(id); return ids[(i + 1) % ids.length];
  }
  function wire() {
    $$('[data-gp]').forEach((b) => b.addEventListener('click', () => answer(Number(b.dataset.gp), null, b)));
    $$('[data-gpball]').forEach((b) => b.addEventListener('click', () => answerBall(b.dataset.gpball, b)));
    const sl = $('#gpDist'), ty = $('#gpDtype'), num = $('#gpDnum');
    sl?.addEventListener('input', () => { num.textContent = sl.value; if (ty) ty.value = ''; });
    ty?.addEventListener('input', () => { num.textContent = ty.value !== '' ? ty.value : sl.value; });
    $('#gpPrem')?.addEventListener('change', (e) => { const d = draft(); if (d) { d.premium = e.target.checked; save(); } });
    $('[data-gpundo]')?.addEventListener('click', undo); $('[data-gpquit]')?.addEventListener('click', quit); $('#gpSound')?.addEventListener('click', toggleSound);
    $$('[data-gpstart]').forEach((b) => b.addEventListener('click', () => start(b.dataset.gpstart, { pressure: !!$('#gpPressure')?.checked })));
    $$('[data-gpagain]').forEach((b) => b.addEventListener('click', () => start(b.dataset.gpagain)));
    $$('[data-gpnext]').forEach((b) => b.addEventListener('click', () => start(nextGame(b.dataset.gpnext))));
    $$('[data-gpdone]').forEach((b) => b.addEventListener('click', () => { seq++; timers.forEach(clearTimeout); timers = []; c.ui.game_result = null; c.ui.session_summary = null; c.saveUi(); c.rerender(); }));
    loadGhosts(); reveal(); loadLeague();
    $$('[data-gptest]').forEach((b) => b.addEventListener('click', startTest));
    $$('[data-gpses]').forEach((b) => b.addEventListener('click', () => startSession(Number(b.dataset.gpses))));
    $$('[data-gpdaily]').forEach((b) => b.addEventListener('click', () => start(b.dataset.gpdaily)));
    $$('[data-gpwelcome]').forEach((b) => b.addEventListener('click', () => start(b.dataset.gpwelcome, { welcome_back: true, target: Number(b.dataset.wbtarget) })));
    $$('[data-gpsesnext]').forEach((b) => b.addEventListener('click', sesNext)); $$('[data-gpsesend]').forEach((b) => b.addEventListener('click', () => endSession(false)));
  }
  return { start, screen, launcher, wire, draft, info, canGuide, nextGame, sessionCard, dailyCard, homeCard, welcomeInfo, dailyPick, startSession, startTest, testCard, afterResult, shareInfo };
}
