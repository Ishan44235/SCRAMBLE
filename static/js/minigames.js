/* ============================================================
   minigames.js — the three 5-second games

   RING RUN       steer THROUGH   put the nose through the gates
   MISSILE DODGE  steer AWAY      slip the volley
   LOCK-ON        steer ONTO      hold a jinking bogey in the reticle

   One control — tilt — and three different verbs on it, so nobody
   needs teaching. Every game resolves in about five seconds at every
   level: the ladder makes them harder, never longer.

   The same three run in two places. In ARCADE they are the whole
   round and the server pays a part for each clear. During a QUIZ
   round they are interruptions: a missile fired at you, or a ring run
   after three wrong. The server says which by sending arcade:true.
   ============================================================ */

/* eslint-disable no-undef */
const MG = {
  active: null,
  raf: null,
  t: 0,
  x: 0,            // nose position, -1 .. 1
  y: 0,
  done: false,
  cfg: null,
  arcade: false,
  token: null,
};

/* ---------------------------------------------------------------- palette */
const MG_PAL = {
  ok:      '#6ef0a8',
  okDim:   'rgba(110,240,168,.34)',
  bad:     '#ff6b70',
  warn:    '#f5a524',
  hot:     '#ffd48a',
  grid:    'rgba(62,143,255,.16)',
  gridFar: 'rgba(62,143,255,.07)',
  steel:   '#9aa6c0',
  steelHi: '#c3cde4',
  steelLo: '#5b6782',
  ink:     '#05070c',
};

function mgCanvas() { return document.getElementById('mgCanvas'); }

/* Snap to whole pixels. Everything in here is pixel art; half-pixel
   rectangles are what make canvas work look muddy next to the SVG. */
function snap(v) { return Math.round(v); }

/* ------------------------------------------------------------ lifecycle */

/**
 * Normalise the two message shapes the server can send.
 * Arcade sends the spec flat with a token; the quiz sends it nested.
 */
function mgConfig(m) {
  const spec = m.spec || m;
  return {
    kind: m.kind || spec.kind || 'rings',
    level: spec.level || 1,
    seconds: spec.seconds || 5,
    title: m.title || spec.title || null,
    hint: m.hint || spec.hint || null,
    from: m.from || null,
    // rings
    count: spec.count,
    spread: spec.spread,
    radius: spec.radius,
    needed: spec.needed,
    // dodge
    track: spec.track,
    blast: spec.blast,
    stagger: spec.stagger,
    pairs: spec.pairs,
    shield: spec.shield,
    // canyon
    gap: spec.gap,
    wiggle: spec.wiggle,
    amp: spec.amp,
    speed: spec.speed,
    // supply
    fall: spec.fall,
    bombs: spec.bombs,
    // lockon
    hold: spec.hold,
    jink: spec.jink,
    cone: spec.cone,
  };
}

function mgStart(kind, info) {
  const cfg = mgConfig(info || { kind: kind });
  cfg.kind = kind || cfg.kind;

  MG.active = cfg.kind;
  MG.cfg = cfg;
  MG.arcade = !!(info && info.arcade);
  MG.token = info && info.token != null ? info.token : null;
  MG.t = 0;
  MG.x = 0;
  MG.y = 0;
  MG.done = false;

  const titles = {
    rings: 'RING RUN',
    dodge: MG.arcade ? 'MISSILE DODGE' : 'INCOMING MISSILE',
    lockon: 'LOCK-ON',
    canyon: 'CANYON RUN',
    supply: 'SUPPLY DROP',
  };
  const hints = {
    rings: 'TILT TO FLY THROUGH THE GATES',
    dodge: MG.arcade ? 'TILT TO SLIP THE MISSILES'
                     : `${cfg.from || 'SOMEONE'} FIRED ON YOU — TILT TO EVADE`,
    lockon: 'TILT TO HOLD HIM IN THE RETICLE',
    canyon: 'TILT TO STAY OFF THE WALLS',
    supply: 'TILT TO CATCH CRATES — DODGE THE BOMBS',
  };
  const colors = { rings: 'var(--warn)', dodge: 'var(--danger)', lockon: 'var(--accent)',
                   canyon: '#d98a4a', supply: 'var(--good)' };

  const titleEl = document.getElementById('mgTitle');
  titleEl.textContent = cfg.title || titles[cfg.kind] || 'STAND BY';
  titleEl.style.color = colors[cfg.kind] || 'var(--warn)';
  document.getElementById('mgSub').textContent = cfg.hint || hints[cfg.kind] || '';
  document.getElementById('mgResult').innerHTML = '';

  mgSetLevelChip(MG.arcade ? cfg.level : null);
  mgPaintFlip();
  const sc = document.getElementById('mgScore');
  if (sc) sc.textContent = STATE.score || 0;

  show('s-minigame');
  haptic([40, 60, 40]);

  if (cfg.kind === 'dodge') mgDodge(cfg);
  else if (cfg.kind === 'lockon') mgLockOn(cfg);
  else if (cfg.kind === 'canyon') mgCanyon(cfg);
  else if (cfg.kind === 'supply') mgSupply(cfg);
  else mgRings(cfg);
}

