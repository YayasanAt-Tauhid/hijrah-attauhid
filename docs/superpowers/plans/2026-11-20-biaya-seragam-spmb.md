# Biaya Seragam SPMB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Halaman `/keuangan/seragam-vendor` yang menyimpan harga seragam vendor per tahun ajaran, menampilkan siswa SPMB yang boleh dipesan (uang pangkal terbayar ≥ 25%), dan merekap total yang harus dibayar ke vendor.

**Architecture:** Logika murni (pencocokan harga, kelayakan 25%, susunan pesanan, rekap) ada di `src/lib` dan diuji lebih dulu. Satu tabel baru `harga_seragam_vendor` dengan RLS admin/keuangan dan pemicu anti-tumpang-tindih. Halaman memakai ulang hook yang sudah ada (`useSiswaSeragamList`, `useSeragamUangPangkal`) sehingga daftar pesanan dihitung langsung saat halaman dibuka.

**Tech Stack:** React + TanStack Start/Router, TanStack Query, Supabase client (RLS), PostgreSQL, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-19-biaya-seragam-spmb-design.md` (cabang `feat/biaya-seragam-spmb`)

## Global Constraints

- Angka dari sekretaris mudir dalam ribuan rupiah (170 = Rp170.000, 95rb = Rp95.000). Harga awal TIDAK dimasukkan di migrasi.
- Stel yang dipesan: TK 5 stel, lembaga lain 4 stel. Form siswa tetap 5 slot untuk semua lembaga.
- Ambang 25%: `progress.minimum = ceil(total / 4)`. Layak bila `paid >= minimum`, `total > 0`, dan status bukan `belum_ada_tagihan` atau `perlu_verifikasi`.
- Ukuran dinormalkan huruf besar, X3L→3XL, X4L→4XL, X5L→5XL. Pencocokan nama stel tidak peka huruf besar/kecil dan spasi dirapikan.
- Baris harga tidak dihapus dari UI; dinonaktifkan (`aktif = false`). Dua baris aktif yang bertabrakan ditolak basis data.
- RLS: baca dan tulis hanya `admin` dan `keuangan` lewat `has_role`.
- Cakupan opsi A: katalog harga + daftar pesanan + rekap vendor. Tanpa status "sudah dipesan/dibayar", tanpa jurnal.
- Rute `/keuangan/seragam-vendor`, menu "Biaya Seragam SPMB" di grup Keuangan > Transaksi Harian, di bawah Monitoring Pembayaran SPMB.
- Satu file migrasi di `supabase/migrations/`. Penerapan ke produksi manual sesuai `CLAUDE.md` (checksum, dry-run `BEGIN … ROLLBACK`, konfirmasi eksplisit user, `psql --single-transaction -v ON_ERROR_STOP=1`, verifikasi, catat di `SESI_NOTES.md`). Jangan menerapkan ke database mana pun tanpa konfirmasi user.
- Sebelum commit: `npm run lint` dan `npm run test`, hasilnya ditampilkan (bukan hanya dinyatakan berhasil).
- Kerja di worktree `~/projects/hijrah-biaya-seragam` (cabang `feat/biaya-seragam-spmb`). Jangan menyentuh checkout `~/projects/hijrah-attauhid` (ada perubahan belum di-commit dari pekerjaan ID santri).

## Keputusan yang menyimpang dari spesifikasi (perlu persetujuan user sebelum Task 7)

1. **Izin rute dan menu: `keuangan.transaksi`, bukan `keuangan.pembayaran`.** Menu Keuangan untuk peran yang bisa diatur (kasir, bendahara, sekretaris, keuangan) mengikuti izin per alamat (`permissionForPath`). Kasir bawaan memegang `keuangan.pembayaran`, jadi dengan izin itu menu tetap tampil untuk kasir, padahal spesifikasi meminta disembunyikan. `keuangan.transaksi` dimiliki keuangan, bendahara, dan sekretaris, tidak oleh kasir. Data sumbernya (`getSpmbPaymentMonitor`) tetap memeriksa `keuangan.pembayaran` di server.
2. **Siswa yang tampil** berasal dari `useSiswaSeragamList` (status `aktif` dan `diterima`) yang digabung dengan data Monitoring SPMB. Siswa SPMB lulus yang berstatus lain tidak muncul di daftar pesanan.
3. **"Salin dari tahun ajaran sebelumnya"** memakai pilihan tahun sumber di dialog (bukan menebak tahun sebelumnya dari urutan).

---

## File Structure

| File | Tanggung jawab |
|---|---|
| `src/lib/seragamVendor.ts` (baru) | Tipe harga, normalisasi, kelayakan 25%, pencarian harga, deteksi tabrakan, validasi form, salinan antar tahun |
| `src/lib/seragamVendorPesanan.ts` (baru) | Susunan daftar pesanan, rekap vendor, baris ekspor Excel |
| `supabase/migrations/20261120050000_harga_seragam_vendor.sql` (baru) | Tabel, constraint, pemicu normalisasi + anti-tabrakan, RLS |
| `src/lib/hargaSeragamVendor.migration.test.ts` (baru) | Tes kontrak isi migrasi |
| `supabase/tests/harga_seragam_vendor.sql` (baru) | Tes perilaku di DB gladi (BEGIN … ROLLBACK) |
| `src/hooks/useHargaSeragamVendor.ts` (baru) | Query dan mutasi tabel harga |
| `src/pages/keuangan/BiayaSeragamHargaTab.tsx` (baru) | Tab Harga: tabel, form tambah/ubah/nonaktifkan, salin tahun |
| `src/pages/keuangan/BiayaSeragamSPMB.tsx` (baru) | Halaman: filter, ringkasan, tab Daftar Pesanan dan Rekap Vendor, ekspor |
| `src/routes/_protected._app.keuangan.seragam-vendor.tsx` (baru) | Rute |
| `src/lib/permissions.ts`, `src/components/layout/AppSidebar.tsx` (ubah) | Izin per alamat dan menu |
| `SESI_NOTES.md` (ubah) | Catatan sesi |

---

### Task 1: Logika harga (`seragamVendor.ts`)

**Files:**
- Create: `src/lib/seragamVendor.ts`
- Test: `src/lib/seragamVendor.test.ts`

**Interfaces:**
- Consumes: `UNIFORM_SIZES` dari `@/lib/ukuranSeragam`; `UangPangkalInfo` dari `@/lib/seragamUangPangkal`.
- Produces (dipakai Task 2, 5, 6):
  - `type JenisKelaminHarga = "L" | "P" | "semua"`
  - `type HargaSeragamVendor = { id; tahun_ajaran_id; departemen_id; jenis_kelamin: JenisKelaminHarga; nama_stel; ukuran: string[]; harga: number; catatan?: string | null; aktif: boolean }`
  - `type HargaInput = Omit<HargaSeragamVendor, "id" | "aktif"> & { aktif?: boolean }`
  - `normalizeUkuran(v: string): string`, `normalizeUkuranList(v: readonly string[]): string[]`, `compareUkuran(a, b): number`, `normalizeNamaStel(v: string): string`
  - `jumlahStelPesanan(kodeLembaga: string): number`
  - `layakDipesan(info: UangPangkalInfo | null | undefined): boolean`
  - `cariHarga(harga: readonly HargaSeragamVendor[], q: { tahunAjaranId; lembagaId; jenisKelamin: string; nama: string; ukuran: string }): HargaSeragamVendor | null`
  - `hargaBertabrakan(a: HargaKunci, b: HargaKunci): boolean`, `cariBentrok(calon: HargaKunci & { id?: string }, daftar: readonly HargaSeragamVendor[]): HargaSeragamVendor | null`
  - `validasiHarga(i: Pick<HargaInput, "nama_stel" | "harga" | "jenis_kelamin">): string | null`
  - `salinanHarga(sumber, target: { tahunAjaranId; departemenId; existing }): HargaInput[]`
  - `pesanGalatHarga(error: { code?: string; message?: string } | null | undefined): string`

- [ ] **Step 0: Pasang dependensi di worktree (satu kali)**

Run (latar belakang bila lama): `cd ~/projects/hijrah-biaya-seragam && npm ci --prefer-offline --no-audit --no-fund 2>&1 | tail -5`
Expected: selesai tanpa galat; `ls node_modules | head -1` menampilkan nama paket.

- [ ] **Step 1: Tulis tes yang gagal**

Create `src/lib/seragamVendor.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  cariBentrok, cariHarga, hargaBertabrakan, jumlahStelPesanan, layakDipesan, normalizeNamaStel,
  normalizeUkuran, normalizeUkuranList, pesanGalatHarga, salinanHarga, validasiHarga,
  type HargaSeragamVendor, type JenisKelaminHarga,
} from "./seragamVendor";
import type { UangPangkalInfo } from "./seragamUangPangkal";

const TA = "ta-2027";
const TK = "dept-tk";
const SD = "dept-sd";

function harga(patch: Partial<HargaSeragamVendor> = {}): HargaSeragamVendor {
  return {
    id: "h1", tahun_ajaran_id: TA, departemen_id: TK, jenis_kelamin: "L", nama_stel: "Set Gamis Merah",
    ukuran: ["S", "M"], harga: 170000, catatan: null, aktif: true, ...patch,
  };
}
function pangkal(total: number, paid: number, status?: UangPangkalInfo["status"]): UangPangkalInfo {
  return {
    total, paid, remaining: Math.max(0, total - paid),
    status: status ?? (paid === 0 ? "belum_bayar" : paid >= total ? "lunas" : "sebagian"),
  };
}

describe("normalisasi", () => {
  it("ukuran: huruf besar, spasi dirapikan, alias X3L/X4L/X5L", () => {
    expect(normalizeUkuran(" x4l ")).toBe("4XL");
    expect(normalizeUkuran("X3L")).toBe("3XL");
    expect(normalizeUkuran("x5l")).toBe("5XL");
    expect(normalizeUkuran("xl")).toBe("XL");
    expect(normalizeUkuran("all  size")).toBe("ALL SIZE");
  });
  it("daftar ukuran: unik dan berurutan menurut daftar baku", () => {
    expect(normalizeUkuranList(["XL", "s", "X4L", "S", " "])).toEqual(["S", "XL", "4XL"]);
  });
  it("nama stel: tidak peka huruf besar/kecil dan spasi dirapikan", () => {
    expect(normalizeNamaStel("  Set   Gamis MERAH ")).toBe("set gamis merah");
  });
});

describe("jumlahStelPesanan", () => {
  it("TK 5 stel, lainnya 4 stel", () => {
    expect(jumlahStelPesanan("TK")).toBe(5);
    expect(jumlahStelPesanan("SD")).toBe(4);
    expect(jumlahStelPesanan("MTA")).toBe(4);
    expect(jumlahStelPesanan("")).toBe(4);
  });
});

describe("layakDipesan (ambang 25% = ceil(total/4))", () => {
  it("tepat 25% layak, kurang satu rupiah tidak", () => {
    expect(layakDipesan(pangkal(4000000, 1000000))).toBe(true);
    expect(layakDipesan(pangkal(4000000, 999999))).toBe(false);
  });
  it("pembulatan ke atas: total 1.000.001 butuh 250.001", () => {
    expect(layakDipesan(pangkal(1000001, 250000))).toBe(false);
    expect(layakDipesan(pangkal(1000001, 250001))).toBe(true);
  });
  it("tanpa tagihan, perlu verifikasi, total 0, atau tanpa data tidak layak", () => {
    expect(layakDipesan(pangkal(0, 0, "belum_ada_tagihan"))).toBe(false);
    expect(layakDipesan({ total: 4000000, paid: 4000000, remaining: 0, status: "perlu_verifikasi" })).toBe(false);
    expect(layakDipesan(pangkal(0, 0))).toBe(false);
    expect(layakDipesan(null)).toBe(false);
    expect(layakDipesan(undefined)).toBe(false);
  });
});

describe("cariHarga", () => {
  const q = { tahunAjaranId: TA, lembagaId: TK, jenisKelamin: "L", nama: "Set Gamis Merah", ukuran: "S" };
  it("cocok menurut tahun, lembaga, nama, jenis kelamin, dan ukuran", () => {
    expect(cariHarga([harga()], q)?.id).toBe("h1");
    expect(cariHarga([harga()], { ...q, ukuran: "M" })?.id).toBe("h1");
    expect(cariHarga([harga()], { ...q, ukuran: "XL" })).toBeNull();
  });
  it("nama tidak peka huruf besar/kecil dan spasi; ukuran mengenal alias", () => {
    expect(cariHarga([harga()], { ...q, nama: "  set gamis   merah " })?.id).toBe("h1");
    expect(cariHarga([harga({ ukuran: ["4XL"] })], { ...q, ukuran: "X4L" })?.id).toBe("h1");
  });
  it("jenis kelamin spesifik tidak cocok untuk lawan jenis; 'semua' cocok untuk keduanya", () => {
    expect(cariHarga([harga()], { ...q, jenisKelamin: "P" })).toBeNull();
    expect(cariHarga([harga({ jenis_kelamin: "semua" })], { ...q, jenisKelamin: "P" })?.id).toBe("h1");
    expect(cariHarga([harga({ jenis_kelamin: "semua" })], { ...q, jenisKelamin: "L" })?.id).toBe("h1");
  });
  it("ukuran kosong berarti semua ukuran", () => {
    expect(cariHarga([harga({ ukuran: [] })], { ...q, ukuran: "XXL" })?.id).toBe("h1");
  });
  it("baris nonaktif, tahun lain, dan lembaga lain diabaikan", () => {
    expect(cariHarga([harga({ aktif: false })], q)).toBeNull();
    expect(cariHarga([harga({ tahun_ajaran_id: "ta-lain" })], q)).toBeNull();
    expect(cariHarga([harga({ departemen_id: SD })], q)).toBeNull();
  });
  it("baris dengan jenis kelamin dan ukuran spesifik menang atas yang umum", () => {
    const umum = harga({ id: "g", jenis_kelamin: "semua", ukuran: [], harga: 100000 });
    const khusus = harga({ id: "s", jenis_kelamin: "L", ukuran: ["S"], harga: 170000 });
    expect(cariHarga([umum, khusus], q)?.id).toBe("s");
    expect(cariHarga([umum, khusus], { ...q, ukuran: "XL" })?.id).toBe("g");
  });
});

describe("hargaBertabrakan dan cariBentrok", () => {
  it("bertabrakan bila jenis kelamin dan ukuran sama-sama beririsan pada stel yang sama", () => {
    expect(hargaBertabrakan(harga(), harga({ id: "h2", jenis_kelamin: "semua", ukuran: ["S", "XL"] }))).toBe(true);
    expect(hargaBertabrakan(harga(), harga({ id: "h2", nama_stel: "  set gamis MERAH" }))).toBe(true);
  });
  it("ukuran kosong beririsan dengan ukuran apa pun", () => {
    expect(hargaBertabrakan(harga(), harga({ id: "h2", ukuran: [] }))).toBe(true);
  });
  it("tidak bertabrakan bila L vs P, ukuran terpisah, nama beda, tahun beda, atau salah satu nonaktif", () => {
    expect(hargaBertabrakan(harga(), harga({ id: "h2", jenis_kelamin: "P" }))).toBe(false);
    expect(hargaBertabrakan(harga(), harga({ id: "h2", ukuran: ["XL"] }))).toBe(false);
    expect(hargaBertabrakan(harga(), harga({ id: "h2", nama_stel: "Olahraga" }))).toBe(false);
    expect(hargaBertabrakan(harga(), harga({ id: "h2", tahun_ajaran_id: "ta-lain" }))).toBe(false);
    expect(hargaBertabrakan(harga(), harga({ id: "h2", aktif: false }))).toBe(false);
  });
  it("cariBentrok mengabaikan baris yang sama dan mengembalikan null bila bersih", () => {
    const lain = harga({ id: "h2", jenis_kelamin: "semua", ukuran: ["S"] });
    expect(cariBentrok(harga({ id: "h1" }), [harga({ id: "h1" })])).toBeNull();
    expect(cariBentrok(harga({ id: "h1" }), [harga({ id: "h1" }), lain])?.id).toBe("h2");
  });
});

