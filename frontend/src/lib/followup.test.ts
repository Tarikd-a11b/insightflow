import { describe, expect, it } from "vitest";
import { buildHistory, latestAnsweredId, MAX_HISTORY, type ContextTurn } from "./followup";

// sql: null → yanıtı olmayan tur (undefined verilirse varsayılan parametre devreye girerdi).
const t = (id: number, parentId?: number, sql: string | null = `SELECT ${id}`): ContextTurn => ({ id, question: `Soru ${id}?`, parentId, sql: sql ?? undefined });

describe("buildHistory", () => {
  it("bağlam turundan geriye ebeveyn zincirini en eski başta olacak şekilde kurar", () => {
    const turns = [t(1), t(2, 1), t(3), t(4, 2)];
    expect(buildHistory(turns, 4).map((h) => h.question)).toEqual(["Soru 1?", "Soru 2?", "Soru 4?"]);
  });

  it(`en fazla ${MAX_HISTORY} adım geriye gider`, () => {
    const turns = [t(1), t(2, 1), t(3, 2), t(4, 3), t(5, 4)];
    expect(buildHistory(turns, 5).map((h) => h.sql)).toEqual(["SELECT 3", "SELECT 4", "SELECT 5"]);
  });

  it("yanıtı olmayan tur zinciri keser; bağlam yoksa boş döner", () => {
    const turns = [t(1), t(2, 1, null), t(3, 2)];
    expect(buildHistory(turns, 3).map((h) => h.question)).toEqual(["Soru 3?"]);
    expect(buildHistory(turns, null)).toEqual([]);
    expect(buildHistory(turns, 2)).toEqual([]);
  });

  it("döngüsel ebeveyn bağında sonsuza gitmez", () => {
    const turns = [t(1, 2), t(2, 1)];
    expect(buildHistory(turns, 2)).toHaveLength(2);
  });
});

describe("latestAnsweredId", () => {
  it("en son başarılı yanıtı bulur", () => {
    expect(latestAnsweredId([t(1), t(2), t(3, undefined, null)])).toBe(2);
    expect(latestAnsweredId([])).toBeNull();
  });
});
