import { describe, expect, it } from "vitest";
import { parseCurves } from "./tesouro.js";

const CSV = [
  "Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;PU Compra Manha;PU Venda Manha;PU Base Manha",
  "Tesouro Prefixado;01/01/2029;21/10/2026;13,10;13,22;700,00;699,00;699,50",
  "Tesouro Prefixado;01/01/2029;22/10/2026;13,05;13,17;700,00;699,00;699,50",
  "Tesouro Prefixado com Juros Semestrais;01/01/2035;22/10/2026;13,40;13,52;900,00;899,00;899,50",
  "Tesouro IPCA+;15/05/2035;22/10/2026;7,10;7,22;2000,00;1999,00;1999,50",
  "Tesouro Selic;01/03/2029;22/10/2026;0,05;0,06;15000,00;14990,00;14995,00",
].join("\n");

describe("tesouro.parseCurves", () => {
  it("keeps only the latest date and splits nominal / real curves", () => {
    const c = parseCurves(CSV);
    expect(c.date).toBe("2026-10-22");
    expect(c.nominal.map((p) => p.value)).toEqual([13.05, 13.4]);
    expect(c.nominal[0].years).toBeCloseTo(2.19, 1);
    expect(c.real).toHaveLength(1);
    expect(c.real[0].maturity).toBe("2035-05-15");
  });
});