/** The LEVEL n badge above the canvas. Arcade only — the quiz has no ladder. */
function mgSetLevelChip(level) {
  const el = document.getElementById('mgLevel');
  if (!el) return;
  if (level == null) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = `<span class="mgl-k">LEVEL</span><span class="mgl-v">${level}</span>`;
}

function mgFinish(success) {
  if (MG.done) return;
  MG.done = true;
  cancelAnimationFrame(MG.raf);
  MG.active = null;
  const msg = { t: 'minigame_result', success: success };
  if (MG.token != null) msg.token = MG.token;
  send(msg);
  haptic(success ? 40 : [30, 60, 30]);
}

/* Up/down feel is personal, so it is a per-phone switch (remembered on the
   phone). The default is the flight-stick feel: tilt the top of the phone
   away from you and the nose goes DOWN the screen, pull it toward you and it
   goes UP. Only RING RUN and LOCK-ON use up/down; the others are left/right. */
const MG_FLIP_KEY = 'mg_flip_y';
function mgFlipped() {
  try { return localStorage.getItem(MG_FLIP_KEY) === '1'; } catch (e) { return false; }
}
function mgPaintFlip() {
  const b = document.getElementById('mgFlip');
  if (!b) return;
  const uses = MG.cfg && (MG.cfg.kind === 'rings' || MG.cfg.kind === 'lockon');
  b.style.visibility = uses ? 'visible' : 'hidden';
  b.innerHTML = mgFlipped()
    ? '<span>⇅</span> TILT AWAY = <b>UP</b>'
    : '<span>⇅</span> TILT AWAY = <b>DOWN</b>';
}
(function wireFlip() {
  const b = document.getElementById('mgFlip');
  if (!b) return;
  b.addEventListener('click', e => {
    e.preventDefault();
    try { localStorage.setItem(MG_FLIP_KEY, mgFlipped() ? '0' : '1'); } catch (err) {}
    mgPaintFlip();
    haptic(15);
  });
})();

/** Read the stick. Returns -1..1 on both axes. */
function mgStick() {
  if (!motion.live) return { x: 0, y: 0 };
  let x = motion.tiltRel / 26;
  // beta falls as the top of the phone tips away from you, so pitchRel is
  // negative "away"; negate it so away = positive = down the screen.
  let y = -motion.pitchRel / 26;
  if (mgFlipped()) y = -y;
  if (STATE.inverted) { x = -x; y = -y; }
  return {
    x: Math.max(-1, Math.min(1, x)),
    y: Math.max(-1, Math.min(1, y)),
  };
}

function mgSetup() {
  const cv = mgCanvas();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.imageSmoothingEnabled = false;
  return { c, w, h };
}

/* ------------------------------------------------------------ pixel art */

/* 11x9 fighter, nose up. Shaded in three bands so it reads as a solid
   object rather than a silhouette, matching jetparts.js. */
const MG_JET = [
  '.....X.....',
  '.....X.....',
  '....XKX....',
  '....XKX....',
  'XXXXXXXXXXX',
  '.XXXXXXXXX.',
  '...XXXXX...',
  '..XX.X.XX..',
  '..X..X..X..',
];

function mgShade(hex, amt) {
  const h = hex.replace('#', '');
  const n = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  const out = n.map(v => amt < 0
    ? Math.round(v * (1 + amt))
    : Math.round(v + (255 - v) * amt));
  return '#' + out.map(v => Math.max(0, Math.min(255, v))
    .toString(16).padStart(2, '0')).join('');
}

/** Your jet, with a flickering burner. px is the size of one art pixel. */
function mgJet(c, x, y, px, tint) {
  const rows = MG_JET.length, cols = MG_JET[0].length;
  const ox = x - (cols / 2) * px;
  const oy = y - (rows / 2) * px;

  // burner first, so the jet sits on top of it
  const flame = Math.random() < 0.5 ? MG_PAL.warn : '#ff7a3d';
  const fl = px * (1 + Math.random() * 2.2);
  c.fillStyle = flame;
  c.fillRect(snap(x - px * 1.5), snap(oy + rows * px - px), snap(px * 3), snap(fl));
  c.fillStyle = MG_PAL.hot;
  c.fillRect(snap(x - px * 0.5), snap(oy + rows * px - px), snap(px), snap(fl * 0.6));

  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const ch = MG_JET[r][k];
      if (ch === '.') continue;
      let col;
      if (ch === 'K') col = '#6fd3ff';
      else if (r < 4) col = mgShade(tint, 0.2);
      else if (r > 6) col = mgShade(tint, -0.26);
      else col = tint;
      c.fillStyle = col;
      c.fillRect(snap(ox + k * px), snap(oy + r * px), snap(px), snap(px));
    }
  }
}

/** The cockpit backdrop every game shares: horizon rushing toward you. */
function mgBackdrop(c, w, h, t, speed) {
  c.fillStyle = MG_PAL.ink;
  c.fillRect(0, 0, w, h);

  const cx = w / 2, cy = h / 2;
  c.strokeStyle = MG_PAL.grid;
  c.lineWidth = 1;
  for (let i = 0; i < 11; i++) {
    const z = 1 - ((t * (speed || 0.55) + i / 11) % 1);
    const s = 1 / (z * 4 + 0.22);
    const yy = snap(cy + h * 0.42 * s) + 0.5;
    if (yy < -h || yy > h * 2) continue;
    c.beginPath();
    c.moveTo(0, yy);
    c.lineTo(w, yy);
    c.stroke();
  }

  // two converging rails give the frame some depth without costing much
  c.strokeStyle = MG_PAL.gridFar;
  c.beginPath();
  c.moveTo(snap(cx - w) + 0.5, h);
  c.lineTo(snap(cx) + 0.5, snap(cy - h * 0.1));
  c.moveTo(snap(cx + w) + 0.5, h);
  c.lineTo(snap(cx) + 0.5, snap(cy - h * 0.1));
  c.stroke();
}

