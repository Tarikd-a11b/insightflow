/**
 * Veri ve grafik dışa aktarma (export) yardımcıları.
 * Tamamen tarayıcıda çalışır; veri sunucuya gönderilmez.
 */

import type { QueryResult } from "./data/types";

/**
 * Sorgu sonucunu Excel ile tam uyumlu (Türkçe karakter destekli UTF-8 BOM) CSV metnine çevirir.
 */
export function formatCsvContent(result: QueryResult): string {
  if (result.rows.length === 0) return "";

  const escapeCell = (val: unknown): string => {
    if (val === null || val === undefined) return "";
    const str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = result.columns.map(escapeCell).join(",");
  const rows = result.rows.map((row) =>
    result.columns.map((col) => escapeCell(row[col])).join(","),
  );

  // \uFEFF Byte Order Mark: Microsoft Excel'in Türkçe karakterleri doğru kodlamayla açmasını sağlar.
  return "\uFEFF" + [header, ...rows].join("\r\n");
}

/**
 * Sorgu sonucunu CSV dosyası olarak tarayıcıdan indirir.
 */
export function downloadCsv(result: QueryResult, filename = "insightflow-veri.csv"): void {
  const content = formatCsvContent(result);
  if (!content) return;

  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Verilen HTML kapsayıcısındaki SVG grafiğini yüksek çözünürlüklü (2x Retina) PNG olarak dışa aktarır.
 */
export async function downloadChartAsPng(
  containerEl: HTMLElement,
  filename = "insightflow-grafik.png",
): Promise<void> {
  const svg = containerEl.querySelector("svg");
  if (!svg) {
    throw new Error("Grafik SVG öğesi bulunamadı.");
  }

  const svgData = new XMLSerializer().serializeToString(svg);
  const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Grafik görüntüsü yüklenemedi."));
      img.src = url;
    });

    const scale = 2; // Yüksek kalite için 2x Retina
    const rect = svg.getBoundingClientRect();
    const width = (rect.width || 600) * scale;
    const height = (rect.height || 350) * scale;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context alınamadı.");

    // Arka planı beyaz yap
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const pngUrl = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = pngUrl;
    a.download = filename.endsWith(".png") ? filename : `${filename}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }
}
