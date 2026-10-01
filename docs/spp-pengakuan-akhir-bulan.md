# Pengakuan SPP pada akhir bulan layanan

Per 2 Oktober 2026: perubahan ini **belum diterapkan ke produksi**. Pengguna menyetujui persiapan perbaikan; SQL produksi tetap harus ditinjau dan disetujui sebelum migration, merge, dan deploy.

## Perilaku

Jatuh tempo SPP tetap tanggal 10 (atau hari yang dikonfigurasi). Tanggal itu menentukan keterlambatan pembayaran. Pendapatan SPP bulanan diakui penuh pada akhir bulan layanan: Februari 2027 tanggal 28, Februari 2028 tanggal 29, Januari tanggal 31. Ini adalah kebijakan pencatatan bulanan yang disetujui pengguna, bukan aturan yang mengharuskan semua jenis pendapatan memakai akhir bulan.

Tagihan baru menyimpan `tanggal_pengakuan` terpisah dari `jatuh_tempo`. SPP yang belum dijurnal menunggu tanggal pengakuan untuk pembentukan piutang. Pembayaran atas tagihan tersebut masuk akun Pendapatan Diterima di Muka, termasuk pembayaran tanggal 10–akhir bulan. Tagihan yang sudah memiliki jurnal piutang tetap melunasi piutang; migration tidak membalik atau mereklasifikasi jurnal historis.

SPP memerlukan tagihan dengan periode layanan; pembayaran tanpa tagihan ditolak supaya periode pengakuan tidak hilang. Pada kasir, SQL menentukan akun secara otoritatif berdasarkan jurnal/penanda pengakuan tagihan, sehingga akun dari caller yang tertinggal tidak menyebabkan kredit pendapatan ganda. Midtrans memakai aturan yang sama.

Cicilan setelah jatuh tempo tetap didukung, meskipun tagihan masih berstatus terjadwal karena menunggu akhir bulan. Pembayaran tagihan terjadwal sebelum jatuh tempo masih harus penuh, mengikuti aturan sebelumnya. Uang pangkal dan tagihan non-SPP mempertahankan kebijakan sebelumnya: uang pangkal baru mengikuti awal TA, misalnya 1 Juli 2027.

## Jurnal dan potongan

Misalnya SPP bruto Rp450.000, potongan Rp50.000, pembayaran Rp100.000 tanggal 10, dan sisa netto Rp300.000:

| Waktu | Debit | Kredit |
|---|---|---|
| Penerimaan tanggal 10 | Kas Rp100.000 | Pendapatan Dimuka Rp100.000 |
| Akhir bulan, sisa tagihan dan seluruh potongan | Piutang Rp300.000 + Potongan Rp50.000 | Pendapatan Rp350.000 |
| Akhir bulan, pengakuan pembayaran | Pendapatan Dimuka Rp100.000 | Pendapatan Rp100.000 |

Pendapatan bruto Rp450.000, kontra pendapatan Rp50.000, dan pendapatan netto Rp400.000 tercatat sekali. Potongan dicatat satu kali pada tagihan melalui penanda `pengakuan_spp_selesai`; setiap pembayaran di muka diakui sebesar nettonya melalui RPC PD yang idempoten. Pembayaran penuh tanpa potongan tidak memerlukan jurnal piutang nol.

Pembatalan pembayaran setelah pendapatan layanan diakui membalik penerimaan/pengakuan pembayaran dan memulihkan piutang. Pendapatan atas layanan yang sudah diberikan dipertahankan. Ini juga menangani pembatalan di antara akrual sisa piutang dan pengakuan PD. Pembayaran dan PD dikunci dahulu, kemudian tagihan, mengikuti urutan pengakuan; penanda pengakuan diperiksa setelah lock tagihan agar tidak membaca status sebelum proses lain selesai.

## Data historis dan waktu proses

