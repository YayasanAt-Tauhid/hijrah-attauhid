import { useMemo } from "react";
import { createPortal } from "react-dom";
import {
  identitasLabel,
  kelasLabel,
  normalizePaymentMethod,
  periodeLabel,
  periodeRekap,
  summarizeRekapKasir,
  tanggalPendek,
  waktuCetak,
  type RekapKasirItem,
} from "@/lib/rekapKasirSummary";

export interface CetakRekapKasirProps {
  items: RekapKasirItem[];
  petugasNama: string | null;
  bendaharaNama: string | null;
  dari: string;
  sampai: string;
  dicetakPada: Date;
  /** Lembaga yang difilter ("KODE — Nama"); kosong = Semua Lembaga. */
  lembagaLabel?: string | null;
  /** Dipanggil sekali setelah logo selesai dimuat (atau gagal), tanda siap dicetak. */
  onReady?: () => void;
}

const YAYASAN = "YAYASAN AT-TAUHID AL ISLAMY BANGKA BELITUNG";
const TTD_KOSONG = "(................................)";
const angka = (value: number) => new Intl.NumberFormat("id-ID").format(value);
// No, Tanggal, No. Kwitansi, Nama, NIS/NISN, Kelas, Lembaga, Jenis, Periode, Metode, Jumlah, No. Jurnal, Keterangan
const RINCIAN_MM = [9, 17, 28, 34, 42, 12, 14, 25, 24, 15, 15, 24, 18];

/**
 * Laporan rekap kasir versi cetak/PDF (A4 landscape, berwarna), isi dan angka
 * sama dengan laporan Excel karena keduanya memakai summarizeRekapKasir.
 * Dirender ke <body> dan hanya tampil saat mencetak; gaya ada di
 * `.rekap-kasir-print` (src/index.css).
 */
