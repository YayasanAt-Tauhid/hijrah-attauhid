# Log akrual harian

Menu: **Keuangan → Pengakuan Pendapatan** (kartu *Riwayat Akrual Harian*) dan **Tutup Buku** (butir *Akrual harian otomatis tanpa galat*
pada Checklist Sebelum Tutup Buku). Akses: admin dan keuangan aktif.

## Masalah

Job pg_cron `akrual-jatuh-tempo-harian` (00:05 UTC = 07:05 WIB) memanggil `jalankan_akrual_jatuh_tempo()`. Fungsi itu hanya mengembalikan
galat di array `errors` pada hasil jsonb, sehingga pg_cron selalu mencatat `succeeded` dan galat tidak pernah terlihat.
Per 29 Okt 2026 ada 33 tagihan SPP Oktober 2026 (lunas, pembayaran tanpa `jurnal_id`) yang gagal dijurnal setiap hari tanpa ada yang tahu.

## Solusi

Aditif terhadap fungsi: `jalankan_akrual_jatuh_tempo()` **tidak diubah**.

- Tabel `public.akrual_harian_log` (immutable; RLS: hanya admin/keuangan yang dapat membaca; tidak ada hak tulis untuk `authenticated`).
  Satu baris per eksekusi: waktu, jumlah dan nominal piutang diposting, jumlah dan nominal pendapatan diakui, jumlah galat,
  daftar galat (maksimal 200 pertama; `jumlah_galat` tetap jumlah sebenarnya, `galat_terpotong` menandai pemotongan),
  serta `gagal_total`/`pesan_gagal`.
- Fungsi `public.jalankan_akrual_harian_berlog(date,uuid,integer,text)` membungkus fungsi lama, meneruskan hasilnya apa adanya, dan mencatat.
  Bila fungsi lama gagal total, pekerjaannya di-rollback oleh sub-transaksi, kegagalan dicatat, dan job tidak ikut gagal.
  Hanya `postgres` dan `service_role` yang dapat memanggilnya.
- Satu-satunya perubahan pada objek yang sudah ada: perintah job cron `akrual-jatuh-tempo-harian` diganti ke fungsi berlog
  (dijaga: hanya bila `pg_cron` ada dan perintah lama persis `select public.jalankan_akrual_jatuh_tempo();`).
- UI: kartu 14 eksekusi terakhir dengan rincian galat; butir ke-4 di Checklist Sebelum Tutup Buku (peringatan bila eksekusi terakhir bergalat,
  gagal total, atau lebih dari 36 jam lalu = job kemungkinan berhenti).

## Batasan

- Eksekusi manual lewat tombol (`src/server/akrual.ts`) memanggil fungsi lama dan tidak tercatat di log (kolom `sumber` sudah menyiapkan `manual`).
- Log hanya mencatat; tidak memperbaiki penyebab galat. 33 SPP Okt 2026 butuh keputusan akuntansi tim keuangan.

## Migration dan rollout

Target: Hijrah V5, `cmvzcpeiuompqgdvflky`. SQL: `supabase/migrations/20261029100500_log_akrual_harian.sql`.
Preflight memverifikasi hash `jalankan_akrual_jatuh_tempo` (`d5c32a9b95511fa51dcb40e087cb0200`); bila berubah, hentikan dan tinjau ulang.
Terapkan manual lewat MCP hanya setelah SQL ditinjau dan **disetujui eksplisit oleh pengguna**.

Urutan: terapkan migration -> verifikasi perintah job di `cron.job` -> push/deploy UI (UI membaca tabel baru; jangan deploy sebelum migration).
Verifikasi fungsi berlog di produksi menunggu eksekusi cron berikutnya (menjalankannya manual akan memposting jurnal sungguhan).

Rollback perintah cron: `select cron.alter_job(job_id := <jobid>, command := 'select public.jalankan_akrual_jatuh_tempo();');`

## Validasi (29 Oktober 2026)

- `supabase/tests/akrual_harian_log.sql`: 13 pemeriksaan lulus di Clone `flxbrbnyzclcthjwynsh` (fungsi akrual lama diganti stub di dalam
  transaksi yang di-rollback; Clone memang tidak punya `pg_cron`, sehingga perintah cron tidak diuji di sana). Jangan menjalankan script ini di produksi.
- Tes aplikasi: lihat bagian status di `SESI_NOTES.md`.
