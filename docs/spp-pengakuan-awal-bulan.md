# Pengakuan SPP mulai bulan layanan

Per 2 Oktober 2026: belum diterapkan ke produksi. Pengguna mengoreksi pilihan akhir bulan menjadi awal bulan, mengikuti kebijakan bulanan sekolah. SQL baru wajib ditampilkan dan disetujui sebelum migration produksi. Ini implementasi kebijakan sekolah, bukan penetapan bahwa pengakuan penuh pada awal bulan sesuai seluruh standar akuntansi; penanggung jawab akuntansi menentukan kebijakan laporan yayasan.

## Perilaku

Tanggal pengakuan SPP adalah tanggal 1 bulan layanan. Jatuh tempo tetap tanggal 10 atau konfigurasi jenis pembayaran.

- SPP Oktober dibayar tanggal 2 Oktober: tagihan diakui sebagai pendapatan Oktober dan pembayaran melunasi piutang. Jika cron belum membukukan tagihan, kasir dan Midtrans membukukannya dalam transaksi pembayaran yang sama.
- SPP November dibayar Oktober: penerimaan masuk Pendapatan Diterima di Muka, dapat diakui mulai 1 November.
- SPP bulan berjalan dapat dicicil sejak bulan layanan mulai. Tagihan bulan mendatang yang masih terjadwal tetap harus dibayar penuh sesuai aturan sebelumnya.
- Generate tagihan bulan berjalan langsung membentuk jurnal piutang/pendapatan. Tagihan bulan mendatang menyimpan tanggal pengakuan terpisah dari jatuh tempo.
- Uang pangkal dan non-SPP mempertahankan kebijakan sebelumnya, termasuk awal TA 1 Juli untuk uang pangkal.

SPP memerlukan tagihan dengan periode layanan. SQL memilih akun berdasarkan jurnal/penanda pengakuan aktual; input akun yang tertinggal dari caller tidak menghasilkan pendapatan ganda. Kalender tahun buku dan TA Juli–Juni tetap dipetakan ke tahun layanan yang benar.

## Jurnal dan potongan

Contoh SPP bruto Rp450.000, potongan Rp50.000, netto Rp400.000:

| Kejadian | Debit | Kredit |
|---|---|---|
| Pengakuan tagihan bulan berjalan | Piutang Rp400.000 + Potongan Rp50.000 | Pendapatan Rp450.000 |
| Pembayaran Rp100.000 | Kas Rp100.000 | Piutang Rp100.000 |

Untuk pembayaran di muka, kas dikreditkan ke kewajiban dahulu. Pada tanggal pengakuan, helper membukukan sisa piutang dan seluruh potongan satu kali; masing-masing PD diakui sebesar netto pembayaran. Pembayaran penuh tanpa potongan tidak memerlukan jurnal piutang nol. Seluruh proses idempoten.

Pembatalan setelah pengakuan memulihkan piutang dan mempertahankan pendapatan periode layanan. Status tagihan yang sudah diakui tidak kembali terjadwal hanya karena belum tanggal 10. Penanda pengakuan diperiksa setelah lock tagihan. Urutan lock pembayaran/PD/tagihan pada pengakuan dan pembatalan dipertahankan.

## Data dan waktu proses

Jurnal yang telah terbit tidak diubah atau direklasifikasi. SPP belum dijurnal dan PD pending tanpa tanggal eksplisit memakai tanggal 1 periode target. Tidak ada UPDATE massal pembayaran/tagihan lama.

Audit sebelumnya menemukan 115 PD SPP pending, termasuk 37 tanpa jurnal penerimaan. Catatan tanpa jurnal yang valid tetap diblokir; rekonstruksi memerlukan audit dan persetujuan terpisah. Setelah rollout, cron yang sudah aktif akan memakai tanggal 1 untuk catatan valid yang belum diakui.

Jurnal pengakuan bertanggal hari pemrosesan di Asia/Jakarta. Tidak dilakukan backdate otomatis ke periode yang mungkin telah ditutup. Cron harian tetap sama; cutoff masa depan dibatasi hari ini. Helper internal hanya boleh dieksekusi service_role, dengan search_path kosong.

## Validasi

- 16 skenario SQL fixture lokal: batas awal bulan, pemetaan kalender, tanggal jatuh tempo tetap 10, pembayaran di muka, cutoff masa depan, cicilan, potongan, beasiswa penuh, pembatalan, Midtrans lintas tahun, jurnal lama, sumber penerimaan tanpa jurnal, dan pembayaran kasir/Midtrans tanggal 2 sebelum cron.
- Dua pengujian paralel: tiga permintaan pengakuan menghasilkan dua jurnal PD dan satu JPI; pembatalan menunggu lock tagihan, memulihkan piutang tanpa menghapus pendapatan.
- UI mengunci pengakuan sebelum awal bulan dan membukanya pada tanggal 1 waktu Jakarta.
- 282 tes aplikasi lulus; helper tanggal lolos TypeScript dan lint helper/UI pengakuan bersih. Build dijalankan ulang setelah perubahan kebijakan.
- Regression uang pangkal sebelumnya lulus pada migration baru.
- Full lint repository memiliki masalah lama; typecheck aplikasi sebelumnya tidak selesai dalam 150 detik/heap 1 GB pada VPS. Tidak diklaim lulus.
- Fixture tidak menguji seluruh RLS/trigger tutup buku. Tidak ada transaksi percobaan di produksi.

## Rollout

Migration: supabase/migrations/20261001225908_spp_pengakuan_awal_bulan.sql.

1. Tampilkan SQL persis pada commit final dan minta persetujuan produksi cmvzcpeiuompqgdvflky.
2. Verifikasi tujuh RPC terhadap preflight MD5; hentikan jika drift, jangan hapus guard.
3. Terapkan hanya migration ini dalam transaksi, bukan seluruh db push.
4. Verifikasi kolom/helper/privilege dan kalender lewat query baca; jangan tes RPC mutasi pada pembayaran produksi.
5. Merge/deploy setelah migration berhasil dan pantau Actions.
6. Rekonstruksi 37 penerimaan tanpa jurnal merupakan pekerjaan terpisah.
