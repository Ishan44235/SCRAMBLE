/* ============================================================
   minigames.js — the two real-time interruptions during the quiz

   DODGE   a rival spent a missile on you. Tilt to slide your jet
           clear before it arrives, or lose your best part.
   RINGS   three wrong in a row puts you in a cockpit ring run.
           Tilt to fly through them, or lose a part at random.

   Both are tilt-only and deliberately short — they interrupt the
   quiz, so they have to resolve in a few seconds.
   ============================================================ */

/* eslint-disable no-undef */
const MG = {
  active: null,
  raf: null,
  t: 0,
  x: 0,            // player lateral position, -1 .. 1
  y: 0,            // player vertical position, -1 .. 1
  done: false,
};

function mgCanvas() { return document.getElementById('mgCanvas'); }

function mgStart(kind, info) {
  MG.active = kind;
  MG.t = 0;
  MG.x = 0;
  MG.y = 0;
  MG.done = false;

  const el = document.getElementById('s-minigame');
  document.getElementById('mgTitle').textContent =
    kind === 'dodge' ? 'INCOMING MISSILE' : 'RING RUN';
  document.getElementById('mgSub').textContent =
    kind === 'dodge'
      ? `${(info && info.from) || 'SOMEONE'} FIRED ON YOU — TILT TO EVADE`
      : 'THREE WRONG IN A ROW — FLY THE RINGS OR LOSE A PART';
  document.getElementById('mgTitle').style.color =
    kind === 'dodge' ? 'var(--danger)' : 'var(--warn)';

  show('s-minigame');
  haptic([40, 60, 40]);

  if (kind === 'dodge') mgDodge();
  else mgRings();
}

function mgFinish(success) {
  if (MG.done) return;
  MG.done = true;
  cancelAnimationFrame(MG.raf);
  MG.active = null;
  send({ t: 'minigame_result', success: success });
  haptic(success ? 40 : [30, 60, 30]);
}

/** Read the stick. Returns -1..1 on both axes. */
function mgStick() {
  if (!motion.live) return { x: 0, y: 0 };
  let x = motion.tiltRel / 26;
  let y = motion.pitchRel / 26;
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
  return { c, w, h };
}

function mgJet(c, x, y, px, tint) {
  // compact 9x7 jet, nose up
  const G = [
    '....X....',
    '...XXX...',
    '...XXX...',
    'XXXXXXXXX',
    '.XXXXXXX.',
    '...XXX...',
    '..X...X..',
  ];
  c.fillStyle = tint;
  for (let r = 0; r < G.length; r++)
    for (let k = 0; k < G[r].length; k++)
      if (G[r][k] === 'X')
        c.fillRect(Math.round(x + (k - 4.5) * px), Math.round(y + (r - 3) * px), px, px);
  // exhaust
  c.fillStyle = Math.random() < 0.5 ? '#f5a524' : '#ff7a3d';
  c.fillRect(Math.round(x - px), Math.round(y + 4 * px), px * 2, px * (1 + Math.random() * 2));
}

/* ------------------------------------------------------------ DODGE */
const DODGE_SECONDS = 4.2;

function mgDodge() {
  const missile = { x: (Math.random() < 0.5 ? -1 : 1) * 0.75, y: -1.15, track: 0.45 };
  let last = performance.now();

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    MG.t += dt;

    const { c, w, h } = mgSetup();
    const stick = mgStick();
    MG.x += (stick.x - MG.x) * Math.min(1, dt * 7);

    c.clearRect(0, 0, w, h);

    // ground rush
    c.strokeStyle = 'rgba(62,143,255,.13)';
    for (let i = 0; i < 9; i++) {
      const yy = ((MG.t * 240 + i * h / 9) % h);
      c.beginPath(); c.moveTo(0, yy); c.lineTo(w, yy); c.stroke();
    }

    // missile closes and leads your position a little
    const prog = MG.t / DODGE_SECONDS;
    missile.y = -1.15 + prog * 2.35;
    missile.x += (MG.x - missile.x) * missile.track * dt;

    const px = Math.max(2, Math.round(Math.min(w, h) / 46));
    const jx = w / 2 + MG.x * (w / 2 - 28);
    const jy = h - 46;
    const mx = w / 2 + missile.x * (w / 2 - 28);
    const my = h / 2 + missile.y * (h / 2);

    // missile trail
    c.fillStyle = 'rgba(245,165,36,.3)';
    c.fillRect(mx - 2, my - 34, 4, 30);
    // missile
    c.fillStyle = '#ff6b70';
    c.fillRect(mx - 3, my - 9, 6, 18);
    c.fillStyle = '#ffd48a';
    c.fillRect(mx - 2, my + 9, 4, 7 + Math.random() * 6);

    // lock-on reticle that tightens as it closes
    const r = 46 - prog * 26;
    c.strokeStyle = `rgba(229,72,77,${0.35 + prog * 0.5})`;
    c.lineWidth = 2;
    c.strokeRect(jx - r, jy - r, r * 2, r * 2);

    mgJet(c, jx, jy, px, '#6ef0a8');

    // countdown bar
    c.fillStyle = 'rgba(255,255,255,.1)';
    c.fillRect(0, 0, w, 5);
    c.fillStyle = prog > 0.75 ? '#e5484d' : '#f5a524';
    c.fillRect(0, 0, w * (1 - prog), 5);

    if (prog >= 1) {
      const miss = Math.abs(mx - jx);
      const hit = miss < 34;
      mgFlash(c, w, h, hit);
      setTimeout(() => mgFinish(!hit), 700);
      return;
    }
    MG.raf = requestAnimationFrame(frame);
  }
  MG.raf = requestAnimationFrame(frame);
}

