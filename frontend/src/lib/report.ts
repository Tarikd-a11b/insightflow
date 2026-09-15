"use client";

/**
 * PDF analiz raporu. Tamamen tarayıcıda üretilir: grafikler ECharts'ın SSR/SVG çıktısıyla vektörel çizilir,
 * metin gömülü IBM Plex Sans ile yazılır (Türkçe karakterler için), dosya doğrudan indirilir.
 * Hiçbir istek atılmaz; yalnızca kendi alan adımızdaki font dosyaları okunur.
 */

import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import "svg2pdf.js";
import type { ChartKind } from "./api";
import { buildOption, chartHeight, formatKpi, PRINT_THEME } from "./chart-option";
import { buildChartSpec, columnRoles, isRate } from "./chart-spec";
import type { QueryResult } from "./data/types";
import { formatCell } from "./format";

echarts.use([LineChart, BarChart, ScatterChart, GridComponent, LegendComponent, SVGRenderer]);

export interface ReportItem {
  question: string;
  datasetName: string;
  createdAt: number;
  explanation: string;
  sql: string;
  chart: ChartKind;
  result: QueryResult;
  summary?: string;
}

const FONT = "IBMPlexSans";
const PAGE = { w: 210, h: 297, margin: 16 };
const CONTENT_W = PAGE.w - PAGE.margin * 2;
const INK: [number, number, number] = [17, 24, 32];
const MUTED: [number, number, number] = [86, 97, 109];
const LINE: [number, number, number] = [214, 220, 226];
const OUTBOUND: [number, number, number] = [67, 56, 202];
const HAIRLINE = 0.15;
const LOCAL: [number, number, number] = [13, 127, 87];
/** Grafik SVG'si bu piksel genişliğinde çizilip içerik genişliğine ölçeklenir. */
const CHART_PX = 720;
export const TABLE_MAX_ROWS = 25;
const CHART_TABLE_MAX_ROWS = 15;

const dateTimeFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

