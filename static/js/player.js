/* ============================================================
   player.js — phone client state machine
   ============================================================ */

const $ = id => document.getElementById(id);

const STATE = {
  pid: localStorage.getItem('tc_pid') || null,
  name: '',
  role: null,
  roster: [],
  phase: 'lobby',
  round: 1,
  rounds: 3,
  card: null,
  cardExpires: 0,
  powerCountdown: 20,
  powerGap: 20,        // seconds between draws, sent by the server
  powerLeft: 3,        // draws remaining this round
  tracesLeft: 2,
  cleanLeft: 3,
  voteTarget: null,
  aiming: false,
  mode: 'tetris',
  score: 0,
  quizWired: false,
  avatar: localStorage.getItem('tc_avatar') || 'fox',
  dumpedOnMe: {},     // pid -> how many pieces they've visibly sent you
};

let ws = null, game = null, motion = new Motion();
let lastT = performance.now();
let endsAt = 0;

/* ---------------------------------------------------------- screens */
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
  $(id).classList.add('on');
  if (id === 's-game') requestAnimationFrame(() => game && game.resize());
}

function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-8px)';
    setTimeout(() => el.remove(), 320);
  }, 1900);
}

/* ---------------------------------------------------------- socket */
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    if (STATE.name) {
      send({ t: 'join', pid: STATE.pid, name: STATE.name, avatar: STATE.avatar });
    }
  };
  ws.onmessage = e => handle(JSON.parse(e.data));
  ws.onclose = () => {
    toast('RECONNECTING…', 'warn');
    setTimeout(connect, 1200);
  };
}
function send(o) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(o));
}

/* ---------------------------------------------------------- inbound */
function handle(m) {
  switch (m.t) {

    case 'joined':
      STATE.pid = m.pid;
      STATE.name = m.name;
      localStorage.setItem('tc_pid', m.pid);
      $('lobbyName').textContent = m.name + ', YOU\'RE IN';
      break;

    case 'state': {
      STATE.roster = m.players;
      STATE.round = m.round || 1;
      STATE.rounds = m.rounds;
      if (m.mode) STATE.mode = m.mode;
      const prev = STATE.phase;
      STATE.phase = m.phase;
      endsAt = performance.now() + (m.endsIn || 0) * 1000;

      if (m.phase !== 'round') {
        $('finalWarn').classList.remove('on');
        $('hudClock').style.color = '';
      }

      $('lobbyCount').textContent = m.players.length + ' player' + (m.players.length === 1 ? '' : 's');
      $('hudRound').textContent = `${STATE.round}/${STATE.rounds}`;
      $('qRound').textContent = `${STATE.round}/${STATE.rounds}`;

      if (m.phase === 'lobby' && prev !== 'lobby') show('s-lobby');
      if (m.phase === 'roles' && STATE.role) show('s-role');
      if (m.phase === 'round' && prev !== 'round') {
        startRound();
      }
      if (m.phase === 'discussion' && prev !== 'discussion') show('s-discuss');
      if (m.phase === 'vote' && prev !== 'vote') buildVote();
      if (m.phase === 'results') showResults(m);
      break;
    }

    case 'call':
      show('s-call');
      ring();
      break;

    case 'role':
      STATE.role = m;
      paintRole(m);
      break;

    case 'round_start':
      STATE.mode = m.mode || STATE.mode;
      startRound();
      break;

    case 'question':
      quizShowQuestion(m);
      show('s-quiz');
      break;

    case 'answer_result':
      quizResult(m);
      $('qScore').textContent = (STATE.score = (STATE.score || 0) + m.points);
      break;

    case 'burn':
      quizBurn(m.indices);
      break;

    case 'audit':
      quizAudit(m);
      break;

    case 'part':
      showPartPop(m);
      break;

    case 'fight_start':
      showHangar(m);
      setTimeout(startFight, 4000);
      break;

    case 'fight_me':
      fightMe(m);
      break;

    case 'fight_over':
      fightOver(m);
      break;

    case 'intermission':
      showIntermission(m);
      break;

    case 'round_end':
      toast(`ROUND ${m.round} OVER`, 'warn');
      $('finalWarn').classList.remove('on');
      $('hudClock').style.color = '';
      break;

    case 'power':
      applyCard(m.card);
      break;

    case 'power_timer':
      STATE.powerCountdown = m.next;
      if (m.gap) STATE.powerGap = m.gap;
      if (m.remaining !== undefined) STATE.powerLeft = m.remaining;
      break;

    case 'incoming':
      onIncoming(m);
      break;

    case 'absorbed':
      toast(`ABSORBED SILENTLY · ${m.left} LEFT`, 'good');
      break;

    case 'trace':
      if (m.origin) toast(`TRACE → ${m.origin}`, 'good');
      else toast('TRACE → NOTHING YET', 'warn');
      STATE.tracesLeft = m.left;
      $('btnTrace').querySelector('.c-sub').textContent = m.left + ' LEFT';
      break;

    case 'clean_left':
      STATE.cleanLeft = m.n;
      toast(`CLEAN PASS USED · ${m.n} LEFT`, 'good');
      break;

    case 'analyst':
      paintAnalyst(m.rows);
      break;

    case 'vote_start':
      buildVote(m.players);
      break;

    case 'to_lobby':
      STATE.role = null;
      STATE.dumpedOnMe = {};
      STATE.voteTarget = null;
      if (game) game.reset();
      $('dumpers').innerHTML = '';
      show('s-lobby');
      toast('BACK IN THE LOBBY', 'good');
      break;

    case 'toast':
      toast(m.text, m.kind);
      break;
  }
}

