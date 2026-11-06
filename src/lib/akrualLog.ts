export type AkrualLogRow = {
  id: string;
  dijalankan_at: string;
  sumber: "cron" | "manual";
  sampai_tanggal: string | null;
  piutang_diposting: number;
  piutang_nominal: number;
  pendapatan_diakui: number;
  pendapatan_nominal: number;
  jumlah_galat: number;
  galat: string[];
  /** true bila galat yang disimpan dipotong (hanya 200 pertama); jumlah_galat tetap jumlah sebenarnya. */
  galat_terpotong: boolean;
  gagal_total: boolean;
  pesan_gagal: string | null;
};

/** Eksekusi terakhir yang lebih lama dari ini dianggap job berhenti (job berjalan harian). */
export const AKRUAL_STALE_MS = 36 * 60 * 60 * 1000;

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function normalizeAkrualRow(r: Record<string, unknown>): AkrualLogRow {
  return {
    id: String(r.id),
    dijalankan_at: String(r.dijalankan_at),
    sumber: r.sumber === "manual" ? "manual" : "cron",
    sampai_tanggal: r.sampai_tanggal ? String(r.sampai_tanggal) : null,
    piutang_diposting: num(r.piutang_diposting),
    piutang_nominal: num(r.piutang_nominal),
    pendapatan_diakui: num(r.pendapatan_diakui),
    pendapatan_nominal: num(r.pendapatan_nominal),
    jumlah_galat: num(r.jumlah_galat),
    galat: Array.isArray(r.galat) ? r.galat.map(String) : [],
    galat_terpotong: Boolean(r.galat_terpotong),
    gagal_total: Boolean(r.gagal_total),
    pesan_gagal: r.pesan_gagal ? String(r.pesan_gagal) : null,
  };
}

export function hasAkrualGalat(row?: Pick<AkrualLogRow, "jumlah_galat" | "gagal_total"> | null): boolean {
  return Boolean(row && (row.jumlah_galat > 0 || row.gagal_total));
}

export function formatAkrualWaktu(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

const terbaruDulu = (rows: AkrualLogRow[]) =>
  [...rows].sort((a, b) => new Date(b.dijalankan_at).getTime() - new Date(a.dijalankan_at).getTime());

export function summarizeAkrualLog(rows: AkrualLogRow[]) {
  const sorted = terbaruDulu(rows);
  const terakhir = sorted[0] ?? null;
  let hariBerturutGalat = 0;
  for (const row of sorted) {
    if (!hasAkrualGalat(row)) break;
    hariBerturutGalat += 1;
  }
  return {
    terakhir,
    adaGalat: hasAkrualGalat(terakhir),
    hariBerturutGalat,
    totalGalatTerakhir: terakhir?.jumlah_galat ?? 0,
    belumPernahJalan: terakhir === null,
  };
}

/** Butir untuk Checklist Sebelum Tutup Buku (pengingat, bukan pemblokir). */
export function akrualChecklistStatus(rows: AkrualLogRow[], now: Date = new Date()): { ok: boolean; detail: string } {
  const s = summarizeAkrualLog(rows);
  if (!s.terakhir) {
    return { ok: true, detail: "Belum ada riwayat eksekusi akrual harian. Pencatatan baru aktif; eksekusi terjadwal berikutnya akan muncul di Riwayat akrual harian." };
  }
  const waktu = formatAkrualWaktu(s.terakhir.dijalankan_at) + " WIB";
  if (now.getTime() - new Date(s.terakhir.dijalankan_at).getTime() > AKRUAL_STALE_MS) {
    return { ok: false, detail: `Akrual harian terakhir berjalan ${waktu}, lebih dari 1 hari yang lalu. Periksa job pg_cron akrual-jatuh-tempo-harian.` };
  }
  if (s.terakhir.gagal_total) {
    return { ok: false, detail: `Eksekusi akrual harian terakhir (${waktu}) gagal total: ${s.terakhir.pesan_gagal ?? "penyebab tidak tercatat"}.` };
  }
  if (s.adaGalat) {
    return {
      ok: false,
      detail: `Eksekusi akrual harian terakhir (${waktu}) memiliki ${s.totalGalatTerakhir} galat — ${s.hariBerturutGalat} hari berturut-turut. ` +
        "Tagihan yang gagal diproses belum dijurnal. Lihat rincian di Pengakuan Pendapatan → Riwayat akrual harian.",
    };
  }
  return { ok: true, detail: `Eksekusi akrual harian terakhir (${waktu}) tanpa galat.` };
}
