// Side games during a round: net Stableford, skins, match play / Nassau, and best ball (4BBB).
// Handicap allowances follow the WHS recommendations: individual Stableford 95%, four-ball Stableford 85%,
// singles match play 100% and four-ball match play 90% of the difference from the lowest handicap; skins 100%.
export const FORMATS = [
  ['stableford', 'Stableford (net)'], ['skins', 'Skins (net)'], ['match', 'Match play / Nassau'], ['bestball', 'Best ball (4BBB)'],
];
export const ALLOW = { stableford: 0.95, skins: 1, match_singles: 1, match_fourball: 0.9, bestball: 0.85 };

// WHS course handicap for the holes being played (9-hole rounds use half the index).
export function courseHandicap(index, { slope, rating, par, holes }) {
  if (!Number.isFinite(index)) return 0;
  const hi = holes <= 9 ? index / 2 : index;
  return Number.isFinite(slope) && Number.isFinite(rating) && Number.isFinite(par) ? hi * slope / 113 + (rating - par) : hi;
}
// Strokes received on each hole: shared out in stroke-index order over the holes played (plus handicaps give strokes back from the easiest).
export function strokesByHole(ph, holes) {
  const n = holes.length, order = [...holes].sort((a, b) => (a.si ?? 99) - (b.si ?? 99)), out = {};
  const p = Math.round(ph), base = Math.trunc(p / n), extra = Math.abs(p % n);
  order.forEach((h, rank) => { out[h.hole] = base + (p >= 0 ? (rank < extra ? 1 : 0) : (rank >= n - extra ? -1 : 0)); });
  return out;
}
const sc = (scores, pid, hole) => { const v = scores?.[pid]?.[hole]; return Number.isFinite(v) && v > 0 ? v : null; };   // null = no score / picked up

export function stableford(game) {
  const { players, holes, scores } = game, rows = [];
  for (const p of players) {
    const st = strokesByHole(p.ch * ALLOW.stableford, holes); let pts = 0, thru = 0; const by = {};
    for (const h of holes) {
      if (scores?.[p.id]?.[h.hole] === undefined) continue;                    // not played yet (0 = picked up, scores 0 points)
      const s = sc(scores, p.id, h.hole), v = s === null ? 0 : Math.max(0, 2 + h.par + st[h.hole] - s);
      by[h.hole] = v; pts += v; thru++;
    }
    rows.push({ id: p.id, name: p.name, points: pts, thru, by });
  }
  return rows.sort((a, b) => b.points - a.points);
}

export function skins(game) {
  const { players, holes, scores } = game, st = Object.fromEntries(players.map((p) => [p.id, strokesByHole(p.ch * ALLOW.skins, holes)]));
  const won = Object.fromEntries(players.map((p) => [p.id, 0])), log = []; let carry = 0;
  for (const h of holes) {
    const nets = players.map((p) => ({ id: p.id, s: sc(scores, p.id, h.hole) })).filter((x) => x.s !== null).map((x) => ({ id: x.id, net: x.s - st[x.id][h.hole] }));
    const entered = players.every((p) => scores?.[p.id]?.[h.hole] !== undefined);
    if (!entered) break;                                               // skins are settled hole by hole in order
    carry += 1;
    if (!nets.length) { log.push({ hole: h.hole, winner: null, carry }); continue; }
    const best = Math.min(...nets.map((x) => x.net)), w = nets.filter((x) => x.net === best);
    if (w.length === 1) { won[w[0].id] += carry; log.push({ hole: h.hole, winner: w[0].id, value: carry }); carry = 0; } else log.push({ hole: h.hole, winner: null, carry });
  }
  return { won, log, carry };
}

// Match play between two sides (one or two players each); a side's score on a hole is its best net score.
// Nassau = three matches: first nine, second nine and overall.
export function match(game) {
  const { players, holes, scores, sides } = game;
  if (!sides || sides.length !== 2 || !sides[0].length || !sides[1].length) return null;
  const fourball = sides[0].length > 1 || sides[1].length > 1, allow = fourball ? ALLOW.match_fourball : ALLOW.match_singles;
  const ids = [...sides[0], ...sides[1]], phs = Object.fromEntries(ids.map((id) => [id, (players.find((p) => p.id === id)?.ch || 0) * allow]));
  const low = Math.min(...Object.values(phs)), st = Object.fromEntries(ids.map((id) => [id, strokesByHole(phs[id] - low, holes)]));
  const best = (side, h) => { const v = side.map((id) => sc(scores, id, h.hole)).map((s, i) => (s === null ? null : s - st[side[i]][h.hole])).filter((x) => x !== null); return v.length ? Math.min(...v) : null; };
  const res = [];
  for (const h of holes) {
    if (!ids.every((id) => scores?.[id]?.[h.hole] !== undefined)) break;
    const a = best(sides[0], h), b = best(sides[1], h);
    res.push({ hole: h.hole, r: a === null && b === null ? 0 : a === null ? -1 : b === null ? 1 : Math.sign(b - a) });       // +1 side A wins the hole
  }
  const status = (part, total) => {
    let up = 0, played = 0; for (const x of part) { up += x.r; played++; if (Math.abs(up) > total - played) break; }
    const left = total - played, done = Math.abs(up) > left || left === 0;
    return { up, played, left, done, text: up === 0 ? (done ? 'Halved' : 'All square') : `${up > 0 ? 'A' : 'B'} ${done && left ? `${Math.abs(up)}&${left}` : `${Math.abs(up)} ${done ? 'up – won' : 'up'}`}` };
  };
  const n = holes.length, half = Math.ceil(n / 2);
  return { fourball, overall: status(res, n), front: n >= 18 ? status(res.slice(0, half), half) : null, back: n >= 18 ? status(res.slice(half), n - half) : null, holes: res };
}

// Best ball Stableford for pairs: each hole the better partner's points count.
export function bestBall(game) {
  const { players, holes, scores, teams } = game;
  if (!teams?.length) return null;
  const st = Object.fromEntries(players.map((p) => [p.id, strokesByHole(p.ch * ALLOW.bestball, holes)]));
  return teams.map((t) => {
    let pts = 0, thru = 0;
    for (const h of holes) {
      const v = t.map((id) => sc(scores, id, h.hole)).map((s, i) => (s === null ? null : Math.max(0, 2 + h.par + st[t[i]][h.hole] - s))).filter((x) => x !== null);
      if (!t.some((id) => scores?.[id]?.[h.hole] !== undefined)) continue;
      pts += v.length ? Math.max(...v) : 0; thru++;
    }
    return { team: t, names: t.map((id) => players.find((p) => p.id === id)?.name || id).join(' & '), points: pts, thru };
  }).sort((a, b) => b.points - a.points);
}
export function standings(game) {
  const f = new Set(game.formats || []);
  return { stableford: f.has('stableford') ? stableford(game) : null, skins: f.has('skins') ? skins(game) : null, match: f.has('match') ? match(game) : null, bestball: f.has('bestball') ? bestBall(game) : null };
}
