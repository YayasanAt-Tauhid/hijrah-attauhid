export function resolvePaymentAmount(
  selectedBillNominal: unknown | undefined,
  specificTariff: unknown,
  defaultNominal: unknown
): number {
  if (selectedBillNominal !== undefined) {
    const bill = Number(selectedBillNominal);
    return Number.isFinite(bill) && bill > 0 ? bill : 0;
  }
  return resolvePaymentTariff(specificTariff, defaultNominal);
}

export function resolvePaymentTariff(
  specificTariff: unknown,
  defaultNominal: unknown
): number {
  const specific = Number(specificTariff);
  if (Number.isFinite(specific) && specific > 0) return specific;

  const fallback = Number(defaultNominal);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
}
