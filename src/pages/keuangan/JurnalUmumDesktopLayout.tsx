import JurnalUmum from "./JurnalUmum";

/**
 * Lapisan presentasi khusus halaman Jurnal Umum.
 *
 * JurnalUmum sendiri tetap memegang seluruh logika/query/dialog. Wrapper ini
 * hanya mengoreksi kepadatan layout desktop agar tabel 10 kolom tidak melebar
 * akibat kolom Keterangan yang panjang. Aturan dibatasi oleh class wrapper
 * dan media query desktop, jadi halaman lain serta tampilan mobile tidak ikut
 * berubah.
 */
export default function JurnalUmumDesktopLayout() {
  return (
    <div className="jurnal-umum-desktop">
      <JurnalUmum />

      <style>{`
        @media (min-width: 1024px) {
          /* Ringkasan: ubah kartu tinggi menjadi kartu horizontal yang padat. */
          .jurnal-umum-desktop > div > :nth-child(2) {
            gap: 10px;
            margin-bottom: 12px;
          }

          .jurnal-umum-desktop > div > :nth-child(2) > * > div {
            display: grid;
            grid-template-columns: 36px minmax(0, 1fr);
            grid-template-rows: auto auto;
            column-gap: 12px;
            align-items: center;
            padding: 12px 14px !important;
          }

          .jurnal-umum-desktop > div > :nth-child(2) > * > div > :first-child {
            grid-column: 1;
            grid-row: 1 / 3;
            width: 36px;
            height: 36px;
            margin-bottom: 0 !important;
          }

          .jurnal-umum-desktop > div > :nth-child(2) > * > div > p {
            grid-column: 2;
            grid-row: 1;
            font-size: 20px;
            line-height: 1.1;
          }

          .jurnal-umum-desktop > div > :nth-child(2) > * > div > div:last-child {
            grid-column: 2;
            grid-row: 2;
            margin-top: 2px;
          }

          /* Toolbar: chip filter tetap di kiri, pencarian + aksi terdorong kanan. */
          .jurnal-umum-desktop > div > :nth-child(3) {
            padding-bottom: 10px;
            margin-bottom: 12px;
          }

          .jurnal-umum-desktop > div > :nth-child(3) > div > :last-child {
            margin-left: auto;
            flex-shrink: 0;
          }

          /* DataTable utama saja. Dialog memakai portal dan tidak terkena selector ini. */
          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) table {
            width: 100% !important;
            min-width: 100% !important;
            table-layout: fixed;
          }

          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) th,
          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) td {
            padding: 10px 12px !important;
            vertical-align: middle;
          }

          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) th {
            height: 42px !important;
          }

          /* Nomor */
          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) th:nth-child(1),
          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) td:nth-child(1) {
            width: 125px;
            white-space: nowrap;
          }

          /* Tanggal */
          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) th:nth-child(2),
          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) td:nth-child(2) {
            width: 128px;
            white-space: nowrap;
          }

          /* Keterangan mendapat sisa ruang dan tidak lagi memaksa tabel melebar. */
          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) th:nth-child(3),
          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) td:nth-child(3) {
            width: auto;
            min-width: 0;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
          }

          /* Lembaga: beri ruang cukup dan cegah nama panjang menabrak Debit. */
          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) th:nth-child(4),
          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) td:nth-child(4) {
            width: 128px;
            max-width: 128px;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
          }

          /* Diinput Oleh */
          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) th:nth-child(5),
          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) td:nth-child(5) {
            width: 150px;
          }

          /* Debit / Kredit */
          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) th:nth-child(6),
          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) td:nth-child(6),
          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) th:nth-child(7),
          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) td:nth-child(7) {
            width: 122px;
            white-space: nowrap;
            text-align: right;
            font-variant-numeric: tabular-nums;
          }

          /* Status */
          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) th:nth-child(8),
          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) td:nth-child(8) {
            width: 92px;
            white-space: nowrap;
          }

          /* Tipe */
          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) th:nth-child(9),
          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) td:nth-child(9) {
            width: 102px;
            white-space: nowrap;
          }

          /* Aksi: jurnal draft memuat 5 tombol (detail, export, edit, hapus, posting). */
          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) th:nth-child(10),
          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) td:nth-child(10) {
            width: 204px;
            white-space: nowrap;
          }
        }

        /*
         * Pada desktop/laptop sampai 1599px, prioritaskan kolom operasional.
         * Diinput Oleh dan Tipe tetap tersedia di Detail Jurnal; pada monitor
         * lebar keduanya otomatis tampil kembali.
         */
        @media (min-width: 1024px) and (max-width: 1599px) {
          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) th:nth-child(5),
          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) td:nth-child(5),
          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) th:nth-child(9),
          .jurnal-umum-desktop > div > :nth-child(4) > :nth-child(2) td:nth-child(9) {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
