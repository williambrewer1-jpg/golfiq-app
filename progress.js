// Practice → Progress: where your handicap is heading, milestones, this week's goal and streak,
// short- and long-game roadmaps, and badges. A summary card goes on Home.
import * as F from './features.js';
import * as B from './bench.js';
import * as CO from './coach.js';

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
    const key = JSON.stringify([J().results?.length, J().sessions?.length, J().wedge?.entries?.length, J().notes?.length, c.UNIT]);
    if (memo.ds === c.DS && memo.j === key) return memo.v;
    const ds = c.DS, r18 = ds.rounds.filter((r) => r.format === '18');
    const fs = r18.length >= 8 ? A.findings(A.filterDataset(ds, { formats: ['18'], lastN: 20 }), c.UNIT) : [];
    const savings = fs.slice(0, 2).reduce((t, f) => t + Math.max(0, f.strokes_per_round || 0), 0);
    const fc = CO.forecast(ds.rounds, { savings });
    const ms = CO.milestones(ds.rounds, { shift: 0 });
    const ms6 = fc.ok ? CO.milestones(ds.rounds, { shift: (fc.likely - fc.current) }) : null;
    const g = games(), res = J().results || [];
    const off = [...(c.state.settings.handicaps || [])].sort((a, b) => a.date.localeCompare(b.date)).pop()?.handicap_index;
    const hcp = A.isNum(fc.current) ? fc.current : A.isNum(off) ? off : null;
    const short = CO.roadmap(CO.SHORT_GAMES, res, g, unitM(), hcp), long = CO.roadmap(CO.LONG_GAMES, res, g, unitM(), hcp);
    const st = CO.streaks(CO.practiceDates(J()));
    const goals = CO.weeklyGoal({ findings: fs, roadmaps: [...short, ...long], results: res, games: g, assigned: CO.assignments(J().notes) });
    const bd = CO.badges({ rounds: ds.rounds, holes: ds.holes, journal: J(), roadmaps: [...short, ...long] });
    memo = { ds: c.DS, j: key, v: { fs, savings, fc, ms, ms6, short, long, st, goals, bd } };
    return memo.v;
  }

  // ---------------------------------------------------------------- sections
  function forecastCard(v) {
    const fc = v.fc;
    if (!fc.ok) return `<div class="card prog-hero"><h2>Your handicap in 6 months</h2><p class="muted">Needs ${fc.need} more round${fc.need === 1 ? '' : 's'} with a score differential (18 holes, or 9 holes once you have an index) to project from.</p></div>`;
    const hist = c.DS.rounds.filter((r) => A.isNum(r.index_after) && r.date && Date.parse(r.date) > Date.now() - 365 * 864e5);
    const d0 = new Date(), dAt = (m) => new Date(d0.getTime() + m * 30.4 * 864e5).toISOString().slice(0, 10);
    const tr = [
      { x: hist.map((r) => r.date), y: hist.map((r) => r.index_after), mode: 'lines', name: 'Your index', line: { color: '#0a3d2b', width: 2.5 } },
      { x: fc.path.map((p) => dAt(p.month)), y: fc.path.map((p) => p.high), mode: 'lines', line: { width: 0 }, showlegend: false, hoverinfo: 'skip' },
      { x: fc.path.map((p) => dAt(p.month)), y: fc.path.map((p) => p.low), mode: 'lines', fill: 'tonexty', fillcolor: 'rgba(201,164,58,.25)', line: { width: 0 }, name: 'Likely range' },
      { x: fc.path.map((p) => dAt(p.month)), y: fc.path.map((p) => p.likely), mode: 'lines', name: 'Projection', line: { color: '#c9a43a', width: 2.5, dash: 'dot' } },
      ...(fc.optimistic_path ? [{ x: fc.optimistic_path.map((p) => dAt(p.month)), y: fc.optimistic_path.map((p) => p.likely), mode: 'lines', name: 'With your fixes', line: { color: '#1b7f4b', width: 2, dash: 'dash' } }] : []),
    ];
    const better = fc.likely < fc.current - 0.05, fix = v.fs.slice(0, 2).map((f) => f.title.toLowerCase());
    return `<div class="card prog-hero"><h2>Your handicap in 6 months</h2>
      <div class="prog-big"><div><span>Now</span><b>${n1(fc.current)}</b></div><i>→</i><div><span>Likely</span><b class="gold">${n1(fc.likely)}</b><small>${n1(fc.low)}–${n1(fc.high)}</small></div>${A.isNum(fc.optimistic) ? `<div><span>If you fix it</span><b class="good">${n1(fc.optimistic)}</b></div>` : ''}</div>
      <p class="small">${better ? 'On your current trend' : 'At your current level'} and pace (about ${n1(fc.per_month, 0)} rounds a month), your index should be around <b>${n1(fc.likely)}</b> by ${new Date(d0.getTime() + 182 * 864e5).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}.${A.isNum(fc.optimistic) && fix.length ? ` Fixing ${esc(fix.join(' and '))} (worth about ${n1(v.savings)} strokes a round) could take it to <b>${n1(fc.optimistic)}</b>.` : ''}</p>
      ${plot(tr, { height: 250, showlegend: true, legend: { orientation: 'h', y: -0.25 }, yaxis: { title: { text: 'Index' } } })}
      ${note(`A projection, not a promise: ${fc.rounds_ahead} simulated rounds per season from your recent score differentials (level ${n1(fc.level)}, round-to-round spread ±${n1(fc.sd)}), with your recent trend (${fc.trend_per_month <= 0 ? '' : '+'}${n1(fc.trend_per_month, 2)} a month) halved and capped, run 500 times; the index is the WHS best 8 of the last 20. "If you fix it" assumes you win back half of what your top two priorities cost, phased in over 6 months.`)}</div>`;
  }
  function milestonesCard(v) {
    const rows = v.ms.rows, m6 = v.ms6?.rows;
    const card = (r, i) => {
      const nxt = v.ms.next === r, p6 = m6 ? m6[i].p_round : null;
      return `<div class="ms ${r.first ? 'done' : nxt ? 'next' : ''}"><div class="ms-h"><b>${r.label}</b>${r.first ? '<span class="pill good">done</span>' : nxt ? '<span class="pill mid">next</span>' : ''}</div>
        ${r.first ? `<p class="small">First: <b>${r.first.gross}</b> on ${esc(r.first.date)}${r.first.course ? ` at ${esc(r.first.course)}` : ''}</p><p class="small muted">Chance any round now: ${pct(r.p_round)}</p>`
    : r.p_round === null ? '<p class="small muted">Needs 5 full rounds.</p>'
      : `<div class="bar"><i style="width:${Math.min(100, Math.round(r.p_round * 100))}%"></i></div><p class="small">Chance in any one round: <b>${pct(r.p_round)}</b> · in your next 10: <b>${pct(r.p_next10)}</b>${r.rounds_expected && r.rounds_expected < 200 ? ` · about 1 in ${Math.round(r.rounds_expected)}` : ''}</p>${p6 !== null && p6 > r.p_round + 0.01 ? `<p class="small muted">In 6 months, on your projection: ${pct(p6)} a round</p>` : ''}`}</div>`;
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
    return `${forecastCard(v)}${weekCard(v)}${milestonesCard(v)}
      ${roadmapCard('Short-game roadmap', v.short, 'Putting and chipping games, with the score that matches each scoring level.')}
      ${roadmapCard('Long-game roadmap', v.long, 'Range games, the monthly combine and range rounds.')}
      ${badgesCard(v)}`;
  }
  function homeCard() {
    if (!c.DS.rounds.length && !(J().results || []).length) return '';
    const v = data(), nx = v.ms.next, g = v.goals[0];
    return `<a class="card prog-home" href="#practice" data-practice="progress"><h2>Progress</h2><div class="ph-row">
      ${v.fc.ok ? `<div><span>Index in 6 months</span><b>${n1(v.fc.likely)}</b><small>now ${n1(v.fc.current)}</small></div>` : ''}
      ${nx && nx.p_round !== null ? `<div><span>${nx.label}</span><b>${pct(nx.p_round)}</b><small>chance a round</small></div>` : ''}
      <div><span>Streak</span><b>${v.st.current}</b><small>week${v.st.current === 1 ? '' : 's'}</small></div></div>
      ${g ? `<p class="small" style="margin:8px 0 0">This week: <b>${esc(g.name)}</b>${A.isNum(g.target) ? ` – target ${sc(g.target)}` : ''} · ${g.attempts}/${g.per_week} sessions${g.done ? ' ✓' : ''}</p>` : ''}</a>`;
  }
  return { page, homeCard, data };
}
