"use client";

import { useEffect, useRef } from "react";

interface Cell {
  /** Hücrenin blok içindeki genişlik oranı (0–1). */
  width: number;
  /** Taban opaklık. */
  alpha: number;
  /** Tarama ışını geçtiğinde yanan hücre mi. */
  hit: boolean;
}

interface Column {
  cells: Cell[];
  drift: number;
  offset: number;
}

const COLUMN_COUNT = 11;
const ROW_COUNT = 30;

/**
 * Kolonsal veri alanı.
 *
 * Arka planda kolon blokları yavaşça akar, üzerinden bir tarama ışını geçer ve
 * yüklem eşleşen hücreler yanar — DuckDB'nin vektörize kolon taramasının görsel
 * karşılığı. Dekoratif bir gradient değil, motorun ne yaptığını anlatır.
 *
 * Renkleri tema değişkenlerinden okur (`--border`, `--local`), yani karanlık ve
 * aydınlık temada ayrı bir tanım gerektirmez. `prefers-reduced-motion` açıksa
 * tek kare çizip durur; sekme arka plandayken döngüyü askıya alır.
 */
export function DataField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const palette = { base: "#1e293b", hit: "#10b981" };

    let width = 0;
    let height = 0;
    let columns: Column[] = [];
    let tick = 0;
    let scan = 0.28;
    let raf = 0;
    let running = false;

    function readPalette() {
      const style = getComputedStyle(document.documentElement);
      palette.base = style.getPropertyValue("--border").trim() || palette.base;
      palette.hit = style.getPropertyValue("--local").trim() || palette.hit;
    }

    function build() {
      if (!canvas || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      width = Math.max(320, rect.width);
      height = Math.max(320, rect.height);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      columns = Array.from({ length: COLUMN_COUNT }, () => ({
        cells: Array.from({ length: ROW_COUNT }, () => ({
          width: 0.28 + Math.random() * 0.72,
          alpha: 0.12 + Math.random() * 0.5,
          hit: Math.random() < 0.2,
        })),
        drift: 0.06 + Math.random() * 0.16,
        offset: Math.random() * 40,
      }));
    }

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);

      const left = width * 0.06;
      const right = width + 60;
      const columnWidth = (right - left) / COLUMN_COUNT;
      const rowHeight = (height / ROW_COUNT) * 1.18;
      const beamX = scan * width;

      for (let c = 0; c < COLUMN_COUNT; c += 1) {
        const column = columns[c];
        const x = left + c * columnWidth;

        for (let r = 0; r < ROW_COUNT; r += 1) {
          const cell = column.cells[r];
          const y =
            ((r * rowHeight + column.offset + tick * column.drift * 10) % (height + rowHeight * 2)) - rowHeight;
          const w = (columnWidth - 9) * cell.width;
          const distance = Math.abs(x + w / 2 - beamX) / (width * 0.085);
          const flare = distance < 1 ? 1 - distance : 0;
          const alpha = cell.alpha * 0.5 + (cell.hit ? flare * 0.95 : flare * 0.22);
          if (alpha <= 0.015) continue;

          ctx.fillStyle = cell.hit && flare > 0.25 ? palette.hit : palette.base;
          ctx.globalAlpha = Math.min(0.95, alpha);
          const h = Math.max(2, rowHeight * 0.42);
          ctx.beginPath();
          ctx.roundRect(x, y, w, h, 1.5);
          ctx.fill();
        }
      }

      ctx.globalAlpha = 1;
      if (beamX > left - 40 && beamX < right) {
        const gradient = ctx.createLinearGradient(beamX - 70, 0, beamX + 6, 0);
        gradient.addColorStop(0, "transparent");
        gradient.addColorStop(1, palette.hit);
        ctx.globalAlpha = 0.1;
        ctx.fillStyle = gradient;
        ctx.fillRect(beamX - 70, 0, 76, height);
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = palette.hit;
        ctx.fillRect(beamX, 0, 1, height);
        ctx.globalAlpha = 1;
      }
    }

    function loop() {
      tick += 1;
      scan += 0.0032;
      if (scan > 1.25) scan = 0.28;
      draw();
      raf = requestAnimationFrame(loop);
    }

    function start() {
      if (running || motionQuery.matches) return;
      running = true;
      raf = requestAnimationFrame(loop);
    }

    function stop() {
      running = false;
      cancelAnimationFrame(raf);
    }

    function refresh() {
      readPalette();
      draw();
    }

    readPalette();
    build();
    draw();
    start();

    const resizeObserver = new ResizeObserver(() => {
      build();
      draw();
    });
    resizeObserver.observe(canvas);

    const visibilityObserver = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting && !document.hidden ? start() : stop()),
      { threshold: 0 },
    );
    visibilityObserver.observe(canvas);

    function onVisibility() {
      if (document.hidden) stop();
      else start();
    }

    const themeObserver = new MutationObserver(refresh);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    function onMotionChange() {
      if (motionQuery.matches) stop();
      else start();
    }

    document.addEventListener("visibilitychange", onVisibility);
    darkQuery.addEventListener("change", refresh);
    motionQuery.addEventListener("change", onMotionChange);

    return () => {
      stop();
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      darkQuery.removeEventListener("change", refresh);
      motionQuery.removeEventListener("change", onMotionChange);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className={className} />;
}
