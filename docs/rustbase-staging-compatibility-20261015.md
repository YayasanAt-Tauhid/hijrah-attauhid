# Audit awal kompatibilitas Hijrah At-Tauhid → Rustbase
Tanggal: 15 Oktober 2026 (Asia/Jakarta)  
Status: **READ-ONLY / PERENCANAAN STAGING** — bukan approval cutover produksi.

## Lingkup dan batas tegas
- Aplikasi: `YayasanAt-Tauhid/hijrah-attauhid` (TanStack Start, Cloudflare Workers, `@supabase/supabase-js`).
- Tujuan: menilai backend Rustbase (Rust/Axum/Postgres, kompatibilitas sebagian dengan API Supabase).
- **JANGAN** mengganti URL/keys produksi, melakukan deploy production, migrasi pembayaran aktual, atau mengekspor data personal siswa ke VPS Safara.
- **JANGAN** menggunakan VPS `attauhid-portable-installer` (2 vCPU/2 GB) sebagai server staging/produksi. VPS itu khusus menyimpan installer dan arsip pemulihan.
- Staging Rustbase harus memiliki **project terisolasi**, data sintetis, kredensial terpisah, serta database/storage terpisah. Tidak boleh mengganggu Rustbase Safara yang sedang digunakan.

## Inventaris yang sudah diverifikasi (read-only)
| Komponen | Supabase produksi | Clone pengujian terdahulu |
| --- | ---: | ---: |
| Tabel `public` | 98 | 95 |
| Policy RLS `public` | 246 | 227 |
| Fungsi `public` (termasuk fungsi ekstensi) | 380 | 373 |
| Trigger non-internal `public` | 63 | Belum dihitung |
| Ukuran database PostgreSQL | ~81 MB | ~35 MB |
| User autentikasi | 88 | Belum dihitung |
| Objek Storage | 431 di bucket `pmb-dokumen` | Belum dihitung |
| Fungsi `SECURITY DEFINER` `public` | 136 | Belum dihitung |

Detail autentikasi di produksi (agregat saja, **tanpa hash atau identitas user**): 28 akun mempunyai password hash berformat bcrypt; 60 akun tidak memiliki hash password. Cara login 60 akun itu perlu dikonfirmasi (jangan otomatis diasumsikan OAuth). Rustbase saat ini menggunakan Argon2id untuk memverifikasi password. Ini **blocking** untuk pemindahan password tanpa adaptasi atau proses set ulang.

Ekstensi produksi: `btree_gist`, `pg_cron`, `pg_net`, `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp`. Fungsi SQL menggunakan `auth.uid()`; ditemukan juga rujukan fungsi ke `cron`, `net.http_*`, dan Vault. Keberadaan fungsi yang sama di Rustbase belum diuji.

**Clone staging yang lama ketinggalan dari produksi**; jangan dijadikan patokan final tanpa rekonsiliasi skema.

## Bukti kode aplikasi
- `src/integrations/supabase/client.ts`: client browser dibangun dari `VITE_SUPABASE_URL` dan publishable key.
- `src/server/supabase.ts`: admin client menggunakan service role key; verifikasi user melalui `supabase.auth.getUser(token)`.
- `src/server/auth.ts`: middleware mengirim bearer token dari sesi browser dan memeriksa role/lingkup departemen.
- `src/server/portalOrtu.ts`: pendaftaran dan linking orang tua, termasuk `auth.admin.createUser`.
- `src/server/spmbDocuments.ts`: signed upload/download URL untuk dokumen pendaftaran.
- `src/server/payment.ts`: transaksi Midtrans, verifikasi kepemilikan tagihan, dan kontrol order.

**Bahaya:** sekadar mengganti `VITE_SUPABASE_URL`/API key belum cukup untuk menjamin kompatibilitas skema Auth, Storage, OAuth, RLS, `service_role`, fungsi SQL dan proses keuangan.

