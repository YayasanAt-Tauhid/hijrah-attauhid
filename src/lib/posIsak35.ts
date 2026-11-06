// Pos ISAK 35 menentukan di bagian mana sebuah akun rekening tampil di laporan ISAK 35.
// Akun dengan pos kosong (NULL) diabaikan oleh laporan, jadi form akun baru harus mengisinya.
// Nilai di bawah adalah nilai yang sudah dipakai akun produksi dan dipahami kode laporan.

export type PosIsak35Option = { value: string; label: string };

export const POS_ISAK35_BY_JENIS: Record<string, PosIsak35Option[]> = {
  aset: [
    { value: "aset_lancar", label: "Aset Lancar" },
    { value: "aset_tidak_lancar", label: "Aset Tidak Lancar" },
  ],
  liabilitas: [
    { value: "kewajiban_jangka_pendek", label: "Liabilitas Jangka Pendek" },
    { value: "kewajiban_jangka_panjang", label: "Liabilitas Jangka Panjang" },
  ],
  ekuitas: [{ value: "aset_neto_tidak_terikat", label: "Aset Neto Tidak Terikat" }],
  pendapatan: [{ value: "pendapatan_tidak_terikat", label: "Pendapatan Tidak Terikat" }],
  beban: [
    { value: "beban_program", label: "Beban Program" },
    { value: "beban_penunjang", label: "Beban Penunjang" },
  ],
};

const DEFAULT_POS_BY_JENIS: Record<string, string> = {
  aset: "aset_lancar",
  liabilitas: "kewajiban_jangka_pendek",
  ekuitas: "aset_neto_tidak_terikat",
  pendapatan: "pendapatan_tidak_terikat",
  beban: "beban_program",
};

export function defaultPosIsak35(jenis: string): string {
  return DEFAULT_POS_BY_JENIS[jenis] ?? "";
}

// Pilihan untuk satu jenis. Nilai lama di luar daftar (mis. akun lama) tetap ditampilkan
// supaya mengedit akun tidak mengubah pos-nya secara diam-diam.
export function posIsak35Options(jenis: string, current?: string | null): PosIsak35Option[] {
  const options = POS_ISAK35_BY_JENIS[jenis] ?? [];
  if (!current || options.some((option) => option.value === current)) return options;
  return [...options, { value: current, label: current }];
}

export function posIsak35Label(value?: string | null): string {
  if (!value) return "";
  for (const options of Object.values(POS_ISAK35_BY_JENIS)) {
    const found = options.find((option) => option.value === value);
    if (found) return found.label;
  }
  return value;
}

// Saat jenis akun diganti: pertahankan pos bila masih cocok, jika tidak pakai nilai awal jenis baru.
export function posAfterJenisChange(previous: string, newJenis: string): string {
  const valid = (POS_ISAK35_BY_JENIS[newJenis] ?? []).some((option) => option.value === previous);
  return valid ? previous : defaultPosIsak35(newJenis);
}

// Laporan arus kas hanya menghitung akun yang namanya menunjukkan kas, bank, atau dompet digital.
export function isAkunKas(_kode: string, nama: string): boolean {
  const n = (nama || "").toUpperCase().trim();
  return n === "KAS" || n.startsWith("KAS ")
    || n === "BANK" || n.startsWith("BANK ")
    || /^E[\s-]?WALLET(\s|$)/.test(n);
}