/** Progress pips along the top: filled green cleared, red missed. */
function mgPips(c, done, total, offsetY) {
  const y = offsetY === undefined ? 12 : offsetY;
  for (let i = 0; i < total; i++) {
    const state = done[i];
    c.fillStyle = state === undefined ? 'rgba(255,255,255,.14)'
      : (state ? MG_PAL.ok : MG_PAL.bad);
    c.fillRect(snap(13 + i * 19), snap(y), 14, 6);
  }
}

/** The countdown strip across the very top of the canvas. */
function mgClock(c, w, frac, danger) {
  c.fillStyle = 'rgba(255,255,255,.08)';
  c.fillRect(0, 0, w, 5);
  c.fillStyle = danger ? MG_PAL.bad : MG_PAL.warn;
  c.fillRect(0, 0, snap(w * Math.max(0, frac)), 5);
}

function mgFlash(c, w, h, bad, text) {
  c.fillStyle = bad ? 'rgba(229,72,77,.42)' : 'rgba(48,163,108,.34)';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#fff';
  c.font = '800 26px Inter, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text || (bad ? 'HIT' : 'CLEAR'), w / 2, h / 2);
}

/* ================================================================= RINGS
   Gates arrive out of the distance. Put the nose inside each one as it
   reaches the cockpit. Higher levels mean more gates in the same five
   seconds, thrown further off centre, through a smaller hoop.
   ================================================================= */
function mgRings(cfg) {
  const count = cfg.count || 4;
  const spread = cfg.spread || 0.55;
  const radiusScale = cfg.radius || 1;
  const needed = cfg.needed || Math.ceil(count / 2);
  const total = cfg.seconds || 5;

  // Spill the gates evenly across the window, leaving a beat at each end
  // so the first one never lands before the player has looked up.
  const first = 1.0;
  const gap = Math.max(0.5, (total - first - 0.35) / Math.max(1, count - 1));

  const rings = [];
  let prev = 0;
  for (let i = 0; i < count; i++) {
    // Alternate sides so the run is a slalom rather than a drift.
    const side = i === 0 ? (Math.random() < 0.5 ? -1 : 1) : -Math.sign(prev || 1);
    const x = side * (0.3 + Math.random() * 0.7) * spread;
    prev = x;
    rings.push({
      at: first + i * gap,
      x: x,
      y: (Math.random() * 2 - 1) * spread * 0.7,
      done: false, passed: false,
    });
  }

  let cleared = 0;
  let last = performance.now();

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    MG.t += dt;

    const { c, w, h } = mgSetup();
    const stick = mgStick();
    MG.x += (stick.x - MG.x) * Math.min(1, dt * 7);
    MG.y += (stick.y - MG.y) * Math.min(1, dt * 7);

    mgBackdrop(c, w, h, MG.t, 0.7);
    const cx = w / 2, cy = h / 2;

    // nose position
    const px = cx + MG.x * w * 0.40;
    const py = cy + MG.y * h * 0.32;

    // Draw far gates first so near ones overlap them correctly.
    const order = rings.slice().sort((a, b) => (b.at - MG.t) - (a.at - MG.t));
    for (let i = 0; i < order.length; i++) {
      const ring = order[i];
      const dtr = ring.at - MG.t;
      if (dtr > 2.4 || (ring.done && dtr < -0.35)) continue;

      const z = Math.max(0.04, dtr / 2.4);
      const s = 1 / (z * 3.4 + 0.18);
      const rx = cx + ring.x * w * 0.40 * s;
      const ry = cy + ring.y * h * 0.32 * s;
      const rad = 26 * s * radiusScale;

      const near = dtr < 0.3;
      let col = MG_PAL.okDim;
      if (ring.done) col = ring.passed ? MG_PAL.ok : MG_PAL.bad;
      else if (near) col = MG_PAL.warn;

      // Octagonal gate, drawn as segments — a pixel-art hoop rather than
      // a smooth circle, so it sits with the rest of the art.
      c.strokeStyle = col;
      c.lineWidth = Math.max(2, Math.round(4 * s * 0.55));
      c.beginPath();
      for (let k = 0; k <= 8; k++) {
        const a = (Math.PI * 2 / 8) * k - Math.PI / 8;
        const gx = snap(rx + Math.cos(a) * rad);
        const gy = snap(ry + Math.sin(a) * rad);
        if (k === 0) c.moveTo(gx, gy); else c.lineTo(gx, gy);
      }
      c.closePath();
      c.stroke();

      // four corner studs, so the gate reads as built rather than drawn
      if (s > 0.5) {
        c.fillStyle = col;
        const d = rad * 0.72;
        c.fillRect(snap(rx - d - 2), snap(ry - 2), 4, 4);
        c.fillRect(snap(rx + d - 2), snap(ry - 2), 4, 4);
        c.fillRect(snap(rx - 2), snap(ry - d - 2), 4, 4);
        c.fillRect(snap(rx - 2), snap(ry + d - 2), 4, 4);
      }

      // scored the moment it reaches the cockpit
      if (dtr <= 0 && !ring.done) {
        ring.done = true;
        ring.passed = Math.hypot(px - rx, py - ry) < rad + 10;
        if (ring.passed) { cleared++; haptic(18); }
        else haptic([15, 25, 15]);
      }
    }

    // your jet, flying the course
    mgJet(c, px, py + 10, Math.max(2, Math.round(Math.min(w, h) / 52)),
          MG_PAL.steelHi);

    // crosshair sits on the nose so aiming is unambiguous
    c.strokeStyle = MG_PAL.ok;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(snap(px - 14), snap(py)); c.lineTo(snap(px - 5), snap(py));
    c.moveTo(snap(px + 5), snap(py)); c.lineTo(snap(px + 14), snap(py));
    c.moveTo(snap(px), snap(py - 14)); c.lineTo(snap(px), snap(py - 5));
    c.moveTo(snap(px), snap(py + 5)); c.lineTo(snap(px), snap(py + 14));
    c.stroke();

    const states = rings.map(r => r.done ? r.passed : undefined);
    mgPips(c, states, count);
    mgClock(c, w, 1 - MG.t / total, cleared < needed && MG.t > total * 0.6);

    // the bar you have to clear, written where it cannot be missed
    c.fillStyle = cleared >= needed ? MG_PAL.ok : 'rgba(255,255,255,.5)';
    c.font = '800 11px Inter, sans-serif';
    c.textAlign = 'right';
    c.textBaseline = 'top';
    c.fillText(`${cleared} / ${needed}`, w - 13, 11);

    if (rings.every(r => r.done) || MG.t >= total) {
      const success = cleared >= needed;
      mgFlash(c, w, h, !success, success ? 'CLEAR' : 'MISSED');
      setTimeout(() => mgFinish(success), 620);
      return;
    }
    MG.raf = requestAnimationFrame(frame);
  }
  MG.raf = requestAnimationFrame(frame);
}

