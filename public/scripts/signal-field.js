(() => {
  const canvas = document.querySelector("[data-signal-canvas]");
  if (!(canvas instanceof HTMLCanvasElement)) return;

  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return;

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let width = 0;
  let height = 0;
  let ratio = 1;
  let frame = 0;
  let raf = 0;

  const particles = Array.from({ length: 76 }, (_, index) => ({
    seed: index * 97.31,
    size: 0.6 + (index % 5) * 0.22,
    speed: 0.12 + (index % 7) * 0.018,
    depth: 0.25 + ((index * 11) % 70) / 100,
  }));

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  const drawCurve = ({ lane, color, alpha, widthScale, offset, tension }) => {
    const yBase = height * (0.2 + lane * 0.075);
    const amplitude = height * (0.018 + lane * 0.002) + 9;
    const step = Math.max(10, width / 110);

    context.beginPath();
    for (let x = -step; x <= width + step; x += step) {
      const slow = Math.sin(x * 0.006 + frame * (0.8 + tension) + offset) * amplitude;
      const quick = Math.sin(x * 0.017 - frame * (1.25 + lane * 0.045) + offset * 0.7) * (amplitude * 0.34);
      const braid = Math.cos(x * 0.0028 + frame * 0.44 + lane) * (height * 0.018);
      const y = yBase + slow + quick + braid;
      if (x === -step) context.moveTo(x, y);
      else context.lineTo(x, y);
    }

    context.strokeStyle = color.replace("__ALPHA__", alpha.toFixed(3));
    context.lineWidth = widthScale;
    context.stroke();
  };

  const drawBackgroundGlow = () => {
    const primary = context.createRadialGradient(width * 0.52, height * 0.18, 20, width * 0.52, height * 0.26, width * 0.72);
    primary.addColorStop(0, "rgba(122, 217, 209, 0.16)");
    primary.addColorStop(0.42, "rgba(122, 217, 209, 0.06)");
    primary.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = primary;
    context.fillRect(0, 0, width, height);

    const warm = context.createRadialGradient(width * 0.75, height * 0.62, 10, width * 0.75, height * 0.64, width * 0.46);
    warm.addColorStop(0, "rgba(224, 173, 103, 0.12)");
    warm.addColorStop(0.5, "rgba(158, 94, 66, 0.045)");
    warm.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = warm;
    context.fillRect(0, 0, width, height);
  };

  const drawRefractionBands = () => {
    for (let i = 0; i < 7; i += 1) {
      const x = ((i * width * 0.19 + frame * 18) % (width + 180)) - 90;
      const bandWidth = 18 + (i % 3) * 22;
      const gradient = context.createLinearGradient(x, 0, x + bandWidth, 0);
      gradient.addColorStop(0, "rgba(255, 255, 255, 0)");
      gradient.addColorStop(0.42, "rgba(180, 234, 226, 0.022)");
      gradient.addColorStop(0.52, "rgba(255, 255, 255, 0.045)");
      gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
      context.fillStyle = gradient;
      context.fillRect(x, 0, bandWidth, height);
    }
  };

  const drawParticles = () => {
    particles.forEach((particle, index) => {
      const x = (Math.sin(particle.seed + frame * particle.speed) * 0.5 + 0.5) * width;
      const drift = ((particle.seed * 13 + frame * 26 * particle.depth) % (height + 160)) - 80;
      const y = height * 0.08 + drift;
      const pulse = 0.18 + Math.sin(frame * 1.8 + index) * 0.08;
      const warm = index % 4 === 0;
      context.fillStyle = warm
        ? `rgba(224, 173, 103, ${pulse})`
        : `rgba(122, 217, 209, ${pulse * 0.66})`;
      context.fillRect(x, y, particle.size, particle.size);
    });
  };

  const drawScanline = () => {
    const y = (Math.sin(frame * 0.32) * 0.5 + 0.5) * height;
    const gradient = context.createLinearGradient(0, y - 42, 0, y + 42);
    gradient.addColorStop(0, "rgba(122, 217, 209, 0)");
    gradient.addColorStop(0.5, "rgba(122, 217, 209, 0.055)");
    gradient.addColorStop(1, "rgba(122, 217, 209, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, y - 42, width, 84);
  };

  const draw = () => {
    frame += prefersReducedMotion.matches ? 0.003 : 0.012;
    context.clearRect(0, 0, width, height);

    drawBackgroundGlow();
    drawRefractionBands();

    context.save();
    context.globalCompositeOperation = "screen";
    for (let lane = 0; lane < 11; lane += 1) {
      drawCurve({
        lane,
        color: lane % 3 === 0 ? "rgba(224, 173, 103, __ALPHA__)" : "rgba(122, 217, 209, __ALPHA__)",
        alpha: lane % 3 === 0 ? 0.2 : 0.16,
        widthScale: lane % 3 === 0 ? 1.1 : 0.75,
        offset: lane * 0.9,
        tension: lane * 0.018,
      });
    }
    context.restore();

    context.save();
    context.globalCompositeOperation = "lighter";
    for (let lane = 0; lane < 4; lane += 1) {
      drawCurve({
        lane: lane * 2 + 1,
        color: "rgba(238, 240, 220, __ALPHA__)",
        alpha: 0.04,
        widthScale: 0.55,
        offset: lane * 1.7 + 2,
        tension: 0.05,
      });
    }
    drawParticles();
    drawScanline();
    context.restore();

    raf = window.requestAnimationFrame(draw);
  };

  const start = () => {
    window.cancelAnimationFrame(raf);
    resize();
    draw();
  };

  start();
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      window.cancelAnimationFrame(raf);
      return;
    }
    start();
  });
})();
