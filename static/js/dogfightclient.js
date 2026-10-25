/* ============================================================
   dogfightclient.js — hangar, cockpit and flight controls

   Controls, all motion:
     bank the phone left/right   -> turn
     pitch it forward/back       -> throttle
     GUNS button (hold)          -> fire
     MISSILE button (tap)        -> launch
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
  FIGHT.alive = true;
  show('s-fight');
  wireFightControls();

  // stream control input at a steady 20 Hz rather than on every sensor event
  clearInterval(FIGHT.sendTimer);
  FIGHT.sendTimer = setInterval(() => {
    if (!FIGHT.on) return;
    send({ t: 'ctl', steer: +FIGHT.steer.toFixed(3),
           throttle: +FIGHT.throttle.toFixed(3), fire: FIGHT.firing });
  }, 50);
}

function stopFight() {
  FIGHT.on = false;
  FIGHT.firing = false;
  clearInterval(FIGHT.sendTimer);
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
  }

  // horizon mirrors the bank so the control is readable
  $('hzSky').style.transform = `rotate(${(-FIGHT.steer * 32).toFixed(1)}deg)`;
  const tp = Math.round(FIGHT.throttle * 100);
  $('fThrottle').style.width = tp + '%';
  $('fThrottleV').textContent = tp + '%';

  const left = Math.max(0, (FIGHT.endsAt - performance.now()) / 1000);
  $('fClock').textContent = fmt(left);
}

/** Server tells us how our own jet is doing. */
function fightMe(m) {
  const me = m.me;
  FIGHT.missiles = me.missiles;
  FIGHT.endsAt = performance.now() + m.left * 1000;

  const pct = Math.max(0, me.hp / me.maxHp) * 100;
  const fill = $('fHpFill');
  fill.style.width = pct + '%';
  fill.className = 'hp-fill' + (pct < 25 ? ' crit' : pct < 55 ? ' warn' : '');
  $('fHpText').textContent = Math.round(me.hp);
  $('fKills').textContent = me.kills;
  $('fMissiles').textContent = me.missiles;
  $('fMslCount').textContent = me.missiles + ' LEFT';
  $('fMissile').classList.toggle('dis', me.missiles <= 0 || me.failed.includes('missiles'));
  $('fGuns').classList.toggle('dis', me.failed.includes('guns'));

  // a sabotaged part giving out, announced on your own phone
  if (me.failed.length) {
    const names = { engine: 'ENGINE FLAMEOUT', guns: 'GUNS JAMMED',
                    missiles: 'MISSILE RACK DEAD', wings: 'CONTROL SURFACE TORN',
                    armor: 'ARMOUR SHEARED' };
    $('fStatus').textContent = me.failed.map(s => names[s] || s).join(' · ');
  }

  if (me.alive !== FIGHT.alive) {
    FIGHT.alive = me.alive;
    $('fDead').classList.toggle('on', !me.alive);
    if (!me.alive) haptic([40, 60, 40]);
  }

  (m.events || []).forEach(e => {
    if (e.kind === 'kill' && e.victimPid === STATE.pid) {
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

  const fire = e => {
    e.preventDefault();
    if (FIGHT.missiles > 0) { send({ t: 'missile' }); haptic(35); }
  };
  $('fMissile').addEventListener('touchstart', fire, { passive: false });
  $('fMissile').addEventListener('click', fire);
}
