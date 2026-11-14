// Lock-screen yardage card: draws your current club distances (and wedge matrix) onto a phone-sized image
// that you save to Photos and set as your lock screen. The top ~40% is left clear for the clock.
export function phoneSize() {
  const dpr = Math.min(3, window.devicePixelRatio || 3);
  let w = Math.round((screen.width || 393) * dpr), h = Math.round((screen.height || 852) * dpr);
  if (w > h) [w, h] = [h, w];
  if (w < 900) { const k = 1179 / w; w = 1179; h = Math.round(h * k); }      // never smaller than an iPhone Pro screen
  return { w, h };
}

export const THEMES = {
  green: { top: '#0d5239', bottom: '#052117', stripe: 'rgba(255,255,255,.035)', card: 'rgba(4,28,19,.55)', line: '#c9a43a', ink: '#ffffff', sub: 'rgba(255,255,255,.62)', accent: '#f2cf4a' },
  night: { top: '#15181a', bottom: '#030404', stripe: 'rgba(255,255,255,.025)', card: 'rgba(255,255,255,.05)', line: '#c9a43a', ink: '#f5f2e8', sub: 'rgba(245,242,232,.55)', accent: '#e8c45a' },
  dawn: { top: '#33526a', bottom: '#d98c5f', stripe: 'rgba(255,255,255,.04)', card: 'rgba(16,26,38,.6)', line: '#f0c987', ink: '#ffffff', sub: 'rgba(255,255,255,.68)', accent: '#f6d98c' },
  tweed: { top: '#4a3f33', bottom: '#201a14', stripe: 'rgba(255,240,210,.07)', card: 'rgba(20,14,8,.55)', line: '#c9a43a', ink: '#f3ead8', sub: 'rgba(243,234,216,.6)', accent: '#e2c06a' },
  sunday: { top: '#7a1426', bottom: '#2a0710', stripe: 'rgba(255,255,255,.03)', card: 'rgba(20,3,8,.55)', line: '#d9b650', ink: '#ffffff', sub: 'rgba(255,255,255,.66)', accent: '#f2cf4a' },
  gold: { top: '#c9a43a', bottom: '#6e550f', stripe: 'rgba(255,255,255,.06)', card: 'rgba(36,26,3,.6)', line: '#fff0a8', ink: '#fff8de', sub: 'rgba(255,248,222,.72)', accent: '#fff0a8' },
  cream: { top: '#f6f1e2', bottom: '#e6dcc2', stripe: 'rgba(10,61,43,.04)', card: 'rgba(255,255,255,.55)', line: '#0a3d2b', ink: '#0a2a1e', sub: 'rgba(10,42,30,.6)', accent: '#0a3d2b' },
};
const SERIF = 'Didot, "Bodoni 72", Baskerville, Georgia, serif', SANS = '-apple-system, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif';

function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

