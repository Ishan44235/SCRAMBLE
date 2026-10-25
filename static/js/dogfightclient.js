/* ============================================================
   dogfightclient.js — hangar, cockpit and flight controls

   Controls, all motion:
     bank the phone left/right   -> turn
     pitch it forward/back       -> throttle
     GUNS button (hold)          -> fire
   ============================================================ */

const FIGHT = {
  on: false,
  steer: 0,
  throttle: 0.5,
  firing: false,
  missiles: 0,
  crates: 0,
  alive: true,
  endsAt: 0,
  sendTimer: null,
  loadout: null,
  arena: [1600, 900],
  blips: [],
  me: null,
  lastGunFx: 0,
  warnTimer: null,
  skyScroll: 0,
};

/* ------------------------------------------------------------ hangar */
function showHangar(m) {
  const mine = (m.jets || []).find(j => j.pid === STATE.pid);
  const lo = mine ? mine.loadout : null;
  FIGHT.loadout = lo ? lo.parts : null;

  $('hangarJet').innerHTML = jetSVG(FIGHT.loadout, 132);
  $('hangarRating').textContent = 'RATING ' + (lo ? lo.rating : 0);

  $('hangarList').innerHTML = SLOTS.map(slot => {
    const p = FIGHT.loadout && FIGHT.loadout[slot];
    const col = p ? TIER_COLOR[p.tier] : TIER_COLOR.empty;
    return `<div class="lo-row${p ? '' : ' empty'}" style="border-left-color:${col}">
      ${partIconSVG(slot, p ? p.tier : 'empty', 26)}
      <div>
        <div class="lo-slot">${SLOT_LABEL[slot]}</div>
        <div class="lo-name">${p ? p.name : 'EMPTY'}</div>
      </div>
      <div class="lo-tier" style="color:${col}">${p ? TIER_LABEL[p.tier] : '—'}</div>
    </div>`;
  }).join('');

  FIGHT.endsAt = performance.now() + 4000;
  show('s-hangar');
  haptic(40);
}

/* --------------------------------- live jet strip on the quiz screen */
function renderJetStrip(pulseSlot) {
  const lo = FIGHT.loadout;
  $('jsJet').innerHTML = jetSVG(lo, 34);

  $('jsSlots').innerHTML = SLOTS.map(slot => {
    const p = lo && lo[slot];
    const col = p ? TIER_COLOR[p.tier] : TIER_COLOR.empty;
    return `<div class="js-pip${p ? '' : ' empty'}${slot === pulseSlot ? ' pulse' : ''}"
                 style="border-bottom-color:${col}" data-slot="${slot}">
      ${partIconSVG(slot, p ? p.tier : 'empty', 17)}
    </div>`;
  }).join('');

  let rating = 0;
  if (lo) {
    const rank = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 };
    SLOTS.forEach(s => { if (lo[s]) rating += rank[lo[s].tier] * 20; });
  }
  $('jsRating').textContent = rating;
  $('jsCrates').textContent = FIGHT.crates > 0
    ? `${FIGHT.crates} CRATE${FIGHT.crates === 1 ? '' : 'S'}` : '';

  // the arcade screen carries its own copy of the bays, since arcade
  // players never see the quiz screen this strip normally lives on
  const mini = $('mgSlots');
  if (mini) {
    mini.innerHTML = SLOTS.map(slot => {
      const p = lo && lo[slot];
      const col = p ? TIER_COLOR[p.tier] : TIER_COLOR.empty;
      return `<div class="mg-bay${p ? '' : ' empty'}${slot === pulseSlot ? ' pulse' : ''}"
                   style="border-bottom-color:${col}">
        ${partIconSVG(slot, p ? p.tier : 'empty', 18)}
        <span>${SLOT_LABEL[slot]}</span>
      </div>`;
    }).join('');
  }
}

function setCrates(n) {
  FIGHT.crates = n;
  renderJetStrip();
  toast('MYSTERY CRATE SECURED', 'good');
  haptic([20, 30, 20]);
}

/** Rust ate one of your parts. */
function showRusted(m) {
  if (m.loadout) FIGHT.loadout = m.loadout.parts;
  renderJetStrip(m.slot);
  const to = m.to ? m.to.name : 'NOTHING';
  toast(`RUST — ${m.from.name} → ${to}`, 'bad');
  haptic([30, 50, 30]);
}

/** The hangar opens every sealed crate before the fight. */
function showCrateOpen(m) {
  if (m.loadout) FIGHT.loadout = m.loadout.parts;
  FIGHT.crates = 0;
  const best = m.opened.filter(o => o.fitted);
  const pop = $('partPop');
  const lines = m.opened.map(o => {
    const col = TIER_COLOR[o.part.tier];
    return `<div style="display:flex;align-items:center;gap:9px;margin-top:5px">
      ${partIconSVG(o.part.slot, o.part.tier, 26)}
      <div><div class="pp-n" style="font-size:14px">${o.part.name}</div>
      <div class="pp-t" style="color:${col}">${TIER_LABEL[o.part.tier]}${
        o.fitted ? '' : ' · SCRAPPED'}</div></div></div>`;
  }).join('');
  pop.style.borderColor = 'var(--warn)';
  pop.innerHTML = `<div><div class="pp-k" style="color:var(--warn)">CRATE OPENED</div>${lines}</div>`;
  pop.classList.add('show');
  clearTimeout(FIGHT.popTimer);
  FIGHT.popTimer = setTimeout(() => pop.classList.remove('show'), 2600);
  haptic(best.length ? [25, 40, 25, 40] : 20);
}

