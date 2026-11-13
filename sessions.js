// Practice sessions and the daily challenge. Pure logic so Node can test it.
import { GUIDED, minutesFor } from './games.js';

const DAY = 864e5;
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const addDays = (date, n) => iso(new Date(new Date(`${date}T12:00:00`).getTime() + n * DAY));
export const GAME_COUNT = { 30: 2, 45: 3, 60: 4 };
export const SESSION_SKILL_FOCUS = { putting: 'three_putts', short: 'scrambling', approach: 'gir', driving: 'fairways' };

// Build a session of 2, 3 or 4 games from the two focus skills: weakest sub-skill first, alternating skills,
// and nothing that was played yesterday while there is still something else to play.
export function buildSession({ minutes = 45, ratings, results = [], today, pool = [] } = {}) {
  const want = GAME_COUNT[minutes] || (minutes <= 30 ? 2 : minutes <= 45 ? 3 : 4), yest = addDays(today, -1);
  const played = new Set(results.filter((r) => String(r.date).slice(0, 10) === yest).map((r) => r.game));
  const skills = ratings?.skills || [], focusKeys = ratings?.focus || [];
  const lanes = (keys) => keys.map((k) => skills.find((s) => s.key === k)).filter(Boolean).map((s) => ({
    skill: s, queue: [...s.subs].sort((a, b) => (b.strokes || 0) - (a.strokes || 0)).flatMap((sub) => sub.games.filter((g) => GUIDED.has(g.id)).map((g) => ({ id: g.id, name: g.name, skill: s.key, skill_title: s.title, sub: sub.title, target: g.target, better: g.better }))) }));
  const picked = [], has = (id) => picked.some((x) => x.id === id);
  const drain = (ls, avoidPlayed) => {
    let progress = true;
    while (picked.length < want && progress) {
      progress = false;
      for (const l of ls) {
        if (picked.length >= want) break;
        const i = l.queue.findIndex((g) => !has(g.id) && !(avoidPlayed && played.has(g.id)));
        if (i >= 0) { picked.push(l.queue.splice(i, 1)[0]); progress = true; }
      }
    }
  };
  const focus = lanes(focusKeys);
  drain(focus, true);
  if (picked.length < want) drain(lanes(skills.filter((s) => s.rated && !focusKeys.includes(s.key)).sort((a, b) => b.strokes - a.strokes).map((s) => s.key)), true);
  if (picked.length < want) drain(focus, false);
  for (const id of pool) { if (picked.length >= want) break; if (GUIDED.has(id) && !has(id) && !played.has(id)) picked.push({ id, name: id, skill: null }); }
  const games = picked.map((g) => ({ ...g, minutes: minutesFor(g.id) }));
  // keep it roughly in the time asked for
  while (games.length > 2 && games.reduce((t, g) => t + g.minutes, 0) > minutes * 1.3) games.pop();
  return { minutes, games, total: games.reduce((t, g) => t + g.minutes, 0) };
}

// Same game for the same date. On four days a week it comes from the focus areas, otherwise from the general pool.
export const FOCUS_DAYS = [1, 2, 4, 6];                                   // Mon, Tue, Thu, Sat
const hash = (s) => { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
export function dailyChallenge(date, { focusGames = [], pool = [] } = {}) {
  const dow = new Date(`${date}T12:00:00`).getDay(), n = hash(date), fg = [...new Set(focusGames)].filter((id) => GUIDED.has(id)).sort(), pl = pool.filter((id) => GUIDED.has(id));
  if (FOCUS_DAYS.includes(dow) && fg.length) return { game: fg[n % fg.length], focus: true };
  return { game: pl[n % pl.length], focus: false };
}
// consecutive days (ending today, or yesterday if today is still open) with a completed daily challenge
export function dailyStreak(daily = {}, today) {
  let d = daily[today] ? today : addDays(today, -1), n = 0;
  while (daily[d]) { n++; d = addDays(d, -1); }
  return n;
}
