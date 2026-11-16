// BreakingPar locker: things to earn and show off (plan section 9). Nothing is bought; every item is tied to one real achievement.
// Unlock state is DERIVED each time from level, journey, streaks, tiers, duels and predictions, so it cannot drift and nothing is taken away.
// Only the golfer's choices are stored (state.settings.look). A choice that is not unlocked falls back to the free default.
import * as LV from './level.js';

export const KINDS = [['wallpaper', 'Lock-screen themes'], ['skin', 'App colours'], ['badge', 'Badge style'], ['confetti', 'Confetti']];
export const DEFAULTS = { skin: 'clubhouse', badge: 'roundel', confetti: 'classic', wallpaper: 'green' };
// rule types: free | rank n | streak n (best weekly streak) | boss (any passed) | boss_n n (that milestone passed) | duels n | tier key (first earned) | predictions n
export const CATALOGUE = [
  { key: 'green', kind: 'wallpaper', name: 'Augusta green', rule: { t: 'free' } }, { key: 'night', kind: 'wallpaper', name: 'Night', rule: { t: 'free' } }, { key: 'cream', kind: 'wallpaper', name: 'Cream', rule: { t: 'free' } },
  { key: 'dawn', kind: 'wallpaper', name: 'Links dawn', rule: { t: 'rank', n: 3 } }, { key: 'tweed', kind: 'wallpaper', name: 'Heritage tweed', rule: { t: 'streak', n: 8 } },
  { key: 'sunday', kind: 'wallpaper', name: 'Championship Sunday', rule: { t: 'boss' } }, { key: 'gold', kind: 'wallpaper', name: 'Gold leaf', rule: { t: 'boss_n', n: 5 } },
  { key: 'clubhouse', kind: 'skin', name: 'Clubhouse green', rule: { t: 'free' } }, { key: 'claret', kind: 'skin', name: 'Claret', rule: { t: 'rank', n: 4 } },
  { key: 'navy', kind: 'skin', name: 'Navy blazer', rule: { t: 'rank', n: 6 } }, { key: 'sand', kind: 'skin', name: 'Links sand', rule: { t: 'duels', n: 10 } },
  { key: 'midnight', kind: 'skin', name: 'Midnight gold', rule: { t: 'rank', n: 8 } },
  { key: 'roundel', kind: 'badge', name: 'Roundel', rule: { t: 'free' } }, { key: 'shield', kind: 'badge', name: 'Shield', rule: { t: 'tier', tier: 'gold' } },
  { key: 'pennant', kind: 'badge', name: 'Pennant', rule: { t: 'tier', tier: 'platinum' } }, { key: 'laurel', kind: 'badge', name: 'Laurel', rule: { t: 'boss_n', n: 10 } },
  { key: 'classic', kind: 'confetti', name: 'Classic', rule: { t: 'free' } }, { key: 'gold', kind: 'confetti', name: 'Gold only', rule: { t: 'predictions', n: 5 } },
  { key: 'flags', kind: 'confetti', name: 'Flags', rule: { t: 'rank', n: 5 } },
];
export const itemKey = (it) => `${it.kind}:${it.key}`;      // keys repeat across kinds ("gold"), so the stored key includes the kind

const TIER_RANK = { bronze: 1, silver: 2, gold: 3, platinum: 4 };
const rankName = (n) => LV.RANKS.find((r) => r.n === n)?.name || `rank ${n}`;
export function how(rule) {
  switch (rule.t) {
    case 'rank': return `Reach rank ${rule.n}, ${rankName(rule.n)}`;
    case 'streak': return `Keep a ${rule.n}-week streak`;
    case 'boss': return 'Pass any boss game';
    case 'boss_n': return `Pass the Beat the ${rule.n} boss game`;
    case 'duels': return `Play ${rule.n} duels`;
    case 'tier': return `Earn your first ${rule.tier[0].toUpperCase()}${rule.tier.slice(1)} tier in any game`;
    case 'predictions': return `Beat the prediction ${rule.n} times`;
    default: return 'Free';
  }
}