/* Earned part: rotate the upright phone to install it. */
function showInstallPrompt(part) {
  const el = $('installPrompt');
  if (!el) return;
  $('installPartName').textContent = part.name;
  el.classList.add('show');
}
function hideInstallPrompt() {
  const el = $('installPrompt');
  if (el) el.classList.remove('show');
}
function installPartTap() {
  if (STATE.pendingInstall != null) {
    send({ t: 'install_part', token: STATE.pendingInstall });
  }
}

/* ------------------------------------------------- part earned popup */
function showPartPop(m) {
  const pop = $('partPop');
  const p = m.part;
  const col = TIER_COLOR[p.tier];

  if (!m.fitted) {
    pop.style.borderColor = 'var(--line)';
    pop.innerHTML = `${partIconSVG(p.slot, p.tier, 34)}
      <div><div class="pp-k" style="color:var(--text-mute)">NOT AN UPGRADE</div>
      <div class="pp-n">${p.name}</div>
      <div class="pp-t" style="color:${col}">${TIER_LABEL[p.tier]} · SCRAPPED</div></div>`;
  } else {
    pop.style.borderColor = col;
    pop.innerHTML = `${partIconSVG(p.slot, p.tier, 34)}
      <div><div class="pp-k" style="color:${col}">
        ${m.upgrade ? 'UPGRADED · ' + SLOT_LABEL[p.slot] : 'FITTED · ' + SLOT_LABEL[p.slot]}</div>
      <div class="pp-n">${p.name}</div>
      <div class="pp-t" style="color:${col}">${TIER_LABEL[p.tier]}</div></div>`;
    haptic(p.tier === 'legendary' || p.tier === 'epic' ? [25, 40, 25] : 18);
  }

  pop.classList.add('show');
  clearTimeout(FIGHT.popTimer);
  FIGHT.popTimer = setTimeout(() => pop.classList.remove('show'), 1700);

  if (m.loadout) FIGHT.loadout = m.loadout.parts;
  renderJetStrip(m.fitted ? p.slot : null);
}

/* ------------------------------------------------- threat + trading */
function showThreat(m) {
  const mine = STATE.marked;
  const pop = $('partPop');
  pop.style.borderColor = 'var(--danger)';
  pop.innerHTML = m.name
    ? `<div>
        <div class="pp-k" style="color:var(--danger)">THE TABLE HAS MARKED</div>
        <div class="pp-n" style="font-size:21px">${m.name}</div>
        <div class="pp-t" style="color:var(--text-dim)">
          ${m.bounty}× bounty · afterburner fitted</div>
       </div>`
    : `<div><div class="pp-k" style="color:var(--text-mute)">NO CONSENSUS</div>
        <div class="pp-n">Nobody was marked</div></div>`;
  pop.classList.add('show');
  clearTimeout(FIGHT.popTimer);
  FIGHT.popTimer = setTimeout(() => pop.classList.remove('show'), 3200);
  if (mine) haptic([30, 50, 30]);
}

function showTraded(m) {
  if (m.loadout) FIGHT.loadout = m.loadout.parts;
  renderJetStrip();
  const got = m.got ? m.got.name : 'nothing';
  const gave = m.gave ? m.gave.name : 'nothing';
  toast(m.forced
    ? `${m.with} TOOK ${gave} — LEFT YOU ${got}`
    : `SWAPPED ${gave} FOR ${got}`, m.forced ? 'bad' : 'good');
  haptic(30);
}

/** Mechanic's trade panel, shown during the discussion. */
function buildTradePanel() {
  if (!STATE.role || STATE.role.agenda !== 'mechanic') return;
  const panel = $('tradePanel');
  panel.style.display = 'block';

  const others = STATE.roster.filter(p => p.pid !== STATE.pid);
  const slotOpts = SLOTS.map(s =>
    `<option value="${s}">${SLOT_LABEL[s]}</option>`).join('');

  panel.innerHTML = `
    <div class="eyebrow" style="color:var(--accent)">MECHANIC — FORCE ONE SWAP</div>
    <p style="font-size:12.5px;color:var(--text-dim);margin:9px 0 13px">
      Pick a pilot, the bay of theirs you want, and the bay of yours you'll
      give up. They don't get a say.</p>
    <select id="tradeWho" class="tsel">
      ${others.map(p => `<option value="${p.pid}">${p.name}</option>`).join('')}
    </select>
    <div style="display:flex;gap:8px;margin-top:9px">
      <select id="tradeTheirs" class="tsel">${slotOpts}</select>
      <select id="tradeMine" class="tsel">${slotOpts}</select>
    </div>
    <button class="btn" id="tradeGo" style="margin-top:11px">TAKE IT</button>`;

  $('tradeGo').onclick = () => {
    send({ t: 'trade',
           targetPid: $('tradeWho').value,
           theirSlot: $('tradeTheirs').value,
           mySlot: $('tradeMine').value });
    panel.style.display = 'none';
  };
}

