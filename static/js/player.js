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
  cleanLeft: 3,
  voteTarget: null,
  lobbyOnly: false,
  aiming: false,
  score: 0,
  quizWired: false,
  strikes: 0,
  aimMode: 'pass',
  ring: [],
  mustPass: 0,
  avatar: (localStorage.getItem('tc_avatar') === 'cat' ? 'bibble' : localStorage.getItem('tc_avatar')) || 'fox',
  rerollsLeft: 2,
  pendingInstall: null,
  passesUsed: 0,
};

let ws = null, motion = new Motion();
let lastT = performance.now();
let endsAt = 0;

/* ---------------------------------------------------------- screens */
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
  $(id).classList.add('on');
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
const ROOM = (new URLSearchParams(location.search).get('code') || '').toUpperCase();
if (!ROOM) location.replace('/');

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    if (STATE.name) {
      send({ t: 'join', code: ROOM, pid: STATE.pid,
             name: STATE.name, avatar: STATE.avatar });
    }
  };
  ws.onmessage = e => handle(JSON.parse(e.data));
  ws.onclose = () => {
    if (STATE.kicked) return;          // removed by the host: stay disconnected
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

    case 'kicked':
      // The host disconnected this phone. Stop reconnecting and go back to the
      // start screen; scanning the QR code again rejoins the lobby.
      STATE.kicked = true;
      try { localStorage.removeItem('tc_pid'); } catch (e) {}
      $('kickedNote').classList.add('on');
      setTimeout(() => location.replace('/'), 3500);
      break;

    case 'join_error':
      toast(m.reason, 'bad');
      setTimeout(() => location.replace('/'), 1800);
      break;

    case 'joined':
      STATE.pid = m.pid;
      STATE.name = m.name;
      localStorage.setItem('tc_pid', m.pid);
      $('lobbyName').textContent = m.name + ', YOU\'RE IN';
      break;

    case 'state': {
      STATE.roster = m.players;
      const mine = (m.players || []).find(p => p.pid === STATE.pid);
      if (mine) { STATE.passesUsed = mine.passesMade || 0; updatePassLabel(); }
      if (m.ring) {
        const was = JSON.stringify((STATE.ring || []).map(x => [x.pid, x.left, x.right, x.name]));
        STATE.ring = m.ring; renderNeighbours();
        if (was !== JSON.stringify(m.ring.map(x => [x.pid, x.left, x.right, x.name]))) renderHot();
      }
      STATE.round = m.round || 1;
      STATE.rounds = m.rounds;
      STATE.arcade = !!m.arcade;
      const prev = STATE.phase;
      STATE.phase = STATE.lobbyOnly && m.phase !== 'lobby' ? 'lobby' : m.phase;
      if (STATE.lobbyOnly && m.phase !== 'lobby') { show('s-lobby'); break; }
      if (m.phase === 'lobby') STATE.lobbyOnly = false;
      endsAt = performance.now() + (m.endsIn || 0) * 1000;

      if (m.phase !== 'round') {
        $('finalWarn').classList.remove('on');
      }

      $('lobbyCount').textContent = m.players.length + ' player' + (m.players.length === 1 ? '' : 's');
      if (m.phase === 'lobby') renderPlayerLobbyBoard(m.leaderboard && m.leaderboard.length ? m.leaderboard : m.players);
      $('qRound').textContent = `${STATE.round}/${STATE.rounds}`;

      if (m.phase === 'lobby' && prev !== 'lobby') show('s-lobby');
      if (m.phase === 'roles' && STATE.role) show('s-role');
      if (m.phase === 'round' && prev !== 'round') {
        startRound();
      }
      if (m.phase === 'discussion' && prev !== 'discussion') {
        show('s-discuss');
        renderDiscussionParts();
        buildTradePanel();
      }
      if (m.phase === 'vote' && prev !== 'vote') buildVote();
      if (m.phase === 'results') showResults(m);
      break;
    }

    case 'phase_brief':
      showPhaseBrief(m);
      break;

    case 'phase_ready_count':
      if (m.briefId === BRIEF.id)
        $('briefReadyCount').textContent = `${m.ready} / ${m.total} PILOTS READY`;
      break;

    case 'phase_brief_end':
      if (m.briefId === BRIEF.id) {
        BRIEF.id = null;
        clearInterval(BRIEF.timer);
      }
      break;

    case 'call':
      show('s-call');
      ring();
      break;

    case 'role':
      STATE.role = m;
      paintRole(m);
      break;

    case 'round_start':
      if (m.arcade !== undefined) STATE.arcade = !!m.arcade;
      STATE.rerollsLeft = 2;
      STATE.pendingInstall = null;
      installStop();
      hideInstallPrompt();
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

    case 'strike_ready': {
      STATE.strikes = m.n;
      const need = m.need || 3, have = m.progress || 0;
      $('qStrikeN').textContent = m.n > 0 ? 'READY' : `${have} / ${need} CORRECT`;
      $('qStrikeHint').textContent = m.n > 0 ? 'PUSH PHONE FORWARD OR TAP'
        : `${need - have} MORE RIGHT ANSWER${need - have === 1 ? '' : 'S'}`;
      $('qBtnStrike').classList.toggle('dis', m.n <= 0);
      $('qBtnStrike').classList.toggle('armed', m.n > 0);
      $('qStrikePips').innerHTML = Array.from({ length: need }, (_, i) =>
        `<i class="${m.n > 0 || i < have ? 'on' : ''}"></i>`).join('');
      if (m.earned) { toast('MISSILE LOADED — PUSH PHONE FORWARD', 'good'); haptic(30); }
      break;
    }

    case 'hot':
      hotUpdate(m);
      break;

    case 'hot_blew':
      hotBlew(m);
      break;

    case 'minigame':
      mgStart(m.kind, m);
      break;

    case 'minigame_over':
      mgOver(m);
      break;

    case 'part_pending':
      STATE.pendingInstall = m.token;
      showInstallPrompt(m.part);
      installStart();
      break;

    case 'part_installed':
      if (STATE.pendingInstall === m.token) STATE.pendingInstall = null;
      installGlow();
      setTimeout(() => { installStop(); hideInstallPrompt(); }, 850);
      if (STATE.arcade && STATE.phase === 'round') {
        $('mgTitle').textContent = 'PART FITTED';
        $('mgTitle').style.color = 'var(--good)';
        $('mgSub').textContent = 'HOLD THE PHONE UPRIGHT — NEXT LEVEL INCOMING';
      }
      break;

    case 'reroll_used':
      STATE.rerollsLeft = m.left;
      toast('REROLL USED · ' + m.left + ' LEFT', 'good');
      break;

    case 'part':
      showPartPop(m);
      break;

    case 'crates':
      setCrates(m.n);
      break;

    case 'crate_open':
      showCrateOpen(m);
      break;

    case 'rusted':
      showRusted(m);
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
      // a game still animating when the round clock ran out is void
      if (MG.raf) cancelAnimationFrame(MG.raf);
      MG.active = null; MG.done = true;
      showIntermission(m);
      break;

    case 'round_end':
      toast(`ROUND ${m.round} OVER`, 'warn');
      $('finalWarn').classList.remove('on');
      if ($('hudClock')) $('hudClock').style.color = '';
      break;

    case 'power':
      applyCard(m.card);
      break;

    case 'power_timer':
      STATE.powerCountdown = m.next;
      if (m.gap) STATE.powerGap = m.gap;
      if (m.remaining !== undefined) STATE.powerLeft = m.remaining;
      break;

    case 'absorbed':
      toast(`ABSORBED SILENTLY · ${m.left} LEFT`, 'good');
      break;

    case 'trace':
      if (m.origin) toast(`TRACE → ${m.origin}`, 'good');
      else toast('TRACE → NOTHING YET', 'warn');
      break;

    case 'clean_left':
      STATE.cleanLeft = m.n;
      toast(`CLEAN PASS USED · ${m.n} LEFT`, 'good');
      break;

    case 'analyst':
      paintAnalyst(m.rows);
      break;

    case 'vote_start':
      buildVote(m.players, m.kind);
      break;

    case 'marked':
      toast('YOU ARE THE THREAT', 'bad');
      haptic([40, 60, 40]);
      STATE.marked = m;
      break;

    case 'threat':
      showThreat(m);
      break;

    case 'traded':
      showTraded(m);
      break;

    case 'to_lobby':
      if (MG.raf) cancelAnimationFrame(MG.raf);
      MG.active = null; MG.done = true;
      stopFight();
      clearTimeout(FIGHT.popTimer);
      clearTimeout(QUIZ.lockTimer);
      clearTimeout(QUIZ.blindTimer);
      QUIZ.inst = null; QUIZ.locked = true;
      STATE.aiming = false;
      breakAimOnLobby();
      playerExitPending = false;
      cleanupMatchNavigation();
      STATE.lobbyOnly = false;
      STATE.role = null;
      STATE.pendingInstall = null;
      hideInstallPrompt();
      STATE.voteTarget = null;
      show('s-lobby');
      toast('BACK IN THE LOBBY', 'good');
      break;

    case 'player_lobby':
      renderPlayerLobbyBoard(m.leaderboard && m.leaderboard.length ? m.leaderboard : m.players);
      STATE.pendingInstall = null;
      hideInstallPrompt();
      playerExitPending = false;
      cleanupMatchNavigation();
      STATE.lobbyOnly = true;
      STATE.phase = 'lobby';
      show('s-lobby');
      break;

    case 'toast':
      toast(m.text, m.kind);
      break;
  }
}

