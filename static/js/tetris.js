/* ============================================================
   tetris.js — phone-sized Tetris engine with passed-piece junk
   ============================================================ */

const COLS = 10;
const ROWS = 18;

// Tetromino definitions as rotation states (4x4 bit grids, SRS-ish)
const SHAPES = {
  I: [[1, 5, 9, 13], [4, 5, 6, 7]],
  J: [[0, 4, 5, 6], [1, 2, 5, 9], [4, 5, 6, 10], [1, 5, 8, 9]],
  L: [[2, 4, 5, 6], [1, 5, 9, 10], [4, 5, 6, 8], [0, 1, 5, 9]],
  O: [[1, 2, 5, 6]],
  S: [[1, 2, 4, 5], [0, 4, 5, 9]],
  T: [[1, 4, 5, 6], [1, 4, 5, 9], [4, 5, 6, 9], [1, 5, 6, 9]],
  Z: [[0, 1, 5, 6], [2, 5, 6, 9]],
};

const COLORS = {
  I: '#2dd4d4', J: '#3e8fff', L: '#f5a524', O: '#f2d94e',
  S: '#30a46c', T: '#8e4ec6', Z: '#e5484d', X: '#4a5168',
};

const PIECES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];

class Piece {
  constructor(type, heat = 0, from = null) {
    this.type = type;
    this.rot = 0;
    this.x = 3;
    this.y = -1;
    this.heat = heat;        // how many times this piece has been passed
    this.from = from;        // who passed it (null = from your own queue)
  }
  cells(rot = this.rot, x = this.x, y = this.y) {
    const states = SHAPES[this.type];
    const s = states[rot % states.length];
    return s.map(i => [x + (i % 4), y + Math.floor(i / 4)]);
  }
  clone() {
    const p = new Piece(this.type, this.heat, this.from);
    p.rot = this.rot; p.x = this.x; p.y = this.y;
    return p;
  }
}

class Tetris {
  constructor(canvas, hooks = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = hooks;
    this.reset();
    this.resize();
  }

  reset() {
    this.grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    this.bag = [];
    this.piece = null;
    this.next = this.pull();
    this.incoming = [];       // queue of passed-in pieces
    this.lines = 0;
    this.score = 0;
    this.alive = true;
    this.dropMs = 850;
    this.acc = 0;
    this.lockAcc = 0;
    this.locking = false;
    this.inverted = false;
    this.forging = false;
    this.forgeIdx = 0;
    this.mustPass = 0;        // Hot Hands charges
    this.noPass = false;      // Stuck With It
    this.shake = 0;
  }

  pull() {
    if (!this.bag.length) {
      this.bag = [...PIECES].sort(() => Math.random() - 0.5);
    }
    return this.bag.pop();
  }

  resize() {
    // Fit the board to the available space, keeping whole-pixel cells crisp.
    const wrap = this.cv.parentElement;
    const availW = wrap.clientWidth - 24;
    const availH = wrap.clientHeight - 24;
    const cell = Math.floor(Math.min(availW / COLS, availH / ROWS));
    this.cell = Math.max(12, cell);

    const dpr = window.devicePixelRatio || 1;
    const w = this.cell * COLS, h = this.cell * ROWS;
    this.cv.style.width = w + 'px';
    this.cv.style.height = h + 'px';
    this.cv.width = w * dpr;
    this.cv.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  spawn() {
    // Passed-in pieces jump the queue
    let p;
    if (this.incoming.length) {
      const inc = this.incoming.shift();
      p = new Piece(inc.piece, inc.heat, inc.from);
    } else {
      p = new Piece(this.next);
      this.next = this.pull();
    }
    this.piece = p;
    this.locking = false;
    this.lockAcc = 0;

    if (this.collides(p)) {
      this.alive = false;
      this.hooks.onTopOut && this.hooks.onTopOut();
    }
    this.hooks.onPiece && this.hooks.onPiece(p);
  }

  collides(p, rot = p.rot, x = p.x, y = p.y) {
    return p.cells(rot, x, y).some(([cx, cy]) =>
      cx < 0 || cx >= COLS || cy >= ROWS || (cy >= 0 && this.grid[cy][cx])
    );
  }

  move(dx) {
    if (!this.piece || !this.alive) return;
    const d = this.inverted ? -dx : dx;
    if (!this.collides(this.piece, this.piece.rot, this.piece.x + d, this.piece.y)) {
      this.piece.x += d;
      this.lockAcc = 0;
    }
  }

  rotate() {
    if (!this.piece || !this.alive) return;
    const states = SHAPES[this.piece.type].length;
    const nr = (this.piece.rot + 1) % states;
    // simple wall-kick: try in place, then shift 1 left/right, then 2
    for (const k of [0, -1, 1, -2, 2]) {
      if (!this.collides(this.piece, nr, this.piece.x + k, this.piece.y)) {
        this.piece.rot = nr;
        this.piece.x += k;
        this.lockAcc = 0;
        return;
      }
    }
  }

  softDrop() {
    if (!this.piece || !this.alive) return;
    if (!this.collides(this.piece, this.piece.rot, this.piece.x, this.piece.y + 1)) {
      this.piece.y++;
      this.score += 1;
    }
  }

  hardDrop() {
    if (!this.piece || !this.alive) return;
    if (this.mustPass > 0) {
      this.hooks.onBlocked && this.hooks.onBlocked('HOT HANDS — you must pass');
      return;
    }
    let d = 0;
    while (!this.collides(this.piece, this.piece.rot, this.piece.x, this.piece.y + 1)) {
      this.piece.y++; d++;
    }
    this.score += d * 2;
    this.shake = 7;
    this.lock();
  }

  lock() {
    const p = this.piece;
    if (!p) return;
    for (const [cx, cy] of p.cells()) {
      if (cy < 0) { this.alive = false; this.hooks.onTopOut && this.hooks.onTopOut(); return; }
      this.grid[cy][cx] = { type: p.type, heat: p.heat };
    }
    const cleared = this.clearLines();
    this.piece = null;
    this.noPass = false;
    this.hooks.onLock && this.hooks.onLock(cleared, this.score);
    this.spawn();
  }

  clearLines() {
    let n = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (this.grid[y].every(c => c)) {
        this.grid.splice(y, 1);
        this.grid.unshift(Array(COLS).fill(null));
        n++; y++;
      }
    }
    if (n) {
      this.lines += n;
      this.score += [0, 100, 300, 500, 800][n] || 800;
      this.dropMs = Math.max(240, 850 - this.lines * 14);
      this.shake = Math.min(14, 5 + n * 3);
    }
    return n;
  }