/* ------------------------------------------------------------ flight */
/**
 * Your own jet in the cockpit view: the same pixel silhouette as the hangar,
 * coloured by your loadout, drawn once and then banked with CSS. Redrawing
 * only when the loadout changes keeps the 60fps loop cheap.
 */
function drawCockpitJet() {
  const cv = $('hzPixJet');
  if (!cv) return;
  const px = 6;
  const rows = JET_MAP.length, cols = JET_MAP[0].length;
  cv.width = cols * px;
  cv.height = rows * px;
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.clearRect(0, 0, cv.width, cv.height);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const ch = JET_MAP[y][x];
      if (ch === '.') continue;
      let col = regionColor(ch, FIGHT.loadout);
      if (!col) continue;
      if (x < cols / 2 - 1) col = shadeHex(col, 0.14);
      else if (x > cols / 2 + 1) col = shadeHex(col, -0.2);
      c.fillStyle = col;
      c.fillRect(x * px, y * px, px, px);
      // a one-pixel dark outline on the silhouette edge, so the jet reads
      // against a bright sky instead of dissolving into it
      const edge = (yy, xx) => yy < 0 || xx < 0 || yy >= rows || xx >= cols ||
        JET_MAP[yy][xx] === '.';
      c.fillStyle = 'rgba(5,7,12,.55)';
      if (edge(y - 1, x)) c.fillRect(x * px, y * px, px, 1);
      if (edge(y + 1, x)) c.fillRect(x * px, y * px + px - 1, px, 1);
      if (edge(y, x - 1)) c.fillRect(x * px, y * px, 1, px);
      if (edge(y, x + 1)) c.fillRect(x * px + px - 1, y * px, 1, px);
    }
  }
}

function startFight() {
  FIGHT.on = true;
  FIGHT.steer = 0;
  FIGHT.throttle = 0.5;
  FIGHT.alive = true;
  if (!loopRunning) startLoop();
  if (motion.live) motion.calibrateTilt();
  show('s-fight');
  drawCockpitJet();
  wireFightControls();

  // stream control input at a steady 20 Hz rather than on every sensor event
  clearInterval(FIGHT.sendTimer);
  FIGHT.sendTimer = setInterval(() => {
    if (!FIGHT.on) return;
    fightTick();
    send({ t: 'ctl', steer: +FIGHT.steer.toFixed(3),
           throttle: +FIGHT.throttle.toFixed(3), fire: FIGHT.firing });
  }, 50);
}

function stopFight() {
  FIGHT.on = false;
  FIGHT.firing = false;
  FIGHT.me = null;
  FIGHT.blips = [];
  FIGHT.lastGunFx = 0;
  FIGHT.skyScroll = 0;
  clearInterval(FIGHT.sendTimer);
  const contacts = $('hzContacts');
  if (contacts) contacts.innerHTML = '';
  const fx = $('hzFx');
  if (fx) fx.innerHTML = '';
  const warn = $('hzWarning');
  if (warn) { warn.classList.remove('on'); warn.textContent = ''; }
}

/** Read bank and pitch off the sensors; called from the main loop. */
function fightTick() {
  if (!FIGHT.on) return;

  if (motion.live) {
    // bank: roll the phone like a wheel
    let bank = motion.tiltRel;
    if (STATE.inverted) bank = -bank;
    const DEAD = 4, FULL = 32;
    const mag = Math.max(0, Math.abs(bank) - DEAD) / (FULL - DEAD);
    FIGHT.steer = Math.sign(bank) * Math.min(1, mag);

    // throttle: pitch forward for more
    const pitch = Math.max(-30, Math.min(30, motion.pitchRel));
    FIGHT.throttle = Math.min(1, Math.max(0, 0.5 + pitch / 55));
  } else {
    FIGHT.steer = 0;
    FIGHT.throttle = 0.5;
  }

  const tp = Math.round(FIGHT.throttle * 100);
  $('fThrottle').style.height = tp + '%';
  $('fThrottleV').textContent = tp + '%';
  // your jet rolls with the stick, the sky counter-rolls behind it
  const jet = $('hzPixJet');
  if (jet) jet.style.transform = `rotate(${(FIGHT.steer * 22).toFixed(1)}deg)`;
  const glow = $('hzJetGlow');
  if (glow) {
    const scale = 0.72 + FIGHT.throttle * 0.9;
    glow.style.opacity = (0.25 + FIGHT.throttle * 0.75).toFixed(2);
    glow.style.transform = `translateX(-50%) scale(${scale.toFixed(2)}, ${(0.8 + FIGHT.throttle * 1.2).toFixed(2)})`;
  }

  const left = Math.max(0, (FIGHT.endsAt - performance.now()) / 1000);
  $('fClock').textContent = fmt(left);

  const now = performance.now();
  if (FIGHT.firing && now - FIGHT.lastGunFx > 95) {
    fightFx('shot');
    FIGHT.lastGunFx = now;
  }
}