/* ------------------------------------------------------------ RINGS */
const RING_COUNT = 4;
const RING_GAP = 1.5;      // seconds between rings arriving

function mgRings() {
  const rings = [];
  for (let i = 0; i < RING_COUNT; i++) {
    rings.push({
      at: 1.1 + i * RING_GAP,
      x: (Math.random() * 2 - 1) * 0.62,
      y: (Math.random() * 2 - 1) * 0.5,
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
    MG.x += (stick.x - MG.x) * Math.min(1, dt * 6);
    MG.y += (stick.y - MG.y) * Math.min(1, dt * 6);

    c.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;

    // cockpit perspective: horizon lines racing toward you
    c.strokeStyle = 'rgba(62,143,255,.16)';
    c.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      const z = 1 - ((MG.t * 0.55 + i / 10) % 1);
      const s = 1 / (z * 4 + 0.22);
      c.beginPath();
      c.moveTo(cx - w * s, cy + h * 0.42 * s);
      c.lineTo(cx + w * s, cy + h * 0.42 * s);
      c.stroke();
    }

    // rings approaching
    rings.forEach(ring => {
      const dtr = ring.at - MG.t;
      if (dtr > 2.6 || ring.done) return;
      const z = Math.max(0.04, dtr / 2.6);
      const s = 1 / (z * 3.4 + 0.18);
      const rx = cx + ring.x * w * 0.42 * s;
      const ry = cy + ring.y * h * 0.36 * s;
      const rad = 26 * s;

      c.strokeStyle = ring.passed ? '#30a46c'
        : (dtr < 0.35 ? '#f5a524' : 'rgba(110,240,168,.75)');
      c.lineWidth = Math.max(2, 4 * s * 0.5);
      c.beginPath();
      c.arc(rx, ry, rad, 0, Math.PI * 2);
      c.stroke();

      // scored the moment it reaches the cockpit
      if (dtr <= 0 && !ring.done) {
        ring.done = true;
        const px = cx + MG.x * w * 0.42;
        const py = cy + MG.y * h * 0.36;
        const inside = Math.hypot(px - rx, py - ry) < rad + 12;
        ring.passed = inside;
        if (inside) { cleared++; haptic(18); }
        else haptic([15, 25, 15]);
      }
    });

    // crosshair = where your nose is pointing
    const px = cx + MG.x * w * 0.42;
    const py = cy + MG.y * h * 0.36;
    c.strokeStyle = '#6ef0a8';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(px - 13, py); c.lineTo(px - 4, py);
    c.moveTo(px + 4, py); c.lineTo(px + 13, py);
    c.moveTo(px, py - 13); c.lineTo(px, py - 4);
    c.moveTo(px, py + 4); c.lineTo(px, py + 13);
    c.stroke();
    c.fillStyle = '#6ef0a8';
    c.fillRect(px - 1.5, py - 1.5, 3, 3);

    // progress pips
    for (let i = 0; i < RING_COUNT; i++) {
      c.fillStyle = rings[i].done
        ? (rings[i].passed ? '#30a46c' : '#e5484d')
        : 'rgba(255,255,255,.16)';
      c.fillRect(14 + i * 20, 14, 13, 6);
    }

    const over = rings.every(r => r.done);
    if (over) {
      const success = cleared >= Math.ceil(RING_COUNT / 2);
      mgFlash(c, w, h, !success);
      setTimeout(() => mgFinish(success), 700);
      return;
    }
    MG.raf = requestAnimationFrame(frame);
  }
  MG.raf = requestAnimationFrame(frame);
}

function mgFlash(c, w, h, bad) {
  c.fillStyle = bad ? 'rgba(229,72,77,.45)' : 'rgba(48,163,108,.35)';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#fff';
  c.font = '800 26px Inter, sans-serif';
  c.textAlign = 'center';
  c.fillText(bad ? 'HIT' : 'CLEAR', w / 2, h / 2);
}

/** Server says the minigame is resolved — show what it cost. */
function mgOver(m) {
  const el = document.getElementById('mgResult');
  if (m.success) {
    el.innerHTML = `<span style="color:var(--good)">
      ${m.kind === 'dodge' ? 'EVADED' : 'RINGS CLEARED'}</span>`;
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
