/**
 * Tesouro Direto prices and rates (Tesouro Transparente open data, no key).
 * The CSV holds every bond's daily rate since 2002; we keep only the latest day.
 */

const CSV_URL =
  "https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv";

export type CurvePoint = { maturity: string; years: number; value: number };

const iso = (dmy: string) => {
  const [d, m, y] = dmy.split("/");
  return `${y}-${m}-${d}`;
};

/** Parses the Tesouro CSV into the nominal (Prefixado) and real (IPCA+) curves of the latest date. */
export function parseCurves(text: string): { date: string; nominal: CurvePoint[]; real: CurvePoint[] } {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(";");
  const col = (name: string) => header.findIndex((h) => h.trim() === name);
  const iType = col("Tipo Titulo");
  const iMat = col("Data Vencimento");
  const iBase = col("Data Base");
  const iRate = col("Taxa Compra Manha");
  if ([iType, iMat, iBase, iRate].some((i) => i < 0)) throw new Error("tesouro: unexpected CSV header");

  let latest = "";
  const rows: Array<{ type: string; maturity: string; base: string; rate: number }> = [];
  for (const line of lines.slice(1)) {
    const c = line.split(";");
    const base = iso(c[iBase] ?? "");
    const rate = Number((c[iRate] ?? "").replace(",", "."));
    if (!isFinite(rate) || rate <= 0) continue;
    rows.push({ type: c[iType], maturity: iso(c[iMat] ?? ""), base, rate });
    if (base > latest) latest = base;
  }
  const baseMs = Date.parse(latest);
  const pick = (types: string[]) =>
    rows
      .filter((r) => r.base === latest && types.includes(r.type))
      .map((r) => ({ maturity: r.maturity, years: (Date.parse(r.maturity) - baseMs) / (365.25 * 86_400_000), value: r.rate }))
      .filter((p) => p.years > 0)
      .sort((a, b) => a.years - b.years);
  return {
    date: latest,
    nominal: pick(["Tesouro Prefixado", "Tesouro Prefixado com Juros Semestrais"]),
    real: pick(["Tesouro IPCA+", "Tesouro IPCA+ com Juros Semestrais"]),
  };
}

export async function curves() {
  const res = await fetch(CSV_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`tesouro ${res.status}`);
  return parseCurves(await res.text());
}
