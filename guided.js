// Guided practice play: one step per screen, big thumb buttons, draft saved after every step, result screen with tier and potential credit.
import * as B from './bench.js';
import * as F from './features.js';
import * as G from './games.js';
import * as SS from './sessions.js';
import * as ST from './skillstest.js';
import * as BS from './boss.js';
import * as JR from './journey.js';
import * as LG from './league.js';
import * as FEEL from './feel.js';
import * as LV from './level.js';
import * as P from './party.js';
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
  document.addEventListener('click', (e) => { if (e.target.closest?.('#gpRoot button, #gpRoot input, [data-gpstart], [data-gpagain], [data-gpnext], [data-gpses], [data-gpdaily], [data-gpwelcome], [data-gptest], [data-gpparty], [data-gppstart], [data-gphand]')) FEEL.unlock(); }, true);

  // what the golfer is aiming at in this game: the target for the skill's next handicap step, and where the plan stands
  function info(id) {
    const v = c.progress.data(); let hit = null;
    for (const s of v.sk.skills) for (const sub of s.subs) { const g = sub.games.find((x) => x.id === id); if (g && !hit) hit = { target: g.target, skill: s.title, skill_h: s.target, sub: sub.title, full_key: sub.full_key }; }
    const led = v.plan.ledger.find((x) => x.game === id) || null;
    return { ...(hit || {}), ledger: led, potential: v.fc.ok ? v.fc.potential : null };
  }
  // A duel is measured against the golfer's own target for the game (duels.js margin): the target for their next handicap step in that skill, as on the game screen.
  // Distances differ between metres and yards, so if the duel was set in the other unit the same handicap level is looked up in the duel's unit. With no skill level yet, the golfer's
  // index is used, and failing that DUEL_LEVEL (a named default: an average club golfer).
  const DUEL_LEVEL = 18;
  function duelTarget(id, uM) {
    const inf = info(id); if (Number.isFinite(inf.target) && Math.abs(uM - unitM()) < 1e-9) return inf.target;
    const v = c.progress.data(), h = Number.isFinite(inf.skill_h) ? inf.skill_h : Number.isFinite(v.jidx) ? v.jidx : DUEL_LEVEL, t = B.expectedFor(id, h, uM);
    return Number.isFinite(t) ? Math.round(t * 10) / 10 : null;
  }
  // a welcome-back game is played against the golfer's own median, which the draft carries (retention plan 5.2)
  const withTarget = (d, inf) => ((d?.welcome_back || d?.boss || d?.duel) && Number.isFinite(d.target) ? { ...inf, target: d.target } : inf);
  const tierChip = (t) => (t ? `<span class="tier ${t.key}">${esc(t.name)}</span>` : '');

  // ------------------------------------------------------------ starting, stepping, finishing
  async function start(id, opts = {}) {
    seq++; busy = false; view.banner = null; timers.forEach(clearTimeout); timers = [];
    const g = gameOf(id); if (!g || !canGuide(id)) { c.ui.pr_tab = 'games'; c.ui.pg_game = id; c.saveUi(); c.rerender(); return; }
    J().game_draft = G.newDraft(g, { unitM: opts.unitM || unitM(), pressure: !!opts.pressure || !!opts.boss, boss: opts.boss || null, session_id: opts.session_id || null, ghost: opts.ghost || null, seed: opts.seed ?? opts.ghost?.seed, adj: c.state.settings?.range_ball_adj, welcome_back: !!opts.welcome_back, target: opts.target, duel: opts.duel || null });
    if (opts.party) J().game_draft.party = opts.party;
    c.ui.pr_tab = 'games'; c.ui.pg_game = id; c.ui.game_result = null; c.ui.session_gap = null; c.saveUi(); await save();
    if (location.hash !== '#practice') location.hash = '#practice'; else c.rerender();
    scrollTo(0, 0);
  }
  const draft = () => J().game_draft || null, draft0 = draft, run = () => J().session_run || null;
  // ---- practice with a friend: the draft carries a `party` block (party.js). The game screen works on a "view" of the draft for the player whose turn it is:
  // the same draft with that player's answers and balls, sharing the arrays, so every existing step, score and streak rule works unchanged.
  const pview = (d, i) => { const pl = d.party.players[i]; return { ...d, answers: pl.answers, balls: pl.balls }; };
  const curIndex = (d, g, list) => P.turn(d.party, g, list)?.player ?? d.party.log[d.party.log.length - 1] ?? 0;
  const partyInf = (d, pl) => ({ target: d.party.mode === 'handicap' && Number.isFinite(pl.target) ? pl.target : null, skill_h: pl.hcp });
  const pillCls = (pl) => `pc-${P.COLOURS.includes(pl.colour) ? pl.colour : 'muted'}`;

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
    const d0 = draft(); if (!d0) return; const g = gameOf(d0.game), list = G.steps(g, { seed: d0.seed, unitM: d0.unitM });
    const pt = d0.party ? P.turn(d0.party, g, list) : null; if (d0.party && !pt) return;
    const d = d0.party ? pview(d0, pt.player) : d0, sc0 = G.scoreOf(g, list, d.answers);
    if (sc0.done) return;
    const lead0 = d0.party ? P.liveLeaders(d0.party, g, d0.unitM, list) : null;
    const k = d.answers.length, step = list[k], inf = d0.party ? partyInf(d0, d0.party.players[pt.player]) : withTarget(d, info(g.id));
    d.answers.push(v); if (ball) (d.balls = d.balls || []).push(ball); if (d0.party) d0.party.log.push(pt.player);
    const sc1 = G.scoreOf(g, list, d.answers), out = G.outcomeOf(g, step, v, { ball, before: d.answers.slice(0, k) });
    const streak = G.streakOf(g, list, d.answers, d.balls), passed = G.targetPassed(g, list, d.answers, d.balls, inf.target), mile = out.good === true && G.STREAK_MILESTONES.includes(streak), ms = FEEL.feedbackMs();
    // a change of leader (judged after whole stations) plays the streak sound and shows a banner; a streak milestone or target banner for the same tap wins
    const lead1 = d0.party ? P.liveLeaders(d0.party, g, d0.unitM, list) : null, newLead = !!lead1 && lead1.length === 1 && lead0.length > 0 && !(lead0.length === 1 && lead0[0] === lead1[0]) && !passed && !mile;
    // sound: a soft click, then the verdict; a milestone sound lands just after the verdict, and the light "step" tick comes when the next step arrives
    FEEL.play('tap'); if (out.good === true) FEEL.play('good'); else if (out.good === false) FEEL.play('miss');
    const moment = passed ? () => FEEL.play('target') : mile ? () => FEEL.play('streak', { level: FEEL.streakLevel(streak) }) : newLead ? () => FEEL.play('streak', { level: 0 }) : null;
    if (moment) later(330, moment);
    const text = passed ? FEEL.COPY.reachedTarget : mile ? FEEL.COPY.streak(streak) : newLead ? FEEL.COPY.party.takesLead(d0.party.players[lead1[0]].name) : '';
    if (text) view.banner = { text, t0: Date.now() };
    feedbackDom({ k, out, sc0, sc1, streak, mile, passed, text, btn, g, list, d, inf });
    if (d0.party ? P.finished(d0.party, g, list) : sc1.done) { await save(); return finish({ delay: Math.max(0, ms - (Date.now() - tap0)) }); }     // the wait counts from the tap, not from the end of the saves
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
  async function undo() { if (busy) return; const d = draft(); if (d?.party) { if (!d.party.log.length) return; FEEL.play('tap'); d.party = P.undo(d.party); view.banner = null; await save(); render(); return; }
    if (!d || !d.answers.length) return; FEEL.play('tap'); d.answers.pop(); d.balls?.pop(); view.banner = null; await save(); render(); }
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
  async function quit() { if (busy) return; if (!confirm(draft0()?.duel ? FEEL.COPY.duels.quit : run()?.kind === 'boss' ? FEEL.COPY.boss.quit(run().results.length) : run() ? 'Stop this session? Games you finished are kept.' : 'Stop this game? Nothing is saved.')) return; seq++; timers.forEach(clearTimeout); timers = []; J().game_draft = null; if (draft0()?.session_id || run()) endSession(true); await save(); c.rerender(); }
  // a saved result's tier: benchmark games use the handicap table, own-history games judge it against the scores before it
  const tierOf = (g, r) => (G.isOwn(g) ? G.tierFor(g, r.score, unitM(), G.scoresBefore(g, J().results || [], r.id)) : G.tierFor(g, r.score, unitM()));
  async function finish(opts = {}) {
    const d = draft(), g = gameOf(d.game); const before = G.bestScore(g, J().results || []), v0 = c.progress.data(), led0 = v0.plan.ledger.find((x) => x.game === g.id), inf0 = info(g.id);
    const plist = d.party ? G.steps(g, { seed: d.seed, unitM: d.unitM }) : null;
    const res = G.resultFromDraft(d.party ? P.ownerDraft(d) : d, g, { date: today() });
    if (d.party) { res.party = P.partyRecord(d.party, g, d.unitM, plist); J().partners = P.rememberPartners(J().partners, d.party.players.filter((x) => !x.owner), res.date); }   // guests stay inside the owner's result, on this phone
    afterResult(res); J().results.push(res); J().game_draft = null;
    const up = G.isOwn(g) ? G.ownTierUp(g, J().results, res.id) : G.tierUp(g, before, res.score, unitM());
    c.ui.game_result = { id: res.id, prev_best: before, target_before: Number.isFinite(d.target) ? d.target : Number.isFinite(inf0.target) ? inf0.target : null, level_before: Number.isFinite(inf0.skill_h) ? inf0.skill_h : null, streak_before: v0.st ? v0.st.current : null, pot_before: v0.fc.ok ? v0.fc.potential : null, hits_before: led0 ? led0.hits : null, up: up?.key || null, session_id: res.session_id || null, ghost: d.ghost ? { nick: d.ghost.nick, score: d.ghost.score, ...LG.finalCompare(g, res.score, d.ghost.score) } : null };
    c.saveUi(); await save(); posting = { id: res.id, p: c.compete.onScore(res) }; if (res.duel) c.compete.duelFinished(res, d.target);       // the duel's final status is worked out on this phone
    // the result is already saved; with a delay only the screen waits, so the last verdict can be read before the result appears
    const show = () => { busy = false; c.rerender(); scrollTo(0, 0); };   // the result screen itself announces the score and any new tier
    if (opts.delay > 0) later(opts.delay, show); else show();
  }

  // ------------------------------------------------------------ screens
  function playScreen() {
    const d0 = draft(), g = gameOf(d0.game), list = G.steps(g, { seed: d0.seed, unitM: d0.unitM });
    if (d0.party && P.needsHandover(d0.party, g, list)) return handoverScreen(d0, g, list);        // the phone has to be passed on first
    const ci = d0.party ? curIndex(d0, g, list) : 0, d = d0.party ? pview(d0, ci) : d0, a = d.answers, sc0 = G.scoreOf(g, list, a), i = a.length, step = list[Math.min(i, list.length - 1)];
    const inf = d0.party ? partyInf(d0, d0.party.players[ci]) : withTarget(d, info(g.id)), lower = g.better === 'lower', open = G.isOpen(g.id), last = i === list.length - 1 && !open, pr = d.pressure && last;
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
    const tgt = d.boss && Number.isFinite(d.target) ? FEEL.COPY.boss.target(sc(d.target)) : d.welcome_back && Number.isFinite(d.target) ? FEEL.COPY.welcome.target(sc(d.target)) : inf.target !== undefined && inf.target !== null ? FEEL.COPY.target(sc(inf.target), inf.skill_h, lower) : '';
    const streak = G.streakOf(g, list, a, bl), prog = barOf(g, list, a, sc0.score, inf), ban = view.banner && Date.now() - view.banner.t0 < 1450 ? view.banner : null;
    return `<div class="gp gp-full${pr ? ' gp-pr' : ''}${d.boss ? ' gp-boss' : ''}" id="gpRoot"${busy ? ' data-busy="1"' : ''}>
      <div class="gp-top"><button type="button" class="gp-x" data-gpquit aria-label="Close game" title="Close">${icon('cross', 22)}</button>
        <div class="gp-bar" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(prog * 100)}"><i id="gpBar" class="fx-fill" style="--p:${prog}"></i></div>${soundBtn()}</div>
      ${d0.party ? whoRow(d0, ci, g, list) : ''}${d.boss ? bossBar(d.boss, i < list.length ? d.game : null) : ''}<div class="gp-strip"><div class="gp-sc"><div class="gp-name">${esc(g.name)}</div><b id="gpScore">${scoreText(g, sc0.score, i)}</b><span id="gpScoreLbl">${scoreLabel(g, i, list.length)}</span></div>
        <div class="gp-side"><span class="gp-streak" id="gpStreak" ${streak >= 2 ? '' : 'hidden'}>${icon('flame', 18)}<b>${streak}</b></span><span class="gp-tgt">${esc(tgt)}</span></div>
        <div class="gp-banner" id="gpBanner" ${ban ? `style="animation-delay:-${Date.now() - ban.t0}ms"` : 'hidden'}>${ban ? esc(ban.text) : ''}</div></div>
      ${d0.party ? board(d0, g, list, ci) : ''}<div class="gp-dots">${dots}</div>
      ${ghostLine}${pr ? `<div class="gp-pressure">${esc(G.pressureBanner(g))}</div>` : ''}
      <div class="gp-main" id="gpMain"><div class="gp-art">${shotArt(artFor(g, step))}</div><div class="gp-prompt">${esc(step.prompt)}</div><div class="gp-sub">${esc(step.sub || '')}</div><div class="gp-verdict" id="gpVerdict" aria-live="polite"></div></div>
      <div class="gp-sheet${busy ? ' gp-locked' : ''}" id="gpSheet">${dist}<div class="gp-btns ${isD ? (step.results ? 'three' : 'one') : step.input === 'strokes' ? 'five' : 'two'}">${btns}</div>
        <div class="gp-foot"><button class="btn sec" data-gpundo ${(d0.party ? d0.party.log.length : i) ? '' : 'disabled'}>Undo</button></div></div></div>`;
  }
  // ------------------------------------------------------------ practice with a friend: whose turn, the scoreboard, the hand-over and the set-up sheet
  function whoRow(d0, ci, g, list) {
    const pl = d0.party.players[ci], st = P.stationInfo(d0.party, g, list), K = FEEL.COPY.party;
    return `<div class="gp-who ${pillCls(pl)}"><span class="gp-pill" id="gpWho">${esc(pl.name)}</span>${st ? `<span class="gp-wsub">${esc(K.left(st.left, st.prompt, st.open))}</span>` : ''}</div>`;
  }
  // a strip with every player's running score; the leader (judged after whole stations, so going first is no advantage) has a flag, and the player on turn an outline
  function board(d0, g, list, ci) {
    const st = P.standings(d0.party, g, d0.unitM, { list }), lead = P.liveLeaders(d0.party, g, d0.unitM, list), K = FEEL.COPY.party;
    return `<div class="gp-board" role="group" aria-label="${esc(K.scores)}">${st.rows.map((r) => `<div class="gp-pc ${pillCls(d0.party.players[r.i])}${r.i === ci ? ' now' : ''}"><span class="n">${esc(r.name)}</span><b>${r.score === null ? '–' : sc(r.score)}</b>${lead.includes(r.i) ? `<i class="lead">${icon('flag', 12)}</i><span class="gp-sr">${esc(K.leading)}</span>` : ''}</div>`).join('')}</div>`;
  }
  function handoverScreen(d0, g, list) {
    const t = P.turn(d0.party, g, list), pl = d0.party.players[t.player], st = P.stationInfo(d0.party, g, list), K = FEEL.COPY.party;
    return `<div class="gp gp-full gp-hand" id="gpRoot"><div class="gp-top"><button type="button" class="gp-x" data-gpquit aria-label="Close game" title="Close">${icon('cross', 22)}</button><div class="gp-hname">${esc(g.name)}</div>${soundBtn()}</div>
      <div class="gp-hmain"><div class="gp-hk">${esc(K.pass)}</div><div class="gp-who big ${pillCls(pl)}"><span class="gp-pill">${esc(pl.name)}</span></div><div class="gp-hsub">${esc(K.left(st.left, st.prompt, st.open))}</div></div>
      ${board(d0, g, list, t.player)}
      <div class="gp-sheet"><div class="gp-btns one"><button class="gp-b hit" data-gphand>${esc(K.ready(pl.name))}</button></div><div class="gp-foot"><button class="btn sec" data-gpundo ${d0.party.log.length ? '' : 'disabled'}>${esc(K.undoHand)}</button></div></div></div>`;
  }
  async function handedOver() { const d = draft(); if (!d?.party) return; const g = gameOf(d.game); d.party = P.handedOver(d.party, g, G.steps(g, { seed: d.seed, unitM: d.unitM })); await save(); render(); }
  // the plain list of places on the owner's result screen (the podium, rematch and series come in the next phase)
  function partyResult(r) {
    const R = FEEL.COPY.party.result, pt = r.party, hc = pt.mode === 'handicap', sorted = [...pt.players].sort((a, b) => a.place - b.place);
    return `<div class="gp-party"><h3 style="margin:0 0 4px">${esc(R.title)}</h3><p class="gp-pw">${esc(pt.winner ? R.winner(pt.winner) : R.tie)}</p>
      ${sorted.map((p) => `<div class="gp-sumrow"><div><b>${esc(R.place(p.place))} · ${esc(p.name)}</b>${hc && Number.isFinite(p.margin) ? `<div class="small muted">${esc(R.margin(p.margin))}</div>` : ''}</div><div class="gp-sumscore"><b>${sc(p.score)}</b></div></div>`).join('')}
      <p class="small muted" style="margin:6px 0 10px">${esc(R.note)}</p></div>`;
  }
  // the set-up sheet: you plus one to three friends, straight or handicap scoring, optional pressure finish
  const ownerName = () => P.cleanName(c.state.cloud?.nick) || 'Me';
  function partySetup(id, pressure = false) {
    const g = gameOf(id); if (!g || !canGuide(id) || !$('#sheetPanel')) return;
    const v = c.progress.data(), own = P.ownerLevel({ index: v.jidx, ratings: v.sk }), K = FEEL.COPY.party;
    const S = { guests: [{ name: '', hcp: '' }], mode: 'straight', pressure: !!pressure, err: '' };
    const read = () => { S.guests = $$('#sheetPanel [data-pgrow]').map((r) => ({ name: r.querySelector('[data-pgname]').value, hcp: r.querySelector('[data-pghcp]').value })); S.pressure = !!$('#ptPressure')?.checked; S.mode = $('#sheetPanel input[name=ptmode]:checked')?.value || 'straight'; };
    const players = () => [{ name: ownerName(), hcp: own.hcp }, ...S.guests.filter((x) => P.cleanName(x.name)).map((x) => ({ name: x.name, hcp: P.parseHcp(x.hcp) }))];
    const hcOk = () => B.hasLevel(g.id) && P.canHandicap(players(), g);
    const used = () => new Set(S.guests.map((x) => P.cleanName(x.name).toLowerCase()).concat(ownerName().toLowerCase()));
    function draw() {
      const rec = (J().partners || []).filter((x) => !used().has(P.cleanName(x.name).toLowerCase())), ok = hcOk(), why = !B.hasLevel(g.id) ? K.noBench : K.needHcp;
      $('#sheetPanel').innerHTML = `<div class="sheet-bar"><button type="button" class="sheet-x" data-sheetx aria-label="Close">${icon('cross', 20)}</button></div>
        <h2 style="margin:0 0 2px">${esc(K.title)}</h2><p class="small muted" style="margin:0 0 4px">${esc(g.name)} · ${esc(K.intro)}</p><p class="small muted" style="margin:0 0 10px">${esc(K.nameNote)}</p>
        <div class="pt-row"><label class="f" for="ptOwner">${esc(K.you)}</label><input id="ptOwner" value="${esc(ownerName())}" disabled><p class="small muted" style="margin:4px 0 0">${esc(K.yourLevel(own.hcp === null ? null : sc(own.hcp), own.basis))}</p></div>
        ${S.guests.map((x, i) => `<div class="pt-row" data-pgrow><div class="pt-two"><div><label class="f" for="ptN${i}">${esc(K.guest(i + 1))}</label><input id="ptN${i}" data-pgname maxlength="${P.NAME_MAX}" placeholder="${esc(K.name)}" autocomplete="off" value="${esc(x.name)}"></div>
          <div><label class="f" for="ptH${i}">${esc(K.hcp)}</label><input id="ptH${i}" data-pghcp inputmode="decimal" autocomplete="off" placeholder="e.g. 18" value="${esc(x.hcp)}"></div></div>
          ${S.guests.length > 1 ? `<button type="button" class="btn sec pt-rm" data-pgrm="${i}">${esc(K.remove)} ${esc(P.cleanName(x.name) || K.guest(i + 1))}</button>` : ''}</div>`).join('')}
        ${S.guests.length < P.MAX_PLAYERS - 1 ? `<p style="margin:6px 0"><button type="button" class="btn sec" data-pgadd>${esc(K.add)}</button></p>` : ''}
        ${rec.length && S.guests.length ? `<div class="pt-recent"><span class="small muted">${esc(K.recent)}</span><div class="pt-chips">${rec.map((x, i) => `<button type="button" class="pt-chip" data-pgpick="${esc(x.name)}" data-pghcpv="${x.hcp ?? ''}">${esc(x.name)}${Number.isFinite(x.hcp) ? ` · ${x.hcp}` : ''}</button>`).join('')}</div></div>` : ''}
        <h3 style="margin:12px 0 6px">${esc(K.scoring)}</h3>
        <label class="pt-opt"><input type="radio" name="ptmode" value="straight" ${S.mode === 'straight' || !ok ? 'checked' : ''}><span><b>${esc(K.straight)}</b><small>${esc(K.straightNote)}</small></span></label>
        <label class="pt-opt${ok ? '' : ' off'}"><input type="radio" name="ptmode" value="handicap" ${S.mode === 'handicap' && ok ? 'checked' : ''} ${ok ? '' : 'disabled'}><span><b>${esc(K.handicap)}</b><small>${esc(ok ? K.handicapNote : why)}</small></span></label>
        <label class="pt-opt"><input type="checkbox" id="ptPressure" ${S.pressure ? 'checked' : ''}><span><b>${esc(K.pressure)}</b><small>${esc(G.pressureRule(g))}</small></span></label>
        <p class="pt-err" id="ptErr" role="alert">${esc(S.err)}</p>
        <div class="row"><button type="button" class="btn" data-gppstart>${esc(K.start)}</button><button type="button" class="btn sec" data-pgcancel>${esc(K.cancel)}</button></div>`;
      $('#sheet').classList.add('open'); wireSheet();
    }
    function wireSheet() {
      const close = () => $('#sheet').classList.remove('open');
      $('#sheetPanel [data-sheetx]')?.addEventListener('click', close); $('#sheetPanel [data-pgcancel]')?.addEventListener('click', close);
      $('#sheetPanel [data-pgadd]')?.addEventListener('click', () => { read(); if (S.guests.length < P.MAX_PLAYERS - 1) S.guests.push({ name: '', hcp: '' }); draw(); });
      $$('#sheetPanel [data-pgrm]').forEach((b) => b.addEventListener('click', () => { read(); S.guests.splice(Number(b.dataset.pgrm), 1); draw(); }));
      $$('#sheetPanel [data-pgpick]').forEach((b) => b.addEventListener('click', () => { read(); const e = S.guests.findIndex((x) => !P.cleanName(x.name)), row = { name: b.dataset.pgpick, hcp: b.dataset.pghcpv }; if (e >= 0) S.guests[e] = row; else if (S.guests.length < P.MAX_PLAYERS - 1) S.guests.push(row); draw(); }));
      $$('#sheetPanel [data-pghcp], #sheetPanel [data-pgname]').forEach((i) => i.addEventListener('input', () => { read(); const ok = hcOk(), h = $('#sheetPanel input[value=handicap]'); if (h) { h.disabled = !ok; h.closest('label').classList.toggle('off', !ok); if (!ok && h.checked) $('#sheetPanel input[value=straight]').checked = true; h.nextElementSibling.querySelector('small').textContent = ok ? K.handicapNote : (!B.hasLevel(g.id) ? K.noBench : K.needHcp); } }));
      $('#sheetPanel [data-gppstart]')?.addEventListener('click', async () => {
        read(); const gs = S.guests.filter((x) => P.cleanName(x.name)), bad = P.problem([{ name: ownerName() }, ...gs]);
        if (bad) { S.err = K.errors[bad] || K.errors.name; $('#ptErr').textContent = S.err; return; }
        const party = P.newParty({ owner: { name: ownerName(), hcp: own.hcp }, guests: gs.map((x) => ({ name: x.name, hcp: x.hcp })), mode: S.mode, game: g, unitM: unitM() });
        if (!party) { $('#ptErr').textContent = K.errors.name; return; }
        close(); await start(g.id, { party, pressure: S.pressure });
      });
    }
    draw();
  }

  function sesButtons(g) {
    if ((J().results || []).find((x) => x.id === c.ui.game_result?.id)?.duel) return `<div class="row"><button class="btn" data-gpdone>Done</button></div>`;       // a duel is one attempt: no "play again"
    const r = run();
    if (r && r.kind === 'boss' && c.ui.game_result?.session_id === r.id) { const last = r.i + 1 >= r.queue.length, nx = gameOf(r.queue[r.i + 1]);
      return `<div class="row">${last ? `<button class="btn" data-gpsesend>${esc(FEEL.COPY.boss.finish)}</button>` : `<button class="btn" data-gpsesnext>Next: ${esc(nx?.name || '')}</button>`}</div>`; }
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
    const beatP = r.welcome_back || r.boss ? (Number.isFinite(inf.target) ? (lower ? r.score <= inf.target : r.score >= inf.target) : null) : beat;
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
    const jn = c.progress.advance?.(r.id);                       // a stage that moved forward in the open stretch of the road to scratch
    if (jn) rw.push(`<div ${rwAt(' up')} id="gpRJourney" data-done="${jn.done ? 1 : 0}"><div class="l">${esc(K.journey.rewardTitle)}</div><div class="v${jn.done && anim ? ' fx-stamp' : ''}">${esc(jn.title)}</div><div class="s">${esc(jn.done ? K.journey.stamp : K.journey.stage(rnd1(jn.to), jn.need))}</div></div>`);
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
      r.boss && target !== null ? `${beat ? '✓ ' : ''}${K.boss.beat(r.boss, sc(target), lower)}` : r.welcome_back && target !== null ? `${beat ? '✓ ' : ''}${K.welcome.beat(sc(target))}` : beat !== null ? `${beat ? '✓ You beat' : 'Beat'} the ${lvT}-handicapper: ${sc(target)}${lower ? ' or fewer' : '+'}.` : '',
      info0.ghost ? `<b>${info0.ghost.state === 'won' ? `You beat ${esc(info0.ghost.nick)}` : info0.ghost.state === 'lost' ? `${esc(info0.ghost.nick)} wins` : `Level with ${esc(info0.ghost.nick)}`}</b> · ${sc(r.score)} to ${sc(info0.ghost.score)}` : '',
      pr ? `${esc(pr.label)}.${pr.hit ? ' Counts as 1.5 hits.' : ''}` : '', credit,
    ].filter(Boolean).map((x) => `<p class="small" style="margin:0 0 6px">${x}</p>`).join('');
    return `<div class="card gp-res gp-rv${r.boss ? ' gp-boss' : ''}" id="gpRoot" data-rid="${esc(r.id)}"${info0.seen ? '' : ' data-reveal="1"'}>
      <div class="gp-hero"><canvas class="gp-confetti" id="gpConf" aria-hidden="true"></canvas>
        <div ${at('gp-rname', 0)}>${esc(g.name)}</div>
        <div ${at(`gp-rverdict ${verdict.key}`, 1)} id="gpVerdictL">${esc(vText)}</div>${vSub ? `<div ${at('gp-rsub', 1)}>${esc(vSub)}</div>` : ''}${r.welcome_back ? `<div ${at('gp-rsub', 1)}>${esc(K.welcome.back)}</div>` : ''}
        <div ${at('gp-score', 2)}><b id="gpRNum" data-to="${r.score}">${sc(r.score)}</b>${g.max ? `<span> / ${g.max}</span>` : G.isDistance(g) ? `<span> ${un}</span>` : ''}</div>
        ${lv ? `<div ${at('gp-rlevel', 3)}>${esc(K.level(lv.h))}</div>` : ''}
        ${badge || nextT ? `<div class="gp-badgewrap">${badge}${nextT ? `<div ${at('gp-rnext', 4)}>${nextT}</div>` : ''}</div>` : ''}</div>
      <div class="gp-rbody">${c.compete.duelPanel(r.id)}${r.party ? partyResult(r) : ''}${r.boss ? bossStatus(r.boss) : ''}${rw.length ? `<div class="gp-rewards">${rw.join('')}</div>${showNote ? `<p class="gp-rwn">${esc(K.rewards.note)}</p>` : ''}` : ''}
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
      if (!r.duel) { FEEL.play(cel.sound); if (cel.confetti) FEEL.confetti($('#gpConf')); }          // a duel's sound comes with the head-to-head (compete.js)
      if (pts && Number(pts.dataset.to) > 0) { FEEL.countUp(pts, 0, Number(pts.dataset.to), ms(700), (v) => `+${Math.round(v)}`); pulse($('#gpRPtsBox'), 'pop'); }
      if (cel.sound !== 'finish') pulse($('#gpVerdictL'), 'pop');
      if (st && Number(st.dataset.to) > Number(st.dataset.from)) { FEEL.countUp(st, Number(st.dataset.from), Number(st.dataset.to), ms(500)); pulse($('#gpRStreakBox'), 'flame'); }
      if (pot && Number(pot.dataset.to) < Number(pot.dataset.from)) FEEL.countUp(pot, Number(pot.dataset.from), Number(pot.dataset.to), ms(700), (v) => fmt(v, 1));
    });
    // a hit that lowers the potential target earns the unlock sound, once the number has come down
    if (pot && verdict.met && Number(pot.dataset.to) < Number(pot.dataset.from) - 0.049) at(ms(1700), () => FEEL.play('unlock'));
    // finishing a stage of the road to scratch earns the tier sound
    if ($('#gpRJourney[data-done="1"]')) at(ms(1500), () => { FEEL.play('tier'); pulse($('#gpRJourney'), 'pop'); });
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
      <p style="margin:0 0 6px"><button class="btn" data-gpstart="${esc(g.id)}">Play guided · ~${G.minutesFor(g.id)} min</button></p>
      <p style="margin:0 0 6px"><button class="btn sec" data-gpparty="${esc(g.id)}">${esc(FEEL.COPY.party.button)}</button></p>`;
  }
  const screenHtml = () => (draft() ? playScreen() : c.ui.game_result ? resultScreen() : c.ui.session_gap ? gapScreen() : c.ui.boss_summary ? bossSummary() : c.ui.test_summary ? testSummary() : c.ui.session_summary ? summaryScreen() : '');
  const screen = screenHtml;
  function render() { const e = $('#gpRoot'); if (!e) { c.rerender(); return; } e.outerHTML = screenHtml(); wire(); }

  // ------------------------------------------------------------ the games list: a card per game, with a gold ring for the way to the next tier (plan 5.3)
  const catIcon = (g) => (g.cat === 'Putting' ? 'putt' : g.cat === 'Chipping' ? 'flag' : g.cat === 'Range' ? 'club' : 'target');
  const upNextId = () => c.progress.data().plan.ledger.map((x) => x.game).find((x) => canGuide(x)) || null;     // the weakest focus-area game, when there is one
  function gameCards(entry, sel) {
    const up = upNextId(), u = unitM(), R = 21, C = 2 * Math.PI * R;
    const card = (g) => {
      const tp = G.tierProgress(g, J().results || [], u), lower = g.better === 'lower', best = tp.best;
      const nxt = tp.next ? `Next: ${esc(tp.next.name)} at ${sc(tp.next.score)}${lower ? ' or fewer' : '+'}` : tp.tier ? 'Top tier' : tp.own && tp.need > 0 ? `Play ${tp.need} more for tiers` : '';
      const pct = Math.round(tp.p * 100);
      return `<button type="button" class="gp-card${g.id === sel ? ' sel' : ''}" data-pickgame="${esc(g.id)}" aria-pressed="${g.id === sel}">
        <span class="gp-ctop"><span class="gp-ring"><svg class="r" viewBox="0 0 48 48" aria-hidden="true"><circle class="t" cx="24" cy="24" r="${R}"/>${tp.p > 0 ? `<circle class="p" cx="24" cy="24" r="${R}" stroke-dasharray="${(C * tp.p).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 24 24)"/>` : ''}</svg>${icon(catIcon(g), 22)}</span>${g.id === up ? `<em class="tag">${esc(FEEL.COPY.next)}</em>` : ''}</span>
        <span class="gp-cn">${esc(g.name)}</span>
        <span class="gp-cb">${best === null ? 'Not played yet' : `Best <b>${sc(best)}</b>${g.max ? ` / ${g.max}` : ''}`}</span>
        ${tp.tier ? `<span class="tier ${tp.tier.key}">${esc(tp.tier.name)}</span>` : ''}${nxt ? `<span class="gp-cx">${nxt}</span>` : ''}
        ${tp.ladder ? `<span class="gp-sr">${pct} percent of the way to the next tier</span>` : ''}</button>`;
    };
    return [...new Set(entry.map((x) => x.cat))].map((cat) => `<div class="gp-cathead">${esc(cat)}</div><div class="gp-cards">${entry.filter((x) => x.cat === cat).map(card).join('')}</div>`).join('');
  }

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
  let flamePulsed = null;                                                // the flame pulses once a day per page load, not on every redraw
  function dailyCard(where = 'games') {
    if (!c.DS.rounds.length && !(J().results || []).length) return '';
    const K = FEEL.COPY.daily, d = today(), pick = dailyPick(), g = gameOf(pick.game); if (!g) return '';
    const done = !!(J().daily || {})[d], inf = info(g.id), lower = g.better === 'lower', wk = c.progress.data().st?.current || 0;
    return `<div class="card gp-daily ${done ? 'done' : 'todo'}" data-daily="${esc(g.id)}">
      <div class="gp-dflame${wk ? ' on' : ''}" id="gpDFlame" role="img" aria-label="${esc(K.streak(wk))}" title="${esc(K.streak(wk))}">${icon('flame', 26)}<b>${wk}</b><small>${wk === 1 ? 'week' : 'weeks'}</small></div>
      <div class="gp-dmain"><div class="rv-h"><h2 style="margin:0">${esc(K.title)}</h2>${done ? `<span class="gp-dtick">${icon('tick', 14)}${esc(K.doneTag)}</span>` : ''}</div>
        <p style="margin:4px 0 2px"><b>${esc(g.name)}</b>${pick.focus ? ' <span class="tag">focus area</span>' : ''}</p>
        <p class="small muted" style="margin:0 0 8px">${inf.target !== undefined && inf.target !== null ? `Target ${sc(inf.target)}${lower ? ' or fewer' : '+'} · ` : ''}about ${G.minutesFor(g.id)} min${done ? ` · ${K.doneLine}` : ''}</p>
        ${done ? '' : `<button class="btn" data-gpdaily="${esc(g.id)}">${esc(K.play)}</button>`}</div></div>`;
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
  const startMarks = () => { const v = c.progress.data(); return { pot_start: v.fc.ok ? v.fc.potential : null, st_start: v.st ? v.st.current : null }; };   // for the summary's count-up
  async function startSession(minutes) {
    const plan = sessionPlan(minutes); if (!plan.games.length) return; const id = `ses${Date.now()}`;
    J().session_run = { id, minutes, queue: plan.games.map((g) => g.id), i: 0, results: [], started: new Date().toISOString(), total: plan.total, skill: plan.games[0].skill, ...startMarks() };
    await start(plan.games[0].id, { session_id: id });
  }
  // between two games of a session or a skills test: how far through you are and what comes next. It waits for a tap, so you can walk to the next spot first.
  async function sesGap() { const r = run(); if (!r) return; seq++; timers.forEach(clearTimeout); timers = []; c.ui.game_result = null; c.ui.session_gap = r.id; c.saveUi(); c.rerender(); scrollTo(0, 0); }
  function gapScreen() {
    const r = run(), K = FEEL.COPY, nx = r && gameOf(r.queue[r.i + 1]); if (!r || c.ui.session_gap !== r.id || !nx) { c.ui.session_gap = null; return ''; }
    const n = r.queue.length, done = r.i + 1, test = r.kind === 'test', inf = info(nx.id), lower = nx.better === 'lower', anim = FEEL.revealMs(100) > 0;
    return `<div class="card gp-res gp-rv gp-gap" id="gpRoot" data-gap="${esc(r.id)}">
      <div class="gp-hero"><div class="gp-rname">${esc(test ? K.session.test : K.session.name)}</div>
        <div class="gp-rverdict" id="gpGapN">${esc(K.progress(done, n))}</div>
        <div class="gp-gbar" role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${done}"><i id="gpGapBar" data-to="${done / n}" style="--p:${anim ? (done - 1) / n : done / n}"></i></div>
        <div class="gp-rnext">${esc(K.next)}</div><div class="gp-gname">${esc(nx.name)}</div>
        <div class="gp-rlevel">about ${G.minutesFor(nx.id)} min${inf.target !== undefined && inf.target !== null ? ` · Target ${sc(inf.target)}${lower ? ' or fewer' : '+'}` : ''}</div></div>
      <div class="gp-rbody"><div class="row"><button class="btn" data-gpgapgo>${esc(K.session.start(nx.name))}</button><button class="btn sec" data-gpsesend>${esc(test ? K.session.finishTest : K.session.finish)}</button></div></div></div>`;
  }
  function revealGap() {
    const bar = $('#gpGapBar'); if (!bar || bar.dataset.shown) return; bar.dataset.shown = '1'; FEEL.play('step');
    const to = bar.dataset.to; requestAnimationFrame(() => requestAnimationFrame(() => bar.style.setProperty('--p', to)));
  }
  function pulseFlame() { const e = $('.gp-daily.todo #gpDFlame.on'), d = today(); if (e && flamePulsed !== d) { flamePulsed = d; FEEL.pulse(e, 'flame'); } }
  async function sesNext() { const r = run(); if (!r) return; r.i++; const id = r.queue[r.i]; await start(id, r.kind === 'boss' ? { session_id: r.id, boss: r.boss, target: r.targets?.[id] } : { session_id: r.id }); }
  async function endSession(quiet) {
    const r = run(); if (!r) return; const rs = (J().results || []).filter((x) => r.results.includes(x.id)); J().session_run = null;
    if (r.kind === 'boss') {                                  // a boss attempt is stored in journey.bosses, not as a session; it counts only if a game was finished
      const rec = BS.record({ id: r.id, n: r.boss, date: today(), results: r.results, scores: Object.fromEntries(rs.map((x) => [x.game, x.score])), games: games(), unitM: unitM() });
      if (rec) { J().journey = { ...(J().journey || {}), bosses: [...(J().journey?.bosses || []), rec] }; if (!quiet) { c.ui.boss_summary = r.id; c.ui.boss_seen = false; } }
      c.ui.game_result = null; c.saveUi(); await save(); if (!quiet) { c.rerender(); scrollTo(0, 0); } return;
    }
    if (rs.length) {
      const test = r.kind === 'test';
      J().sessions.push({ id: r.id, date: today(), minutes: r.total, focus: test ? 'other' : SS.SESSION_SKILL_FOCUS[r.skill] || 'other', notes: test ? 'Monthly skills test' : `Guided session: ${rs.map((x) => gameOf(x.game)?.name).join(', ')}`, guided: true, results: r.results, ...(Number.isFinite(r.pot_start) ? { pot_before: r.pot_start } : {}), ...(Number.isFinite(r.st_start) ? { st_before: r.st_start } : {}),
        ...(test ? {} : { complete: rs.length >= (r.queue || []).length }) });      // complete: every game in the session was finished; it earns a streak freeze
      if (test && rs.length >= ST.TEST_GAMES.length) {
        const scores = Object.fromEntries(rs.map((x) => [x.game, x.score])), rated = ST.rate(scores, games(), unitM());
        (J().skills_tests = J().skills_tests || []).push({ id: r.id, date: today(), results: r.results, ratings: rated.ratings, per_game: rated.per_game });
        if (!quiet) c.ui.test_summary = r.id;
      } else if (!quiet) c.ui.session_summary = r.id;
    }
    c.ui.game_result = null; c.ui.session_gap = null; c.saveUi(); await save(); if (!quiet) { c.rerender(); scrollTo(0, 0); }
  }
  // the session and skills-test summaries share the result screen's look: a green hero, things rising in one after another, a count-up and a small rewards row
  const sumAnim = (id) => c.ui.sum_seen !== id && FEEL.revealMs(100) > 0;
  const sumAt = (anim, cls, i) => `class="${cls}${anim ? ' fx-rise' : ''}"${anim ? ` style="--i:${i}"` : ''}`;
  function rewardChips(anim, i0, { stNow, stBefore, pot, potFrom }) {
    const K = FEEL.COPY, out = []; let i = i0;
    if (stNow >= 1) out.push(`<div ${sumAt(anim, `gp-rw${stNow > stBefore ? ' up' : ''}`, i++)} id="gpSStreakBox"><div class="l">${esc(K.rewards.streak)}</div><div class="v">${icon('flame', 22)}<span id="gpSStreak" data-from="${stBefore}" data-to="${stNow}">${stNow}</span></div><div class="s">${K.rewards.weeks(stNow)} in a row</div></div>`);
    if (pot !== null) { const moved = Number.isFinite(potFrom) && Math.abs(pot - potFrom) >= 0.05;
      out.push(`<div ${sumAt(anim, `gp-rw${moved && pot < potFrom ? ' up' : ''}`, i++)}><div class="l">${esc(K.session.potential)}</div><div class="v"><span id="gpSPot" data-from="${moved ? potFrom : pot}" data-to="${pot}">${fmt(pot, 1)}</span></div><div class="s">${esc(K.rewards.potential)}${moved ? `, ${pot < potFrom ? 'down' : 'up'} from <s>${fmt(potFrom, 1)}</s>` : ''}</div></div>`); }
    return out.length ? `<div class="gp-rewards">${out.join('')}</div><p class="gp-rwn">${esc(K.rewards.note)}</p>` : '';
  }
  function summaryScreen() {
    const ses = (J().sessions || []).find((x) => x.id === c.ui.session_summary); if (!ses) { c.ui.session_summary = null; return ''; }
    const K = FEEL.COPY, v = c.progress.data(), rs = (ses.results || []).map((id) => (J().results || []).find((x) => x.id === id)).filter(Boolean), anim = sumAnim(ses.id); let i = 4;
    const hitOf = (r) => { const g = gameOf(r.game), inf = info(g.id); return inf.target != null && (g.better === 'lower' ? r.score <= inf.target : r.score >= inf.target); };
    const rows = rs.map((r) => { const g = gameOf(r.game), t = tierOf(g, r), inf = info(g.id), lower = g.better === 'lower', hit = hitOf(r);
      return `<div ${sumAt(anim, 'gp-sumrow', i++)}><div><b>${esc(g.name)}</b><div class="small muted">${hit ? '✓ hit the target' : inf.target != null ? `target ${sc(inf.target)}${lower ? ' or fewer' : '+'}` : ''}</div></div><div class="gp-sumscore"><b>${sc(r.score)}</b>${tierChip(t?.tier)}</div></div>`; }).join('');
    const hits = rs.filter(hitOf).length, total = rs.length, pot = v.fc.ok ? v.fc.potential : null, stNow = v.st ? v.st.current : 0;
    return `<div class="card gp-res gp-rv" id="gpRoot" data-sid="${esc(ses.id)}" data-hits="${hits}" data-total="${total}"${anim ? ' data-sumreveal="1"' : ''}>
      <div class="gp-hero"><canvas class="gp-confetti" id="gpConf" aria-hidden="true"></canvas>
        <div ${sumAt(anim, 'gp-rname', 0)}>${total} game${total === 1 ? '' : 's'} · about ${ses.minutes} min</div>
        <div ${sumAt(anim, `gp-rverdict ${total && hits === total ? 'met' : ''}`, 1)} id="gpVerdictL">${esc(K.session.done)}</div>
        <div ${sumAt(anim, 'gp-score', 2)}><b id="gpSNum" data-to="${hits}">${hits}</b><span> / ${total}</span></div>
        <div ${sumAt(anim, 'gp-rlevel', 3)}>${esc(K.session.hit)}</div></div>
      <div class="gp-rbody">${rewardChips(anim, i, { stNow, stBefore: Number.isFinite(ses.st_before) ? ses.st_before : stNow, pot, potFrom: ses.pot_before })}
        <div class="gp-sumrows">${rows}</div>
        <div ${sumAt(anim, 'gp-rbtn', i + 6)}><button class="btn" data-gpdone>${esc(K.actions.done)}</button></div></div></div>`;
  }
  // count-ups and the sound for a summary, once: the score counts up, then the sound (and confetti when every target was hit) and the rewards count
  function revealSummary() {
    const root = $('#gpRoot[data-sumreveal]'); if (!root) return; const id = root.dataset.sid; root.removeAttribute('data-sumreveal'); c.ui.sum_seen = id; c.saveUi();
    const ms = FEEL.revealMs, hits = Number(root.dataset.hits), total = Number(root.dataset.total), kind = root.dataset.kind || 'session', live = () => $('#gpRoot')?.dataset.sid === id, at = (t, f) => later(t, () => { if (live()) f(); });
    const num = $('#gpSNum'), st = $('#gpSStreak'), pot = $('#gpSPot'), good = kind === 'test' ? Number(root.dataset.better) > 0 : total > 0 && hits === total;
    if (ms(100) > 0) { if (num) num.textContent = '0'; if (st) st.textContent = st.dataset.from; if (pot) pot.textContent = fmt(Number(pot.dataset.from), 1); }
    at(ms(180), () => num && FEEL.countUp(num, 0, Number(num.dataset.to), ms(600)));
    at(ms(900), () => {
      FEEL.play(good ? (kind === 'test' ? 'pb' : 'win') : 'finish'); if (good) { FEEL.confetti($('#gpConf')); $('#gpVerdictL')?.classList.remove('fx-rise'); FEEL.pulse($('#gpVerdictL'), 'pop'); }
      if (st && Number(st.dataset.to) > Number(st.dataset.from)) { FEEL.countUp(st, Number(st.dataset.from), Number(st.dataset.to), ms(500)); $('#gpSStreakBox')?.classList.remove('fx-rise'); FEEL.pulse($('#gpSStreakBox'), 'flame'); }
      if (pot && Number(pot.dataset.to) < Number(pot.dataset.from)) FEEL.countUp(pot, Number(pot.dataset.from), Number(pot.dataset.to), ms(700), (v) => fmt(v, 1));
    });
    at(ms(1800), () => $('#gpRoot')?.setAttribute('data-revealed', '1'));
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
    const id = `test${Date.now()}`; J().session_run = { id, kind: 'test', minutes: ST.TEST_MINUTES, queue: [...ST.TEST_GAMES], i: 0, results: [], started: new Date().toISOString(), total: ST.TEST_MINUTES, skill: null, ...startMarks() };
    await start(ST.TEST_GAMES[0], { session_id: id });
  }
  function testSummary() {
    const t = (J().skills_tests || []).find((x) => x.id === c.ui.test_summary); if (!t) { c.ui.test_summary = null; return ''; }
    const K = FEEL.COPY, prev = lastOf(t), cmp = ST.compare(t, prev), rated = cmp.filter((x) => x.now !== null), anim = sumAnim(t.id); let i = 4;
    const better = prev ? rated.filter((x) => x.change !== null && x.change >= 0.5).length : 0;
    const games_ = ST.TEST_GAMES.map((id) => { const pg = t.per_game[id], g = gameOf(id); return pg ? `<div ${sumAt(anim, 'gp-sumrow', i++)}><div><b>${esc(g?.name || id)}</b><div class="small muted">${esc(pg.label || '')}</div></div><div class="gp-sumscore"><b>${sc(pg.score)}</b></div></div>` : ''; }).join('');
    const radar = (ids) => [{ type: 'scatterpolar', r: rated.map((x) => ST.radarValue(x.now)), theta: rated.map((x) => x.title), fill: 'toself', name: 'This test', line: { color: c.P.accent } },
      ...(prev ? [{ type: 'scatterpolar', r: rated.map((x) => ST.radarValue(x.before)), theta: rated.map((x) => x.title), fill: 'none', name: `Last test (${prev.date})`, line: { color: c.P.muted, dash: 'dot' } }] : [])];
    const big = prev ? better : rated.length, of = prev ? rated.length : 0;
    return `<div class="card gp-res gp-rv" id="gpRoot" data-sid="${esc(t.id)}" data-kind="test" data-hits="${big}" data-total="${rated.length}" data-better="${better}"${anim ? ' data-sumreveal="1"' : ''}>
      <div class="gp-hero"><canvas class="gp-confetti" id="gpConf" aria-hidden="true"></canvas>
        <div ${sumAt(anim, 'gp-rname', 0)}>${esc(t.date)}</div>
        <div ${sumAt(anim, `gp-rverdict ${better > 0 ? 'met' : ''}`, 1)} id="gpVerdictL">${esc(K.session.testDone)}</div>
        <div ${sumAt(anim, 'gp-score', 2)}><b id="gpSNum" data-to="${big}">${big}</b>${of ? `<span> / ${of}</span>` : ''}</div>
        <div ${sumAt(anim, 'gp-rlevel', 3)}>${esc(prev ? K.session.better(better, rated.length).replace(/^\d+ of \d+ /, '') : K.session.rated(rated.length).replace(/^\d+ /, ''))}</div>
        <div ${sumAt(anim, 'gp-rnext', 3)}>${prev ? `Compared with ${esc(prev.date)}.` : esc(K.session.first)}</div></div>
      <div class="gp-rbody"><div class="gp-radar">${rated.length >= 3 ? c.plot(radar(), { height: 270, margin: { t: 20, b: 20, l: 40, r: 40 }, polar: { radialaxis: { range: [0, 36], showticklabels: false } }, showlegend: !!prev, legend: { orientation: 'h', y: -0.1 } }) : ''}</div>
      <div class="tbl"><table><thead><tr><th>Skill</th><th>Practice handicap</th>${prev ? '<th>Last test</th><th>Change</th>' : ''}</tr></thead><tbody>${cmp.map((x) => `<tr><td>${esc(x.title)}</td><td>${x.now === null ? '<span class="muted">not in the test</span>' : dHtml(x.now)}</td>${prev ? `<td>${dHtml(x.before)}</td><td>${chg(x)}</td>` : ''}</tr>`).join('')}</tbody></table></div>
      <h3 style="margin:12px 0 4px">Your scores</h3><div class="gp-sumrows">${games_}</div>
      <p class="small muted" style="margin:10px 0">These scores are saved as normal results, so your practice levels now use them.</p><div ${sumAt(anim, 'gp-rbtn', i + 1)}><button class="btn" data-gpdone>${esc(K.actions.done)}</button></div></div></div>`;
  }


  // ------------------------------------------------------------ boss games (plan section 7): five guided games back to back, pressure finish on, four at the milestone score to pass
  const bossScores = () => Object.fromEntries((J().results || []).filter((x) => run()?.results?.includes(x.id)).map((x) => [x.game, x.score]));
  const bossTally = (n) => BS.tally(n, bossScores(), { games: games(), unitM: unitM() });
  // the five pips across the top: gold for a game at the milestone score, grey for one that was short, an outline for the one in play
  function bossBar(n, now) {
    const t = bossTally(n), K = FEEL.COPY.boss;
    return `<div class="gp-bpips" aria-label="${esc(K.pips(t.hits, t.played))}"><div class="gp-bname"><span>${esc(K.kicker)}</span><b>${esc(JR.stretchTitle(n))}</b></div><div class="gp-bdots">${t.rows.map((r) => `<i class="${r.state === 'hit' ? 'hit' : r.state === 'short' ? 'miss' : r.id === now ? 'now' : ''}"></i>`).join('')}</div></div>`;
  }
  function bossStatus(n) {
    const t = bossTally(n), K = FEEL.COPY.boss;
    return `<div class="gp-bstatus"><div class="gp-bdots">${t.rows.map((r) => `<i class="${r.state === 'hit' ? 'hit' : r.state === 'short' ? 'miss' : ''}"></i>`).join('')}</div><p class="small" style="margin:6px 0 0">${esc(t.over ? (t.passed ? K.reached(t.hits, t.need) : K.finished(t.hits, t.need)) : t.passed ? K.reached(t.hits, t.need) : t.possible ? K.status(t.hits, t.need, t.left) : K.outOfReach)}</p></div>`;
  }
  async function startBoss(n) {
    const v = c.progress.data(), st = v.jr.stretches.find((x) => x.n === n); if (!st || st.boss.state !== 'ready') return;
    if (!BS.canAttempt(J().journey?.bosses || [], n, today()).ok) return;
    const id = `boss${Date.now()}`, targets = Object.fromEntries(BS.BOSS_GAMES.map((g) => [g, JR.milestoneScore(g, n, unitM())]));
    J().session_run = { id, kind: 'boss', boss: n, targets, minutes: BS.BOSS_MINUTES, queue: [...BS.BOSS_GAMES], i: 0, results: [], started: new Date().toISOString(), total: BS.BOSS_MINUTES, skill: null };
    await start(BS.BOSS_GAMES[0], { session_id: id, boss: n, target: targets[BS.BOSS_GAMES[0]] });
  }
  function bossSummary() {
    const b = (J().journey?.bosses || []).find((x) => x.id === c.ui.boss_summary); if (!b) { c.ui.boss_summary = null; return ''; }
    const K = FEEL.COPY.boss, t = BS.tally(b.n, b.scores, { games: games(), unitM: unitM() }), jr = c.progress.data().jr, nxt = jr.current, shortRows = t.rows.filter((r) => r.state === 'short');
    const rows = t.rows.map((r) => `<div class="gp-sumrow"><div><b>${esc(r.name)}</b><div class="small muted">${r.state === 'hit' ? `✓ ${esc(K.hit)}` : r.state === 'short' ? esc(K.shortBy(sc(r.short))) : ''} · ${esc(K.target(sc(r.target)))}${r.better === 'lower' ? ' or fewer' : '+'}</div></div><div class="gp-sumscore"><b>${r.score === null ? '–' : sc(r.score)}</b></div></div>`).join('');
    const reveal = c.ui.boss_seen ? '' : ' data-reveal="1"';
    if (b.passed) return `<div class="card gp-res gp-boss gp-bwin" id="gpRoot" data-boss="1"${reveal}><div class="gp-hero"><canvas class="gp-confetti" id="gpConf" aria-hidden="true"></canvas>
      <div class="gp-rname">${esc(K.passedKicker)}</div><div class="gp-bnum fx-stamp">${esc(b.n === 0 ? 'Scratch' : b.n)}</div><div class="gp-rverdict met">${esc(JR.stretchTitle(b.n))}</div><div class="gp-rsub">${esc(K.points(LV.POINTS.boss))}</div></div>
      <div class="gp-rbody"><div class="gp-bstatus"><div class="gp-bdots">${t.rows.map((r) => `<i class="${r.state === 'hit' ? 'hit' : 'miss'}"></i>`).join('')}</div><p class="small" style="margin:6px 0 0">${esc(K.reached(t.hits, t.need))}</p></div>
      <p class="small" style="margin:10px 0">${esc(nxt ? K.nextOpen(JR.label(nxt.n)) : K.allDone)}</p>${rows}<p class="small muted" style="margin:10px 0">${esc(FEEL.COPY.journey.note)}</p>
      <div class="row"><button class="btn" data-gpdone>Continue</button></div></div></div>`;
    const practise = shortRows.map((r) => `<button type="button" class="btn sec" data-gpstart="${esc(r.id)}">${esc(K.practise(r.name))}</button>`).join('');
    return `<div class="card gp-res gp-boss" id="gpRoot"><div class="gp-hero"><div class="gp-rname">${esc(K.kicker)}</div><div class="gp-bnum">${esc(b.n === 0 ? 'Scratch' : b.n)}</div><div class="gp-rverdict">${esc(K.notYet)}</div><div class="gp-rsub">${esc(K.finished(t.hits, t.need))}</div></div>
      <div class="gp-rbody"><div class="gp-bstatus"><div class="gp-bdots">${t.rows.map((r) => `<i class="${r.state === 'hit' ? 'hit' : r.state === 'short' ? 'miss' : ''}"></i>`).join('')}</div></div>${rows}
      ${shortRows.length ? `<h3 style="margin:12px 0 6px">${esc(K.work)}</h3><div class="gp-bprac">${practise}</div>` : ''}
      <p class="small muted" style="margin:10px 0">${esc(K.again)}</p><div class="row"><button class="btn" data-gpdone>Done</button></div></div></div>`;
  }
  // the boss win: the win sound, then the tier sound, with the confetti (plan 7: the biggest celebration in the app)
  function bossReveal() {
    const root = $('#gpRoot[data-boss][data-reveal]'); if (!root) return; root.removeAttribute('data-reveal'); c.ui.boss_seen = true; c.saveUi();
    const ms = FEEL.revealMs, id = c.ui.boss_summary, live = () => $('#gpRoot[data-boss]') && c.ui.boss_summary === id;
    later(ms(250), () => { if (live()) { FEEL.play('win'); FEEL.confetti($('#gpConf')); } }); later(ms(1100), () => { if (live()) { FEEL.play('tier'); FEEL.pulse($('.gp-bnum'), 'pop'); } });
    later(ms(1800), () => { $('#gpRoot')?.setAttribute('data-revealed', '1'); });
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
    const t = tierOf(g, res)?.tier; if (t) out.tier = t.key;
    // the last game of a boss attempt carries the boss number and whether it was passed, so the leaderboard can show "passed Beat the 10"
    if (res.boss && run()?.kind === 'boss' && run().results.length >= run().queue.length) { const sc = Object.fromEntries((J().results || []).filter((x) => run().results.includes(x.id)).map((x) => [x.game, x.score])); Object.assign(out, BS.shareFields(res.boss, BS.tally(res.boss, sc, { games: games(), unitM: unitM() }).passed)); }
    return out;
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
    $$('[data-gpparty]').forEach((b) => b.addEventListener('click', () => partySetup(b.dataset.gpparty, !!$('#gpPressure')?.checked))); $$('[data-gphand]').forEach((b) => b.addEventListener('click', handedOver));
    $$('[data-gpagain]').forEach((b) => b.addEventListener('click', () => start(b.dataset.gpagain)));
    $$('[data-gpnext]').forEach((b) => b.addEventListener('click', () => start(nextGame(b.dataset.gpnext))));
    $$('[data-gpdone]').forEach((b) => b.addEventListener('click', () => { seq++; timers.forEach(clearTimeout); timers = []; c.ui.game_result = null; c.ui.session_summary = null; c.ui.boss_summary = null; c.ui.test_summary = null; c.ui.session_gap = null; c.saveUi(); c.rerender(); }));
    loadGhosts(); reveal(); bossReveal(); loadLeague();
    $$('[data-gpboss]').forEach((b) => b.addEventListener('click', () => startBoss(Number(b.dataset.gpboss))));
    $$('[data-gptest]').forEach((b) => b.addEventListener('click', startTest));
    $$('[data-gpses]').forEach((b) => b.addEventListener('click', () => startSession(Number(b.dataset.gpses))));
    $$('[data-gpdaily]').forEach((b) => b.addEventListener('click', () => start(b.dataset.gpdaily)));
    $$('[data-gpwelcome]').forEach((b) => b.addEventListener('click', () => start(b.dataset.gpwelcome, { welcome_back: true, target: Number(b.dataset.wbtarget) })));
    $$('[data-gpsesnext]').forEach((b) => b.addEventListener('click', () => (run()?.kind === 'boss' ? sesNext() : sesGap()))); /* a boss runs straight on; sessions and the skills test pause between games */ $$('[data-gpgapgo]').forEach((b) => b.addEventListener('click', sesNext)); $$('[data-gpsesend]').forEach((b) => b.addEventListener('click', () => endSession(false)));
    $$('[data-pickgame]').forEach((b) => b.addEventListener('click', () => { c.ui.pg_game = b.dataset.pickgame; c.saveUi(); c.rerender(); $('#gpPlay')?.scrollIntoView({ block: 'start', behavior: FEEL.calm() ? 'auto' : 'smooth' }); }));
    revealGap(); revealSummary(); pulseFlame();
  }
  return { start, screen, gameCards, launcher, wire, draft, info, duelTarget, canGuide, nextGame, sessionCard, dailyCard, homeCard, welcomeInfo, dailyPick, startSession, startTest, startBoss, testCard, afterResult, shareInfo };
}
