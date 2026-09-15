import { describe, expect, it } from "vitest";
import { buildColumnProfiles, classifyType, quoteIdent, type SummarizeRow } from "./profile";
import { suggestQuestions } from "./questions";

const row = (column_name: string, column_type: string, approx_unique: number, null_percentage = 0): SummarizeRow => ({
  column_name,
  column_type,
  min: null,
  max: null,
  approx_unique,
  null_percentage,
});

describe("classifyType", () => {
  it.each([
    ["BIGINT", "numeric"],
    ["DECIMAL(18,2)", "numeric"],
    ["DOUBLE", "numeric"],
    ["DATE", "temporal"],
    ["TIMESTAMP WITH TIME ZONE", "temporal"],
    ["BOOLEAN", "boolean"],
    ["VARCHAR", "text"],
    ["STRUCT(a INTEGER)", "other"],
  ])("%s → %s", (type, kind) => {
    expect(classifyType(type)).toBe(kind);
  });
});

describe("quoteIdent", () => {
  it("çift tırnakları kaçırır", () => {
    expect(quoteIdent('ad"; DROP TABLE data; --')).toBe('"ad""; DROP TABLE data; --"');
  });
});

describe("buildColumnProfiles", () => {
  const profiles = buildColumnProfiles(
    [
      row("order_id", "BIGINT", 10_000),
      row("customer_email", "VARCHAR", 9_990),
      row("category", "VARCHAR", 8),
      row("amount", "DOUBLE", 7_000, 1.5),
      row("order_date", "DATE", 700),
    ],
    10_000,
  );
  const by = Object.fromEntries(profiles.map((p) => [p.name, p]));

  it("id adlı ve neredeyse benzersiz metin sütunlarını kimlik sayar", () => {
    expect(by.order_id.identifier).toBe(true);
    expect(by.customer_email.identifier).toBe(true);
    expect(by.category.identifier).toBe(false);
  });

  it("az benzersiz değerli metni kategorik sayar", () => {
    expect(by.category.categorical).toBe(true);
    expect(by.amount.categorical).toBe(false);
  });

  it("tahmini benzersiz sayıyı satır sayısıyla sınırlar", () => {
    const [p] = buildColumnProfiles([row("x", "VARCHAR", 120)], 100);
    expect(p.distinct).toBe(100);
  });
});

describe("buildColumnProfiles + kesin benzersiz sayı", () => {
  it("verilirse tahmin yerine kesin sayıyı kullanır", () => {
    const [p] = buildColumnProfiles([row("sehir", "VARCHAR", 9)], 1000, new Map([["sehir", 8]]));
    expect(p.distinct).toBe(8);
  });
});

describe("suggestQuestions: e-ticaret şeması", () => {
  const cols = buildColumnProfiles(
    [
      row("siparis_id", "BIGINT", 26000),
      row("siparis_tarihi", "DATE", 730),
      row("sehir", "VARCHAR", 8),
      row("kategori", "VARCHAR", 6),
      row("kanal", "VARCHAR", 3),
      row("adet", "INTEGER", 4),
      row("birim_fiyat", "DOUBLE", 20000),
      row("toplam_tutar", "DOUBLE", 22000),
      row("iade_edildi", "BOOLEAN", 2),
    ],
    26000,
  );
  const qs = suggestQuestions(cols);

  it("adı ölçü gibi olan sütunu ana ölçü seçer", () => {
    expect(qs[0]).toBe("Aylara göre toplam_tutar nasıl değişti?");
  });

  it("kırılım olarak okunur sayıda kategorisi olan metin sütununu seçer, boolean'ı oran sorusuna çevirir", () => {
    expect(qs[1]).toBe("sehir bazında toplam_tutar nedir?");
    expect(qs).toContain("kategori bazında iade_edildi oranı nedir?");
  });
});

describe("suggestQuestions", () => {
  it("tarih + ölçü + kategori olan veri için trend ve kırılım önerir", () => {
    const cols = buildColumnProfiles(
      [row("order_id", "BIGINT", 5000), row("category", "VARCHAR", 8), row("amount", "DOUBLE", 4000), row("order_date", "DATE", 365)],
      5000,
    );
    const qs = suggestQuestions(cols);
    expect(qs[0]).toBe("Aylara göre toplam amount nasıl değişti?");
    expect(qs).toContain("category bazında toplam amount nedir?");
    expect(qs.some((q) => q.includes("order_id"))).toBe(false);
    expect(qs.length).toBeLessThanOrEqual(6);
  });

  it("kullanılabilir sütun yoksa genel bir soru döner", () => {
    const cols = buildColumnProfiles([row("id", "BIGINT", 100)], 100);
    expect(suggestQuestions(cols)).toEqual(["Bu veri setinde kaç kayıt var?"]);
  });
});
