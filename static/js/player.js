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
  avatar: localStorage.getItem('tc_avatar') || 'fox',
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
      if (m.ring) { STATE.ring = m.ring; renderNeighbours(); }
      STATE.round = m.round || 1;
      STATE.rounds = m.rounds;
      const prev = STATE.phase;
      STATE.phase = STATE.lobbyOnly && m.phase !== 'lobby' ? 'lobby' : m.phase;
      if (STATE.lobbyOnly && m.phase !== 'lobby') { show('s-lobby'); break; }
      if (m.phase === 'lobby') STATE.lobbyOnly = false;
      endsAt = performance.now() + (m.endsIn || 0) * 1000;

      if (m.phase !== 'round') {
        $('finalWarn').classList.remove('on');
      }

      $('lobbyCount').textContent = m.players.length + ' player' + (m.players.length === 1 ? '' : 's');
      $('qRound').textContent = `${STATE.round}/${STATE.rounds}`;

      if (m.phase === 'lobby' && prev !== 'lobby') show('s-lobby');
      if (m.phase === 'roles' && STATE.role) show('s-role');
      if (m.phase === 'round' && prev !== 'round') {
        startRound();
      }
      if (m.phase === 'discussion' && prev !== 'discussion') {
        show('s-discuss');
        buildTradePanel();
      }
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

    case 'strike_ready':
      STATE.strikes = m.n;
      $('qStrikeN').textContent = m.n + ' READY';
      $('qBtnStrike').classList.toggle('dis', m.n <= 0);
      if (m.n > 0) { toast('MISSILE EARNED — 3 IN A ROW', 'good'); haptic(30); }
      break;

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
      playerExitPending = false;
      cleanupMatchNavigation();
      STATE.lobbyOnly = false;
      STATE.role = null;
      STATE.voteTarget = null;
      show('s-lobby');
      toast('BACK IN THE LOBBY', 'good');
      break;

    case 'player_lobby':
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
    $('btnPass').style.gridColumn = 'span 2';
  }
  show('s-role');
  haptic(60);
}

/* ---------------------------------------------------------- round */
function startRound() {
  startLoop();
  show('s-quiz');
  QUIZ.correctCount = 0;
  STATE.score = 0;
  $('qScore').textContent = '0';
  $('qStreak').textContent = '0';
  if (!STATE.quizWired) { wireQuizControls(); wireNeighbours(); STATE.quizWired = true; }
  renderNeighbours();
  renderJetStrip();
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
  const now = performance.now();
  const dt = Math.min(60, now - lastT);
  lastT = now;

  if (STATE.phase === 'round') {
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
function wireQuizControls() {
  const tap = (el, fn) => {
    el.addEventListener('touchstart', e => { e.preventDefault(); fn(); }, { passive: false });
    el.addEventListener('click', e => { e.preventDefault(); fn(); });
  };

  document.querySelectorAll('#qGrid .q-opt').forEach(el => {
    tap(el, () => quizLockIn(parseInt(el.dataset.i, 10)));
  });

  tap($('qBtnPass'), () => openAim('pass'));
  tap($('qBtnStrike'), () => {
    if (STATE.strikes > 0) openAim('strike');
  });

  wireMotionWarn();

  // Motion for quiz mode. Aiming is read continuously in quizTick(); these
  // are the discrete gestures.
  motion.on.move = null;                     // tilt aims, it does not step
  motion.on.drop = null;
  motion.on.rotate = () => {                 // twist = lock in your answer
    if (STATE.phase === 'round' && !STATE.aiming) quizLockIn();
  };
  motion.on.flick = null;   // passing is left/right around the circle now
  // Shake hard = PANIC PASS: dumps the question on a random rival instantly.
  // Faster than aiming, but you don't get to choose who catches it.
  motion.on.shake = () => {
    if (STATE.phase !== 'round' || STATE.aiming) return;
    if (QUIZ.inst === null || QUIZ.locked) return;
    if (STATE.aimMode === 'pass' && STATE.noPass) {
    toast('LOCKED BAY — CAN\'T PASS', 'bad'); return;
  }
    const dir = Math.random() < 0.5 ? 'left' : 'right';
    if (STATE.mustPass > 0) STATE.mustPass--;
    send({ t: 'pass', dir });
    toast('PANIC PASS ' + dir.toUpperCase(), 'warn');
    haptic([25, 30, 25]);
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
