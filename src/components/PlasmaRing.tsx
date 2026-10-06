"use client";

import { useRef, useEffect, useState } from "react";

interface PlasmaRingProps {
  size?: number;
  isResponding?: boolean;
}

export default function PlasmaRing({ size = 200, isResponding = false }: PlasmaRingProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const respondingRef = useRef(isResponding);
  const themeRef = useRef<string>("dark");
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    respondingRef.current = isResponding;
  }, [isResponding]);

  // Detect theme from data-theme attribute on documentElement
  useEffect(() => {
    const el = document.documentElement;
    const update = () => {
      const t = el.getAttribute("data-theme") || "dark";
      themeRef.current = t;
      setTheme(t);
    };
    update();

    const observer = new MutationObserver(() => update());
    observer.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 360×360 canvas displayed at size×size (2× sharpness at size=200, ~1.8× otherwise)
    const W = Math.round(size * 1.8);
    const H = W;
    canvas.width = W;
    canvas.height = H;

    const cx = W / 2;
    const cy = H / 2;
    const R0 = W * 0.27;
    const N = 14;
    const t0 = performance.now();

    const n2 = (a: number, f: number, p: number, t: number) =>
      Math.sin(a * f + p + t) + 0.5 * Math.sin(a * (f + 2) - p * 1.7 + t * 1.6);

    function draw(now: number) {
      if (!ctx) return;
      const t = (now - t0) / 1000;
      const fast = respondingRef.current ? 2.2 : 1;
      const isDark = themeRef.current !== "light";

      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = isDark ? "lighter" : "source-over";
      ctx.lineCap = "round";

      // 14 wavy glowing loops
      for (let k = 0; k < N; k++) {
        const ph = k * 1.9;
        const f = 2 + (k % 4);
        const amp = R0 * (0.05 + 0.07 * ((k * 7) % 5) / 5);
        const tk = t * (0.5 + k * 0.12) * fast;
        const hue = 250 + k * 7 + 14 * Math.sin(t * 0.6 + k);
        const alpha = 0.5 + 0.3 * Math.sin(t * 1.3 * fast + k);

        ctx.beginPath();
        for (let i = 0; i <= 240; i++) {
          const a = (i / 240) * Math.PI * 2;
          const r = R0 + amp * n2(a, f, ph, tk) + R0 * 0.012 * Math.sin(t * 2 * fast + k);
          const x = cx + Math.cos(a) * r * (1 + 0.04 * Math.sin(t * 0.7 + k));
          const y = cy + Math.sin(a) * r;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.closePath();

        ctx.strokeStyle = isDark
          ? `hsla(${hue},100%,${82 - k * 2.5}%,${alpha})`
          : `hsla(${hue},90%,${48 + k * 0.5}%,${0.5 + 0.3 * Math.sin(t * 1.3 * fast + k)})`;
        ctx.lineWidth = 2.6 + 1.8 * Math.sin(t * 1.4 + k);
        ctx.shadowColor = isDark
          ? `hsla(${hue},100%,65%,0.9)`
          : `hsla(${hue},80%,45%,0.7)`;
        ctx.shadowBlur = isDark ? (28 + 14 * Math.sin(t * 1.4 + k)) : 18;
        ctx.stroke();
      }

      // Core circle
      ctx.beginPath();
      ctx.arc(cx, cy, R0 * (1 + 0.015 * Math.sin(t * 2.4 * fast)), 0, Math.PI * 2);
      ctx.strokeStyle = isDark
        ? `rgba(255,255,255,${0.35 + 0.15 * Math.sin(t * 3 * fast)})`
        : `rgba(100,40,200,${0.35 + 0.15 * Math.sin(t * 3 * fast)})`;
      ctx.lineWidth = 1.4;
      ctx.shadowColor = isDark ? "rgba(220,170,255,1)" : "rgba(124,58,237,0.6)";
      ctx.shadowBlur = 40;
      ctx.stroke();

      // Reset shadow before gradient
      ctx.shadowBlur = 0;

      // Radial gradient haze
      const g = ctx.createRadialGradient(cx, cy, R0 * 0.55, cx, cy, R0 * 1.75);
      if (isDark) {
        g.addColorStop(0, `rgba(140,70,255,${0.14 + 0.06 * Math.sin(t * 2 * fast)})`);
        g.addColorStop(0.45, `rgba(170,90,255,${0.32 + 0.12 * Math.sin(t * 1.5 * fast)})`);
        g.addColorStop(1, "rgba(90,30,200,0)");
      } else {
        g.addColorStop(0, `rgba(124,58,237,${0.08 + 0.04 * Math.sin(t * 2 * fast)})`);
        g.addColorStop(0.45, `rgba(124,58,237,${0.18 + 0.08 * Math.sin(t * 1.5 * fast)})`);
        g.addColorStop(1, "rgba(124,58,237,0)");
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      ctx.globalCompositeOperation = "source-over";
      animRef.current = requestAnimationFrame(draw);
    }

    // Check for prefers-reduced-motion
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motionQuery.matches) {
      draw(performance.now());
      return;
    }

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [size]);

  return (
    <div className="plasma-ring-container" style={{ width: size, height: size }}>
      <canvas
        ref={canvasRef}
        style={{
          width: size,
          height: size,
          filter: theme !== "light"
            ? "saturate(1.35) contrast(1.1) drop-shadow(0 0 40px rgba(220,80,255,.45))"
            : "drop-shadow(0 0 40px rgba(220,80,255,.45))",
        }}
      />
    </div>
  );
}
