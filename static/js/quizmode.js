/* ============================================================
   quizmode.js — question UI and two-axis tilt answering
   ============================================================ */

const QUIZ = {
  inst: null,
  options: [],
  deadline: 0,
  seconds: 0,
  aim: -1,
  locking: -1,
  lockTimer: null,
  locked: false,
  burned: [],        // indices removed by the 50/50 power
  correctCount: 0,
  auditsLeft: 2,
  doctorsLeft: 3,
};

/* Quadrant layout: tilt the phone toward the answer you want.
      gamma (left/right)  ->  column
      beta  (fwd/back)    ->  row
   0 1
   2 3                                                        */
function tiltToQuadrant(tiltX, tiltY) {
  const DEAD = 7;
  if (STATE.inverted) { tiltX = -tiltX; tiltY = -tiltY; }   // Drunk Tilt
  if (Math.abs(tiltX) < DEAD && Math.abs(tiltY) < DEAD) return -1;
  const col = tiltX > 0 ? 1 : 0;
  const row = tiltY > 0 ? 1 : 0;
  return row * 2 + col;
}

function quizShowQuestion(m) {
  QUIZ.inst = m.inst;
  QUIZ.options = m.options;
  QUIZ.seconds = m.seconds;
  QUIZ.deadline = performance.now() + m.seconds * 1000;
  QUIZ.aim = -1;
  QUIZ.locking = -1;
  QUIZ.locked = false;
  QUIZ.burned = [];
  clearTimeout(QUIZ.lockTimer);

  $('qText').textContent = m.q;

  const cells = document.querySelectorAll('#qGrid .q-opt');
  cells.forEach((el, i) => {
    el.className = 'q-opt';
    el.querySelector('.q-label').textContent = m.options[i] || '';
  });

  // heat / provenance
  $('qHeat').textContent = m.heat > 0 ? `HEAT ${m.heat}` : '';
  $('qFrom').textContent = m.from ? `FROM ${m.from}` : (m.heat > 0 ? 'FROM ???' : 'FRESH');
  $('qMult').textContent = m.multiplier > 1 ? `×${m.multiplier}` : '';

  $('qTimerFill').style.width = '100%';
  $('qTimerFill').className = 'q-timer-fill';

  if (m.passed) {
    haptic([30, 40, 30]);
    toast(m.from ? `${m.from} PASSED YOU THIS` : 'A QUESTION LANDED ON YOU', 'bad');
  }
}

function quizTick() {
  if (!QUIZ.inst || QUIZ.locked) return;
  const left = Math.max(0, QUIZ.deadline - performance.now());
  const frac = left / (QUIZ.seconds * 1000);
  const fill = $('qTimerFill');
  fill.style.width = (frac * 100).toFixed(1) + '%';
  fill.className = 'q-timer-fill' +
    (frac < 0.22 ? ' crit' : frac < 0.5 ? ' warn' : '');

  // tilt aiming
  if (motion.live) {
    const q = tiltToQuadrant(motion.tiltRel, motion.pitchRel);
    if (q !== QUIZ.aim) {
      QUIZ.aim = q;
      cancelLock();
      document.querySelectorAll('#qGrid .q-opt').forEach((el, i) => {
        el.classList.toggle('aim', i === q && !QUIZ.burned.includes(i));
      });
      if (q >= 0) haptic(8);
    }
  }
}

function cancelLock() {
  clearTimeout(QUIZ.lockTimer);
  QUIZ.lockTimer = null;
  QUIZ.locking = -1;
  document.querySelectorAll('#qGrid .q-opt').forEach(el =>
    el.classList.remove('locking'));
}

/** Twist the phone (or tap) to commit to the aimed answer. */
function quizLockIn(idx) {
  if (QUIZ.locked || QUIZ.inst === null) return;
  if (idx === undefined) idx = QUIZ.aim;
  if (idx < 0 || QUIZ.burned.includes(idx)) return;

  QUIZ.locked = true;
  cancelLock();
  document.querySelectorAll('#qGrid .q-opt').forEach((el, i) =>
    el.classList.toggle('aim', i === idx));
  haptic(30);
  // "quiz_answer", not "answer" — "answer" is for picking up the phone call.
  send({ t: 'quiz_answer', inst: QUIZ.inst, choice: idx });
}

function quizResult(m) {
  const cells = document.querySelectorAll('#qGrid .q-opt');
  cells.forEach((el, i) => {
    el.classList.remove('aim', 'locking');
    if (i === m.correctIndex) el.classList.add('right');
    else el.classList.add('dimmed');
  });

  const f = $('qFlash');
  if (m.correct) {
    QUIZ.correctCount++;
    f.textContent = `+${m.points}`;
    f.style.color = 'var(--good)';
    haptic(40);
  } else {
    f.textContent = m.timedOut ? 'TOO SLOW' : `${m.points}`;
    f.style.color = 'var(--danger)';
    haptic([25, 50, 25]);
  }
  f.classList.remove('on');
  void f.offsetWidth;          // restart the animation
  f.classList.add('on');

  $('qStreak').textContent = QUIZ.correctCount;
  QUIZ.inst = null;
  QUIZ.locked = true;
}

function quizAudit(m) {
  const card = $('auditCard');
  if (!m.info) {
    $('auditVerdict').textContent = 'NOTHING YET';
    $('auditDetail').textContent =
      'No question has been passed to you, so there is nothing to inspect.';
  } else {
    const bad = m.info.doctored;
    $('auditVerdict').textContent = bad ? 'TAMPERED WITH' : 'CLEAN';
    $('auditVerdict').style.color = bad ? 'var(--danger)' : 'var(--good)';
    $('auditDetail').innerHTML = bad
      ? `The answer key on <b>"${m.info.q}"</b> was swapped before it reached
         you. It came from <b>${m.info.from || 'an unknown hand'}</b> after
         ${m.info.hops} hop${m.info.hops === 1 ? '' : 's'}.`
      : `<b>"${m.info.q}"</b> was untouched. It came from
         <b>${m.info.from || 'the deck'}</b>. That does not clear them of
         everything else.`;
  }
  card.classList.add('show');
  setTimeout(() => card.classList.remove('show'), 5200);
  QUIZ.auditsLeft = m.left;
  $('qBtnAudit').querySelector('.c-sub').textContent = m.left + ' LEFT';
  haptic(50);
}

/** 50/50 power: burn two wrong options. Server-free — purely visual aid is
    not possible here (we don't know the answer), so the server tells us. */
function quizBurn(indices) {
  QUIZ.burned = indices;
  document.querySelectorAll('#qGrid .q-opt').forEach((el, i) => {
    if (indices.includes(i)) el.classList.add('burned');
  });
}