/* ================================================================= DODGE
   A barrage. Rockets come down on you in a stream, some in pairs, each
   leading your position. Slip them. A shield soaks the first hit, so a
   dense volley rewards staying calm instead of punishing one twitch.
   Higher levels: more rockets, closer together, tracking harder.
   ================================================================= */
function mgDodge(cfg) {
  const count = cfg.count || 4;
  const track = cfg.track || 0.45;
  const blast = cfg.blast || 30;
  const stagger = cfg.stagger || 0.8;
  const pairs = cfg.pairs || 0;
  const shield = cfg.shield === undefined ? 1 : cfg.shield;
  const total = cfg.seconds || 5;

  // Lay out the launches: one rocket per slot, sometimes two side by side.
  const missiles = [];
  let slot = 0;
  while (missiles.length < count) {
    const at = 0.25 + slot * stagger;
    const pair = missiles.length < count - 1 && Math.random() < pairs;
    if (pair) {
      // a pair brackets you: one each side, so the gap is the only way out
      const gap = 0.35 + Math.random() * 0.25;
      const mid = (Math.random() * 2 - 1) * 0.4;
      missiles.push({ launch: at, x: mid - gap, done: false, hit: false, live: false });
      missiles.push({ launch: at, x: mid + gap, done: false, hit: false, live: false });
    } else {
      // every other single is aimed at where you are now
      const aimed = slot % 2 === 1;
      missiles.push({ launch: at, x: aimed ? null : (Math.random() * 2 - 1) * 0.85,
                      done: false, hit: false, live: false });
    }
    slot++;
  }
  const lastLaunch = missiles[missiles.length - 1].launch;
  const flight = Math.max(1.1, Math.min(2.0, total - lastLaunch - 0.4));

  let hits = 0;
  let shieldFlash = 0;
  let last = performance.now();

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    MG.t += dt;

    const { c, w, h } = mgSetup();
    const stick = mgStick();
    MG.x += (stick.x - MG.x) * Math.min(1, dt * 9);

    mgBackdrop(c, w, h, MG.t, 1.2);

    const px = Math.max(2, Math.round(Math.min(w, h) / 52));
    const jx = w / 2 + MG.x * (w / 2 - 30);
    const jy = h - 56;

    let closest = 1;
    for (let i = 0; i < missiles.length; i++) {
      const m = missiles[i];
      const age = MG.t - m.launch;
      if (age < 0 || m.done) continue;
      if (!m.live) {
        m.live = true;
        if (m.x === null) m.x = MG.x;
        haptic(8);
      }

      const prog = Math.min(1, age / flight);
      closest = Math.min(closest, 1 - prog);
      // Track hardest early, then commit: a late sidestep always works.
      m.x += (MG.x - m.x) * track * dt * (prog < 0.7 ? 1 : 0.15);

      const mx = w / 2 + m.x * (w / 2 - 30);
      const my = -30 + prog * (jy + 30);

      for (let k = 1; k < 6; k++) {
        c.fillStyle = `rgba(245,165,36,${(0.32 - k * 0.05).toFixed(2)})`;
        c.fillRect(snap(mx - 2), snap(my - 10 - k * 8), 4, 5);
      }
      c.fillStyle = MG_PAL.bad;
      c.fillRect(snap(mx - 3), snap(my - 9), 6, 16);
      c.fillStyle = mgShade(MG_PAL.bad, 0.35);
      c.fillRect(snap(mx - 2), snap(my - 12), 4, 4);
      c.fillStyle = MG_PAL.steelLo;
      c.fillRect(snap(mx - 6), snap(my + 2), 3, 6);
      c.fillRect(snap(mx + 3), snap(my + 2), 3, 6);
      c.fillStyle = MG_PAL.hot;
      c.fillRect(snap(mx - 2), snap(my + 7), 4, snap(3 + Math.random() * 6));

      // ground marker where it will land, so the threat is readable early
      if (prog > 0.35) {
        c.fillStyle = `rgba(229,72,77,${(0.12 + prog * 0.3).toFixed(2)})`;
        c.fillRect(snap(mx - blast), snap(jy + 22), snap(blast * 2), 3);
      }

      if (prog >= 1) {
        m.done = true;
        m.hit = Math.abs(mx - jx) < blast;
        if (m.hit) {
          hits++;
          shieldFlash = 0.35;
          haptic(hits > shield ? [30, 50, 30] : [15, 20, 15]);
        } else haptic(10);
      }
    }

    // shield bubble while it holds
    if (hits < shield + 1 && shield > 0 && hits < shield) {
      c.strokeStyle = 'rgba(110,200,255,.55)';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(snap(jx), snap(jy + 4), px * 8, Math.PI, 0);
      c.stroke();
    }
    if (shieldFlash > 0) {
      shieldFlash -= dt;
      c.fillStyle = `rgba(110,200,255,${(shieldFlash).toFixed(2)})`;
      c.fillRect(0, 0, w, h);
    }

    mgJet(c, jx, jy, px, hits > shield ? MG_PAL.bad : (hits ? MG_PAL.warn : MG_PAL.ok));

    // remaining-rocket counter + shield pips
    const left = missiles.filter(m => !m.done).length;
    c.fillStyle = 'rgba(255,255,255,.6)';
    c.font = '800 11px Inter, sans-serif';
    c.textAlign = 'right';
    c.textBaseline = 'top';
    c.fillText(`${left} INBOUND`, w - 13, 11);
    c.textAlign = 'left';
    c.fillStyle = hits < shield ? '#6ec8ff' : 'rgba(255,255,255,.25)';
    c.fillText(hits < shield ? 'SHIELD UP' : 'SHIELD DOWN', 13, 11);

    mgClock(c, w, 1 - MG.t / total, closest < 0.25);

    if (missiles.every(m => m.done) || MG.t >= total) {
      const success = hits <= shield;
      mgFlash(c, w, h, !success, success ? (hits ? 'SURVIVED' : 'CLEAN') : 'HIT');
      setTimeout(() => mgFinish(success), 620);
      return;
    }
    MG.raf = requestAnimationFrame(frame);
  }
  MG.raf = requestAnimationFrame(frame);
}