  /** A passed piece arrives. */
  receive(piece, heat, from) {
    this.incoming.push({ piece, heat, from });
    this.shake = 10;
  }

  /** Dump the current piece on someone else. Returns the piece data or null. */
  takeForPass() {
    if (!this.piece || !this.alive) return null;
    if (this.noPass) return null;
    const data = { piece: this.piece.type, heat: this.piece.heat };
    if (this.mustPass > 0) this.mustPass--;
    this.piece = null;
    this.spawn();
    return data;
  }

  /** Piece Forge: cycle the active piece type. */
  forgeCycle() {
    if (!this.piece) return;
    this.forgeIdx = (this.forgeIdx + 1) % PIECES.length;
    const t = PIECES[this.forgeIdx];
    const probe = new Piece(t, this.piece.heat, this.piece.from);
    probe.x = this.piece.x; probe.y = this.piece.y;
    if (!this.collides(probe)) {
      this.piece.type = t;
      this.piece.rot = 0;
    }
  }

  tick(dt) {
    if (!this.alive) return;
    if (!this.piece) { this.spawn(); return; }

    this.acc += dt;
    const grounded = this.collides(this.piece, this.piece.rot, this.piece.x, this.piece.y + 1);

    if (grounded) {
      this.lockAcc += dt;
      if (this.lockAcc > 480) this.lock();
    } else {
      this.lockAcc = 0;
      if (this.acc >= this.dropMs) {
        this.acc = 0;
        this.piece.y++;
      }
    }
    if (this.shake > 0) this.shake *= 0.86;
  }

  // ---------------- rendering ----------------

