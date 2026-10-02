import { describe, expect, it } from "vitest";
import type { ColumnProfile, QueryResult, TableProfile } from "./data/types";
import fixtures from "./why.fixtures.json";
import { decompose, describeWhy, DIM_KEY, explainChange, planBreakdown, rankBreakdown, reconciles, whyTarget, type WhyRunner } from "./why";

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

const table = (name: string, columns: ColumnProfile[]): TableProfile => ({ table: name, name, rowCount: 100, columns, loadMs: 0, sizeBytes: 0 });

const TABLES = [
  table("data", [
    col("siparis_tarihi", "temporal", 90),
    col("sehir", "text", 3),
    col("kategori", "text", 2),
    col("tutar", "numeric", 7),
    col("musteri_id", "text", 80, { identifier: true, categorical: false }),
    col("sabit", "text", 1),
  ]),
  table("musteriler", [col("musteri_id", "text", 80, { identifier: true, categorical: false }), col("segment", "text", 4)]),
];

describe("whyTarget", () => {
  it("tek zaman sütunlu, dönem başına tek satırlı sonucu kabul eder", () => {
    const r = result(["ay", "ciro", "adet"], [["2024-02-01", 5, 1], ["2024-01-01", 4, 2]]);
    expect(whyTarget(r)).toEqual({ timeCol: "ay", valueCols: ["ciro", "adet"], periods: ["2024-01-01", "2024-02-01"] });
  });

  it("kategori sütunu olan ya da tek satırlık sonucu reddeder", () => {
    expect(whyTarget(result(["ay", "sehir", "ciro"], [["2024-01-01", "A", 1], ["2024-02-01", "A", 2]]))).toBeNull();
    expect(whyTarget(result(["ay", "ciro"], [["2024-01-01", 1]]))).toBeNull();
    expect(whyTarget(result(["sehir", "ciro"], [["A", 1], ["B", 2]]))).toBeNull();
  });
});

describe("planBreakdown", () => {
  it("basit toplam sorgusunu filtresini koruyarak kategori kırılımına çevirir", () => {
    const plan = planBreakdown(fixtures.simple, "ay", "ciro", TABLES);
    if (!plan.ok) throw new Error(plan.reason);
    // Kimlik ve tek değerli sütunlar boyut olmaz; az değerli olan önce gelir.
    expect(plan.dims.map((d) => d.label)).toEqual(["kategori", "sehir"]);

    const node = (plan.build(plan.dims[1]) as unknown as { statements: { node: Record<string, unknown> }[] }).statements[0].node;
    const select = node.select_list as Record<string, unknown>[];
    expect(select.map((e) => e.alias)).toEqual(["ay", DIM_KEY, "ciro"]);
    expect(select[1].column_names).toEqual(["data", "sehir"]);
    expect(select[2].function_name).toBe("sum");
    expect(node.group_sets).toEqual([[0, 1]]);
    expect(node.modifiers).toEqual([]);
    expect(node.where_clause).toEqual(fixtures.simple.statements[0].node.where_clause);
    // Orijinal ağaç değişmemeli.
    expect(fixtures.simple.statements[0].node.select_list).toHaveLength(3);
  });

  it("COUNT(*) ölçüsünü de kabul eder", () => {
    expect(planBreakdown(fixtures.simple, "ay", "adet", TABLES).ok).toBe(true);
  });

  it("JOIN'de iki tablonun boyutlarını takma adlarıyla nitelikli kullanır", () => {
    const plan = planBreakdown(fixtures.join, "ay", "ciro", TABLES);
    if (!plan.ok) throw new Error(plan.reason);
    const segment = plan.dims.find((d) => d.label === "musteriler.segment");
    expect(segment?.ref).toEqual(["m", "segment"]);
    expect(plan.dims.find((d) => d.label === "data.sehir")?.ref).toEqual(["d", "sehir"]);
    const node = (plan.build(segment!) as unknown as { statements: { node: Record<string, unknown> }[] }).statements[0].node;
    expect(node.aggregate_handling).toBe("STANDARD_HANDLING");
  });

  it("ROUND(SUM(x)) sarmalayıcısını açar", () => {
    const plan = planBreakdown(fixtures.round, "ay", "ciro", TABLES);
    if (!plan.ok) throw new Error(plan.reason);
    const node = (plan.build(plan.dims[0]) as unknown as { statements: { node: Record<string, unknown> }[] }).statements[0].node;
    expect((node.select_list as Record<string, unknown>[])[2].function_name).toBe("sum");
  });

  it.each([
    ["avg", "ortalama", /toplanabilir bir ölçü değil/],
    ["count_distinct", "musteri", /toplanabilir bir ölçü değil/],
    ["cte", "ciro", /birden fazla adımdan/],
    ["union", "ciro", /birden fazla adımdan/],
    ["subquery", "ciro", /birden fazla adımdan/],
    ["having", "ciro", /HAVING/],
    ["distinct", "ciro", /DISTINCT/],
  ] as const)("%s sorgusunu gerekçesiyle reddeder", (name, value, reason) => {
    const plan = planBreakdown(fixtures[name], "ay", value, TABLES);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toMatch(reason);
  });

  it("çözümleme hatasını reddeder", () => {
    expect(planBreakdown({ error: true, error_message: "x" }, "ay", "ciro", TABLES).ok).toBe(false);
  });
});

