/* ============================================================
   skyfield.js — the animated pixel backdrop.

   Parallax starfield, drifting pixel clouds, jets crossing with
   contrails and exhaust flicker, the odd missile, and a vapour-cone
   flyby at Mach 2. Shared by the home screen and the waiting room.
   ============================================================ */

(function (global) {

  const PAL = {
    star:    ['#2a3148', '#49536f', '#8793b0', '#d6ddf0'],
    cloud:   ['#141a28', '#1b2233', '#232c42'],
    jet:     ['#7d879c', '#9aa6c0', '#c3cde4'],
    accent:  ['#3e8fff', '#30a46c', '#f5a524', '#e5484d', '#8e4ec6'],
    flame:   ['#f5a524', '#ff7a3d', '#e5484d'],
    trail:   'rgba(195,205,228,',
  };

  // top-down-ish side profile, 11x7, facing right
  const JET = [
    '....XX.....',
    '...XXXX....',
    'XXXXXXXXXX.',
    '.XXXXXXXXXX',
    'XXXXXXXXXX.',
    '...XXXX....',
    '....XX.....',
  ];

  const CLOUD = [
    '..XXXX..',
    '.XXXXXX.',
    'XXXXXXXX',
    '.XXXXXX.',
  ];

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function startSky(canvas, opts) {
    opts = opts || {};
    const density = opts.density || 1;
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, dpr = 1;
    let stars = [], clouds = [], jets = [], trails = [], shots = [];
    let last = performance.now();
    let sinceJet = 0;

    function resize() {
      dpr = Math.min(2, global.devicePixelRatio || 1);
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }

    function seed() {
      stars = [];
      const n = Math.round((W * H) / 9000 * density);
      for (let i = 0; i < n; i++) {
        const layer = Math.floor(rnd(0, 4));
        stars.push({
          x: rnd(0, W), y: rnd(0, H),
          s: layer < 2 ? 1 : 2,
          c: PAL.star[layer],
          v: 4 + layer * 7,
          tw: Math.random() * Math.PI * 2,
        });
      }
      clouds = [];
      const cn = Math.round(W / 220 * density) + 2;
      for (let i = 0; i < cn; i++) {
        clouds.push({
          x: rnd(0, W), y: rnd(H * 0.1, H * 0.9),
          px: rnd(3, 9), v: rnd(5, 16),
          c: pick(PAL.cloud), a: rnd(0.35, 0.8),
        });
      }
    }

    function spawnJet() {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const boom = Math.random() < 0.18;          // occasional Mach 2 flyby
      const y = rnd(H * 0.12, H * 0.88);
      jets.push({
        x: dir === 1 ? -70 : W + 70,
        y, dir,
        px: boom ? rnd(3.2, 4.2) : rnd(2, 3.4),
        v: (boom ? rnd(420, 560) : rnd(70, 190)) * dir,
        tint: Math.random() < 0.45 ? pick(PAL.accent) : pick(PAL.jet),
        boom,
        cone: 0,
        bob: Math.random() * Math.PI * 2,
        shoot: !boom && Math.random() < 0.3,
        shotAt: rnd(0.3, 0.8),
        fired: false,
      });
    }

    function drawGrid(grid, x, y, px, color, alpha) {
      ctx.globalAlpha = alpha === undefined ? 1 : alpha;
      ctx.fillStyle = color;
      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[r].length; c++) {
          if (grid[r][c] !== 'X') continue;
          ctx.fillRect(Math.round(x + c * px), Math.round(y + r * px), px, px);
        }
      }
      ctx.globalAlpha = 1;
    }

    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      ctx.clearRect(0, 0, W, H);

      // stars
      stars.forEach(s => {
        s.x -= s.v * dt;
        if (s.x < -4) { s.x = W + 4; s.y = rnd(0, H); }
        s.tw += dt * 3;
        ctx.globalAlpha = 0.55 + Math.sin(s.tw) * 0.3;
        ctx.fillStyle = s.c;
        ctx.fillRect(Math.round(s.x), Math.round(s.y), s.s, s.s);
      });
      ctx.globalAlpha = 1;

      // clouds
      clouds.forEach(c => {
        c.x -= c.v * dt;
        if (c.x < -CLOUD[0].length * c.px - 10) {
          c.x = W + 20; c.y = rnd(H * 0.1, H * 0.9);
        }
        drawGrid(CLOUD, c.x, c.y, c.px, c.c, c.a);
      });

      // contrails fade behind the jets
      trails = trails.filter(t => (t.life -= dt) > 0);
      trails.forEach(t => {
        ctx.fillStyle = PAL.trail + (t.life / t.max * 0.5).toFixed(3) + ')';
        ctx.fillRect(Math.round(t.x), Math.round(t.y), t.w, t.h);
      });

      // tracer rounds
      shots = shots.filter(s => {
        s.x += s.v * dt;
        s.life -= dt;
        if (s.life <= 0) return false;
        ctx.fillStyle = '#ffd48a';
        ctx.fillRect(Math.round(s.x), Math.round(s.y), 4, 2);
        return true;
      });

      // jets
      sinceJet += dt;
      if (sinceJet > rnd(1.6, 3.4) && jets.length < 4) {
        sinceJet = 0;
        spawnJet();
      }

      jets = jets.filter(j => {
        j.x += j.v * dt;
        j.bob += dt * 2.2;
        const y = j.y + Math.sin(j.bob) * 3;
        const w = JET[0].length * j.px;

        if (j.dir === 1 && j.x > W + 90) return false;
        if (j.dir === -1 && j.x < -90) return false;

        // contrail puff from the tail
        const tailX = j.dir === 1 ? j.x : j.x + w;
        trails.push({
          x: tailX - (j.dir === 1 ? 4 : 0), y: y + j.px * 3,
          w: 4, h: Math.max(1, j.px - 1),
          life: j.boom ? 1.6 : 1.1, max: j.boom ? 1.6 : 1.1,
        });

        // exhaust flicker
        const fl = pick(PAL.flame);
        ctx.fillStyle = fl;
        const fw = Math.round(rnd(2, 6) * (j.boom ? 1.8 : 1));
        ctx.fillRect(Math.round(j.dir === 1 ? j.x - fw : j.x + w),
                     Math.round(y + j.px * 3), fw, Math.max(1, j.px));

        // the jet itself, mirrored when flying left
        ctx.save();
        if (j.dir === -1) {
          ctx.translate(j.x + w, 0);
          ctx.scale(-1, 1);
          drawGrid(JET, 0, y, j.px, j.tint);
        } else {
          drawGrid(JET, j.x, y, j.px, j.tint);
        }
        ctx.restore();

        // vapour cone on the supersonic ones
        if (j.boom) {
          j.cone += dt;
          const cx = j.dir === 1 ? j.x - 10 : j.x + w + 10;
          ctx.globalAlpha = 0.16 + Math.sin(j.cone * 12) * 0.06;
          ctx.fillStyle = '#c3cde4';
          ctx.beginPath();
          ctx.moveTo(cx, y + j.px * 3);
          ctx.lineTo(cx - 26 * j.dir, y - 10);
          ctx.lineTo(cx - 26 * j.dir, y + j.px * 7 + 10);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
        }

        // the odd burst of tracer fire
        if (j.shoot && !j.fired) {
          const prog = j.dir === 1 ? j.x / W : 1 - j.x / W;
          if (prog > j.shotAt) {
            j.fired = true;
            for (let k = 0; k < 5; k++) {
              shots.push({
                x: j.dir === 1 ? j.x + w : j.x,
                y: y + j.px * 3 + rnd(-2, 2),
                v: 520 * j.dir, life: rnd(0.5, 0.9),
              });
            }
          }
        }
        return true;
      });

      requestAnimationFrame(frame);
    }

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    requestAnimationFrame(frame);

    return { resize };
  }

  global.startSky = startSky;
})(window);
