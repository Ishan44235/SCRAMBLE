/* ============================================================
   hero.js — the big animated pixel jet on the home screen.

   Replaces the radar. Side-profile fighter, bobbing on its own
   thrust, afterburner flickering through three stages, speed
   lines tearing past, heat haze behind the nozzle.
   ============================================================ */

(function (global) {

  // 28 x 15 top-down fighter, nose to the right, exhaust to the left.
  // K = canopy, C/D = engine nozzle block.
  const HERO = [
    '......XX....................',
    '......XXX...................',
    '......XXXX..................',
    '.......XXXXX................',
    '........XXXXXX..............',
    '.....XXXXXXXXXXXX...........',
    'CCCDDDXXXXXXXXXXXXXXXXXX....',
    'CCCDDDXXXXXXXXXXKKXXXXXXXXXX',
    'CCCDDDXXXXXXXXXXXXXXXXXX....',
    '.....XXXXXXXXXXXX...........',
    '........XXXXXX..............',
    '.......XXXXX................',
    '......XXXX..................',
    '......XXX...................',
    '......XX....................',
  ];

  const BODY = ['#7d879c', '#9aa6c0', '#c3cde4'];
  const CANOPY = '#6fd3ff';
  const FLAME = [
    ['#f5a524', '#ff7a3d'],
    ['#ff7a3d', '#e5484d'],
    ['#ffd48a', '#f5a524'],
  ];

  function startHero(canvas) {
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, dpr = 1, t = 0, lines = [];

    function resize() {
      dpr = Math.min(2, global.devicePixelRatio || 1);
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lines = [];
      for (let i = 0; i < 16; i++) {
        lines.push({
          x: Math.random() * W,
          y: Math.random() * H,
          len: 10 + Math.random() * 42,
          v: 220 + Math.random() * 460,
          a: 0.1 + Math.random() * 0.33,
        });
      }
    }

    function frame(now) {
      t += 1 / 60;
      ctx.clearRect(0, 0, W, H);

      const px = Math.max(3, Math.floor(Math.min(W / 32, H / 18)));
      const jw = HERO[0].length * px;
      const jh = HERO.length * px;
      const ox = Math.round((W - jw) / 2);
      const oy = Math.round((H - jh) / 2 + Math.sin(t * 1.9) * px * 0.9);

      // speed lines tearing past
      lines.forEach(l => {
        l.x -= l.v / 60;
        if (l.x + l.len < 0) {
          l.x = W + Math.random() * 60;
          l.y = Math.random() * H;
        }
        ctx.globalAlpha = l.a;
        ctx.fillStyle = '#c3cde4';
        ctx.fillRect(Math.round(l.x), Math.round(l.y), l.len, 1);
      });
      ctx.globalAlpha = 1;

      // afterburner: three stacked plumes, each flickering independently
      const nozzleX = ox;
      const midY = oy + Math.floor(HERO.length / 2) * px;
      for (let k = 0; k < 3; k++) {
        const flick = 0.5 + Math.random() * 0.5;
        const len = (26 + k * 16) * flick;
        const pal = FLAME[k];
        ctx.globalAlpha = 0.5 + Math.random() * 0.45;
        const grad = ctx.createLinearGradient(nozzleX - len, 0, nozzleX, 0);
        grad.addColorStop(0, 'rgba(255,180,90,0)');
        grad.addColorStop(0.5, pal[1]);
        grad.addColorStop(1, pal[0]);
        ctx.fillStyle = grad;
        ctx.fillRect(Math.round(nozzleX - len), midY - px * (1.5 - k * 0.35),
                     Math.round(len), px * (3 - k * 0.7));
      }
      ctx.globalAlpha = 1;

      // heat haze blocks
      for (let k = 0; k < 5; k++) {
        ctx.globalAlpha = 0.08 + Math.random() * 0.1;
        ctx.fillStyle = '#ffd48a';
        ctx.fillRect(nozzleX - 70 - Math.random() * 50,
                     midY - px + Math.random() * px * 2,
                     px * (1 + Math.random() * 2), px);
      }
      ctx.globalAlpha = 1;

      // the jet
      for (let r = 0; r < HERO.length; r++) {
        for (let c = 0; c < HERO[r].length; c++) {
          const ch = HERO[r][c];
          if (ch === '.') continue;
          let col;
          if (ch === 'C') col = FLAME[0][0];
          else if (ch === 'D') col = BODY[0];
          else if (ch === 'K') {
            // canopy catches the light on a slow cycle
            const glint = Math.sin(t * 1.4) * 0.5 + 0.5;
            col = glint > 0.82 ? '#ffffff' : CANOPY;
          } else col = r < 6 ? BODY[2] : (r > 8 ? BODY[0] : BODY[1]);
          ctx.fillStyle = col;
          ctx.fillRect(ox + c * px, oy + r * px, px, px);
        }
      }

      requestAnimationFrame(frame);
    }

    new ResizeObserver(resize).observe(canvas);
    resize();
    requestAnimationFrame(frame);
  }

  global.startHero = startHero;
})(window);