const rows = (data: [string, string | null, number][]) => data.map(([ay, k, v]) => ({ ay, [DIM_KEY]: k, ciro: v }));

describe("decompose / rankBreakdown / reconciles", () => {
  const data = rows([
    ["2024-01-01", "İzmir", 100],
    ["2024-02-01", "İzmir", 40],
    ["2024-01-01", "Bursa", 50],
    ["2024-02-01", "Bursa", 60],
    ["2024-02-01", "Ankara", 10],
    ["2024-01-01", null, 5],
    ["2023-12-01", "İzmir", 999],
  ]);

  it("iki dönem arasındaki farkı değerlere böler, eksik dönemi 0 sayar", () => {
    const segs = decompose(data, "ay", "ciro", "2024-01-01", "2024-02-01");
    expect(segs).toEqual([
      { key: "İzmir", before: 100, after: 40, delta: -60 },
      { key: "Bursa", before: 50, after: 60, delta: 10 },
      { key: "Ankara", before: 0, after: 10, delta: 10 },
      { key: "(boş)", before: 5, after: 0, delta: -5 },
    ]);
    // Toplam değişim −45; en büyük düşüş katkısı İzmir'in −60'ı.
    expect(rankBreakdown("sehir", segs).topShare).toBeCloseTo(60 / 45);
    expect(reconciles(segs, 155, 110)).toBe(true);
    expect(reconciles(segs, 155, 120)).toBe(false);
  });
});

describe("describeWhy", () => {
  it("baskın kaynağı, ikinci etkeni ve ters yöndeki değeri yazar", () => {
    const best = rankBreakdown("sehir", [
      { key: "İzmir", before: 400, after: 250, delta: -150 },
      { key: "Ankara", before: 300, after: 250, delta: -50 },
      { key: "Bursa", before: 100, after: 125, delta: 25 },
    ]);
    const story = describeWhy("ciro", "Şubat 2024", "Mart 2024", 800, 625, best);
    expect(story.headline).toBe("Ciro, Şubat 2024 → Mart 2024 arasında 800 → 625 (-%21,9).");
    expect(story.details[0]).toBe("En büyük etken Sehir → İzmir: düşüşün %86 kadarı (400 → 250, -%37,5).");
    expect(story.details[1]).toBe("Onu Ankara izliyor (−50).");
    expect(story.details[2]).toBe("Buna karşın Bursa ters yönde +25 değişti.");
  });

  it("değişim yayılmışsa bunu söyler", () => {
    const best = rankBreakdown("kategori", [
      { key: "A", before: 100, after: 110, delta: 10 },
      { key: "B", before: 100, after: 110, delta: 10 },
      { key: "C", before: 100, after: 110, delta: 10 },
    ]);
    expect(describeWhy("ciro", "a", "b", 300, 330, best).details).toEqual(["Değişim tek bir kategori değerinde yoğunlaşmıyor; 3 farklı değere yayılmış."]);
  });

  it("değişim yoksa kırılım anlatmaz", () => {
    expect(describeWhy("ciro", "a", "b", 5, 5, null).headline).toMatch(/net bir değişim yok/);
  });
});

describe("explainChange", () => {
  const answer = result(["ay", "ciro"], [["2024-01-01", 155], ["2024-02-01", 110]]);
  const breakdown = result(["ay", DIM_KEY, "ciro"], [["2024-01-01", "İzmir", 100], ["2024-02-01", "İzmir", 40], ["2024-01-01", "Bursa", 55], ["2024-02-01", "Bursa", 70]]);
  const runner = (out: QueryResult): WhyRunner => ({
    parseSql: async () => fixtures.simple,
    renderSql: async () => "SELECT 1",
    query: async () => out,
  });
  const args = { sql: "x", result: answer, timeCol: "ay", valueCol: "ciro", from: "2024-01-01", to: "2024-02-01", tables: TABLES };

  it("kırılımları hesaplar ve en açıklayıcı olanı öne alır", async () => {
    const out = await explainChange(runner(breakdown), args);
    if (!out.ok) throw new Error(out.reason);
    expect(out.before).toBe(155);
    expect(out.after).toBe(110);
    expect(out.story.headline).toContain("Ocak 2024 → Şubat 2024");
    expect(out.breakdowns[0].segments[0].key).toBe("İzmir");
  });

  it("kırılım toplamı sonuçla tutmazsa analizi göstermez", async () => {
    const wrong = result(breakdown.columns, breakdown.rows.map((r) => Object.values({ ...r, ciro: (r.ciro as number) * 2 })));
    const out = await explainChange(runner(wrong), args);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/doğrulanamadı/);
  });
});
