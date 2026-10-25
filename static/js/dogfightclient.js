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
function startFight() {
  FIGHT.on = true;
  FIGHT.steer = 0;
  FIGHT.throttle = 0.5;
  FIGHT.alive = true;
  if (!loopRunning) startLoop();
  if (motion.live) motion.calibrateTilt();
  show('s-fight');
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

  // horizon mirrors the bank so the control is readable
  const sky = $('hzSky');
  if (sky) {
    FIGHT.skyScroll = (FIGHT.skyScroll + (0.55 + FIGHT.throttle * 2.2)) % 240;
    const drift = FIGHT.steer * 18;
    sky.style.transform = `translate(${(drift * -0.35).toFixed(1)}px, ${(FIGHT.throttle * 7).toFixed(1)}px) rotate(${(-FIGHT.steer * 18).toFixed(1)}deg)`;
  }
  const tp = Math.round(FIGHT.throttle * 100);
  $('fThrottle').style.width = tp + '%';
  $('fThrottleV').textContent = tp + '%';
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

/**
 * Cockpit minimap: every jet as a blip, yours green and pointed, enemies
 * red. Coarse by design — it tells you where the fight is, not how to aim.
 */
function drawMinimap(blips, arena) {
  const cv = $('fMinimap');
  if (!cv || !blips) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);

  // arena is sent divided by 16 on the server side
  const AW = (arena ? arena[0] : 1600) / 16;
  const AH = (arena ? arena[1] : 900) / 16;
  const sx = w / AW, sy = h / AH;

  c.strokeStyle = 'rgba(48,163,108,.18)';
  c.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    c.beginPath(); c.moveTo((w / 4) * i, 0); c.lineTo((w / 4) * i, h); c.stroke();
  }
  c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();

  blips.forEach(b => {
    const x = b.x * sx, y = b.y * sy;
    const mine = b.p === STATE.pid;
    if (!b.a) {
      c.fillStyle = 'rgba(120,130,155,.45)';
      c.fillRect(x - 1.5, y - 1.5, 3, 3);
      return;
    }
    if (mine) {
      // yours is an arrow so you can read your own heading at a glance
      c.save();
      c.translate(x, y);
      c.rotate((b.h * 15 + 90) * Math.PI / 180);
      c.fillStyle = '#6ef0a8';
      c.beginPath();
      c.moveTo(0, -5); c.lineTo(3.5, 4); c.lineTo(-3.5, 4);
      c.closePath(); c.fill();
      c.restore();
    } else {
      c.fillStyle = '#ff6b70';
      c.fillRect(x - 2, y - 2, 4, 4);
    }
  });
}

function wrapDelta(d, size) {
  if (d > size / 2) return d - size;
  if (d < -size / 2) return d + size;
  return d;
}

function angleTo(a, b) {
  return ((b - a + 540) % 360) - 180;
}

function contactPlaneSVG() {
  return `<svg viewBox="0 0 52 34" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <rect x="24" y="2" width="4" height="28" fill="#ffd5d7"/>
    <rect x="22" y="0" width="8" height="6" fill="#fff0f1"/>
    <rect x="18" y="8" width="16" height="14" fill="#ff7f86"/>
    <rect x="9" y="13" width="13" height="6" fill="#ff6570"/>
    <rect x="30" y="13" width="13" height="6" fill="#ff6570"/>
    <rect x="4" y="11" width="5" height="10" fill="#ff4d5f"/>
    <rect x="43" y="11" width="5" height="10" fill="#ff4d5f"/>
    <rect x="18" y="24" width="6" height="7" fill="#ff6570"/>
    <rect x="28" y="24" width="6" height="7" fill="#ff6570"/>
    <rect x="23" y="10" width="6" height="7" fill="#ffe6e7" opacity=".9"/>
  </svg>`;
}