function showFightWarning(text, ms = 950) {
  const el = $('hzWarning');
  if (!el) return;
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(FIGHT.warnTimer);
  FIGHT.warnTimer = setTimeout(() => el.classList.remove('on'), ms);
}

function fightFx(kind, xPct, yPct) {
  const box = $('hzFx');
  if (!box) return;
  const el = document.createElement('div');
  if (kind === 'shot') {
    el.className = 'fx-shot';
    el.style.left = (48 + Math.random() * 6) + '%';
  } else if (kind === 'missile') {
    el.className = 'fx-missile';
    el.style.left = (47 + Math.random() * 8) + '%';
  } else if (kind === 'hit') {
    const flash = document.createElement('div');
    flash.className = 'fx-hitflash';
    box.appendChild(flash);
    flash.addEventListener('animationend', () => flash.remove());
    el.className = 'fx-burst';
    el.style.left = (xPct == null ? 50 : xPct) + '%';
    el.style.top = (yPct == null ? 48 : yPct) + '%';
  } else if (kind === 'explode') {
    const flash = document.createElement('div');
    flash.className = 'fx-lockflash';
    box.appendChild(flash);
    flash.addEventListener('animationend', () => flash.remove());
    el.className = 'fx-burst';
    el.style.borderColor = 'rgba(255,140,92,.95)';
    el.style.left = (xPct == null ? 50 : xPct) + '%';
    el.style.top = (yPct == null ? 42 : yPct) + '%';
  }
  box.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

/* ------------------------------------------------------------- canopy
   The view out of the cockpit, drawn at one third resolution and scaled up
   with pixelated rendering — the cheap way to get chunky retro pixels, and
   cheap enough to redraw every frame on any phone.

   Sky is a few hard colour bands (no gradients), clouds slide sideways as
   your heading changes so turning is visible, ground stripes rush toward
   you faster with throttle, and the whole horizon counter-rolls as you bank.
*/
const CANOPY = { clouds: null, scroll: 0, last: 0 };
const SKY_BANDS = ['#8fc6f5', '#76b4f0', '#5c9ee8', '#4686dc', '#346fcc', '#2858b4', '#1f468f'];
const CLOUD_ROWS = ['..XXXX....', '.XXXXXXX..', 'XXXXXXXXXX', '.XXXXXXXX.'];

function drawCanopy() {
  const cv = $('hzCanvas');
  if (!cv) return;
  const cw = cv.clientWidth, ch = cv.clientHeight;
  if (!cw || !ch) return;
  const S = 3;                              // art pixel = 3 screen pixels
  const W = Math.ceil(cw / S), H = Math.ceil(ch / S);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;

  const now = performance.now();
  const dt = CANOPY.last ? Math.min(0.05, (now - CANOPY.last) / 1000) : 0;
  CANOPY.last = now;
  CANOPY.scroll = (CANOPY.scroll + dt * (0.6 + FIGHT.throttle * 2.4)) % 1;

  if (!CANOPY.clouds) {
    CANOPY.clouds = [];
    for (let i = 0; i < 9; i++) {
      CANOPY.clouds.push({ a: i * 40 + Math.random() * 30, y: 6 + Math.random() * 34,
                           s: 2 + Math.floor(Math.random() * 2) });
    }
  }

  const heading = FIGHT.me ? FIGHT.me.heading : 0;
  const bank = -FIGHT.steer * 0.34;        // radians, counter-roll
  const horizonY = Math.round(H * 0.6 - (FIGHT.throttle - 0.5) * H * 0.08);

  c.save();
  c.translate(Math.round(W / 2), horizonY);
  c.rotate(bank);
  const R = Math.ceil(Math.hypot(W, H));   // big enough to cover when rolled

  // sky: hard bands climbing away from the horizon
  const bandH = Math.ceil(H * 0.1);
  c.fillStyle = SKY_BANDS[SKY_BANDS.length - 1];
  c.fillRect(-R, -R, R * 2, R);
  for (let i = 0; i < SKY_BANDS.length; i++) {
    c.fillStyle = SKY_BANDS[i];
    c.fillRect(-R, -(i + 1) * bandH, R * 2, bandH);
  }

  // clouds: placed on a 360° ring around you, so turning slides them
  const pxPerDeg = W / 70;
  for (const cl of CANOPY.clouds) {
    let rel = ((cl.a - heading + 540) % 360) - 180;
    const x = Math.round(rel * pxPerDeg);
    if (Math.abs(x) > R) continue;
    const y = -Math.round(cl.y * H / 60) - 4;
    for (let r = 0; r < CLOUD_ROWS.length; r++)
      for (let k = 0; k < CLOUD_ROWS[r].length; k++) {
        if (CLOUD_ROWS[r][k] !== 'X') continue;
        c.fillStyle = r === CLOUD_ROWS.length - 1 ? '#c9e2f7' : '#ffffff';
        c.fillRect(x + k * cl.s - 5 * cl.s, y + r * cl.s, cl.s, cl.s);
      }
  }

  // ground: stripes in perspective, rushing toward you
  c.fillStyle = '#3f7d36';
  c.fillRect(-R, 0, R * 2, R);
  const groundH = H - horizonY + R;
  for (let i = 0; i < 14; i++) {
    const z = ((i + CANOPY.scroll) / 14);
    const y0 = Math.round(Math.pow(z, 2.2) * groundH);
    const y1 = Math.round(Math.pow(z + 0.5 / 14, 2.2) * groundH);
    c.fillStyle = '#4a9140';
    c.fillRect(-R, y0, R * 2, Math.max(1, y1 - y0));
  }
  // horizon haze line
  c.fillStyle = '#cfe9ff';
  c.fillRect(-R, -1, R * 2, 1);
  c.fillStyle = '#6aa85a';
  c.fillRect(-R, 0, R * 2, 1);
  c.restore();
}

/**
 * Cockpit radar: the whole arena as a top-down map. Yours is a green arrow,
 * enemies are red blips tagged with the first letters of their name, the
 * wreck of anyone respawning is a grey cross. Coarse by design — it tells you
 * where the fight is, the canopy tells you how to aim.
 */
function drawMinimap(blips, arena) {
  const cv = $('fMinimap');
  if (!cv || !blips) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = '#041009';
  c.fillRect(0, 0, w, h);

  // arena is sent divided by 16 on the server side
  const AW = (arena ? arena[0] : 1600) / 16;
  const AH = (arena ? arena[1] : 900) / 16;
  const sx = w / AW, sy = h / AH;

  c.strokeStyle = 'rgba(48,163,108,.16)';
  c.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    const x = Math.round((w / 8) * i) + 0.5;
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke();
  }
  for (let i = 1; i < 4; i++) {
    const y = Math.round((h / 4) * i) + 0.5;
    c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
  }

  c.font = '700 8px "JetBrains Mono", monospace';
  c.textBaseline = 'middle';
  const mineBlip = blips.find(b => b.p === STATE.pid);

  // enemies first, so your own arrow is always on top
  blips.forEach(b => {
    if (b.p === STATE.pid) return;
    const x = Math.round(b.x * sx), y = Math.round(b.y * sy);
    if (!b.a) {
      c.strokeStyle = 'rgba(140,150,170,.55)';
      c.beginPath(); c.moveTo(x - 3, y - 3); c.lineTo(x + 3, y + 3);
      c.moveTo(x + 3, y - 3); c.lineTo(x - 3, y + 3); c.stroke();
      return;
    }
    c.fillStyle = '#ff6b70';
    c.fillRect(x - 3, y - 3, 6, 6);
    c.fillStyle = '#2a0b10';
    c.fillRect(x - 1, y - 1, 2, 2);
    c.fillStyle = 'rgba(255,190,193,.85)';
    c.textAlign = x > w - 30 ? 'right' : 'left';
    c.fillText(String(b.n || '').slice(0, 4), x + (x > w - 30 ? -6 : 6), y);
  });

  if (mineBlip) {
    const x = mineBlip.x * sx, y = mineBlip.y * sy;
    // a soft ring so you can find yourself instantly in a busy fight
    c.strokeStyle = 'rgba(110,240,168,.35)';
    c.beginPath(); c.arc(x, y, 11, 0, Math.PI * 2); c.stroke();
    c.save();
    c.translate(x, y);
    c.rotate((mineBlip.h * 15 + 90) * Math.PI / 180);
    c.fillStyle = mineBlip.a ? '#6ef0a8' : 'rgba(110,240,168,.35)';
    c.beginPath();
    c.moveTo(0, -7); c.lineTo(5, 5); c.lineTo(0, 2); c.lineTo(-5, 5);
    c.closePath(); c.fill();
    c.restore();
  }
}

