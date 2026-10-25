/* ============================================================
   jetparts.js — pixel jets assembled from earned parts.

   One silhouette, drawn facing UP. Each region takes the colour of
   whichever part fills that slot, so a jet visibly shows its loadout:
   gold wings mean legendary wings, and an empty slot is dull grey.

     F fuselage (tinted by ARMOR)   W wings
     E engine                       G guns
     M missiles                     C canopy
   ============================================================ */

const TIER_COLOR = {
  common:    '#7d879c',
  uncommon:  '#30a46c',
  rare:      '#3e8fff',
  epic:      '#8e4ec6',
  legendary: '#f5a524',
  faulty:    '#e5484d',
  empty:     '#3a4154',
};

const TIER_LABEL = {
  common: 'COMMON', uncommon: 'UNCOMMON', rare: 'RARE',
  epic: 'EPIC', legendary: 'LEGENDARY',
};

const SLOTS = ['engine', 'guns', 'missiles', 'wings', 'armor'];
const SLOT_LABEL = {
  engine: 'ENGINE', guns: 'GUNS', missiles: 'MISSILES',
  wings: 'WINGS', armor: 'ARMOR',
};

const JET_MAP = [
  '......F......',
  '......F......',
  '.....FFF.....',
  '.....FCF.....',
  '....FFCFF....',
  '..G.FFFFF.G..',
  '..GWWFFFWWG..',
  '..GWWWFWWWG..',
  '...WWMFMWW...',
  '....WMFMW....',
  '.....FFF.....',
  '....EFFFE....',
  '....EEEEE....',
  '.....EEE.....',
  '......E......',
];

const REGION_SLOT = { F: 'armor', W: 'wings', E: 'engine', G: 'guns', M: 'missiles' };

/** Colour for a region given a loadout ({slot: {tier,...}|null}). */
function regionColor(region, loadout) {
  if (region === 'C') return '#6fd3ff';
  const slot = REGION_SLOT[region];
  if (!slot) return null;
  const part = loadout && loadout[slot];
  if (!part) return TIER_COLOR.empty;
  return TIER_COLOR[part.tier] || TIER_COLOR.empty;
}

function shadeHex(hex, amt) {
  const h = hex.replace('#', '');
  const n = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  const out = n.map(v => amt < 0
    ? Math.round(v * (1 + amt))
    : Math.round(v + (255 - v) * amt));
  return '#' + out.map(v => Math.max(0, Math.min(255, v)).toString(16)
    .padStart(2, '0')).join('');
}

/** The jet as an inline SVG string, facing up. */
function jetSVG(loadout, size = 120, opts = {}) {
  const rows = JET_MAP.length, cols = JET_MAP[0].length;
  let cells = '';
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const ch = JET_MAP[y][x];
      if (ch === '.') continue;
      let col = regionColor(ch, loadout);
      if (!col) continue;
      // a touch of vertical shading so it doesn't read flat
      if (x < cols / 2 - 1) col = shadeHex(col, 0.12);
      else if (x > cols / 2 + 1) col = shadeHex(col, -0.16);
      cells += `<rect x="${x}" y="${y}" width="1" height="1" fill="${col}"/>`;
    }
  }
  const w = size, h = Math.round(size * rows / cols);
  const bg = opts.bg
    ? `<rect width="${cols}" height="${rows}" fill="${opts.bg}" rx="0.6"/>` : '';
  return `<svg viewBox="0 0 ${cols} ${rows}" width="${w}" height="${h}" ` +
         `shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">` +
         `${bg}${cells}</svg>`;
}

/* ---------------- small per-slot icons for the loadout list -------------- */

const PART_ICONS = {
  engine: [
    '..XXXX..',
    '.XXXXXX.',
    'XXXXXXXX',
    'XX.XX.XX',
    'XXXXXXXX',
    '.XXXXXX.',
    '..X..X..',
    '.X....X.',
  ],
  guns: [
    '...XX...',
    '...XX...',
    '...XX...',
    '..XXXX..',
    '.XXXXXX.',
    '.XX..XX.',
    '.XX..XX.',
    'XXX..XXX',
  ],
  missiles: [
    '...XX...',
    '..XXXX..',
    '..XXXX..',
    '..XXXX..',
    '..XXXX..',
    '.XXXXXX.',
    'XX.XX.XX',
    'X..XX..X',
  ],
  wings: [
    '...XX...',
    '...XX...',
    '..XXXX..',
    'XXXXXXXX',
    'XXXXXXXX',
    '.XXXXXX.',
    '...XX...',
    '...XX...',
  ],
  armor: [
    '.XXXXXX.',
    'XXXXXXXX',
    'XXXXXXXX',
    'XXXXXXXX',
    'XXXXXXXX',
    '.XXXXXX.',
    '..XXXX..',
    '...XX...',
  ],
};

function partIconSVG(slot, tier, size = 34) {
  const grid = PART_ICONS[slot] || PART_ICONS.armor;
  const col = TIER_COLOR[tier] || TIER_COLOR.empty;
  let cells = '';
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (grid[y][x] !== 'X') continue;
      const c = y < 3 ? shadeHex(col, 0.14) : (y > 5 ? shadeHex(col, -0.2) : col);
      cells += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`;
    }
  }
  return `<svg viewBox="0 0 8 8" width="${size}" height="${size}" ` +
         `shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${cells}</svg>`;
}

/* ---------------- canvas rendering for the arena ------------------------- */

/**
 * Pre-render a jet to an offscreen canvas once, so the arena can blit and
 * rotate it every frame instead of redrawing hundreds of rects per jet.
 */
function jetSprite(loadout, px = 3) {
  const rows = JET_MAP.length, cols = JET_MAP[0].length;
  const cv = document.createElement('canvas');
  cv.width = cols * px;
  cv.height = rows * px;
  const c = cv.getContext('2d');
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const ch = JET_MAP[y][x];
      if (ch === '.') continue;
      let col = regionColor(ch, loadout);
      if (!col) continue;
      if (x < cols / 2 - 1) col = shadeHex(col, 0.12);
      else if (x > cols / 2 + 1) col = shadeHex(col, -0.16);
      c.fillStyle = col;
      c.fillRect(x * px, y * px, px, px);
    }
  }
  return cv;
}

if (typeof module !== 'undefined') {
  module.exports = { JET_MAP, TIER_COLOR, jetSVG, partIconSVG, SLOTS };
}
