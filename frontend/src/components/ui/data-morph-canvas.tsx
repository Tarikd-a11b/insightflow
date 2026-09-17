"use client";

import { useEffect, useRef } from "react";

export function DataMorphCanvas({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const onResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", onResize);

    // Mouse coordinates for subtle interactive reaction
    let mouse = { x: width / 2, y: height / 2, active: false };
    const onMouseMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;
    };
    window.addEventListener("mousemove", onMouseMove);

    // Floating data particles (numbers, symbols, nodes)
    const DATA_TOKENS = ["42.8", "99.4%", "0x7F", "1,240", "∑", "∆", "8.6K", "350ms", "0.01", "77.2%", "5.1M", "μ=14.2", "σ=1.8"];
    
    interface Particle {
      x: number;
      y: number;
      vx: number;
      vy: number;
      text: string;
      alpha: number;
      size: number;
      isNode: boolean;
      color: string;
    }

    const COLORS = [
      "rgba(99, 102, 241, 0.7)",   // Indigo
      "rgba(6, 182, 212, 0.7)",    // Cyan
      "rgba(16, 185, 129, 0.7)",   // Emerald
      "rgba(244, 114, 182, 0.6)",  // Pink
    ];

    const particleCount = Math.min(45, Math.floor(width / 30));
    const particles: Particle[] = [];

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.4,
        vy: -Math.random() * 0.5 - 0.2, // Move upward
        text: DATA_TOKENS[Math.floor(Math.random() * DATA_TOKENS.length)],
        alpha: Math.random() * 0.5 + 0.15,
        size: Math.random() * 3 + 9,
        isNode: Math.random() > 0.4,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      });
    }

    // Morphing chart waves (Sinusoidal dynamic trend line)
    let waveOffset = 0;

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      waveOffset += 0.015;

      // 1. Draw glowing background grid
      ctx.strokeStyle = "rgba(148, 163, 184, 0.04)";
      ctx.lineWidth = 1;
      const gridSize = 48;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // 2. Draw animated morphing chart waves (Data-to-Chart show)
      const isDark = document.documentElement.classList.contains("dark");
      const baseWaveAlpha = isDark ? 0.22 : 0.12;

      // Wave 1: Primary Trend Line (Indigo/Cyan Gradient)
      const grad1 = ctx.createLinearGradient(0, 0, width, 0);
      grad1.addColorStop(0, `rgba(99, 102, 241, ${baseWaveAlpha})`);
      grad1.addColorStop(0.5, `rgba(6, 182, 212, ${baseWaveAlpha + 0.15})`);
      grad1.addColorStop(1, `rgba(16, 185, 129, ${baseWaveAlpha})`);

      ctx.beginPath();
      ctx.strokeStyle = grad1;
      ctx.lineWidth = 2.5;

      const baselineY = height * 0.65;
      const wavePoints: [number, number][] = [];

      for (let x = 0; x <= width; x += 12) {
        const angle = (x * 0.005) + waveOffset;
        const mouseEffect = mouse.active ? Math.max(0, 1 - Math.hypot(x - mouse.x, baselineY - mouse.y) / 250) * 35 : 0;
        const y = baselineY + Math.sin(angle) * 45 + Math.cos(angle * 1.8) * 20 - mouseEffect;
        wavePoints.push([x, y]);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Draw subtle gradient area under Wave 1
      const areaGrad = ctx.createLinearGradient(0, baselineY - 60, 0, height);
      areaGrad.addColorStop(0, `rgba(99, 102, 241, ${isDark ? 0.08 : 0.04})`);
      areaGrad.addColorStop(1, "rgba(99, 102, 241, 0)");
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.fillStyle = areaGrad;
      ctx.fill();

      // 3. Draw morphing bar chart peaks along the wave
      const barCount = 14;
      const barSpacing = width / (barCount + 1);
      ctx.fillStyle = isDark ? "rgba(6, 182, 212, 0.12)" : "rgba(6, 182, 212, 0.07)";
      for (let i = 1; i <= barCount; i++) {
        const bx = i * barSpacing;
        const bHeight = Math.abs(Math.sin(waveOffset * 1.2 + i * 0.7)) * 70 + 20;
        ctx.fillRect(bx - 6, baselineY + 10 - bHeight, 12, bHeight);
      }

      // 4. Update and draw floating data tokens and connected nodes
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;

        // Wrap around boundaries
        if (p.y < -30) {
          p.y = height + 20;
          p.x = Math.random() * width;
        }
        if (p.x < -30) p.x = width + 20;
        if (p.x > width + 30) p.x = -20;

        // Draw connections between nearby nodes
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dist = Math.hypot(p.x - p2.x, p.y - p2.y);
          if (dist < 110) {
            ctx.beginPath();
            ctx.strokeStyle = isDark
              ? `rgba(99, 102, 241, ${(1 - dist / 110) * 0.18})`
              : `rgba(99, 102, 241, ${(1 - dist / 110) * 0.1})`;
            ctx.lineWidth = 0.8;
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }

        if (p.isNode) {
          // Glowing node point
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.fill();
        } else {
          // Monospace data string (e.g. 42.8, 99.4%)
          ctx.font = `${p.size}px monospace`;
          ctx.fillStyle = isDark ? `rgba(148, 163, 184, ${p.alpha * 0.6})` : `rgba(71, 85, 105, ${p.alpha * 0.5})`;
          ctx.fillText(p.text, p.x, p.y);
        }
      }

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMouseMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 z-0 ${className ?? ""}`}
    />
  );
}
