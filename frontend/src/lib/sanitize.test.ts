import { describe, expect, it } from "vitest";
import { sanitizeError } from "./sanitize";

describe("sanitizeError", () => {
  it("tırnak içindeki veri değerlerini maskeler", () => {
    const out = sanitizeError("Conversion Error: Could not convert string 'Ayşe Kaya' to INT32");
    expect(out).not.toContain("Ayşe");
    expect(out).toContain("INT32");
  });

  it("sayısal değerleri maskeler ama satır konumunu korur", () => {
    const out = sanitizeError("Out of Range Error: value 18425075 is out of range\nLINE 1: SELECT 18425075");
    expect(out).not.toContain("18425075");
    expect(out).toContain("LINE 1:");
  });

  it("çift tırnaklı sütun adlarını korur", () => {
    const out = sanitizeError('Binder Error: Referenced column "tutar" not found. Candidate bindings: "toplam_tutar"');
    expect(out).toContain('"toplam_tutar"');
  });
});