function contactArrowSVG(dir) {
  if (dir === 'left') {
    return `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
      <polygon points="3,14 23,3 23,25" fill="#ff5f69"/>
      <polygon points="7,14 21,6 21,22" fill="#ffd0d3" opacity=".6"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <polygon points="25,14 5,3 5,25" fill="#ff5f69"/>
    <polygon points="21,14 7,6 7,22" fill="#ffd0d3" opacity=".6"/>
  </svg>`;
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
      const h = Math.round(size * 0.64);
      const cls = e.pid === (lock && lock.pid) ? 'hz-contact plane assist' : 'hz-contact plane';
      return `<div class="${cls}" style="left:calc(${x}% - ${size / 2}px);top:${top}%;width:${size}px;height:${h}px">${contactPlaneSVG()}<span class="hz-target-label">${escapeTargetName(e.name)} · ${Math.round(Math.max(0, e.hp))} HP</span></div>`;
    }

    const side = e.rel < 0 ? 'left' : 'right';
    const lane = side === 'left' ? leftCount++ : rightCount++;
    const top = 12 + lane * 17 + pop * 22;
    const h = Math.round(size * 0.88);
    return `<div class="hz-contact tri ${side}" style="${side}:6px;top:${top}%;width:${size}px;height:${h}px">${contactArrowSVG(side)}<span class="hz-target-label ${side}">${escapeTargetName(e.name)} · ${Math.round(Math.max(0,e.hp))} HP</span></div>`;
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
  const idx = m.standings.findIndex(s => s.pid === STATE.pid);
  const me = m.standings[idx];
  $('resEyebrow').textContent = idx === 0 ? 'TOP GUN' : `PLACED #${idx + 1}`;
  $('resTitle').textContent = m.standings[0] ? m.standings[0].name + ' WINS' : '—';
  $('resTitle').style.color = idx === 0 ? 'var(--good)' : 'var(--text)';
  if (me) {
    const bounty = me.bountyKills
      ? ` (${me.bountyKills} on the Threat)` : '';
    $('resReason').innerHTML =
      `${me.kills} kill${me.kills === 1 ? '' : 's'}${bounty}, ` +
      `${me.deaths} loss${me.deaths === 1 ? '' : 'es'}.<br>` +
      `<span style="color:${me.agendaColor}">${me.agendaName}</span> — ` +
      `${me.agendaNote}, <b>+${me.bonus}</b>.<br>` +
      `<b style="font-size:20px">${me.final}</b> total`;
  }
  show('s-results');
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

function renderHot() {
  const bar = document.getElementById('hotbar');
  if (!bar) return;
  if (!HOT.crates.length) { bar.innerHTML = ''; return; }

  bar.innerHTML = HOT.crates.map(c => {
    const col = TIER_COLOR[c.tier] || TIER_COLOR.empty;
    const pct = Math.max(0, Math.min(1, c.left / 10)) * 100;
    const urgent = c.left <= 3.5;
    return `<div class="hot${urgent ? ' urgent' : ''}" data-cid="${c.cid}"
                 style="border-bottom-color:${col}">
      <span class="hot-passes">${c.passes ? '×' + c.passes : ''}</span>
      <div class="hot-top">
        ${partIconSVG(c.slot, c.tier, 22)}
        <div>
          <div class="hot-name">${c.name}</div>
          <div class="hot-tier" style="color:${col}">${TIER_LABEL[c.tier]}</div>
        </div>
      </div>
      <div class="hot-fuse"><i style="width:${pct}%"></i></div>
      <div class="hot-acts">
        <button class="claim" data-a="claim">CLAIM</button>
        <button class="shove" data-a="shove">SHOVE</button>
      </div>
    </div>`;
  }).join('');

  bar.querySelectorAll('.hot').forEach(el => {
    const cid = +el.dataset.cid;
    el.querySelectorAll('button').forEach(b => {
      b.onclick = e => {
        e.preventDefault();
        if (b.dataset.a === 'claim') {
          send({ t: 'claim_hot', cid });
          haptic(22);
        } else {
          armShove(cid);
        }
      };
    });
  });
}

/** Server pushes the full list whenever it changes. */
function hotUpdate(m) {
  HOT.crates = m.crates || [];
  renderHot();
}

/** Burn the fuses down locally between server pushes. */
function hotTick(dt) {
  if (!HOT.crates.length) return;
  let redraw = false;
  HOT.crates.forEach(c => {
    const was = c.left;
    c.left = Math.max(0, c.left - dt);
    if (Math.ceil(was * 2) !== Math.ceil(c.left * 2)) redraw = true;
  });
  if (redraw) renderHot();
}

function hotBlew(m) {
  if (m.loadout) { FIGHT.loadout = m.loadout.parts; renderJetStrip(); }
  toast(m.lost ? `CRATE BLEW — LOST ${m.lost.name}` : 'CRATE BLEW — NOTHING TO LOSE',
        'bad');
  haptic([50, 70, 50]);
}