// Everything the unlock rules need, all derived by the caller from history:
//   level: playerLevel() result; bosses: [{ n, passed }]; streaks: { best }; tiers: ids of earned tier badges ("tier-<game>-<key>"); duels: number played; predictions: number beaten
export function locker({ level = null, bosses = [], streaks = null, tiers = [], duels = 0, predictions = 0 } = {}) {
  const rank = level?.rank?.n || 1, points = level?.points || 0, best = streaks?.best || 0, passed = (bosses || []).filter((b) => b && b.passed);
  const top = tiers.reduce((m, id) => Math.max(m, TIER_RANK[String(id).split('-').pop()] || 0), 0);
  const items = CATALOGUE.map((it) => {
    const r = it.rule; let unlocked = false, progress = null;
    switch (r.t) {
      case 'free': unlocked = true; break;
      case 'rank': unlocked = rank >= r.n; progress = { have: Math.min(points, LV.RANKS[r.n - 1].at), need: LV.RANKS[r.n - 1].at }; break;
      case 'streak': unlocked = best >= r.n; progress = { have: Math.min(best, r.n), need: r.n }; break;
      case 'boss': unlocked = passed.length > 0; break;
      case 'boss_n': unlocked = passed.some((b) => b.n === r.n); break;
      case 'duels': unlocked = duels >= r.n; progress = { have: Math.min(duels, r.n), need: r.n }; break;
      case 'tier': unlocked = top >= TIER_RANK[r.tier]; break;
      case 'predictions': unlocked = predictions >= r.n; progress = { have: Math.min(predictions, r.n), need: r.n }; break;
    }
    return { ...it, id: itemKey(it), unlocked, how: how(r), progress: unlocked ? null : progress };
  });
  return { items, unlocked: new Set(items.filter((i) => i.unlocked).map((i) => i.id)) };
}

// The golfer's choices, with anything not unlocked replaced by the default
export function resolveLook(look, lk) {
  const out = {}; for (const k of Object.keys(DEFAULTS)) { const c = look?.[k]; out[k] = c && lk.unlocked.has(`${k}:${c}`) ? c : DEFAULTS[k]; }
  return out;
}
// Items that have unlocked since `seen` (a list of ids, or undefined the first time, when everything already unlocked is taken as the starting point)
export const fresh = (lk, seen) => (Array.isArray(seen) ? lk.items.filter((i) => i.unlocked && i.rule.t !== 'free' && !seen.includes(i.id)) : []);

