export function resolvePaymentTariff(
  specificTariff: unknown,
  defaultNominal: unknown
): number {
  const specific = Number(specificTariff);
  if (Number.isFinite(specific) && specific > 0) return specific;

  const fallback = Number(defaultNominal);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
}