function wrapDelta(d, size) {
  if (d > size / 2) return d - size;
  if (d < -size / 2) return d + size;
  return d;
}

function angleTo(a, b) {
  return ((b - a + 540) % 360) - 180;
}

/* Enemy contacts are the same pixel jet everyone flies, in hostile red, so
   what you see out of the canopy matches what the big screen shows. Built
   once and cached — every fight_me frame reuses the string. */
let CONTACT_SVG = null;
let CONTACT_LOCK_SVG = null;
function pixelJetSVG(body, hi, lo, canopy) {
  const rows = JET_MAP.length, cols = JET_MAP[0].length;
  let cells = '';
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const ch = JET_MAP[y][x];
      if (ch === '.') continue;
      const col = ch === 'C' ? canopy
        : (x < cols / 2 - 1 ? hi : (x > cols / 2 + 1 ? lo : body));
      cells += `<rect x="${x}" y="${y}" width="1" height="1" fill="${col}"/>`;
    }
  }
  return `<svg viewBox="0 0 ${cols} ${rows}" xmlns="http://www.w3.org/2000/svg" ` +
         `shape-rendering="crispEdges">${cells}</svg>`;
}
function contactPlaneSVG(locked) {
  if (!CONTACT_SVG) {
    CONTACT_SVG = pixelJetSVG('#e5484d', '#ff7f86', '#a02a33', '#2a0b10');
    CONTACT_LOCK_SVG = pixelJetSVG('#f5a524', '#ffd48a', '#b0700e', '#2a1a05');
  }
  return locked ? CONTACT_LOCK_SVG : CONTACT_SVG;
}

