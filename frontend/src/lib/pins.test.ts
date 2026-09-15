import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { pinStore } from "./pins";

const base = {
  datasetName: "E-ticaret satışları",
  question: "Kategori bazında ciro?",
  explanation: "",
  sql: "SELECT 1",
  chart: "bar" as const,
  result: { columns: ["kategori", "ciro"], rows: [{ kategori: "Giyim", ciro: 10 }], ms: 2 },
};

describe("pinStore", () => {
  it("ekler, en yeniyi başa koyarak listeler ve kaldırır", async () => {
    const listener = vi.fn();
    const unsubscribe = pinStore.subscribe(listener);

    const first = await pinStore.add(base);
    await new Promise((r) => setTimeout(r, 2));
    const second = await pinStore.add({ ...base, question: "İkinci?" });

    const listed = await pinStore.list();
    expect(listed.map((p) => p.id)).toEqual([second.id, first.id]);
    expect(listed[1].result.rows[0]).toEqual({ kategori: "Giyim", ciro: 10 });

    await pinStore.remove(first.id);
    expect((await pinStore.list()).map((p) => p.id)).toEqual([second.id]);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });
});
