import {
  defaultUniformSizes,
  readUniformSizes,
  uniformDepartment,
  type UniformSize,
} from "@/lib/ukuranSeragam";

/** Status siswa yang tampil di daftar seragam: aktif dan calon yang sudah diterima. */
export const SERAGAM_SISWA_STATUSES = ["aktif", "diterima"] as const;
export type SeragamSiswaStatus = (typeof SERAGAM_SISWA_STATUSES)[number];

const STATUS_LABEL: Record<SeragamSiswaStatus, string> = { aktif: "Aktif", diterima: "Calon diterima" };

export type SeragamKelengkapan = "lengkap" | "belum_lengkap" | "tidak_tersedia";
const KELENGKAPAN_LABEL: Record<SeragamKelengkapan, string> = {
  lengkap: "Lengkap",
  belum_lengkap: "Belum lengkap",
  tidak_tersedia: "Data seragam TK belum tersedia",
};

type DepartemenRef = { id: string; nama: string; kode?: string | null };

export type SeragamSiswaSource = {
  id: string;
  nis?: string | null;
  nama: string;
  jenis_kelamin?: string | null;
  status?: string | null;
  departemen_id?: string | null;
  /** Relasi satu-ke-satu; PostgREST dapat mengembalikan objek atau array. */
  siswa_detail?: unknown;
  kelas_siswa?: {
    aktif?: boolean | null;
    kelas?: { id: string; nama: string; departemen_id?: string | null } | null;
  }[] | null;
};

export type SeragamSiswaRow = {
  id: string;
  nama: string;
  nis: string;
  jenisKelaminKode: string;
  jenisKelamin: "Ikhwan" | "Akhwat" | "-";
  status: SeragamSiswaStatus;
  statusLabel: string;
  lembagaId: string;
  lembaga: string;
  kelasId: string;
  kelas: string;
  /** Empat stel: nama jenis (nama bawaan melabeli stel kosong) dan ukuran tersimpan. */
  stel: UniformSize[];
  /** Jumlah stel yang nama dan ukurannya sama-sama tersimpan. */
  terisi: number;
  kelengkapan: SeragamKelengkapan;
};

function firstDetail(value: unknown): Record<string, unknown> {
  const detail = Array.isArray(value) ? value[0] : value;
  return detail && typeof detail === "object" ? (detail as Record<string, unknown>) : {};
}

function isSeragamStatus(value: unknown): value is SeragamSiswaStatus {
  return (SERAGAM_SISWA_STATUSES as readonly string[]).includes(String(value));
}

export function buildSeragamSiswaRows(list: SeragamSiswaSource[], departemen: DepartemenRef[]): SeragamSiswaRow[] {
  const rows: SeragamSiswaRow[] = [];
  for (const siswa of list) {
    if (!isSeragamStatus(siswa.status)) continue;
    const detail = firstDetail(siswa.siswa_detail);
    const kelasAktif = siswa.kelas_siswa?.find((item) => item.aktif && item.kelas)?.kelas ?? null;
    // Siswa internal memakai katalog lembaga tujuan SPMB, sama seperti form siswa.
    const lembagaId = String(detail.spmb_departemen_tujuan_id || kelasAktif?.departemen_id || siswa.departemen_id || "");
    const dept = departemen.find((item) => item.id === lembagaId);
    const lembaga = dept?.kode || dept?.nama || "-";
    const code = uniformDepartment(dept);
    const gender = siswa.jenis_kelamin === "L" || siswa.jenis_kelamin === "P" ? siswa.jenis_kelamin : "";

    const saved = readUniformSizes(detail.ukuran_seragam);
    const terisi = code === "TK" ? 0 : saved.filter((item) => item.jenis.trim() && item.ukuran.trim()).length;
    const stel = code === "TK" ? saved : defaultUniformSizes(detail.ukuran_seragam, code, gender);
    const kelengkapan: SeragamKelengkapan = code === "TK" ? "tidak_tersedia" : terisi === 4 ? "lengkap" : "belum_lengkap";

    rows.push({
      id: siswa.id,
      nama: siswa.nama,
      nis: siswa.nis || "",
      jenisKelaminKode: gender,
      jenisKelamin: gender === "L" ? "Ikhwan" : gender === "P" ? "Akhwat" : "-",
      status: siswa.status,
      statusLabel: STATUS_LABEL[siswa.status],
      lembagaId,
      lembaga,
      kelasId: kelasAktif?.id || "",
      kelas: kelasAktif?.nama || "-",
      stel,
      terisi,
      kelengkapan,
    });
  }
  return rows.sort((a, b) => a.nama.localeCompare(b.nama, "id") || a.id.localeCompare(b.id));
}

export type SeragamSiswaFilters = {
  search: string;
  lembagaId: string;
  kelasId: string;
  jenisKelamin: string;
  status: string;
  kelengkapan: string;
};

export function filterSeragamSiswaRows(rows: SeragamSiswaRow[], filters: SeragamSiswaFilters): SeragamSiswaRow[] {
  const query = filters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (query && !row.nama.toLowerCase().includes(query) && !row.nis.toLowerCase().includes(query)) return false;
    if (filters.lembagaId !== "all" && row.lembagaId !== filters.lembagaId) return false;
    if (filters.kelasId !== "all" && row.kelasId !== filters.kelasId) return false;
    if (filters.jenisKelamin !== "all" && row.jenisKelaminKode !== filters.jenisKelamin) return false;
    if (filters.status !== "all" && row.status !== filters.status) return false;
    if (filters.kelengkapan !== "all" && row.kelengkapan !== filters.kelengkapan) return false;
    return true;
  });
}

export function seragamStelLabel(item: UniformSize): string {
  const jenis = item.jenis.trim();
  const ukuran = item.ukuran.trim();
  if (!jenis && !ukuran) return "-";
  return `${jenis || "(nama belum diisi)"}: ${ukuran || "Belum diisi"}`;
}

export function seragamKelengkapanLabel(value: SeragamKelengkapan): string {
  return KELENGKAPAN_LABEL[value];
}

export const SERAGAM_EXPORT_COLUMNS = [
  { key: "nama", label: "Nama" },
  { key: "nis", label: "NIS" },
  { key: "lembaga", label: "Lembaga" },
  { key: "kelas", label: "Kelas" },
  { key: "jenisKelamin", label: "Jenis Kelamin" },
  { key: "status", label: "Status" },
  { key: "stel1", label: "Stel 1" },
  { key: "stel2", label: "Stel 2" },
  { key: "stel3", label: "Stel 3" },
  { key: "stel4", label: "Stel 4" },
  { key: "kelengkapan", label: "Kelengkapan" },
];

export function seragamExportRows(rows: SeragamSiswaRow[]): Record<string, string>[] {
  return rows.map((row) => ({
    nama: row.nama,
    nis: row.nis,
    lembaga: row.lembaga,
    kelas: row.kelas,
    jenisKelamin: row.jenisKelamin,
    status: row.statusLabel,
    stel1: seragamStelLabel(row.stel[0]),
    stel2: seragamStelLabel(row.stel[1]),
    stel3: seragamStelLabel(row.stel[2]),
    stel4: seragamStelLabel(row.stel[3]),
    kelengkapan: seragamKelengkapanLabel(row.kelengkapan),
  }));
}