describe("validasiHarga", () => {
  const ok = { nama_stel: "Set Gamis Merah", harga: 170000, jenis_kelamin: "L" as JenisKelaminHarga };
  it("lolos untuk isian wajar, termasuk harga 0", () => {
    expect(validasiHarga(ok)).toBeNull();
    expect(validasiHarga({ ...ok, harga: 0 })).toBeNull();
  });
  it("menolak nama kosong, nama > 80 karakter, harga negatif/pecahan, jenis kelamin tidak dikenal", () => {
    expect(validasiHarga({ ...ok, nama_stel: "  " })).toBe("Isi nama stel.");
    expect(validasiHarga({ ...ok, nama_stel: "x".repeat(81) })).toBe("Nama stel maksimal 80 karakter.");
    expect(validasiHarga({ ...ok, harga: -1 })).toBe("Harga harus bilangan bulat rupiah, minimal 0.");
    expect(validasiHarga({ ...ok, harga: 1.5 })).toBe("Harga harus bilangan bulat rupiah, minimal 0.");
    expect(validasiHarga({ ...ok, jenis_kelamin: "X" as JenisKelaminHarga })).toBe("Pilih jenis kelamin: L, P, atau semua.");
  });
});

describe("salinanHarga", () => {
  const sumber = [
    harga({ id: "a" }),
    harga({ id: "b", nama_stel: "Pramuka", jenis_kelamin: "semua", ukuran: [], harga: 260000 }),
    harga({ id: "c", aktif: false }),
    harga({ id: "d", departemen_id: SD }),
  ];
  it("menyalin baris aktif milik lembaga itu ke tahun tujuan, tanpa id", () => {
    const hasil = salinanHarga(sumber, { tahunAjaranId: "ta-2028", departemenId: TK, existing: [] });
    expect(hasil).toHaveLength(2);
    expect(hasil.every((r) => r.tahun_ajaran_id === "ta-2028" && r.departemen_id === TK && r.aktif === true)).toBe(true);
    expect(hasil.map((r) => r.nama_stel).sort()).toEqual(["Pramuka", "Set Gamis Merah"]);
    expect(hasil.every((r) => !("id" in r))).toBe(true);
  });
  it("tidak menyalin bila tahun tujuan sudah punya baris (aktif atau tidak) untuk lembaga itu", () => {
    const sudahAda = [harga({ id: "x", tahun_ajaran_id: "ta-2028", aktif: false })];
    expect(salinanHarga(sumber, { tahunAjaranId: "ta-2028", departemenId: TK, existing: sudahAda })).toEqual([]);
  });
});

describe("pesanGalatHarga", () => {
  it("memetakan kode galat basis data ke pesan yang bisa dipahami", () => {
    expect(pesanGalatHarga({ code: "23P01", message: "x" })).toMatch(/bertabrakan/i);
    expect(pesanGalatHarga({ code: "42501", message: "x" })).toMatch(/tidak berhak/i);
    expect(pesanGalatHarga({ code: "23514", message: "x" })).toMatch(/tidak valid/i);
    expect(pesanGalatHarga({ message: "lainnya" })).toBe("lainnya");
    expect(pesanGalatHarga(null)).toBe("Terjadi kesalahan.");
  });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd ~/projects/hijrah-biaya-seragam && npx vitest run src/lib/seragamVendor.test.ts 2>&1 | tail -15`
Expected: FAIL — `Failed to resolve import "./seragamVendor"`.

- [ ] **Step 3: Tulis implementasi minimal**

Create `src/lib/seragamVendor.ts`:

```ts
import { UNIFORM_SIZES } from "@/lib/ukuranSeragam";
import type { UangPangkalInfo } from "@/lib/seragamUangPangkal";

export type JenisKelaminHarga = "L" | "P" | "semua";

export type HargaSeragamVendor = {
  id: string;
  tahun_ajaran_id: string;
  departemen_id: string;
  jenis_kelamin: JenisKelaminHarga;
  nama_stel: string;
  /** Kosong = semua ukuran. */
  ukuran: string[];
  /** Rupiah, bilangan bulat. */
  harga: number;
  catatan?: string | null;
  aktif: boolean;
};

export type HargaInput = Omit<HargaSeragamVendor, "id" | "aktif"> & { aktif?: boolean };

/** Bagian baris yang menentukan tabrakan; dipakai baris tersimpan maupun isian form. */
export type HargaKunci = Pick<HargaSeragamVendor, "tahun_ajaran_id" | "departemen_id" | "jenis_kelamin" | "nama_stel" | "ukuran"> & {
  aktif?: boolean;
};

const UKURAN_ALIAS: Record<string, string> = { X3L: "3XL", X4L: "4XL", X5L: "5XL" };

export function normalizeUkuran(value: string): string {
  const v = value.trim().replace(/\s+/g, " ").toUpperCase();
  return UKURAN_ALIAS[v] ?? v;
}

const urutanUkuran = (u: string) => {
  const index = UNIFORM_SIZES.indexOf(u);
  return index === -1 ? UNIFORM_SIZES.length : index;
};
export const compareUkuran = (a: string, b: string) => urutanUkuran(a) - urutanUkuran(b) || a.localeCompare(b);

export function normalizeUkuranList(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeUkuran).filter(Boolean))].sort(compareUkuran);
}

export function normalizeNamaStel(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** TK memesan 5 stel, lembaga lain 4 stel (form siswa tetap menyimpan 5 slot). */
export function jumlahStelPesanan(kodeLembaga: string): number {
  return kodeLembaga === "TK" ? 5 : 4;
}

/** Sama dengan Monitoring Pembayaran SPMB: minimum = ceil(total / 4). */
export function layakDipesan(info: UangPangkalInfo | null | undefined): boolean {
  if (!info) return false;
  if (info.status === "belum_ada_tagihan" || info.status === "perlu_verifikasi") return false;
  if (!(info.total > 0)) return false;
  return info.paid >= Math.ceil(info.total / 4);
}

export type CariHargaInput = {
  tahunAjaranId: string;
  lembagaId: string;
  jenisKelamin: string;
  nama: string;
  ukuran: string;
};

/** Baris dengan jenis kelamin spesifik dan ukuran spesifik menang atas yang umum. */
export function cariHarga(harga: readonly HargaSeragamVendor[], q: CariHargaInput): HargaSeragamVendor | null {
  const nama = normalizeNamaStel(q.nama);
  const ukuran = normalizeUkuran(q.ukuran);
  let best: HargaSeragamVendor | null = null;
  let bestScore = -1;
  for (const h of harga) {
    if (!h.aktif || h.tahun_ajaran_id !== q.tahunAjaranId || h.departemen_id !== q.lembagaId) continue;
    if (normalizeNamaStel(h.nama_stel) !== nama) continue;
    if (h.jenis_kelamin !== "semua" && h.jenis_kelamin !== q.jenisKelamin) continue;
    const ukuranHarga = normalizeUkuranList(h.ukuran);
    if (ukuranHarga.length > 0 && !ukuranHarga.includes(ukuran)) continue;
    const score = (h.jenis_kelamin !== "semua" ? 1 : 0) + (ukuranHarga.length > 0 ? 1 : 0);
    if (score > bestScore || (score === bestScore && best !== null && h.id < best.id)) {
      best = h;
      bestScore = score;
    }
  }
  return best;
}

const jenisKelaminBeririsan = (a: JenisKelaminHarga, b: JenisKelaminHarga) => a === "semua" || b === "semua" || a === b;
function ukuranBeririsan(a: readonly string[], b: readonly string[]) {
  const x = normalizeUkuranList(a);
  const y = normalizeUkuranList(b);
  return x.length === 0 || y.length === 0 || x.some((u) => y.includes(u));
}

/** Cermin pemicu basis data: dua baris aktif pada stel yang sama tidak boleh beririsan. */
export function hargaBertabrakan(a: HargaKunci, b: HargaKunci): boolean {
  if (!(a.aktif ?? true) || !(b.aktif ?? true)) return false;
  return a.tahun_ajaran_id === b.tahun_ajaran_id
    && a.departemen_id === b.departemen_id
    && normalizeNamaStel(a.nama_stel) === normalizeNamaStel(b.nama_stel)
    && jenisKelaminBeririsan(a.jenis_kelamin, b.jenis_kelamin)
    && ukuranBeririsan(a.ukuran, b.ukuran);
}

export function cariBentrok(calon: HargaKunci & { id?: string }, daftar: readonly HargaSeragamVendor[]): HargaSeragamVendor | null {
  return daftar.find((h) => h.id !== calon.id && hargaBertabrakan(calon, h)) ?? null;
}

export function validasiHarga(input: Pick<HargaInput, "nama_stel" | "harga" | "jenis_kelamin">): string | null {
  if (!input.nama_stel.trim()) return "Isi nama stel.";
  if (input.nama_stel.trim().length > 80) return "Nama stel maksimal 80 karakter.";
  if (!["L", "P", "semua"].includes(input.jenis_kelamin)) return "Pilih jenis kelamin: L, P, atau semua.";
  if (!Number.isInteger(input.harga) || input.harga < 0) return "Harga harus bilangan bulat rupiah, minimal 0.";
  return null;
}

/** Bahan salinan harga antar tahun; kosong bila tahun tujuan sudah punya baris untuk lembaga itu. */
export function salinanHarga(
  sumber: readonly HargaSeragamVendor[],
  target: { tahunAjaranId: string; departemenId: string; existing: readonly HargaSeragamVendor[] },
): HargaInput[] {
  const sudahAda = target.existing.some(
    (h) => h.tahun_ajaran_id === target.tahunAjaranId && h.departemen_id === target.departemenId,
  );
  if (sudahAda) return [];
  return sumber
    .filter((h) => h.aktif && h.departemen_id === target.departemenId)
    .map((h) => ({
      tahun_ajaran_id: target.tahunAjaranId,
      departemen_id: h.departemen_id,
      jenis_kelamin: h.jenis_kelamin,
      nama_stel: h.nama_stel,
      ukuran: [...h.ukuran],
      harga: h.harga,
      catatan: h.catatan ?? null,
      aktif: true,
    }));
}

export function pesanGalatHarga(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return "Terjadi kesalahan.";
  if (error.code === "23P01") return "Harga bertabrakan dengan baris aktif lain (stel, jenis kelamin, dan ukuran beririsan).";
  if (error.code === "42501") return "Anda tidak berhak mengubah harga seragam.";
  if (error.code === "23514") return "Isian harga tidak valid.";
  return error.message || "Terjadi kesalahan.";
}
```

- [ ] **Step 4: Jalankan tes, pastikan lulus**

Run: `cd ~/projects/hijrah-biaya-seragam && npx vitest run src/lib/seragamVendor.test.ts 2>&1 | tail -15`
Expected: PASS, semua tes hijau.

- [ ] **Step 5: Lint dan commit**

```bash
cd ~/projects/hijrah-biaya-seragam
npx eslint src/lib/seragamVendor.ts src/lib/seragamVendor.test.ts
git add src/lib/seragamVendor.ts src/lib/seragamVendor.test.ts
git commit -q -F - <<'EOF'
feat(seragam): logika harga vendor (normalisasi, kelayakan 25%, pencocokan, tabrakan)

Fungsi murni untuk halaman Biaya Seragam SPMB. Belum ada UI atau migrasi.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LPNtUgphoWyAEEoPfjXESs
EOF
```
Expected: eslint tanpa keluaran; commit berhasil.

---

### Task 2: Daftar pesanan, rekap vendor, ekspor (`seragamVendorPesanan.ts`)

**Files:**
- Create: `src/lib/seragamVendorPesanan.ts`
- Test: `src/lib/seragamVendorPesanan.test.ts`

**Interfaces:**
- Consumes (Task 1): `HargaSeragamVendor`, `cariHarga`, `compareUkuran`, `jumlahStelPesanan`, `layakDipesan`, `normalizeNamaStel`, `normalizeUkuran`. Dari kode yang ada: `SeragamSiswaRow` (`@/lib/seragamSiswa`; memakai `id, nama, nis, jenisKelaminKode, lembagaId, lembaga, tahunAjaranId, gelombangId, stel, uangPangkal`), `uniformDepartment` (`@/lib/ukuranSeragam`).
- Produces (dipakai Task 6):
  - `type PesananStel = { slot: number; nama: string; ukuran: string; namaVendor: string | null; harga: number | null; status: "ok" | "harga_belum_ada" | "ukuran_belum_diisi" }`
  - `type PesananRow = { siswaId; nama; nis; lembagaId; lembaga; jenisKelaminKode; stel: PesananStel[]; total: number; masalah: boolean }`
  - `susunPesanan(rows, harga, filter: { tahunAjaranId; lembagaId?; gelombangId? }): { layak: PesananRow[]; belumMemenuhi: number; denganMasalah: number }`
  - `rekapVendor(layak): { baris: RekapBaris[]; tanpaHarga: RekapTanpaHarga[]; totalJumlah: number; totalBayar: number }`
  - `catatanMasalah(row): string`, `PESANAN_EXPORT_COLUMNS`, `pesananExportRows(rows)`, `REKAP_EXPORT_COLUMNS`, `rekapExportRows(rekap)`

- [ ] **Step 1: Tulis tes yang gagal**

Create `src/lib/seragamVendorPesanan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  catatanMasalah, pesananExportRows, rekapExportRows, rekapVendor, susunPesanan,
} from "./seragamVendorPesanan";
import type { HargaSeragamVendor } from "./seragamVendor";
import type { SeragamSiswaRow } from "./seragamSiswa";
import type { UangPangkalInfo } from "./seragamUangPangkal";

const TA = "ta-2027";
const TK = "dept-tk";
const SD = "dept-sd";

function harga(patch: Partial<HargaSeragamVendor> & Pick<HargaSeragamVendor, "id">): HargaSeragamVendor {
  return {
    tahun_ajaran_id: TA, departemen_id: TK, jenis_kelamin: "L", nama_stel: "Set Gamis Merah",
    ukuran: ["S", "M"], harga: 170000, catatan: null, aktif: true, ...patch,
  };
}
const katalog = [
  harga({ id: "tk-sm" }),
  harga({ id: "tk-lxl", ukuran: ["L", "XL"], harga: 185000 }),
  harga({ id: "sd-olahraga", departemen_id: SD, nama_stel: "Olah raga", ukuran: [], harga: 100000 }),
];
function pangkal(total: number, paid: number, status?: UangPangkalInfo["status"]): UangPangkalInfo {
  return {
    total, paid, remaining: Math.max(0, total - paid),
    status: status ?? (paid === 0 ? "belum_bayar" : paid >= total ? "lunas" : "sebagian"),
  };
}
function stel(...items: Array<[string, string]>) {
  const isi = items.map(([jenis, ukuran]) => ({ jenis, ukuran }));
  return [...isi, ...Array.from({ length: 5 - isi.length }, () => ({ jenis: "", ukuran: "" }))];
}
function row(patch: Partial<SeragamSiswaRow> & Pick<SeragamSiswaRow, "id">): SeragamSiswaRow {
  return {
    nama: patch.id, nis: "", jenisKelaminKode: "L", jenisKelamin: "Ikhwan", status: "diterima", statusLabel: "Calon diterima",
    lembagaId: TK, lembaga: "TK", kelasId: "", kelas: "-", tahunAjaranId: TA, gelombangId: "g1",
    stel: stel(["Set Gamis Merah", "S"]), ukuranBaju: "", terisi: 0, kelengkapan: "tidak_tersedia",
    uangPangkal: pangkal(4000000, 1000000), statusUangPangkal: "sebagian", ...patch,
  };
}
const filter = { tahunAjaranId: TA };

