# Hasil uji Rustbase sintetis untuk Hijrah At-Tauhid — 15 Oktober 2026

**Status: lulus untuk cakupan terbatas, tetapi cutover produksi tetap NO-GO.**

## Lingkungan dan keselamatan
- Endpoint: Rustbase **development lokal** di `http://127.0.0.1:8000` pada VPS Safara; backend berjalan sebelum uji. Ini **bukan** endpoint staging Hijrah terpisah secara fisik.
- Pengujian membuat **project dan database PostgreSQL khusus sementara** lewat Rustbase platform API, dua akun dummy, satu tagihan dummy, dokumen dummy, dan function/RLS dummy.
- Hanya data sintetis; **tidak membaca/menyalin data siswa, tagihan, atau akun produksi** ke VPS Rustbase.
- Menggunakan paket `@supabase/supabase-js` **v2.109.0** yang terpasang pada lingkungan dev; package Hijrah menyatakan `^2.101.0`.
- Menjalankan Node.js v20 dengan `--experimental-websocket`, karena SDK yang tersedia memerlukan implementasi WebSocket global.
- Semua project/database sementara dihapus melalui API setelah uji. Empat akun owner dummy dari iterasi uji dibersihkan dengan query SQL terbatasi khusus email sintetis berakhiran `@test.invalid`, tanggal 15 Okt 2026, dan **tanpa project milik mereka**. Jumlah sisa project uji Hijrah: **0**.
- Tidak ada restart/deploy/penggantian konfigurasi Rustbase Safara, Supabase Hijrah, Midtrans, maupun VPS storage.

## Hasil eksekusi
Perintah: `node --experimental-websocket scripts/rustbase-compat-synthetic.mjs`  
Hasil: `EXIT_CODE=0`; **16 PASS**, `projectCleaned=true`.

| Pemeriksaan | Hasil |
| --- | --- |
| Health Rustbase dev | PASS |
| Buat owner sementara | PASS |
| Buat project + database + key terisolasi | PASS |
| Membuat tabel tagihan dummy, RLS, RPC | PASS |
| Pemeriksaan role bawaan Supabase pada proyek Rustbase | PASS: role **TIDAK ADA** (temuan inkompatibilitas) |
| SDK `auth.signUp` dan sesi | PASS |
| SDK `auth.signInWithPassword` | PASS |
| SDK `auth.getUser` | PASS |
| Password salah ditolak | PASS |
| Tagihan dummy dimasukkan oleh pemiliknya | PASS |
| Orang tua B tidak dapat membaca tagihan orang tua A | PASS |
| Orang tua B tidak dapat membuat tagihan milik A | PASS |
| RPC menggunakan `auth.uid()` dalam konteks user | PASS |
| Service role membaca data | PASS |
| File bucket privat ditolak bagi user lain | PASS |
| Signed URL unduh file dummy valid | PASS |
| Hapus database/project dummy | PASS (cleanup tambahan) |

**Perhatian: PASS pemeriksaan role adalah bukti bahwa ketidakcocokan ditemukan, bukan bahwa role Supabase sudah kompatibel.**

## Penghalang nyata terhadap migrasi

1. **Role RLS.** Di Supabase produksi Hijrah, 245 policy menggunakan role `authenticated` dan satu menggunakan `service_role`. Proyek Rustbase baru menghasilkan role project-scoped; `to_regrole('authenticated')` serta `to_regrole('service_role')` adalah NULL. Migrasi SQL harus memetakan `TO authenticated` menjadi role Rustbase yang benar, ditambah verifikasi privilege dan RLS.
2. **Skema autentikasi.** Supabase `auth.users` mempunyai **35 kolom** (hasil katalog SQL); skema Rustbase jauh lebih ringkas. Di Supabase, 28 akun mempunyai hash password bcrypt, 60 akun tidak mempunyai hash. Rustbase saat ini menggunakan Argon2id. Belum ada bukti login lama dapat berfungsi tanpa strategi migrasi/reset.
3. **Fungsi SQL/ekstensi.** Produksi mempunyai **98 tabel, 380 fungsi public** (termasuk fungsi ekstensi), **246 policy, 63 trigger, 136 SECURITY DEFINER**, serta ekstensi `pg_cron`, `pg_net`, `supabase_vault` dan lainnya. Ada 44 `SECURITY DEFINER` yang memakai `auth.uid()` atau `auth.jwt()`; perlu audit satu per satu.
4. **Storage.** Ada 431 objek dokumen pendaftaran pada bucket `pmb-dokumen` (agregat metadata). Uji dummy membuktikan mekanisme dasar, bukan migrasi 431 file maupun otorisasi policy yang nyata.
5. **Pembayaran/akun orang tua.** Midtrans, replay webhook, cicilan, diskon, kelas/jenjang, Google OAuth, OTP, status akun, seluruh keringanan, dan rekonsiliasi jurnal **belum diuji**.
6. **Kapasitas.** VPS Rustbase development yang digunakan sedang memiliki ruang root sekitar 1,9 GB (91% terpakai); jangan impor database sekolah atau objek storage ke sana.

## Berikutnya
- Rancang migrasi **schema-only** dan translator PostgreSQL role/policy khusus project Rustbase, **tanpa** memuat data siswa nyata.
- Tambah fixture dummy yang menyerupai tagihan SPP/potongan/cicilan dan uji fungsi SQL penting pada database terisolasi.
- Uji migrasi autentikasi secara terpisah, dengan bcrypt sintetis dan pengujian transisi akun.
- Rancang staging Hijrah terisolasi secara layanan dan resource untuk E2E yang lebih luas; jangan pakai VPS storage arsip.
- Baru rencanakan cutover setelah semua uji transaksi, keamanan, backup+restore, rollback, dan stress test lulus.

Sumber kode audit: `scripts/rustbase-compat-synthetic.mjs` pada branch `audit/rustbase-staging-compat-20261015`. Data dalam dokumen ini hanyalah statistik/metadata dan hasil tes sintetis.