const BRIEF = { id: null, timer: null, deadline: 0 };
const INSTALL = { active: false, progress: 0, base: null, sent: false };
const INSTALL_DEG = 50;     // how far to turn the phone to fit a part
const BRIEF_INFO = {
  quiz: ['ANSWER · PASS · BUILD',
    ['TAP to answer · SHAKE to reroll (2 per round)',
     'SLIDE LEFT / RIGHT to pass · ROTATE 50° to install a part',
     'Any 3 RIGHT answers load a MISSILE · PUSH FORWARD to fire']],
  discussion: ['DISCUSS',
    ['Talk with the other pilots', 'Compare who passed to whom',
     'Keep the phone upright; no gestures required']],
  vote: ['VOTE',
    ['TAP a pilot to mark the threat', 'No phone motion needed for voting']],
  dogfight: ['DOGFIGHT',
    ['BANK phone LEFT / RIGHT to steer', 'TILT forward / back for throttle',
     'HOLD FIRE for guns']],
  arcade: ['ARCADE',
    ['TILT to fly — every game is about 5 seconds',
     'CLEAR a level to earn a part · ROTATE the phone 50° to fit it',
     'Part you can\'t use? CLAIM it or SHOVE it ◀ ▶ for a tier bump']]
};
function showPhaseBrief(m) {
  BRIEF.id = m.briefId;
  BRIEF.deadline = performance.now() + m.seconds * 1000;
  const info = BRIEF_INFO[m.stage] || BRIEF_INFO.quiz;
  $('briefTitle').textContent = info[0];
  $('briefControls').innerHTML = '';
  info[1].forEach((line, i) => {
    const el = document.createElement('div');
    el.className = 'brief-line';
    const num = document.createElement('span');
    num.className = 'brief-num'; num.textContent = String(i + 1).padStart(2, '0');
    const label = document.createElement('span');
    label.textContent = line;
    el.append(num, label);
    $('briefControls').appendChild(el);
  });
  $('briefReadyCount').textContent = 'WAITING FOR PILOTS';
  const btn = $('briefReadyBtn');
  btn.disabled = false;
  btn.textContent = 'READY';
  btn.onclick = () => {
    if (btn.disabled || BRIEF.id !== m.briefId) return;
    btn.disabled = true;
    btn.textContent = 'READY ✓';
    send({ t: 'brief_ready', briefId: m.briefId });
  };
  clearInterval(BRIEF.timer);
  function tick() {
    $('briefClock').textContent = Math.ceil(Math.max(0,
      (BRIEF.deadline - performance.now()) / 1000));
  }
  tick();
  BRIEF.timer = setInterval(tick, 100);
  show('s-phase-brief');
}