/* ---------------------------------------------------------- call */
function ring() {
  haptic(400);
  let n = 0;
  const iv = setInterval(() => {
    if (++n > 10 || STATE.phase !== 'calling') return clearInterval(iv);
    haptic(300);
  }, 1400);
}

function paintRole(m) {
  $('roleName').textContent = m.name;
  $('roleTagline').textContent = m.tagline;
  $('roleGoal').textContent = m.goal;
  const badge = $('roleBadge');
  badge.textContent = m.team === 'imposter' ? 'SECRET ROLE' : 'YOUR ROLE';
  badge.style.background = m.color + '22';
  badge.style.color = m.color;
  $('roleName').style.color = m.color;

  if (m.knows) {
    $('roleKnows').style.display = 'block';
    $('knowsLabel').textContent = m.knows.label;
    $('knowsName').textContent = m.knows.name;
  } else {
    $('roleKnows').style.display = 'none';
  }

  $('btnTrace').style.display = m.role === 'detective' ? '' : 'none';
  if (m.role !== 'detective') {
    document.querySelector('.controls').style.gridTemplateColumns = '1fr 1fr';
    $('btnPass').style.gridColumn = 'span 2';
  }
  show('s-role');
  haptic(60);
}

/* ---------------------------------------------------------- game */
function startRound() {
  startLoop();
  if (STATE.mode === 'quiz') {
    show('s-quiz');
    QUIZ.correctCount = 0;
    STATE.score = 0;
    $('qScore').textContent = '0';
    $('qStreak').textContent = '0';
    if (!STATE.quizWired) { wireQuizControls(); STATE.quizWired = true; }
    return;
  }
  show('s-game');
  if (!game) {
    game = new Tetris($('board'), {
      onLock: (cleared, score) => {
        $('hudScore').textContent = game.score;
        $('hudLines').textContent = game.lines;
        if (cleared) {
          toast(cleared === 4 ? 'TETRIS!' : `${cleared} LINE${cleared > 1 ? 'S' : ''}`, 'good');
          haptic(40);
        }
        send({ t: 'placed', lines: cleared, score: 0 });
        send({ t: 'score_sync', score: game.score, lines: game.lines });
      },
      onTopOut: () => {
        toast('TOPPED OUT', 'bad');
        send({ t: 'topout' });
        setTimeout(() => { game.reset(); send({ t: 'revive' }); }, 2200);
      },
      onBlocked: msg => toast(msg, 'bad'),
      onPiece: () => game.drawNext($('nextCv')),
    });
    wireControls();
  }
  game.reset();
  game.resize();
  game.spawn();
}

/* One render loop drives every mode, so it must start regardless of whether
   the Tetris engine was ever created. */
let loopRunning = false;
function startLoop() {
  if (loopRunning) return;
  loopRunning = true;
  lastT = performance.now();
  requestAnimationFrame(loop);
}