## Kondisi Rustbase (pengujian read-only pada instance dev terpisah)
- `GET http://127.0.0.1:8000/health` → HTTP 200.
- `GET http://127.0.0.1:8000/auth/v1/health` → HTTP 200.
- `GET http://127.0.0.1:8000/rest/v1/` → HTTP 200.
- Ini **hanya** membuktikan liveness endpoint, **BUKAN** kompatibilitas Hijrah / keamanan RLS / migrasi.
- Server dev Rustbase yang diperiksa memiliki disk root ~91% digunakan; **jangan** memuat clone database produksi ke server tersebut tanpa perluasan kapasitas/isolasi.

## Daftar pengujian staging (belum dieksekusi kecuali yang bertanda PASS)
| Test | Metode | Status |
| --- | --- | --- |
| Liveness endpoint Rustbase | GET health; Auth health; REST root | PASS (endpoint saja) |
| Project dan database Rustbase **terisolasi** | Test dengan schema dan akun dummy | BELUM |
| Kompatibilitas `supabase-js`: select/filter/RPC/embedded resources | Integration tests dengan data dummy | BELUM |
| Login password bcrypt lama | Reproduksi dengan hash sintetis bcrypt, pilih adaptasi/reset | BLOCKED |
| Auth admin, login orang tua, Google OAuth/OTP, pemulihan akun | E2E tanpa akun produksi | BELUM |
| RLS role Admin/TU/Kasir/Orang Tua dan scope lembaga | Positive/negative tests, unauthorized cross-tenant | BELUM |
| Restore fungsi/trigger & ekstensi | Diff signature, language, SECURITY DEFINER, grants, dependency | BLOCKED |
| Signed URL Storage: upload, download, akses terlarang | File dummy dan expiration | BELUM |
| Midtrans: webhook replay, status pending, retry, cicilan, diskon | Gateway sandbox + fixture dummy, idempotency | BELUM |
| Rekonsiliasi saldo, tagihan, jurnal dan diskon | Compare canonical fixture snapshot | BELUM |
| Beban 50/100/200 sesi serentak | Load test pada mesin terpisah | BELUM |
| Backup+restore dan rollback | Drill end-to-end | BELUM |

## Langkah pelaksanaan aman
1. Perbarui *struktur* clone staging ke revision produksi dengan prosedur backup dan persetujuan terpisah. Jangan salin PII ke Safara.
2. Siapkan instance Rustbase khusus Hijrah staging, resource/port/secret/database terisolasi, dan fixture siswa serta pembayaran **sintetis**.
3. Jalankan uji kompatibilitas API + RLS lebih dahulu; tentukan status PASS / FAIL dengan bukti per endpoint.
4. Rancang dan uji migrasi identitas; **jangan** mengimpor hash bcrypt ke Rustbase dan menganggap login akan tetap berfungsi.
5. Evaluasi portabilitas ekstensi `pg_cron`, `pg_net`, `supabase_vault` dan database trigger/function sebelum data riil.
6. Evaluasi migrasi Storage 431 objek sebagai tugas terpisah dari dump SQL.
7. Uji pembayaran Midtrans sandbox, race conditions, double notification, partial payment, potongan, dan rekonsiliasi.
8. Lakukan *cutover* hanya sesudah hasil identik, pengujian beban, backup+restore, rollback, audit keamanan, dan persetujuan eksplisit.

## Kesimpulan sementara
**NO-GO untuk cutover produksi saat ini.** Potensi kompatibilitas API Rustbase menjanjikan, tetapi **belum** tervalidasi untuk aplikasi Hijrah. Fokus berikutnya: menyiapkan test project terisolasi dengan data dummy dan membereskan hambatan Auth serta ekstensi.

Referensi: `https://supabase.com/docs/guides/self-hosting/restore-from-platform` (dump database tidak membawa objek storage, pengaturan provider, dan edge functions). Ini pedoman untuk Supabase self-hosted; migrasi ke Rustbase memerlukan pemetaan ekstra.
