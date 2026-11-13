// Practice → Progress: where your handicap is heading, milestones, this week's goal and streak,
// short- and long-game roadmaps, and badges. A summary card goes on Home.
import * as F from './features.js';
import * as B from './bench.js';
import * as CO from './coach.js';
import * as SK from './skills.js';
import * as GM from './games.js';

export function registerProgress(c) {
  const { A, esc, fmt, plot, note } = c;
  const J = () => c.state.journal;
  const games = () => [...F.DEFAULT_GAMES, ...(J().games || [])];
  const unitM = () => (c.UNIT === 'yd' ? 0.9144 : 1);
  const n1 = (v, d = 1) => (A.isNum(v) ? fmt(v, d) : '–');
  const sc = (v) => (A.isNum(v) ? (Number.isInteger(v) ? String(v) : fmt(v, 1)) : '–');
  const pct = (p) => (p === null || p === undefined ? '–' : p >= 0.995 ? '99%+' : p < 0.005 ? '<1%' : `${Math.round(p * 100)}%`);

  let memo = { ds: null, j: null, v: null };
  function data() {
    const key = JSON.stringify([J().results?.length, J().sessions?.length, J().course_challenges?.length, J().wedge?.entries?.length, J().notes?.length, c.UNIT, J().focus?.pinned, Math.floor(Date.now() / 36e5)]);
    if (memo.ds === c.DS && memo.j === key) return memo.v;
    const ds = c.DS, r18 = ds.rounds.filter((r) => r.format === '18');
    const fs = r18.length >= 8 ? A.findings(A.filterDataset(ds, { formats: ['18'], lastN: 20 }), c.UNIT) : [];
    const savings = fs.slice(0, 2).reduce((t, f) => t + Math.max(0, f.strokes_per_round || 0), 0);
    const quick = fs.slice(0, 3).reduce((t, f) => t + Math.max(0, f.strokes_per_round || 0), 0);
    const off0 = [...(c.state.settings.handicaps || [])].sort((a, b) => a.date.localeCompare(b.date)).pop()?.handicap_index;
    const diffs = ds.rounds.filter((r) => A.isNum(r.differential_for_index) && r.date).sort((a, b) => a.date.localeCompare(b.date)).map((r) => r.differential_for_index);
    const idx = diffs.length >= 3 ? A.whsIndex(diffs.slice(-20)) : off0;
    const sk = SK.skillRatings({ rounds: ds.rounds, holes: ds.holes, shots: ds.shots, results: J().results || [], games: games(), unitM: unitM(), findings: fs, pinned: J().focus?.pinned || [] });
    const plan = CO.potentialPlan({ ratings: sk, results: J().results || [], rounds: ds.rounds, index: A.isNum(idx) ? idx : null, baselines: J().potential_base || {}, challenges: J().course_challenges || [] });
    const fc = CO.forecast(ds.rounds, { savings, gain: plan.gain });
    // remember the strokes value when a target is first hit, so a sub-skill the course later confirms keeps its credit
    const fresh = plan.ledger.filter((x) => x.hits > 0 && !(J().potential_base || {})[x.sub]);
    if (fresh.length) { J().potential_base = { ...(J().potential_base || {}), ...Object.fromEntries(fresh.map((x) => [x.sub, x.base_strokes])) }; c.S.saveJournal(c.state); }
    const ms = CO.milestones(ds.rounds, { shift: 0 });
    const ms6 = fc.ok ? CO.milestones(ds.rounds, { shift: (fc.potential - fc.current) }) : null;
    const g = games(), res = J().results || [];
    const off = [...(c.state.settings.handicaps || [])].sort((a, b) => a.date.localeCompare(b.date)).pop()?.handicap_index;
    const hcp = A.isNum(fc.current) ? fc.current : A.isNum(off) ? off : null;
    const short = CO.roadmap(CO.SHORT_GAMES, res, g, unitM(), hcp), long = CO.roadmap(CO.LONG_GAMES, res, g, unitM(), hcp);
    const st = CO.streaks(CO.practiceDates(J()));
    const goals = CO.weeklyGoal({ findings: fs, roadmaps: [...short, ...long], results: res, games: g, assigned: CO.assignments(J().notes) });
    const bd = [...CO.badges({ rounds: ds.rounds, holes: ds.holes, journal: J(), roadmaps: [...short, ...long] }), ...GM.tierBadges(g, res, unitM()).filter((b) => b.earned)];
    memo = { ds: c.DS, j: key, v: { fs, sk, plan, savings, fc, ms, ms6, short, long, st, goals, bd } };
    return memo.v;
  }

  // ---------------------------------------------------------------- sections
  function forecastCard(v) {
    const fc = v.fc;
    if (!fc.ok) return `<div class="card prog-hero"><h2>Your potential in 6 months</h2><p class="muted">Play ${fc.need} more round${fc.need === 1 ? '' : 's'} with a score differential (18 holes, or 9 holes once you have an index) and GolfIQ will show where your handicap can get to.</p></div>`;
    const hist = c.DS.rounds.filter((r) => A.isNum(r.index_after) && r.date && Date.parse(r.date) > Date.now() - 365 * 864e5);
    const d0 = new Date(), dAt = (m) => new Date(d0.getTime() + m * 30.4 * 864e5).toISOString().slice(0, 10);
    const tr = [
      { x: hist.map((r) => r.date), y: hist.map((r) => r.index_after), mode: 'lines', name: 'Your index', line: { color: '#0a3d2b', width: 2.5 } },
      { x: fc.path.map((p) => dAt(p.month)), y: fc.path.map((p) => p.likely), mode: 'lines', name: 'Without a plan', line: { color: '#9a9a8a', width: 1.5, dash: 'dot' } },
      { x: fc.potential_path.map((p) => dAt(p.month)), y: fc.potential_path.map((p) => p.high), mode: 'lines', line: { width: 0 }, showlegend: false, hoverinfo: 'skip' },
      { x: fc.potential_path.map((p) => dAt(p.month)), y: fc.potential_path.map((p) => p.low), mode: 'lines', fill: 'tonexty', fillcolor: 'rgba(27,127,75,.18)', line: { width: 0 }, name: 'Potential range' },
      { x: fc.potential_path.map((p) => dAt(p.month)), y: fc.potential_path.map((p) => p.likely), mode: 'lines+markers', name: 'Your potential', line: { color: '#1b7f4b', width: 3 }, marker: { size: 5 } },
    ];
    const pl = v.plan, drop = fc.current - fc.potential, left = pl.locked, tot = Math.max(0.01, pl.base + pl.momentum + pl.unlocked + left);
    const when = new Date(d0.getTime() + 182 * 864e5).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const seg = (cls, x) => (x > 0.004 ? `<i class="${cls}" style="width:${(100 * x / tot).toFixed(1)}%"></i>` : '');
    const top = pl.ledger[0];
    return `<div class="card prog-hero"><h2>Your potential in 6 months</h2>
      <div class="prog-big"><div><span>Now</span><b>${n1(fc.current)}</b></div><i>→</i><div><span>Potential</span><b class="good">${n1(fc.potential)}</b><small>by ${esc(when)}</small></div></div>
      <p class="prog-claim">A target of <b>${n1(drop)} shot${Math.abs(drop - 1) < 0.05 ? '' : 's'}</b> off your handicap – and you decide how much of it you earn.</p>
      <div class="pot-bar" aria-label="Where your potential comes from">${seg('base', pl.base)}${seg('mom', pl.momentum)}${seg('unl', pl.unlocked)}${seg('lock', left)}</div>
      <div class="pot-key"><span><i class="base"></i>Base <b>${n1(pl.base)}</b></span><span><i class="mom"></i>Momentum <b>${n1(pl.momentum)}</b></span><span><i class="unl"></i>Unlocked <b>${n1(pl.unlocked)}</b></span>${left >= 0.05 ? `<span><i class="lock"></i>Up to <b>${n1(left)}</b> more to unlock</span>` : ''}</div>
      ${top ? `<p class="small"><b>Next:</b> ${esc(top.next)} <button class="btn sec gbtn" data-record="${esc(top.game)}">Play ${esc(top.game_name)}</button></p>` : '<p class="small">Play a few rounds with shot tracking and your focus areas will show the practice games that unlock more.</p>'}
      ${plot(tr, { height: 250, showlegend: true, legend: { orientation: 'h', y: -0.25 }, yaxis: { title: { text: 'Index' } } })}
      <details><summary class="small">How this works</summary>${note(`Your potential is a target to play for, not a promise. It starts with a small base (${n1(pl.base)} shot) that everyone gets, adds momentum (+${CO.POTENTIAL.momentum2} when you practise at least two of your focus skills, ${CO.POTENTIAL.momentum3} more for a third) while you keep it up in the last ${CO.POTENTIAL.active_days} days, and unlocks the rest as you hit practice-game targets: hit a target ${CO.POTENTIAL.hits_needed} times in ${CO.POTENTIAL.hit_days} days and you earn half of what that sub-skill is worth, all of it once your rounds show it. Total gain is capped at ${CO.POTENTIAL.total_cap} shots or ${Math.round(CO.POTENTIAL.pct_cap * 100)}% of your index. "Without a plan" simulates your current level and trend (${fc.rounds_ahead} rounds at your pace, WHS best 8 of 20).`)}</details>
      ${pl.ledger.length ? `<details><summary class="small">Your unlocks</summary>${pl.ledger.map((x) => `<p class="small" style="margin:6px 0"><b>${esc(x.title)}</b> · ${x.hits >= x.need ? 'target hit' : `${n1(x.hits)} of ${x.need} hits`} · <b class="good">−${n1(x.credit)}</b> of ${n1(x.max_credit)}<br><span class="muted">${esc(x.next)}</span></p>`).join('')}</details>` : ''}</div>`;
  }
  // Level up: each skill has its own handicap; tap a skill to see its sub-skills, the target-level numbers and the games that train them
  const NOUN = { 'putting.short': 'holes', 'putting.mid': 'holes', 'putting.lag': 'holes', 'short.updown': 'holes', 'short.chip': 'shots', 'approach.gir': 'holes', 'approach.wedge': 'shots',
    'approach.mid': 'shots', 'approach.long': 'shots', 'driving.distance': 'drives', 'driving.penalties': 'tee shots', 'driving.accuracy': 'holes' };
  const hc = (x) => (A.isNum(x) ? String(Math.round(x)) : '–');
  const val = (x, u) => (!A.isNum(x) ? '–' : u === '%' ? `${Math.round(x)}%` : u === '/rd' ? `${n1(x)} a round` : u === 'm' ? `${x >= 100 ? Math.round(x) : n1(x)} m` : `${Math.round(x)} ${u}`);
  const gameBtn = (g) => {
    const tab = g.id === 'combine' ? 'combine' : g.id === 'range-course' ? 'range' : null, lower = g.better === 'lower';
    const label = A.isNum(g.target) ? `${esc(g.name)} · score ${sc(g.target)}${lower ? ' or less' : '+'}` : esc(g.name);
    return `<button class="btn sec gbtn" ${tab ? `data-prtab="${tab}"` : `data-record="${esc(g.id)}"`}>${label}</button>`;
  };
  function subRow(s, skill) {
    const has = A.isNum(s.you), tv = s.target_value, ahead = has && s.strokes < 0.05 && !s.context_only;
    const w = has && A.isNum(tv) && tv > 0 ? Math.max(4, Math.min(100, (s.higher ? s.you / tv : tv / Math.max(s.you, 1e-9)) * 100)) : has ? 100 : 0;
    const head = s.hcp !== null ? `${hc(s.hcp)} handicap${s.source === 'practice' ? ' <small class="muted">from practice</small>' : ''}` : '<small class="muted">not enough data yet</small>';
    const gain = s.context_only ? '<span class="muted">for context</span>' : !has ? '' : ahead ? '<span class="good">already there ✓</span>' : `<b class="good">≈ ${n1(s.strokes)}</b> shots a round`;
    return `<div class="lvl ${ahead ? 'ahead' : ''}"><div class="lvl-h"><b>${esc(s.title)}</b><span>${head}</span></div>
      ${has ? `<div class="bar"><i style="width:${Math.round(w)}%"></i></div>
      <p class="small">You <b>${val(s.you, s.unit)}</b>${A.isNum(tv) ? ` · a ${skill.target} handicapper${s.assumed ? ' <small class="muted">(assumed)</small>' : ''} <b>${val(tv, s.unit)}</b>` : ''} · ${gain}</p>`
      : `<p class="small muted">${s.n ? `Only ${s.n} ${NOUN[s.full_key]} so far` : `No ${NOUN[s.full_key]} yet`} – a few more rounds with shot tracking will rate this.</p>`}
      <p class="small muted" style="margin:0">${has ? `From ${s.n} ${NOUN[s.full_key]}. ` : ''}${A.isNum(s.practice_hcp) ? `Practice level ${hc(s.practice_hcp)}. ` : ''}${esc(s.how)}</p>
      ${!ahead && s.games.length ? `<div class="lvl-g">${s.games.map(gameBtn).join('')}</div>` : ''}</div>`;
  }
  function levelUpCard(v = data(), { link = false } = {}) {
    const sk = v.sk; if (!sk) return '';
    const anyRated = sk.skills.some((s) => s.rated), open = sk.skills.find((s) => s.key === c.ui.lv_skill), pinned = J().focus?.pinned || [];
    if (!anyRated && !(J().results || []).length) return `<div class="card"><h2>Level up</h2><p class="muted">Play ${Math.max(1, SK.RATING.min_rounds - sk.rounds)} more 18-hole round${SK.RATING.min_rounds - sk.rounds === 1 ? '' : 's'} with a scorecard and each skill (putting, short game, approach, driving) gets its own handicap, with games to improve it.</p></div>`;
    const tile = (s) => `<button class="skill-tile ${s.focus ? 'focus' : ''} ${open === s ? 'open' : ''}" data-skill="${s.key}" aria-expanded="${open === s}">
      <span class="st-top"><b>${esc(s.title)}</b>${s.focus ? '<em class="tag">Focus</em>' : ''}</span>
      <span class="st-hcp">${hc(s.hcp)}</span>
      <span class="st-go">${s.rated ? `${hc(s.hcp)} → ${s.target}` : 'not rated yet'}</span>
      <span class="small ${s.strokes >= 0.05 ? 'good' : 'muted'}">${s.rated ? (s.strokes >= 0.05 ? `≈ ${n1(s.strokes)} shots a round` : 'nothing big to win') : 'needs more rounds'}</span>
      ${A.isNum(s.practice_hcp) ? `<span class="small muted">practice level ${hc(s.practice_hcp)}</span>` : ''}</button>`;
    const detail = open ? `<div class="skill-detail"><div class="rv-h"><h3 style="margin:0">${esc(open.title)}</h3>${open.rated ? `<span class="small muted">${hc(open.hcp)} → ${open.target} handicap</span>` : ''}</div>
      ${open.subs.map((s) => subRow(s, open)).join('')}
      <p style="margin:8px 0 0"><button class="btn sec gbtn" data-pin="${open.key}">${pinned.includes(open.key) ? 'Stop pinning this focus' : open.focus ? 'Pin as a focus area' : 'Make this a focus area'}</button></p></div>` : '';
    return `<div class="card" id="levelUp"><h2>Level up</h2>
      <p class="small">Every skill has its own handicap, rated against what golfers of each level typically do. Aim for the next level: ${sk.skills.some((s) => s.rated) ? 'three shots better' : 'play five full rounds to rate them'}. Tap a skill to see why.</p>
      <div class="skill-grid">${sk.skills.map(tile).join('')}</div>${detail}
      ${link ? '<p class="small"><a href="#practice" data-practice="progress">See your 6-month potential →</a></p>' : ''}
      ${note(`Your last ${sk.rounds} 18-hole rounds against Shot Scope data (putting make %, approach proximity, up-and-down %, ${esc(CO.STANDARD_SOURCE[0].split('(')[1].replace(')', ''))}; sources: ${[...B.SOURCES, CO.STANDARD_SOURCE].map(([t, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t.split(' (')[0])}</a>`).join(', ')}). Chip proximity, tee penalties and the Landing zone and Imaginary fairways games have no published standard, so their levels are assumptions worked out from the tables above (marked "assumed"). Proximity compares your median finish with the published averages. Practice level comes from your last 5 game scores and is shown separately, because practice is easier than the course. Strokes are what reaching the next level would save per round; skills overlap a little, so treat the total as a target.`)}</div>`;
  }
  function wire() {
    c.$$('[data-skill]').forEach((b) => b.addEventListener('click', () => { c.ui.lv_skill = c.ui.lv_skill === b.dataset.skill ? null : b.dataset.skill; c.saveUi(); c.rerender(); }));
    c.$$('[data-pin]').forEach((b) => b.addEventListener('click', async () => {
      const j = J(), cur = j.focus?.pinned || [], k = b.dataset.pin; j.focus = { ...(j.focus || {}), pinned: cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k].slice(-2) };
      await c.S.saveJournal(c.state); c.rerender();
    }));
  }
  function milestonesCard(v) {
    const rows = v.ms.rows, m6 = v.ms6?.rows;
    const card = (r, i) => {
      const nxt = v.ms.next === r, p6 = m6 ? m6[i].p_round : null;
      return `<div class="ms ${r.first ? 'done' : nxt ? 'next' : ''}"><div class="ms-h"><b>${r.label}</b>${r.first ? '<span class="pill good">done</span>' : nxt ? '<span class="pill mid">next</span>' : ''}</div>
        ${r.first ? `<p class="small">First: <b>${r.first.gross}</b> on ${esc(r.first.date)}${r.first.course ? ` at ${esc(r.first.course)}` : ''}</p><p class="small muted">Chance any round now: ${pct(r.p_round)}</p>`
    : r.p_round === null ? '<p class="small muted">Needs 5 full rounds.</p>'
      : `<div class="bar"><i style="width:${Math.min(100, Math.round(r.p_round * 100))}%"></i></div><p class="small">Chance in any one round: <b>${pct(r.p_round)}</b> · in your next 10: <b>${pct(r.p_next10)}</b>${r.rounds_expected && r.rounds_expected < 200 ? ` · about 1 in ${Math.round(r.rounds_expected)}` : ''}</p>${p6 !== null && p6 > r.p_round + 0.01 ? `<p class="small good">At your 6-month potential: <b>${pct(p6)}</b> a round</p>` : ''}`}</div>`;
    };
    return `<div class="card"><h2>Milestones</h2><div class="ms-grid">${rows.map(card).join('')}</div>
      <div class="ms-grid" style="margin-top:8px">${v.ms.stableford.map((s) => `<div class="ms ${s.first ? 'done' : ''}"><div class="ms-h"><b>${s.label}</b>${s.first ? '<span class="pill good">done</span>' : ''}</div><p class="small">${s.first ? `First on ${esc(s.first.date)} (${s.first.stableford_round} pts)` : `Best so far: ${A.isNum(s.best) ? s.best : '–'} pts`}</p></div>`).join('')}</div>
      ${note(`From your last ${v.ms.n} full rounds: your trend-adjusted level is about ${n1(v.ms.level, 0)} with a spread of ±${n1(v.ms.sd)} shots, so this is how often a score below each mark turns up. Gross scores, so harder courses count against you.`)}</div>`;
  }
  function weekCard(v) {
    const st = v.st, goal = (g) => {
      const lower = g.better === 'lower', p = !A.isNum(g.target) ? null : g.best === null ? 0 : lower ? Math.min(1, g.target / g.best) : Math.min(1, g.best / g.target);
      return `<div class="goal ${g.done ? 'done' : ''}"><div class="ms-h"><b>${esc(g.name)}</b><span class="pill ${g.done ? 'good' : ''}">${g.done ? 'done ✓' : `${g.attempts}/${g.per_week} sessions`}</span></div>
        <p class="small">${A.isNum(g.target) ? `Target: ${lower ? '' : ''}${sc(g.target)} ${esc(g.unit || '')}${lower ? ' or fewer' : ' or better'}` : 'Set a personal best'} · best this week: <b>${sc(g.best)}</b></p>
        ${p !== null ? `<div class="bar"><i style="width:${Math.round(p * 100)}%"></i></div>` : ''}<p class="small muted">${esc(g.why)}</p>
        <p style="margin:6px 0 0"><button class="btn sec sm" data-record="${esc(g.game)}">Record a score</button></p></div>`;
    };
    return `<div class="card"><div class="rv-h"><h2 style="margin:0">This week</h2><span class="small muted">${B.isoWeek().replace('-W', ' · week ')}</span></div>
      ${v.goals.map(goal).join('')}
      <div class="streak"><div><b class="gold">${st.current}</b><span>week streak</span></div><div><b>${st.best}</b><span>best</span></div>
        <div class="strip12">${st.strip.map((w) => `<i class="${w.days ? (w.days >= 3 ? 'h3' : w.days === 2 ? 'h2' : 'h1') : ''}" title="${esc(w.week)}: ${w.days} day(s)"></i>`).join('')}</div></div>
      <p class="small muted">${st.thisWeek ? 'Practised this week – streak safe.' : st.current ? 'Practise before Sunday to keep your streak.' : 'Any game score, practice log or wedge session this week starts a streak.'}</p></div>`;
  }
  function ladder(g) {
    const lower = g.better === 'lower', fmtT = (t) => sc(Math.round(t * 10) / 10);
    return `<div class="lad"><div class="ms-h"><b>${esc(g.name)}</b><span class="small muted">${g.n ? `recent ${g.id === 'range-course' ? `${g.current > 0 ? '+' : ''}${n1(g.current)} /18` : sc(Math.round(g.current * 10) / 10)}${A.isNum(g.level) ? ` · ≈ ${g.level <= 0 ? 'scratch' : `${Math.round(g.level)} hcp`}` : ''}` : 'not played yet'}</span></div>
      <div class="rungs">${g.rungs.map((r) => `<div class="rung ${r.reached ? 'on' : ''} ${g.next === r ? 'nx' : ''}"><span>${r.label}</span><b>${g.id === 'range-course' ? `+${fmtT(r.target)}` : fmtT(r.target)}</b></div>`).join('')}</div>
      <p class="small" style="margin:6px 0 0">${g.next ? `Next: <b>${g.id === 'range-course' ? `+${fmtT(g.next.target)} or better over 18` : `${fmtT(g.next.target)}${lower ? ' or fewer' : ' or better'}`}</b> on average reaches <b>${g.next.label.toLowerCase()}</b> level.` : 'Top of the ladder – keep it there.'} <button class="btn sec sm" ${g.id === 'combine' ? 'data-prtab="combine"' : g.id === 'range-course' ? 'data-prtab="range"' : `data-record="${esc(g.id)}"`}>${g.n ? 'Play' : 'Try it'}</button></p></div>`;
  }
  function roadmapCard(title, list, blurb) {
    return `<div class="card"><h2>${title}</h2><p class="small">${blurb}</p>${list.map(ladder).join('')}
      ${note('Each rung is what golfers of that standard typically score in the game, worked out from Shot Scope on-course data (putting make %, up-and-down %, approach proximity). Your position uses the average of your last 5 scores. Breaking 100 regularly ≈ 24 handicap, 90 ≈ 14, 80 ≈ 5. Practice is easier than the course, so aim a rung above where you play.')}</div>`;
  }
  function badgesCard(v) {
    const got = v.bd.filter((b) => b.earned).length;
    return `<div class="card"><h2>Badges <span class="small muted">${got} of ${v.bd.length}</span></h2><div class="badges">${v.bd.map((b) => `<div class="bdg ${b.earned ? 'on' : ''}"><i>${b.earned ? '★' : '☆'}</i><b>${esc(b.name)}</b><span>${esc(b.desc)}</span><small>${b.earned ? (b.earned === 'yes' ? 'earned' : esc(b.earned)) : esc(b.progress || '')}</small></div>`).join('')}</div></div>`;
  }

  function page() {
    const v = data();
    return `${forecastCard(v)}${levelUpCard(v)}${weekCard(v)}${milestonesCard(v)}
      ${roadmapCard('Short-game roadmap', v.short, 'Putting and chipping games, with the score that matches each scoring level.')}
      ${roadmapCard('Long-game roadmap', v.long, 'Range games, the monthly combine and range rounds.')}
      ${badgesCard(v)}`;
  }
  function homeCard() {
    if (!c.DS.rounds.length && !(J().results || []).length) return '';
    const v = data(), nx = v.ms.next, g = v.goals[0];
    return `<a class="card prog-home" href="#practice" data-practice="progress"><h2>Progress</h2><div class="ph-row">
      ${v.fc.ok ? `<div><span>Potential in 6 months</span><b class="good">${n1(v.fc.potential)}</b><small>now ${n1(v.fc.current)}</small></div>` : ''}
      ${nx && nx.p_round !== null ? `<div><span>${nx.label}</span><b>${pct(nx.p_round)}</b><small>chance a round</small></div>` : ''}
      <div><span>Streak</span><b>${v.st.current}</b><small>week${v.st.current === 1 ? '' : 's'}</small></div></div>
      ${g ? `<p class="small" style="margin:8px 0 0">This week: <b>${esc(g.name)}</b>${A.isNum(g.target) ? ` – target ${sc(g.target)}` : ''} · ${g.attempts}/${g.per_week} sessions${g.done ? ' ✓' : ''}</p>` : ''}</a>`;
  }
  return { page, homeCard, data, levelUpCard, wire };
}