/* ============================================================= CANYON RUN
   Top-down: a winding canyon scrolls toward you. Stay between the walls
   for five seconds. One scrape is forgiven (the hull flashes); a second
   is a crash. Higher levels: narrower, twistier, faster.
   ================================================================= */
function mgCanyon(cfg) {
  const total = cfg.seconds || 5;
  const gapFrac = cfg.gap || 0.5;
  const wiggle = cfg.wiggle || 0.8;
  const ampFrac = cfg.amp || 0.22;
  const speed = cfg.speed || 1.1;
  const seed = Math.random() * 100;

  let scrapes = 0;
  let scrapeCool = 0;
  let flash = 0;
  let last = performance.now();

  /* Centre of the canyon (-1..1) at a given distance along it. Two sines
     give bends that feel natural but are always flyable. The first stretch
     is straight, so nobody crashes before they have seen the screen. */
  function centreAt(d) {
    const ease = Math.min(1, Math.max(0, (d - 0.6) / 0.8));
    return ease * ampFrac * 2 * (Math.sin(d * wiggle * 2.1 + seed) * 0.7 +
                                 Math.sin(d * wiggle * 3.7 + seed * 1.7) * 0.3);
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    MG.t += dt;

    const { c, w, h } = mgSetup();
    const stick = mgStick();
    MG.x += (stick.x - MG.x) * Math.min(1, dt * 8);

    // desert floor
    c.fillStyle = '#2b1a12';
    c.fillRect(0, 0, w, h);

    const row = 6;                       // pixel row height
    const travel = MG.t * speed;         // canyon distance travelled
    const span = 1.6;                    // canyon distance visible on screen
    const gapPx = w * gapFrac;
    const jy = h - 60;

    for (let y = 0; y < h; y += row) {
      const d = travel + ((h - y) / h) * span;
      const cx = w / 2 + centreAt(d) * (w / 2 - gapPx / 2);
      const L = cx - gapPx / 2, R = cx + gapPx / 2;
      // the floor of the canyon, banded so speed reads
      const band = Math.floor(d * 14) % 2;
      c.fillStyle = band ? '#3a2a20' : '#33241b';
      c.fillRect(snap(L), y, snap(R - L), row);
      // rock walls, with a lit lip on the inside edge
      c.fillStyle = band ? '#8a5530' : '#7a4a28';
      c.fillRect(0, y, snap(L), row);
      c.fillRect(snap(R), y, w - snap(R), row);
      c.fillStyle = '#d98a4a';
      c.fillRect(snap(L) - 4, y, 4, row);
      c.fillRect(snap(R), y, 4, row);
    }

    // where your jet is, and where the walls are at that height
    const dj = travel + ((h - jy) / h) * span;
    const cj = w / 2 + centreAt(dj) * (w / 2 - gapPx / 2);
    const jx = w / 2 + MG.x * (w / 2 - 24);
    const px = Math.max(2, Math.round(Math.min(w, h) / 58));
    const half = px * 5;                 // jet half-width, a touch forgiving
    const hitWall = jx - half < cj - gapPx / 2 || jx + half > cj + gapPx / 2;

    scrapeCool = Math.max(0, scrapeCool - dt);
    if (hitWall && scrapeCool === 0) {
      scrapes++;
      scrapeCool = 0.6;                  // one scrape per brush, not per frame
      flash = 0.3;
      haptic(scrapes > 1 ? [30, 50, 30] : [15, 20, 15]);
    }
    if (flash > 0) {
      flash -= dt;
      c.fillStyle = `rgba(229,72,77,${(flash).toFixed(2)})`;
      c.fillRect(0, 0, w, h);
    }

    mgJet(c, jx, jy, px, scrapes ? MG_PAL.warn : MG_PAL.steelHi);

    c.fillStyle = scrapes ? MG_PAL.warn : 'rgba(255,255,255,.6)';
    c.font = '800 11px Inter, sans-serif';
    c.textAlign = 'left';
    c.textBaseline = 'top';
    c.fillText(scrapes ? 'HULL SCRAPED' : 'HULL OK', 13, 11);
    mgClock(c, w, 1 - MG.t / total, scrapes > 0);

    if (scrapes > 1) {
      mgFlash(c, w, h, true, 'CRASHED');
      setTimeout(() => mgFinish(false), 620);
      return;
    }
    if (MG.t >= total) {
      mgFlash(c, w, h, false, 'THROUGH');
      setTimeout(() => mgFinish(true), 620);
      return;
    }
    MG.raf = requestAnimationFrame(frame);
  }
  MG.raf = requestAnimationFrame(frame);
}