function loop() {
  const now = performance.now();
  const dt = Math.min(60, now - lastT);
  lastT = now;

  if (STATE.mode === 'quiz' && STATE.phase === 'round') {
    quizTick();
    const left = Math.max(0, (endsAt - now) / 1000);
    $('qClock').textContent = fmt(left);
    const urgent = left > 0 && left <= 10;
    $('finalWarn').classList.toggle('on', urgent);

    const t = STATE.powerCountdown;
    $('qPtNum').textContent = Math.ceil(t);
    const frac = Math.max(0, Math.min(1, 1 - (t / (STATE.powerGap || 20))));
    $('qPtFill').setAttribute('stroke-dashoffset', (97.4 * frac).toFixed(1));
    STATE.powerCountdown = Math.max(0, t - dt / 1000);

    if (STATE.card && STATE.cardExpires) {
      const rem = (STATE.cardExpires - now) / 1000;
      if (rem <= 0) clearCard();
      else $('qPsTimer').textContent = rem.toFixed(1) + 's';
    }
    if (STATE.aiming) updateAim();
  }

  if (game && STATE.phase === 'round' && STATE.mode !== 'quiz') {
    game.tick(dt);
    game.draw();

    const left = Math.max(0, (endsAt - now) / 1000);
    $('hudClock').textContent = fmt(left);

    // final-ten-seconds warning border
    const urgent = left > 0 && left <= 10;
    $('finalWarn').classList.toggle('on', urgent);
    $('hudClock').style.color = urgent ? 'var(--danger)' : '';
    if (urgent && Math.ceil(left) !== STATE.lastTick) {
      STATE.lastTick = Math.ceil(left);
      haptic(14);
    }

    // power countdown ring
    const t = STATE.powerCountdown;
    $('ptNum').textContent = Math.ceil(t);
    const frac = Math.max(0, Math.min(1, 1 - (t / (STATE.powerGap || 20))));
    $('ptFill').setAttribute('stroke-dashoffset', (97.4 * frac).toFixed(1));
    STATE.powerCountdown = Math.max(0, t - dt / 1000);

    // active card expiry
    if (STATE.card && STATE.cardExpires) {
      const rem = (STATE.cardExpires - now) / 1000;
      if (rem <= 0) clearCard();
      else $('psTimer').textContent = rem.toFixed(1) + 's';
    }

    if (STATE.aiming) updateAim();
    updateTiltMeter();
  }

  if (STATE.phase === 'fight') fightTick();
  if (STATE.phase === 'fight' && $('s-hangar').classList.contains('on')) {
    $('hangarClock').textContent =
      Math.max(0, Math.ceil((FIGHT.endsAt - now) / 1000));
  }

  if (STATE.phase === 'intermission') {
    $('interClock').textContent = Math.ceil(Math.max(0, (endsAt - now) / 1000));
  }
  if (STATE.phase === 'discussion') {
    $('discussClock').textContent = fmt(Math.max(0, (endsAt - now) / 1000));
  }
  if (STATE.phase === 'vote') {
    $('voteClock').textContent = fmt(Math.max(0, (endsAt - now) / 1000));
  }

  requestAnimationFrame(loop);
}