function installRender() {
  const pct = Math.min(1, INSTALL.progress / INSTALL_DEG);
  $('installTurnFill').style.width = Math.round(pct * 100) + '%';
  $('installTurnNeed').textContent = INSTALL.sent ? 'FITTING…' :
    `TURN ${Math.max(0, Math.ceil(INSTALL_DEG - INSTALL.progress))}° TO FIT`;
  $('installWheel').style.transform = `rotate(${Math.round(INSTALL.progress)}deg)`;
}
function installStart() {
  INSTALL.active = true;
  INSTALL.sent = false;
  INSTALL.progress = 0;
  INSTALL.base = null;
  $('installPrompt').classList.remove('fitted');
  installRender();
}
function installStop() {
  INSTALL.active = false;
  INSTALL.sent = false;
  INSTALL.progress = 0;
  INSTALL.base = null;
}
function installGlow() {
  $('installTurnFill').style.width = '100%';
  $('installTurnNeed').textContent = 'PART FITTED!';
  $('installPrompt').classList.add('fitted');
}
function installOrientation(e) {
  if (!INSTALL.active || INSTALL.sent || STATE.pendingInstall == null) return;
  if (!Number.isFinite(e.gamma) || !Number.isFinite(e.beta)) return;
  // The prompt starts while the phone is upright. Compare its angle to
  // the original portrait orientation rather than accumulating rotation rate.
  if (INSTALL.base === null) INSTALL.base = {g: e.gamma, b: e.beta};
  const g = Math.abs(e.gamma - INSTALL.base.g);
  const b = Math.abs(e.beta - INSTALL.base.b);
  INSTALL.progress = Math.min(INSTALL_DEG, Math.max(g, b));
  installRender();
  if (INSTALL.progress >= INSTALL_DEG) {
    INSTALL.progress = INSTALL_DEG;
    INSTALL.sent = true;
    installRender();
    send({t:'install_part',token:STATE.pendingInstall});
    haptic([25,40,25]);
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

  STATE.role = m;
  if (m.knows) {
    $('roleKnows').style.display = 'block';
    $('knowsLabel').textContent = m.knows.label;
    $('knowsName').textContent = m.knows.name;
  } else {
    $('roleKnows').style.display = 'none';
  }

  if (m.role !== 'detective') {
    document.querySelector('.controls').style.gridTemplateColumns = '1fr 1fr';
    if ($('btnPass')) $('btnPass').style.gridColumn = 'span 2';
  }
  show('s-role');
  haptic(60);
}

/* ---------------------------------------------------------- round */
function startRound() {
  startLoop();
  if (!STATE.quizWired) { wireQuizControls(); wireNeighbours(); STATE.quizWired = true; }
  renderJetStrip();
  renderHot();

  if (STATE.arcade) {
    // Arcade has no question screen. Stand by on the game screen until the
    // server deals the first level, which lands within a beat.
    const cv = $('mgCanvas');
    if (cv) { const c = cv.getContext('2d'); c.clearRect(0, 0, cv.width, cv.height); }
    $('mgTitle').textContent = 'GET READY';
    $('mgTitle').style.color = 'var(--accent)';
    $('mgSub').textContent = 'FIRST LEVEL INCOMING';
    $('mgResult').innerHTML = '';
    $('mgScore').textContent = STATE.score || 0;
    mgSetLevelChip(1);
    show('s-minigame');
    return;
  }

  show('s-quiz');
  QUIZ.correctCount = 0;
  STATE.score = 0;
  $('qScore').textContent = '0';
  $('qStreak').textContent = '0';
  renderNeighbours();
}

/* One render loop drives the quiz and the dogfight alike. */
let loopRunning = false;
function startLoop() {
  if (loopRunning) return;
  loopRunning = true;
  lastT = performance.now();
  requestAnimationFrame(loop);
}

function loop() {
  if (FIGHT.on) { fightTick(); drawCanopy(); }
  const now = performance.now();
  const dt = Math.min(60, now - lastT);
  lastT = now;

  if (STATE.phase === 'round') {
    hotTick(dt / 1000);
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

function updateAxisMeter(needleId, valueId, degrees) {
  const needle = $(needleId);
  if (!needle) return;
  if (!motion.live || !Number.isFinite(degrees)) {
    needle.style.left = '50%';
    needle.className = 'tb-needle dead';
    $(valueId).textContent = 'NO DATA';
    return;
  }
  needle.style.left = (50 + Math.max(-50, Math.min(50, degrees * 1.7))) + '%';
  needle.className = 'tb-needle' + (Math.abs(degrees) >= 8 ? ' active' : '');
  $(valueId).textContent = degrees.toFixed(0) + '°';
}

/* ---------------------------------------------------------- controls */
/* The motion-permission warning is the only shared control left; everything
   else lives in the quiz or the dogfight. */
function wireMotionWarn() {
  const w = $('motionWarn');
  if (!w || w.dataset.wired) return;
  w.dataset.wired = '1';
  w.addEventListener('click', async () => {
    const ok = await motion.request();
    toast(ok ? 'MOTION READY' : 'STILL BLOCKED — CHECK BROWSER SETTINGS',
          ok ? 'good' : 'bad');
    if (ok) motion.calibrateTilt();
  });
}

/* ---------------------------------------------------------- quiz input */
function updatePassLabel() {
  const hint = $('nbHint');
  if (hint) hint.textContent = STATE.passesUsed >= 3 ? 'PASS LIMIT REACHED (3/3)' : `PASS LEFT / RIGHT · ${3 - STATE.passesUsed} LEFT`;
}
function canPass() {
  if (STATE.passesUsed >= 3) { toast('3 QUESTION PASSES USED', 'warn'); return false; }
  return true;
}

function launchQuizMissile() {
  if (STATE.phase !== 'round' || STATE.strikes <= 0 || MG.active || STATE.aiming) return;
  send({ t: 'strike' });
  toast('MISSILE REQUESTED', 'good');
  haptic([35, 45, 35]);
}

function wireQuizControls() {
  const tap = (el, fn) => {
    if (!el) return;
    el.addEventListener('touchstart', e => { e.preventDefault(); fn(); }, { passive: false });
    el.addEventListener('click', e => { e.preventDefault(); fn(); });
  };

  document.querySelectorAll('#qGrid .q-opt').forEach(el => {
    tap(el, () => quizLockIn(parseInt(el.dataset.i, 10)));
  });

  tap($('qBtnPass'), () => openAim('pass'));
  tap($('qBtnStrike'), () => launchQuizMissile());

  wireMotionWarn();

  // Quiz answers are taps only. No twisting, tilting or shaking selects answers.
  motion.on.move = null;
  motion.on.drop = null;
  motion.on.rotate = null;
  motion.on.installOrientation = installOrientation;
  motion.on.flick = () => launchQuizMissile();
  motion.on.shake = () => {
    if (STATE.phase !== 'round' || STATE.aiming || !QUIZ.inst || QUIZ.locked || MG.active) return;
    if (STATE.rerollsLeft <= 0) { toast('NO REROLLS LEFT', 'warn'); return; }
    QUIZ.locked = true;
    send({ t: 'reroll', inst: QUIZ.inst });
    toast('REROLL REQUESTED', 'good');
    haptic([25, 45, 25]);
  };
  motion.on.lateral = dir => {
    if (STATE.phase !== 'round' || STATE.aiming || !QUIZ.inst || QUIZ.locked || MG.active) return;
    if (!canPass()) return;
    if (STATE.noPass) { toast('LOCKED BAY — CAN\'T PASS', 'bad'); return; }
    const seat = myRingSeat();
    if (!seat || !seat[dir]) return;
    if (STATE.mustPass > 0) STATE.mustPass--;
    // Lock input until the server sends the next question.
    QUIZ.locked = true;
    send({ t: 'pass', dir });
    toast('PASSED ' + dir.toUpperCase(), 'good');
    haptic(35);
  };
}

/* ------------------------------------------------------- the circle */
function myRingSeat() {
  return (STATE.ring || []).find(x => x.pid === STATE.pid) || null;
}

function renderNeighbours() {
  const me = myRingSeat();
  if (!me) return;
  const byPid = Object.fromEntries((STATE.ring || []).map(x => [x.pid, x]));
  const L = byPid[me.left], R = byPid[me.right];

  if (L) {
    $('nbLeftAv').innerHTML = avatarSVG(L.avatar || 'fox', 26, { bg: '#0b0d14' });
    $('nbLeftName').textContent = L.name;
  }
  if (R) {
    $('nbRightAv').innerHTML = avatarSVG(R.avatar || 'fox', 26, { bg: '#0b0d14' });
    $('nbRightName').textContent = R.name;
  }
  // with only two players both sides are the same person; say so
  $('nbHint').textContent = (L && R && L.pid === R.pid)
    ? 'ONLY ' + L.name + ' TO PASS TO'
    : (STATE.shoveCid != null ? 'SHOVE THE CRATE LEFT OR RIGHT'
                              : 'PASS LEFT OR RIGHT');
}

function wireNeighbours() {
  ['nbLeft', 'nbRight'].forEach(id => {
    const el = $(id);
    const go = e => {
      e.preventDefault();
      const dir = el.dataset.dir;
      if (STATE.shoveCid != null) {
        send({ t: 'pass_hot', cid: STATE.shoveCid, dir });
        STATE.shoveCid = null;
        disarmShove();
        toast('SHOVED IT ' + dir.toUpperCase(), 'warn');
        haptic(30);
        return;
      }
      if (QUIZ.inst === null || QUIZ.locked) return;
      if (STATE.noPass) { toast('LOCKED BAY — CAN\'T PASS', 'bad'); return; }
      if (STATE.mustPass > 0) STATE.mustPass--;
      send({ t: 'pass', dir });
      toast('PASSED ' + dir.toUpperCase(), 'good');
      haptic(28);
    };
    el.addEventListener('touchstart', go, { passive: false });
    el.addEventListener('click', go);
  });
}

function armShove(cid) {
  STATE.shoveCid = cid;
  $('nbLeft').classList.add('armed');
  $('nbRight').classList.add('armed');
  renderNeighbours();
  toast('PICK A DIRECTION', 'warn');
}

function disarmShove() {
  STATE.shoveCid = null;
  $('nbLeft').classList.remove('armed');
  $('nbRight').classList.remove('armed');
  renderNeighbours();
}

/* ---------------------------------------------------------- aiming */
function openAim(mode) {
  STATE.aimMode = mode || 'pass';
  if (STATE.aimMode === 'pass' && (QUIZ.inst === null || QUIZ.locked)) return;
  if (STATE.aimMode === 'pass' && !canPass()) return;
  if (STATE.aimMode === 'hot' && HOT.shoving == null) return;
  if (STATE.aimMode === 'pass' && STATE.noPass) {
    toast('LOCKED BAY — CAN\'T PASS', 'bad'); return;
  }
  STATE.aiming = true;
  $('aim').classList.add('on');
  document.querySelector('.aim-title').textContent =
    STATE.aimMode === 'strike' ? 'PICK A TARGET FOR THE MISSILE'
    : STATE.aimMode === 'hot' ? 'WHO CATCHES THE LIVE CRATE?'
    : 'POINT YOUR PHONE AT A PLAYER';
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
  if (STATE.aimMode === 'hot') {
    if (HOT.shoving != null) send({ t: 'pass_hot', cid: HOT.shoving, targetPid: pid });
    HOT.shoving = null;
    closeAim();
    haptic(30);
    toast('SHOVED IT ON', 'warn');
    return;
  }
  if (STATE.aimMode === 'strike') {
    send({ t: 'strike', targetPid: pid });
    closeAim();
    haptic(35);
    return;
  }
  if (QUIZ.inst === null) { closeAim(); return; }
  if (STATE.mustPass > 0) {
    STATE.mustPass--;
    if (STATE.mustPass === 0) toast('HOT HANDS SPENT', 'good');
  }
  if (!canPass()) return;
  send({ t: 'pass', targetPid: pid });
  closeAim();
  haptic(35);
  toast('PASSED IT ON', 'good');
}

// confirm an aimed pass with a second forward flick or a tap on the ring
$('aimRing') && $('aimRing').addEventListener('click', () => {
  if (STATE.aiming && STATE.aimTarget) doPass(STATE.aimTarget);
});

/* ---------------------------------------------------------- cards */
const ICONS = { forge: '⚒️', shield: '🪞', ghost: '👻', lock: '🔒', fire: '🔥', swirl: '🌀',
                crate: '📦', split: '✂️', wind: '💨', rust: '🪨', eye: '🕶️' };

function applyCard(card) {
  STATE.card = card;
  STATE.cardExpires = card.dur ? performance.now() + card.dur * 1000 : 0;
  STATE.powerCountdown = STATE.powerGap || 20;

  // reset modifiers, then apply (game is null in quiz mode)
  STATE.inverted = false;
  STATE.noPass = false;

  if (card.id === 'drunk') {
    STATE.inverted = true;
  }
  if (card.id === 'stuck' || card.id === 'locked') {
    STATE.noPass = true;
  }
  if (card.id === 'hothands') STATE.mustPass = card.charges || 2;
  if (card.id !== 'hothands' && card.kind === 'handicap') STATE.mustPass = 0;
  if (card.id === 'blindspot') quizBlindSpot(3000);

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
  ['psDot', 'qPsDot'].forEach(id => { if ($(id)) $(id).style.background = 'var(--text-mute)'; });
  ['psName', 'qPsName'].forEach(id => { if ($(id)) $(id).textContent = 'NO CARD — NEXT DRAW SOON'; });
  ['psTimer', 'qPsTimer'].forEach(id => { if ($(id)) $(id).textContent = ''; });
}

/** Between-round break showing what the table saw everyone pass. */
function showIntermission(m) {
  $('interEyebrow').textContent = `ROUND ${m.round} COMPLETE`;
  $('interNext').textContent = m.last ? 'DISCUSSION NEXT' : 'NEXT ROUND STARTING';

  // Arcade ranks by how high each pilot climbed; the quiz by jet rating.
  const arcade = !!m.arcade;
  $('interTitle').textContent = arcade ? 'LADDER STANDINGS' : 'ROUND STANDINGS';
  $('interSub').textContent = arcade
    ? 'Level reached on the arcade ladder.'
    : 'Jet rating — what you would fly right now.';
  $('interSub').style.color = '';

  const val = s => arcade ? (s.level || 1) : (s.rating || 0);
  if (arcade) m.standings.sort((a, b) => (b.level || 1) - (a.level || 1));
  const max = Math.max(1, ...m.standings.map(val));
  $('interTally').innerHTML = m.standings.map((s, i) => `
    <div class="tally-row${s.name === STATE.name ? ' me' : ''}"
         style="animation-delay:${i * 55}ms">
      ${avatarSVG(s.avatar || 'fox', 28, { bg: '#0b0d14' })}
      <span class="t-n">${s.name}</span>
      <span class="t-bar">
        <span class="t-fill" style="width:${Math.round((val(s) / max) * 90)}px;
              background:${arcade ? 'var(--warn)' : 'var(--good)'}"></span>
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
function playerPartSummary(p) {
  const parts = p.loadout && p.loadout.parts || {};
  const labels = { engine: 'ENG', wings: 'WING', armor: 'ARM', guns: 'GUN', missiles: 'RACK' };
  return Object.entries(parts).filter(([s, v]) => !!v).map(([s, v]) =>
    `${labels[s] || s.toUpperCase()}: ${v.name || 'FITTED'}`).join(' · ') || 'NO PARTS';
}

function renderDiscussionParts() {
  const el = $('discussionParts');
  if (!el) return;
  el.innerHTML = '<div class="eyebrow">AIRCRAFT LOADOUTS</div>' +
    STATE.roster.map(p => `<div class="pr-entry"><b>${escapePartText(p.name)}</b><span>${escapePartText(playerPartSummary(p))}</span></div>`).join('');
}
function escapePartText(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function buildVote(players, kind) {
  const threat = (kind || STATE.voteKind) === 'threat';
  STATE.voteKind = kind || STATE.voteKind;
  if (threat) {
    document.querySelector('#s-vote h2').textContent = 'Who is the biggest threat?';
    document.querySelector('#s-vote .eyebrow').textContent = 'THREAT VOTE';
    document.querySelector('#s-vote .vote-sub').innerHTML =
      'Whoever the table marks flies with a <b>3× bounty</b> on them — ' +
      'and an afterburner to survive it.';
  }
  const list = (players || STATE.roster).filter(p => p.pid !== STATE.pid);
  $('voteGrid').innerHTML = '';
  list.forEach(p => {
    const row = document.createElement('div');
    row.className = 'vote-row';
    row.innerHTML = `
      ${avatarSVG(p.avatar || 'fox', 38, { bg: '#0b0d14' })}
      <span class="vr-name">${p.name}</span>
      <span class="vr-meta">${p.lines || p.score || 0} points<br><small>${escapePartText(playerPartSummary(p))}</small></span>`;
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
  // The old crew/imposter verdict is gone; the results phase shows the same
  // podium the dogfight ended on. Only redraw if we are not already there.
  if ($('s-results').classList.contains('on') && $('resPodium').children.length) return;
  showPodium(m.fightStandings || []);
}

/* ---------------------------------------------------------- boot */
/* ---------------------------------------------------------- avatars */
function renderPlayerLobbyBoard(players) {
  const el = $('playerLobbyRanks');
  if (!el) return;
  const sorted = [...(players || [])].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  el.innerHTML = sorted.length ? sorted.map((p, i) => `<div class="lobby-rank${p.pid === STATE.pid ? ' is-you' : ''}">
    <span class="lobby-rank-no">${String(i + 1).padStart(2, '0')}</span>
    ${avatarSVG(p.avatar || 'fox', 26, {bg: '#0b0d14'})}
    <span class="lobby-rank-name"></span><span class="lobby-rank-pts">${Number(p.score) || 0} PTS</span>
  </div>`).join('') : '<div class="lobby-board-empty">NO SCORES YET</div>';
  el.querySelectorAll('.lobby-rank-name').forEach((name, i) => { name.textContent = sorted[i].name; });
}

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
  updateAxisMeter('calibBetaNeedle', 'axisBetaValue', motion.pitchRel);
  const yaw = ((motion.heading - motion.headingOffset + 540) % 360) - 180;
  updateAxisMeter('calibAlphaNeedle', 'axisAlphaValue', yaw);
  $('axisGammaValue').textContent = motion.live ? motion.tiltRel.toFixed(0) + '°' : 'NO DATA';
  if (motion.live) {
    $('calibStatus').textContent =
      'LIVE MOTION — MOVE THE PHONE TO TEST ALL THREE AXES';
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

startLoop();   // drives the quiz and the dogfight alike

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

// Match cleanup is independent of DOM styling.
function cleanupMatchNavigation() {
  if (typeof stopFight === 'function') stopFight();
  if (typeof MG !== 'undefined') {
    MG.done = true; MG.active = null;
    cancelAnimationFrame(MG.raf);
  }
  if (typeof QUIZ !== 'undefined') {
    clearTimeout(QUIZ.lockTimer);
    clearTimeout(QUIZ.blindTimer);
    QUIZ.inst = null;
    QUIZ.locked = true;
  }
  STATE.aiming = false;
  STATE.card = null;
  STATE.strikes = 0;
  const aim = document.getElementById('aim');
  if (aim) aim.classList.remove('on');
  const warn = document.getElementById('finalWarn');
  if (warn) warn.classList.remove('on');
  const popup = document.getElementById('partPop');
  if (popup) popup.classList.remove('show');
}
let playerExitPending = false;
function playerReturnLobby() {
  if (playerExitPending) return;
  if (STATE.phase !== 'lobby' &&
      !window.confirm('Return to lobby? Your current match will end.')) return;
  if (STATE.phase === 'lobby') { show('s-lobby'); return; }
  playerExitPending = true;
  send({ t: 'return_lobby' });
}
const playerLogo = document.querySelector('.logo-mark');
if (playerLogo) {
  playerLogo.style.cursor = 'pointer';
  playerLogo.setAttribute('role', 'button');
  playerLogo.setAttribute('tabindex', '0');
  playerLogo.setAttribute('aria-label', 'Return to lobby');
  playerLogo.onclick = playerReturnLobby;
  playerLogo.onkeydown = e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playerReturnLobby(); }
  };
}

function breakAimOnLobby() { const el = document.getElementById('aim'); if (el) el.classList.remove('on'); }

/* ---------------------------------------------------------- how to play */
/* Rules open in a sheet over the lobby rather than navigating away: leaving
   the page would close the socket and drop this phone out of the room. */
(function wireHelp() {
  const btn = document.getElementById('helpBtn');
  const sheet = document.getElementById('helpModal');
  if (!btn || !sheet) return;
  btn.onclick = () => {
    const f = document.getElementById('helpFrame');
    if (!f.src) f.src = '/rules?embed=1';
    sheet.classList.add('on');
  };
  document.getElementById('helpClose').onclick = () => sheet.classList.remove('on');
})();