- Jurnal yang sudah terbit tidak diubah. Tagihan yang sudah memiliki `jurnal_piutang_id` tetap memakai alur piutang lama.
- SPP yang masih belum dijurnal dan PD pending tanpa tanggal pengakuan eksplisit memakai akhir bulan periode target. Tidak ada UPDATE massal pada tagihan atau pembayaran lama.
- 115 PD SPP pada audit produksi masih pending. Pemeriksaan sebelumnya menemukan 37 tanpa jurnal penerimaan; pengakuan tetap ditolak. Helper baru juga menolak pembentukan JPI di atas penerimaan tanpa jurnal kewajiban yang valid.
- Jurnal pengakuan bertanggal hari pemrosesan di Asia/Jakarta, mempertahankan kebijakan sebelumnya. Jika proses otomatis terlambat, sistem tidak melakukan backdate otomatis ke periode yang mungkin sudah ditutup.
- Jadwal cron harian yang sudah aktif tidak diubah. RPC batch dan manual memakai tanggal pengakuan yang sama; cutoff masa depan tidak dapat mempercepat pengakuan.

## Pengujian

- 15 skenario jurnal pada fixture PostgreSQL lokal, memakai kolom/default dan RPC produksi serta stub tarif/diskon/auth terkontrol. Sumber waktu RPC fixture diubah menjadi clock terkontrol di dalam transaksi test yang berakhir ROLLBACK; produksi tidak memakai clock test.
- Skenario meliputi tanggal 10/27/28, kabisat, cutoff masa depan, kasir, cicilan dan potongan, piutang belum dibayar, pelunasan lama, Midtrans lintas tahun, fallback Midtrans, beasiswa penuh, pembatalan setelah pengakuan, dan penerimaan historis tanpa jurnal.
- Pengujian concurrency dengan tiga koneksi: dua cicilan dan satu permintaan ulang menghasilkan satu JPI potongan/sisa piutang dan dua jurnal PD, kewajiban bersih nol. Seluruh jurnal balance. Uji pembatalan yang dipaksa menunggu lock tagihan juga memulihkan piutang dan mempertahankan pendapatan layanan.
- Regression uang pangkal sebelumnya tetap lulus.
- Tes UI memblokir tombol tanggal 10 dan membuka pada akhir bulan menurut waktu Jakarta. Tahun buku penerimaan dan tahun ajaran tetap ditampilkan terpisah.
- 282 tes aplikasi lulus; build Cloudflare berhasil. Lint helper/UI pengakuan/server akrual bersih; jumlah lint pada Input Pembayaran, Piutang Manajemen, server pembayaran dan types sama dengan baseline. Full lint repository tetap gagal karena masalah yang sudah ada.
- Typecheck helper tanggal lulus. Typecheck seluruh aplikasi tidak selesai dalam batas 150 detik dengan heap 1 GB pada VPS; tidak diklaim lulus.
- Fixture tidak menguji seluruh RLS, trigger tutup buku, maupun data produksi. Tidak ada pembayaran nyata dimasukkan selama pekerjaan ini.

## Rollout

Migration: `supabase/migrations/20261001225908_spp_pengakuan_akhir_bulan.sql`.

1. Tampilkan SQL lengkap dan minta persetujuan pengguna untuk produksi `cmvzcpeiuompqgdvflky`.
2. Verifikasi kembali definisi tujuh RPC. Preflight MD5 menolak drift; jangan menghapus guard untuk memaksa migration berjalan.
3. Terapkan hanya migration ini melalui `apply_migration`, dalam transaksi; jangan `db push` seluruh ledger historis.
4. Verifikasi kolom, helper, privilege service_role saja, dan tanggal pengakuan SPP. Jangan memanggil RPC mutasi terhadap pembayaran produksi untuk sekadar mencoba.
5. Setelah migration berhasil, merge/deploy aplikasi dan pantau GitHub Actions. Query aplikasi memerlukan kolom baru, sehingga deployment tidak boleh mendahului migration.
6. Rekonstruksi 37 catatan lama tetap memerlukan audit dan persetujuan terpisah.
