import { afterEach, describe, expect, it, vi } from "vitest";
import { ask, MAX_REPAIRS } from "./ask";

const columns = [{ name: "sehir", type: "VARCHAR" }];
const okResult = { columns: ["n"], rows: [{ n: 1 }], ms: 3 };

function mockFetch(...bodies: unknown[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(bodies.shift()), { status: 200 });
    }),
  );
  return calls;
}

const sqlOk = (sql: string) => ({ status: "ok", sql, explanation: "x", chart: "table", limited: false });

afterEach(() => vi.unstubAllGlobals());

describe("ask", () => {
  it("ilk sorgu çalışırsa onarım istemez", async () => {
    const calls = mockFetch(sqlOk("SELECT 1"));
    const out = await ask({ query: async () => okResult }, "Soru?", columns, () => {});
    expect(out.kind).toBe("answer");
    expect(calls).toHaveLength(1);
  });

  it("hata verirse temizlenmiş mesajla onarım ister ve sonuç satırlarını göndermez", async () => {
    const calls = mockFetch(sqlOk("SELECT bad"), sqlOk("SELECT good"));
    const engine = {
      query: vi
        .fn()
        .mockRejectedValueOnce(new Error("Conversion Error: Could not convert string 'Ayşe' to INT32"))
        .mockResolvedValueOnce(okResult),
    };
    const steps: string[] = [];
    const out = await ask(engine, "Soru?", columns, (s) => steps.push(s.kind));

    expect(out.kind === "answer" && out.repairs).toBe(1);
    expect(calls[1].url).toMatch(/\/repair$/);
    expect(calls[1].body.error).not.toContain("Ayşe");
    expect(JSON.stringify(calls)).not.toContain("rows");
    expect(steps).toEqual(["writing", "running", "repairing", "running"]);
  });

  it(`${MAX_REPAIRS} onarımdan sonra vazgeçer`, async () => {
    const calls = mockFetch(...Array.from({ length: MAX_REPAIRS + 1 }, () => sqlOk("SELECT bad")));
    const out = await ask({ query: async () => Promise.reject(new Error("Binder Error")) }, "Soru?", columns, () => {});
    expect(out.kind).toBe("failed");
    expect(calls).toHaveLength(MAX_REPAIRS + 1);
  });

  it("yanıtlanamaz soruyu olduğu gibi döner", async () => {
    mockFetch({ status: "unanswerable", reason: "Veride yok." });
    const out = await ask({ query: async () => okResult }, "Soru?", columns, () => {});
    expect(out).toEqual({ kind: "unanswerable", reason: "Veride yok." });
  });
});
