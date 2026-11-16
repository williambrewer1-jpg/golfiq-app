// Kudos: a one-tap reaction (Clap, Fire or Flag) to a friend's score (retention plan 8.1). Pure logic; the Firestore calls are in cloud.js.
// A reaction is one small document per person per score: groups/{g}/kudos/{scoreId}_{fromUid}. The document id is what keeps it to one each.
// Only the score id, who gave it, the kind, a time and the score's week are shared. No round data.
export const KINDS = ['clap', 'fire', 'flag'];
export const ICON = { clap: 'clap', fire: 'flame', flag: 'flag' };          // names in icons.js
export const MAX_FIELDS = 8;                                                // the Firestore rule allows at most 8 fields

export const docId = (scoreId, uid) => `${scoreId}_${uid}`;

// The document to write for a reaction, or null when it must not be sent: no reacting to your own score, an unknown kind, or a missing id.
export function give({ score, uid, nick, kind, now = new Date() } = {}) {
  if (!score || !score.id || !score.uid || !uid || !KINDS.includes(kind)) return null;
  if (score.uid === uid) return null;
  return { score_id: score.id, to_uid: score.uid, from_uid: uid, from_nick: String(nick || 'Golfer').slice(0, 30), kind, at: new Date(now).toISOString(), week: score.week || '' };
}

// How many of each kind a score has, the total, and which one is mine (or null)
export function counts(kudos, scoreId, me) {
  const out = { clap: 0, fire: 0, flag: 0, total: 0, mine: null };
  for (const k of kudos || []) {
    if (k.score_id !== scoreId || !KINDS.includes(k.kind)) continue;
    out[k.kind]++; out.total++; if (k.from_uid === me) out.mine = k.kind;
  }
  return out;
}

// What a tap does: nothing yet -> give; the same kind again -> take it back; another kind -> replace it (the rules allow create and delete, not update)
export function tap(kudos, scoreId, me, kind) {
  const mine = counts(kudos, scoreId, me).mine;
  return mine === null ? 'give' : mine === kind ? 'take' : 'switch';
}
// the same list after a tap, so the screen can update before the network answers
export function apply(kudos, doc, action) {
  const rest = (kudos || []).filter((k) => !(k.score_id === doc.score_id && k.from_uid === doc.from_uid));
  return action === 'take' ? rest : [...rest, doc];
}

// Reactions to my scores that are newer than `seen` (an ISO time; null = all), grouped by score, newest first.
// scores: the score documents (to find the game and score); reactions I gave myself never count.
export function incoming(kudos, me, scores, seen = null) {
  const by = new Map();
  for (const k of kudos || []) {
    if (k.to_uid !== me || k.from_uid === me || !k.at || (seen && !(k.at > seen))) continue;
    if (!by.has(k.score_id)) by.set(k.score_id, []);
    by.get(k.score_id).push(k);
  }
  const items = [...by].map(([score_id, list]) => {
    list.sort((a, b) => b.at.localeCompare(a.at));
    const s = (scores || []).find((x) => x.id === score_id), nicks = [...new Set(list.slice().reverse().map((k) => k.from_nick || 'Golfer'))];
    return { score_id, game_name: s?.game_name || '', score: s?.score ?? null, nicks, count: list.length, at: list[0].at };
  }).sort((a, b) => b.at.localeCompare(a.at));
  return { items, latest: items[0]?.at || null };
}
// "Sam", "Sam and Kim", "Sam and 2 others" as { who: [names shown], others: n }
export function who(item) {
  const n = item.nicks;
  return n.length <= 2 ? { who: n, others: 0 } : { who: [n[0]], others: n.length - 1 };
}
// the newest reaction time in a list (used to start from "nothing new" the first time)
export const newest = (kudos) => (kudos || []).reduce((m, k) => (k.at && k.at > m ? k.at : m), '') || null;
