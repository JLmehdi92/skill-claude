/**
 * kie.ai bills in credits. Their price list (e.g. Wan 3.0: 8 credits = $0.04)
 * puts one credit at $0.005. Euros are derived with the USD->EUR rate frozen
 * on each generation, so past spending never moves with the exchange rate.
 */
export const USD_PER_CREDIT = 0.005;

export function creditsToUsd(credits: number): number {
  return round(credits * USD_PER_CREDIT, 4);
}

export function usdToEur(usd: number, usdEurRate: number): number {
  return round(usd * usdEurRate, 4);
}

export function creditsToEur(credits: number, usdEurRate: number): number {
  return usdToEur(creditsToUsd(credits), usdEurRate);
}

const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eurPrecise = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 3 });
const int = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

/** Small amounts keep a third decimal so a 0,036 € image does not read as 0,04 €. */
export function formatEur(value: number): string {
  return Math.abs(value) > 0 && Math.abs(value) < 0.1 ? eurPrecise.format(value) : eur.format(value);
}

export function formatCredits(credits: number): string {
  return `${int.format(credits)} crédit${credits > 1 ? "s" : ""}`;
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