async function loadFont(weight: "Regular" | "SemiBold"): Promise<string> {
  const res = await fetch(`/fonts/report/IBMPlexSans-${weight}.ttf`);
  if (!res.ok) throw new Error(`Rapor fontu yüklenemedi (${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function registerFonts(doc: jsPDF) {
  const [regular, semibold] = await Promise.all([loadFont("Regular"), loadFont("SemiBold")]);
  doc.addFileToVFS("IBMPlexSans-Regular.ttf", regular);
  doc.addFont("IBMPlexSans-Regular.ttf", FONT, "normal");
  doc.addFileToVFS("IBMPlexSans-SemiBold.ttf", semibold);
  doc.addFont("IBMPlexSans-SemiBold.ttf", FONT, "bold");
  doc.setFont(FONT, "normal");
}

/** Dikey yerleşimi ve sayfa geçişlerini izleyen küçük yardımcı. */
class Cursor {
  y = PAGE.margin;
  constructor(private doc: jsPDF) {}
  get remaining() {
    return PAGE.h - PAGE.margin - 10 - this.y;
  }
  ensure(height: number) {
    if (height > this.remaining) this.newPage();
  }
  newPage() {
    this.doc.addPage();
    this.y = PAGE.margin;
  }
}

function text(doc: jsPDF, cur: Cursor, value: string, opts: { size: number; bold?: boolean; color?: [number, number, number]; gap?: number; lineHeight?: number }) {
  doc.setFont(FONT, opts.bold ? "bold" : "normal");
  doc.setFontSize(opts.size);
  doc.setTextColor(...(opts.color ?? INK));
  const lines: string[] = doc.splitTextToSize(value, CONTENT_W);
  const lh = (opts.size * (opts.lineHeight ?? 1.35)) / 2.835; // pt → mm
  for (const line of lines) {
    cur.ensure(lh);
    doc.text(line, PAGE.margin, cur.y + lh * 0.8);
    cur.y += lh;
  }
  cur.y += opts.gap ?? 0;
}

async function drawChart(doc: jsPDF, cur: Cursor, item: ReportItem): Promise<boolean> {
  const spec = buildChartSpec(item.chart, item.result);
  if (spec.kind === "table") return false;

  if (spec.kind === "kpi") {
    const cols = Math.min(spec.items.length, 3);
    const gap = 4;
    const w = (CONTENT_W - gap * (cols - 1)) / cols;
    const h = 20;
    spec.items.forEach((kpi, i) => {
      if (i % cols === 0) cur.ensure(h + gap);
      const x = PAGE.margin + (i % cols) * (w + gap);
      doc.setLineWidth(HAIRLINE);
      doc.setDrawColor(...LINE);
      doc.roundedRect(x, cur.y, w, h, 2, 2, "S");
      doc.setFont(FONT, "normal").setFontSize(8).setTextColor(...MUTED);
      doc.text(doc.splitTextToSize(kpi.label, w - 8)[0], x + 4, cur.y + 6.5);
      doc.setFont(FONT, "bold").setFontSize(15).setTextColor(...INK);
      doc.text(typeof kpi.value === "number" ? formatKpi(kpi.value, kpi.percent) : String(kpi.value), x + 4, cur.y + 15);
      if (i % cols === cols - 1 || i === spec.items.length - 1) cur.y += h + gap;
    });
    return true;
  }

  const pxH = chartHeight(spec);
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: CHART_PX, height: pxH });
  chart.setOption(buildOption(spec, PRINT_THEME));
  const svgMarkup = chart.renderToSVGString();
  chart.dispose();

  const mmH = (pxH * CONTENT_W) / CHART_PX;
  cur.ensure(mmH);
  // svg2pdf hesaplanmış stilleri okuyabilsin diye öğe kısa süreliğine belgeye eklenir.
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;";
  host.innerHTML = svgMarkup;
  document.body.appendChild(host);
  try {
    const svg = host.querySelector("svg");
    if (!svg) return false;
    await doc.svg(svg, { x: PAGE.margin, y: cur.y, width: CONTENT_W, height: mmH });
  } finally {
    host.remove();
  }
  cur.y += mmH + 3;
  return true;
}

function drawTable(doc: jsPDF, cur: Cursor, result: QueryResult, maxRows: number) {
  const roles = columnRoles(result);
  const rows = result.rows.slice(0, maxRows);
  autoTable(doc, {
    startY: cur.y,
    margin: { left: PAGE.margin, right: PAGE.margin, top: PAGE.margin, bottom: PAGE.margin + 10 },
    head: [result.columns],
    body: rows.map((r) =>
      result.columns.map((c) => {
        const v = r[c];
        return typeof v === "number" && isRate(result, c) ? formatKpi(v, true) : formatCell(v);
      }),
    ),
    styles: { font: FONT, fontSize: 8, textColor: INK, cellPadding: 1.6, lineColor: LINE, lineWidth: 0.1 },
    headStyles: { font: FONT, fontStyle: "bold", fillColor: [238, 241, 244], textColor: MUTED },
    columnStyles: Object.fromEntries(result.columns.map((c, i) => [i, { halign: roles[c] === "number" ? "right" : "left" }])),
    theme: "grid",
  });
  cur.y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 2;
  if (result.rows.length > maxRows) {
    text(doc, cur, `İlk ${maxRows} satır gösteriliyor (toplam ${result.rows.length.toLocaleString("tr-TR")}).`, { size: 7.5, color: MUTED });
  }
  cur.y += 3;
}

function drawCover(doc: jsPDF, cur: Cursor, items: ReportItem[], generatedAt: Date) {
  doc.setFillColor(...LOCAL);
  doc.rect(PAGE.margin, cur.y, 14, 1.2, "F");
  cur.y += 6;
  text(doc, cur, "InsightFlow analiz raporu", { size: 22, bold: true, gap: 1 });
  const datasets = [...new Set(items.map((i) => i.datasetName))];
  text(doc, cur, `${dateTimeFmt.format(generatedAt)} · ${items.length} analiz · ${datasets.join(", ")}`, { size: 9.5, color: MUTED, gap: 5 });

  const boxH = 17;
  doc.setDrawColor(...LINE);
  doc.setFillColor(247, 249, 250);
  doc.roundedRect(PAGE.margin, cur.y, CONTENT_W, boxH, 2, 2, "FD");
  doc.setFont(FONT, "bold").setFontSize(8.5).setTextColor(...LOCAL);
  doc.text("Bu rapor tarayıcında oluşturuldu", PAGE.margin + 5, cur.y + 6.5);
  doc.setFont(FONT, "normal").setFontSize(8).setTextColor(...MUTED);
  doc.text(
    doc.splitTextToSize(
      "Veri dosyası hiçbir sunucuya yüklenmedi; sorgular cihazında çalıştı. Yapay zekâya yalnızca sütun adları ve tipleri, onay verildiyse yönetici özeti için toplu sonuç tabloları gönderildi.",
      CONTENT_W - 10,
    ),
    PAGE.margin + 5,
    cur.y + 11,
  );
  cur.y += boxH + 8;
}

function drawFooters(doc: jsPDF) {
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setLineWidth(HAIRLINE);
    doc.setDrawColor(...LINE);
    doc.line(PAGE.margin, PAGE.h - PAGE.margin - 4, PAGE.w - PAGE.margin, PAGE.h - PAGE.margin - 4);
    doc.setFont(FONT, "normal").setFontSize(7.5).setTextColor(...MUTED);
    doc.text("InsightFlow · tarayıcıda oluşturuldu", PAGE.margin, PAGE.h - PAGE.margin + 1);
    doc.text(`Sayfa ${p} / ${total}`, PAGE.w - PAGE.margin, PAGE.h - PAGE.margin + 1, { align: "right" });
  }
}

export async function buildReport(items: ReportItem[], generatedAt = new Date()): Promise<jsPDF> {
  if (items.length === 0) throw new Error("Rapor için en az bir analiz gerekli.");
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.setProperties({ title: "InsightFlow analiz raporu", creator: "InsightFlow" });
  await registerFonts(doc);
  // jsPDF'in varsayılan 0,2 mm çizgisi kutu ve ayırıcılarda ağır duruyor; ince saç çizgisi kullan.
  doc.setLineWidth(HAIRLINE);
  const cur = new Cursor(doc);
  drawCover(doc, cur, items, generatedAt);

  for (const [index, item] of items.entries()) {
    // Başlık ve görsel bölünmesin: kısa kalan sayfada yeni sayfaya geç.
    if (index > 0) {
      if (cur.remaining < 110) cur.newPage();
      else {
        // svg2pdf grafik çizdikten sonra çizgi kalınlığını kendi değerinde bırakıyor; her çizimden önce yeniden ayarla.
        doc.setLineWidth(HAIRLINE);
        doc.setDrawColor(...LINE);
        doc.line(PAGE.margin, cur.y, PAGE.w - PAGE.margin, cur.y);
        cur.y += 7;
      }
    }
    text(doc, cur, `ANALİZ ${index + 1} · ${item.datasetName.toLocaleUpperCase("tr-TR")} · ${dateTimeFmt.format(item.createdAt)}`, { size: 7, color: MUTED, gap: 1.5 });
    text(doc, cur, item.question, { size: 14, bold: true, gap: 1.5 });
    if (item.explanation) text(doc, cur, item.explanation, { size: 9.5, color: MUTED, gap: 4 });

    if (item.result.rows.length === 0) {
      text(doc, cur, "Sorgu çalıştı ama koşula uyan kayıt yok.", { size: 9.5, color: MUTED, gap: 4 });
    } else {
      const drewChart = await drawChart(doc, cur, item);
      // Grafiğin yanında küçük sonuçlarda veri tablosu da verilir: baskıda değerler okunabilsin.
      if (!drewChart) drawTable(doc, cur, item.result, TABLE_MAX_ROWS);
      else if (buildChartSpec(item.chart, item.result).kind !== "kpi" && item.result.rows.length <= CHART_TABLE_MAX_ROWS) {
        drawTable(doc, cur, item.result, CHART_TABLE_MAX_ROWS);
      }
    }

    if (item.summary) {
      doc.setFont(FONT, "normal").setFontSize(10);
      const lines: string[] = doc.splitTextToSize(item.summary, CONTENT_W - 6);
      const h = 6 + lines.length * 4.6;
      cur.ensure(h + 2);
      doc.setFillColor(...OUTBOUND);
      doc.rect(PAGE.margin, cur.y, 0.8, h, "F");
      doc.setFontSize(7.5).setTextColor(...MUTED);
      doc.text("YÖNETİCİ ÖZETİ", PAGE.margin + 4, cur.y + 3.5);
      doc.setFontSize(10).setTextColor(...INK);
      doc.text(lines, PAGE.margin + 4, cur.y + 8.5);
      cur.y += h + 4;
    }

    text(doc, cur, "SQL", { size: 7, bold: true, color: MUTED, gap: 0.5 });
    text(doc, cur, item.sql.replace(/\s+/g, " ").trim(), { size: 7.5, color: MUTED, gap: 4, lineHeight: 1.3 });
  }

  drawFooters(doc);
  return doc;
}

export function reportFileName(date = new Date()): string {
  const d = date.toISOString().slice(0, 10);
  return `insightflow-rapor-${d}.pdf`;
}

export async function downloadReport(items: ReportItem[]): Promise<void> {
  const doc = await buildReport(items);
  doc.save(reportFileName());
}
