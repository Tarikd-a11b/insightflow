import { describe, expect, it } from "vitest";
import { toColumnPayload } from "../api";
import { countSharedValues, normalizeValues, sampleValueCandidates } from "./sample-values";
import type { ColumnProfile } from "./types";

const col = (name: string, kind: ColumnProfile["kind"], distinct: number, identifier = false): ColumnProfile => ({
  name,
  type: kind === "text" ? "VARCHAR" : "DOUBLE",
  kind,
  min: null,
  max: null,
  distinct,
  nullPercent: 0,
  categorical: kind === "text" && distinct <= 50,
  identifier,
});

describe("sampleValueCandidates", () => {
  it("yalnızca kimlik olmayan, en fazla 12 değerli metin sütunlarını aday sayar", () => {
    const columns = [
      col("islem_turu", "text", 2),
      col("kalem", "text", 9),
      col("musteri_adi", "text", 4000),
      col("sehir", "text", 81),
      col("musteri_id", "text", 5, true),
      col("tutar", "numeric", 3),
    ];
    expect(sampleValueCandidates(columns).map((c) => c.name)).toEqual(["islem_turu", "kalem"]);
  });
});

describe("normalizeValues", () => {
  it("boşları ve tekrarları atar, uzunluğu ve sayıyı sınırlar, kontrol karakterlerini temizler", () => {
    expect(normalizeValues(["Gelir", null, "Gider", "Gelir", "  "])).toEqual(["Gelir", "Gider"]);
    expect(normalizeValues(["a".repeat(80)])[0]).toHaveLength(60);
    expect(normalizeValues(Array.from({ length: 20 }, (_, i) => `k${i}`))).toHaveLength(12);
    expect(normalizeValues(["satır\nsonu"])).toEqual(["satır sonu"]);
  });
});

describe("toColumnPayload", () => {
  it("paylaşılmayan sütunlara values eklemez", () => {
    const columns = [col("islem_turu", "text", 2), col("tutar", "numeric", 100)];
    expect(toColumnPayload(columns)).toEqual([
      { name: "islem_turu", type: "VARCHAR" },
      { name: "tutar", type: "DOUBLE" },
    ]);
    const shared = { islem_turu: ["Gelir", "Gider"] };
    expect(toColumnPayload(columns, shared)[0]).toEqual({ name: "islem_turu", type: "VARCHAR", values: ["Gelir", "Gider"] });
    expect(countSharedValues(shared)).toBe(2);
  });
});