describe("susunPesanan: kelayakan dan penyaringan", () => {
  it("hanya siswa SPMB (punya data uang pangkal) di tahun yang dipilih; ≥25% layak, sisanya dihitung belum memenuhi", () => {
    const rows = [
      row({ id: "a" }),
      row({ id: "b", uangPangkal: pangkal(4000000, 999999) }),
      row({ id: "c", uangPangkal: null }),
      row({ id: "d", tahunAjaranId: "ta-lain" }),
      row({ id: "e", uangPangkal: pangkal(0, 0, "belum_ada_tagihan") }),
    ];
    const hasil = susunPesanan(rows, katalog, filter);
    expect(hasil.layak.map((r) => r.siswaId)).toEqual(["a"]);
    expect(hasil.belumMemenuhi).toBe(2);
  });
  it("menyaring menurut lembaga dan gelombang", () => {
    const rows = [
      row({ id: "a" }),
      row({ id: "b", gelombangId: "g2" }),
      row({ id: "c", lembagaId: SD, lembaga: "SD", stel: stel(["Olah raga", "M"]) }),
    ];
    expect(susunPesanan(rows, katalog, { ...filter, gelombangId: "g2" }).layak.map((r) => r.siswaId)).toEqual(["b"]);
    expect(susunPesanan(rows, katalog, { ...filter, lembagaId: SD }).layak.map((r) => r.siswaId)).toEqual(["c"]);
  });
  it("urut menurut lembaga lalu nama", () => {
    const rows = [
      row({ id: "z", nama: "Zaid" }),
      row({ id: "a", nama: "Ahmad" }),
      row({ id: "s", nama: "Salim", lembagaId: SD, lembaga: "SD", stel: stel(["Olah raga", "M"]) }),
    ];
    expect(susunPesanan(rows, katalog, filter).layak.map((r) => r.nama)).toEqual(["Salim", "Ahmad", "Zaid"]);
  });
});

describe("susunPesanan: stel, harga, dan masalah data", () => {
  it("TK menghitung 5 stel; total = jumlah harga", () => {
    const tk = row({
      id: "a",
      stel: stel(["Set Gamis Merah", "S"], ["Set Gamis Merah", "M"], ["Set Gamis Merah", "L"], ["Set Gamis Merah", "XL"], ["Set Gamis Merah", "S"]),
    });
    const [hasil] = susunPesanan([tk], katalog, filter).layak;
    expect(hasil.stel).toHaveLength(5);
    expect(hasil.total).toBe(170000 + 170000 + 185000 + 185000 + 170000);
    expect(hasil.masalah).toBe(false);
  });
  it("lembaga lain hanya 4 stel meski slot kelima terisi", () => {
    const sd = row({
      id: "s", lembagaId: SD, lembaga: "SD",
      stel: stel(["Olah raga", "M"], ["Olah raga", "M"], ["Olah raga", "M"], ["Olah raga", "M"], ["Olah raga", "M"]),
    });
    const [hasil] = susunPesanan([sd], katalog, filter).layak;
    expect(hasil.stel).toHaveLength(4);
    expect(hasil.total).toBe(400000);
  });
  it("slot tanpa nama dilewati; ukuran kosong dan harga tak ada ditandai, tidak dihitung", () => {
    const campur = row({
      id: "a",
      stel: stel(["Set Gamis Merah", "S"], ["Set Gamis Hijau", "S"], ["Set Gamis Biru", ""], ["", ""], ["", ""]),
    });
    const [hasil] = susunPesanan([campur], katalog, filter).layak;
    expect(hasil.stel.map((s) => [s.slot, s.status])).toEqual([[1, "ok"], [2, "harga_belum_ada"], [3, "ukuran_belum_diisi"]]);
    expect(hasil.stel[0].namaVendor).toBe("Set Gamis Merah");
    expect(hasil.total).toBe(170000);
    expect(hasil.masalah).toBe(true);
  });
  it("siswa tanpa satu pun stel bernama tetap layak tetapi bermasalah", () => {
    const kosong = row({ id: "a", stel: stel() });
    const hasil = susunPesanan([kosong], katalog, filter);
    expect(hasil.layak[0].stel).toEqual([]);
    expect(hasil.layak[0].total).toBe(0);
    expect(hasil.layak[0].masalah).toBe(true);
    expect(hasil.denganMasalah).toBe(1);
  });
  it("jenis kelamin siswa menentukan baris harga", () => {
    const putri = row({ id: "p", jenisKelaminKode: "P", jenisKelamin: "Akhwat" });
    const [hasil] = susunPesanan([putri], katalog, filter).layak;
    expect(hasil.stel[0].status).toBe("harga_belum_ada");
  });
});

describe("rekapVendor", () => {
  it("menggabungkan stel, ukuran, dan harga yang sama; memisahkan yang harganya belum ada", () => {
    const rows = [
      row({ id: "a" }),
      row({ id: "b" }),
      row({ id: "c", stel: stel(["Set Gamis Merah", "XL"]) }),
      row({ id: "d", stel: stel(["Set Gamis Hijau", "S"]) }),
      row({ id: "e", stel: stel(["Set Gamis Biru", ""]) }),
    ];
    const rekap = rekapVendor(susunPesanan(rows, katalog, filter).layak);
    expect(rekap.baris.map((b) => [b.namaStel, b.ukuran, b.hargaSatuan, b.jumlah, b.subtotal])).toEqual([
      ["Set Gamis Merah", "S", 170000, 2, 340000],
      ["Set Gamis Merah", "XL", 185000, 1, 185000],
    ]);
    expect(rekap.tanpaHarga.map((b) => [b.namaStel, b.ukuran, b.jumlah])).toEqual([["Set Gamis Hijau", "S", 1]]);
    expect(rekap.totalJumlah).toBe(3);
    expect(rekap.totalBayar).toBe(525000);
  });
});