/* ============================================================ SUPPLY DROP
   Crates parachute down; slide under them to catch. Catch enough to clear.
   From mid levels, bombs fall too — catching one costs you a crate.
   Higher levels: more needed, faster falls, more bombs.
   ================================================================= */
function mgSupply(cfg) {
  const total = cfg.seconds || 5;
  const count = cfg.count || 5;
  const needed = cfg.needed || 3;
  const fall = cfg.fall || 1.3;
  const bombs = cfg.bombs || 0;

  // Spread the drops across the window, alternating sides so you move.
  const drops = [];
  const n = count + bombs;
  const window_ = Math.max(1, total - fall - 0.4);
  let side = Math.random() < 0.5 ? -1 : 1;
  for (let i = 0; i < n; i++) {
    side = -side;
    drops.push({
      at: 0.3 + (window_ * i) / Math.max(1, n - 1),
      x: side * (0.15 + Math.random() * 0.7),
      bomb: false, done: false, got: false,
    });
  }
  // Bombs take random slots, but never the first two, so the opening is fair.
  const slots = drops.map((_, i) => i).slice(2).sort(() => Math.random() - 0.5);
  for (let i = 0; i < Math.min(bombs, slots.length); i++) drops[slots[i]].bomb = true;

  let caught = 0;
  let flash = 0, flashCol = '';
  let last = performance.now();

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    MG.t += dt;

    const { c, w, h } = mgSetup();
    const stick = mgStick();
    MG.x += (stick.x - MG.x) * Math.min(1, dt * 9);

    mgBackdrop(c, w, h, MG.t, 0.35);

    const px = Math.max(2, Math.round(Math.min(w, h) / 52));
    const jx = w / 2 + MG.x * (w / 2 - 28);
    const jy = h - 56;
    const reach = px * 6 + 6;            // catch width either side of the nose

    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      const age = MG.t - d.at;
      if (age < 0 || d.done) continue;
      const prog = Math.min(1, age / fall);
      const x = w / 2 + d.x * (w / 2 - 28);
      const y = -20 + prog * (jy + 20);

      // Drawn from small pixel grids at the game's pixel size, so they scale
      // with the screen and read clearly at a glance.
      const u = Math.max(2, Math.round(px * 0.9));
      if (d.bomb) {
        // bomb: bright red casing with a white skull band, fins, blinking fuse
        const BOMB = ['.FF.FF.', '..FFF..', '.RRRRR.', 'RRRRRRR', 'RWRWRWR',
                      'RRRRRRR', 'RRRRRRR', '.RRRRR.', '..RRR..'];
        const blink = Math.floor(MG.t * 8) % 2;
        for (let r = 0; r < BOMB.length; r++)
          for (let k = 0; k < BOMB[r].length; k++) {
            const ch = BOMB[r][k];
            if (ch === '.') continue;
            c.fillStyle = ch === 'F' ? '#8d97ad' : ch === 'W' ? '#fff' : (k < 3 ? '#ff6b70' : '#d93a40');
            c.fillRect(snap(x + (k - 3.5) * u), snap(y + (r - 4.5) * u), u, u);
          }
        c.fillStyle = blink ? '#ffd48a' : '#ff6b70';
        c.fillRect(snap(x - u / 2), snap(y + 4.5 * u), u, u);
      } else {
        // crate under a pixel parachute
        const CRATE = ['..CCCCC..', '.CCCCCCC.', 'CC.....CC', '.L.....L.', '..L...L..',
                       '..BBBBB..', '..bBbBb..', '..BBBBB..', '..bBbBb..', '..BBBBB..'];
        for (let r = 0; r < CRATE.length; r++)
          for (let k = 0; k < CRATE[r].length; k++) {
            const ch = CRATE[r][k];
            if (ch === '.') continue;
            c.fillStyle = ch === 'C' ? (r === 0 ? '#ffffff' : '#e3e7ef')
              : ch === 'L' ? 'rgba(227,231,239,.6)'
              : ch === 'B' ? '#d9a441' : '#9c6a1a';
            c.fillRect(snap(x + (k - 4.5) * u), snap(y + (r - 7) * u), u, u);
          }
      }

      if (prog >= 1) {
        d.done = true;
        const hit = Math.abs(x - jx) < reach;
        if (hit && d.bomb) {
          caught = Math.max(0, caught - 1);
          flash = 0.35; flashCol = '229,72,77';
          haptic([30, 50, 30]);
        } else if (hit) {
          caught++; d.got = true;
          flash = 0.2; flashCol = '48,163,108';
          haptic(18);
        }
      }
    }

    if (flash > 0) {
      flash -= dt;
      c.fillStyle = `rgba(${flashCol},${(flash).toFixed(2)})`;
      c.fillRect(0, 0, w, h);
    }

    // catch zone under the jet, so players can see what counts
    c.fillStyle = 'rgba(110,240,168,.18)';
    c.fillRect(snap(jx - reach), snap(jy + 22), snap(reach * 2), 3);
    mgJet(c, jx, jy, px, MG_PAL.ok);

    c.fillStyle = caught >= needed ? MG_PAL.ok : 'rgba(255,255,255,.6)';
    c.font = '800 11px Inter, sans-serif';
    c.textAlign = 'right';
    c.textBaseline = 'top';
    c.fillText(`${caught} / ${needed}`, w - 13, 11);
    if (bombs) {
      c.textAlign = 'left';
      c.fillStyle = '#ff9ea1';
      c.fillText(`${bombs} BOMB${bombs === 1 ? '' : 'S'}`, 13, 11);
    }
    mgClock(c, w, 1 - MG.t / total, caught < needed && MG.t > total * 0.6);

    if (drops.every(d => d.done) || MG.t >= total) {
      const success = caught >= needed;
      mgFlash(c, w, h, !success, success ? 'RESUPPLIED' : 'SHORT');
      setTimeout(() => mgFinish(success), 620);
      return;
    }
    MG.raf = requestAnimationFrame(frame);
  }
  MG.raf = requestAnimationFrame(frame);
}

