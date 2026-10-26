# Persetujuan penghapusan data

Role selain admin mengajukan tindakan lewat alur penghapusan yang sudah ada. Alasan wajib 5–2000 karakter. Pengajuan tidak mengubah sumber data. Admin membuka /pengajuan-penghapusan untuk memeriksa, menyetujui, atau menolak. Pemohon melihat pengajuannya sendiri; admin melihat seluruh pengajuan. Daftar memiliki halaman agar pengajuan lama tetap dapat diakses.

## Batas dan integritas

- Pengajuan tetap mengikuti kewenangan modul. Admin TU dibatasi lembaga; kasir tidak memperoleh hak penghapusan keuangan baru. Referensi bersama mengikuti role pengelola sebelumnya.
- Data siswa beserta pendaftaran SPMB, referensi akademik, pegawai, referensi keuangan, skema keringanan, jurnal, pengeluaran, kas kecil, penyisihan piutang, pembatalan tagihan/pembayaran masuk dalam cakupan. Penghapusan langsung siswa_detail oleh non-admin juga ditolak.
- Ini bukan persetujuan untuk mengedit setiap field. Penggantian baris detail dalam proses edit, penyimpanan presensi, pelepasan relasi oleh admin, dan pembersihan transaksi sementara tetap menggunakan alur masing-masing.
- Draf jurnal milik pembuat boleh dihapus langsung. jurnal.dibuat_oleh adalah ID pegawai, sehingga dibandingkan dengan users_profile.pegawai_id.
- Jurnal posted tidak dapat dihapus. Pembatalan tagihan/pembayaran menggunakan RPC atomik yang sudah ada. Penghapusan pengeluaran/kas kecil/penyisihan yang terhubung ke jurnal posted menambahkan jurnal pembalik, menyimpan snapshot, dan mencatat audit keuangan dalam transaksi yang sama. Sumber dengan jurnal draft diminta diperiksa terlebih dahulu.
- Siswa yang sudah memiliki tagihan/pembayaran/riwayat kelas tidak dapat dihapus. Kelas, tingkat, angkatan, dan tahun ajaran yang telah digunakan juga dilindungi. Jenis penerimaan yang direferensikan dinonaktifkan sesuai perilaku sebelumnya.
- Snapshot sumber dan relasi keuangan dibandingkan lagi saat persetujuan sambil memegang row lock. Perubahan membuat status changed tanpa mengeksekusi tindakan. Akun pemohon dan admin harus tetap aktif dan berwenang.
- Hanya satu pengajuan pending per sumber. Keputusan hanya dapat dijalankan sekali. Batch maksimal 100 tagihan memakai satu subrequest Worker dan hasil per tagihan.

## Batas server dan database

Actor selalu diambil dari authMiddleware yang memverifikasi sesi; input pengguna tidak menentukan actor. Dua RPC tindakan dan RPC batch hanya dapat dieksekusi service_role. Helper berada di schema deletion_private, tanpa grant eksekusi publik. Tabel pengajuan memakai RLS dan tidak menerima INSERT/UPDATE/DELETE dari authenticated. Pemanggilan RPC pembatalan lama menolak actor non-admin, sehingga server lama tidak dapat melewati pengajuan. Trigger menolak DELETE langsung non-admin pada sumber penting, dengan pengecualian draf jurnal milik pembuat. TRUNCATE role klien dicabut untuk sumber tersebut.

Service-role dan pekerjaan pemulihan/kompensasi tetap merupakan batas kepercayaan server. Secret tidak boleh masuk ke browser.

## Penerapan

Target produksi Hijrah adalah cmvzcpeiuompqgdvflky. Pastikan identitas proyek benar dan ambil definisi schema/fungsi terbaru sebelum menerapkan migration 20261020222319_data_deletion_approval.sql. Migration menambah tabel/aturan serta guard, tanpa menghapus data bisnis. Setelah migration terverifikasi, merge/deploy source aplikasi dan lakukan pemeriksaan dengan akun admin, keuangan, dan Admin TU. Jangan memakai proyek Laundry sebagai target.

Pada sesi implementasi, konektor Supabase hanya memperlihatkan Production Laundry. Karena itu migration produksi, merge, dan deployment belum dilakukan. Kandidat tetap terisolasi dari main agar aplikasi produksi tidak meminta RPC yang belum tersedia.

Jika aplikasi perlu dikembalikan ke versi lama setelah migration, guard database sengaja tetap menolak pembatalan non-admin. Jangan melepas guard untuk memulihkan tombol lama; gunakan admin sementara atau perbaiki deployment.

## Verifikasi lokal

scripts/qa/deletion-approval.sql berjalan dalam transaksi dan selalu ROLLBACK. Fixture memakai schema-only backup Hijrah 15 Oktober 2026 tanpa data produksi. Dua objek schema migration historis yang tidak masuk backup tidak diperlukan oleh skenario non-legacy ini. Pengujian mencakup otorisasi, cakupan lembaga, RLS, pengajuan ganda, perubahan sumber/relasi, keputusan sekali pakai, pembatalan tagihan/pembayaran, draf, jurnal pembalik, dan tutup buku.

Tes server memeriksa pemalsuan actor, validasi input, batas daftar milik sendiri, dan akun nonaktif. Tes UI memeriksa alasan wajib, pembatalan form, pergantian akun, tombol admin, penjelasan data berubah, dan pagination.
