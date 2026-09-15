import { describe, expect, it } from "vitest";
import type { ColumnProfile, DatasetProfile, QueryResult } from "./data/types";
import { describeCorrelation, describeQuality, describeRate, describeShare, describeTrend, planInsights } from "./explore";

const result = (columns: string[], rows: unknown[][]): QueryResult => ({
  columns,
  rows: rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]]))),
  ms: 1,
});

const col = (name: string, kind: ColumnProfile["kind"], distinct: number, extra: Partial<ColumnProfile> = {}): ColumnProfile => ({
  name,
  type: kind,
  kind,
  min: null,
  max: null,
  distinct,
  nullPercent: 0,
  categorical: kind === "text" && distinct <= 50,
  identifier: false,
  ...extra,
});

describe("describeTrend", () => {
  it("en yüksek ayı ve son 3 ay değişimini yazar", () => {
    const months = ["2025-01-01", "2025-02-01", "2025-03-01", "2025-04-01", "2025-05-01", "2025-06-01"];
    const r = result(["ay", "ciro"], months.map((m, i) => [m, [100, 100, 100, 120, 130, 140][i]]));
    const text = describeTrend(r, "ciro", "ciro")!;
    expect(text).toContain("En yüksek ay Haziran 2025");
    expect(text).toMatch(/Son 3 ayda ciro önceki 3 aya göre %30 arttı\./);
  });

  it("ortalamadan 2 standart sapma aşağıdaki ayı olağan dışı düşük olarak işaretler", () => {
    const values = [100, 102, 98, 101, 99, 100, 103, 97, 100, 20];
    const r = result(["ay", "ciro"], values.map((v, i) => [`2024-${String(i + 1).padStart(2, "0")}-01`, v]));
    expect(describeTrend(r, "ciro", "ciro")).toContain("Ekim 2024 olağan dışı düşük kaldı");
  });

  it("3 aydan az veride içgörü üretmez", () => {
    expect(describeTrend(result(["ay", "ciro"], [["2025-01-01", 1], ["2025-02-01", 2]]), "ciro", "ciro")).toBeNull();
  });
});

describe("describeShare", () => {
  it("ilk kategorinin payını ve ilk 3'ün toplam payını yazar", () => {
    const r = result(["sehir", "toplam", "pay"], [["İstanbul", 50, 0.5], ["Ankara", 20, 0.2], ["İzmir", 10, 0.1], ["Bursa", 20, 0.2]]);
    expect(describeShare(r, "sehir", "toplam ciro")).toBe("İstanbul, toplam ciro içinde %50 payla ilk sırada. İlk 3 sehir, toplamın %80 kadarını oluşturuyor.");
  });
});

describe("describeRate", () => {
  it("en yüksek/en düşük grubu ve kayıt ağırlıklı genel oranı yazar", () => {
    const r = result(["kategori", "iade_orani", "kayit"], [["Giyim", 0.14, 100], ["Kitap", 0.04, 300]]);
    expect(describeRate(r, "kategori", "iade_orani", "iade")).toBe("iade oranı en yüksek Giyim (%14), en düşük Kitap (%4); genel oran %6,5.");
  });

  it("gruplar arasında fark yoksa içgörü üretmez", () => {
    expect(describeRate(result(["k", "o", "kayit"], [["a", 0.1, 5], ["b", 0.105, 5]]), "k", "o", "x")).toBeNull();
  });
});

describe("describeCorrelation", () => {
  it.each([
    [0.82, "güçlü pozitif ilişki var (r = 0,82)"],
    [-0.45, "orta düzeyde negatif ilişki var (r = -0,45)"],
    [0.05, "belirgin bir doğrusal ilişki yok"],
  ])("r = %s", (r, expected) => {
    expect(describeCorrelation(r, "a", "b")).toContain(expected);
  });
});

describe("describeQuality", () => {
  it("tekrar eden kayıtları ve seyrek sütunları yazar", () => {
    const r = result(["kayit", "tekrar_eden_kayit"], [[1000, 12]]);
    const columns = [col("not", "text", 10, { nullPercent: 40 }), col("tutar", "numeric", 900)];
    expect(describeQuality(r, columns)).toBe("1.000 kaydın 12 tanesi birebir tekrar ediyor; 1 sütunda %5'ten fazla boş değer var (not %40).");
  });
});

describe("planInsights", () => {
  const profile = (columns: ColumnProfile[]): DatasetProfile => ({ name: "t", rowCount: 1000, columns, loadMs: 1 });

  it("e-ticaret benzeri şemada beş içgörünün hepsini planlar ve yalnızca data tablosunu okur", () => {
    const plans = planInsights(
      profile([
        col("siparis_tarihi", "temporal", 700),
        col("kategori", "text", 6),
        col("kanal", "text", 3),
        col("toplam_tutar", "numeric", 900),
        col("birim_fiyat", "numeric", 800),
        col("iade_edildi", "boolean", 2),
      ]),
    );
    expect(plans.map((p) => p.id)).toEqual(["trend", "share", "rate", "correlation", "quality"]);
    for (const p of plans) {
      expect(p.sql).toMatch(/FROM data\b/);
      expect(p.sql).not.toMatch(/read_|glob|getenv/i);
    }
  });

  it("uygun sütun yoksa yalnızca veri kalitesi içgörüsü kalır", () => {
    expect(planInsights(profile([col("aciklama", "text", 900, { categorical: false })])).map((p) => p.id)).toEqual(["quality"]);
  });
});
