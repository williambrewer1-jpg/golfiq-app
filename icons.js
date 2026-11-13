// Line icons (24x24, stroke). Hand-drawn for GolfIQ; no external icon set.
const P = {
  home: '<path d="M3.5 11L12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5.5h4V20"/>',
  chart: '<path d="M4 19V5M4 19h16"/><path d="M8 15l3.5-4 3 2.5L19 8"/>',
  list: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
  score: '<path d="M9 4L7 20M17 4l-2 16M4.5 9h16M3.5 15h16"/>',
  crosshair: '<circle cx="12" cy="12" r="7"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
  tick: '<path d="M5 12.500l4.500 4.500L19 7"/>',
  cross: '<path d="M6 6l12 12M18 6L6 18"/>',
  flame: '<path d="M12 3c.5 3.200 4.500 5 4.500 9.500a4.500 4.500 0 01-9 0c0-1.700.8-3 1.800-4 .2 1.200.9 1.900 1.700 2.100C11 8.500 11.200 5.500 12 3z"/>',
  sound: '<path d="M4 9.5v5h3.5l4.500 4v-13l-4.500 4z"/><path d="M15.500 9.200a4 4 0 010 5.600"/><path d="M18 6.800a7.500 7.500 0 010 10.400"/>',
  soundoff: '<path d="M4 9.500v5h3.500l4.500 4v-13l-4.500 4z"/><path d="M16 9.500l5 5M21 9.500l-5 5"/>',
  putt: '<ellipse cx="12" cy="17" rx="7.5" ry="2.8"/><path d="M12 17V4l6 2.6-6 2.6"/>',
  club: '<path d="M16 3L9.5 16.5"/><path d="M9.5 16.5c-1.2 2.4-5 3.2-5.5 1.2-.4-1.6 2.6-2.4 5.500-1.200z"/><circle cx="17" cy="18" r="2"/>',
  map: '<path d="M9 5L4 7v12l5-2 6 2 5-2V5l-5 2z"/><path d="M9 5v12M15 7v12"/>',
  bars: '<path d="M5 20V10M10 20V4M15 20v-7M20 20V8"/>',
  check: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 12.5l3 3 5.5-6.5"/>',
  trend: '<path d="M3 17l5.5-6 4 3.500L20 7"/><path d="M15 7h5v5"/>',
  wind: '<path d="M3 9h10.5a2.500 2.500 0 1 0-2.500-2.500M3 13h15a2.500 2.500 0 1 1-2.500 2.500M3 17h7"/>',
  swap: '<path d="M4 8h14l-3.500-3.500M20 16H6l3.500 3.500"/>',
  flag: '<path d="M6 21V4"/><path d="M6 4.5l11 3.500-11 4.500"/><path d="M3.500 21h5"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5c0 3 1.500 4.500 3.500 4.800M16 6h3c0 3-1.500 4.500-3.500 4.800M12 13v4M8.500 20h7M10 17h4"/>',
  dumbbell: '<path d="M7 8v8M4 10v4M17 8v8M20 10v4M7 12h10"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.5-7.970 5.500 5.500 0 0 1 10.600-1.200A4.500 4.500 0 0 1 17 18z"/><path d="M12 11v5M9.800 13.800L12 16l2.200-2.200"/>',
  pencil: '<path d="M4 20l1-4.500L16 4.500a2 2 0 0 1 2.900 0l.6.6a2 2 0 0 1 0 2.900L8.500 19z"/><path d="M14 6.500l3.500 3.500"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  help: '<circle cx="12" cy="12" r="8.500"/><path d="M9.500 9.500a2.500 2.500 0 1 1 3.500 2.300c-.7.400-1 1-1 1.700"/><circle cx="12" cy="16.500" r=".6" fill="currentColor"/>',
  share: '<path d="M12 15V4M8 7.500L12 4l4 3.500"/><path d="M6 11v7a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-7"/>',
  spread: '<circle cx="8" cy="9" r="1.300" fill="currentColor"/><circle cx="13" cy="7" r="1.300" fill="currentColor"/><circle cx="15" cy="13" r="1.300" fill="currentColor"/><circle cx="10" cy="15" r="1.300" fill="currentColor"/><ellipse cx="12" cy="11.500" rx="8.500" ry="7.500"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
};
export const icon = (name, size = 22) => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.700" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.chart}</svg>`;

