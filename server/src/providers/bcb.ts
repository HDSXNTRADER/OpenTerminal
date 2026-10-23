/**
 * Banco Central do Brasil open data (SGS time series), no key required.
 * https://dadosabertos.bcb.gov.br/
 */

export type BcbPoint = { date: string; value: number };

const SERIES = {
  selic: 432, // Selic target rate, % a.a.
  cdi: 4389, // CDI annualised (252 business days), % a.a.
  ipca12m: 13522, // IPCA inflation, trailing 12 months, %
} as const;

async function last(series: number): Promise<BcbPoint> {
  const res = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${series}/dados/ultimos/1?formato=json`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`bcb ${series} ${res.status}`);
  const rows: Array<{ data: string; valor: string }> = await res.json();
  const row = rows[rows.length - 1];
  if (!row) throw new Error(`bcb ${series}: empty`);
  // Dates come as dd/mm/yyyy.
  const [d, m, y] = row.data.split("/");
  return { date: `${y}-${m}-${d}`, value: Number(row.valor) };
}

export async function rates(): Promise<{ selic: BcbPoint | null; cdi: BcbPoint | null; ipca12m: BcbPoint | null }> {
  const [selic, cdi, ipca12m] = await Promise.allSettled([last(SERIES.selic), last(SERIES.cdi), last(SERIES.ipca12m)]);
  const v = <T,>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : null);
  const out = { selic: v(selic), cdi: v(cdi), ipca12m: v(ipca12m) };
  if (!out.selic && !out.cdi && !out.ipca12m) throw new Error("bcb: all series unavailable");
  return out;
}
