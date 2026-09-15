import { afterEach, describe, expect, it, vi } from "vitest";
import { requestRepair, requestSql, requestSummary } from "./api";
import { outboundLog, totals } from "./outbound-log";

afterEach(() => {
  vi.unstubAllGlobals();
  outboundLog.clear();
});

function respond(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

const columns = [
  { name: "sehir", type: "VARCHAR" },
  { name: "tutar", type: "DOUBLE" },
];

describe("outboundLog", () => {
  it("her isteğin gövdesini birebir ve durumuyla kaydeder", async () => {
    respond({ status: "ok", sql: "SELECT 1", explanation: "", chart: "table", limited: false });
    await requestSql("Soru?", { columns });
    const [entry] = outboundLog.snapshot();
    expect(entry).toMatchObject({ kind: "sql", status: 200, body: { question: "Soru?", columns } });
  });

  it("şerit sayıları kayıttan türetilir: en geniş şema + özet satırları", async () => {
    respond({ status: "ok", sql: "SELECT 1", explanation: "", chart: "table", limited: false });
    await requestSql("A?", { columns });
    await requestRepair({ question: "A?", schema: { columns }, sql: "x", error: "e", attempt: 1 });
    respond({ summary: "özet" });
    await requestSummary({ question: "A?", sql: "SELECT 1", columns: ["a"], rows: [[1], [2], [3]] });
    expect(totals(outboundLog.snapshot())).toEqual({ columns: 2, summaryRows: 3, sampleValues: 0, requests: 3 });
  });

  it("onayla paylaşılan örnek değerler istekler arasında tekrar sayılmaz", async () => {
    respond({ status: "ok", sql: "SELECT 1", explanation: "", chart: "table", limited: false });
    const shared = [{ name: "islem_turu", type: "VARCHAR", values: ["Gelir", "Gider"] }, ...columns];
    await requestSql("A?", { columns: shared });
    await requestSql("B?", { columns: shared });
    expect(totals(outboundLog.snapshot()).sampleValues).toBe(2);
  });

  it("ek tabloların sütunları ve örnek değerleri de sayılır", async () => {
    respond({ status: "ok", sql: "SELECT 1", explanation: "", chart: "table", limited: false });
    await requestSql("A?", {
      columns,
      tables: [{ name: "musteriler", columns: [{ name: "segment", type: "VARCHAR", values: ["Kurumsal", "Bireysel"] }] }],
      relationships: [{ left: "data.sehir", right: "musteriler.segment" }],
    });
    const body = outboundLog.snapshot()[0].body;
    expect(body).toHaveProperty("tables");
    expect(totals(outboundLog.snapshot())).toMatchObject({ columns: 3, sampleValues: 2 });
  });

  it("ağ hatasında da kayıt kalır (gövde tarayıcıdan çıkmış olabilir)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    await expect(requestSql("A?", { columns })).rejects.toThrow(/ulaşılamadı/);
    expect(outboundLog.snapshot()[0].status).toBe(0);
  });

  it("temizlenince sıfırlanır", async () => {
    respond({ status: "unanswerable", reason: "yok" });
    await requestSql("A?", { columns });
    outboundLog.clear();
    expect(totals(outboundLog.snapshot())).toEqual({ columns: 0, summaryRows: 0, sampleValues: 0, requests: 0 });
  });
});
