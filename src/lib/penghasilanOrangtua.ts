export const PENGHASILAN_OPTIONS = [
  ["1000000", "< Rp 1.000.000"],
  ["2000000", "Rp 1.000.000 s.d Rp 2.000.000"],
  ["5000000", "Rp 2.000.000 s.d Rp 5.000.000"],
  ["20000000", "Rp 5.000.000 s.d Rp 20.000.000"],
  ["30000000", "> Rp 20.000.000"],
] as const;

export const PENGHASILAN_VALUES = new Set<string>(
  PENGHASILAN_OPTIONS.map(([value]) => value),
);

export const PENGHASILAN_CHOICES = PENGHASILAN_OPTIONS.map(([value, label]) => ({
  value,
  label,
}));
