// BreakingPar shot tracking on the Course view: the bottom strip's "I've hit" / "At my ball" loop, the result strip,
// corrections, penalties, putting, the hole summary and the shot list (course-view plan 6.1–6.5).
// Rendering and wiring only; the rules are in shots.js. course.js calls in through the object returned here.
import * as SH from './shots.js';
import * as FEEL from './feel.js';

export const NEAR_GREEN_M = 40;                 // within this of the green the strip also offers "On the green"

export function registerTrack(c, X) {
  const { A, esc } = c, T = FEEL.COPY.track, U = () => c.UNIT;
  // transient, per hole: the result strip, the editor, the penalty question, marking on the map, the putt panel
  let strip = null, editor = null, asking = false, marking = false, markShot = null, putt = { n: null, k: null }, open = null, timer = 0, ofHole = '';
  const on = (d) => !!d?.track;
  const holeOf = (d) => d.holes[d.hole];
  const key = (d) => `${d.id}|${d.hole}`;
  const reset = () => { strip = null; editor = null; asking = false; marking = false; markShot = null; putt = { n: null, k: null }; open = null; clearTimeout(timer); };
  const sync = (d) => { if (ofHole !== key(d)) { reset(); ofHole = key(d); } };
  const b = (act, label, cls = 'sec', v = '', extra = '') => `<button type="button" class="btn ${cls}" data-tr="${act}"${v !== '' ? ` data-v="${esc(String(v))}"` : ''}${extra}>${esc(label)}</button>`;
  const row = (...btns) => `<div class="cv-pbtns tr-btns">${btns.filter(Boolean).join('')}</div>`;
  const line = (t, cls = '') => `<p class="tr-line ${cls}">${t}</p>`;
  const clubName = (id) => (id ? X.label(id) : '');
  const fpFt = (k) => (k === 0 ? 1 : k * SH.FIRST_PUTT_STEP_FT);
  const fpText = (k) => (k === null ? T.notSet : U() === 'yd' ? `${fpFt(k)} ft` : `${(fpFt(k) * SH.FT).toFixed(1)} m`);

  // ---- the result of a shot, in words: "238 yd · Fairway · 7 yd right of aim"
  function describe(s) {
    const sl = SH.shotLine(s), bits = [];
    if (sl) bits.push(`${c.d0(sl.dist_m)} ${U()}${s.approx ? ` ${T.approxShot}` : ''}`);
    if (s.penalty) bits.push(T.pen[s.penalty]); else if (s.result) bits.push(T.results[s.result]);
    if (sl && A.isNum(sl.right_m) && !s.penalty) { const v = Math.round(c.cv(Math.abs(sl.right_m))); bits.push(v ? T.side(v, U(), sl.right_m > 0 ? 'right' : 'left') : T.onLine); }
    return bits.join(' · ');
  }
  function stripHtml(d, s) {
    const h = holeOf(d), i = h.shots.indexOf(s), club = clubName(s.club_id);
    return `<div class="tr-strip" role="status"><p class="tr-res">${esc(describe(s) || T.whereFinished)}</p>${s.approx && !s.marked ? `<p class="tr-warn">${esc(T.approx)}</p>` : ''}
      <div class="tr-acts">${club ? b('club', s.club_assumed ? T.clubGuess(club) : club, 'sec tr-club', i) : ''}${b('edit', T.edit, 'sec', i)}${b('undo', T.undo)}${b('pen', T.penalty)}</div></div>`;
  }
  function editorHtml(d) {
    const h = holeOf(d), s = h.shots[editor.i]; if (!s) return '';
    if (editor.mode === 'club') {
      return `<div class="tr-ed"><p class="tr-q">${esc(T.whichClub)}</p><div class="tr-chips tr-scroll">${X.clubs().map((k) => b('setclub', k.name, s.club_id === k.club_id && !s.club_assumed ? 'on' : 'sec', k.club_id)).join('')}</div>${row(b('eddone', T.done, ''))}</div>`;
    }
    return `<div class="tr-ed"><p class="tr-q">${esc(T.whereFinished)}${s.end ? '' : ` <small>${esc(T.noFix)}</small>`}</p><div class="tr-chips">${SH.RESULTS.map((r) => b('setres', T.results[r], s.result === r ? 'on' : 'sec', r)).join('')}</div>
      ${row(b('markedit', T.mark), b('eddone', T.done, ''))}</div>`;
  }
  function puttingHtml(d) {
    const ks = Array.from({ length: SH.PUTTS_MAX + 1 }, (_, i) => i);
    return `<div class="tr-putt">${line(`<b>${esc(T.onGreen)}</b> · ${esc(T.puttsHint)}`)}
      <div class="tr-pn" role="group" aria-label="${esc(T.putts)}">${ks.map((k) => b('putts', k === SH.PUTTS_MAX ? T.puttMore : String(k), putt.n === k ? 'on' : 'sec', k)).join('')}</div>
      <label class="tr-fp"><span>${esc(T.firstPutt)} <b id="trFpv">${esc(fpText(putt.k))}</b></span>
        <input type="range" id="trFp" class="${putt.k === null ? 'unset' : ''}" min="0" max="${SH.FIRST_PUTT_MAX_FT / SH.FIRST_PUTT_STEP_FT}" step="1" value="${putt.k ?? 4}" aria-label="${esc(T.firstPutt)}"></label>
      ${row(b('holeout', T.holeOut, '', '', putt.n === null ? ' disabled' : ''), b('notgreen', T.notGreen))}</div>`;
  }

  // ---- the bottom strip while tracking. info = the club / distance / pattern rows the Course view shows anyway.
  function peek(info) {
    const d = X.D(); if (!on(d)) return null; sync(d);
    const h = holeOf(d), st = SH.stateOf(h, { onGreen: X.onGreen() }), last = SH.lastShot(h);
    if (marking) return line(esc(T.markPrompt), 'tr-prompt') + row(b('markcancel', T.cancel));
    if (asking) return line(esc(T.penaltyAsk)) + `<div class="tr-chips">${SH.PENALTIES.map((k) => b('setpen', T.pen[k], 'sec', k)).join('')}</div>` + row(b('pencancel', T.cancel));
    if (editor) return editorHtml(d);
    if (st === 'putting') return puttingHtml(d);
    // walking to the ball. "I've hit" stays here for a forgotten "At my ball": it closes this shot where the next one starts.
    if (st === 'open') return line(esc(T.walking(last.n, clubName(last.club_id))), 'tr-walk') + row(b('ball', T.atBall, 'cv-big'), b('pen', T.penalty))
      + `<div class="cv-pbtns tr-btns tr-btns2">${b('hit', T.hit)}${b('mark', T.mark)}${b('undo', T.undo)}</div>`;
    if (st === 'drop') return line(esc(T.dropPrompt), 'tr-prompt') + row(b('ball', T.atBall, 'cv-big'), b('mark', T.mark), b('undo', T.undo));
    if (st === 'done') return line(`<b>${esc(T.holeDone(d.hole, h.strokes, SH.scoreName(h.strokes, h.par)))}</b>`, 'tr-donel') + row(b('next', `${T.next} ›`, 'cv-big'), b('score', T.score));
    const top = strip && last && Date.now() < strip.until ? stripHtml(d, last) : info;
    return top + row(b('hit', T.hit, 'cv-big'), X.nearGreen(NEAR_GREEN_M) ? b('green', T.onGreen) : '', b('score', T.score));
  }

  // ---- actions
  async function save(redraw = 'peek') { await X.save(); if (redraw === 'map') X.reset(); else if (redraw === 'sheet') { X.refreshSheet(); X.dyn(); } else { X.peek(); X.dyn(); } X.remeasure(); }
  function showStrip() {
    strip = { until: Date.now() + SH.STRIP_MS }; clearTimeout(timer);
    timer = setTimeout(() => { strip = null; if (!editor) X.peek(); X.remeasure(); }, SH.STRIP_MS + 30);
  }
  async function closeAt(marked = null) {
    const d = X.D(), h = holeOf(d), w = X.where(d), f = X.fix();
    const r = SH.close(h, { gps: f ? [f.lat, f.lon] : null, acc: f?.acc ?? null, marked, feats: w.feats });
    if (!r) return;
    if (r.kind === 'end') { if (r.shot.result === null) editor = { i: h.shots.indexOf(r.shot), mode: 'result' }; else showStrip(); }
    FEEL.play('shot');
    await save('map');
  }
  async function click(btn) {
    const act = btn.dataset.tr; if (!act) return false;
    const d = X.D(), h = holeOf(d), v = btn.dataset.v;
    if (act === 'hit') {
      const L = X.L(), M = X.M(), w = X.where(d), f = X.fix();
      SH.hit(h, { gps: f ? [f.lat, f.lon] : null, acc: f?.acc ?? null, tee: w.ht.tee, feats: w.feats, club_id: M?.cid || null, club_assumed: !L?.club, aim: L?.aim || null, adjusted_aim: !!L?.adjusted });
      strip = null; editor = null; FEEL.play('tap'); await save(); return true;
    }
    if (act === 'ball') { if (!X.fix()) { marking = true; X.peek(); return true; } await closeAt(); return true; }
    if (act === 'mark' || act === 'markedit') { marking = true; markShot = act === 'markedit' ? editor.i : null; editor = null; X.peek(); X.remeasure(); return true; }
    if (act === 'markcancel') { marking = false; if (markShot !== null) editor = { i: markShot, mode: 'result' }; markShot = null; X.peek(); X.remeasure(); return true; }
    if (act === 'pen') { asking = true; editor = null; X.peek(); X.remeasure(); return true; }
    if (act === 'pencancel') { asking = false; X.peek(); X.remeasure(); return true; }
    if (act === 'setpen') { SH.penalty(h, v); asking = false; strip = null; await save(v === 'ob' ? 'map' : 'peek'); return true; }
    if (act === 'undo') { SH.undo(h); strip = null; editor = null; await save('map'); return true; }
    if (act === 'edit') { editor = { i: Number(v), mode: 'result' }; X.peek(); X.remeasure(); return true; }
    if (act === 'club') { editor = { i: Number(v), mode: 'club' }; X.peek(); X.remeasure(); return true; }
    if (act === 'setres') { const s = h.shots[editor.i]; s.result = v; if (v === 'green') delete h.putting; editor = null; strip = null; rederive(d); await save(); return true; }
    if (act === 'setclub') { const s = h.shots[editor.i]; s.club_id = v; s.club_assumed = false; editor = null; await save(); return true; }
    if (act === 'eddone') { editor = null; X.peek(); X.remeasure(); return true; }
    if (act === 'green') { h.putting = true; await save(); return true; }
    if (act === 'notgreen') { h.putting = false; putt = { n: null, k: null }; await save(); return true; }
    if (act === 'putts') { putt.n = Number(v); X.peek(); return true; }
    if (act === 'holeout') {
      if (putt.n === null) return true;
      const w = X.where(d);
      SH.holeOut(h, { putts: putt.n, first_putt_m: putt.k === null ? null : fpFt(putt.k) * SH.FT, par: h.par, line: w.ht.line, green: w.green });
      delete h.putting; putt = { n: null, k: null }; FEEL.play('hole');
      await X.save(); X.open('score'); X.peek(); X.remeasure(); return true;
    }
    if (act === 'next') { X.next(); return true; }
    if (act === 'score') { X.open('score'); return true; }
    // the shot list in the Score tab
    if (act === 'row') { open = open === Number(v) ? null : Number(v); X.refreshSheet(); return true; }
    if (act === 'lres') { const s = h.shots[open]; s.result = s.result === v ? null : v; rederive(d); await save('sheet'); return true; }
    if (act === 'lpen') { const s = h.shots[open]; s.penalty = v === 'none' ? null : v; if (v === 'water' && !s.end) s.result = 'water'; rederive(d); await save('sheet'); return true; }
    if (act === 'ldel') { SH.removeShot(h, open); open = null; rederive(d); await save('sheet'); return true; }
    if (act === 'add') { SH.addShot(h, {}); open = h.shots.length - (SH.openShot(h) ? 2 : 1); rederive(d); await save('sheet'); return true; }
    if (act === 'track') { d.track = v === '1'; reset(); await X.save(); X.refreshSheet(); X.peek(); X.remeasure(); return true; }
    return false;
  }
  // a finished hole is worked out again after a shot is edited; corrections the golfer made still win
  function rederive(d) {
    const h = holeOf(d); if (!h.done) return;
    const w = X.where(d); SH.applyDerived(h, SH.derive(h, { par: h.par, line: w.ht.line, green: w.green }));
  }
  async function change(el) {
    if (el.id === 'trFp') { putt.k = Number(el.value); el.classList.remove('unset'); const o = document.getElementById('trFpv'); if (o) o.textContent = fpText(putt.k); return true; }
    if (el.dataset.trclub !== undefined) { const d = X.D(), s = holeOf(d).shots[Number(el.dataset.trclub)]; if (s) { s.club_id = el.value || null; s.club_assumed = !el.value; await X.save(); X.dyn(); } return true; }
    return false;
  }
  async function mapTap(pt) {
    if (!marking) return false;
    marking = false;
    const d = X.D(), h = holeOf(d);
    const target = markShot !== null ? h.shots[markShot] : null; markShot = null;
    if (target && (target.end || target !== SH.openShot(h))) {           // re-mark where an earlier (or just closed) shot finished
      target.end = pt; target.marked = true; target.approx = !target.start; target.result = SH.resultAt(pt, X.where(d).feats);
      if (target.result === null) editor = { i: h.shots.indexOf(target), mode: 'result' }; else if (target === SH.lastShot(h)) showStrip();
      rederive(d); await save('map'); return true;
    }
    await closeAt(pt); return true;
  }

  // ---- the Score tab while tracking: the hole summary (after Hole out), then the shot list
  function summaryHtml(d) {
    const h = holeOf(d); if (!h.done) return '';
    const dv = h.derived || {}, chips = [];
    if (h.par >= 4 && h.fairway) chips.push([T.fw[h.fairway], h.fairway === 'HIT']);
    if (dv.gir !== null && dv.gir !== undefined) chips.push([T.gir[dv.gir], dv.gir === 1]);
    if (dv.up_down !== null && dv.up_down !== undefined) chips.push([T.ud[dv.up_down], dv.up_down === 1]);
    if (dv.sand_save !== null && dv.sand_save !== undefined) chips.push([T.sand[dv.sand_save], dv.sand_save === 1]);
    if (A.isNum(h.putts)) chips.push([T.puttsN(h.putts), null]);
    if (h.penalties) chips.push([T.pensN(h.penalties), false]);
    if (A.isNum(h.first_putt_m)) chips.push([T.firstPuttV(U() === 'yd' ? `${Math.round(h.first_putt_m / SH.FT)} ft` : `${h.first_putt_m.toFixed(1)} m`), null]);
    return `<div class="tr-sum" id="trSum"><div class="tr-sc"><b>${h.strokes}</b><span>${esc(SH.scoreName(h.strokes, h.par))}</span></div>
      <div class="tr-sumchips">${chips.map(([t, good]) => `<span class="tr-chip ${good === true ? 'good' : good === false ? 'miss' : ''}">${good === true ? '✓ ' : good === false ? '✗ ' : ''}${esc(t)}</span>`).join('')}</div>
      ${X.roundLine?.(d) || ''}<p class="small muted">${esc(T.correct)}</p></div>`;
  }
  function shotListHtml(d) {
    const h = holeOf(d), shots = h.shots || [], clubs = X.clubs();
    const rows = shots.map((s, i) => {
      const club = clubName(s.club_id), txt = `${club ? `${club}${s.club_assumed ? '?' : ''} · ` : ''}${describe(s) || (SH.openShot(h) === s ? '…' : T.whereFinished)}`;
      const ed = open !== i ? '' : `<div class="tr-led"><div class="tr-chips">${SH.RESULTS.map((r) => b('lres', T.results[r], s.result === r ? 'on' : 'sec', r)).join('')}</div>
        <label class="f">${esc(T.whichClub)}</label><select data-trclub="${i}"><option value="">–</option>${clubs.map((k) => `<option value="${esc(k.club_id)}"${k.club_id === s.club_id ? ' selected' : ''}>${esc(k.name)}</option>`).join('')}</select>
        <div class="tr-chips">${b('lpen', T.penaltyNone, s.penalty ? 'sec' : 'on', 'none')}${SH.PENALTIES.map((k) => b('lpen', T.pen[k], s.penalty === k ? 'on' : 'sec', k)).join('')}</div>
        ${row(b('ldel', T.del, 'sec tr-del'), b('row', T.done, '', i))}</div>`;
      return `<li class="${open === i ? 'open' : ''}">${b('row', '', 'sec tr-srow', i, ` aria-expanded="${open === i}"`).replace('></button>', `><b>${s.n}</b><span>${esc(txt)}</span></button>`)}${ed}</li>`;
    }).join('');
    return `<div class="cv-card tr-list"><h3>${esc(T.shots)}</h3>${shots.length ? `<ol>${rows}</ol>` : `<p class="small muted">${esc(T.noShots)}</p>`}${b('add', T.addShot)}</div>`;
  }
  function trackSwitch(d) {
    return `<div class="cv-card"><p class="small muted">${esc(on(d) ? T.roundOn : T.roundOff)}</p><div class="seg">${b('track', T.turnOn, on(d) ? 'on' : '', '1')}${b('track', T.turnOff, on(d) ? '' : 'on', '0')}</div></div>`.replace(/class="btn /g, 'class="');
  }
  const scoreTop = (d) => (on(d) ? summaryHtml(d) : '');
  const scoreBottom = (d) => (on(d) ? shotListHtml(d) : '') + trackSwitch(d);

  // ---- this hole's shots on the map: a line per shot, its number where it finished, a square for a drop
  function shotsSvg(fr, d) {
    if (!on(d)) return '';
    const h = holeOf(d), out = [];
    for (const s of h.shots || []) {
      if (s.start && s.end) { const [x1, y1] = fr.xy(...s.start), [x2, y2] = fr.xy(...s.end); out.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#0a3d2b" stroke-width="4.5" stroke-linecap="round"/><line class="tr-shot" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#fff" stroke-width="2" stroke-dasharray="${s.approx ? '3 4' : 'none'}" stroke-linecap="round"/>`); }
      if (s.end) { const [x, y] = fr.xy(...s.end); out.push(`<g class="tr-mark"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="12" fill="#0a3d2b" stroke="#fff" stroke-width="2"/><text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" text-anchor="middle" fill="#fff" style="font:700 15px var(--sans)">${s.n}</text></g>`); }
      if (s.drop) { const [x, y] = fr.xy(...s.drop); out.push(`<rect class="tr-drop" x="${(x - 7).toFixed(1)}" y="${(y - 7).toFixed(1)}" width="14" height="14" fill="#f2cf4a" stroke="#0a3d2b" stroke-width="2"/>`); }
    }
    return out.join('');
  }

  // putting or the hole finished: the map stops drawing a full-swing pattern
  const quiet = () => { const d = X.D(); if (!on(d)) return false; const st = SH.stateOf(holeOf(d), { onGreen: X.onGreen() }); return st === 'putting' || st === 'done'; };
  return { on, quiet, peek, click, change, mapTap, marking: () => marking, scoreTop, scoreBottom, shotsSvg, reset, _state: () => ({ strip, editor, asking, marking, putt, open }) };
}
