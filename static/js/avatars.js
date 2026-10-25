/* ============================================================
   avatars.js — 10 pixel-art animals, drawn as scalable SVG
   Each is an 8x8 grid of colour keys, so they render crisply at
   any size and cost almost nothing to ship.
   ============================================================ */

const AVATARS = [
  {
    id: 'fox', name: 'FOX', tint: '#f5862a',
    pal: { a: '#f5862a', b: '#ffffff', c: '#2a1a12', d: '#c75f14' },
    px: [
      '..a..a..',
      '.aaaaaa.',
      'aaaaaaaa',
      'acaaaaca',
      'aabbbbaa',
      '.abccba.',
      '..bbbb..',
      '..d..d..',
    ],
  },
  {
    id: 'bibble', name: 'BIBBLE', tint: '#8b77ff',
    pal: { a: '#79caff', b: '#e7fbff', c: '#26446e', d: '#3159b2', e: '#ff9dcb', f: '#9d73ff', g: '#c7a7ff' },
    px: [
      '..f..f..',
      '.fgffgf.',
      'aaaaaaaa',
      'ababbbba',
      'aacaaaca',
      'aaeeaaaa',
      '.daaaad.',
      '..d..d..',
    ],
  },
  {
    id: 'frog', name: 'FROG', tint: '#4caf50',
    pal: { a: '#4caf50', b: '#ffffff', c: '#17301a', d: '#357a38' },
    px: [
      '.bb..bb.',
      '.bcb.bcb',
      'aaaaaaaa',
      'aaaaaaaa',
      'aaaaaaaa',
      'adddddda',
      '.aaaaaa.',
      'd.a..a.d',
    ],
  },
  {
    id: 'bear', name: 'BEAR', tint: '#a1662f',
    pal: { a: '#a1662f', b: '#e8c39e', c: '#2b1a0d', d: '#7d4a1d' },
    px: [
      'aa....aa',
      'aba..aba',
      '.aaaaaa.',
      'acaaaaca',
      'aabbbbaa',
      'aabccbaa',
      '.abbbba.',
      '..d..d..',
    ],
  },
  {
    id: 'panda', name: 'PANDA', tint: '#e8e8ea',
    pal: { a: '#e8e8ea', b: '#1c1c22', c: '#ffffff', d: '#f2a7b8' },
    px: [
      'bb....bb',
      'baaaaaab',
      'aaaaaaaa',
      'abaaaaba',
      'abcaacba',
      'aaabbaaa',
      '.adbbda.',
      '..aaaa..',
    ],
  },
  {
    id: 'owl', name: 'OWL', tint: '#7a5c3e',
    pal: { a: '#7a5c3e', b: '#f4e4c1', c: '#1a1208', d: '#e0a52e' },
    px: [
      'a......a',
      'aaaaaaaa',
      'abbaabba',
      'abcaacba',
      'aaadaaaa',
      'abaaaaba',
      'abbaabba',
      '..dddd..',
    ],
  },
  {
    id: 'penguin', name: 'PENGUIN', tint: '#2f3640',
    pal: { a: '#2f3640', b: '#ffffff', c: '#11151a', d: '#f0a93b' },
    px: [
      '..aaaa..',
      '.aaaaaa.',
      'acbaabca',
      'aabddbaa',
      'abbbbbba',
      'abbbbbba',
      'aabbbbaa',
      '.d.aa.d.',
    ],
  },
  {
    id: 'bunny', name: 'BUNNY', tint: '#f0d6e8',
    pal: { a: '#f0d6e8', b: '#ffffff', c: '#33222c', d: '#e58fb5' },
    px: [
      '.a..a...',
      '.ad.ad..',
      '.a..a...',
      '.aaaaaa.',
      'acaaaaca',
      'aaaddaaa',
      'aabbbbaa',
      '..aaaa..',
    ],
  },
  {
    id: 'axolotl', name: 'AXOLOTL', tint: '#ff9ec4',
    pal: { a: '#ff9ec4', b: '#ffffff', c: '#3a1f2c', d: '#ff6fa5' },
    px: [
      'd..dd..d',
      '.daaaad.',
      'daaaaaad',
      'acaaaaca',
      'aaaaaaaa',
      'aadaadaa',
      '.aaccaa.',
      '..dddd..',
    ],
  },
  {
    id: 'shiba', name: 'SHIBA', tint: '#d9a441',
    pal: { a: '#d9a441', b: '#fff6e0', c: '#2a1c08', d: '#b07c22' },
    px: [
      'aa....aa',
      'aaa..aaa',
      'aaaaaaaa',
      'acaaaaca',
      'abbbbbba',
      'abbccbba',
      '.abbbba.',
      '..d..d..',
    ],
  },
];

const AVATAR_BY_ID = Object.fromEntries(AVATARS.map(a => [a.id, a]));

/** Render one avatar as an inline SVG string at the given pixel size. */
function avatarSVG(id, size = 64, opts = {}) {
  const av = AVATAR_BY_ID[id] || AVATARS[0];
  const n = av.px.length;
  const bg = opts.bg === false ? '' :
    `<rect width="${n}" height="${n}" rx="1.6" fill="${opts.bg || '#12151f'}"/>`;
  let cells = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < av.px[y].length; x++) {
      const k = av.px[y][x];
      if (k === '.') continue;
      const col = av.pal[k];
      if (!col) continue;
      cells += `<rect x="${x}" y="${y}" width="1" height="1" fill="${col}"/>`;
    }
  }
  return `<svg viewBox="0 0 ${n} ${n}" width="${size}" height="${size}" ` +
         `shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">` +
         `${bg}${cells}</svg>`;
}

function avatarTint(id) {
  return (AVATAR_BY_ID[id] || AVATARS[0]).tint;
}

function avatarName(id) {
  return (AVATAR_BY_ID[id] || AVATARS[0]).name;
}

if (typeof module !== 'undefined') module.exports = { AVATARS, avatarSVG };
