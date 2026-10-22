# SPP awal SPMB sebelum penempatan kelas

SPMB yang sudah lulus dan diterima dapat menerbitkan SPP satu bulan melalui **Keuangan → Rencana Tagihan Siswa Baru → Terbitkan Tagihan Awal → SPP awal tanpa kelas**. Petugas memilih periode di TA tujuan dan nominal siswa. Rencana SPP lanjutan tetap menunggu aktivasi dan penempatan.

- SPP menyimpan tahun akademik dan periode layanan; Tahun Buku tetap periode akuntansi.
- Siswa internal tidak perlu dipindah dari jenjang/kelas asal untuk membayar SPP tujuan.
- Penerbitan ulang melewati tagihan yang sudah ada, termasuk yang sudah dibayar, tanpa mengganti nominal. Tagihan dibatalkan/dihapusbuku memerlukan pemeriksaan koreksi.
- Nominal kategori SPP per bulan yang sudah ditetapkan tidak boleh ditimpa diam-diam.
- Pembayaran sebelum bulan layanan tetap memakai pendapatan diterima di muka, snapshot kategori SPP, dan jalur pembayaran yang ada.
- Tunggakan berasal dari sisa tagihan yang sudah lewat jatuh tempo. Penempatan baru di Agustus/September tetap mengelompokkan SPP Juli ke kelas pada TA yang sama. Sebelum penempatan, tampil sebagai **Belum ditempatkan**. Histori tidak mengikuti kelas dari TA berikutnya.
- SPP yang dibuat ulang oleh rencana reguler tidak menggandakan periode awal yang sudah ada.
- Uang pangkal dan pengajuan keringanan tidak diubah pada pekerjaan ini.

## Validasi

- `src/server/tunggakanAcademicPlacement.test.ts`: sebelum/sesudah penempatan, kelas tahun berbeda, histori penempatan tidak aktif, pembayaran lintas Tahun Buku, lunas, jatuh tempo, dan fallback tagihan lama.
- `src/pages/keuangan/SpmbInitialSpp.test.tsx`: formulir tanpa kelas mengirim tepat satu bulan dan nominal siswa tanpa rencana otomatis.
- `scripts/test-spmb-initial-spp.sql`: fixture QA pada clone, seluruh transaksi di-rollback; penerbitan eksternal/internal, nilai/periode, tanpa aktivasi/rencana, repeat-safe, validasi input, pembayaran awal/PD, penempatan belakangan, deduplikasi generator reguler.
