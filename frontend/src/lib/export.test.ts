import { describe, expect, it } from "vitest";
import { formatCsvContent } from "./export";

describe("formatCsvContent", () => {
  it("formats table rows with UTF-8 BOM, headers, and escapes quotes/commas", () => {
    const sampleResult = {
      columns: ["kategori", "tutar", "açıklama"],
      rows: [
        { kategori: "Elektronik", tutar: 1500.5, açıklama: "Telefon, Kılıf" },
        { kategori: "Giyim", tutar: 320, açıklama: 'Özel "İndirimli" Ürün' }
      ],
      ms: 12
    };

    const csv = formatCsvContent(sampleResult);
    
    // Starts with UTF-8 BOM
    expect(csv.startsWith("\uFEFF")).toBe(true);
    
    // Contains header
    expect(csv).toContain("kategori,tutar,açıklama");
    
    // Correctly quotes comma and internal double quotes
    expect(csv).toContain('"Telefon, Kılıf"');
    expect(csv).toContain('"Özel ""İndirimli"" Ürün"');
  });

  it("returns empty string for empty rows", () => {
    const emptyResult = { columns: ["a", "b"], rows: [], ms: 1 };
    expect(formatCsvContent(emptyResult)).toBe("");
  });
});
