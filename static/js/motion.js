/* ============================================================
   motion.js — permissions, filtering, gesture detection
   ============================================================ */

class Motion {
  constructor() {
    this.granted = false;
    this.tilt = 0;          // smoothed gamma, degrees
    this.pitch = 0;         // smoothed beta
    this.heading = 0;       // compass heading, degrees
    this.headingOffset = 0; // set at calibration

    this.tiltOffset = 0;    // neutral point, set by calibrateTilt()
    this.pitchOffset = 0;
    this.lastEventAt = 0;   // so the UI can tell if data is actually arriving
    this.eventCount = 0;

    this._tiltRaw = 0;
    this._lastMoveAt = 0;
    this._lastRotAt = 0;
    this._lastFlickAt = 0;
    this._lastShakeAt = 0;
    this._shakeEnergy = 0;

    this.on = {
      move: null,      // (dir) => {}   dir = -1 | +1
      rotate: null,    // () => {}
      drop: null,      // () => {}
      flick: null,     // (heading) => {}   forward flick = pass
      shake: null,     // (energy) => {}
    };

    this.enabled = false;
  }

  get supported() {
    return typeof DeviceMotionEvent !== 'undefined' ||
           typeof DeviceOrientationEvent !== 'undefined';
  }

  /** Must be called from inside a real user gesture (a tap). */
  async request() {
    let ok = true;
    try {
      if (typeof DeviceMotionEvent !== 'undefined' &&
          typeof DeviceMotionEvent.requestPermission === 'function') {
        const r = await DeviceMotionEvent.requestPermission();
        ok = ok && r === 'granted';
      }
      if (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();
        ok = ok && r === 'granted';
      }
    } catch (e) {
      ok = false;
    }
    this.granted = ok;
    if (ok) this.attach();
    return ok;
  }

  attach() {
    if (this._attached) return;
    this._attached = true;
    // `deviceorientationabsolute` is what Chrome on Android fires when the
    // plain event stays silent, so listen for both.
    window.addEventListener('deviceorientation', e => this.onOrient(e), true);
    window.addEventListener('deviceorientationabsolute', e => this.onOrient(e), true);
    window.addEventListener('devicemotion', e => this.onMotion(e), true);
    this.enabled = true;
  }

  /** Raw counters for the on-screen diagnostics panel. */
  diag() {
    return {
      secure: window.isSecureContext,
      proto: location.protocol,
      needsPerm: typeof DeviceOrientationEvent !== 'undefined' &&
                 typeof DeviceOrientationEvent.requestPermission === 'function',
      granted: this.granted,
      attached: !!this._attached,
      orientEvents: this.eventCount,
      motionEvents: this._motionCount || 0,
      gamma: this._rawG, beta: this._rawB, alpha: this._rawA,
      sinceLast: this.lastEventAt ? Math.round(performance.now() - this.lastEventAt) : null,
    };
  }

  calibrate() {
    this.headingOffset = this.heading;
  }

  /** Whatever angle they're holding the phone at right now becomes "flat". */
  calibrateTilt() {
    this.tiltOffset = this.tilt;
    this.pitchOffset = this.pitch;
  }

  /** Left/right tilt relative to the calibrated neutral point. */
  get tiltRel() {
    return this.tilt - this.tiltOffset;
  }

  /** Forward/back tilt relative to neutral — the second axis for quiz aiming. */
  get pitchRel() {
    return this.pitch - (this.pitchOffset || 0);
  }

  /** True if usable tilt data has arrived recently, from either source. */
  get live() {
    return this.lastEventAt > 0 && (performance.now() - this.lastEventAt) < 2000;
  }

  relativeHeading() {
    return ((this.heading - this.headingOffset) % 360 + 360) % 360;
  }

  onOrient(e) {
    // gamma: left/right tilt. beta: front/back tilt.
    this._rawG = e.gamma; this._rawB = e.beta; this._rawA = e.alpha;
    if (e.gamma === null && e.beta === null && e.alpha === null) return;
    this.lastEventAt = performance.now();
    this.eventCount++;

    const g = e.gamma ?? 0;
    const b = e.beta ?? 0;

    // low-pass so the piece doesn't jitter
    this.tilt = this.tilt * 0.78 + g * 0.22;
    this.pitch = this.pitch * 0.78 + b * 0.22;

    if (typeof e.webkitCompassHeading === 'number') {
      this.heading = e.webkitCompassHeading;          // iOS, true heading
    } else if (typeof e.alpha === 'number') {
      this.heading = (360 - e.alpha) % 360;           // Android
    }

    this.pollTilt();
  }

