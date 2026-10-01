import { normalizePegawaiNik } from "./pegawaiNik";

export type AnakPtkSource = {
  siswa: { id: string; nama: string; nis: string | null; status: string | null; departemen_id: string | null; angkatan_id: string | null }[];
  detail: { siswa_id: string; nik_ayah: string | null; nik_ibu: string | null }[];
  pegawai: { id: string; nama: string; status: string | null }[];
  nikPegawai: { pegawai_id: string; nik: string }[];
  kelas: { id: string; nama: string }[];
  penempatan: { siswa_id: string; kelas_id: string; tahun_ajaran_id: string; aktif: boolean }[];
  tarif: { id: string; jenis_id: string; siswa_id: string | null; kelas_id: string | null; tahun_ajaran_id: string | null; angkatan_id: string | null; aktif: boolean; nominal: number }[];
};
export type AnakPtkInput = { tahunAjaranId: string; tahunBukuId: string; jenisId: string };
export type AnakPtkItem = {
  siswaId: string; nama: string; nis: string | null; departemenId: string | null; kelas: string;
  orangTua: { pegawaiId: string; nama: string; hubungan: "ayah" | "ibu"; status: string }[];
  verifikasi: "perlu_verifikasi"; peringatan: string[];
  tarifStatus: "belum_diisi" | "sudah_diisi" | "perlu_tinjauan";
  nominalTarif: number | null; tarifUmumTersedia: boolean;
};
export type AnakPtkReport = {
  items: AnakPtkItem[];
  coverage: { siswaAktif: number; siswaTanpaNikOrangtuaValid: number; pegawaiAktif: number; pegawaiAktifTanpaNik: number };
};

function validNik(value: unknown): string | null {
  const nik = normalizePegawaiNik(value);
  return /^[0-9]{16}$/.test(nik) ? nik : null;
}

export function buildAnakPtkReport(data: AnakPtkSource, input: AnakPtkInput): AnakPtkReport {
  const detail = new Map(data.detail.map(row => [row.siswa_id, row]));
  const pegawai = new Map(data.pegawai.map(row => [row.id, row]));
  const kelas = new Map(data.kelas.map(row => [row.id, row.nama]));
  const nikOwners = new Map<string, typeof data.pegawai>();
  const hasNik = new Set<string>();
  for (const row of data.nikPegawai) {
    const nik = validNik(row.nik), owner = pegawai.get(row.pegawai_id);
    if (!nik || !owner) continue;
    hasNik.add(owner.id);
    nikOwners.set(nik, [...(nikOwners.get(nik) || []), owner]);
  }
  const active = data.siswa.filter(row => row.status === "aktif");
  const staff = data.pegawai.filter(row => row.status === "aktif");
  let incomplete = 0;
  const items: AnakPtkItem[] = [];
  for (const siswa of active) {
    const parent = detail.get(siswa.id);
    const ayah = validNik(parent?.nik_ayah), ibu = validNik(parent?.nik_ibu);
    if (!ayah && !ibu) incomplete++;
    const orangTua: AnakPtkItem["orangTua"] = [];
    for (const [hubungan, nik] of [["ayah", ayah], ["ibu", ibu]] as const) {
      if (!nik) continue;
      for (const owner of nikOwners.get(nik) || []) {
        orangTua.push({ pegawaiId: owner.id, nama: owner.nama, hubungan, status: owner.status || "tidak_diketahui" });
      }
    }
    if (!orangTua.length) continue;
    const classIds = [...new Set(data.penempatan.filter(row => row.siswa_id === siswa.id && row.aktif && row.tahun_ajaran_id === input.tahunAjaranId).map(row => row.kelas_id))];
    const peringatan: string[] = [];
    if (!classIds.length) peringatan.push("kelas_belum_ada");
    if (classIds.length > 1) peringatan.push("kelas_ganda");
    if (orangTua.some(row => row.status !== "aktif")) peringatan.push("pegawai_nonaktif");
    if (ayah && ibu && ayah === ibu) peringatan.push("nik_orangtua_sama");
    if (orangTua.some(row => (nikOwners.get(row.hubungan === "ayah" ? ayah! : ibu!) || []).length > 1)) peringatan.push("pegawai_ganda");

    const tariffs = data.tarif.filter(row => row.aktif && row.jenis_id === input.jenisId);
    const exact = tariffs.filter(row => row.siswa_id === siswa.id && row.tahun_ajaran_id === input.tahunBukuId && (!row.kelas_id || classIds.includes(row.kelas_id)));
    // Mirrors the two per-student book-year priorities in get_tarif_siswa.
    const byClass = exact.filter(row => row.kelas_id && classIds.includes(row.kelas_id));
    const selected = byClass.length ? byClass : exact.filter(row => !row.kelas_id);
    const nominalTarif = selected.length === 1 ? Number(selected[0].nominal) : null;
    const tarifUmumTersedia = tariffs.some(row => {
      if (row.tahun_ajaran_id && row.tahun_ajaran_id !== input.tahunBukuId) return false;
      if (row.siswa_id) return row.siswa_id === siswa.id && !row.tahun_ajaran_id && !row.kelas_id;
      if (row.kelas_id) return classIds.includes(row.kelas_id);
      if (row.angkatan_id) return row.angkatan_id === siswa.angkatan_id;
      return row.tahun_ajaran_id === input.tahunBukuId;
    });
    const tarifStatus = selected.length > 1 || (nominalTarif !== null && (!Number.isFinite(nominalTarif) || nominalTarif <= 0))
      ? "perlu_tinjauan" : nominalTarif === null ? "belum_diisi" : "sudah_diisi";
    items.push({
      siswaId: siswa.id, nama: siswa.nama, nis: siswa.nis, departemenId: siswa.departemen_id,
      kelas: classIds.map(id => kelas.get(id) || "Kelas tidak ditemukan").join(", ") || "Belum ditempatkan",
      orangTua, verifikasi: "perlu_verifikasi", peringatan, tarifStatus, nominalTarif, tarifUmumTersedia,
    });
  }
  return {
    items: items.sort((a, b) => a.nama.localeCompare(b.nama, "id-ID")),
    coverage: { siswaAktif: active.length, siswaTanpaNikOrangtuaValid: incomplete, pegawaiAktif: staff.length, pegawaiAktifTanpaNik: staff.filter(row => !hasNik.has(row.id)).length },
  };
}