// Small shot illustrations for the game screen (240 x 84, drawn in the current text colour; gold for the flag and ball). Decoration only, so hidden from screen readers.
const ART = {
  putt: '<path d="M8 68Q120 58 232 68" opacity=".35"/><path d="M46 56C92 50 150 53 186 53" stroke-dasharray="4 5"/><circle cx="38" cy="57" r="5.500" style="fill:var(--flag);stroke:none"/><ellipse cx="196" cy="53" rx="9" ry="3.500" opacity=".55" style="fill:currentColor"/><path d="M196 53V12"/><path d="M196 12l22 8-22 8z" style="fill:var(--flag);stroke:none"/>',
  lag: '<path d="M8 70Q120 60 232 70" opacity=".35"/><path d="M40 58C100 52 160 55 168 55" stroke-dasharray="4 5"/><circle cx="32" cy="59" r="5.500" style="fill:var(--flag);stroke:none"/><ellipse cx="196" cy="55" rx="30" ry="10" stroke-dasharray="3 4" opacity=".7"/><ellipse cx="196" cy="55" rx="8" ry="3" opacity=".55" style="fill:currentColor"/><path d="M196 55V14"/><path d="M196 14l20 7-20 7z" style="fill:var(--flag);stroke:none"/>',
  chip: '<path d="M8 70Q120 62 232 70" opacity=".35"/><path d="M36 62Q98 -8 166 58"/><path d="M166 58L198 57" stroke-dasharray="3 4"/><circle cx="30" cy="64" r="5.500" style="fill:var(--flag);stroke:none"/><path d="M206 58V16"/><path d="M206 16l20 7-20 7z" style="fill:var(--flag);stroke:none"/>',
  zone: '<path d="M8 70Q120 62 232 70" opacity=".35"/><path d="M34 62Q92 -6 168 58"/><rect x="152" y="60" width="38" height="8" rx="2.500" style="fill:var(--flag);stroke:none" opacity=".9"/><circle cx="28" cy="64" r="5.500" style="fill:var(--flag);stroke:none"/>',
  target: '<ellipse cx="172" cy="56" rx="50" ry="16" opacity=".5"/><ellipse cx="172" cy="56" rx="28" ry="9" opacity=".7"/><path d="M42 68Q112 -8 166 52" stroke-dasharray="4 5"/><circle cx="36" cy="70" r="5.500" style="fill:var(--flag);stroke:none"/><path d="M172 56V14"/><path d="M172 14l20 7-20 7z" style="fill:var(--flag);stroke:none"/>',
  fairway: '<path d="M64 80L108 8M176 80L132 8"/><path d="M120 78V12" stroke-dasharray="3 6" opacity=".5"/><path d="M86 52l-1-12M154 52l1-12" style="stroke:var(--flag)" stroke-width="3"/><circle cx="120" cy="72" r="5.500" style="fill:var(--flag);stroke:none"/>',
  drive: '<path d="M60 80L100 8M180 80L140 8" opacity=".55"/><path d="M120 74Q128 40 122 10" stroke-dasharray="4 5"/><circle cx="120" cy="74" r="5.500" style="fill:var(--flag);stroke:none"/><path d="M104 16h32" opacity=".6"/>',
  long: '<path d="M8 68Q120 60 232 68" opacity=".35"/><path d="M34 62Q120 -22 214 60"/><circle cx="30" cy="64" r="5.500" style="fill:var(--flag);stroke:none"/><path d="M200 22l14 6-4 14" opacity=".8"/>',
};
export const shotArt = (kind) => `<svg class="gp-art-svg" viewBox="0 0 240 84" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ART[kind] || ART.putt}</svg>`;
export const ART_KINDS = Object.keys(ART);