/* Off-screen contacts: a chunky pixel chevron pinned to the canopy edge. */
function contactArrowSVG(dir) {
  const rows = dir === 'left'
    ? ['...XX', '..XXX', '.XXXX', 'XXXXX', '.XXXX', '..XXX', '...XX']
    : ['XX...', 'XXX..', 'XXXX.', 'XXXXX', 'XXXX.', 'XXX..', 'XX...'];
  let cells = '';
  for (let y = 0; y < rows.length; y++)
    for (let x = 0; x < 5; x++)
      if (rows[y][x] === 'X')
        cells += `<rect x="${x}" y="${y}" width="1" height="1" fill="${y === 3 ? '#ffd0d3' : '#ff5f69'}"/>`;
  return `<svg viewBox="0 0 5 7" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">${cells}</svg>`;
}

function escapeTargetName(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
function drawContacts(me, blips, arena) {
  const box = $('hzContacts');
  if (!box) return;
  if (!me || !blips || !blips.length) { box.innerHTML = ''; return; }

  const AW = arena ? arena[0] : 1600;
  const AH = arena ? arena[1] : 900;
  const range = Math.min(900, Math.hypot(AW, AH) * 0.55);
  const FOV = 60;
  let leftCount = 0, rightCount = 0, visCount = 0;

  const enemies = blips.filter(b => b.p !== STATE.pid && b.a)
    .map(b => {
      const ex = b.x * 16;
      const ey = b.y * 16;
      const dx = wrapDelta(ex - me.x, AW);
      const dy = wrapDelta(ey - me.y, AH);
      const dist = Math.hypot(dx, dy);
      const bearing = Math.atan2(dy, dx) * 180 / Math.PI;
      const rel = angleTo(me.heading, bearing);
      return { pid: b.p, name: b.n || "PILOT", hp: b.hp ?? 0, maxHp: b.maxHp || 100, dist, rel };
    })
    .sort((a, b) => a.dist - b.dist);

  const lock = enemies.find(e => Math.abs(e.rel) <= 18) || null;
  box.innerHTML = enemies.map(e => {
    const near = Math.max(0, Math.min(1, 1 - e.dist / range));
    const pop = Math.pow(near, 0.72);
    const size = Math.round(14 + pop * 38);
    if (Math.abs(e.rel) <= FOV) {
      const lane = visCount++ % 3;
      const x = 50 + (e.rel / FOV) * 42;
      const top = 14 + (1 - (e.dist / range)) * 28 + lane * 8;
      const h = Math.round(size * JET_MAP.length / JET_MAP[0].length);
      const isLock = e.pid === (lock && lock.pid);
      const cls = isLock ? 'hz-contact plane assist' : 'hz-contact plane';
      const hpPct = Math.round(Math.max(0, Math.min(1, e.hp / e.maxHp)) * 100);
      // Only the jet you are locked onto gets a name tag; everyone else just
      // carries a slim health bar. A canopy full of labels is unreadable.
      const tag = isLock
        ? `<span class="hz-target-label"><b>${escapeTargetName(e.name)}</b><i class="hz-hp"><s style="width:${hpPct}%"></s></i></span>`
        : `<i class="hz-hp solo"><s style="width:${hpPct}%"></s></i>`;
      return `<div class="${cls}" style="left:calc(${x}% - ${size / 2}px);top:${top}%;width:${size}px;height:${h}px">${contactPlaneSVG(isLock)}${tag}</div>`;
    }

    const side = e.rel < 0 ? 'left' : 'right';
    const lane = side === 'left' ? leftCount++ : rightCount++;
    if (lane > 2) return '';              // three edge arrows per side is plenty
    const top = 18 + lane * 14;
    const w = Math.round(11 + pop * 8);
    return `<div class="hz-contact tri ${side}" style="${side}:8px;top:${top}%;width:${w}px;height:${Math.round(w * 1.4)}px">${contactArrowSVG(side)}</div>`;
  }).join('');
}

/** Server tells us how our own jet is doing. */
function fightMe(m) {
  const me = m.me;
  FIGHT.me = me;
  FIGHT.blips = m.blips || [];
  FIGHT.arena = m.arena || FIGHT.arena;
  drawMinimap(FIGHT.blips, FIGHT.arena);
  drawContacts(me, FIGHT.blips, FIGHT.arena);
  FIGHT.missiles = me.missiles;
  FIGHT.endsAt = performance.now() + m.left * 1000;

  const pct = Math.max(0, me.hp / me.maxHp) * 100;
  const fill = $('fHpFill');
  fill.style.width = pct + '%';
  fill.className = 'hp-fill' + (pct < 25 ? ' crit' : pct < 55 ? ' warn' : '');
  $('fHpText').textContent = Math.round(me.hp);
  $('fKills').textContent = me.kills;
  $('fGuns').classList.toggle('dis', me.failed.includes('guns'));

  // a sabotaged part giving out, announced on your own phone
  if (me.failed.length) {
    const names = { engine: 'ENGINE FLAMEOUT', guns: 'GUNS JAMMED',
                    missiles: 'MISSILE RACK DEAD', wings: 'CONTROL SURFACE TORN',
                    armor: 'ARMOUR SHEARED' };
    $('fStatus').textContent = me.failed.map(s => names[s] || s).join(' · ');
  } else {
    $('fStatus').textContent = '';
  }

  if (me.alive !== FIGHT.alive) {
    FIGHT.alive = me.alive;
    $('fDead').classList.toggle('on', !me.alive);
    if (!me.alive) haptic([40, 60, 40]);
  }

  (m.events || []).forEach(e => {
    if (e.kind === 'hit' && e.shooterPid === STATE.pid && e.pid !== STATE.pid) {
      showFightWarning('HIT CONFIRMED', 450);
      fightFx('hit', 50, 40);
      haptic(14);
    }
    if (e.kind === 'hit' && e.pid === STATE.pid) {
      fightFx(e.weapon === 'missile' ? 'explode' : 'hit');
      showFightWarning(e.weapon === 'missile' ? 'MISSILE HIT' : 'TAKING FIRE', 900);
      haptic(e.weapon === 'missile' ? [30, 50, 30] : 18);
    }
    if (e.kind === 'kill' && e.victimPid === STATE.pid) {
      fightFx('explode', 50, 42);
      showFightWarning('SHOT DOWN', 1200);
      $('fDeadSub').textContent = e.killer
        ? `${e.killer} got you with ${e.weapon === 'missile' ? 'a missile' : 'guns'}.`
        : 'Respawning…';
    }
  });
}

function fightOver(m) {
  stopFight();
  showPodium(m.standings || []);
}

/**
 * The phone's end screen: your place, the top three on a little podium, and
 * how your own total was made. Used both when the dogfight ends and when the
 * room settles into the results phase, so the two can never disagree.
 */
function showPodium(standings) {
  const rows = standings.slice().sort((a, b) => (b.final ?? b.score) - (a.final ?? a.score));
  const idx = rows.findIndex(s => s.pid === STATE.pid);
  const me = rows[idx];
  const arcade = rows.some(r => r.mode === 'arcade');
  const pts = r => Math.round(r.final ?? r.score ?? 0);
  const place = ['1ST', '2ND', '3RD'];

  $('resEyebrow').textContent = idx === 0 ? 'TOP GUN' : idx > -1 && idx < 3 ? 'ON THE PODIUM' : 'FINAL STANDINGS';
  $('resTitle').textContent = idx > -1 ? (idx < 3 ? place[idx] + ' PLACE' : '#' + (idx + 1)) : '—';
  $('resTitle').style.color = idx === 0 ? 'var(--warn)' : idx > -1 && idx < 3 ? 'var(--good)' : 'var(--text)';

  if (me) {
    const nm = s => escapePartName(String(s || ''));
    $('resReason').innerHTML =
      `<b style="font-size:20px">${pts(me)}</b> points<br>` +
      `${arcade ? 'Arcade' : 'Quiz'} ${Math.round(me.matchPoints || 0)} · ` +
      `Dogfight ${Math.round(me.fightScore ?? me.score ?? 0)} ` +
      `(${me.kills} kill${me.kills === 1 ? '' : 's'}) · ` +
      `<span style="color:${me.agendaColor}">${nm(me.agendaName)}</span> +${me.bonus || 0}`;
  }

  const order = [1, 0, 2].filter(i => rows[i]);
  $('resPodium').innerHTML = order.map(i => {
    const r = rows[i];
    return `<div class="mp mp-${i + 1}${r.pid === STATE.pid ? ' me' : ''}">
      ${avatarSVG(r.avatar || 'fox', i === 0 ? 44 : 36, { bg: '#0b0d14' })}
      <div class="mp-name">${escapePartName(r.name)}</div>
      <div class="mp-pts">${pts(r)}</div>
      <div class="mp-step">${i + 1}</div>
    </div>`;
  }).join('');
  show('s-results');
  haptic(idx === 0 ? [40, 60, 40] : 40);
}

/* ---------------------------------------------------------- controls */
function wireFightControls() {
  if (FIGHT.wired) return;
  FIGHT.wired = true;

  const guns = $('fGuns');
  const hold = on => {
    FIGHT.firing = on;
    guns.classList.toggle('on', on);
    if (on) haptic(10);
  };
  guns.addEventListener('touchstart', e => { e.preventDefault(); hold(true); }, { passive: false });
  guns.addEventListener('touchend', e => { e.preventDefault(); hold(false); }, { passive: false });
  guns.addEventListener('touchcancel', () => hold(false));
  guns.addEventListener('mousedown', () => hold(true));
  guns.addEventListener('mouseup', () => hold(false));
  guns.addEventListener('mouseleave', () => hold(false));


}

/* ============================================================
   Live crates — parts that arrive ticking.

   A part that isn't an outright upgrade lands in your hands with a
   10-second fuse. CLAIM it at its current tier, or SHOVE it at
   somebody else: that bumps its tier but does NOT reset the fuse, so
   the better it gets the closer it is to going off.
   ============================================================ */

const HOT = { crates: [], shoving: null };

/**
 * Draw the live crates into whichever bars exist: the quiz screen's and the
 * arcade screen's. Each crate carries its own ◀ / ▶ buttons, so shoving is
 * one tap in a known direction rather than arm-then-pick-a-neighbour.
 */
function renderHot() {
  const bars = ['hotbar', 'hotbarMini']
    .map(id => document.getElementById(id)).filter(Boolean);
  if (!bars.length) return;

  // who sits either side of you, so the pass buttons can say who gets it
  const ring = (typeof STATE !== 'undefined' && STATE.ring) || [];
  const me = ring.find(x => x.pid === STATE.pid);
  const byPid = Object.fromEntries(ring.map(x => [x.pid, x]));
  const left = me && byPid[me.left], right = me && byPid[me.right];
  const nm = x => x ? escapePartName(x.name) : '—';

  const html = HOT.crates.map(c => {
    const col = TIER_COLOR[c.tier] || TIER_COLOR.empty;
    const pct = Math.max(0, Math.min(1, c.left / 10)) * 100;
    const urgent = c.left <= 3.5;
    const nextTier = { common: 'uncommon', uncommon: 'rare', rare: 'epic',
                       epic: 'legendary', legendary: 'legendary' }[c.tier];
    return `<div class="hot${urgent ? ' urgent' : ''}${c.harmless ? ' harmless' : ''}"
                 data-cid="${c.cid}" style="border-bottom-color:${col}">
      <span class="hot-passes">${c.passes ? '×' + c.passes : ''}</span>
      <div class="hot-top">
        ${partIconSVG(c.slot, c.tier, 22)}
        <div>
          <div class="hot-name">${c.name}</div>
          <div class="hot-tier" style="color:${col}">${TIER_LABEL[c.tier]} · ${SLOT_LABEL[c.slot]}</div>
        </div>
      </div>
      <div class="hot-fuse"><i style="width:${pct}%"></i></div>
      <button class="claim hot-claim" data-a="claim">KEEP IT</button>
      <div class="hot-pass">
        <button class="shove" data-a="left" ${left ? '' : 'disabled'} aria-label="Pass left to ${nm(left)}">◀ ${nm(left)}</button>
        <button class="shove" data-a="right" ${right ? '' : 'disabled'} aria-label="Pass right to ${nm(right)}">${nm(right)} ▶</button>
      </div>
      <div class="hot-up">PASS IT ON → BECOMES <span style="color:${TIER_COLOR[nextTier]}">${TIER_LABEL[nextTier]}</span></div>
    </div>`;
  }).join('');

  bars.forEach(bar => {
    bar.innerHTML = html;
    bar.querySelectorAll('.hot').forEach(el => {
      const cid = +el.dataset.cid;
      el.querySelectorAll('button').forEach(b => {
        b.onclick = e => {
          e.preventDefault();
          if (b.dataset.a === 'claim') {
            send({ t: 'claim_hot', cid });
            haptic(22);
          } else {
            // the server confirms who got it, with a toast naming them
            send({ t: 'pass_hot', cid, dir: b.dataset.a });
            el.classList.add('sending');
            haptic(30);
          }
        };
      });
    });
  });
}

/** Server pushes the full list whenever it changes. */
function hotUpdate(m) {
  HOT.crates = m.crates || [];
  renderHot();
}

/**
 * Burn the fuses down locally between server pushes. Updates the bars in
 * place instead of re-rendering, so a button is never swapped out from under
 * a finger mid-tap.
 */
function hotTick(dt) {
  if (!HOT.crates.length) return;
  HOT.crates.forEach(c => {
    c.left = Math.max(0, c.left - dt);
    document.querySelectorAll(`.hot[data-cid="${c.cid}"]`).forEach(el => {
      const bar = el.querySelector('.hot-fuse i');
      if (bar) bar.style.width = (Math.max(0, Math.min(1, c.left / 10)) * 100).toFixed(1) + '%';
      el.classList.toggle('urgent', c.left <= 3.5);
    });
  });
}
function escapePartName(s) {
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function hotBlew(m) {
  if (m.loadout) { FIGHT.loadout = m.loadout.parts; renderJetStrip(); }
  if (m.harmless) {
    // arcade crates just get scrapped — nothing comes off your jet
    toast(`CRATE SCRAPPED — ${m.crate ? m.crate.name : 'PART'} GONE`, 'warn');
    haptic(30);
    return;
  }
  toast(m.lost ? `CRATE BLEW — LOST ${m.lost.name}` : 'CRATE BLEW — NOTHING TO LOSE',
        'bad');
  haptic([50, 70, 50]);
}
