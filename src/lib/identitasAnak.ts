/**
 * Jenis identitas anak yang boleh dipakai orang tua untuk menghubungkan akun ke siswa.
 * Dipakai bersama oleh server (portalChildIdentity) dan tiga formulir portal.
 */
export const JENIS_IDENTITAS_ANAK = ["nis", "nisn", "id_santri"] as const;
export type JenisIdentitasAnak = (typeof JENIS_IDENTITAS_ANAK)[number];

interface MetaIdentitasAnak {
  label: string;
  placeholder: string;
  inputMode: "numeric" | "decimal";
}

const META: Record<JenisIdentitasAnak, MetaIdentitasAnak> = {
  nis: { label: "NIS Anak", placeholder: "Nomor Induk Siswa", inputMode: "numeric" },
  nisn: { label: "NISN Anak", placeholder: "NISN 10 digit", inputMode: "numeric" },
  // ID Santri berformat YY.KK.NNN sehingga keyboard perlu memuat titik.
  id_santri: { label: "ID Santri Anak", placeholder: "Contoh: 23.01.007", inputMode: "decimal" },
};

export function metaIdentitasAnak(jenis: JenisIdentitasAnak): MetaIdentitasAnak {
  return META[jenis];
}
