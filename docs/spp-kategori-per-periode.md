# Kategori SPP per bulan layanan

Menu: **Keuangan → Manajemen Piutang → Kategori SPP per Bulan**.
Akses: admin dan keuangan aktif.

Pilih siswa aktif SMP/SMA/MTA, jenis SPP pada lembaga yang sama, kategori,
bulan mulai, dan bulan akhir. Rentang maksimal 24 bulan dan hanya bulan
setelah bulan berjalan menurut waktu Asia/Jakarta.

Pratinjau menunjukkan tindakan per bulan:

- Tagihan mendatang tanpa transaksi: kategori dan akun pendapatannya disesuaikan.
- Belum ada tagihan: simpan kategori untuk proses pembuatan tagihan berikutnya.
- Ada pembayaran/cicilan, jurnal, transaksi online aktif, koreksi, atau tutup buku:
  terkunci dan dilewati.
- Lebih dari satu tagihan aktif per bulan: terkunci untuk diperiksa.

Nominal, status siswa, pembayaran, dan jurnal tidak diubah oleh alur ini.
Kategori setelah bulan akhir kembali mengikuti aturan pembuatan tagihan biasa,
kecuali bulan tersebut sudah memiliki rencana kategori lain.
Pindah kategori pada tagihan bulan berjalan/historis atau yang sudah dibayar
memerlukan proses koreksi keuangan tersendiri.

Alasan minimal 10 karakter wajib diisi. Data diperiksa kembali secara atomik
saat penyimpanan; pratinjau yang kedaluwarsa ditolak. Audit menyimpan pengguna,
waktu, alasan, kategori/akun lama dan baru, serta bulan yang dilewati.
Kategori pembayaran tetap mengikuti tagihan yang dibayar.

## Migration dan rollout

Target: Hijrah V5, `cmvzcpeiuompqgdvflky`.

SQL: `supabase/migrations/20261006015318_spp_kategori_per_periode.sql`.
Migration tidak menjalankan penyesuaian pada data siswa/tagihan.
Preflight memverifikasi hash fungsi production yang dibaca pada 6 Oktober 2026.
Jika hash berubah, hentikan rollout dan tinjau ulang definisi terbaru.
Terapkan hanya migration ini setelah SQL ditinjau dan disetujui pengguna.
Deploy aplikasi sesudah migration berhasil, lalu verifikasi akses dan pratinjau
tanpa menyimpan perubahan untuk siswa nyata.

## Validasi

- `npm test -- --maxWorkers=2`: 317 tes lulus.
- `npm run build`: lulus.
- `scripts/test-spp-period.sql`: tujuh skenario database lulus di fixture lokal
  `hijrah_spp_test_period_20261006`; seluruh data uji di-rollback.
- Pemeriksaan TypeScript seluruh repository masih gagal pada modul lama
  (antara lain definisi tabel SPMB dan NISN yang belum masuk ke tipe database).
  Tidak ada diagnostic pada `sppPeriod.ts` atau `SppCategoryPeriod.tsx`.

Fixture dibuat dari `hijrah_spp_test_boarding_final_20261005`, lalu tabel
`public.transaksi_midtrans(id uuid primary key default gen_random_uuid(),status text)`
ditambahkan karena fixture sebelumnya hanya memuat tabel item transaksi.
Migration diterapkan dengan transaksi tunggal sebelum tes.
Jangan menjalankan script fixture pada production.

Koneksi connector VPS terputus saat build/test paralel. Build dan tes aplikasi
kemudian diselesaikan pada checkout lain dari commit main yang sama,
`cb4912ee2ed125cde03ba26483cb62b9f1bef809`.
Worktree VPS: `/home/attauhid/projects/hijrah-spp-period`.
Saat melanjutkan, cocokkan worktree VPS dengan branch review terlebih dahulu;
jangan menimpa perubahan lokal yang belum diperiksa.
