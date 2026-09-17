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

    let mouse = { x: width / 2, y: height / 2, active: false };
    const onMouseMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;
    };
    window.addEventListener("mousemove", onMouseMove);

    // 1. Kayan Veri Satırları (Streaming Data Matrix Rows)
    const DATA_ROWS = [
      "| 0x8921 | ELEKTRONİK | CİRO: $18,450.00 | İADE: %1.2 | DUCKDB: 12ms |",
      "| #4092 | SaaS CHURN: 0.04 | NPS: 78 | PLAN: PRO | BÖLGE: TR_IST |",
      "| SELECT kategori, sum(tutar) FROM satis GROUP BY 1 ORDER BY 2 DESC |",
      "| #1049 | KOZMETİK | SİPARİŞ: 1,420 | BÜYÜME: +%28.4 | BUFFER: OK |",
      "| 0x7F0A | GİYİM | ADET: 890 | İNDİRİM: %15 | NET_KÂR: $12,800 |",
      "| VECTORIZED COLUMNAR SCAN: 1.45M SATIR/SN | RAM: 4.2 MB | 0.0% NULL |",
      "| #3381 | OTOMOTİV | CAC: $42 | LTV: $1,280 | DÖNÜŞÜM: %6.8 |",
      "| #7729 | FİNANS | İŞLEM: 84.2K | HATA: 0.00% | STATUS: VERIFIED |",
    ];

    interface StreamRow {
      x: number;
      y: number;
      speed: number;
      text: string;
      alpha: number;
    }

    const streamRows: StreamRow[] = [];
    const rowCount = 10;
    for (let i = 0; i < rowCount; i++) {
      streamRows.push({
        x: (i % 2 === 0 ? 40 : width * 0.45) + (Math.random() * 80 - 40),
        y: Math.random() * height,
        speed: 0.4 + Math.random() * 0.4,
        text: DATA_ROWS[i % DATA_ROWS.length],
        alpha: 0.12 + Math.random() * 0.15,
      });
    }

    // 2. Grafiğe Dönüşen Parçacıklar (Data Morph Particles)
    interface Particle {
      x: number;
      y: number;
      targetX: number;
      targetY: number;
      color: string;
      size: number;
      alpha: number;
    }

    const particles: Particle[] = [];
    const particleCount = 30;
    const COLORS = ["#6366f1", "#06b6d4", "#10b981", "#f59e0b", "#ec4899"];

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        targetX: Math.random() * width,
        targetY: Math.random() * height,
        color: COLORS[i % COLORS.length],
        size: Math.random() * 2 + 1.5,
        alpha: Math.random() * 0.4 + 0.2,
      });
    }

    let time = 0;

    const render = () => {
      ctx.clearRect(0, 0, width, height);
      time += 0.02;

      const isDark = document.documentElement.classList.contains("dark");
      const textColor = isDark ? "148, 163, 184" : "71, 85, 105";

      // 1. Arka Plan Kılavuz Grid
      ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.025)" : "rgba(0, 0, 0, 0.03)";
      ctx.lineWidth = 1;
      const gridSize = 56;
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

      // 2. Kayan Veri Satırları (Aşağı Doğru Akan Veri Matrisi)
      ctx.font = "11px monospace";
      for (let i = 0; i < streamRows.length; i++) {
        const row = streamRows[i];
        row.y += row.speed;
        if (row.y > height + 20) {
          row.y = -20;
          row.x = (i % 2 === 0 ? 30 : width * 0.5) + (Math.random() * 60 - 30);
          row.text = DATA_ROWS[Math.floor(Math.random() * DATA_ROWS.length)];
        }

        ctx.fillStyle = `rgba(${textColor}, ${isDark ? row.alpha : row.alpha * 0.7})`;
        ctx.fillText(row.text, row.x, row.y);
      }

      // =========================================================================
      // 3. SİNEMATİK GRAFİK DÖNÜŞÜMLERİ (Line Chart, Bar Chart, Donut/Pie Chart)
      // =========================================================================

      // A) ÇİZGİ GRAFİĞİ HOLOGAMI (Line Chart Wave - Ekranın Altı/Ortası)
      const lineBaseY = height * 0.72;
      ctx.beginPath();
      const lineGrad = ctx.createLinearGradient(0, 0, width, 0);
      lineGrad.addColorStop(0, "rgba(99, 102, 241, 0.2)");
      lineGrad.addColorStop(0.3, "rgba(6, 182, 212, 0.6)");
      lineGrad.addColorStop(0.7, "rgba(16, 185, 129, 0.6)");
      lineGrad.addColorStop(1, "rgba(244, 114, 182, 0.2)");

      ctx.strokeStyle = lineGrad;
      ctx.lineWidth = 2.5;

      const lineStep = 16;
      for (let x = 0; x <= width; x += lineStep) {
        const wave = Math.sin(x * 0.006 + time) * 36 + Math.cos(x * 0.015 + time * 0.8) * 16;
        const y = lineBaseY + wave;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);

        // Periyodik veri noktaları (Glowing Data Nodes on line)
        if (x % (lineStep * 4) === 0) {
          ctx.save();
          ctx.fillStyle = isDark ? "#22d3ee" : "#0891b2";
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
      ctx.stroke();

      // Çizgi Altı Degrade Alan (Line Area Gradient)
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      const areaGrad = ctx.createLinearGradient(0, lineBaseY - 50, 0, height);
      areaGrad.addColorStop(0, isDark ? "rgba(6, 182, 212, 0.08)" : "rgba(6, 182, 212, 0.04)");
      areaGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = areaGrad;
      ctx.fill();

      // B) SÜTUN GRAFİĞİ HOLOGRAMI (Bar Chart Distribution - Sol / Alt Bölge)
      const barXStart = Math.max(30, width * 0.05);
      const barBaseY = height * 0.85;
      const barCount = 7;
      const barWidth = 14;
      const barGap = 12;

      for (let b = 0; b < barCount; b++) {
        const bx = barXStart + b * (barWidth + barGap);
        const bPulse = Math.sin(time * 1.5 + b * 0.8);
        const bHeight = Math.abs(bPulse) * 55 + 25;

        // Bar Sütun Rengi (Neon çok renkli degrade)
        const barGrad = ctx.createLinearGradient(0, barBaseY - bHeight, 0, barBaseY);
        const color = COLORS[b % COLORS.length];
        barGrad.addColorStop(0, color);
        barGrad.addColorStop(1, "rgba(0,0,0,0.05)");

        ctx.fillStyle = barGrad;
        ctx.beginPath();
        ctx.roundRect(bx, barBaseY - bHeight, barWidth, bHeight, [4, 4, 0, 0]);
        ctx.fill();
      }

      // Bar Chart Başlık Rozeti
      ctx.fillStyle = `rgba(${textColor}, 0.5)`;
      ctx.font = "9px monospace";
      ctx.fillText("📊 DAĞILIM // BAR", barXStart, barBaseY + 14);

      // C) PASTA / HALKA GRAFİĞİ HOLOGRAMI (Pie / Donut Chart - Sağ Üst/Orta Bölge)
      const donutX = Math.min(width - 90, width * 0.88);
      const donutY = Math.max(120, height * 0.28);
      const donutRadius = 42;
      const donutInner = 26;

      const segments = [
        { pct: 0.45, color: "#6366f1" }, // %45 Indigo
        { pct: 0.35, color: "#06b6d4" }, // %35 Cyan
        { pct: 0.20, color: "#10b981" }, // %20 Emerald
      ];

      let startAngle = time * 0.4;
      for (const seg of segments) {
        const endAngle = startAngle + seg.pct * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(donutX, donutY, donutRadius, startAngle, endAngle);
        ctx.arc(donutX, donutY, donutInner, endAngle, startAngle, true);
        ctx.closePath();
        ctx.fillStyle = seg.color + (isDark ? "bb" : "88");
        ctx.fill();
        startAngle = endAngle;
      }

      // Donut Ortası Metrik Yazısı
      ctx.fillStyle = isDark ? "#f8fafc" : "#0f172a";
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      ctx.fillText("∑ 100%", donutX, donutY + 3);
      ctx.textAlign = "left";

      // Donut Başlık Rozeti
      ctx.fillStyle = `rgba(${textColor}, 0.5)`;
      ctx.font = "9px monospace";
      ctx.fillText("🍩 PAY // PIE", donutX - 32, donutY + donutRadius + 16);

      // D) Uçuşan Veri Parçacıkları ve Bağlantı Çizgileri (Data Stream Connectors)
      for (let p of particles) {
        p.y -= 0.6;
        if (p.y < 0) {
          p.y = height + 10;
          p.x = Math.random() * width;
        }

        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
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
      className={`pointer-events-none absolute inset-0 z-0 opacity-80 ${className ?? ""}`}
    />
  );
}
