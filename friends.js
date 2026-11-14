// Side games with friends during a round (Play page): partners on your phone, or live across phones through the group.
import * as SG from './sidegames.js';
import * as CL from './cloud.js';

export function registerFriends(c) {
  const { A, S, $, $$, esc, fmt, note, toast } = c;
  const J = () => c.state.journal, cloud = () => c.state.cloud || {};
  const order = (d) => Array.from({ length: d.n }, (_, i) => ((d.first - 1 + i) % 18) + 1);
  const myIndex = () => { const w = c.DS.rounds.filter((r) => A.isNum(r.index_after)); const off = [...(c.state.settings.handicaps || [])].sort((a, b) => a.date.localeCompare(b.date)).pop(); return off?.handicap_index ?? (w.length ? w[w.length - 1].index_after : null); };

  // ------------------------------------------------------------ start form section
  function startFields() {
    const cl = cloud(), hi = myIndex();
    return `<details class="sgset"><summary>Playing partners &amp; side games</summary>
      <div class="row"><div><label class="f">Your handicap index</label><input name="my_hi" type="number" step="0.1" inputmode="decimal" value="${hi ?? ''}"></div><div><label class="f">Your name</label><input name="my_name" value="${esc(cl.nick || 'Me')}"></div></div>
      ${[2, 3, 4].map((i) => `<div class="row"><div><label class="f">Player ${i}</label><input name="p${i}_name" placeholder="Name"></div><div><label class="f">Index</label><input name="p${i}_hi" type="number" step="0.1" inputmode="decimal" placeholder="e.g. 12.4"></div></div>`).join('')}
      <label class="f">Games</label><div class="checks">${SG.FORMATS.map(([k, l]) => `<label><input type="checkbox" name="fmt" value="${k}" ${k === 'stableford' ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      <label class="f">With four players, your partner (best ball and four-ball match)</label><select name="partner"><option value="p2">Player 2</option><option value="p3">Player 3</option><option value="p4">Player 4</option></select>
      ${cl.group ? `<label class="checkrow"><input type="checkbox" name="live" checked> Share live with ${esc(cl.groupName || 'your group')} – friends with BreakingPar can join and enter their own scores</label>` : '<p class="small muted">To let friends enter their own scores on their phones, set up a group in Settings → Friends.</p>'}
      ${note('Allowances follow WHS recommendations: Stableford 95%, best ball 85%, singles match 100% and four-ball match 90% of the difference, skins 100%. Two players: match is you v player 2. Four players: your pair v the other pair.')}</details>`;
  }
  function readStart(f) {
    const others = [2, 3, 4].map((i) => ({ id: `p${i}`, name: String(f.get(`p${i}_name`) || '').trim(), index: c.numOrNull(f.get(`p${i}_hi`)) })).filter((p) => p.name);
    if (!others.length) return null;
    const players = [{ id: 'p1', name: String(f.get('my_name') || 'Me').trim() || 'Me', index: c.numOrNull(f.get('my_hi')), me: true }, ...others];
    others.forEach((p, i) => { p.id = `p${i + 2}`; });
    const formats = f.getAll('fmt'), ids = players.map((p) => p.id), partner = ids.includes(f.get('partner')) ? f.get('partner') : 'p2';
    let sides = null, teams = null;
    if (ids.length === 2) sides = [['p1'], ['p2']];
    if (ids.length === 4) { const rest = ids.filter((x) => x !== 'p1' && x !== partner); sides = [['p1', partner], rest]; teams = [['p1', partner], rest]; }
    return { players, formats: formats.filter((x) => (x === 'bestball' ? !!teams : x === 'match' ? !!sides : true)), sides, teams, scores: {}, wantLive: !!f.get('live') };
  }

  // ------------------------------------------------------------ the game object the scoring engine needs
  function gameOf(d, side, myScores) {
    const holes = order(d).map((n) => ({ hole: n, par: d.holes[n].par, si: d.holes[n].si ?? null }));
    const par = A.sum(holes.map((h) => h.par)), rating = d.n <= 9 && d.rating > 50 ? d.rating / 2 : d.rating;
    const players = side.players.map((p) => ({ ...p, ch: SG.courseHandicap(p.index, { slope: d.slope, rating, par, holes: holes.length }) }));
    const scores = { ...side.scores, p1: myScores };
    return { players, holes, scores, formats: side.formats, sides: side.sides, teams: side.teams };
  }
  const myScores = (d) => Object.fromEntries(order(d).filter((n) => d.holes[n].strokes > 0).map((n) => [n, d.holes[n].strokes]));
  const nameOf = (g, id) => g.players.find((p) => p.id === id)?.name || id;
  function standingsHtml(g) {
    const st = SG.standings(g), parts = [];
    if (st.stableford) parts.push(`<h3>Stableford</h3><div class="lb">${st.stableford.map((r, i) => `<div><span>${i + 1}</span><b>${esc(r.name)}</b><em>${r.points} pts</em><small>thru ${r.thru}</small></div>`).join('')}</div>`);
    if (st.skins) parts.push(`<h3>Skins</h3><div class="lb">${g.players.map((p) => `<div><span></span><b>${esc(p.name)}</b><em>${st.skins.won[p.id] || 0}</em><small>skins</small></div>`).join('')}</div>${st.skins.log.length && !st.skins.log[st.skins.log.length - 1].winner ? `<p class="small muted">${st.skins.log[st.skins.log.length - 1].carry} skin(s) carrying over.</p>` : ''}`);
    if (st.match) { const A_ = g.sides[0].map((id) => nameOf(g, id)).join(' & '), B_ = g.sides[1].map((id) => nameOf(g, id)).join(' & '), t = (x) => (x ? esc(x.text.replace(/^A /, `${A_} `).replace(/^B /, `${B_} `)) : '');
      parts.push(`<h3>${st.match.fourball ? 'Four-ball match' : 'Match'}: ${esc(A_)} v ${esc(B_)}</h3><p>${st.match.front ? `Front: <b>${t(st.match.front)}</b> · Back: <b>${t(st.match.back)}</b> · ` : ''}Overall: <b>${t(st.match.overall)}</b></p>`); }
    if (st.bestball) parts.push(`<h3>Best ball</h3><div class="lb">${st.bestball.map((r, i) => `<div><span>${i + 1}</span><b>${esc(r.names)}</b><em>${r.points} pts</em><small>thru ${r.thru}</small></div>`).join('')}</div>`);
    return parts.join('');
  }

  // ------------------------------------------------------------ in-round card (your phone)
  function groupCard(d) {
    const side = d.side; if (!side) return '';
    const g = gameOf(d, side, myScores(d)), h = d.hole, claims = side.live?.claims || {}, uid = cloud().auth?.uid;
    const noSI = g.holes.some((x) => !A.isNum(x.si));
    const rows = side.players.filter((p) => !p.me).map((p) => {
      const v = side.scores[p.id]?.[h], remote = claims[p.id] && claims[p.id] !== uid;
      return `<div class="step"><span>${esc(p.name)}${remote ? ' <small class="muted">(own phone)</small>' : ''}</span><div>${remote ? `<b>${v === undefined ? '–' : v === 0 ? 'P/U' : v}</b>` : `<button type="button" data-ps="${p.id}" data-d="-1" aria-label="less">−</button><b>${v === undefined ? '–' : v === 0 ? 'P/U' : v}</b><button type="button" data-ps="${p.id}" data-d="1" aria-label="more">+</button><button type="button" class="pu" data-pu="${p.id}">P/U</button>`}</div></div>`;
    }).join('');
    return `<div class="card"><div class="rv-h"><h2 style="margin:0">Group – hole ${h}</h2>${side.live ? `<span class="small muted" id="liveStat">Live · code ${esc(side.live.id)}</span>` : ''}</div>
      <div class="steps2">${rows}</div>
      ${noSI ? `<label class="f">Stroke index of hole ${h} (from the scorecard – needed for handicap strokes)</label><select id="plSI"><option value="">–</option>${Array.from({ length: 18 }, (_, i) => `<option ${d.holes[h].si === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select>` : ''}
      ${standingsHtml(g)}
      ${side.live ? `<p class="small" style="margin-top:8px"><button class="btn sec sm" type="button" id="liveSync">Sync now</button> Friends join from Play → Join a friend's round, code <b>${esc(side.live.id)}</b>.</p>` : side.wantLive ? '<p class="small"><button class="btn sec sm" type="button" id="liveStart">Go live with the group</button> <span id="liveMsg"></span></p>' : ''}
      ${note(`Your score comes from your own scorecard above. P/U = picked up (no points; can't win the hole).${noSI ? ' Without stroke indexes, handicap strokes fall on holes in number order.' : ''}`)}</div>`;
  }
  function wireGroup(d, re) {
    const side = d.side; if (!side) return;
    $$('[data-ps]').forEach((b) => b.addEventListener('click', () => {
      const pid = b.dataset.ps, h = d.hole, cur = side.scores[pid]?.[h], dl = Number(b.dataset.d);
      side.scores[pid] = side.scores[pid] || {};
      side.scores[pid][h] = Math.max(1, (cur === undefined || cur === 0 ? (dl > 0 ? d.holes[h].par - 1 : d.holes[h].par + 1) : cur) + dl);
      re().then(() => pushSoon(d));
    }));
    $$('[data-pu]').forEach((b) => b.addEventListener('click', () => { side.scores[b.dataset.pu] = side.scores[b.dataset.pu] || {}; side.scores[b.dataset.pu][d.hole] = 0; re().then(() => pushSoon(d)); }));
    $('#plSI')?.addEventListener('change', (e) => { d.holes[d.hole].si = c.numOrNull(e.target.value); re(); });
    $('#liveStart')?.addEventListener('click', () => goLive(d));
    $('#liveSync')?.addEventListener('click', () => syncOwner(d, true));
  }

  // ------------------------------------------------------------ live: owner side
  const liveGame = (d) => ({ course: d.course_name, start: d.start, n: d.n, first: d.first, holes: order(d).map((n) => ({ hole: n, par: d.holes[n].par, si: d.holes[n].si ?? null })),
    players: d.side.players.map(({ id, name, index }) => ({ id, name, index })), formats: d.side.formats, sides: d.side.sides, teams: d.side.teams, rating: d.rating, slope: d.slope });
  async function goLive(d) {
    const cl = cloud(), msg = $('#liveMsg');
    try {
      if (msg) msg.textContent = 'Connecting…';
      const a = await CL.signIn(cl), id = await CL.createLive(cl, cl.group, { ...liveGame(d), claims: { p1: a.uid }, scores: { p1: myScores(d) } });
      d.side.live = { group: cl.group, id, claims: { p1: a.uid } }; await S.saveJournal(c.state); await S.saveCloud(c.state);
      toast(`Live – code ${id}`); c.rerender();
    } catch (e) { if (msg) msg.textContent = e.message; }
  }
  let pushT = null;
  const pushSoon = (d) => { if (!d.side?.live) return; clearTimeout(pushT); pushT = setTimeout(() => syncOwner(d), 800); };
  async function syncOwner(d, loud = false) {
    const lv = d.side?.live, cl = cloud(); if (!lv || !CL.ready(cl)) return;
    try {
      const doc = await CL.getLive(cl, lv.group, lv.id); const claims = doc?.claims || lv.claims || {}, uid = (await CL.signIn(cl)).uid;
      const mine = d.side.players.map((p) => p.id).filter((pid) => !claims[pid] || claims[pid] === uid);
      for (const p of d.side.players) if (claims[p.id] && claims[p.id] !== uid) d.side.scores[p.id] = doc?.scores?.[p.id] || {};
      const scores = { ...d.side.scores, p1: myScores(d) };
      await CL.pushLive(cl, lv.group, lv.id, scores, mine, { holes: liveGame(d).holes });
      lv.claims = claims; lv.synced = Date.now(); await S.saveJournal(c.state); await S.saveCloud(c.state);
      if (loud) toast('Synced'); const el = $('#liveStat'); if (el) el.textContent = `Live · code ${lv.id} · synced`;
      if (loud || Object.keys(claims).some((p) => claims[p] !== uid)) { if (!document.activeElement?.matches?.('input,select,textarea')) c.rerender(); }
    } catch (e) { if (loud) toast(e.message); }
  }

  // ------------------------------------------------------------ live: joining a friend's round on your phone
  function joinCard() {
    const cl = cloud(), j = J().joined;
    if (j) return joinedCard(j);
    if (!cl.group) return '';
    return `<div class="card"><h2>Join a friend's round</h2><p class="small">If someone in ${esc(cl.groupName || 'your group')} has gone live, pick their round and enter your own scores here.</p>
      <p><button class="btn sec" type="button" id="jnList">Find live rounds</button> <span id="jnMsg" class="small"></span></p><div id="jnRounds"></div></div>`;
  }
  function joinedCard(j) {
    const doc = j.doc; if (!doc) return `<div class="card"><h2>Live round</h2><p class="muted">Loading…</p><p><button class="btn sec sm" id="jnLeave">Leave</button></p></div>`;
    const h = j.hole || doc.holes[0].hole, holes = doc.holes, idx = holes.findIndex((x) => x.hole === h), cur = j.scores[h], me = doc.players.find((p) => p.id === j.pid);
    const par = A.sum(holes.map((x) => x.par)), rating = doc.n <= 9 && doc.rating > 50 ? doc.rating / 2 : doc.rating;
    const g = { players: doc.players.map((p) => ({ ...p, ch: SG.courseHandicap(p.index, { slope: doc.slope, rating, par, holes: holes.length }) })), holes, scores: { ...(doc.scores || {}), [j.pid]: j.scores }, formats: doc.formats, sides: doc.sides, teams: doc.teams };
    return `<div class="card"><div class="rv-h"><h2 style="margin:0">${esc(doc.course)} – hole ${h}</h2><span class="small muted">you are ${esc(me?.name || j.pid)}</span></div>
      <div class="seg" id="jnPar">${holes.map((x) => `<button data-jh="${x.hole}" class="${x.hole === h ? 'on' : ''}">${x.hole}</button>`).join('')}</div>
      <div class="steps2"><div class="step"><span>Your score (par ${holes[idx]?.par ?? '?'})</span><div><button type="button" data-js="-1">−</button><b>${cur === undefined ? '–' : cur === 0 ? 'P/U' : cur}</b><button type="button" data-js="1">+</button><button type="button" class="pu" data-jpu>P/U</button></div></div></div>
      ${standingsHtml(g)}
      <p class="small" style="margin-top:8px"><button class="btn sec sm" id="jnSync">Sync now</button> <button class="btn sec sm" id="jnLeave">Leave round</button> <span class="muted" id="jnStat">${j.synced ? 'synced' : ''}</span></p></div>`;
  }
  async function syncJoined(loud = false) {
    const j = J().joined, cl = cloud(); if (!j || !CL.ready(cl)) return;
    try {
      await CL.pushLive(cl, j.group, j.id, { [j.pid]: j.scores }, [j.pid]);
      j.doc = await CL.getLive(cl, j.group, j.id); j.synced = Date.now(); await S.saveJournal(c.state);
      if (loud) toast('Synced'); if (!document.activeElement?.matches?.('input,select,textarea')) c.rerender();
    } catch (e) { if (loud) toast(e.message); }
  }
  function wireJoin() {
    $('#jnList')?.addEventListener('click', async () => {
      const cl = cloud(), m = $('#jnMsg'); m.textContent = 'Looking…';
      try {
        const lv = (await CL.listLive(cl, cl.group)).filter((x) => Date.now() - Date.parse(x.updated || 0) < 12 * 3600e3);
        m.textContent = lv.length ? '' : 'No live rounds in the last 12 hours.';
        $('#jnRounds').innerHTML = lv.map((x) => `<div class="card sub"><b>${esc(x.course)}</b><p class="small muted">${esc((x.start || '').slice(0, 16).replace('T', ' '))}</p>${(x.players || []).filter((p) => !(x.claims || {})[p.id]).map((p) => `<button class="btn sec sm" data-joinas="${esc(x.id)}|${esc(p.id)}">I'm ${esc(p.name)}</button>`).join(' ') || '<span class="small muted">Every player has claimed a phone.</span>'}</div>`).join('');
        $$('[data-joinas]').forEach((b) => b.addEventListener('click', async () => {
          const [id, pid] = b.dataset.joinas.split('|'), a = await CL.signIn(cl);
          await CL.pushLive(cl, cl.group, id, { [pid]: {} }, [pid], { claims: { [pid]: a.uid } });
          J().joined = { group: cl.group, id, pid, scores: {}, hole: null, doc: null }; await S.saveJournal(c.state); await syncJoined(); c.rerender();
        }));
      } catch (e) { m.textContent = e.message; }
    });
    const j = J().joined; if (!j) return;
    const holes = j.doc?.holes || [], h = j.hole || holes[0]?.hole;
    $$('[data-jh]').forEach((b) => b.addEventListener('click', async () => { j.hole = Number(b.dataset.jh); await S.saveJournal(c.state); c.rerender(); }));
    $$('[data-js]').forEach((b) => b.addEventListener('click', async () => { const par = holes.find((x) => x.hole === h)?.par || 4, cur = j.scores[h], dl = Number(b.dataset.js);
      j.scores[h] = Math.max(1, (cur === undefined || cur === 0 ? (dl > 0 ? par - 1 : par + 1) : cur) + dl); await S.saveJournal(c.state); c.rerender(); clearTimeout(pushT); pushT = setTimeout(() => syncJoined(), 800); }));
    $('[data-jpu]')?.addEventListener('click', async () => { j.scores[h] = 0; await S.saveJournal(c.state); c.rerender(); syncJoined(); });
    $('#jnSync')?.addEventListener('click', () => syncJoined(true));
    $('#jnLeave')?.addEventListener('click', async () => { if (!confirm('Leave this live round? Your scores stay on the shared card.')) return; J().joined = null; await S.saveJournal(c.state); c.rerender(); });
  }
  // poll every 20 s while the Play page is open
  setInterval(() => {
    if (!(location.hash.slice(1) || '').startsWith('play') || document.hidden) return;
    const d = J().draft; if (d?.side?.live) syncOwner(d); if (J().joined) syncJoined();
  }, 20000);

  return { startFields, readStart, groupCard, wireGroup, joinCard, wireJoin, standingsHtml, gameOf };
}