function fmt(s) {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

/* Live tilt readout. Makes a dead sensor obvious instead of silently broken. */
function updateTiltMeter(needleId = 'tbNeedle') {
  const n = $(needleId);
  if (!n) return;
  const live = motion.live;

  $('motionWarn') && $('motionWarn').classList.toggle('on', !live);

  if (!live) {
    n.style.left = '50%';
    n.className = 'tb-needle dead';
    return;
  }
  const t = motion.tiltRel;
  const pct = 50 + Math.max(-50, Math.min(50, t * 1.7));
  n.style.left = pct + '%';
  n.className = 'tb-needle' + (Math.abs(t) >= 8 ? ' active' : '');
}

/* ---------------------------------------------------------- controls */
function wireControls() {
  const tap = (el, fn) => {
    el.addEventListener('touchstart', e => { e.preventDefault(); fn(); haptic(12); }, { passive: false });
    el.addEventListener('click', e => { e.preventDefault(); fn(); });
  };

  tap($('btnRotate'), () => game.rotate());
  tap($('btnDrop'), () => game.hardDrop());
  tap($('btnPass'), () => openAim());
  tap($('btnTrace'), () => { if (STATE.tracesLeft > 0) send({ t: 'trace' }); });
  tap($('aimCancel'), () => closeAim());

  // Swipe controls are deliberately NOT bound. Moving the piece is tilt-only —
  // the buttons cover rotate/drop/pass for anyone whose sensors are refused.

  // tapping the warning re-requests motion permission
  $('motionWarn').addEventListener('click', async () => {
    const ok = await motion.request();
    toast(ok ? 'MOTION READY' : 'STILL BLOCKED — CHECK BROWSER SETTINGS',
          ok ? 'good' : 'bad');
    if (ok) motion.calibrateTilt();
  });

  // motion bindings
  motion.on.move = d => { if (STATE.phase === 'round' && !STATE.aiming) game.move(d); };
  motion.on.rotate = () => { if (STATE.phase === 'round' && !STATE.aiming) { game.rotate(); haptic(10); } };
  motion.on.drop = () => { if (STATE.phase === 'round' && !STATE.aiming) { game.hardDrop(); haptic(25); } };
  motion.on.flick = () => { if (STATE.phase === 'round' && !STATE.aiming) openAim(); };
  motion.on.shake = () => {
    if (STATE.phase !== 'round') return;
    if (STATE.card && STATE.card.id === 'forge') { game.forgeCycle(); haptic(12); return; }
    if (STATE.role && STATE.role.role === 'detective' && STATE.tracesLeft > 0) {
      send({ t: 'trace' }); haptic(60);
    }
  };

  window.addEventListener('resize', () => game && game.resize());
}

/* ---------------------------------------------------------- quiz input */
function wireQuizControls() {
  const tap = (el, fn) => {
    el.addEventListener('touchstart', e => { e.preventDefault(); fn(); }, { passive: false });
    el.addEventListener('click', e => { e.preventDefault(); fn(); });
  };

  document.querySelectorAll('#qGrid .q-opt').forEach(el => {
    tap(el, () => quizLockIn(parseInt(el.dataset.i, 10)));
  });

  tap($('qBtnPass'), () => openAim());
  tap($('qBtnAudit'), () => { if (QUIZ.auditsLeft > 0) send({ t: 'trace' }); });

  if (STATE.role && STATE.role.role !== 'detective') {
    $('qBtnAudit').style.display = 'none';
    $('qBtnPass').style.gridColumn = 'span 2';
  }

  // The Cheat passes with a doctor toggle.
  if (STATE.role && STATE.role.role === 'imposter') {
    $('qHint').innerHTML =
      'TILT TO AIM · TWIST TO LOCK · <b style="color:var(--danger)">PASS TO DOCTOR</b>';
  }

  // Motion for quiz mode. Aiming is read continuously in quizTick(); these
  // are the discrete gestures.
  motion.on.move = null;                     // tilt aims, it does not step
  motion.on.drop = null;
  motion.on.rotate = () => {                 // twist = lock in your answer
    if (STATE.phase === 'round' && !STATE.aiming) quizLockIn();
  };
  motion.on.flick = () => {                  // flick forward = pass it on
    if (STATE.phase === 'round' && !STATE.aiming) openAim();
  };
  motion.on.shake = () => {
    if (STATE.role && STATE.role.role === 'detective' && QUIZ.auditsLeft > 0) {
      send({ t: 'trace' });
    }
  };
}

/* ---------------------------------------------------------- aiming */
function openAim() {
  if (STATE.mode === 'quiz') {
    if (QUIZ.inst === null || QUIZ.locked) return;
    if (STATE.noPass) { toast('STUCK WITH IT — CAN\'T PASS', 'bad'); return; }
  } else {
    if (!game || !game.piece) return;
    if (game.noPass) { toast('STUCK WITH IT — CAN\'T PASS', 'bad'); return; }
  }
  STATE.aiming = true;
  $('aim').classList.add('on');
  motion.calibrate();

  const others = STATE.roster.filter(p => p.pid !== STATE.pid && p.alive);
  const ring = $('aimRing');
  ring.querySelectorAll('.aim-seat').forEach(e => e.remove());
  const n = others.length;
  others.forEach((p, i) => {
    const ang = (360 / n) * i - 90;
    const el = document.createElement('div');
    el.className = 'aim-seat';
    el.dataset.pid = p.pid;
    el.textContent = p.name.slice(0, 4);
    el.style.left = (50 + 38 * Math.cos(ang * Math.PI / 180)) + '%';
    el.style.top = (50 + 38 * Math.sin(ang * Math.PI / 180)) + '%';
    ring.appendChild(el);
  });

  const list = $('aimList');
  list.innerHTML = '';
  others.forEach(p => {
    const c = document.createElement('div');
    c.className = 'chip';
    c.textContent = p.name;
    c.onclick = () => doPass(p.pid);
    list.appendChild(c);
  });
}

function updateAim() {
  const others = STATE.roster.filter(p => p.pid !== STATE.pid && p.alive);
  if (!others.length) return;
  const h = motion.enabled ? motion.relativeHeading() : 0;
  document.querySelector('.aim-needle').style.transform =
    `translate(-50%,-100%) rotate(${h}deg)`;

  const n = others.length;
  let best = null, bestD = 999;
  others.forEach((p, i) => {
    const seatAng = (360 / n) * i;
    const d = Math.abs(((h - seatAng + 180) % 360) - 180);
    if (d < bestD) { bestD = d; best = p; }
  });
  $('aimName').textContent = best ? best.name : '—';
  document.querySelectorAll('.aim-seat').forEach(el =>
    el.classList.toggle('hot', best && el.dataset.pid === best.pid));
  STATE.aimTarget = best ? best.pid : null;
}

function closeAim() {
  STATE.aiming = false;
  $('aim').classList.remove('on');
}

function doPass(pid) {
  const isCheat = STATE.role && STATE.role.role === 'imposter' && STATE.cleanLeft > 0;

  if (STATE.mode === 'quiz') {
    if (QUIZ.inst === null) { closeAim(); return; }
    // The Cheat doctors the answer key on the way out.
    send({ t: 'pass', targetPid: pid, doctor: isCheat });
    closeAim();
    haptic(35);
    toast(isCheat ? 'PASSED — KEY SWAPPED' : 'PASSED', isCheat ? 'bad' : 'good');
    return;
  }

  const data = game.takeForPass();
  if (!data) { closeAim(); return; }
  send({ t: 'pass', targetPid: pid, piece: data.piece, heat: data.heat, clean: isCheat });
  closeAim();
  haptic(35);
  toast('PASSED', 'good');
}

// confirm an aimed pass with a second forward flick or a tap on the ring
$('aimRing') && $('aimRing').addEventListener('click', () => {
  if (STATE.aiming && STATE.aimTarget) doPass(STATE.aimTarget);
});

/* ---------------------------------------------------------- cards */
const ICONS = { forge: '⚒️', shield: '🪞', ghost: '👻', lock: '🔒', fire: '🔥', swirl: '🌀' };

function applyCard(card) {
  STATE.card = card;
  STATE.cardExpires = card.dur ? performance.now() + card.dur * 1000 : 0;
  STATE.powerCountdown = STATE.powerGap || 20;

  // reset modifiers, then apply (game is null in quiz mode)
  STATE.inverted = false;
  STATE.noPass = false;
  if (game) { game.inverted = false; game.noPass = false; }

  if (card.id === 'drunk') {
    STATE.inverted = true;
    if (game) game.inverted = true;
  }
  if (card.id === 'stuck') {
    STATE.noPass = true;
    if (game) game.noPass = true;
  }
  if (card.id === 'hothands' && game) game.mustPass = card.charges || 2;

  // big card flash
  $('pcIcon').textContent = ICONS[card.icon] || '⚡';
  $('pcKind').textContent = card.kind === 'power' ? 'POWER' : 'HANDICAP';
  $('pcKind').style.color = card.kind === 'power' ? 'var(--good)' : 'var(--danger)';
  $('pcName').textContent = card.name;
  $('pcDesc').textContent = card.desc;
  const pc = $('powerCard');
  pc.classList.add('show');
  setTimeout(() => pc.classList.remove('show'), 1500);

  // strip
  const dotCol = card.kind === 'power' ? 'var(--good)' : 'var(--danger)';
  ['psDot', 'qPsDot'].forEach(id => { if ($(id)) $(id).style.background = dotCol; });
  ['psName', 'qPsName'].forEach(id => { if ($(id)) $(id).textContent = card.name.toUpperCase(); });
  ['psTimer', 'qPsTimer'].forEach(id => { if ($(id)) $(id).textContent = card.dur ? card.dur + '.0s' : ''; });
  haptic(card.kind === 'power' ? 30 : [20, 50, 20]);
}

function clearCard() {
  STATE.card = null;
  STATE.cardExpires = 0;
  STATE.inverted = false;
  if (game) { game.inverted = false; }
  ['psDot', 'qPsDot'].forEach(id => { if ($(id)) $(id).style.background = 'var(--text-mute)'; });
  ['psName', 'qPsName'].forEach(id => { if ($(id)) $(id).textContent = 'NO CARD — NEXT DRAW SOON'; });
  ['psTimer', 'qPsTimer'].forEach(id => { if ($(id)) $(id).textContent = ''; });
}

/* ---------------------------------------------------------- incoming */
function onIncoming(m) {
  game.receive(m.piece, m.heat, m.from);
  game.drawNext($('nextCv'));
  haptic([30, 40, 30]);

  if (!m.silent) {
    $('flash').classList.add('on');
    setTimeout(() => $('flash').classList.remove('on'), 420);
    toast(`${m.from} PASSED YOU A ${m.piece}`, 'bad');
    if (m.fromPid) {
      STATE.dumpedOnMe[m.fromPid] = (STATE.dumpedOnMe[m.fromPid] || 0) + 1;
      renderDumpers();
    }
  }
  // a silent pass gets no flash, no toast and no tally entry — that is
  // exactly what Clean Pass and Free Pass are buying.
}

/**
 * Top strip: who has visibly dumped on you, and how many times.
 * DETECTIVE ONLY — handing everyone a running tally would give the Imposter
 * away without anyone having to deduce anything.
 */
function renderDumpers() {
  if (!STATE.role || STATE.role.role !== 'detective') {
    $('dumpers').innerHTML = '';
    return;
  }
  const others = STATE.roster.filter(p => p.pid !== STATE.pid);
  if (!others.length) { $('dumpers').innerHTML = ''; return; }
  const max = Math.max(1, ...Object.values(STATE.dumpedOnMe));
  $('dumpers').innerHTML = others.map(p => {
    const c = STATE.dumpedOnMe[p.pid] || 0;
    const hot = c > 0 && c >= max;
    return `<div class="dmp${hot ? ' hot' : ''}">
      ${avatarSVG(p.avatar || 'fox', 22, { bg: '#0b0d14' })}
      <span class="d-n">${p.name}</span>
      <span class="d-c">${c}</span>
    </div>`;
  }).join('');
}

/** Between-round break showing what the table saw everyone pass. */
function showIntermission(m) {
  $('interEyebrow').textContent = `ROUND ${m.round} COMPLETE`;
  $('interNext').textContent = m.last ? 'DISCUSSION NEXT' : 'NEXT ROUND STARTING';

  // Only the Detective gets the pass ledger. Everyone else sees lines cleared.
  const ledger = !!m.ledger;
  $('interTitle').textContent = ledger ? 'PASS LEDGER' : 'ROUND STANDINGS';
  $('interSub').textContent = ledger
    ? 'Passes the table saw. Yours alone — nobody else has this.'
    : 'Lines cleared this match.';
  $('interSub').style.color = ledger ? 'var(--violet)' : '';

  const val = s => ledger ? s.passes : s.lines;
  const max = Math.max(1, ...m.standings.map(val));
  $('interTally').innerHTML = m.standings.map((s, i) => `
    <div class="tally-row${s.name === STATE.name ? ' me' : ''}"
         style="animation-delay:${i * 55}ms">
      ${avatarSVG(s.avatar || 'fox', 28, { bg: '#0b0d14' })}
      <span class="t-n">${s.name}</span>
      <span class="t-bar">
        <span class="t-fill" style="width:${Math.round((val(s) / max) * 90)}px;
              background:${ledger ? 'var(--danger)' : 'var(--good)'}"></span>
        <span class="t-c">${val(s)}</span>
      </span>
    </div>`).join('');
  show('s-inter');
  haptic(30);
}

/* ---------------------------------------------------------- analyst */
function paintAnalyst(rows) {
  $('analystCard').style.display = 'block';
  $('analystRows').innerHTML = rows.map(r => `
    <div style="display:flex;align-items:center;gap:10px">
      <span style="font-size:14px;font-weight:700">${r.name}</span>
      <span style="margin-left:auto;font-family:var(--mono);font-size:14px;color:var(--text-dim)">~${r.count}</span>
    </div>`).join('');
}

/* ---------------------------------------------------------- vote */
function buildVote(players) {
  const list = (players || STATE.roster).filter(p => p.pid !== STATE.pid);
  $('voteGrid').innerHTML = '';
  list.forEach(p => {
    const row = document.createElement('div');
    row.className = 'vote-row';
    row.innerHTML = `
      ${avatarSVG(p.avatar || 'fox', 38, { bg: '#0b0d14' })}
      <span class="vr-name">${p.name}</span>
      <span class="vr-meta">${p.lines} lines</span>`;
    row.onclick = () => {
      STATE.voteTarget = p.pid;
      document.querySelectorAll('.vote-row').forEach(r => r.classList.remove('sel'));
      row.classList.add('sel');
      send({ t: 'vote', target: p.pid });
      haptic(25);
    };
    $('voteGrid').appendChild(row);
  });
  show('s-vote');
}

/* ---------------------------------------------------------- results */
function showResults(m) {
  const mine = STATE.role ? STATE.role.team : 'crew';
  $('dumpers').innerHTML = '';
  const won = m.winner === mine;
  $('resEyebrow').textContent = won ? 'YOU WIN' : 'YOU LOSE';
  $('resTitle').textContent = m.winner === 'imposter' ? 'IMPOSTER WINS' : 'CREW WINS';
  $('resTitle').style.color = won ? 'var(--good)' : 'var(--danger)';
  $('resReason').textContent = (m.reveal && m.reveal.reason) || '';
  show('s-results');
  haptic(won ? [40, 60, 40] : 200);
}

/* ---------------------------------------------------------- boot */
/* ---------------------------------------------------------- avatars */
function buildAvatarPicker() {
  const grid = $('avGrid');
  grid.innerHTML = AVATARS.map(a => `
    <div class="av-cell${a.id === STATE.avatar ? ' sel' : ''}" data-av="${a.id}">
      ${avatarSVG(a.id, 48, { bg: false })}
    </div>`).join('');
  grid.querySelectorAll('.av-cell').forEach(el => {
    el.onclick = () => {
      STATE.avatar = el.dataset.av;
      localStorage.setItem('tc_avatar', STATE.avatar);
      grid.querySelectorAll('.av-cell').forEach(c => c.classList.remove('sel'));
      el.classList.add('sel');
      haptic(12);
    };
  });
}
buildAvatarPicker();

$('joinBtn').onclick = () => {
  const inp = $('nameInput');
  const v = inp.value.trim();
  if (!v) { inp.focus(); return; }
  STATE.name = v.toUpperCase().slice(0, 14);

  // iOS "Shake to Undo" pops a system dialog when there's undoable typing in
  // the responder chain. We can't disable that feature from a web page, but we
  // can make sure there is nothing left to undo: blur, clear, and remove the
  // field entirely so shaking has no text edit to offer undoing.
  try {
    inp.blur();
    inp.value = '';
    inp.remove();
  } catch (e) {}
  if (document.activeElement && document.activeElement.blur) {
    document.activeElement.blur();
  }

  show('s-consent');
};
$('nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('joinBtn').click(); });

const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (IS_IOS) {
  const tip = $('iosTip');
  if (tip) tip.style.display = 'block';
}

$('allowBtn').onclick = async () => {
  const ok = await motion.request();
  if (!ok) {
    toast('MOTION DENIED — BUTTONS ONLY', 'warn');
    connect();
    show('s-lobby');
    return;
  }
  toast('MOTION READY', 'good');
  connect();
  show('s-calib');
  calibStart = performance.now();
  // if nothing arrives in 5s, open diagnostics automatically
  setTimeout(() => {
    if (!motion.live && $('s-calib').classList.contains('on')) {
      $('diagBox').classList.add('on');
      renderDiag();
    }
  }, 5000);
  calibLoop();
};
$('denyBtn').onclick = () => { connect(); show('s-lobby'); };

/* Calibration screen: show the live needle until they set a neutral point. */
let calibRAF = null, calibStart = 0;
function calibLoop() {
  updateTiltMeter('calibNeedle');
  if (motion.live) {
    $('calibStatus').textContent =
      `TILT: ${motion.tiltRel.toFixed(0)}°  —  move the phone to test`;
    $('calibBtn').textContent = 'SET THIS AS NEUTRAL';
  } else {
    const secs = Math.round((performance.now() - calibStart) / 1000);
    $('calibStatus').textContent = secs > 4
      ? 'NO SENSOR DATA — tap diagnostics below'
      : 'WAITING FOR SENSOR…';
    // never block the player: let them continue regardless
    $('calibBtn').textContent = 'CONTINUE ANYWAY';
  }
  $('calibBtn').disabled = false;
  if ($('diagBox').classList.contains('on')) renderDiag();
  if ($('s-calib').classList.contains('on')) {
    calibRAF = requestAnimationFrame(calibLoop);
  }
}

function renderDiag() {
  const d = motion.diag();
  const yn = v => v ? '<span class="ok">YES</span>' : '<span class="no">NO</span>';
  const n = v => (v === null || v === undefined) ? '<span class="no">null</span>'
                                                 : Number(v).toFixed(1);
  $('diagBox').innerHTML =
`HTTPS / secure page   ${yn(d.secure)}   (${d.proto})
iOS permission API    ${yn(d.needsPerm)}
permission granted    ${yn(d.granted)}
listeners attached    ${yn(d.attached)}

orientation events    ${d.orientEvents}
motion events         ${d.motionEvents}
ms since last data    ${d.sinceLast === null ? '<span class="no">never</span>' : d.sinceLast}

raw gamma (L/R tilt)  ${n(d.gamma)}
raw beta  (F/B tilt)  ${n(d.beta)}
raw alpha (compass)   ${n(d.alpha)}

${diagAdvice(d)}`;
}

function diagAdvice(d) {
  if (!d.secure) {
    return 'DIAGNOSIS: page is not HTTPS. iOS blocks motion\n' +
           'sensors entirely on http://. Run START-TUNNEL.bat\n' +
           'and join via the https:// address.';
  }
  if (d.needsPerm && !d.granted) {
    return 'DIAGNOSIS: iOS permission was not granted.\n' +
           'Reload the page and tap ALLOW on the prompt.';
  }
  if (d.orientEvents === 0 && d.motionEvents === 0) {
    return 'DIAGNOSIS: no sensor events at all. Likely a\n' +
           'desktop browser or a device with no gyroscope.\n' +
           'Use SKIP and play with the buttons.';
  }
  if (d.orientEvents === 0 && d.motionEvents > 0) {
    return 'DIAGNOSIS: no orientation events, but motion is\n' +
           'firing. Tilt is being derived from gravity instead.\n' +
           'Controls should still work.';
  }
  if (d.gamma === null) {
    return 'DIAGNOSIS: events firing but gamma is null.\n' +
           'Tilt is being derived from gravity instead.';
  }
  return 'DIAGNOSIS: sensors look healthy.';
}

$('calibBtn').onclick = () => {
  if (motion.live) {
    motion.calibrateTilt();
    toast('NEUTRAL SET', 'good');
  } else {
    toast('NO SENSOR — BUTTONS WILL WORK', 'warn');
  }
  if (calibRAF) cancelAnimationFrame(calibRAF);
  haptic(30);
  show('s-lobby');
};

$('calibSkip').onclick = () => {
  if (calibRAF) cancelAnimationFrame(calibRAF);
  toast('USING BUTTONS', 'warn');
  show('s-lobby');
};

$('diagBtn').onclick = () => {
  $('diagBox').classList.toggle('on');
  renderDiag();
};

// Reloading is the cleanest way back to the join screen: the name field was
// removed from the DOM on join (for iOS Shake-to-Undo), so rebuild the page.
$('changeBtn').onclick = () => location.reload();

startLoop();   // drives quiz, tetris and the dogfight alike

$('answerBtn').onclick = () => { send({ t: 'answer' }); haptic(40); };
$('declineBtn').onclick = () => toast('YOU HAVE TO ANSWER', 'warn');

// Resume a session if the phone locked mid-game
if (STATE.pid && localStorage.getItem('tc_name')) {
  STATE.name = localStorage.getItem('tc_name');
}
$('nameInput').addEventListener('input', e => localStorage.setItem('tc_name', e.target.value));

document.addEventListener('touchmove', e => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });
