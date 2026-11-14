// Practice competition: weekly challenge + leaderboards (your group, via Firebase), the monthly combine,
// and "range round" – play a real course on the range. Plus Settings → Friends (group setup and invites).
import * as B from './bench.js';
import * as CL from './cloud.js';
import * as F from './features.js';
import * as HM from './holemap.js';
import * as ST from './strategy.js';
import * as LG from './league.js';

export function registerCompete(c) {
  const { A, S, $, $$, esc, fmt, note, table, kpi, select, toast } = c;
  const J = () => c.state.journal, cloud = () => { c.state.cloud = c.state.cloud || {}; return c.state.cloud; };
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const unitM = () => (c.UNIT === 'yd' ? 0.9144 : 1);
  const allGames = () => [...F.DEFAULT_GAMES, ...J().games];
  const gameById = (id) => allGames().find((g) => g.id === id) || { id, name: id, better: 'higher' };
  const lvl = (gid, score) => { const g = gameById(gid); return B.level(gid, score, g.better, unitM()); };
  const lvlText = (l) => (!l ? '' : l.h === 0 ? 'scratch+' : l.h >= 25 ? '25+' : `≈${Math.round(l.h)}`);
  const inWeek = (date, week) => B.isoWeek(new Date(`${date}T12:00:00`)) === week;
  const groupOn = () => CL.ready(cloud()) && !!cloud().group;

  // this week's scores for the whole group (kept for 30 seconds so the league, the ghost list and the board share one fetch)
  const weekCache = new Map();
  async function weekScores(week) {
    const e = weekCache.get(week); if (e && Date.now() - e.at < 30000) return e.rows;
    const rows = await CL.scoresWhere(cloud(), cloud().group, 'week', week); weekCache.set(week, { at: Date.now(), rows }); return rows;
  }
  // ------------------------------------------------------------ posting scores to the group
  async function onScore(res) {
    if (!groupOn()) return;
    const g = gameById(res.game), l = lvl(res.game, res.score), d = new Date(`${res.date}T12:00:00`);
    try {
      await CL.postScore(cloud(), cloud().group, { game: res.game, game_name: g.name, better: g.better || 'higher', score: res.score, level_h: l ? Math.round(l.h * 10) / 10 : null,
        date: res.date, week: B.isoWeek(d), month: B.monthKey(d), nick: cloud().nick || 'Golfer', ...(res.course ? { course: res.course } : {}), ...LG.shareExtras(res, c.guided ? c.guided.shareInfo(res) : {}) });
      weekCache.clear(); await S.saveCloud(c.state);
    } catch (e) { toast(`Saved here; not shared: ${e.message}`); }
  }

  // ------------------------------------------------------------ player rank, shared as one extra field on the member document (retention plan 4.3)
  // Only the rank name is shared. It rides on the member document the app already writes, so the existing rules allow it. It is a nicety: any failure is ignored.
  const ranks = new Map(); let ranksAt = 0, sharedRank = null, sharing = false;
  async function shareRank(name) {
    if (!groupOn() || sharing || !name || sharedRank === name) return;
    sharing = true; sharedRank = name;                                           // once per rank per visit: a failure is not retried on every redraw
    try { const a = await CL.signIn(cloud()); await CL.setDoc(cloud(), `groups/${cloud().group}/members/${a.uid}`, { rank: name }, ['rank']); ranksAt = 0; } catch { /* the board still works without it */ }
    finally { sharing = false; }
  }
  async function loadRanks() {
    if (!groupOn() || Date.now() - ranksAt < 60000) return;
    ranksAt = Date.now();
    try { ranks.clear(); (await CL.members(cloud(), cloud().group)).forEach((m) => { if (typeof m.rank === 'string') ranks.set(m.id, m.rank); }); } catch { /* no ranks shown */ }
  }
  const rankTag = (uid) => (ranks.has(uid) ? `<i class="rk">${esc(ranks.get(uid))}</i>` : '');

  // ------------------------------------------------------------ leaderboard tab
  const cache = new Map();
  function boardHtml(key, rows, better) {
    if (!rows) return '<p class="small muted">Loading…</p>';
    if (!rows.length) return '<p class="small muted">No scores yet – be the first.</p>';
    const uid = cloud().auth?.uid;
    return `<div class="lb">${rows.map((r, i) => `<div class="${r.uid === uid ? 'me' : ''}"><span>${i + 1}</span><b>${esc(r.nick || 'Golfer')}${rankTag(r.uid)}</b><em>${fmt(r.score, Number.isInteger(r.score) ? 0 : 1)}</em><small>${A.isNum(r.level_h) ? (r.level_h <= 0 ? 'scratch+' : r.level_h >= 25 ? '25+' : `≈${Math.round(r.level_h)} hcp`) : ''}</small></div>`).join('')}</div>`;
  }
  function pageBoard() {
    const week = B.isoWeek(), gid = B.weeklyChallenge(week), g = gameById(gid), mine = J().results.filter((r) => r.game === gid && inWeek(r.date, week));
    const best = mine.length ? (g.better === 'lower' ? Math.min(...mine.map((r) => r.score)) : Math.max(...mine.map((r) => r.score))) : null, l = A.isNum(best) ? lvl(gid, best) : null;
    const t = (h) => fmt(B.expectedFor(gid, h, unitM()), 1);
    const month = B.monthKey(), combineMine = J().results.filter((r) => r.game === 'combine' && r.date.startsWith(month));
    const bg = c.ui.lb_game || gid;
    return `${groupOn() ? `<div class="card" id="lbLeagueCard"><div class="rv-h"><h2 style="margin:0">Weekly league</h2><span class="small muted">${week.replace('-W', ' · week ')}</span></div><div id="lbLeague"><p class="small muted">Loading…</p></div>
      <p class="small muted" style="margin:8px 0 0">${LG.LEAGUE.hit} points for beating your own target, ${LG.LEAGUE.play} for playing, +${LG.LEAGUE.pressure} for a pressure finish. Your first ${LG.LEAGUE.cap} scores of the week count. It starts again each Monday.</p></div>` : ''}
    <div class="card challenge"><div class="rv-h"><h2 style="margin:0">This week's challenge</h2><span class="small muted">${week.replace('-W', ' · week ')}</span></div>
      <h3 style="margin-top:6px">${esc(g.name)}</h3><p class="small">${esc(g.how || '')}</p>
      ${B.hasLevel(gid) ? `<p class="small muted">Benchmarks: scratch ${t(0)} · 10 hcp ${t(10)} · 20 hcp ${t(20)} ${esc(F.unitOf(g, c.UNIT) || '')}</p>` : ''}
      <div class="kpis">${kpi('Your best this week', best, null, true, Number.isInteger(best) ? 0 : 1)}<div class="kpi"><div class="l">Level</div><div class="v sm">${l ? esc(l.label) : '–'}</div></div><div class="kpi"><div class="l">Attempts</div><div class="v">${mine.length}</div></div></div>
      <p><button class="btn" data-record="${esc(gid)}">Record a score</button></p>
      ${groupOn() ? `<h3>${esc(cloud().groupName || 'Group')} leaderboard</h3><div id="lbWeek">${boardHtml('w', cache.get(`w|${week}|${gid}`), g.better)}</div>` : friendsHint()}</div>
    <div class="card"><div class="rv-h"><h2 style="margin:0">Monthly combine</h2><span class="small muted">${new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span></div>
      <p class="small">18 shots to six targets, scored 0–100. One go a month is the idea; your best counts.</p>
      <div class="kpis">${kpi('Your best this month', combineMine.length ? Math.max(...combineMine.map((r) => r.score)) : null, null, true, 1)}<div class="kpi"><div class="l">Level</div><div class="v sm">${combineMine.length ? esc(lvl('combine', Math.max(...combineMine.map((r) => r.score)))?.label || '–') : '–'}</div></div></div>
      <p><button class="btn sec" data-prtab="combine">Play the combine</button></p>
      ${groupOn() ? `<div id="lbMonth">${boardHtml('m', cache.get(`m|${month}`), 'higher')}</div>` : ''}</div>
    ${groupOn() ? `<div class="card"><h2>All-time bests</h2>${select('lb_game', allGames().filter((x) => B.hasLevel(x.id) || x.id === 'combine' || x.cat !== 'Other').map((x) => [x.id, `${x.cat} · ${x.name}`]), bg, 'Game')}<div id="lbAll" style="margin-top:8px">${boardHtml('a', cache.get(`a|${bg}`), gameById(bg).better)}</div></div>` : ''}
    ${note('Levels compare your score with what golfers of each handicap would be expected to score, from Shot Scope on-course data (putting make %, approach proximity, up-and-down %). Practice greens and ranges are easier than the course, so most scores read a few shots better than your handicap – use them to track progress and compare with friends.')}`;
  }
  function friendsHint() { return `<p class="small">Compare with friends: set up a group in <a href="#settings" data-friends>Settings → Friends</a>.</p>`; }
  function leagueHtml(rows, prev) {
    const uid = cloud().auth?.uid;
    if (!rows.length) return '<p class="small muted">No scores yet this week. Play any game to get on the board.</p>';
    const last = prev.length ? `<p class="small" style="margin:8px 0 0">Last week's winner: <b>${LG.winners(prev).map((r) => esc(r.nick)).join(' and ')}</b> · ${LG.winners(prev)[0].points} points</p>` : '';
    return `<div class="lb">${rows.map((r) => `<div class="${r.uid === uid ? 'me' : ''}"><span>${r.rank}</span><b>${esc(r.nick)}${rankTag(r.uid)}</b><em>${r.points}</em><small>${r.plays} played · ${r.hits} on target</small></div>`).join('')}</div>${last}`;
  }
  async function loadBoards() {
    if (!groupOn()) return;
    await loadRanks();
    const cl = cloud(), week = B.isoWeek(), gid = B.weeklyChallenge(week), month = B.monthKey(), bg = c.ui.lb_game || gid;
    const fill = async (sel, key, fetcher, better) => {
      try { const rows = CL.board(await fetcher(), better); cache.set(key, rows); const el = $(sel); if (el) el.innerHTML = boardHtml(key, rows, better); }
      catch (e) { const el = $(sel); if (el) el.innerHTML = `<p class="small bad">${esc(e.message)}</p>`; }
    };
    await Promise.all([
      (async () => { try { const [cur, prev] = await Promise.all([weekScores(week), weekScores(LG.prevWeek(week)).catch(() => [])]); const el = $('#lbLeague'); if (el) el.innerHTML = leagueHtml(LG.league(cur), prev.length ? LG.league(prev) : []); } catch (e) { const el = $('#lbLeague'); if (el) el.innerHTML = `<p class="small bad">${esc(e.message)}</p>`; } })(),
      fill('#lbWeek', `w|${week}|${gid}`, async () => (await CL.scoresWhere(cl, cl.group, 'week', week)).filter((s) => s.game === gid), gameById(gid).better),
      fill('#lbMonth', `m|${month}`, async () => (await CL.scoresWhere(cl, cl.group, 'month', month)).filter((s) => s.game === 'combine'), 'higher'),
      $('#lbAll') ? fill('#lbAll', `a|${bg}`, () => CL.scoresWhere(cl, cl.group, 'game', bg), gameById(bg).better) : null,
    ]);
    await S.saveCloud(c.state);
  }

  // ------------------------------------------------------------ the combine
  const N_BALLS = 3;
  function pageCombine() {
    const d = J().combine_draft || { date: today(), pts: [] }, U = c.UNIT, pts = d.pts, done = pts.filter((p) => A.isNum(p)).length, total = B.COMBINE_TARGETS.length * N_BALLS;
    const sc = B.combineScore(pts), l = done >= 6 ? lvl('combine', sc) : null;
    const rows = B.COMBINE_TARGETS.map((t, ti) => `<div class="cmb"><div class="cmbh"><b>${t} ${U}</b><span class="small muted">5% = ${fmt(t * 0.05, 1)} · 10% = ${fmt(t * 0.1, 1)} · 15% = ${fmt(t * 0.15, 1)} · 25% = ${fmt(t * 0.25, 1)} ${U}</span></div>
      ${Array.from({ length: N_BALLS }, (_, b) => { const i = ti * N_BALLS + b; return `<div class="cmbrow"><span>Ball ${b + 1}</span>${B.COMBINE_BUCKETS.map(([f, p, lab]) => `<button type="button" data-cmb="${i}|${p}" class="${pts[i] === p ? 'on' : ''}">${f === Infinity ? '✕' : `${Math.round(f * 100)}%`}</button>`).join('')}</div>`; }).join('')}</div>`).join('');
    const hist = J().results.filter((r) => r.game === 'combine').sort((a, b) => b.date.localeCompare(a.date));
    return `<div class="card"><h2>Monthly combine</h2><p class="small">Six targets, three balls each, full routine. For each ball, tap how close it finished as a share of the distance (e.g. within 10% at 100 ${U} = within 10 ${U}). Use a rangefinder on the flags if you can.</p>
      <div class="kpis">${kpi('Score so far', sc, null, true, 1)}${kpi('Balls', done, null, true, 0)}<div class="kpi"><div class="l">Level</div><div class="v sm">${l ? esc(l.label) : '–'}</div></div></div>
      ${rows}
      <p><button class="btn" id="cmbSave" ${done === total ? '' : 'disabled'}>Save combine (${done}/${total})</button> <button class="btn sec" id="cmbReset">Start again</button></p>
      ${note(`Points per ball: within 5% = 100, 10% = 75, 15% = 50, 25% = 25, further = 0; score = average. Benchmarks: scratch ≈ ${fmt(B.expectedFor('combine', 0, unitM()), 0)}, 10 hcp ≈ ${fmt(B.expectedFor('combine', 10, unitM()), 0)}, 20 hcp ≈ ${fmt(B.expectedFor('combine', 20, unitM()), 0)} (from on-course proximity data).`)}</div>
      ${hist.length ? `<div class="card"><h2>Your combines</h2>${table(hist.map((r) => ({ ...r, level: lvlText(lvl('combine', r.score)) })), [['date', 'Date'], ['score', 'Score', (v) => fmt(v, 1)], ['level', 'Level']])}</div>` : ''}`;
  }

  // ------------------------------------------------------------ range round
  function rangeCourses() {
    const out = [];
    for (const [cid, name] of new Map(c.DS.rounds.filter((r) => r.course_id).map((r) => [r.course_id, r.course_name]))) {
      const known = F.courseHoles(c.DS, cid), osm = c.state.osm[cid]?.features || [];
      const holes = [];
      for (let h = 1; h <= 18; h++) {
        const t = HM.holeTargets(known[h], osm, h, null), par = known[h]?.par || t.par;
        if (!t.tee || !t.green || !par) continue;
        const len = t.line ? t.line.reduce((s, p, i) => (i ? s + A.haversine(t.line[i - 1][0], t.line[i - 1][1], p[0], p[1]) : 0), 0) : A.haversine(t.tee[0], t.tee[1], t.green[0], t.green[1]);
        holes.push({ hole: h, par, len_m: len });
      }
      const last = [...c.DS.rounds].reverse().find((r) => r.course_id === cid && r.format === '18');
      if (holes.length >= 9) out.push({ course_id: cid, name, holes, rating: last?.course_rating ?? null, slope: last?.slope ?? null });
    }
    return out;
  }
  const clubList = () => F.recommendClubs(c.DS, 0, 1).filter((r) => r.kind === 'gps').sort((a, b) => b.median_m - a.median_m);
  const greenPutt = () => A.median(c.DS.holes.filter((h) => h.gir_eff === 1 && A.isNum(h.first_putt_eff_m)).map((h) => h.first_putt_eff_m)) ?? 7;
  function pageRange() {
    const rr = J().range;
    if (!rr) {
      const cs = rangeCourses();
      if (!cs.length) return `<div class="card"><h2>Range round</h2><p class="muted">Needs a course where GolfIQ knows each hole's tee and green – from your tracked Garmin rounds, or a downloaded course outline with hole lines.</p></div>`;
      const sel = c.ui.rr_course && cs.some((x) => x.course_id === c.ui.rr_course) ? c.ui.rr_course : cs[0].course_id;
      const best = J().results.filter((r) => r.game === 'range-course').sort((a, b) => a.score - b.score);
      return `<div class="card"><h2>Play your course on the range</h2><p class="small">Play a real course shot by shot on the range. GolfIQ calls the distance for each shot from your hole lengths and your own club distances; you hit it with full routine and tap where it finished. Once you're on or around the green, the hole is finished with the strokes you'd expect from there (your strokes-gained model), so the score reads like a real round.</p>
        <form id="rrStart">${select('rr_course', cs.map((x) => [x.course_id, `${x.name} (${x.holes.length} holes)`]), sel, 'Course')}
        <label class="f">Holes</label><select name="which"><option value="all">All known holes</option><option value="front">Front nine</option><option value="back">Back nine</option></select>
        <p><button class="btn">Start range round</button></p></form>
        ${note('Hole lengths are tee to green (along the hole line when the outline has one). A pure range can\'t show a ball\'s lie, so be honest with the results – that\'s the game.')}</div>
        ${best.length ? `<div class="card"><h2>Your range rounds</h2>${table(best.slice(0, 10), [['date', 'Date'], ['course', 'Course'], ['score', 'Score', (v) => fmt(v, 1)], ['to_par', 'To par', (v) => (A.isNum(v) ? (v > 0 ? '+' : '') + fmt(v, 1) : '–')], ['differential', 'Diff', (v) => fmt(v, 1)]])}</div>` : ''}`;
    }
    const h = rr.holes[rr.i], U = c.UNIT, tot = ST.rrTotals(rr), clubs = clubList();
    const holeStrip = `<div class="strip">${rr.holes.map((x, i) => `<button type="button" class="${i === rr.i ? 'cur' : ''} ${x.done ? (x.score - x.par < -0.25 ? 'under' : x.score - x.par <= 0.5 ? 'even' : x.score - x.par <= 1.5 ? 'bogey' : 'double') : ''}" disabled><span>${x.hole}</span><b>${x.done ? fmt(x.score, 1) : '·'}</b></button>`).join('')}</div>`;
    if (!h || (h.done && rr.i === rr.holes.length - 1)) {
      return `<div class="card"><h2>${esc(rr.course_name)} – finished</h2><div class="kpis">${kpi('Score', tot.score, null, false, 1)}${kpi('To par', tot.to_par, null, false, 1)}${kpi('Differential', tot.differential, null, false, 1)}</div>${holeStrip}
        <p><button class="btn" id="rrSave">Save range round</button> <button class="btn sec" id="rrQuit">Discard</button></p>
        ${note('Differential uses the course rating and slope from your last 18-hole round there (113 / slope × (score − rating)); it needs all 18 holes.')}</div>`;
    }
    const going = (cm) => cm >= h.remaining_m - 20;
    const longest = clubs.filter((x) => h.lie === 'tee' || !/driver/i.test(c.DS.clubs.find((k) => k.club_id === x.club_id)?.category || ''))[0];
    const rec = h.remaining_m > (longest?.median_m || 0) + 15 ? longest : F.recommendClubs(c.DS, h.remaining_m, c.uncv(10)).filter((r) => r.kind === 'gps')[0] || longest;
    const pick = clubs.find((x) => x.club_id === c.ui.rr_club) || rec, results = pick && going(pick.median_m) ? ST.RR_GREEN : ST.RR_LONG;
    return `<div class="card"><div class="rv-h"><h2 style="margin:0">Hole ${h.hole} · par ${h.par}</h2><span class="small muted">${c.d0(h.len_m)} ${U}</span></div>
      <p class="rrshot">Shot ${h.shots.length + 1}: <b>${c.d0(h.remaining_m)} ${U}</b> to the green from the ${h.lie === 'tee' ? 'tee' : h.lie}</p>
      <label class="f">Club ${rec ? `<span class="muted">(suggested: ${esc(rec.club)}, usually ${c.d0(rec.median_m)} ${U})</span>` : ''}</label>
      <div class="chips">${clubs.map((x) => `<button type="button" class="chip ${pick && x.club_id === pick.club_id ? 'on' : ''}" data-rrclub="${esc(x.club_id)}">${esc(x.club)}</button>`).join('')}</div>
      <label class="f">Where did it finish?</label><div class="rrres">${results.map(([k, l]) => `<button type="button" class="btn ${k === 'trouble' ? 'sec' : ''}" data-rrres="${k}">${l}</button>`).join('')}</div>
      <div class="kpis" style="margin-top:10px">${kpi('Holes done', tot.holes, null, true, 0)}${kpi('Score', tot.holes ? tot.score : null, null, false, 1)}${kpi('To par', tot.holes ? tot.to_par : null, null, false, 1)}</div>
      ${holeStrip}<p><button class="btn sec sm" id="rrQuit">Abandon</button></p></div>`;
  }

  // ------------------------------------------------------------ Settings → Friends
  function friendsSettings() {
    const cl = cloud(), pend = cl.pending;
    if (!CL.ready(cl) || pend) {
      return `<div class="card"><h2>Friends &amp; leaderboards</h2>
        ${pend ? `<p>You've been invited to <b>${esc(pend.groupName || 'a group')}</b>. Pick a nickname to join.</p><form id="frJoinInvite"><label class="f">Nickname</label><input name="nick" required maxlength="30" value="${esc(cl.nick || '')}"><p><button class="btn">Join group</button></p></form>`
    : `<p class="small">Leaderboards and live side games need a small shared database. GolfIQ uses your own free Firebase project – about 10 minutes to set up once (steps in SETUP_FRIENDS.md in the app's GitHub repo). Friends don't set anything up: they join from your invite link.</p>
        <form id="frPaste"><label class="f">Got an invite from a friend? Paste the link here</label><input name="link" placeholder="https://…#join=…" autocomplete="off"><p><button class="btn">Use invite</button></p></form>
        <p class="small muted">On iPhone, an invite opened in Safari doesn't reach the app on your home screen (they keep separate storage), so copy the link and paste it here instead.</p>
        <h3>Or set up your own group</h3>
        <form id="frSetup"><label class="f">Paste your Firebase web config (the <code>firebaseConfig = {…}</code> block)</label><textarea name="cfg" rows="6" placeholder="apiKey: &quot;…&quot;, projectId: &quot;…&quot;"></textarea>
        <label class="f">Your nickname</label><input name="nick" required maxlength="30" value="${esc(cl.nick || '')}"><p><button class="btn">Save</button></p></form>
        <details><summary>Firestore security rules to paste</summary><textarea readonly rows="14">${esc(CL.RULES)}</textarea></details>`}
        ${note('Only game scores, your nickname, the group name and live side-game scorecards are stored there. Your rounds, shots and everything else stay on this phone.')}</div>`;
    }
    return `<div class="card"><h2>Friends &amp; leaderboards</h2><p class="small">Firebase project <b>${esc(cl.projectId)}</b> · you are <b>${esc(cl.nick || '?')}</b></p>
      ${cl.group ? `<p>Group: <b>${esc(cl.groupName || cl.group)}</b></p><p><button class="btn" id="frInvite">Share invite link</button> <button class="btn sec" id="frMembers">Members</button> <span id="frMsg" class="small"></span></p><div id="frList"></div>
        <details><summary>Leave or switch group</summary><p><button class="btn sec sm" id="frLeave">Leave this group on this phone</button></p></details>`
    : `<form id="frCreate"><label class="f">New group name</label><input name="name" required maxlength="40" placeholder="e.g. Saturday crew"><p><button class="btn">Create group</button></p></form>
        <form id="frJoin"><label class="f">…or join with a code</label><input name="code" required><p><button class="btn sec">Join</button></p></form>`}
      <details><summary>Firebase settings</summary><form id="frNick"><label class="f">Nickname</label><input name="nick" maxlength="30" value="${esc(cl.nick || '')}"><p><button class="btn sec sm">Save nickname</button></p></form>
      <p><button class="btn sec sm" id="frForget">Forget Firebase on this phone</button></p><textarea readonly rows="10">${esc(CL.RULES)}</textarea></details></div>`;
  }
  function parseCfg(t) {
    const g = (k) => (new RegExp(`${k}["']?\\s*[:=]\\s*["']([^"']+)["']`).exec(t) || [])[1];
    return { apiKey: g('apiKey'), projectId: g('projectId') };
  }

  // ------------------------------------------------------------ wiring
  function wire() {
    $$('[data-record]').forEach((b) => b.addEventListener('click', () => { if (c.guided?.canGuide(b.dataset.record)) { c.guided.start(b.dataset.record); return; } c.ui.pr_tab = 'games'; c.ui.pg_game = b.dataset.record; c.saveUi(); c.rerender(); scrollTo(0, 0); }));
    $$('[data-prtab]').forEach((b) => b.addEventListener('click', () => { c.ui.pr_tab = b.dataset.prtab; c.saveUi(); c.rerender(); scrollTo(0, 0); }));
    $$('[data-friends]').forEach((a) => a.addEventListener('click', () => { c.ui.st_tab = 'friends'; c.saveUi(); }));
    if ($('#lbWeek') || $('#lbMonth') || $('#lbLeague')) loadBoards();
    // combine
    $$('[data-cmb]').forEach((b) => b.addEventListener('click', async () => {
      const [i, p] = b.dataset.cmb.split('|').map(Number), d = J().combine_draft || (J().combine_draft = { date: today(), pts: [] });
      d.pts[i] = d.pts[i] === p ? null : p; await S.saveJournal(c.state); c.rerender();
    }));
    $('#cmbReset')?.addEventListener('click', async () => { if (!confirm('Clear this combine?')) return; J().combine_draft = null; await S.saveJournal(c.state); c.rerender(); });
    $('#cmbSave')?.addEventListener('click', async () => {
      const d = J().combine_draft, sc = Math.round(B.combineScore(d.pts) * 10) / 10, res = { id: `r${Date.now()}`, game: 'combine', date: d.date, score: sc, note: '' };
      J().results.push(res); J().combine_draft = null; await S.saveJournal(c.state); await onScore(res); c.done(`Combine saved: ${sc}`);
    });
    // range round
    $('#rrStart')?.addEventListener('submit', async (e) => {
      e.preventDefault(); const cs = rangeCourses(), co = cs.find((x) => x.course_id === $('[data-sel=rr_course]').value) || cs[0], w = new FormData(e.target).get('which');
      const holes = co.holes.filter((h) => (w === 'front' ? h.hole <= 9 : w === 'back' ? h.hole >= 10 : true));
      J().range = ST.rrStart({ ...co, holes }); c.ui.rr_club = null; c.saveUi(); await S.saveJournal(c.state); c.rerender();
    });
    $$('[data-rrclub]').forEach((b) => b.addEventListener('click', () => { c.ui.rr_club = b.dataset.rrclub; c.saveUi(); c.rerender(); }));
    $$('[data-rrres]').forEach((b) => b.addEventListener('click', async () => {
      const rr = J().range, h = rr.holes[rr.i], clubs = clubList();
      const longest = clubs.filter((x) => h.lie === 'tee' || !/driver/i.test(c.DS.clubs.find((k) => k.club_id === x.club_id)?.category || ''))[0];
      const rec = h.remaining_m > (longest?.median_m || 0) + 15 ? longest : F.recommendClubs(c.DS, h.remaining_m, c.uncv(10)).filter((r) => r.kind === 'gps')[0] || longest;
      const pick = clubs.find((x) => x.club_id === c.ui.rr_club) || rec; if (!pick) return;
      ST.rrApply(rr, pick.median_m, b.dataset.rrres, greenPutt(), c.E); c.ui.rr_club = null; c.saveUi(); await S.saveJournal(c.state); c.rerender();
    }));
    $('#rrQuit')?.addEventListener('click', async () => { if (!confirm('Discard this range round?')) return; J().range = null; await S.saveJournal(c.state); c.rerender(); });
    $('#rrSave')?.addEventListener('click', async () => {
      const rr = J().range, t = ST.rrTotals(rr), res = { id: `r${Date.now()}`, game: 'range-course', date: today(), score: Math.round(t.score * 10) / 10, to_par: Math.round(t.to_par * 10) / 10, differential: A.isNum(t.differential) ? Math.round(t.differential * 10) / 10 : null, course: rr.course_name, note: `${rr.course_name}, ${rr.holes.length} holes` };
      J().results.push(res); J().range = null; await S.saveJournal(c.state); c.done('Range round saved');
    });
    // friends settings
    $('#frSetup')?.addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target), cfg = parseCfg(String(f.get('cfg')));
      if (!cfg.apiKey || !cfg.projectId) { toast('Could not find apiKey and projectId in that text'); return; }
      Object.assign(cloud(), cfg, { nick: String(f.get('nick')).trim() }); await S.saveCloud(c.state);
      try { await CL.signIn(cloud()); await S.saveCloud(c.state); c.done('Firebase connected'); } catch (err) { toast(err.message); c.rerender(); }
    });
    $('#frPaste')?.addEventListener('submit', async (e) => {
      e.preventDefault(); const t = String(new FormData(e.target).get('link') || ''), inv = CL.parseInvite(t.slice(t.indexOf('#')));
      if (!inv) { toast("That doesn't look like a GolfIQ invite link"); return; }
      cloud().pending = inv; await S.saveCloud(c.state); c.rerender();
    });
    $('#frJoinInvite')?.addEventListener('submit', async (e) => {
      e.preventDefault(); const cl = cloud(), p = cl.pending, nick = String(new FormData(e.target).get('nick')).trim();
      try { if (cl.projectId && cl.projectId !== p.projectId) delete cl.auth; Object.assign(cl, { apiKey: p.apiKey, projectId: p.projectId, nick }); const g = await CL.joinGroup(cl, p.group, nick); cl.group = p.group; cl.groupName = g.name || p.groupName; delete cl.pending; await S.saveCloud(c.state); c.done(`Joined ${cl.groupName}`); }
      catch (err) { toast(err.message); }
    });
    $('#frCreate')?.addEventListener('submit', async (e) => {
      e.preventDefault(); const cl = cloud(), name = String(new FormData(e.target).get('name')).trim();
      try { cl.group = await CL.createGroup(cl, name, cl.nick || 'Golfer'); cl.groupName = name; await S.saveCloud(c.state); c.done('Group created – share the invite link'); } catch (err) { toast(err.message); }
    });
    $('#frJoin')?.addEventListener('submit', async (e) => {
      e.preventDefault(); const cl = cloud(), code = String(new FormData(e.target).get('code')).trim();
      try { const g = await CL.joinGroup(cl, code, cl.nick || 'Golfer'); cl.group = code; cl.groupName = g.name; await S.saveCloud(c.state); c.done(`Joined ${g.name}`); } catch (err) { toast(err.message); }
    });
    $('#frInvite')?.addEventListener('click', async () => {
      const cl = cloud(), link = CL.inviteLink(cl, cl.group, cl.groupName, location.href);
      try { if (navigator.share) await navigator.share({ title: 'Join my GolfIQ group', text: `Join ${cl.groupName} on GolfIQ for practice leaderboards and side games:`, url: link }); else { await navigator.clipboard.writeText(link); toast('Invite link copied'); } }
      catch { /* share sheet closed */ }
    });
    $('#frMembers')?.addEventListener('click', async () => {
      try { const m = await CL.members(cloud(), cloud().group); $('#frList').innerHTML = `<div class="lb">${m.map((x, i) => `<div><span>${i + 1}</span><b>${esc(x.nick)}</b><em></em><small>${esc((x.joined || '').slice(0, 10))}</small></div>`).join('')}</div>`; }
      catch (err) { $('#frMsg').textContent = err.message; }
    });
    $('#frLeave')?.addEventListener('click', async () => { if (!confirm('Stop using this group on this phone? Your posted scores stay on the board.')) return; const cl = cloud(); delete cl.group; delete cl.groupName; await S.saveCloud(c.state); c.rerender(); });
    $('#frNick')?.addEventListener('submit', async (e) => { e.preventDefault(); const cl = cloud(); cl.nick = String(new FormData(e.target).get('nick')).trim(); if (cl.group) { try { await CL.joinGroup(cl, cl.group, cl.nick); } catch { /* offline */ } } await S.saveCloud(c.state); c.done('Nickname saved'); });
    $('#frForget')?.addEventListener('click', async () => { if (!confirm('Forget the Firebase project and group on this phone?')) return; c.state.cloud = {}; await S.saveCloud(c.state); c.rerender(); });
  }
  // invite links (#join=…) – remember the invite and send the person to Settings → Friends
  function handleInvite() {
    const inv = CL.parseInvite(location.hash); if (!inv) return false;
    cloud().pending = inv; S.saveCloud(c.state); c.ui.st_tab = 'friends'; c.saveUi(); history.replaceState(null, '', '#settings'); return true;
  }
  return { pageBoard, pageCombine, pageRange, friendsSettings, wire, onScore, shareRank, handleInvite, lvl, lvlText, groupOn, weekScores, myUid: () => cloud().auth?.uid || null };
}
