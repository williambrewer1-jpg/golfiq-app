// On-course challenges: one small goal for a round, tracked live from the scorecard. Pure logic so Node can test it.
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
// kind 'zero' = nothing allowed; 'min' = at least `base` (scaled for 9 holes)
export const CHALLENGES = [
  { key: 'no-three-putts', title: 'No three-putts', short: 'three-putts', skill: 'putting', sub: 'putting.lag', kind: 'zero' },
  { key: 'updowns', label: (g) => `${g} up-and-downs`, short: 'up-and-downs', skill: 'short', sub: 'short.updown', kind: 'min', base: 5 },
  { key: 'fairways', label: (g) => `${g} fairways`, short: 'fairways', skill: 'driving', sub: 'driving.accuracy', kind: 'min', base: 10 },
  { key: 'no-penalties', title: 'No penalties', short: 'penalties', skill: 'driving', sub: 'driving.penalties', kind: 'zero' },
  { key: 'greens', label: (g) => `${g} greens`, short: 'greens', skill: 'approach', sub: 'approach.gir', kind: 'min', base: 8 },
];
export const byKey = (k) => CHALLENGES.find((x) => x.key === k) || null;
export const forSub = (fullKey) => CHALLENGES.find((x) => x.sub === fullKey) || null;
export const goalFor = (ch, n = 18) => (ch.kind === 'zero' ? 0 : Math.max(1, Math.round(ch.base * n / 18)));
export const titleFor = (ch, n = 18) => ch.title || ch.label(goalFor(ch, n));

const played = (holes) => holes.filter((h) => isNum(h.strokes) && h.strokes > 0);
const gir = (h) => isNum(h.putts) && isNum(h.par) && h.strokes - h.putts <= h.par - 2;
export function count(key, holes) {
  const hs = played(holes);
  switch (key) {
    case 'no-three-putts': return hs.filter((h) => isNum(h.putts) && h.putts >= 3).length;
    case 'updowns': return hs.filter((h) => isNum(h.putts) && h.putts >= 1 && !gir(h) && h.strokes <= h.par).length;
    case 'fairways': return hs.filter((h) => h.par >= 4 && h.fairway === 'HIT').length;
    case 'no-penalties': return hs.reduce((t, h) => t + (h.penalties || 0), 0);
    case 'greens': return hs.filter(gir).length;
    default: return 0;
  }
}
// live status while the round is being played. holes: the round's hole objects; n: holes in the round
export function status(key, holes, n = 18) {
  const ch = byKey(key); if (!ch) return null;
  const goal = goalFor(ch, n), value = count(key, holes), left = n - played(holes).length;
  if (ch.kind === 'zero') return { key, title: titleFor(ch, n), value, goal, left, state: value > 0 ? 'failed' : left === 0 ? 'achieved' : 'on', text: value > 0 ? `${value} ${ch.short} – missed` : `none yet` };
  const state = value >= goal ? 'achieved' : value + left < goal ? 'failed' : 'on';
  return { key, title: titleFor(ch, n), value, goal, left, state, text: `${value} of ${goal}` };
}
// the stored outcome when the round is saved; a part round does not count a "nothing allowed" challenge
export function outcome(key, holes, n = 18) {
  const s = status(key, holes, n); if (!s) return null;
  return { key, goal: s.goal, value: s.value, n, achieved: s.state === 'achieved' };
}

// Offer one challenge: the one for a sub-skill that is stalled on the course, else the weakest focus sub-skill, never the same twice running.
export function pickChallenge({ ratings, ledger = [], history = [], n = 18 } = {}) {
  const last = history.length ? [...history].sort((a, b) => String(a.date).localeCompare(String(b.date))).pop().key : null, focus = ratings?.focus || [];
  const stalled = ledger.filter((x) => x.stalled).map((x) => forSub(x.sub)).filter(Boolean);
  const ranked = (ratings?.skills || []).filter((s) => focus.includes(s.key)).flatMap((s) => s.subs.map((x) => ({ ch: forSub(x.full_key), strokes: x.strokes || 0 }))).filter((x) => x.ch).sort((a, b) => b.strokes - a.strokes).map((x) => x.ch);
  const order = [...stalled, ...ranked, ...CHALLENGES.filter((c) => focus.includes(c.skill))];
  const seen = new Set(), list = order.filter((c) => !seen.has(c.key) && seen.add(c.key));
  const pick = list.find((c) => c.key !== last) || list[0] || null;
  return pick ? { ...pick, goal: goalFor(pick, n), name: titleFor(pick, n), stalled: stalled.some((x) => x.key === pick.key) } : null;
}