describe("ekspor", () => {
  const rows = [
    row({ id: "a", nama: "Ahmad", nis: "27.001", stel: stel(["Set Gamis Merah", "S"], ["Olahraga", "XL"]) }),
  ];
  const [pesanan] = susunPesanan(rows, katalog, filter).layak;
  it("catatanMasalah menyebut harga/ukuran yang belum ada", () => {
    expect(catatanMasalah(pesanan)).toBe("Harga belum ada: Olahraga (XL)");
    const kosong = susunPesanan([row({ id: "k", stel: stel(["Set Gamis Biru", ""]) })], katalog, filter).layak[0];
    expect(catatanMasalah(kosong)).toBe("Ukuran belum diisi: Set Gamis Biru");
  });
  it("baris ekspor pesanan memuat stel, total, dan catatan", () => {
    expect(pesananExportRows([pesanan])).toEqual([{
      nama: "Ahmad", nis: "27.001", lembaga: "TK", jenisKelamin: "Ikhwan",
      stel: "Set Gamis Merah (S); Olahraga (XL)", total: 170000, catatan: "Harga belum ada: Olahraga (XL)",
    }]);
  });
  it("baris ekspor rekap diakhiri baris TOTAL dan memuat stel tanpa harga", () => {
    const hasil = rekapExportRows(rekapVendor([pesanan]));
    expect(hasil[0]).toMatchObject({ lembaga: "TK", stel: "Set Gamis Merah", ukuran: "S", jumlah: 1, hargaSatuan: 170000, subtotal: 170000 });
    expect(hasil[1]).toMatchObject({ stel: "Olahraga", ukuran: "XL", hargaSatuan: "Harga belum ada", subtotal: "" });
    expect(hasil[hasil.length - 1]).toMatchObject({ lembaga: "TOTAL", jumlah: 1, subtotal: 170000 });
  });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd ~/projects/hijrah-biaya-seragam && npx vitest run src/lib/seragamVendorPesanan.test.ts 2>&1 | tail -15`
Expected: FAIL — `Failed to resolve import "./seragamVendorPesanan"`.

- [ ] **Step 3: Tulis implementasi minimal**

Create `src/lib/seragamVendorPesanan.ts`:

```ts
import type { SeragamSiswaRow } from "@/lib/seragamSiswa";
import { uniformDepartment } from "@/lib/ukuranSeragam";
import {
  cariHarga, compareUkuran, jumlahStelPesanan, layakDipesan, normalizeNamaStel, normalizeUkuran,
  type HargaSeragamVendor,
} from "@/lib/seragamVendor";

export type PesananStelStatus = "ok" | "harga_belum_ada" | "ukuran_belum_diisi";

export type PesananStel = {
  slot: number;
  nama: string;
  ukuran: string;
  /** Nama stel menurut daftar harga vendor; null bila harga belum ada. */
  namaVendor: string | null;
  harga: number | null;
  status: PesananStelStatus;
};

export type PesananRow = {
  siswaId: string;
  nama: string;
  nis: string;
  lembagaId: string;
  lembaga: string;
  jenisKelaminKode: string;
  stel: PesananStel[];
  total: number;
  masalah: boolean;
};

export type PesananFilter = { tahunAjaranId: string; lembagaId?: string; gelombangId?: string };
export type PesananResult = { layak: PesananRow[]; belumMemenuhi: number; denganMasalah: number };

/**
 * Siswa SPMB (yang punya data uang pangkal) pada tahun ajaran terpilih. Yang uang pangkalnya terbayar ≥ 25% masuk
 * daftar pesanan; sisanya hanya dihitung. Harga tidak pernah ditebak: stel tanpa harga ditandai dan tidak dijumlahkan.
 */
export function susunPesanan(
  rows: readonly SeragamSiswaRow[],
  harga: readonly HargaSeragamVendor[],
  filter: PesananFilter,
): PesananResult {
  const layak: PesananRow[] = [];
  let belumMemenuhi = 0;
  for (const row of rows) {
    if (!row.uangPangkal) continue;
    if (row.tahunAjaranId !== filter.tahunAjaranId) continue;
    if (filter.lembagaId && row.lembagaId !== filter.lembagaId) continue;
    if (filter.gelombangId && row.gelombangId !== filter.gelombangId) continue;
    if (!layakDipesan(row.uangPangkal)) {
      belumMemenuhi += 1;
      continue;
    }
    const jumlah = jumlahStelPesanan(uniformDepartment({ kode: row.lembaga }));
    const stel: PesananStel[] = [];
    row.stel.slice(0, jumlah).forEach((item, index) => {
      const nama = item.jenis.trim();
      if (!nama) return;
      const slot = index + 1;
      const ukuran = normalizeUkuran(item.ukuran);
      if (!ukuran) {
        stel.push({ slot, nama, ukuran: "", namaVendor: null, harga: null, status: "ukuran_belum_diisi" });
        return;
      }
      const cocok = cariHarga(harga, {
        tahunAjaranId: filter.tahunAjaranId, lembagaId: row.lembagaId,
        jenisKelamin: row.jenisKelaminKode, nama, ukuran,
      });
      stel.push(cocok
        ? { slot, nama, ukuran, namaVendor: cocok.nama_stel, harga: cocok.harga, status: "ok" }
        : { slot, nama, ukuran, namaVendor: null, harga: null, status: "harga_belum_ada" });
    });
    layak.push({
      siswaId: row.id, nama: row.nama, nis: row.nis, lembagaId: row.lembagaId, lembaga: row.lembaga,
      jenisKelaminKode: row.jenisKelaminKode, stel,
      total: stel.reduce((sum, s) => sum + (s.harga ?? 0), 0),
      masalah: stel.length === 0 || stel.some((s) => s.status !== "ok"),
    });
  }
  layak.sort((a, b) => a.lembaga.localeCompare(b.lembaga, "id") || a.nama.localeCompare(b.nama, "id") || a.siswaId.localeCompare(b.siswaId));
  return { layak, belumMemenuhi, denganMasalah: layak.filter((r) => r.masalah).length };
}

export type RekapBaris = {
  lembagaId: string; lembaga: string; namaStel: string; ukuran: string; hargaSatuan: number; jumlah: number; subtotal: number;
};
export type RekapTanpaHarga = { lembagaId: string; lembaga: string; namaStel: string; ukuran: string; jumlah: number };
export type RekapVendor = { baris: RekapBaris[]; tanpaHarga: RekapTanpaHarga[]; totalJumlah: number; totalBayar: number };

const urutRekap = (a: { lembaga: string; namaStel: string; ukuran: string }, b: { lembaga: string; namaStel: string; ukuran: string }) =>
  a.lembaga.localeCompare(b.lembaga, "id") || a.namaStel.localeCompare(b.namaStel, "id") || compareUkuran(a.ukuran, b.ukuran);

export function rekapVendor(layak: readonly PesananRow[]): RekapVendor {
  const berharga = new Map<string, RekapBaris>();
  const tanpa = new Map<string, RekapTanpaHarga>();
  for (const siswa of layak) {
    for (const item of siswa.stel) {
      if (item.status === "ok" && item.harga !== null) {
        const namaStel = item.namaVendor ?? item.nama;
        const key = [siswa.lembagaId, normalizeNamaStel(namaStel), item.ukuran, item.harga].join("|");
        const ada = berharga.get(key);
        if (ada) {
          ada.jumlah += 1;
          ada.subtotal += item.harga;
        } else {
          berharga.set(key, {
            lembagaId: siswa.lembagaId, lembaga: siswa.lembaga, namaStel, ukuran: item.ukuran,
            hargaSatuan: item.harga, jumlah: 1, subtotal: item.harga,
          });
        }
      } else if (item.status === "harga_belum_ada") {
        const key = [siswa.lembagaId, normalizeNamaStel(item.nama), item.ukuran].join("|");
        const ada = tanpa.get(key);
        if (ada) ada.jumlah += 1;
        else tanpa.set(key, { lembagaId: siswa.lembagaId, lembaga: siswa.lembaga, namaStel: item.nama, ukuran: item.ukuran, jumlah: 1 });
      }
    }
  }
  const baris = [...berharga.values()].sort(urutRekap);
  return {
    baris,
    tanpaHarga: [...tanpa.values()].sort(urutRekap),
    totalJumlah: baris.reduce((sum, b) => sum + b.jumlah, 0),
    totalBayar: baris.reduce((sum, b) => sum + b.subtotal, 0),
  };
}

export function catatanMasalah(row: PesananRow): string {
  const bagian: string[] = [];
  if (row.stel.length === 0) bagian.push("Belum ada stel yang diisi");
  const tanpaHarga = row.stel.filter((s) => s.status === "harga_belum_ada").map((s) => `${s.nama} (${s.ukuran})`);
  if (tanpaHarga.length) bagian.push(`Harga belum ada: ${tanpaHarga.join(", ")}`);
  const tanpaUkuran = row.stel.filter((s) => s.status === "ukuran_belum_diisi").map((s) => s.nama);
  if (tanpaUkuran.length) bagian.push(`Ukuran belum diisi: ${tanpaUkuran.join(", ")}`);
  return bagian.join("; ");
}

export const PESANAN_EXPORT_COLUMNS = [
  { key: "nama", label: "Nama" },
  { key: "nis", label: "NIS" },
  { key: "lembaga", label: "Lembaga" },
  { key: "jenisKelamin", label: "Jenis Kelamin" },
  { key: "stel", label: "Stel dan Ukuran" },
  { key: "total", label: "Total (Rp)" },
  { key: "catatan", label: "Catatan" },
];

export function pesananExportRows(rows: readonly PesananRow[]): Record<string, string | number>[] {
  return rows.map((row) => ({
    nama: row.nama,
    nis: row.nis,
    lembaga: row.lembaga,
    jenisKelamin: row.jenisKelaminKode === "L" ? "Ikhwan" : row.jenisKelaminKode === "P" ? "Akhwat" : "-",
    stel: row.stel.map((s) => `${s.namaVendor ?? s.nama} (${s.ukuran || "-"})`).join("; "),
    total: row.total,
    catatan: catatanMasalah(row),
  }));
}

export const REKAP_EXPORT_COLUMNS = [
  { key: "lembaga", label: "Lembaga" },
  { key: "stel", label: "Stel" },
  { key: "ukuran", label: "Ukuran" },
  { key: "jumlah", label: "Jumlah" },
  { key: "hargaSatuan", label: "Harga Satuan (Rp)" },
  { key: "subtotal", label: "Subtotal (Rp)" },
];

export function rekapExportRows(rekap: RekapVendor): Record<string, string | number>[] {
  return [
    ...rekap.baris.map((b) => ({
      lembaga: b.lembaga, stel: b.namaStel, ukuran: b.ukuran, jumlah: b.jumlah, hargaSatuan: b.hargaSatuan, subtotal: b.subtotal,
    })),
    ...rekap.tanpaHarga.map((b) => ({
      lembaga: b.lembaga, stel: b.namaStel, ukuran: b.ukuran, jumlah: b.jumlah, hargaSatuan: "Harga belum ada", subtotal: "",
    })),
    { lembaga: "TOTAL", stel: "", ukuran: "", jumlah: rekap.totalJumlah, hargaSatuan: "", subtotal: rekap.totalBayar },
  ];
}
```

- [ ] **Step 4: Jalankan tes, pastikan lulus**

Run: `cd ~/projects/hijrah-biaya-seragam && npx vitest run src/lib/seragamVendorPesanan.test.ts src/lib/seragamVendor.test.ts 2>&1 | tail -15`
Expected: PASS, kedua berkas hijau.

- [ ] **Step 5: Lint dan commit**

```bash
cd ~/projects/hijrah-biaya-seragam
npx eslint src/lib/seragamVendorPesanan.ts src/lib/seragamVendorPesanan.test.ts
git add src/lib/seragamVendorPesanan.ts src/lib/seragamVendorPesanan.test.ts
git commit -q -F - <<'EOF'
feat(seragam): susunan daftar pesanan, rekap vendor, dan baris ekspor

Fungsi murni: siswa SPMB layak (>=25% uang pangkal), stel TK 5 / lain 4,
stel tanpa harga ditandai dan tidak dijumlahkan.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LPNtUgphoWyAEEoPfjXESs
EOF
```

---

### Task 3: Migrasi tabel `harga_seragam_vendor` + tes kontrak

**Files:**
- Create: `supabase/migrations/20261120050000_harga_seragam_vendor.sql`
- Test: `src/lib/hargaSeragamVendor.migration.test.ts`

**Interfaces:**
- Consumes: tabel `public.tahun_ajaran(id uuid)`, `public.departemen(id uuid)`; fungsi `public.has_role(uuid, text)` dan `auth.uid()` yang sudah ada.
- Produces (dipakai Task 4 dan 5): tabel `public.harga_seragam_vendor` dengan kolom `id, tahun_ajaran_id, departemen_id, jenis_kelamin, nama_stel, ukuran text[], harga bigint, catatan, aktif, created_at, updated_at, created_by`; pemicu `trg_harga_seragam_vendor_sebelum_tulis`; tiga kebijakan RLS (SELECT, INSERT, UPDATE untuk admin/keuangan); tanpa DELETE.

- [ ] **Step 1: Tulis tes kontrak yang gagal**

Create `src/lib/hargaSeragamVendor.migration.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mentah = readFileSync("supabase/migrations/20261120050000_harga_seragam_vendor.sql", "utf8");
// Komentar (termasuk catatan rollback) tidak dihitung sebagai perintah.
const sql = mentah.split("\n").filter((baris) => !baris.trim().startsWith("--")).join("\n");

describe("migrasi harga_seragam_vendor", () => {
  it("membuat tabel dengan kolom dan batasan yang dirancang", () => {
    expect(sql).toContain("CREATE TABLE public.harga_seragam_vendor");
    for (const kolom of [
      /tahun_ajaran_id uuid NOT NULL REFERENCES public\.tahun_ajaran\(id\)/,
      /departemen_id uuid NOT NULL REFERENCES public\.departemen\(id\)/,
      /jenis_kelamin text NOT NULL CHECK \(jenis_kelamin IN \('L', 'P', 'semua'\)\)/,
      /nama_stel text NOT NULL CHECK \(btrim\(nama_stel\) <> '' AND char_length\(nama_stel\) <= 80\)/,
      /ukuran text\[\] NOT NULL DEFAULT '\{\}'/,
      /harga bigint NOT NULL CHECK \(harga >= 0\)/,
      /aktif boolean NOT NULL DEFAULT true/,
      /created_by uuid/,
    ]) expect(sql).toMatch(kolom);
  });

  it("pemicu merapikan nama dan ukuran lalu menolak baris aktif yang bertabrakan (dengan kunci penasihat)", () => {
    expect(sql).toMatch(/CREATE TRIGGER trg_harga_seragam_vendor_sebelum_tulis\s+BEFORE INSERT OR UPDATE ON public\.harga_seragam_vendor/);
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("'X3L' THEN '3XL'");
    expect(sql).toContain("'X4L' THEN '4XL'");
    expect(sql).toContain("'X5L' THEN '5XL'");
    expect(sql).toContain("ERRCODE = '23P01'");
    expect(sql).toMatch(/h\.ukuran && NEW\.ukuran/);
    expect(sql).toMatch(/cardinality\(h\.ukuran\) = 0 OR cardinality\(NEW\.ukuran\) = 0/);
  });

  it("RLS aktif; hanya admin dan keuangan yang bisa baca, tambah, dan ubah; tidak ada DELETE", () => {
    expect(sql).toContain("ALTER TABLE public.harga_seragam_vendor ENABLE ROW LEVEL SECURITY");
    const kebijakan = sql.match(/CREATE POLICY/g) ?? [];
    expect(kebijakan).toHaveLength(3);
    expect(sql).toMatch(/FOR SELECT TO authenticated/);
    expect(sql).toMatch(/FOR INSERT TO authenticated/);
    expect(sql).toMatch(/FOR UPDATE TO authenticated/);
    expect(sql).not.toMatch(/FOR (DELETE|ALL)/);
    const syarat = "public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'keuangan')";
    expect(sql.split(syarat).length - 1).toBeGreaterThanOrEqual(4);
    expect(sql).toMatch(/REVOKE ALL ON public\.harga_seragam_vendor FROM PUBLIC, anon/);
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE ON public\.harga_seragam_vendor TO authenticated/);
    expect(sql).not.toMatch(/GRANT[^;]*DELETE[^;]*authenticated/);
  });

  it("hanya menyentuh tabelnya sendiri dan tidak memuat data harga", () => {
    expect(sql).not.toMatch(/INSERT INTO public\.harga_seragam_vendor/);
    for (const [, tabel] of sql.matchAll(/ALTER TABLE (?:ONLY )?(public\.[a-z_]+)/g)) {
      expect(tabel).toBe("public.harga_seragam_vendor");
    }
    expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/);
  });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd ~/projects/hijrah-biaya-seragam && npx vitest run src/lib/hargaSeragamVendor.migration.test.ts 2>&1 | tail -12`
Expected: FAIL — `ENOENT: no such file or directory … 20261120050000_harga_seragam_vendor.sql`.

- [ ] **Step 3: Tulis migrasi**

Create `supabase/migrations/20261120050000_harga_seragam_vendor.sql`:

```sql
-- Harga seragam dari vendor per tahun ajaran (halaman Biaya Seragam SPMB).
-- Satu baris = satu nama stel + satu kelompok ukuran (ukuran kosong = semua ukuran).
-- Tanpa data awal: harga dimasukkan lewat skrip bergerbang terpisah setelah pemetaan stel dikonfirmasi.
-- Rollback: DROP TABLE public.harga_seragam_vendor; DROP FUNCTION public.harga_seragam_vendor_sebelum_tulis();

CREATE TABLE public.harga_seragam_vendor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tahun_ajaran_id uuid NOT NULL REFERENCES public.tahun_ajaran(id),
  departemen_id uuid NOT NULL REFERENCES public.departemen(id),
  jenis_kelamin text NOT NULL CHECK (jenis_kelamin IN ('L', 'P', 'semua')),
  nama_stel text NOT NULL CHECK (btrim(nama_stel) <> '' AND char_length(nama_stel) <= 80),
  ukuran text[] NOT NULL DEFAULT '{}',
  harga bigint NOT NULL CHECK (harga >= 0),
  catatan text,
  aktif boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid()
);

CREATE INDEX harga_seragam_vendor_tahun_lembaga_idx
  ON public.harga_seragam_vendor (tahun_ajaran_id, departemen_id);

CREATE OR REPLACE FUNCTION public.harga_seragam_vendor_sebelum_tulis()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ukuran text[];
BEGIN
  NEW.nama_stel := regexp_replace(btrim(NEW.nama_stel), '\s+', ' ', 'g');

  SELECT COALESCE(array_agg(DISTINCT s.x ORDER BY s.x), '{}')
    INTO v_ukuran
    FROM (
      SELECT CASE upper(regexp_replace(btrim(u), '\s+', ' ', 'g'))
               WHEN 'X3L' THEN '3XL'
               WHEN 'X4L' THEN '4XL'
               WHEN 'X5L' THEN '5XL'
               ELSE upper(regexp_replace(btrim(u), '\s+', ' ', 'g'))
             END AS x
        FROM unnest(COALESCE(NEW.ukuran, '{}')) AS u
       WHERE btrim(u) <> ''
    ) s;
  NEW.ukuran := v_ukuran;

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
  ELSE
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
  END IF;
  NEW.updated_at := now();

  IF NEW.aktif THEN
    -- Serialkan penulisan per tahun ajaran + lembaga agar dua sesi tidak lolos bersamaan.
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tahun_ajaran_id::text || ':' || NEW.departemen_id::text, 0));
    IF EXISTS (
      SELECT 1
        FROM public.harga_seragam_vendor h
       WHERE h.id <> NEW.id
         AND h.aktif
         AND h.tahun_ajaran_id = NEW.tahun_ajaran_id
         AND h.departemen_id = NEW.departemen_id
         AND lower(h.nama_stel) = lower(NEW.nama_stel)
         AND (h.jenis_kelamin = 'semua' OR NEW.jenis_kelamin = 'semua' OR h.jenis_kelamin = NEW.jenis_kelamin)
         AND (cardinality(h.ukuran) = 0 OR cardinality(NEW.ukuran) = 0 OR h.ukuran && NEW.ukuran)
    ) THEN
      RAISE EXCEPTION 'Harga seragam bertabrakan dengan baris aktif lain (stel, jenis kelamin, dan ukuran beririsan)'
        USING ERRCODE = '23P01';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_harga_seragam_vendor_sebelum_tulis
  BEFORE INSERT OR UPDATE ON public.harga_seragam_vendor
  FOR EACH ROW EXECUTE FUNCTION public.harga_seragam_vendor_sebelum_tulis();

ALTER TABLE public.harga_seragam_vendor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.harga_seragam_vendor FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.harga_seragam_vendor TO authenticated;
GRANT ALL ON public.harga_seragam_vendor TO service_role;

DROP POLICY IF EXISTS "admin_keuangan_baca_harga_seragam_vendor" ON public.harga_seragam_vendor;
CREATE POLICY "admin_keuangan_baca_harga_seragam_vendor" ON public.harga_seragam_vendor
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'keuangan'));

DROP POLICY IF EXISTS "admin_keuangan_tambah_harga_seragam_vendor" ON public.harga_seragam_vendor;
CREATE POLICY "admin_keuangan_tambah_harga_seragam_vendor" ON public.harga_seragam_vendor
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'keuangan'));

DROP POLICY IF EXISTS "admin_keuangan_ubah_harga_seragam_vendor" ON public.harga_seragam_vendor;
CREATE POLICY "admin_keuangan_ubah_harga_seragam_vendor" ON public.harga_seragam_vendor
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'keuangan'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'keuangan'));
```

- [ ] **Step 4: Jalankan tes, pastikan lulus**

Run: `cd ~/projects/hijrah-biaya-seragam && npx vitest run src/lib/hargaSeragamVendor.migration.test.ts 2>&1 | tail -12`
Expected: PASS (4 tes).

- [ ] **Step 5: Lint dan commit**

```bash
cd ~/projects/hijrah-biaya-seragam
npx eslint src/lib/hargaSeragamVendor.migration.test.ts
git add supabase/migrations/20261120050000_harga_seragam_vendor.sql src/lib/hargaSeragamVendor.migration.test.ts
git commit -q -F - <<'EOF'
feat(seragam): tabel harga_seragam_vendor (migrasi, belum diterapkan)

Tabel harga vendor per tahun ajaran dengan pemicu normalisasi dan anti-tabrakan,
RLS admin/keuangan, tanpa DELETE dan tanpa data awal. Belum diterapkan ke database mana pun.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LPNtUgphoWyAEEoPfjXESs
EOF
```

---

### Task 4: Uji perilaku migrasi di database gladi (tanpa menyentuh produksi)

Tes kontrak hanya memeriksa teks. Pemicu anti-tabrakan dan RLS harus dibuktikan di PostgreSQL sungguhan.

**Files:**
- Create: `supabase/tests/harga_seragam_vendor.sql`

**Interfaces:**
- Consumes: migrasi Task 3; database gladi berisi minimal satu baris `tahun_ajaran` dan satu `departemen`.
- Produces: bukti (keluaran psql) bahwa normalisasi, penolakan tabrakan (SQLSTATE 23P01), CHECK (23514), dan hak akses bekerja. Skrip selalu berakhir `ROLLBACK`.

- [ ] **Step 1: Tulis skrip uji**

Create `supabase/tests/harga_seragam_vendor.sql`:

```sql
-- Jalankan di database GLADI (bukan produksi), dari akar repo:
--   psql "$DB_GLADI" -v ON_ERROR_STOP=1 -v migrasi=supabase/migrations/20261120050000_harga_seragam_vendor.sql \
--        -f supabase/tests/harga_seragam_vendor.sql
-- Seluruhnya dibungkus BEGIN ... ROLLBACK: migrasi dan data uji tidak tersisa.
\set ON_ERROR_STOP on
BEGIN;
\i :migrasi

CREATE TEMP TABLE uji_ctx AS
  SELECT (SELECT id FROM public.tahun_ajaran LIMIT 1) AS ta, (SELECT id FROM public.departemen LIMIT 1) AS dep;
DO $$ BEGIN
  IF (SELECT ta FROM uji_ctx) IS NULL OR (SELECT dep FROM uji_ctx) IS NULL THEN
    RAISE EXCEPTION 'DB gladi harus punya minimal satu tahun_ajaran dan satu departemen';
  END IF;
END $$;