  /** Tilt past a threshold repeats a move, like a key held down. */
  pollTilt() {
    if (!this.on.move) return;
    const now = performance.now();
    const t = this.tiltRel;
    const DEAD = 8;       // degrees of slack so a resting hand does nothing
    const FAST = 22;      // past this, repeat quickly

    if (Math.abs(t) < DEAD) { this._lastMoveAt = 0; return; }

    const interval = Math.abs(t) > FAST ? 95 : 185;
    if (now - this._lastMoveAt > interval) {
      this._lastMoveAt = now;
      this.on.move(t > 0 ? 1 : -1);
    }
  }

  onMotion(e) {
    const now = performance.now();
    this._motionCount = (this._motionCount || 0) + 1;
    const rr = e.rotationRate || {};

    // Some devices fire devicemotion but never deviceorientation. Derive tilt
    // from gravity so the controls still work instead of sitting dead.
    const grav = e.accelerationIncludingGravity;
    if (grav && this.eventCount === 0 && grav.x != null) {
      const g = Math.max(-9.81, Math.min(9.81, grav.x));
      const deg = -Math.asin(g / 9.81) * 180 / Math.PI;
      this.tilt = this.tilt * 0.8 + deg * 0.2;
      this.lastEventAt = now;
      this._derivedTilt = true;
      this.pollTilt();
    }

    // Many Android browsers expose `acceleration` but leave its axes null.
    // Fall back to accelerationIncludingGravity and strip gravity with a
    // running average, otherwise every reading sits ~9.8 off and nothing fires.
    let acc = e.acceleration;
    if (!acc || (acc.x == null && acc.y == null && acc.z == null)) {
      const g = e.accelerationIncludingGravity;
      if (!g) return;
      this._g = this._g || { x: 0, y: 0, z: 0 };
      this._g.x = this._g.x * 0.9 + (g.x ?? 0) * 0.1;
      this._g.y = this._g.y * 0.9 + (g.y ?? 0) * 0.1;
      this._g.z = this._g.z * 0.9 + (g.z ?? 0) * 0.1;
      acc = {
        x: (g.x ?? 0) - this._g.x,
        y: (g.y ?? 0) - this._g.y,
        z: (g.z ?? 0) - this._g.z,
      };
    }
    this.lastEventAt = now;

    // --- TWIST TO ROTATE -------------------------------------------------
    // rotationRate.alpha is spin about the screen-normal axis.
    const twist = Math.abs(rr.alpha ?? 0);
    if (twist > 140 && now - this._lastRotAt > 300) {
      this._lastRotAt = now;
      this.on.rotate && this.on.rotate();
    }

    // --- FLICK DOWN TO HARD DROP ----------------------------------------
    // Sharp downward jolt along the screen's Y axis.
    const ay = acc.y ?? 0;
    if (ay < -11 && now - this._lastFlickAt > 400) {
      this._lastFlickAt = now;
      this.on.drop && this.on.drop();
    }

    // --- FLICK FORWARD TO PASS ------------------------------------------
    // Push the phone away from you: spike along Z.
    const az = acc.z ?? 0;
    if (az > 10 && now - this._lastFlickAt > 400) {
      this._lastFlickAt = now;
      this.on.flick && this.on.flick(this.relativeHeading());
    }

    // --- SHAKE ------------------------------------------------------------
    const mag = Math.hypot(acc.x ?? 0, acc.y ?? 0, acc.z ?? 0);
    this._shakeEnergy = this._shakeEnergy * 0.88 + mag * 0.12;
    if (this._shakeEnergy > 11 && now - this._lastShakeAt > 650) {
      this._lastShakeAt = now;
      this.on.shake && this.on.shake(this._shakeEnergy);
    }
  }
}

function haptic(ms = 18) {
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} }
}
