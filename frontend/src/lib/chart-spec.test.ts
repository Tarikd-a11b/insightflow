import { describe, expect, it } from "vitest";
import { buildChartSpec, getAvailableChartKinds, isRate, MAX_SERIES } from "./chart-spec";
import type { QueryResult } from "./data/types";

const result = (columns: string[], rows: unknown[][]): QueryResult => ({
  columns,
  rows: rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]]))),
  ms: 1,
});

describe("buildChartSpec", () => {
  it("zaman serisini çizgiye çevirir ve tarihe göre sıralar", () => {
    const spec = buildChartSpec("line", result(["ay", "ciro"], [["2024-02-01", 20], ["2024-01-01", 10]]));
    expect(spec.kind).toBe("line");
    if (spec.kind !== "line") return;
    expect(spec.series).toHaveLength(1);
    expect(spec.series[0].data[0]).toEqual(["2024-01-01", 10]);
  });

  it("uzun biçimli zaman serisini kategoriye göre serilere ayırır ve fazlasını Diğer'e katlar", () => {
    const rows: unknown[][] = [];
    ["A", "B", "C", "D", "E", "F"].forEach((k, i) => {
      rows.push(["2024-01-01", k, 100 - i * 10], ["2024-02-01", k, 110 - i * 10]);
    });
    const spec = buildChartSpec("line", result(["ay", "kategori", "ciro"], rows));
    expect(spec.kind).toBe("line");
    if (spec.kind !== "line") return;
    expect(spec.series.map((s) => s.name)).toEqual(["A", "B", "C", "Diğer"]);
    expect(spec.series.length).toBeLessThanOrEqual(MAX_SERIES);
    // Diğer = D+E+F
    expect(spec.series[3].data[0]).toEqual(["2024-01-01", 70 + 60 + 50]);
  });

  it("kategori + ölçüyü bara çevirir", () => {
    const spec = buildChartSpec("bar", result(["sehir", "ciro"], [["İstanbul", 5], ["Ankara", 3]]));
    expect(spec).toMatchObject({ kind: "bar", categories: ["İstanbul", "Ankara"] });
  });

  it("farklı büyüklükteki ölçüleri tek eksende çizmez", () => {
    const spec = buildChartSpec("bar", result(["plan", "musteri_sayisi", "gelir"], [["Pro", 2000, 900000], ["Starter", 3400, 160000]]));
    expect(spec.kind === "bar" && spec.series.map((s) => s.name)).toEqual(["Musteri sayisi"]);
  });

  it("tek satırı KPI olarak gösterir, oranı yüzde işaretler", () => {
    const spec = buildChartSpec("table", result(["musteri_sayisi", "churn_orani"], [[231, 0.18]]));
    expect(spec).toEqual({
      kind: "kpi",
      items: [
        { label: "Musteri sayisi", value: 231, percent: false },
        { label: "Churn orani", value: 0.18, percent: true },
      ],
    });
  });

  it("uymayan ipucunda şekle göre seçer", () => {
    const spec = buildChartSpec("scatter", result(["kanal", "adet"], [["Web", 3], ["Mobil", 5]]));
    expect(spec.kind).toBe("bar");
  });

  it("iki sayısal sütunu dağılıma çevirir", () => {
    const spec = buildChartSpec("scatter", result(["indirim", "adet"], [[0.1, 1], [0.2, 2], [0, 1]]));
    expect(spec.kind === "scatter" && spec.series[0].data).toHaveLength(3);
  });

  it("grafiğe uygun olmayan sonucu tabloda bırakır", () => {
    expect(buildChartSpec("bar", result(["ad", "sehir"], [["a", "b"], ["c", "d"]])).kind).toBe("table");
    expect(buildChartSpec("bar", result(["x"], [])).kind).toBe("table");
  });

  it("uygun kategori ve pozitif değerleri donut/halka grafiğe çevirir", () => {
    const spec = buildChartSpec("donut", result(["kategori", "tutar"], [["Elektronik", 1500], ["Giyim", 800], ["Gıda", 600]]));
    expect(spec.kind).toBe("donut");
    if (spec.kind === "donut") {
      expect(spec.series).toHaveLength(3);
      expect(spec.series[0]).toEqual({ name: "Elektronik", value: 1500 });
    }
  });

  it("negatif değer içeren veriyi donut grafiğe çevirmez", () => {
    const spec = buildChartSpec("donut", result(["kategori", "kar"], [["A", 100], ["B", -50]]));
    expect(spec.kind).not.toBe("donut");
  });

  it("getAvailableChartKinds doğru kısıt ve nedenleri döner", () => {
    const timeData = result(["ay", "ciro"], [["2024-01-01", 100], ["2024-02-01", 150]]);
    const options = getAvailableChartKinds(timeData);
    const lineOpt = options.find((o) => o.kind === "line");
    const scatterOpt = options.find((o) => o.kind === "scatter");
    expect(lineOpt?.available).toBe(true);
    expect(scatterOpt?.available).toBe(false);
    expect(scatterOpt?.reason).toContain("en az 2 sayısal");
  });
});

describe("isRate", () => {
  it("adı oran olmayan 0-1 değerleri yüzde saymaz", () => {
    const r = result(["indirim", "iade_orani"], [[0.1, 0.14]]);
    expect(isRate(r, "indirim")).toBe(false);
    expect(isRate(r, "iade_orani")).toBe(true);
  });
});