// clubs: [{ name, dist, mine }], wedges: { lengths: [...], rows: [{ name, vals: { length: dist } }] }
export function draw(canvas, { w, h, clubs, wedges, unit, date, brand = 'BreakingPar', theme = 'green' }) {
  const T = THEMES[theme] || THEMES.green, s = w / 1179;
  canvas.width = w; canvas.height = h; const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, T.top); g.addColorStop(1, T.bottom); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(-0.42); ctx.fillStyle = T.stripe;             // mowing stripes
  for (let x = -h; x < h; x += 180 * s) ctx.fillRect(x, -h, 90 * s, 2 * h); ctx.restore();

  const wd = wedges?.rows?.length ? wedges : null;
  const x0 = 70 * s, cw = w - 140 * s, top = h * 0.40, bottom = h * 0.87;
  // fit: rows of clubs (two columns) + wedge grid
  const cols = 2, rows = Math.ceil(clubs.length / cols), wRows = wd ? wd.rows.length + 1 : 0;
  const head = 150 * s, foot = 125 * s, gap = wd ? 70 * s : 0;
  const rowH = Math.min(118 * s, (bottom - top - head - foot - gap) / Math.max(1, rows + wRows * 0.82));
  const cardH = head + rows * rowH + (wd ? gap + wRows * rowH * 0.82 : 0) + foot, y0 = Math.max(top, bottom - cardH - 10 * s);
  ctx.fillStyle = T.card; rr(ctx, x0, y0, cw, cardH, 46 * s); ctx.fill();
  ctx.strokeStyle = T.line; ctx.lineWidth = 3 * s; rr(ctx, x0, y0, cw, cardH, 46 * s); ctx.stroke();

  ctx.textBaseline = 'alphabetic'; ctx.fillStyle = T.accent; ctx.font = `700 ${34 * s}px ${SANS}`;
  ctx.textAlign = 'left'; ctx.fillText(`MY YARDAGES · ${unit === 'yd' ? 'YARDS' : 'METRES'}`.split('').join(' '), x0 + 56 * s, y0 + 86 * s);
  ctx.textAlign = 'right'; ctx.fillStyle = T.sub; ctx.font = `500 ${32 * s}px ${SANS}`; ctx.fillText(date, x0 + cw - 56 * s, y0 + 86 * s);
  ctx.strokeStyle = T.line; ctx.globalAlpha = 0.6; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.moveTo(x0 + 56 * s, y0 + 112 * s); ctx.lineTo(x0 + cw - 56 * s, y0 + 112 * s); ctx.stroke(); ctx.globalAlpha = 1;

  const colW = (cw - 112 * s) / cols, nameF = Math.min(42 * s, rowH * 0.40), numF = Math.min(68 * s, rowH * 0.62);
  clubs.forEach((cl, i) => {
    const col = Math.floor(i / rows), r = i % rows, cx = x0 + 56 * s + col * colW, cy = y0 + head + r * rowH + rowH * 0.66;
    ctx.textAlign = 'left'; ctx.fillStyle = T.sub; ctx.font = `600 ${nameF}px ${SANS}`; ctx.fillText(cl.name, cx, cy);
    ctx.textAlign = 'right'; ctx.fillStyle = T.ink; ctx.font = `700 ${numF}px ${SERIF}`; ctx.fillText(String(Math.round(cl.dist)), cx + colW - (col === 0 ? 36 * s : 0), cy);
    if (col === 0 && cols > 1) { ctx.strokeStyle = T.line; ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.moveTo(cx + colW - 12 * s, cy - numF * 0.8); ctx.lineTo(cx + colW - 12 * s, cy + rowH * 0.2); ctx.stroke(); ctx.globalAlpha = 1; }
  });
  if (wd) {
    let wy = y0 + head + rows * rowH + gap; const wh = rowH * 0.82, labW = 260 * s, cellW = (cw - 112 * s - labW) / wd.lengths.length;
    ctx.fillStyle = T.accent; ctx.font = `700 ${30 * s}px ${SANS}`; ctx.textAlign = 'left'; ctx.fillText('WEDGES'.split('').join(' '), x0 + 56 * s, wy + wh * 0.55);
    wd.lengths.forEach((l, j) => { ctx.textAlign = 'right'; ctx.fillStyle = T.sub; ctx.font = `600 ${30 * s}px ${SANS}`; ctx.fillText(l, x0 + 56 * s + labW + (j + 1) * cellW - 10 * s, wy + wh * 0.55); });
    for (const row of wd.rows) {
      wy += wh;
      ctx.textAlign = 'left'; ctx.fillStyle = T.sub; ctx.font = `600 ${Math.min(40 * s, wh * 0.45)}px ${SANS}`; ctx.fillText(row.name, x0 + 56 * s, wy + wh * 0.62);
      wd.lengths.forEach((l, j) => { const v = row.vals[l]; ctx.textAlign = 'right'; ctx.fillStyle = v ? T.ink : T.sub; ctx.font = `700 ${Math.min(58 * s, wh * 0.62)}px ${SERIF}`; ctx.fillText(v ? String(Math.round(v)) : '–', x0 + 56 * s + labW + (j + 1) * cellW - 10 * s, wy + wh * 0.66); });
    }
  }
  ctx.textAlign = 'left'; ctx.fillStyle = T.accent; ctx.font = `italic 700 ${44 * s}px ${SERIF}`; ctx.fillText(brand, x0 + 56 * s, y0 + cardH - 36 * s);
  ctx.textAlign = 'right'; ctx.fillStyle = T.sub; ctx.font = `500 ${28 * s}px ${SANS}`;
  ctx.fillText(clubs.some((x) => x.mine) ? 'total distance · ● = your number' : 'total distance (carry + roll)', x0 + cw - 56 * s, y0 + cardH - 40 * s);
  clubs.forEach((cl, i) => { if (!cl.mine) return; const col = Math.floor(i / rows), r = i % rows, cx = x0 + 56 * s + col * colW, cy = y0 + head + r * rowH + rowH * 0.66;
    ctx.fillStyle = T.accent; ctx.beginPath(); ctx.arc(cx + colW - (col === 0 ? 36 * s : 0) + 14 * s, cy - numF * 0.62, 6 * s, 0, 2 * Math.PI); ctx.fill(); });
  return canvas;
}

// Save: the iPhone share sheet has "Save Image"; elsewhere fall back to a download
export async function save(canvas, name = 'golf-yardages.png') {
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'My yardages' }); return 'shared'; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000); return 'downloaded';
}
