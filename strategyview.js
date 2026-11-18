// BreakingPar strategy on the Course view: the caddie tip chip, the Strategy tab, hazard reach / carry labels and the
// tap-and-hold measure (course-view plan 4.3 and section 7). Rendering only; the tips themselves come from caddie.js.
import * as CA from './caddie.js';
import * as HM from './holemap.js';
import * as FEEL from './feel.js';

export const HOLD_MS = 550;                     // tap and hold this long to measure

export function registerStrategy(c, X) {
  const { A, esc } = c, T = FEEL.COPY.caddie, U = () => c.UNIT;
  let cache = { ds: null }, measure = null;
  // golfer-level numbers, worked out once per dataset
  const per = () => {
    if (cache.ds !== c.DS) cache = { ds: c.DS, stats: CA.golferStats(c.DS), bands: A.approachByBand(c.DS.shots, 'm'), hist: new Map() };
    return cache;
  };
  const historyOf = (d) => { const k = `${d.course_id}|${d.hole}`, p = per(); if (!p.hist.has(k)) p.hist.set(k, CA.holeHistory(c.DS, d.course_id, d.hole)); return p.hist.get(k); };
  const u = () => ({ d: (m) => c.cv(m), unit: U(), small: (m) => (U() === 'yd' ? `${Math.round(m / 0.3048)} ft` : `${m.toFixed(1)} m`) });

  // all tips for where you are now, strongest first
  function current() {
    const d = X.D(), L = X.L(), M = X.M(), V = X.V(); if (!d || !L || !M) return { tips: [], sit: null };
    const h = d.holes[d.hole], y = X.yards(), p = per();
    const sit = CA.situation({ pos: L.pos, tee: L.tee, green: L.green, greenPts: L.greenPts, shotsThisHole: (h.shots || []).length, reach_m: X.reach() });
    const tips = CA.tips({
      situation: sit, history: historyOf(d), feats: L.feats.filter((f) => f.kind !== 'hole'), stats: p.stats, wedges: { bands: p.bands, rows: X.wedgeRows() }, u: u(),
      hole: { n: d.hole, par: h.par, si: X.si(), d_green_m: y.mid, front_m: y.front, back_m: y.back, pos: L.pos, green: L.green, greenPts: L.greenPts },
      model: { top: M.top, haz: V?.v2 && V.kind !== 'distance' ? V.haz : [], pos: L.pos, aim: L.aim },
    });
    return { tips, sit };
  }
  const dismissed = (d) => new Set(d.tips_off?.[d.hole] || []);
  function chip() {
    const d = X.D(); if (!d || X.quiet()) return '';
    const off = dismissed(d), t = current().tips.find((x) => !off.has(x.key)); if (!t) return '';
    return `<div class="cv-tip"><button type="button" class="cv-tipb" data-cvtip aria-label="${esc(T.open)}">${esc(t.text)}</button><button type="button" class="cv-tipx" data-cvtipx="${esc(t.key)}" aria-label="${esc(T.dismiss)}">✕</button></div>`;
  }
  async function dismiss(key) {
    const d = X.D(); d.tips_off = d.tips_off || {}; d.tips_off[d.hole] = [...new Set([...(d.tips_off[d.hole] || []), key])]; await X.save();
  }

  // ---- the Strategy tab
  function tab() {
    const d = X.D(), L = X.L(), M = X.M(); if (!d) return '';
    const { tips } = current(), out = [];
    out.push(`<div class="cv-card sg-sec"><h3>${esc(T.forShot)}</h3>${tips.length ? `<ul class="sg-tips">${tips.map((t) => `<li><b>${esc(t.text)}</b>${t.detail ? `<small>${esc(t.detail)}</small>` : ''}</li>`).join('')}</ul>` : `<p class="small muted">${esc(T.noTips)}</p>`}</div>`);
    out.push(`<div class="cv-card sg-sec"><h3>${esc(T.best)}</h3><div class="small" id="cvStrat">${esc(FEEL.COPY.course.working)}</div></div>`);
    const h = historyOf(d);
    out.push(`<div class="cv-card sg-sec"><h3>${esc(T.history)}</h3>${h && h.plays >= CA.MIN.hole_plays
      ? `<p>${esc(T.played(h.plays, h.avg.toFixed(1), h.best))}</p><p class="small">${[h.fw_n ? T.fw(h.fw_hit, h.fw_n) : null, h.gir_n ? T.gir(h.gir_hit, h.gir_n) : null, h.miss_side ? T.missSide(h.miss_side) : null].filter(Boolean).map(esc).join(' · ')}</p>`
      : `<p class="small muted">${esc(T.fewPlays(h?.plays || 0))}</p>`}</div>`);
    if (M?.safer && M.top?.[0] && M.safer !== M.top[0] && M.safer.out && M.top[0].out) {
      out.push(`<div class="cv-card sg-sec"><h3>${esc(T.safer)}</h3><p>${esc(T.saferText(M.safer.club, Math.round(M.safer.out.trouble), M.top[0].club, Math.round(M.top[0].out.trouble)))}</p>
        <button type="button" class="btn sec" data-sgclub="${esc(M.safer.club_id)}">${esc(T.use)} ${esc(M.safer.club)}</button></div>`);
    }
    if (L) {
      const y = X.yards(), sides = CA.greenSides(L.pos, L.green, L.greenPts, L.feats), D = (m) => Math.round(c.cv(m));
      const sideTxt = sides ? Object.entries(sides).filter(([, v]) => v.length).map(([s, v]) => `${v.map((k) => T.kinds[k]).join(' and ')} ${T.sides[s]}`).join(' · ') : '';
      out.push(`<div class="cv-card sg-sec"><h3>${esc(T.green)}</h3>${y.front !== null ? `<p>${esc(T.fmb(D(y.front), D(y.mid), D(y.back), U()))} · ${esc(T.depth(D(y.back - y.front), U()))}</p><p class="small">${esc(sideTxt || T.besideNone)}</p>` : `<p class="small muted">${esc(T.noGreenMap)}</p>`}</div>`);
      const parts = M?.pl?.parts, wx = L.wx, sg = (v) => `${v > 0 ? 'adds' : 'takes off'} ${Math.round(c.cv(Math.abs(v)))} ${U()}`, lines = [];
      if (parts) {
        if (Math.abs(parts.elev) >= 0.9) lines.push(T.cond.elev(sg(parts.elev)));
        if (wx && Math.abs(parts.wind) >= 0.9) lines.push(T.cond.wind(sg(parts.wind), Math.round(wx.wind_kmh), X.compass(wx.wind_from)));
        if (wx && Math.abs(parts.temp) >= 0.9) lines.push(T.cond.temp(Math.round(wx.temp_c), sg(parts.temp)));
        if (Math.abs(parts.alt) >= 0.9) lines.push(T.cond.alt(sg(parts.alt)));
      }
      out.push(`<div class="cv-card sg-sec"><h3>${esc(T.conditions)}</h3><p class="small">${lines.length ? lines.map(esc).join('<br>') : esc(L.grid || wx ? T.condFlat : T.condNone)}</p></div>`);
    }
    return out.join('');
  }

  // ---- on the map: hazard reach / carry labels (plan 4.3) and the tap-and-hold measure
  function labelsSvg(fr) {
    const L = X.L(); if (!L || X.quiet()) return '';
    const dG = A.haversine(L.pos[0], L.pos[1], L.green[0], L.green[1]), reach = X.reach();
    const hz = CA.hazardReach(L.pos, L.aim, L.feats, { max_m: Math.min(dG + 10, reach || dG + 10) });
    const v = fr.view || { l: 0, t: 0, w: fr.w, h: fr.h }, boxes = [], keep = X.obstacles(fr);
    const hit = (r) => [...keep, ...boxes].some((b) => r.x < b.x + b.w && r.x + r.w > b.x && r.y < b.y + b.h && r.y + r.h > b.y);
    for (const z of hz) {
      const name = FEEL.COPY.caddie.kinds[z.kind] || z.kind, nums = `${Math.round(c.cv(z.reach_m))} / ${Math.round(c.cv(z.carry_m))}`;
      const w = Math.max(name.length * 9, nums.length * 17) + 16, h = 56, [ax, ay] = fr.xy(...z.pt);
      // beside the hazard on its own side of the line; else the other side; else a little lower; never over the aim,
      // its distances, the green distances or another label – if none fits, the label is left out
      const clamp = (x, y) => ({ x: Math.max(v.l + 4, Math.min(v.l + v.w - w - 4, x)), y: Math.max(v.t + 4, Math.min(v.t + v.h - h - 4, y)), w, h });
      const xs = z.side > 0 ? [ax + 14, ax - 14 - w, ax - w / 2] : [ax - 14 - w, ax + 14, ax - w / 2];
      const spot = [0, h + 6, -(h + 6), 2 * (h + 6), -2 * (h + 6), 3 * (h + 6)].flatMap((dy) => xs.map((x) => clamp(x, ay - h / 2 + dy))).find((r) => !hit(r));
      if (spot) boxes.push({ ...spot, name, nums, kind: z.kind, ax, ay });
    }
    // a label moved away from its hazard gets a thin line back to it
    const lead = (b) => { const cx = Math.max(b.x, Math.min(b.x + b.w, b.ax)), cy = Math.max(b.y, Math.min(b.y + b.h, b.ay)); return Math.hypot(cx - b.ax, cy - b.ay) > 18 ? `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${b.ax.toFixed(1)}" y2="${b.ay.toFixed(1)}" stroke="#0a3d2b" stroke-width="5" stroke-linecap="round"/><line class="hm-lead" x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${b.ax.toFixed(1)}" y2="${b.ay.toFixed(1)}" stroke="${b.kind === 'water' ? '#7cc0ff' : '#e6cf86'}" stroke-width="2.5" stroke-linecap="round"/><circle cx="${b.ax.toFixed(1)}" cy="${b.ay.toFixed(1)}" r="5" fill="${b.kind === 'water' ? '#7cc0ff' : '#e6cf86'}" stroke="#0a3d2b" stroke-width="2"/>` : ''; };
    return boxes.map((b) => `<g class="hm-haz" data-kind="${b.kind}">${lead(b)}<rect x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.w}" height="${b.h}" rx="8" fill="rgba(7,44,31,.88)" stroke="${b.kind === 'water' ? '#7cc0ff' : '#e6cf86'}" stroke-width="1.5"/>
      <text x="${(b.x + 8).toFixed(1)}" y="${(b.y + 17).toFixed(1)}" fill="#fff" style="font:700 15px var(--sans)">${esc(b.name)}</text>
      <text x="${(b.x + 8).toFixed(1)}" y="${(b.y + 47).toFixed(1)}" fill="#fff" style="font:700 28px var(--serif)">${esc(b.nums)}</text></g>`).join('');
  }
  function measureSvg(fr) {
    const L = X.L(); if (!L || !measure) return '';
    const [x, y] = fr.xy(...measure), a = A.haversine(L.pos[0], L.pos[1], measure[0], measure[1]), b = A.haversine(measure[0], measure[1], L.green[0], L.green[1]);
    const lab = (yy, t) => `<text x="${(x + 22).toFixed(1)}" y="${yy.toFixed(1)}" fill="#fff" stroke="#0a3d2b" stroke-width="3.5" paint-order="stroke" style="font:700 15px var(--sans)">${esc(t)}</text>`;
    return `<g class="hm-measure"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="10" fill="none" stroke="#f2cf4a" stroke-width="3"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#f2cf4a"/>
      ${HM.tag(x + 52, y - 26, Math.round(c.cv(a)), 28)}${lab(y - 52, T.fromYou)}${HM.tag(x + 52, y + 26, Math.round(c.cv(b)), 28)}${lab(y + 60, T.toGreen)}</g>`;
  }

  async function click(b) {
    if (b.hasAttribute('data-cvtip')) { X.open('strategy'); return true; }
    if (b.dataset.cvtipx) { await dismiss(b.dataset.cvtipx); X.chrome(); return true; }
    if (b.dataset.sgclub) { X.useClub(b.dataset.sgclub); return true; }
    return false;
  }
  return { chip, tab, labelsSvg, measureSvg, click, setMeasure: (pt) => { measure = pt; }, measuring: () => !!measure, current, _state: () => ({ measure }) };
}