export function CetakRekapKasir({
  items,
  petugasNama,
  bendaharaNama,
  dari,
  sampai,
  dicetakPada,
  lembagaLabel,
  onReady,
}: CetakRekapKasirProps) {
  const summary = useMemo(() => summarizeRekapKasir(items), [items]);
  if (typeof document === "undefined") return null;

  const kop = (judul: string, withLogo: boolean) => (
    <div className="rekap-kop">
      {withLogo && (
        <img
          src="/branding/yayasan-at-tauhid.png"
          alt="Logo Yayasan At-Tauhid"
          onLoad={onReady}
          onError={onReady}
        />
      )}
      <div>
        <p className="rekap-kop-yayasan">{YAYASAN}</p>
        <p className="rekap-kop-judul">{judul}</p>
        <p>
          Petugas : {petugasNama?.trim() || "-"}
          <span className="rekap-kop-sep">·</span>
          Periode : {periodeRekap(dari, sampai)}
          {lembagaLabel && (
            <>
              <span className="rekap-kop-sep">·</span>
              Lembaga : {lembagaLabel}
            </>
          )}
        </p>
        <p className="rekap-kop-cetak">Dicetak : {waktuCetak(dicetakPada)}</p>
      </div>
    </div>
  );

  let no = 0;

  return createPortal(
    <div id="rekap-kasir-print" className="rekap-kasir-print hidden print:!block">
      {kop("LAPORAN REKAPITULASI PENERIMAAN KASIR", true)}

      <div className="rekap-grid">
        <section>
          <p className="rekap-section">A. Rekap per Lembaga dan Jenis Pembayaran</p>
          <table aria-label="Rekap per Lembaga dan Jenis Pembayaran">
            <thead>
              <tr>
                <th>No</th><th>Lembaga</th><th>Jenis Pembayaran</th><th>Transaksi</th><th>Total (Rp)</th>
              </tr>
            </thead>
            <tbody>
              {summary.lembaga.map((lembaga) => [
                ...lembaga.jenis.map((jenis) => (
                  <tr key={`${lembaga.nama}-${jenis.nama}`}>
                    <td className="center">{++no}</td>
                    <td>{lembaga.nama}</td>
                    <td>{jenis.nama}</td>
                    <td className="center">{jenis.count}</td>
                    <td className="num">{angka(jenis.total)}</td>
                  </tr>
                )),
                <tr key={`${lembaga.nama}-subtotal`} className="subtotal">
                  <td />
                  <td colSpan={2}>Subtotal {lembaga.nama}</td>
                  <td className="center">{lembaga.count}</td>
                  <td className="num">{angka(lembaga.total)}</td>
                </tr>,
              ])}
              {summary.count === 0 && (
                <tr><td colSpan={5} className="center">Tidak ada transaksi pada periode ini</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <section>
          <p className="rekap-section">B. Rekap per Metode Bayar</p>
          <table aria-label="Rekap per Metode Bayar">
            <thead>
              <tr><th>No</th><th>Metode Bayar</th><th>Transaksi</th><th>Total (Rp)</th></tr>
            </thead>
            <tbody>
              {summary.perMetode.map((agg, index) => (
                <tr key={agg.metode}>
                  <td className="center">{index + 1}</td>
                  <td>{agg.metode}</td>
                  <td className="center">{agg.count}</td>
                  <td className="num">{angka(agg.total)}</td>
                </tr>
              ))}
              {summary.perMetode.length === 0 && (
                <tr><td colSpan={4} className="center">-</td></tr>
              )}
            </tbody>
          </table>

          <table className="rekap-total" aria-label="Total Penerimaan">
            <tbody>
              <tr className="total">
                <td>TOTAL PENERIMAAN</td>
                <td className="center">{summary.count} transaksi</td>
                <td className="num">Rp {angka(summary.total)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <p className="rekap-section">C. Rekap per Tanggal</p>
      <table aria-label="Rekap per Tanggal">
        <thead>
          <tr>
            <th>No</th><th>Tanggal</th><th>Jumlah Transaksi</th>
            {summary.methods.map((metode) => <th key={metode}>{metode}</th>)}
            <th>Total (Rp)</th>
          </tr>
        </thead>
        <tbody>
          {summary.perTanggal.map((day, index) => (
            <tr key={day.tanggal}>
              <td className="center">{index + 1}</td>
              <td className="center">{tanggalPendek(day.tanggal || null)}</td>
              <td className="center">{day.count}</td>
              {day.perMetode.map((value, i) => <td key={summary.methods[i]} className="num">{angka(value)}</td>)}
              <td className="num">{angka(day.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="rekap-ttd" data-testid="rekap-kasir-ttd">
        {[
          { label: "Kasir,", nama: petugasNama?.trim() || "" },
          { label: "Staf Keuangan,", nama: "" },
          { label: "Mengetahui, Bendahara,", nama: bendaharaNama?.trim() || "" },
        ].map((block) => (
          <div key={block.label}>
            <p>{block.label}</p>
            <div className="rekap-ttd-ruang" />
            <p className={block.nama ? "rekap-ttd-nama" : undefined}>{block.nama || TTD_KOSONG}</p>
          </div>
        ))}
      </div>

      <div className="rekap-page-break">
        {kop("RINCIAN PENERIMAAN KASIR", false)}
        <table className="rekap-rincian" aria-label="Rincian Penerimaan">
          {/* Lebar tetap (mm, total 277 = lebar cetak A4 landscape) agar kolom kode muat satu baris. */}
          <colgroup>
            {RINCIAN_MM.map((mm, index) => <col key={index} style={{ width: `${mm}mm` }} />)}
          </colgroup>
          <thead>
            <tr>
              <th>No</th><th>Tanggal</th><th>No. Kwitansi</th><th>Nama</th><th>NIS / NISN</th>
              <th>Kelas</th><th>Lembaga</th><th>Jenis Pembayaran</th><th>Periode</th><th>Metode</th>
              <th>Jumlah (Rp)</th><th>No. Jurnal</th><th>Keterangan</th>
            </tr>
          </thead>
          <tbody>
            {summary.items.map((row, index) => (
              <tr key={row.id}>
                {/* Kolom kode/tanggal "nw" tidak dipotong; Nama, Jenis, Keterangan boleh turun baris. */}
                <td className="center nw">{index + 1}</td>
                <td className="center nw">{tanggalPendek(row.tanggal_bayar)}</td>
                <td className="nw">{row.receipt_number || "-"}</td>
                <td>{row.siswa_nama || "-"}</td>
                <td className="nw">{identitasLabel(row)}</td>
                <td className="center nw">{kelasLabel(row)}</td>
                <td className="center nw">{row.departemen_nama || "-"}</td>
                <td>{row.jenis_nama || "-"}</td>
                <td className="nw">{periodeLabel(row)}</td>
                <td className="center">{normalizePaymentMethod(row.payment_method)}</td>
                <td className="num">{angka(row.jumlah)}</td>
                <td className="nw">{row.jurnal_nomor || "-"}</td>
                <td>{row.keterangan || "-"}</td>
              </tr>
            ))}
            <tr className="total">
              <td colSpan={10} className="num">TOTAL</td>
              <td className="num">{angka(summary.total)}</td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>,
    document.body,
  );
}