  draw() {
    const c = this.ctx, s = this.cell;
    const sx = this.shake > 0.4 ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake > 0.4 ? (Math.random() - 0.5) * this.shake : 0;

    c.save();
    c.translate(sx, sy);
    c.clearRect(-20, -20, COLS * s + 40, ROWS * s + 40);

    // grid lines
    c.strokeStyle = 'rgba(255,255,255,.035)';
    c.lineWidth = 1;
    for (let x = 1; x < COLS; x++) {
      c.beginPath(); c.moveTo(x * s + .5, 0); c.lineTo(x * s + .5, ROWS * s); c.stroke();
    }
    for (let y = 1; y < ROWS; y++) {
      c.beginPath(); c.moveTo(0, y * s + .5); c.lineTo(COLS * s, y * s + .5); c.stroke();
    }

    // settled blocks
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const cell = this.grid[y][x];
        if (cell) this.block(x, y, COLORS[cell.type], cell.heat);
      }
    }

    // ghost
    if (this.piece && this.alive) {
      let gy = this.piece.y;
      while (!this.collides(this.piece, this.piece.rot, this.piece.x, gy + 1)) gy++;
      c.globalAlpha = 0.17;
      for (const [cx, cy] of this.piece.cells(this.piece.rot, this.piece.x, gy)) {
        if (cy >= 0) this.block(cx, cy, COLORS[this.piece.type], 0, true);
      }
      c.globalAlpha = 1;

      for (const [cx, cy] of this.piece.cells()) {
        if (cy >= 0) this.block(cx, cy, COLORS[this.piece.type], this.piece.heat);
      }
    }

    c.restore();
  }

  /**
   * One block. Passed pieces get progressively messier: cracks, grime,
   * off-register edges — so a hot potato *looks* like a hot potato.
   */
  block(gx, gy, color, heat = 0, flat = false) {
    const c = this.ctx, s = this.cell;
    const x = gx * s, y = gy * s;
    const pad = 1;

    // jitter grows with heat — a well-travelled piece sits crooked
    const j = heat > 0 ? Math.min(2.2, heat * 0.55) : 0;
    const ox = j ? (((gx * 37 + gy * 17 + heat * 7) % 100) / 100 - 0.5) * j : 0;
    const oy = j ? (((gx * 13 + gy * 53 + heat * 3) % 100) / 100 - 0.5) * j : 0;

    c.save();
    c.translate(ox, oy);

    const w = s - pad * 2, h = s - pad * 2;
    const r = Math.max(2, s * 0.14);

    // body
    const g = c.createLinearGradient(x, y, x, y + s);
    if (heat > 0) {
      // desaturate + darken as heat climbs
      const t = Math.min(0.72, heat * 0.2);
      g.addColorStop(0, mix(color, '#3a3f52', t * 0.75));
      g.addColorStop(1, mix(color, '#1b1f2c', t));
    } else {
      g.addColorStop(0, color);
      g.addColorStop(1, shade(color, -0.3));
    }
    c.fillStyle = flat ? color : g;
    roundRect(c, x + pad, y + pad, w, h, r);
    c.fill();

    if (!flat) {
      // top highlight
      c.fillStyle = 'rgba(255,255,255,.17)';
      roundRect(c, x + pad + 1, y + pad + 1, w - 2, Math.max(2, h * 0.2), r * 0.7);
      c.fill();

      // grime for passed pieces
      if (heat > 0) {
        c.strokeStyle = `rgba(0,0,0,${Math.min(0.5, 0.16 + heat * 0.09)})`;
        c.lineWidth = Math.max(1, s * 0.055);
        c.beginPath();
        // deterministic crack path so it doesn't strobe between frames
        const seed = (gx * 91 + gy * 47 + heat * 13) % 4;
        const p = [
          [[0.22, 0.12], [0.44, 0.52], [0.3, 0.86]],
          [[0.78, 0.16], [0.52, 0.48], [0.7, 0.84]],
          [[0.16, 0.7], [0.5, 0.56], [0.86, 0.74]],
          [[0.3, 0.2], [0.62, 0.42], [0.46, 0.8]],
        ][seed];
        c.moveTo(x + p[0][0] * s, y + p[0][1] * s);
        c.lineTo(x + p[1][0] * s, y + p[1][1] * s);
        c.lineTo(x + p[2][0] * s, y + p[2][1] * s);
        c.stroke();

        // heat pips in the corner
        if (heat >= 2) {
          c.fillStyle = 'rgba(229,72,77,.9)';
          for (let i = 0; i < Math.min(3, heat - 1); i++) {
            c.beginPath();
            c.arc(x + s - 5 - i * 4.5, y + 5, 1.6, 0, Math.PI * 2);
            c.fill();
          }
        }
      }
    }
    c.restore();
  }

  drawNext(canvas) {
    const c = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const S = 13;
    canvas.width = 4 * S * dpr; canvas.height = 3 * S * dpr;
    canvas.style.width = 4 * S + 'px'; canvas.style.height = 3 * S + 'px';
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, 4 * S, 3 * S);

    const t = this.incoming.length ? this.incoming[0].piece : this.next;
    const hot = this.incoming.length > 0;
    const cells = SHAPES[t][0];
    c.fillStyle = hot ? '#8a4247' : COLORS[t];
    for (const i of cells) {
      const x = (i % 4) * S, y = Math.floor(i / 4) * S;
      roundRect(c, x + 1, y + 1, S - 2, S - 2, 2.5);
      c.fill();
    }
  }
}

// ---------------- helpers ----------------

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function hex2rgb(h) {
  h = h.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgb2hex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
function mix(a, b, t) {
  const A = hex2rgb(a), B = hex2rgb(b);
  return rgb2hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
function shade(h, t) {
  const [r, g, b] = hex2rgb(h);
  return t < 0 ? rgb2hex(r * (1 + t), g * (1 + t), b * (1 + t))
               : rgb2hex(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t);
}
