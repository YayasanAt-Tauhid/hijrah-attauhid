

## Perbaikan Proses Tutup Buku

### Masalah Saat Ini
1. **Tidak ada pencatatan Laba/Rugi ke Ekuitas** — Selisih pendapatan dan beban (laba/rugi) tidak dipindahkan ke akun "Laba Ditahan" di Ekuitas
2. **Tidak ada penguncian periode** — Setelah tutup buku, transaksi masih bisa diinput ke periode lama
3. **Tidak ada audit trail** — Tidak tercatat siapa yang melakukan tutup buku dan kapan

### Rencana Perbaikan

#### 1. Database Migration
- Tambah kolom `ditutup` (boolean, default false) pada tabel `tahun_ajaran` untuk menandai periode yang sudah ditutup buku (berbeda dari `aktif`)
- Tambah tabel `log_tutup_buku` untuk audit trail:
  - `id`, `tahun_ajaran_id`, `user_id`, `tanggal_proses`, `total_laba_rugi`, `jurnal_id`, `keterangan`
- Tambah setting `AKUN_LABA_DITAHAN` di tabel `pengaturan_akun` agar user bisa mapping akun Ekuitas untuk menampung laba/rugi

#### 2. Perbaikan Logika Tutup Buku (`TutupBuku.tsx`)
- Sebelum proses, cek apakah akun "Laba Ditahan" sudah dikonfigurasi di `pengaturan_akun`
- Pada jurnal penutup, tambahkan baris untuk memindahkan selisih laba/rugi ke akun Laba Ditahan:
  - Laba (positif): Kredit akun Laba Ditahan
  - Rugi (negatif): Debit akun Laba Ditahan
- Set `ditutup = true` pada tahun ajaran yang ditutup
- Insert record ke `log_tutup_buku`
- Tampilkan ringkasan Laba/Rugi di preview sebelum tutup buku

#### 3. Penguncian Periode
- Pada hook `useCreateJurnal` dan `useUpdateJurnal` di `useJurnal.ts`, tambahkan validasi: jika tanggal jurnal jatuh dalam periode tahun ajaran yang `ditutup = true`, tolak transaksi
- Pada `InputPembayaran` dan `InputPengeluaran`, tambahkan validasi serupa

#### 4. UI Tambahan di Halaman Tutup Buku
- Tampilkan card ringkasan: Total Pendapatan, Total Beban, Laba/Rugi Bersih
- Tampilkan warning jika akun Laba Ditahan belum dikonfigurasi
- Tampilkan riwayat tutup buku dari tabel `log_tutup_buku`
- Filter dropdown tahun buku: tandai yang sudah ditutup agar tidak bisa ditutup ulang

