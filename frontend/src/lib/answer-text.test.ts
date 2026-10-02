import { describe, expect, it } from "vitest";
import type { QueryResult } from "./data/types";
import { describeResult, pearson } from "./answer-text";

const result = (columns: string[], rows: unknown[][]): QueryResult => ({
  columns,
  rows: rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]]))),
  ms: 1,
});

describe("describeResult", () => {
  it("tek satırlık sonucu sayılarıyla söyler, oranı yüzde yazar", () => {
    expect(describeResult(result(["toplam_ciro", "iade_orani"], [[26_403_120.5, 0.073]]))?.replace(/ /g, " ")).toBe("Toplam ciro: 26,4 Mn · İade orani: %7,3.");
  });

  it("sıralamada en yüksek ve en düşüğü, toplanabilir değerde payı verir", () => {
    const r = result(["sehir", "ciro"], [["İstanbul", 500], ["Ankara", 200], ["İzmir", 150], ["Bursa", 100], ["Konya", 50]]);
    expect(describeResult(r)).toBe("En yüksek ciro: İstanbul (500, toplamın %50 kadarı). En düşük: Konya (50). İlk 3 değer toplamın %85 kadarını oluşturuyor.");
  });

  it("sıralama sırası ne olursa olsun en yüksek değeri bulur", () => {
    const r = result(["kanal", "siparis"], [["Web", 10], ["Mobil", 30]]);
    expect(describeResult(r)).toBe("En yüksek siparis: Mobil (30, toplamın %75 kadarı). En düşük: Web (10). Mobil, Web değerinin 3 katı.");
  });

  it("ortalama ya da oranda toplam payı vermez", () => {
    const avg = describeResult(result(["kategori", "ortalama_sepet"], [["A", 120], ["B", 80], ["C", 60]]))!;
    expect(avg).toBe("En yüksek ortalama sepet: A (120). En düşük: C (60).");
    const rate = describeResult(result(["plan", "churn_orani"], [["Pro", 0.12], ["Basic", 0.31]]))!;
    expect(rate).toBe("En yüksek churn orani: Basic (%31). En düşük: Pro (%12). Basic, Pro değerinin 2,6 katı.");
  });

  it("satır sınırında kesilen sonuçta payı vermez", () => {
    expect(describeResult(result(["sehir", "ciro"], [["A", 3], ["B", 1]]), true)).toBe("En yüksek ciro: A (3). En düşük: B (1). A, B değerinin 3 katı.");
  });

  it("zaman serisinde ilk-son değişimi ve zirveyi söyler", () => {
    const r = result(["ay", "ciro"], [["2025-03-01", 90], ["2025-01-01", 100], ["2025-02-01", 150]]);
    expect(describeResult(r)).toBe("Ciro, Ocak 2025 → Mart 2025: 100 → 90 (-%10). En yüksek dönem Şubat 2025 (150), en düşük Mart 2025 (90).");
  });

  it("uzun biçimli seride son dönemin liderini söyler", () => {
    const r = result(["ay", "kanal", "ciro"], [["2025-01-01", "Web", 50], ["2025-02-01", "Web", 40], ["2025-02-01", "Mobil", 60]]);
    expect(describeResult(r)).toMatch(/^Şubat 2025 döneminde: En yüksek ciro: Mobil \(60/);
  });

  it("iki sayısal sütunda ilişkiyi söyler", () => {
    const r = result(["indirim", "adet"], [[0, 1], [0.1, 2], [0.2, 3], [0.3, 4]]);
    expect(describeResult(r)).toMatch(/güçlü pozitif ilişki var \(r = 1\)/);
  });

  it("sayı olmayan ya da boş sonuçta cümle üretmez", () => {
    expect(describeResult(result(["sehir"], [["A"], ["B"]]))).toBeNull();
    expect(describeResult(result(["sehir", "ciro"], []))).toBeNull();
  });
});

describe("pearson", () => {
  it("sabit seride null döner", () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1);
  });
});