// ------------------------------------------------------------------ app colours
// Each skin sets the same custom properties as the default theme, in a light and a dark set. Contrast of every text pair is tested (tests/locker.test.mjs).
export const SKINS = {
  claret: {
    light: { bg: '#f6efe9', card: '#fffaf5', ink: '#2a1a1f', muted: '#6b5860', line: '#e6d9d0', accent: '#8a1f3d', accentInk: '#ffffff', tint: '#f3e4e2', chip: '#efe3da', gold: '#b8922a', flag: '#f2cf4a', good: '#0b6b47', bad: '#b8322a', warn: '#96650a', head: '#5a1a2b', head2: '#3f1020' },
    dark: { bg: '#1f0d14', card: '#2e1520', ink: '#f6ece6', muted: '#c9afb7', line: '#47232f', accent: '#f0b3c1', accentInk: '#2a0f18', tint: '#3b1b28', chip: '#38192a', gold: '#d8b64e', flag: '#f2cf4a', good: '#7fdcaa', bad: '#ff8f84', warn: '#f2cf4a', head: '#3f1020', head2: '#2b0a15' } },
  navy: {
    light: { bg: '#eef1f5', card: '#fbfcfe', ink: '#142033', muted: '#5a6678', line: '#d9dfe8', accent: '#1d3a6b', accentInk: '#ffffff', tint: '#e2e9f4', chip: '#e5e9f0', gold: '#b8922a', flag: '#f2cf4a', good: '#0b6b47', bad: '#b8322a', warn: '#96650a', head: '#14284b', head2: '#0c1a33' },
    dark: { bg: '#0a1424', card: '#12213a', ink: '#eef2f8', muted: '#aab6c8', line: '#223555', accent: '#f2cf4a', accentInk: '#0c1a33', tint: '#1a2d4d', chip: '#19294a', gold: '#d8b64e', flag: '#f2cf4a', good: '#7fdcaa', bad: '#ff8f84', warn: '#f2cf4a', head: '#0c1a33', head2: '#070f1f' } },
  sand: {
    light: { bg: '#f4ecd9', card: '#fffaed', ink: '#2b2416', muted: '#6a6048', line: '#e5d9bc', accent: '#7a5a12', accentInk: '#ffffff', tint: '#f0e5c8', chip: '#ece0c2', gold: '#a07c1a', flag: '#f2cf4a', good: '#0b6b47', bad: '#b8322a', warn: '#8a5a00', head: '#4d3f1c', head2: '#352b12' },
    dark: { bg: '#1d180c', card: '#2a2314', ink: '#f6efdc', muted: '#bfb496', line: '#42381f', accent: '#e8c45a', accentInk: '#241d0a', tint: '#352c17', chip: '#33291a', gold: '#d8b64e', flag: '#f2cf4a', good: '#7fdcaa', bad: '#ff8f84', warn: '#f2cf4a', head: '#2b2210', head2: '#1b160a' } },
  midnight: {
    light: { bg: '#f1eff2', card: '#fdfcfe', ink: '#1b1824', muted: '#625e70', line: '#dedae6', accent: '#4a3a86', accentInk: '#ffffff', tint: '#e8e4f2', chip: '#e6e2ee', gold: '#a88420', flag: '#f2cf4a', good: '#0b6b47', bad: '#b8322a', warn: '#8a5a00', head: '#231d3a', head2: '#171226' },
    dark: { bg: '#0b0a14', card: '#16142a', ink: '#f2eff8', muted: '#b3aec6', line: '#2a2547', accent: '#f2cf4a', accentInk: '#17122a', tint: '#1f1b3a', chip: '#1e1a38', gold: '#e0bd52', flag: '#f2cf4a', good: '#7fdcaa', bad: '#ff8f84', warn: '#f2cf4a', head: '#120f24', head2: '#0a0818' } },
};
export const SKIN_VARS = {"bg": "--bg", "card": "--card", "ink": "--ink", "muted": "--muted", "line": "--line", "accent": "--accent", "accentInk": "--accent-ink", "tint": "--tint", "chip": "--chip", "gold": "--gold", "flag": "--flag", "good": "--good", "bad": "--bad", "warn": "--warn", "head": "--head", "head2": "--head2"};
// pairs that must keep 4.5:1 or better, as [foreground, background]
export const SKIN_PAIRS = [['ink', 'bg'], ['ink', 'card'], ['muted', 'card'], ['muted', 'bg'], ['accent', 'card'], ['accent', 'bg'], ['accentInk', 'accent'], ['good', 'card'], ['bad', 'card'], ['warn', 'card'], ['ink', 'tint'], ['ink', 'chip'], ['muted', 'chip'], ['good', 'tint'], ['flag', 'head']];
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const luminance = (h) => { const [r, g, b] = rgb(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
export function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
export function hue(h) { const [r, g, b] = rgb(h).map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; const k = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (k * 60 + 360) % 360; }
const decl = (t) => Object.entries(SKIN_VARS).map(([k, v]) => `${v}:${t[k]}`).join(';');
// CSS for every skin: light set; dark set when the phone is dark (unless the app is set to light); dark set when the app is set to dark
export function skinCss() {
  return Object.entries(SKINS).map(([k, s]) => `:root[data-skin="${k}"]{${decl(s.light)}}@media (prefers-color-scheme:dark){:root:not([data-theme="light"])[data-skin="${k}"]{${decl(s.dark)}}}:root[data-theme="dark"][data-skin="${k}"]{${decl(s.dark)}}`).join('\n');
}
