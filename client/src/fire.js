// محرك جمرات ونار بسيط على canvas
export function startFire(canvas) {
  const ctx = canvas.getContext("2d");
  let w = 0, h = 0, dpr = 1;
  const parts = [];
  let running = true;

  function resize() {
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);

  const rnd = (a, b) => a + Math.random() * (b - a);

  function spawnFlame() {
    if (parts.length > 90) return;
    parts.push({
      x: rnd(0, w), y: h + 10,
      vx: rnd(-.5, .5), vy: rnd(-3.2, -1.2),
      r: rnd(14, 28), life: 1, decay: rnd(.006, .014), kind: "flame",
    });
  }
  function spawnEmber() {
    if (parts.length > 90) return;
    parts.push({
      x: rnd(0, w), y: h + 5,
      vx: rnd(-1, 1), vy: rnd(-4.5, -1.8),
      r: rnd(1, 3), life: 1, decay: rnd(.004, .01), kind: "ember", wob: rnd(0, 6.28),
    });
  }

  function burst(x = w / 2, y = h / 2, n = 160) {
    n = Math.round(n * 0.35); // أخف على الجوال
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = rnd(3, 16);
      parts.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2,
        r: rnd(2, 7), life: 1, decay: rnd(.008, .02), kind: "ember", wob: rnd(0, 6.28), grav: .12,
      });
    }
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2, s = rnd(1, 6);
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: rnd(30, 60), life: 1, decay: rnd(.02, .04), kind: "flame" });
    }
  }

  let last = 0;
  function frame(now = 0) {
    if (!running) return;
    // نحدد 30 إطار بالثانية ونوقف الرسم لو الصفحة مخفية (يخفف الحمل على الجوال)
    if (document.hidden || now - last < 33) { requestAnimationFrame(frame); return; }
    last = now;
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";

    spawnFlame();
    if (Math.random() < .25) spawnEmber();

    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= p.decay;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      if (p.kind === "ember") { p.wob += .15; p.x += p.vx + Math.sin(p.wob) * .6; }
      else p.x += p.vx + Math.sin(p.y * .02) * .4;
      p.y += p.vy; p.vy += p.grav || 0;

      const hue = 8 + (1 - p.life) * 0 + p.life * 45; // أصفر → أحمر مع الوقت
      if (p.kind === "flame") {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, `hsla(${hue},100%,60%,${p.life * .35})`);
        g.addColorStop(1, `hsla(${hue - 10},100%,40%,0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      } else {
        ctx.fillStyle = `hsla(${hue + 10},100%,65%,${p.life})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      }
    }
    requestAnimationFrame(frame);
  }
  frame();

  return { burst, stop() { running = false; window.removeEventListener("resize", resize); } };
}
