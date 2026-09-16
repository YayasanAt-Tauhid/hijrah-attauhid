# API Integrasi Hijrah v1

Dokumentasi integrasi backend Hijrah → aplikasi penerima.

**Base URL produksi:** `https://app.hijrah-attauhid.or.id/api/v1`

Gunakan `Authorization: Bearer <token_integrasi>`. Token hanya untuk backend dan tidak boleh ditanam di browser/APK/source control. Token dibuat dan dikelola melalui **Pengaturan → Integrasi API**.

## Scope

- `pendaftaran:read`: data dasar SPMB dan status pembayaran pendaftaran.
- `pendaftaran:sensitive:read`: NIK/KK, kontak, orang tua, kesehatan/fisik, sekolah asal dan kemampuan.
- `pendaftaran:documents:read`: metadata dan signed URL dokumen privat.
- `siswa:read`: siswa non-calon dan relasi kelas.
- `kelas:read`: kelas; daftar siswa kelas juga membutuhkan `siswa:read`.

Pembatasan unit (`department_ids`) dan tahun ajaran (`academic_year_ids`) selalu diterapkan server-side. Cursor ditandatangani dan terikat pada integrasi, izin, endpoint, serta filter.

## Endpoint

`GET /pendaftaran`, `/pendaftaran/{pendaftaran_id}`, `/siswa`, `/siswa/{siswa_id}`, `/kelas`, `/kelas/{kelas_id}/siswa`, `/sync/pendaftaran`, `/sync/siswa`, `/sync/kelas`, dan `/documents/{pendaftaran_id}.{kk|akta|rapor|ijazah}`.

List memakai `limit` default 100 (maksimum 200) dan cursor opaque. ID pendaftaran berasal dari `siswa_detail.pendaftaran_id` dan berbeda dari ID siswa. Jangan gunakan nama/NIK/NISN sebagai kunci sinkronisasi.

Payload pendaftaran menyertakan `pembayaran_pendaftaran` (`status`, `tanggal_bayar`, `jumlah`, `gratis_gelombang_pertama`). Detail provider pembayaran, token pembayaran, metadata gateway, secret, dan path storage privat tidak diekspor.

Dokumen menggunakan ID `<pendaftaran_id>.<jenis>`; endpoint dokumen menerbitkan signed URL privat selama 60 detik.

## Bootstrap & sync

Ambil checkpoint awal dari endpoint sync **sebelum snapshot list selesai**, simpan checkpoint tersebut, selesaikan snapshot, lalu jalankan incremental dari checkpoint itu. Event incremental memiliki `id`, `change`, `version`, `changed_at`, dan `data`. Consumer wajib idempotent dan menyimpan data + cursor/checkpoint dalam transaksi lokal yang sama. `change` dapat berupa `upsert`, `delete`, atau `scope_exit`.

Retensi change log 90 hari. Checkpoint yang kedaluwarsa menghasilkan HTTP 410 dan membutuhkan bootstrap/reconciliation ulang. Perubahan permission juga menginvalidasi cursor lama.

## Error & rate limit

Error berbentuk `{"error":{"code","message","request_id"}}`. Status utama: 400, 401, 403, 404, 410, 429, 503. Limit default 300 request/menit/integrasi dan 20 percobaan token invalid/menit/prefix. Respons 429 mengirim `Retry-After`; gunakan exponential backoff + jitter.

Spesifikasi OpenAPI dan koleksi Postman tersedia di direktori dokumentasi publik yang sama.