/* ================================================================ LOCK-ON
   A bogey jinks across the sky. Keep him inside the reticle long enough
   to get tone. Higher levels mean he jinks harder and the reticle shrinks,
   but the hold itself never grows past about half the game.
   ================================================================ */
function mgLockOn(cfg) {
  const hold = cfg.hold || 1.2;
  const jink = cfg.jink || 0.8;
  const coneScale = cfg.cone || 1;
  const total = cfg.seconds || 5;

  // Two out-of-phase sine waves make a path that looks evasive but is
  // always followable — random walks here feel like the game cheating.
  const seed = Math.random() * Math.PI * 2;
  const bogey = { x: 0, y: 0 };
  let locked = 0;
  let last = performance.now();

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    MG.t += dt;

    const { c, w, h } = mgSetup();
    const stick = mgStick();
    MG.x += (stick.x - MG.x) * Math.min(1, dt * 6);
    MG.y += (stick.y - MG.y) * Math.min(1, dt * 6);

    mgBackdrop(c, w, h, MG.t, 0.45);
    const cx = w / 2, cy = h / 2;

    const tt = MG.t * jink;
    bogey.x = Math.sin(tt * 1.7 + seed) * 0.62 + Math.sin(tt * 2.9) * 0.2;
    bogey.y = Math.cos(tt * 1.3 + seed) * 0.38;

    const bx = cx + bogey.x * w * 0.38;
    const by = cy + bogey.y * h * 0.3;
    const rx = cx + MG.x * w * 0.38;
    const ry = cy + MG.y * h * 0.3;

    const radius = 46 * coneScale;
    const inside = Math.hypot(bx - rx, by - ry) < radius;
    if (inside) locked += dt; else locked = Math.max(0, locked - dt * 1.4);

    // the bogey: a pixel fighter seen from behind, banking as he turns
    const bank = Math.max(-1, Math.min(1, Math.cos(tt * 1.7 + seed) * 1.4));
    c.save();
    c.translate(snap(bx), snap(by));
    c.rotate(bank * 0.42);
    mgJet(c, 0, 0, Math.max(2, Math.round(Math.min(w, h) / 64)),
          inside ? MG_PAL.hot : MG_PAL.bad);
    c.restore();

    // reticle: four corner brackets, closing in as tone builds
    const prog = Math.min(1, locked / hold);
    const close = radius * (1 - prog * 0.3);
    const arm = Math.max(7, close * 0.42);
    c.strokeStyle = inside ? MG_PAL.hot : 'rgba(255,255,255,.45)';
    c.lineWidth = 2;
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (let i = 0; i < corners.length; i++) {
      const sx = corners[i][0], sy = corners[i][1];
      const ax = snap(rx + sx * close), ay = snap(ry + sy * close);
      c.beginPath();
      c.moveTo(ax, ay); c.lineTo(ax - sx * arm, ay);
      c.moveTo(ax, ay); c.lineTo(ax, ay - sy * arm);
      c.stroke();
    }
    c.fillStyle = inside ? MG_PAL.hot : 'rgba(255,255,255,.5)';
    c.fillRect(snap(rx - 2), snap(ry - 2), 4, 4);

    // tone meter down the left edge — a bar fills while he is in the box
    c.fillStyle = 'rgba(255,255,255,.1)';
    c.fillRect(13, 26, 8, h - 50);
    c.fillStyle = prog >= 1 ? MG_PAL.ok : MG_PAL.hot;
    const barH = snap((h - 50) * prog);
    c.fillRect(13, snap(26 + (h - 50) - barH), 8, barH);

    c.fillStyle = inside ? MG_PAL.hot : 'rgba(255,255,255,.4)';
    c.font = '800 11px Inter, sans-serif';
    c.textAlign = 'right';
    c.textBaseline = 'top';
    c.fillText(inside ? 'TONE' : 'NO TONE', w - 13, 11);

    mgClock(c, w, 1 - MG.t / total, prog < 0.5 && MG.t > total * 0.6);

    if (prog >= 1) {
      mgFlash(c, w, h, false, 'FOX TWO');
      setTimeout(() => mgFinish(true), 620);
      return;
    }
    if (MG.t >= total) {
      mgFlash(c, w, h, true, 'HE GOT AWAY');
      setTimeout(() => mgFinish(false), 620);
      return;
    }
    MG.raf = requestAnimationFrame(frame);
  }
  MG.raf = requestAnimationFrame(frame);
}

