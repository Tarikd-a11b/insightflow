import { describe, expect, it } from "vitest";
import { relationshipCandidates, relationshipPayload, tableNameFromFile } from "./tables";
import type { ColumnProfile } from "./types";

describe("tableNameFromFile", () => {
  it.each([
    ["musteriler.parquet", "musteriler"],
    ["Müşteri Listesi 2025.xlsx", "musteri_listesi_2025"],
    ["İADE-kayıtları (son).csv", "iade_kayitlari_son"],
    ["2024_satislar.csv", "t_2024_satislar"],
    ["data.csv", "data_tablo"],
    ["order.csv", "order_tablo"],
    ["😀.csv", "tablo"],
  ])("%s → %s", (file, expected) => {
    expect(tableNameFromFile(file)).toBe(expected);
  });

  it("backend kuralına uyar ve çakışmada numara ekler", () => {
    const name = tableNameFromFile("a".repeat(80) + ".csv");
    expect(name).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
    expect(tableNameFromFile("musteriler.csv", ["musteriler"])).toBe("musteriler_2");
    expect(tableNameFromFile("musteriler.csv", ["musteriler", "musteriler_2"])).toBe("musteriler_3");
  });
});

const col = (name: string, kind: ColumnProfile["kind"], distinct: number): ColumnProfile => ({
  name,
  type: kind === "text" ? "VARCHAR" : "BIGINT",
  kind,
  min: null,
  max: null,
  distinct,
  nullPercent: 0,
  categorical: false,
  identifier: name.endsWith("_id"),
});

describe("relationshipCandidates", () => {
  it("aynı adlı, uyumlu tipli ve anahtar olabilecek çeşitlilikteki sütunları eşler", () => {
    const tables = [
      { table: "data", columns: [col("musteri_id", "text", 1400), col("kategori", "text", 6), col("tutar", "numeric", 9000)] },
      { table: "musteriler", columns: [col("Musteri_ID", "text", 1500), col("kategori", "text", 6), col("tutar", "text", 50)] },
    ];
    const candidates = relationshipCandidates(tables);
    expect(candidates).toEqual([{ left: { table: "data", column: "musteri_id" }, right: { table: "musteriler", column: "Musteri_ID" } }]);
    expect(relationshipPayload(candidates.map((c) => ({ ...c, coverage: 0.9 })))).toEqual([
      { left: "data.musteri_id", right: "musteriler.Musteri_ID" },
    ]);
  });
});
