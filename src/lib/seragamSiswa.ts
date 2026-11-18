import {
  defaultUniformSizes,
  readUniformSizes,
  uniformDepartment,
  UNIFORM_SLOT_COUNT,
  type UniformSize,
} from "@/lib/ukuranSeragam";
import { MONITOR_PAYMENT_LABELS, type MonitorPaymentStatus } from "@/lib/spmbPaymentMonitor";
import { uangPangkalAmounts, uangPangkalKeterangan, uangPangkalStatus, type UangPangkalInfo } from "@/lib/seragamUangPangkal";

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
  /** Tahun ajaran dan gelombang pendaftaran SPMB (kosong bila siswa tidak punya data SPMB). */
  tahunAjaranId: string;
  gelombangId: string;
  /** Lima stel: nama jenis (nama bawaan melabeli stel kosong) dan ukuran tersimpan. */
  stel: UniformSize[];
  /** Jumlah stel yang nama dan ukurannya sama-sama tersimpan. */
  terisi: number;
  kelengkapan: SeragamKelengkapan;
  /** Dari Monitoring Pembayaran SPMB; null bila tidak ada datanya (atau peran tidak berhak melihat). */
  uangPangkal: UangPangkalInfo | null;
  statusUangPangkal: MonitorPaymentStatus;
};

function firstDetail(value: unknown): Record<string, unknown> {
  const detail = Array.isArray(value) ? value[0] : value;
  return detail && typeof detail === "object" ? (detail as Record<string, unknown>) : {};
}

function isSeragamStatus(value: unknown): value is SeragamSiswaStatus {
  return (SERAGAM_SISWA_STATUSES as readonly string[]).includes(String(value));
}

export function buildSeragamSiswaRows(
  list: SeragamSiswaSource[],
  departemen: DepartemenRef[],
  uangPangkal?: ReadonlyMap<string, UangPangkalInfo>,
): SeragamSiswaRow[] {
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
    const kelengkapan: SeragamKelengkapan = code === "TK" ? "tidak_tersedia" : terisi === UNIFORM_SLOT_COUNT ? "lengkap" : "belum_lengkap";

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
      tahunAjaranId: String(detail.tahun_ajaran_id || ""),
      gelombangId: String(detail.spmb_gelombang_id || ""),
      stel,
      terisi,
      kelengkapan,
      uangPangkal: uangPangkal?.get(siswa.id) ?? null,
      statusUangPangkal: uangPangkalStatus(uangPangkal?.get(siswa.id)),
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
  /** Sama seperti filter Tahun ajaran tujuan dan Gelombang di halaman SPMB. */
  tahunId: string;
  gelombangId: string;
  /** Status uang pangkal: "all" atau salah satu kunci MONITOR_PAYMENT_LABELS. */
  uangPangkal: string;
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
    if (filters.tahunId !== "all" && row.tahunAjaranId !== filters.tahunId) return false;
    if (filters.gelombangId !== "all" && row.gelombangId !== filters.gelombangId) return false;
    if (filters.uangPangkal !== "all" && row.statusUangPangkal !== filters.uangPangkal) return false;
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
  { key: "stel5", label: "Stel 5" },
  { key: "kelengkapan", label: "Kelengkapan" },
];

export const SERAGAM_UANG_PANGKAL_EXPORT_COLUMNS = [
  { key: "uangPangkalNominal", label: "Nominal Uang Pangkal" },
  { key: "uangPangkalDibayar", label: "Jumlah Dibayar Uang Pangkal" },
  { key: "uangPangkalSisa", label: "Sisa Uang Pangkal" },
  { key: "uangPangkalKeterangan", label: "Keterangan Uang Pangkal" },
];

export function seragamExportColumns(withUangPangkal: boolean) {
  return withUangPangkal ? [...SERAGAM_EXPORT_COLUMNS, ...SERAGAM_UANG_PANGKAL_EXPORT_COLUMNS] : SERAGAM_EXPORT_COLUMNS;
}

export function seragamExportRows(rows: SeragamSiswaRow[], options: { uangPangkal?: boolean } = {}): Record<string, string | number>[] {
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
    stel5: seragamStelLabel(row.stel[4]),
    kelengkapan: seragamKelengkapanLabel(row.kelengkapan),
    ...(options.uangPangkal ? uangPangkalExportCells(row) : {}),
  }));
}

function uangPangkalExportCells(row: SeragamSiswaRow): Record<string, string | number> {
  const amounts = uangPangkalAmounts(row.uangPangkal);
  return {
    uangPangkalNominal: amounts ? amounts.nominal : "",
    uangPangkalDibayar: amounts ? amounts.dibayar : "",
    uangPangkalSisa: amounts ? amounts.sisa : "",
    uangPangkalKeterangan: uangPangkalKeterangan(row.uangPangkal),
  };
}

export type UangPangkalRekapRow = {
  lembaga: string; siswa: number; nominal: number; dibayar: number; sisa: number;
  lunas: number; sebagian: number; belumBayar: number; belumAdaTagihan: number; perluVerifikasi: number;
};

export const SERAGAM_REKAP_COLUMNS = [
  { key: "lembaga", label: "Lembaga" },
  { key: "siswa", label: "Jumlah Siswa" },
  { key: "nominal", label: "Nominal Uang Pangkal" },
  { key: "dibayar", label: "Jumlah Dibayar" },
  { key: "sisa", label: "Sisa" },
  { key: "lunas", label: MONITOR_PAYMENT_LABELS.lunas },
  { key: "sebagian", label: MONITOR_PAYMENT_LABELS.sebagian },
  { key: "belumBayar", label: MONITOR_PAYMENT_LABELS.belum_bayar },
  { key: "belumAdaTagihan", label: MONITOR_PAYMENT_LABELS.belum_ada_tagihan },
  { key: "perluVerifikasi", label: MONITOR_PAYMENT_LABELS.perlu_verifikasi },
];

const emptyRekap = (lembaga: string): UangPangkalRekapRow => ({
  lembaga, siswa: 0, nominal: 0, dibayar: 0, sisa: 0, lunas: 0, sebagian: 0, belumBayar: 0, belumAdaTagihan: 0, perluVerifikasi: 0,
});

function addToRekap(target: UangPangkalRekapRow, row: SeragamSiswaRow) {
  const amounts = uangPangkalAmounts(row.uangPangkal);
  target.siswa += 1;
  if (amounts) { target.nominal += amounts.nominal; target.dibayar += amounts.dibayar; target.sisa += amounts.sisa; }
  if (row.statusUangPangkal === "lunas") target.lunas += 1;
  else if (row.statusUangPangkal === "sebagian") target.sebagian += 1;
  else if (row.statusUangPangkal === "belum_bayar") target.belumBayar += 1;
  else if (row.statusUangPangkal === "perlu_verifikasi") target.perluVerifikasi += 1;
  else target.belumAdaTagihan += 1;
}

/** Rekap per lembaga untuk sheet kedua file Excel; mengikuti baris yang sedang difilter. Baris terakhir TOTAL. */
export function rekapUangPangkalPerLembaga(rows: SeragamSiswaRow[]): UangPangkalRekapRow[] {
  const groups = new Map<string, UangPangkalRekapRow>();
  const total = emptyRekap("TOTAL");
  for (const row of rows) {
    const group = groups.get(row.lembaga) ?? emptyRekap(row.lembaga);
    groups.set(row.lembaga, group);
    addToRekap(group, row);
    addToRekap(total, row);
  }
  const sorted = [...groups.values()].sort((a, b) => a.lembaga.localeCompare(b.lembaga, "id"));
  return [...sorted, total];
}