/* ------------------------------------------------------------- results */

/**
 * Server says the game is resolved.
 *
 * In arcade this screen stays up: the next rung arrives on its own in a
 * moment, so bouncing back to the quiz screen in between would just be a
 * flicker. During a quiz round it hands the player back to their question.
 */
function mgOver(m) {
  const el = document.getElementById('mgResult');

  if (m.arcade) {
    const climbed = m.nextLevel > m.level;
    if (m.success) {
      const part = m.pending
        ? `<span class="mgr-part" style="color:${TIER_COLOR[m.pending.tier]}">
             ROTATE THE PHONE TO FIT ${m.pending.name}</span>`
        : `<span class="mgr-part" style="color:var(--warn)">CRATE — CLAIM OR SHOVE IT</span>`;
      if (m.pending) {
        document.getElementById('mgTitle').textContent = 'NEW PART';
        document.getElementById('mgTitle').style.color = TIER_COLOR[m.pending.tier];
        document.getElementById('mgSub').textContent = 'ROTATE THE PHONE TO INSTALL IT';
      }
      el.innerHTML = `<span style="color:var(--good)">CLEARED +${m.points}</span>
        <div class="mgr-line">${part}</div>
        <div class="mgr-next">${climbed ? 'LEVEL ' + m.nextLevel + ' NEXT' : ''}</div>`;
    } else {
      el.innerHTML = `<span style="color:var(--danger)">MISSED</span>
        <div class="mgr-line" style="color:var(--text-mute)">NO PART THIS TIME</div>
        <div class="mgr-next">BACK TO LEVEL ${m.nextLevel}</div>`;
    }
    if (m.score !== undefined) {
      STATE.score = m.score;
      ['qScore', 'mgScore'].forEach(id => {
        const sc = document.getElementById(id);
        if (sc) sc.textContent = m.score;
      });
    }
    if (m.loadout) { FIGHT.loadout = m.loadout.parts; renderJetStrip(); }
    mgSetLevelChip(m.nextLevel);
    return;
  }

  if (m.success) {
    el.innerHTML = `<span style="color:var(--good)">
      ${m.kind === 'dodge' ? 'EVADED' : m.kind === 'lockon' ? 'SPLASHED' : 'RINGS CLEARED'}</span>`;
  } else if (m.lost) {
    el.innerHTML = `<span style="color:var(--danger)">LOST ${m.lost.name}</span>`;
  } else {
    el.innerHTML = `<span style="color:var(--text-mute)">NOTHING TO LOSE</span>`;
  }
  if (m.loadout) { FIGHT.loadout = m.loadout.parts; renderJetStrip(); }
  setTimeout(() => {
    if (STATE.phase === 'round') show('s-quiz');
  }, 1400);
}