CREATE FUNCTION pg_temp.harus_gagal(p_sql text, p_sqlstate text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_sqlstate THEN RETURN; END IF;
    RAISE EXCEPTION 'Gagal dengan SQLSTATE % (diharapkan %): %', SQLSTATE, p_sqlstate, SQLERRM;
  END;
  RAISE EXCEPTION 'Diharapkan gagal (%), tetapi berhasil: %', p_sqlstate, p_sql;
END $f$;

CREATE FUNCTION pg_temp.tambah(p_jk text, p_nama text, p_ukuran text[], p_aktif boolean DEFAULT true) RETURNS uuid LANGUAGE sql AS $f$
  INSERT INTO public.harga_seragam_vendor (tahun_ajaran_id, departemen_id, jenis_kelamin, nama_stel, ukuran, harga, aktif)
  VALUES ((SELECT ta FROM uji_ctx), (SELECT dep FROM uji_ctx), p_jk, p_nama, p_ukuran, 170000, p_aktif)
  RETURNING id;
$f$;

DO $$
DECLARE
  v_a uuid; v_b uuid; v_c uuid; v_d uuid;
BEGIN
  -- 1. Normalisasi nama dan ukuran
  v_a := pg_temp.tambah('L', '  Set   Gamis Merah ', ARRAY['x4l', ' s ', 'S', 'XL', '']);
  IF (SELECT nama_stel FROM public.harga_seragam_vendor WHERE id = v_a) <> 'Set Gamis Merah' THEN
    RAISE EXCEPTION 'nama stel tidak dirapikan'; END IF;
  IF NOT ((SELECT ukuran FROM public.harga_seragam_vendor WHERE id = v_a) @> ARRAY['4XL','S','XL']
      AND (SELECT ukuran FROM public.harga_seragam_vendor WHERE id = v_a) <@ ARRAY['4XL','S','XL']) THEN
    RAISE EXCEPTION 'ukuran tidak dinormalkan: %', (SELECT ukuran FROM public.harga_seragam_vendor WHERE id = v_a); END IF;

  -- 2. Tabrakan ditolak: 'semua' beririsan dengan L, ukuran S sama, nama beda huruf besar/kecil
  PERFORM pg_temp.harus_gagal($q$SELECT pg_temp.tambah('semua', 'set gamis MERAH', ARRAY['S'])$q$, '23P01');
  -- 3. Ukuran kosong beririsan dengan ukuran apa pun
  PERFORM pg_temp.harus_gagal($q$SELECT pg_temp.tambah('L', 'Set Gamis Merah', ARRAY[]::text[])$q$, '23P01');

  -- 4. Tidak bertabrakan: ukuran terpisah, jenis kelamin lawan, nama lain
  v_b := pg_temp.tambah('L', 'Set Gamis Merah', ARRAY['M']);
  PERFORM pg_temp.tambah('P', 'Set Gamis Merah', ARRAY['S']);
  PERFORM pg_temp.tambah('L', 'Olahraga', ARRAY[]::text[]);

  -- 5. Baris nonaktif tidak bertabrakan, tetapi mengaktifkannya kembali ditolak
  v_c := pg_temp.tambah('L', 'Set Gamis Merah', ARRAY['S'], false);
  PERFORM pg_temp.harus_gagal(format('UPDATE public.harga_seragam_vendor SET aktif = true WHERE id = %L', v_c), '23P01');

  -- 6. Menonaktifkan baris lama membebaskan slotnya
  UPDATE public.harga_seragam_vendor SET aktif = false WHERE id = v_a;
  v_d := pg_temp.tambah('L', 'Set Gamis Merah', ARRAY['S', 'XL']);

  -- 7. created_at tidak dapat diubah lewat UPDATE
  UPDATE public.harga_seragam_vendor SET catatan = 'uji', created_at = now() + interval '1 year' WHERE id = v_d;
  IF (SELECT created_at FROM public.harga_seragam_vendor WHERE id = v_d) > now() + interval '1 minute' THEN
    RAISE EXCEPTION 'created_at dapat diubah'; END IF;

  -- 8. Batasan nilai
  PERFORM pg_temp.harus_gagal($q$SELECT pg_temp.tambah('X', 'Stel A', ARRAY['S'])$q$, '23514');
  PERFORM pg_temp.harus_gagal($q$SELECT pg_temp.tambah('L', '   ', ARRAY['S'])$q$, '23514');
  PERFORM pg_temp.harus_gagal($q$INSERT INTO public.harga_seragam_vendor (tahun_ajaran_id, departemen_id, jenis_kelamin, nama_stel, harga)
    VALUES ((SELECT ta FROM uji_ctx), (SELECT dep FROM uji_ctx), 'L', 'Stel B', -1)$q$, '23514');
END $$;

-- 9. Hak akses dan RLS
DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.harga_seragam_vendor'::regclass) THEN
    RAISE EXCEPTION 'RLS tidak aktif'; END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'harga_seragam_vendor') <> 3 THEN
    RAISE EXCEPTION 'jumlah kebijakan bukan 3'; END IF;
  IF has_table_privilege('authenticated', 'public.harga_seragam_vendor', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated tidak boleh DELETE'; END IF;
  IF has_table_privilege('anon', 'public.harga_seragam_vendor', 'SELECT') THEN
    RAISE EXCEPTION 'anon tidak boleh SELECT'; END IF;
  IF NOT has_table_privilege('authenticated', 'public.harga_seragam_vendor', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated harus bisa INSERT (dibatasi RLS)'; END IF;
  RAISE NOTICE 'UJI harga_seragam_vendor: semua lulus';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Siapkan database gladi — BERHENTI dan tanya user bila belum ada**

Baca `CLAUDE.md` bagian "Database produksi: target aktif (Rustbase)" untuk cara mengakses PostgreSQL di VM `hijrah-attauhid`. Cari salinan gladi (`\l` di psql). **Jangan pernah memakai `proj_kqylkreswang` untuk uji ini.** Bila tidak ada salinan gladi, berhenti di sini dan tanya user apakah boleh dibuatkan salinan (salinan berisi data siswa, dan harus dihapus setelah selesai oleh user).

- [ ] **Step 3: Kirim berkas dan jalankan**

Kirim `supabase/migrations/20261120050000_harga_seragam_vendor.sql` dan `supabase/tests/harga_seragam_vendor.sql` ke VM (pertahankan path relatif), lalu dari akar folder itu:

```bash
psql "$DB_GLADI" -v ON_ERROR_STOP=1 \
  -v migrasi=supabase/migrations/20261120050000_harga_seragam_vendor.sql \
  -f supabase/tests/harga_seragam_vendor.sql 2>&1 | tail -15
```
Expected: ada `NOTICE:  UJI harga_seragam_vendor: semua lulus`, baris terakhir `ROLLBACK`, exit code 0. Bila ada `ERROR`, perbaiki migrasi (Task 3) dan ulangi; jangan melemahkan tes.

- [ ] **Step 4: Verifikasi gladi bersih, lalu commit**

```bash
psql "$DB_GLADI" -Atc "select to_regclass('public.harga_seragam_vendor')"
```
Expected: kosong (tabel tidak tersisa karena ROLLBACK).

```bash
cd ~/projects/hijrah-biaya-seragam
git add supabase/tests/harga_seragam_vendor.sql
git commit -q -F - <<'EOF'
test(seragam): uji perilaku migrasi harga_seragam_vendor di DB gladi

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LPNtUgphoWyAEEoPfjXESs
EOF
```

---

### Task 5: Hook data harga (`useHargaSeragamVendor.ts`)

**Files:**
- Create: `src/hooks/useHargaSeragamVendor.ts`
- Test: `src/hooks/useHargaSeragamVendor.test.tsx`
- Modify (bila berkasnya ada dan memuat `Tables:`): `src/integrations/supabase/types.ts`

**Interfaces:**
- Consumes (Task 1): `HargaSeragamVendor`, `HargaInput`, `normalizeUkuranList`, `pesanGalatHarga`.
- Produces (dipakai Task 6):
  - `useHargaSeragamVendor(tahunAjaranId: string)` → query `HargaSeragamVendor[]` (`harga` sudah `number`); nonaktif bila id kosong
  - `useSimpanHargaSeragamVendor()` → mutasi `mutateAsync({ id?, ...HargaInput })`
  - `useUbahAktifHarga()` → mutasi `mutateAsync({ id, aktif })`
  - `useSalinHargaSeragam()` → mutasi `mutateAsync(HargaInput[])`
  - semuanya menolak dengan `Error(pesanGalatHarga(...))` dan menyegarkan kunci query `["harga_seragam_vendor"]`

- [ ] **Step 1: Tulis tes yang gagal**

Create `src/hooks/useHargaSeragamVendor.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({
  calls: [] as Array<[string, unknown[]]>,
  result: { data: [] as unknown[], error: null as null | { code?: string; message?: string } },
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder: Record<string, unknown> = {};
  for (const name of ["select", "eq", "order", "insert", "update"]) {
    builder[name] = (...args: unknown[]) => { state.calls.push([name, args]); return builder; };
  }
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(state.result).then(resolve, reject);
  return { supabase: { from: (table: string) => { state.calls.push(["from", [table]]); return builder; } } };
});

import {
  useHargaSeragamVendor, useSalinHargaSeragam, useSimpanHargaSeragamVendor, useUbahAktifHarga,
} from "./useHargaSeragamVendor";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const dipanggil = (nama: string) => state.calls.filter(([n]) => n === nama);

beforeEach(() => { state.calls = []; state.result = { data: [], error: null }; });
afterEach(cleanup);

describe("useHargaSeragamVendor", () => {
  it("membaca tabel harga untuk tahun ajaran terpilih dan mengubah harga menjadi angka", async () => {
    state.result = {
      data: [{ id: "h1", tahun_ajaran_id: "ta1", departemen_id: "d1", jenis_kelamin: "L", nama_stel: "Set", ukuran: ["S"], harga: "170000", catatan: null, aktif: true }],
      error: null,
    };
    const { result } = renderHook(() => useHargaSeragamVendor("ta1"), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0].harga).toBe(170000);
    expect(dipanggil("from")[0][1]).toEqual(["harga_seragam_vendor"]);
    expect(dipanggil("eq")[0][1]).toEqual(["tahun_ajaran_id", "ta1"]);
  });
  it("tidak memanggil basis data bila tahun ajaran belum dipilih", () => {
    renderHook(() => useHargaSeragamVendor(""), { wrapper });
    expect(state.calls).toEqual([]);
  });
});

describe("mutasi", () => {
  const input = {
    tahun_ajaran_id: "ta1", departemen_id: "d1", jenis_kelamin: "L" as const, nama_stel: "  Set Gamis Merah ",
    ukuran: ["x4l", "s"], harga: 170000, catatan: null,
  };
  it("simpan baru: insert dengan nama dirapikan dan ukuran dinormalkan", async () => {
    const { result } = renderHook(() => useSimpanHargaSeragamVendor(), { wrapper });
    await act(async () => { await result.current.mutateAsync(input); });
    expect(dipanggil("insert")[0][1]).toEqual([{ ...input, nama_stel: "Set Gamis Merah", ukuran: ["S", "4XL"] }]);
    expect(dipanggil("update")).toHaveLength(0);
  });
  it("simpan ubah: update menurut id, id tidak ikut dalam isian", async () => {
    const { result } = renderHook(() => useSimpanHargaSeragamVendor(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ ...input, id: "h9" }); });
    expect(dipanggil("update")[0][1]).toEqual([{ ...input, nama_stel: "Set Gamis Merah", ukuran: ["S", "4XL"] }]);
    expect(dipanggil("eq")[0][1]).toEqual(["id", "h9"]);
  });
  it("tabrakan dari basis data menjadi pesan yang dapat dipahami", async () => {
    state.result = { data: [], error: { code: "23P01", message: "raw" } };
    const { result } = renderHook(() => useSimpanHargaSeragamVendor(), { wrapper });
    await expect(act(async () => { await result.current.mutateAsync(input); })).rejects.toThrow(/bertabrakan/i);
  });
  it("ubah aktif memperbarui hanya kolom aktif", async () => {
    const { result } = renderHook(() => useUbahAktifHarga(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ id: "h1", aktif: false }); });
    expect(dipanggil("update")[0][1]).toEqual([{ aktif: false }]);
    expect(dipanggil("eq")[0][1]).toEqual(["id", "h1"]);
  });
  it("salin memasukkan banyak baris sekaligus", async () => {
    const { result } = renderHook(() => useSalinHargaSeragam(), { wrapper });
    await act(async () => { await result.current.mutateAsync([input, { ...input, nama_stel: "Pramuka" }]); });
    const [[, [baris]]] = dipanggil("insert");
    expect(baris).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd ~/projects/hijrah-biaya-seragam && npx vitest run src/hooks/useHargaSeragamVendor.test.tsx 2>&1 | tail -12`
Expected: FAIL — `Failed to resolve import "./useHargaSeragamVendor"`.

- [ ] **Step 3: Tulis hook**

Create `src/hooks/useHargaSeragamVendor.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizeUkuranList, pesanGalatHarga, type HargaInput, type HargaSeragamVendor } from "@/lib/seragamVendor";

const KEY = "harga_seragam_vendor";
const COLUMNS = "id, tahun_ajaran_id, departemen_id, jenis_kelamin, nama_stel, ukuran, harga, catatan, aktif";
const TABLE = "harga_seragam_vendor";

/** Harga vendor satu tahun ajaran. RLS: hanya admin dan keuangan yang mendapat baris. */
export function useHargaSeragamVendor(tahunAjaranId: string) {
  return useQuery({
    queryKey: [KEY, tahunAjaranId],
    enabled: Boolean(tahunAjaranId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from(TABLE)
        .select(COLUMNS)
        .eq("tahun_ajaran_id", tahunAjaranId)
        .order("departemen_id")
        .order("nama_stel")
        .order("id");
      if (error) throw new Error(pesanGalatHarga(error));
      return ((data ?? []) as unknown as Array<HargaSeragamVendor & { harga: number | string }>).map((row) => ({
        ...row,
        harga: Number(row.harga),
        ukuran: row.ukuran ?? [],
      })) as HargaSeragamVendor[];
    },
  });
}

function rapikan(input: HargaInput): HargaInput {
  return { ...input, nama_stel: input.nama_stel.trim(), ukuran: normalizeUkuranList(input.ukuran) };
}

export function useSimpanHargaSeragamVendor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: HargaInput & { id?: string }) => {
      const payload = rapikan(input);
      const { error } = id
        ? await supabase.from(TABLE).update(payload).eq("id", id)
        : await supabase.from(TABLE).insert(payload);
      if (error) throw new Error(pesanGalatHarga(error));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useUbahAktifHarga() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, aktif }: { id: string; aktif: boolean }) => {
      const { error } = await supabase.from(TABLE).update({ aktif }).eq("id", id);
      if (error) throw new Error(pesanGalatHarga(error));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useSalinHargaSeragam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (baris: HargaInput[]) => {
      const { error } = await supabase.from(TABLE).insert(baris.map(rapikan));
      if (error) throw new Error(pesanGalatHarga(error));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}
```

- [ ] **Step 4: Jalankan tes, pastikan lulus**

Run: `cd ~/projects/hijrah-biaya-seragam && npx vitest run src/hooks/useHargaSeragamVendor.test.tsx 2>&1 | tail -12`
Expected: PASS (7 tes).

- [ ] **Step 5: Tipe Supabase (hanya bila ada) dan commit**

Run: `cd ~/projects/hijrah-biaya-seragam && grep -n "spmb_gelombang" src/integrations/supabase/types.ts | head -3`
- Bila ada hasil: berkas tipe dipelihara di repo. Tambahkan entri `harga_seragam_vendor` di dalam `Tables:` mengikuti bentuk entri `spmb_gelombang` (Row, Insert, Update, Relationships ke `tahun_ajaran` dan `departemen`; kolom sesuai migrasi: `harga: number`, `ukuran: string[]`, `jenis_kelamin: string`, `created_by: string | null`). Jalankan `npx tsc --noEmit -p . 2>&1 | grep -c "error TS"` sebelum dan sesudah; jumlahnya tidak boleh naik dibanding sebelum perubahan ini.
- Bila tidak ada hasil: lewati langkah ini; catat di `SESI_NOTES.md` bahwa tipe tabel belum digenerate.

```bash
cd ~/projects/hijrah-biaya-seragam
npx eslint src/hooks/useHargaSeragamVendor.ts src/hooks/useHargaSeragamVendor.test.tsx
git add src/hooks/useHargaSeragamVendor.ts src/hooks/useHargaSeragamVendor.test.tsx src/integrations/supabase/types.ts 2>/dev/null
git commit -q -F - <<'EOF'
feat(seragam): hook baca dan ubah harga seragam vendor

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LPNtUgphoWyAEEoPfjXESs
EOF
```

---

### Task 6: Halaman (tab Harga, Daftar Pesanan, Rekap Vendor)

**Files:**
- Create: `src/pages/keuangan/BiayaSeragamHargaTab.tsx`
- Create: `src/pages/keuangan/BiayaSeragamSPMB.tsx`
- Test: `src/pages/keuangan/BiayaSeragamHargaTab.test.tsx`
- Test: `src/pages/keuangan/BiayaSeragamSPMB.test.tsx`

**Interfaces:**
- Consumes: Task 1, 2, 5; hook yang ada `useTahunAjaran`, `useDepartemen` (`@/hooks/useAkademikData`), `useSiswaSeragamList`, `useSeragamUangPangkal`, `useSpmbGelombang` (`@/hooks/useSiswaSeragam`); `buildSeragamSiswaRows` (`@/lib/seragamSiswa`); `DataTable`, `ExportButton`; `Tabs*`, `Dialog*`, `Button`, `Input`, `Label` dari `@/components/ui`.
- Produces: `export default function BiayaSeragamSPMB()` (dipakai Task 7) dan `export default function BiayaSeragamHargaTab(props)`.

**Catatan uji:** Radix Tabs aktif pada `mouseDown`, jadi tes memakai `fireEvent.mouseDown(tab)`.

#### 6a. Tab Harga

- [ ] **Step 1: Tulis tes tab Harga yang gagal**

Create `src/pages/keuangan/BiayaSeragamHargaTab.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HargaSeragamVendor } from "@/lib/seragamVendor";

const mocks = vi.hoisted(() => ({
  simpan: vi.fn(), ubahAktif: vi.fn(), salin: vi.fn(), sumber: { data: [] as unknown[] },
}));
vi.mock("@/hooks/useHargaSeragamVendor", () => ({
  useHargaSeragamVendor: () => mocks.sumber,
  useSimpanHargaSeragamVendor: () => ({ mutateAsync: mocks.simpan, isPending: false }),
  useUbahAktifHarga: () => ({ mutateAsync: mocks.ubahAktif, isPending: false }),
  useSalinHargaSeragam: () => ({ mutateAsync: mocks.salin, isPending: false }),
}));

import BiayaSeragamHargaTab from "./BiayaSeragamHargaTab";

const TA = "ta-2027";
const TK = "dept-tk";
const harga: HargaSeragamVendor[] = [
  { id: "h1", tahun_ajaran_id: TA, departemen_id: TK, jenis_kelamin: "L", nama_stel: "Set Gamis Merah", ukuran: ["S", "M"], harga: 170000, catatan: null, aktif: true },
  { id: "h2", tahun_ajaran_id: TA, departemen_id: TK, jenis_kelamin: "semua", nama_stel: "Pramuka", ukuran: [], harga: 260000, catatan: null, aktif: false },
];
const props = {
  tahunAjaranId: TA,
  tahunList: [{ id: TA, nama: "2027/2028" }, { id: "ta-2026", nama: "2026/2027" }],
  departemenList: [{ id: TK, nama: "Taman Kanak-kanak", kode: "TK" }],
  harga,
  loading: false,
};

beforeEach(() => { vi.clearAllMocks(); mocks.simpan.mockResolvedValue(undefined); mocks.ubahAktif.mockResolvedValue(undefined); });
afterEach(cleanup);

describe("tab Harga", () => {
  it("menampilkan harga, ukuran, dan status aktif/nonaktif", () => {
    render(<BiayaSeragamHargaTab {...props} />);
    expect(screen.getByText("Set Gamis Merah")).toBeInTheDocument();
    expect(screen.getByText("Rp 170.000")).toBeInTheDocument();
    expect(screen.getByText("S, M")).toBeInTheDocument();
    expect(screen.getByText("Semua ukuran")).toBeInTheDocument();
    expect(screen.getByText("Nonaktif")).toBeInTheDocument();
  });

  it("menambah harga baru: ukuran dipisah koma dan dikirim ternormalisasi", async () => {
    render(<BiayaSeragamHargaTab {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Tambah harga" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Lembaga"), { target: { value: TK } });
    fireEvent.change(within(dialog).getByLabelText("Jenis kelamin"), { target: { value: "P" } });
    fireEvent.change(within(dialog).getByLabelText("Nama stel"), { target: { value: "Set Gamis Hijau" } });
    fireEvent.change(within(dialog).getByLabelText("Ukuran (pisahkan dengan koma, kosong = semua)"), { target: { value: "x4l, s" } });
    fireEvent.change(within(dialog).getByLabelText("Harga (Rp)"), { target: { value: "185000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(mocks.simpan).toHaveBeenCalledTimes(1));
    expect(mocks.simpan.mock.calls[0][0]).toMatchObject({
      tahun_ajaran_id: TA, departemen_id: TK, jenis_kelamin: "P", nama_stel: "Set Gamis Hijau",
      ukuran: ["S", "4XL"], harga: 185000, aktif: true,
    });
    expect(mocks.simpan.mock.calls[0][0].id).toBeUndefined();
  });

  it("menolak harga yang bertabrakan dengan baris aktif tanpa memanggil basis data", async () => {
    render(<BiayaSeragamHargaTab {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Tambah harga" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Lembaga"), { target: { value: TK } });
    fireEvent.change(within(dialog).getByLabelText("Jenis kelamin"), { target: { value: "semua" } });
    fireEvent.change(within(dialog).getByLabelText("Nama stel"), { target: { value: "set gamis merah" } });
    fireEvent.change(within(dialog).getByLabelText("Ukuran (pisahkan dengan koma, kosong = semua)"), { target: { value: "S" } });
    fireEvent.change(within(dialog).getByLabelText("Harga (Rp)"), { target: { value: "170000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/bertabrakan/i);
    expect(mocks.simpan).not.toHaveBeenCalled();
  });

  it("menolak isian tidak valid (harga kosong)", async () => {
    render(<BiayaSeragamHargaTab {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Tambah harga" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Lembaga"), { target: { value: TK } });
    fireEvent.change(within(dialog).getByLabelText("Nama stel"), { target: { value: "Stel Baru" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Isi harga.");
    expect(mocks.simpan).not.toHaveBeenCalled();
  });

  it("mengubah baris: form terisi dan id ikut dikirim", async () => {
    render(<BiayaSeragamHargaTab {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Ubah Set Gamis Merah" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Nama stel")).toHaveValue("Set Gamis Merah");
    fireEvent.change(within(dialog).getByLabelText("Harga (Rp)"), { target: { value: "175000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(mocks.simpan).toHaveBeenCalledTimes(1));
    expect(mocks.simpan.mock.calls[0][0]).toMatchObject({ id: "h1", harga: 175000, aktif: true });
  });

  it("menonaktifkan dan mengaktifkan kembali tanpa menghapus", async () => {
    render(<BiayaSeragamHargaTab {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Nonaktifkan Set Gamis Merah" }));
    await waitFor(() => expect(mocks.ubahAktif).toHaveBeenCalledWith({ id: "h1", aktif: false }));
    fireEvent.click(screen.getByRole("button", { name: "Aktifkan Pramuka" }));
    await waitFor(() => expect(mocks.ubahAktif).toHaveBeenCalledWith({ id: "h2", aktif: true }));
    expect(screen.queryByRole("button", { name: /hapus/i })).not.toBeInTheDocument();
  });

  it("menyalin dari tahun sebelumnya hanya untuk lembaga yang masih kosong di tahun tujuan", async () => {
    mocks.salin.mockResolvedValue(undefined);
    mocks.sumber.data = [
      { id: "s1", tahun_ajaran_id: "ta-2026", departemen_id: "dept-sd", jenis_kelamin: "L", nama_stel: "Olah raga", ukuran: [], harga: 100000, catatan: null, aktif: true },
    ];
    render(<BiayaSeragamHargaTab {...props} departemenList={[...props.departemenList, { id: "dept-sd", nama: "SD", kode: "SD" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Salin dari tahun lain" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Salin dari tahun ajaran"), { target: { value: "ta-2026" } });
    // TK sudah punya baris di tahun tujuan → tidak ada yang disalin
    fireEvent.change(within(dialog).getByLabelText("Lembaga"), { target: { value: TK } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salin" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/sudah punya harga|tidak ada yang bisa disalin/i);
    expect(mocks.salin).not.toHaveBeenCalled();
    // SD kosong di tahun tujuan → tersalin
    fireEvent.change(within(dialog).getByLabelText("Lembaga"), { target: { value: "dept-sd" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salin" }));
    await waitFor(() => expect(mocks.salin).toHaveBeenCalledTimes(1));
    expect(mocks.salin.mock.calls[0][0]).toHaveLength(1);
    expect(mocks.salin.mock.calls[0][0][0]).toMatchObject({ tahun_ajaran_id: TA, departemen_id: "dept-sd", nama_stel: "Olah raga" });
    mocks.sumber.data = [];
  });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd ~/projects/hijrah-biaya-seragam && npx vitest run src/pages/keuangan/BiayaSeragamHargaTab.test.tsx 2>&1 | tail -12`
Expected: FAIL — `Failed to resolve import "./BiayaSeragamHargaTab"`.

- [ ] **Step 3: Tulis tab Harga**

Create `src/pages/keuangan/BiayaSeragamHargaTab.tsx`:

```tsx
import { useState } from "react";
import { Copy, Pencil, Plus } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useHargaSeragamVendor, useSalinHargaSeragam, useSimpanHargaSeragamVendor, useUbahAktifHarga,
} from "@/hooks/useHargaSeragamVendor";
import {
  cariBentrok, normalizeUkuranList, salinanHarga, validasiHarga, type HargaSeragamVendor, type JenisKelaminHarga,
} from "@/lib/seragamVendor";

type Opsi = { id: string; nama: string };
type Props = {
  tahunAjaranId: string;
  tahunList: Opsi[];
  departemenList: Array<Opsi & { kode?: string | null }>;
  harga: HargaSeragamVendor[];
  loading: boolean;
};
type Form = { id: string; aktif: boolean; departemen_id: string; jenis_kelamin: JenisKelaminHarga; nama_stel: string; ukuran: string; harga: string; catatan: string };

const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
const FORM_KOSONG: Form = { id: "", aktif: true, departemen_id: "", jenis_kelamin: "semua", nama_stel: "", ukuran: "", harga: "", catatan: "" };
const JENIS_LABEL: Record<JenisKelaminHarga, string> = { L: "Ikhwan", P: "Akhwat", semua: "Semua" };
const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

export default function BiayaSeragamHargaTab({ tahunAjaranId, tahunList, departemenList, harga, loading }: Props) {
  const simpan = useSimpanHargaSeragamVendor();
  const ubahAktif = useUbahAktifHarga();
  const salin = useSalinHargaSeragam();
  const [form, setForm] = useState<Form | null>(null);
  const [galat, setGalat] = useState("");
  const [salinBuka, setSalinBuka] = useState(false);
  const [sumberTahun, setSumberTahun] = useState("");
  const [salinLembaga, setSalinLembaga] = useState("");
  const sumber = useHargaSeragamVendor(sumberTahun);

  const namaLembaga = (id: string) => {
    const d = departemenList.find((item) => item.id === id);
    return d?.kode || d?.nama || "-";
  };

  const baris = harga.map((h) => ({
    ...h,
    lembaga: namaLembaga(h.departemen_id),
    jenisLabel: JENIS_LABEL[h.jenis_kelamin],
    ukuranLabel: h.ukuran.length ? normalizeUkuranList(h.ukuran).join(", ") : "Semua ukuran",
  }));
  type Baris = (typeof baris)[number];

  function bukaForm(h?: HargaSeragamVendor) {
    setGalat("");
    setForm(h ? {
      id: h.id, aktif: h.aktif, departemen_id: h.departemen_id, jenis_kelamin: h.jenis_kelamin, nama_stel: h.nama_stel,
      ukuran: normalizeUkuranList(h.ukuran).join(", "), harga: String(h.harga), catatan: h.catatan ?? "",
    } : FORM_KOSONG);
  }

  async function kirim() {
    if (!form) return;
    if (!form.departemen_id) return setGalat("Pilih lembaga.");
    if (form.harga.trim() === "") return setGalat("Isi harga.");
    const input = {
      tahun_ajaran_id: tahunAjaranId,
      departemen_id: form.departemen_id,
      jenis_kelamin: form.jenis_kelamin,
      nama_stel: form.nama_stel.trim(),
      ukuran: normalizeUkuranList(form.ukuran.split(",")),
      harga: Number(form.harga),
      catatan: form.catatan.trim() || null,
      aktif: form.aktif,
    };
    const masalah = validasiHarga(input);
    if (masalah) return setGalat(masalah);
    const bentrok = cariBentrok({ ...input, id: form.id || undefined }, harga);
    if (bentrok) {
      return setGalat(`Bertabrakan dengan harga aktif "${bentrok.nama_stel}" (${bentrok.ukuran.length ? bentrok.ukuran.join(", ") : "semua ukuran"}). Nonaktifkan baris itu dulu atau ubah ukuran.`);
    }
    try {
      await simpan.mutateAsync({ id: form.id || undefined, ...input });
      setForm(null);
    } catch (error) {
      setGalat(error instanceof Error ? error.message : "Gagal menyimpan harga.");
    }
  }

  async function jalankanSalin() {
    setGalat("");
    if (!sumberTahun) return setGalat("Pilih tahun ajaran sumber.");
    if (!salinLembaga) return setGalat("Pilih lembaga.");
    const bahan = salinanHarga(sumber.data ?? [], { tahunAjaranId, departemenId: salinLembaga, existing: harga });
    if (bahan.length === 0) {
      return setGalat("Tidak ada yang bisa disalin: tahun ajaran ini sudah punya harga untuk lembaga tersebut, atau sumbernya kosong.");
    }
    try {
      await salin.mutateAsync(bahan);
      setSalinBuka(false);
    } catch (error) {
      setGalat(error instanceof Error ? error.message : "Gagal menyalin harga.");
    }
  }

  const columns: DataTableColumn<Baris>[] = [
    { key: "lembaga", label: "Lembaga" },
    { key: "jenisLabel", label: "Jenis kelamin" },
    { key: "nama_stel", label: "Nama stel" },
    { key: "ukuranLabel", label: "Ukuran" },
    { key: "harga", label: "Harga", render: (value) => rupiah(Number(value)) },
    { key: "aktif", label: "Status", render: (value) => (value ? "Aktif" : "Nonaktif") },
    {
      key: "id", label: "Aksi",
      render: (_value, row) => (
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" aria-label={`Ubah ${row.nama_stel}`} onClick={() => bukaForm(row)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            type="button" size="sm" variant="outline"
            aria-label={`${row.aktif ? "Nonaktifkan" : "Aktifkan"} ${row.nama_stel}`}
            onClick={() => ubahAktif.mutateAsync({ id: row.id, aktif: !row.aktif }).catch((error) => setGalat(error instanceof Error ? error.message : "Gagal mengubah status."))}
          >
            {row.aktif ? "Nonaktifkan" : "Aktifkan"}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => bukaForm()}><Plus className="mr-2 h-4 w-4" />Tambah harga</Button>
        <Button type="button" variant="outline" onClick={() => { setGalat(""); setSumberTahun(""); setSalinLembaga(""); setSalinBuka(true); }}>
          <Copy className="mr-2 h-4 w-4" />Salin dari tahun lain
        </Button>
      </div>
      {galat && !form && !salinBuka && <p role="alert" className="text-sm text-destructive">{galat}</p>}

      <DataTable
        columns={columns} data={baris} searchable={false} pageSize={25} loading={loading}
        emptyMessage="Belum ada harga untuk tahun ajaran ini"
      />

      <Dialog open={form !== null} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form?.id ? "Ubah harga seragam" : "Tambah harga seragam"}</DialogTitle></DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="harga-lembaga">Lembaga</Label>
                <select id="harga-lembaga" className={selectClass} value={form.departemen_id} onChange={(e) => setForm({ ...form, departemen_id: e.target.value })}>
                  <option value="">Pilih lembaga</option>
                  {departemenList.map((d) => <option key={d.id} value={d.id}>{d.kode || d.nama}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="harga-jk">Jenis kelamin</Label>
                <select id="harga-jk" className={selectClass} value={form.jenis_kelamin} onChange={(e) => setForm({ ...form, jenis_kelamin: e.target.value as JenisKelaminHarga })}>
                  <option value="semua">Semua</option>
                  <option value="L">Ikhwan</option>
                  <option value="P">Akhwat</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="harga-nama">Nama stel</Label>
                <Input id="harga-nama" value={form.nama_stel} onChange={(e) => setForm({ ...form, nama_stel: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="harga-ukuran">Ukuran (pisahkan dengan koma, kosong = semua)</Label>
                <Input id="harga-ukuran" value={form.ukuran} onChange={(e) => setForm({ ...form, ukuran: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="harga-rupiah">Harga (Rp)</Label>
                <Input id="harga-rupiah" inputMode="numeric" value={form.harga} onChange={(e) => setForm({ ...form, harga: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="harga-catatan">Catatan</Label>
                <Input id="harga-catatan" value={form.catatan} onChange={(e) => setForm({ ...form, catatan: e.target.value })} />
              </div>
              {galat && <p role="alert" className="text-sm text-destructive">{galat}</p>}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setForm(null)}>Batal</Button>
            <Button type="button" onClick={kirim} disabled={simpan.isPending}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={salinBuka} onOpenChange={setSalinBuka}>
        <DialogContent>
          <DialogHeader><DialogTitle>Salin harga dari tahun ajaran lain</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="salin-tahun">Salin dari tahun ajaran</Label>
              <select id="salin-tahun" className={selectClass} value={sumberTahun} onChange={(e) => setSumberTahun(e.target.value)}>
                <option value="">Pilih tahun ajaran</option>
                {tahunList.filter((t) => t.id !== tahunAjaranId).map((t) => <option key={t.id} value={t.id}>{t.nama}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="salin-lembaga">Lembaga</Label>
              <select id="salin-lembaga" className={selectClass} value={salinLembaga} onChange={(e) => setSalinLembaga(e.target.value)}>
                <option value="">Pilih lembaga</option>
                {departemenList.map((d) => <option key={d.id} value={d.id}>{d.kode || d.nama}</option>)}
              </select>
            </div>
            <p className="text-sm text-muted-foreground">Hanya baris aktif yang disalin, dan hanya bila tahun ajaran ini belum punya harga untuk lembaga tersebut.</p>
            {galat && <p role="alert" className="text-sm text-destructive">{galat}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSalinBuka(false)}>Batal</Button>
            <Button type="button" onClick={jalankanSalin} disabled={salin.isPending}>Salin</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 4: Jalankan tes tab Harga, pastikan lulus**

Run: `cd ~/projects/hijrah-biaya-seragam && npx vitest run src/pages/keuangan/BiayaSeragamHargaTab.test.tsx 2>&1 | tail -20`
Expected: PASS (7 tes). Bila `getByLabelText("Lembaga")` ambigu karena dua dialog tampil bersamaan, pastikan hanya satu dialog yang terbuka pada saat itu (state `form` dan `salinBuka` tidak boleh aktif bersamaan).

- [ ] **Step 5: Commit tab Harga**

```bash
cd ~/projects/hijrah-biaya-seragam
npx eslint src/pages/keuangan/BiayaSeragamHargaTab.tsx src/pages/keuangan/BiayaSeragamHargaTab.test.tsx
git add src/pages/keuangan/BiayaSeragamHargaTab.tsx src/pages/keuangan/BiayaSeragamHargaTab.test.tsx
git commit -q -F - <<'EOF'
feat(seragam): tab Harga untuk halaman Biaya Seragam SPMB

Tambah/ubah/nonaktifkan harga vendor, peringatan tabrakan sebelum simpan, dan salin antar tahun ajaran.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LPNtUgphoWyAEEoPfjXESs
EOF
```

#### 6b. Halaman utama

- [ ] **Step 6: Tulis tes halaman yang gagal**

Create `src/pages/keuangan/BiayaSeragamSPMB.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UangPangkalInfo } from "@/lib/seragamUangPangkal";

const TA = "ta-2027";
const TK = "dept-tk";
const mocks = vi.hoisted(() => ({ allowed: true }));

const pangkal = (paid: number): UangPangkalInfo => ({ total: 4000000, paid, remaining: 4000000 - paid, status: paid ? "sebagian" : "belum_bayar" });
const kosong = [{ jenis: "", ukuran: "" }, { jenis: "", ukuran: "" }, { jenis: "", ukuran: "" }, { jenis: "", ukuran: "" }];
const siswa = (id: string, nama: string, stel: { jenis: string; ukuran: string }) => ({
  id, nama, nis: "", jenis_kelamin: "L", status: "diterima", departemen_id: TK, kelas_siswa: [],
  siswa_detail: {
    ukuran_seragam: [stel, ...kosong], spmb_departemen_tujuan_id: TK, tahun_ajaran_id: TA, spmb_gelombang_id: "g1",
  },
});

vi.mock("@/hooks/useAkademikData", () => ({
  useTahunAjaran: () => ({ data: [{ id: TA, nama: "2027/2028" }, { id: "ta-2026", nama: "2026/2027" }] }),
  useDepartemen: () => ({ data: [{ id: TK, nama: "Taman Kanak-kanak", kode: "TK" }] }),
}));
vi.mock("@/hooks/useSiswaSeragam", () => ({
  useSpmbGelombang: () => ({ data: [{ id: "g1", nama: "Gelombang 1" }] }),
  useSiswaSeragamList: () => ({
    isLoading: false,
    data: [
      siswa("a", "Ahmad", { jenis: "Set Gamis Merah", ukuran: "S" }),
      siswa("b", "Budi", { jenis: "Set Gamis Merah", ukuran: "S" }),
      siswa("c", "Candra", { jenis: "Set Gamis Hijau", ukuran: "S" }),
    ],
  }),
  useSeragamUangPangkal: () => ({
    allowed: mocks.allowed, isLoading: false, error: null,
    byStudent: new Map([["a", pangkal(1000000)], ["b", pangkal(400000)], ["c", pangkal(2000000)]]),
  }),
}));
vi.mock("@/hooks/useHargaSeragamVendor", () => ({
  useHargaSeragamVendor: () => ({
    isLoading: false, error: null,
    data: [{ id: "h1", tahun_ajaran_id: TA, departemen_id: TK, jenis_kelamin: "L", nama_stel: "Set Gamis Merah", ukuran: ["S", "M"], harga: 170000, catatan: null, aktif: true }],
  }),
}));
vi.mock("./BiayaSeragamHargaTab", () => ({ default: () => <div>Isi tab harga</div> }));
vi.mock("@/components/shared/ExportButton", () => ({
  ExportButton: (p: { data: unknown[]; extraSheets?: Array<{ name: string }> }) => (
    <div data-testid="ekspor" data-jumlah={p.data.length} data-sheet={p.extraSheets?.map((s) => s.name).join(",")} />
  ),
}));

import BiayaSeragamSPMB from "./BiayaSeragamSPMB";

const ringkasan = () => screen.getByRole("region", { name: "Ringkasan pesanan" });
beforeEach(() => { mocks.allowed = true; });
afterEach(cleanup);

describe("Biaya Seragam SPMB", () => {
  it("ringkasan: layak dipesan, belum memenuhi 25%, dan perlu dilengkapi", () => {
    render(<BiayaSeragamSPMB />);
    expect(within(ringkasan()).getByText("Layak dipesan: 2")).toBeInTheDocument();
    expect(within(ringkasan()).getByText("Belum memenuhi 25%: 1")).toBeInTheDocument();
    expect(within(ringkasan()).getByText("Perlu dilengkapi: 1")).toBeInTheDocument();
  });

  it("daftar pesanan memuat siswa layak dengan total, dan menandai harga yang belum ada; siswa <25% tidak tampil", () => {
    render(<BiayaSeragamSPMB />);
    expect(screen.getByText("Ahmad")).toBeInTheDocument();
    expect(screen.getByText("Candra")).toBeInTheDocument();
    expect(screen.queryByText("Budi")).not.toBeInTheDocument();
    expect(screen.getAllByText("Rp 170.000").length).toBeGreaterThan(0);
    expect(screen.getByText("Harga belum ada: Set Gamis Hijau (S)")).toBeInTheDocument();
  });

  it("rekap vendor menampilkan total pembayaran dan stel tanpa harga terpisah", async () => {
    render(<BiayaSeragamSPMB />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Rekap Vendor" }));
    expect(await screen.findByText("Total pembayaran vendor: Rp 170.000")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Harga belum ada" })).toBeInTheDocument();
    expect(screen.getByText("Set Gamis Hijau")).toBeInTheDocument();
  });

  it("ekspor Excel membawa daftar pesanan dan sheet Rekap Vendor", () => {
    render(<BiayaSeragamSPMB />);
    const ekspor = screen.getByTestId("ekspor");
    expect(ekspor).toHaveAttribute("data-jumlah", "2");
    expect(ekspor).toHaveAttribute("data-sheet", "Rekap Vendor");
  });

  it("tab Harga memuat komponen harga", async () => {
    render(<BiayaSeragamSPMB />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Harga" }));
    expect(await screen.findByText("Isi tab harga")).toBeInTheDocument();
  });

  it("tanpa izin data uang pangkal: pesan peringatan dan tidak ada daftar", () => {
    mocks.allowed = false;
    render(<BiayaSeragamSPMB />);
    expect(screen.getByRole("alert")).toHaveTextContent("Anda tidak memiliki izin melihat data uang pangkal SPMB.");
    expect(screen.queryByText("Ahmad")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Jalankan tes, pastikan gagal**

Run: `cd ~/projects/hijrah-biaya-seragam && npx vitest run src/pages/keuangan/BiayaSeragamSPMB.test.tsx 2>&1 | tail -12`
Expected: FAIL — `Failed to resolve import "./BiayaSeragamSPMB"`.

- [ ] **Step 8: Tulis halaman**

Create `src/pages/keuangan/BiayaSeragamSPMB.tsx`:

```tsx
import { useMemo, useState, type ReactNode } from "react";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { ExportButton } from "@/components/shared/ExportButton";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDepartemen, useTahunAjaran } from "@/hooks/useAkademikData";
import { useHargaSeragamVendor } from "@/hooks/useHargaSeragamVendor";
import { useSeragamUangPangkal, useSiswaSeragamList, useSpmbGelombang } from "@/hooks/useSiswaSeragam";
import { buildSeragamSiswaRows } from "@/lib/seragamSiswa";
import {
  catatanMasalah, PESANAN_EXPORT_COLUMNS, pesananExportRows, REKAP_EXPORT_COLUMNS, rekapExportRows,
  rekapVendor, susunPesanan, type PesananRow,
} from "@/lib/seragamVendorPesanan";
import BiayaSeragamHargaTab from "./BiayaSeragamHargaTab";

const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
const selectClass = "h-10 min-w-[180px] rounded-md border border-input bg-background px-3 text-sm";

function Filter({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  const id = `biaya-seragam-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} className={selectClass} value={value} onChange={(event) => onChange(event.target.value)}>{children}</select>
    </div>
  );
}

export default function BiayaSeragamSPMB() {
  const { data: tahunList = [] } = useTahunAjaran();
  const { data: departemenList = [] } = useDepartemen();
  const { data: gelombangList = [] } = useSpmbGelombang();
  const { data: siswaList = [], isLoading: siswaLoading } = useSiswaSeragamList();
  const { allowed, isLoading: pangkalLoading, error: pangkalError, byStudent } = useSeragamUangPangkal();

  const [tahunPilihan, setTahunPilihan] = useState("");
  const [lembagaId, setLembagaId] = useState("");
  const [gelombangId, setGelombangId] = useState("");
  const [tab, setTab] = useState("pesanan");
  // Daftar tahun ajaran diurutkan terbaru lebih dulu; itu bawaan filter.
  const tahunAjaranId = tahunPilihan || tahunList[0]?.id || "";

  const { data: harga = [], isLoading: hargaLoading, error: hargaError } = useHargaSeragamVendor(tahunAjaranId);

  const rows = useMemo(
    () => buildSeragamSiswaRows(siswaList, departemenList, allowed ? byStudent : undefined),
    [siswaList, departemenList, allowed, byStudent],
  );
  const pesanan = useMemo(
    () => susunPesanan(rows, harga, { tahunAjaranId, lembagaId: lembagaId || undefined, gelombangId: gelombangId || undefined }),
    [rows, harga, tahunAjaranId, lembagaId, gelombangId],
  );
  const rekap = useMemo(() => rekapVendor(pesanan.layak), [pesanan.layak]);

  const lembagaOptions = useMemo(
    () => departemenList.map((d: { id: string; nama: string; kode?: string | null }) => ({ id: d.id, label: d.kode || d.nama })),
    [departemenList],
  );

  const columns: DataTableColumn<PesananRow>[] = [
    { key: "nama", label: "Nama", sortable: true },
    { key: "nis", label: "NIS" },
    { key: "lembaga", label: "Lembaga", sortable: true },
    {
      key: "stel", label: "Stel dan harga",
      render: (_value, row) => (
        <ul className="space-y-0.5">
          {row.stel.map((s) => (
            <li key={s.slot} className="text-sm">
              {s.namaVendor ?? s.nama} ({s.ukuran || "-"}){s.harga !== null ? ` — ${rupiah(s.harga)}` : ""}
            </li>
          ))}
        </ul>
      ),
    },
    { key: "total", label: "Total", sortable: true, render: (value) => rupiah(Number(value)) },
    {
      key: "masalah", label: "Catatan",
      render: (_value, row) => (row.masalah ? <span className="text-sm text-destructive">{catatanMasalah(row)}</span> : null),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Biaya Seragam SPMB</h1>
        <p className="text-sm text-muted-foreground">
          Harga seragam dari vendor per tahun ajaran dan daftar siswa SPMB yang boleh dipesan (uang pangkal terbayar minimal 25%).
          Daftar dihitung saat halaman dibuka, bukan pemesanan yang dikunci.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Filter label="Tahun ajaran" value={tahunAjaranId} onChange={setTahunPilihan}>
          {tahunList.map((t: { id: string; nama: string }) => <option key={t.id} value={t.id}>{t.nama}</option>)}
        </Filter>
        <Filter label="Lembaga" value={lembagaId} onChange={setLembagaId}>
          <option value="">Semua lembaga</option>
          {lembagaOptions.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </Filter>
        <Filter label="Gelombang" value={gelombangId} onChange={setGelombangId}>
          <option value="">Semua gelombang</option>
          {gelombangList.map((g: { id: string; nama: string }) => <option key={g.id} value={g.id}>{g.nama}</option>)}
        </Filter>
      </div>

      {!allowed && (
        <p role="alert" className="text-sm text-destructive">Anda tidak memiliki izin melihat data uang pangkal SPMB.</p>
      )}
      {allowed && pangkalError && (
        <p role="alert" className="text-sm text-destructive">Data uang pangkal belum dapat dimuat. Coba muat ulang halaman.</p>
      )}
      {hargaError && <p role="alert" className="text-sm text-destructive">Harga vendor belum dapat dimuat: {hargaError instanceof Error ? hargaError.message : "kesalahan tidak dikenal"}.</p>}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="harga">Harga</TabsTrigger>
          <TabsTrigger value="pesanan">Daftar Pesanan</TabsTrigger>
          <TabsTrigger value="rekap">Rekap Vendor</TabsTrigger>
        </TabsList>

        <TabsContent value="harga" className="mt-4">
          <BiayaSeragamHargaTab
            tahunAjaranId={tahunAjaranId}
            tahunList={tahunList}
            departemenList={departemenList}
            harga={harga.filter((h) => !lembagaId || h.departemen_id === lembagaId)}
            loading={hargaLoading}
          />
        </TabsContent>

        <TabsContent value="pesanan" className="mt-4 space-y-4">
          {allowed && (
            <>
              <section aria-label="Ringkasan pesanan" className="flex flex-wrap gap-6 text-sm">
                <p>{`Layak dipesan: ${pesanan.layak.length}`}</p>
                <p>{`Belum memenuhi 25%: ${pesanan.belumMemenuhi}`}</p>
                <p>{`Perlu dilengkapi: ${pesanan.denganMasalah}`}</p>
              </section>
              {pangkalLoading && <p className="text-sm text-muted-foreground">Memuat data uang pangkal...</p>}
              <DataTable
                columns={columns}
                data={pesanan.layak}
                searchable={false}
                pageSize={25}
                loading={siswaLoading}
                emptyMessage="Belum ada siswa yang layak dipesan untuk filter ini"
                actions={<ExportButton
                  data={pesananExportRows(pesanan.layak)}
                  columns={PESANAN_EXPORT_COLUMNS}
                  filename="pesanan-seragam-spmb"
                  sheetName="Daftar Pesanan"
                  extraSheets={[{ name: "Rekap Vendor", columns: REKAP_EXPORT_COLUMNS, data: rekapExportRows(rekap) }]}
                />}
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="rekap" className="mt-4 space-y-4">
          {allowed && (
            <>
              <p className="text-sm font-medium">{`Total pembayaran vendor: ${rupiah(rekap.totalBayar)}`}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-2 pr-4">Lembaga</th><th className="pr-4">Stel</th><th className="pr-4">Ukuran</th>
                      <th className="pr-4 text-right">Jumlah</th><th className="pr-4 text-right">Harga satuan</th><th className="text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rekap.baris.map((b) => (
                      <tr key={`${b.lembagaId}|${b.namaStel}|${b.ukuran}|${b.hargaSatuan}`} className="border-b">
                        <td className="py-2 pr-4">{b.lembaga}</td><td className="pr-4">{b.namaStel}</td><td className="pr-4">{b.ukuran}</td>
                        <td className="pr-4 text-right">{b.jumlah}</td><td className="pr-4 text-right">{rupiah(b.hargaSatuan)}</td><td className="text-right">{rupiah(b.subtotal)}</td>
                      </tr>
                    ))}
                    {rekap.baris.length === 0 && (
                      <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">Belum ada stel berharga untuk dipesan</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {rekap.tanpaHarga.length > 0 && (
                <div className="space-y-2">
                  <h2 className="text-sm font-semibold text-destructive">Harga belum ada</h2>
                  <p className="text-sm text-muted-foreground">Stel berikut belum bisa ditagihkan ke vendor. Tambahkan harganya di tab Harga.</p>
                  <table className="w-full text-sm">
                    <tbody>
                      {rekap.tanpaHarga.map((b) => (
                        <tr key={`${b.lembagaId}|${b.namaStel}|${b.ukuran}`} className="border-b">
                          <td className="py-2 pr-4">{b.lembaga}</td><td className="pr-4">{b.namaStel}</td>
                          <td className="pr-4">{b.ukuran}</td><td className="text-right">{b.jumlah} stel</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 9: Jalankan tes halaman, pastikan lulus**

Run: `cd ~/projects/hijrah-biaya-seragam && npx vitest run src/pages/keuangan/BiayaSeragamSPMB.test.tsx src/pages/keuangan/BiayaSeragamHargaTab.test.tsx 2>&1 | tail -20`
Expected: PASS. Bila `fireEvent.mouseDown` tidak mengaktifkan tab di versi Radix yang terpasang, pakai `userEvent.click` bila paket `@testing-library/user-event` ada; jangan mengubah komponen demi tes.

- [ ] **Step 10: Lint dan commit**

```bash
cd ~/projects/hijrah-biaya-seragam
npx eslint src/pages/keuangan/BiayaSeragamSPMB.tsx src/pages/keuangan/BiayaSeragamSPMB.test.tsx
git add src/pages/keuangan/BiayaSeragamSPMB.tsx src/pages/keuangan/BiayaSeragamSPMB.test.tsx
git commit -q -F - <<'EOF'
feat(seragam): halaman Biaya Seragam SPMB (daftar pesanan, rekap vendor, ekspor)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LPNtUgphoWyAEEoPfjXESs
EOF
```

---

### Task 7: Rute, izin per alamat, dan menu

**Prasyarat:** user sudah menyetujui keputusan #1 di bagian atas (izin `keuangan.transaksi`). Bila user memilih tetap `keuangan.pembayaran`, ganti kunci izin di langkah di bawah dan hapus tes "kasir tidak melihat menu".

**Files:**
- Create: `src/routes/_protected._app.keuangan.seragam-vendor.tsx`
- Modify: `src/lib/permissions.ts:107` (tambah baris di `PATH_PERMISSIONS`)
- Modify: `src/lib/permissions.test.ts:91`
- Modify: `src/components/layout/AppSidebar.tsx:126`
- Modify: `src/components/layout/AppSidebar.permissions.test.tsx`
- Modify: `src/components/layout/AppLayout.test.tsx` (baris `it.each([... "keeps %s outside Admin TU navigation"`)

**Interfaces:**
- Consumes: `BiayaSeragamSPMB` (Task 6).
- Produces: alamat `/keuangan/seragam-vendor` dengan izin `keuangan.transaksi`, menu "Biaya Seragam SPMB".

- [ ] **Step 1: Tulis tes yang gagal**

Edit `src/lib/permissions.test.ts`, di dalam `describe("permissionForPath")` tambahkan satu baris setelah `["/keuangan/monitoring-spmb", "keuangan.pembayaran"],` :

```ts
    ["/keuangan/seragam-vendor", "keuangan.transaksi"],
```

Edit `src/components/layout/AppLayout.test.tsx`: ubah
`it.each(["/keuangan/pembayaran", "/keuangan/piutang", "/keuangan/monitoring-spmb/other", "/keuangan/monitoring-spmb-fake"])`
menjadi
`it.each(["/keuangan/pembayaran", "/keuangan/piutang", "/keuangan/seragam-vendor", "/keuangan/monitoring-spmb/other", "/keuangan/monitoring-spmb-fake"])`.

Edit `src/components/layout/AppSidebar.permissions.test.tsx`: tambahkan di dalam `describe("AppSidebar: menu Keuangan menurut izin", …)`:

```tsx
  it("Biaya Seragam SPMB tidak tampil untuk kasir bawaan, tampil untuk keuangan dan bendahara bawaan", () => {
    state.path = "/keuangan/seragam-vendor";
    as("kasir", DEFAULT_ROLE_PERMISSIONS.kasir);
    expect(screen.queryByText("Biaya Seragam SPMB")).not.toBeInTheDocument();
    cleanup();
    as("keuangan", DEFAULT_ROLE_PERMISSIONS.keuangan);
    expect(screen.getByText("Biaya Seragam SPMB")).toBeInTheDocument();
    cleanup();
    as("bendahara", DEFAULT_ROLE_PERMISSIONS.bendahara);
    expect(screen.getByText("Biaya Seragam SPMB")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd ~/projects/hijrah-biaya-seragam && npx vitest run src/lib/permissions.test.ts src/components/layout/AppSidebar.permissions.test.tsx src/components/layout/AppLayout.test.tsx 2>&1 | tail -20`
Expected: FAIL pada `permissionForPath` untuk `/keuangan/seragam-vendor` (mengembalikan `undefined`/`null`) dan pada menu; tes AppLayout untuk `/keuangan/seragam-vendor` seharusnya sudah lulus karena Admin TU hanya boleh `/keuangan/monitoring-spmb`.

- [ ] **Step 3: Implementasi**

Create `src/routes/_protected._app.keuangan.seragam-vendor.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import BiayaSeragamSPMB from "@/pages/keuangan/BiayaSeragamSPMB";

export const Route = createFileRoute("/_protected/_app/keuangan/seragam-vendor")({
  component: BiayaSeragamSPMB,
});
```

Di `src/lib/permissions.ts`, setelah baris `["/keuangan/monitoring-spmb", "keuangan.pembayaran"],` tambahkan:

```ts
  ["/keuangan/seragam-vendor", "keuangan.transaksi"],
```

Di `src/components/layout/AppSidebar.tsx`, setelah baris item "Monitoring Pembayaran SPMB" tambahkan:

```tsx
          { title: "Biaya Seragam SPMB", url: "/keuangan/seragam-vendor", roles: ["admin", "keuangan"] },
```

- [ ] **Step 4: Jalankan tes, pastikan lulus**

Run: `cd ~/projects/hijrah-biaya-seragam && npx vitest run src/lib/permissions.test.ts src/components/layout 2>&1 | tail -20`
Expected: PASS. Bila tes menu gagal karena item tidak dirender (grup tertutup), baca bagian render `Collapsible`/`defaultOpen` di `AppSidebar.tsx` (sekitar baris 300-345) dan sesuaikan `state.path` pada tes agar grup "Transaksi Harian" terbuka; jangan mengubah logika menu.

- [ ] **Step 5: Lint dan commit**

```bash
cd ~/projects/hijrah-biaya-seragam
npx eslint src/routes/_protected._app.keuangan.seragam-vendor.tsx src/lib/permissions.ts src/lib/permissions.test.ts src/components/layout/AppSidebar.tsx src/components/layout/AppSidebar.permissions.test.tsx src/components/layout/AppLayout.test.tsx
git add src/routes/_protected._app.keuangan.seragam-vendor.tsx src/lib/permissions.ts src/lib/permissions.test.ts src/components/layout/AppSidebar.tsx src/components/layout/AppSidebar.permissions.test.tsx src/components/layout/AppLayout.test.tsx
git commit -q -F - <<'EOF'
feat(seragam): rute /keuangan/seragam-vendor, izin transaksi keuangan, dan menu

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LPNtUgphoWyAEEoPfjXESs
EOF
```

---

### Task 8: Verifikasi penuh, catatan sesi, push, dan PR

**Files:**
- Modify: `SESI_NOTES.md`

- [ ] **Step 1: Lint dan seluruh tes, tampilkan hasilnya**

```bash
cd ~/projects/hijrah-biaya-seragam
npm run lint 2>&1 | tail -15
npm run test 2>&1 | tail -25
```
Expected: lint tanpa galat baru; seluruh tes lulus. Tempel ringkasan hasil (jumlah berkas dan tes) di laporan ke user. Bila ada tes lama yang gagal, periksa dulu apakah gagal juga di `origin/main` sebelum menyimpulkan itu akibat perubahan ini.

- [ ] **Step 2: Periksa tipe tanpa menambah galat**

```bash
cd ~/projects/hijrah-biaya-seragam
npx tsc --noEmit -p . 2>&1 | grep -c "error TS"
npx tsc --noEmit -p . 2>&1 | grep -E "seragamVendor|BiayaSeragam|useHargaSeragamVendor|seragam-vendor" | head
```
Catatan: jumlah galat total tidak boleh lebih besar dari baseline cabang `main` (sebelumnya 188 tanpa `routeTree.gen.ts`; satu galat pola server function sudah dikenal). Perintah kedua harus kosong, kecuali galat rute akibat `routeTree.gen.ts` yang tidak ada (sama seperti rute lain). Bila ada galat pada berkas baru, perbaiki.

- [ ] **Step 3: Perbarui `SESI_NOTES.md`**

Tambahkan bagian baru di bagian paling atas catatan terbaru (ikuti format entri sebelumnya di berkas itu): status (halaman selesai dikode, migrasi BELUM diterapkan ke produksi), keputusan (izin `keuangan.transaksi` dan alasannya; siswa tampil dari daftar seragam aktif/diterima; salin tahun lewat pilihan sumber), hasil `npm run lint` dan `npm run test` beserta jumlahnya, hasil uji DB gladi (Task 4), dan sisa pekerjaan: penerapan migrasi produksi, pengisian harga awal (butuh pemetaan "SD printing", harga 5 stel TK, harga SMA putri), merge PR, deploy dari `main`.

- [ ] **Step 4: Tinjau diff dan cek secret**

```bash
cd ~/projects/hijrah-biaya-seragam
git add SESI_NOTES.md && git diff --cached --stat
git diff origin/feat/biaya-seragam-spmb..HEAD | grep -iE "password|secret|api[_-]?key|token|eyJ" | head -5; echo "(selesai cek)"
```
Expected: hanya berkas yang direncanakan; tidak ada kecocokan secret.

- [ ] **Step 5: Commit dan push cabang (JANGAN merge, JANGAN push ke `main`)**

```bash
cd ~/projects/hijrah-biaya-seragam
git commit -q -F - <<'EOF'
docs(sesi): catatan Biaya Seragam SPMB (kode selesai, migrasi belum diterapkan)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LPNtUgphoWyAEEoPfjXESs
EOF
git log --oneline -8 && git push origin feat/biaya-seragam-spmb 2>&1 | tail -3
```

- [ ] **Step 6: Buka PR (draf) lewat sesi yang punya akses repo**

VPS tidak punya `gh`. Dari sesi Claude dengan akses repo (`add_repo` access `push` untuk `YayasanAt-Tauhid/hijrah-attauhid`):

```bash
gh api repos/YayasanAt-Tauhid/hijrah-attauhid/pulls -f title='feat(seragam): halaman Biaya Seragam SPMB' -f head='feat/biaya-seragam-spmb' -f base='main' -F draft=true -f body='<ringkasan, hasil lint/test, dan peringatan: migrasi 20261120050000 BELUM diterapkan ke produksi>'
```
Isi body dengan: ringkasan fitur, hasil `npm run lint`/`npm run test`, hasil uji gladi, daftar keputusan yang menyimpang dari spesifikasi, dan peringatan migrasi belum diterapkan. Jangan merge; user yang merge.

---

### Task 9: Penerapan produksi (di luar eksekutor kode; hanya dengan konfirmasi eksplisit user)

Tidak dikerjakan otomatis. Setelah PR ditinjau, user memutuskan waktunya. Gunakan skill `terapkan-migrasi-produksi-rustbase` (database `proj_kqylkreswang`): cocokkan sha256 berkas di VM dengan repo, dry-run `BEGIN … ROLLBACK` (verifikasi objek kembali seperti semula), minta konfirmasi eksplisit user, jalankan `psql --single-transaction -v ON_ERROR_STOP=1`, verifikasi (tabel, pemicu, 3 kebijakan, hak akses, 0 baris), catat di `SESI_NOTES.md`. Lalu deploy dari `main` setelah PR digabung.

Pengisian harga awal adalah operasi terpisah dengan konfirmasi terpisah dan hanya setelah user menjawab tiga pertanyaan terbuka di spesifikasi.

---

## Self-Review (terhadap spesifikasi)

- **Data (tabel, kolom, pemicu, RLS, tanpa hapus):** Task 3 (kontrak) dan Task 4 (perilaku nyata).
- **Pencocokan harga (slot tanpa nama, ukuran kosong, tak ada baris, prioritas spesifik):** Task 1 `cariHarga`, Task 2 `susunPesanan`.
- **Kelayakan 25% dan stel TK 5 / lain 4:** Task 1 `layakDipesan`, `jumlahStelPesanan`; Task 2 tes 5 vs 4 stel.
- **Halaman: filter tahun/lembaga/gelombang, tiga tab, salin tahun, ringkasan, rekap, ekspor Excel dengan sheet Rekap Vendor:** Task 6.
- **Akses dan menu:** Task 7 (dengan penyimpangan #1 yang ditandai).
- **Pengujian TDD, lint dan test sebelum commit:** setiap task; Task 8 menampilkan hasil.
- **Rilis manual, tanpa data harga di migrasi, deploy dari `main`:** Task 8-9.
- **Di luar cakupan (status pesanan, jurnal, edit ukuran, notifikasi):** tidak ada task.
- **Konsistensi nama:** `HargaSeragamVendor`, `HargaInput`, `cariHarga`, `susunPesanan`, `rekapVendor`, `pesanGalatHarga`, `useHargaSeragamVendor`, `useSimpanHargaSeragamVendor`, `useUbahAktifHarga`, `useSalinHargaSeragam` konsisten antar task.
- **Risiko yang diketahui:** (a) Radix Tabs di jsdom (catatan di Step 9); (b) tipe Supabase untuk tabel baru (Task 5 Step 5); (c) siswa SPMB lulus berstatus selain aktif/diterima tidak tampil (keputusan #2).
