# API Integrasi Hijrah v1

API baca untuk sinkronisasi **Hijrah → backend aplikasi penerima**. Kontrak eksternal berada pada TanStack Start server routes; pihak ketiga tidak memerlukan akses Supabase. Hak write opsional terbatas pada milestone SPMB.

## Base URL produksi

`https://app.hijrah-attauhid.or.id`

Prefix endpoint: `/api/v1`.

Gunakan header berikut pada setiap request:

```http
Authorization: Bearer <token_integrasi>
Accept: application/json
```

Token hanya boleh disimpan di backend penerima, bukan browser/APK, URL, analytics, atau source control. Token mentah hanya ditampilkan sekali saat dibuat di **Pengaturan → Integrasi API** (`/pengaturan/integrasi-api`). Hijrah menyimpan hash SHA-256 dan prefix token. Rotasi mencabut token lama.

## Scope dan pembatasan

| Scope | Akses |
|---|---|
| `pendaftaran:read` | data dasar pendaftaran, proses SPMB, status pembayaran pendaftaran |
| `pendaftaran:sensitive:read` | NIK/KK, kontak/alamat, orang tua, kesehatan/fisik, sekolah asal, kemampuan |
| `pendaftaran:documents:read` | metadata dokumen dan signed URL 60 detik |
| `pendaftaran:milestone:update` | Update Status SPMB (Tes, Lulus, dan Tidak Lulus) |
| `siswa:read` | siswa non-calon dan relasi kelas |
| `kelas:read` | kelas; anggota kelas juga membutuhkan `siswa:read` |

`department_ids` dan `academic_year_ids` pada integrasi adalah batas maksimum. Filter request tidak dapat memperluas akses. Cursor ditandatangani HMAC dan terikat pada token, integration ID, scope/unit/tahun ajaran, endpoint, serta filter; perubahan izin membuat cursor lama tidak valid sehingga consumer harus melakukan reconciliation/bootstrap baru.

## Endpoint

- `GET /pendaftaran` dan `GET /pendaftaran/{pendaftaran_id}`
- `GET /siswa` dan `GET /siswa/{siswa_id}`
- `GET /kelas` dan `GET /kelas/{kelas_id}/siswa`
- `GET /sync/pendaftaran`, `/sync/siswa`, `/sync/kelas`
- `GET /documents/{pendaftaran_id}.{jenis}` dengan `jenis`: `kk`, `akta`, `rapor`, `ijazah`

List menggunakan `limit` default 100, maksimum 200, dan `cursor` opaque. Filter yang relevan meliputi `departemen_id`, `tahun_ajaran_id`, `status`, dan relasi kelas sesuai endpoint. UUID harus valid. Timestamp menggunakan ISO-8601. Nilai database yang kosong dikirim `null`; blok sensitif/dokumen yang tidak diizinkan tidak dikirim sama sekali.

## Write milestone SPMB

Admin memilih **Update Status SPMB (Tes, Lulus, dan Tidak Lulus)** di **Pengaturan → Integrasi API**, saat membuat token atau mengubah izin integrasi. Token read-only tetap tidak memiliki akses write. Scope write tidak otomatis memberikan izin baca atau data sensitif.

```http
POST /api/v1/pendaftaran/{id}/milestone
Authorization: Bearer TOKEN
Content-Type: application/json

{"action":"tes"}
```

Gunakan `id` dari respons API pendaftaran, bukan ID siswa. Payload hanya menerima satu field `action`: `tes`, `lulus`, atau `tidak_lulus`. Biodata, NIK, orang tua, pembayaran, dan kelas tidak dapat diubah; field tambahan ditolak.

```sh
curl -X POST "https://app.hijrah-attauhid.or.id/api/v1/pendaftaran/PENDAFTARAN_ID/milestone" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"action":"tes"}'
```

Contoh keputusan tidak lulus:

```json
{"action":"tidak_lulus"}
```

Scope wajib: `pendaftaran:milestone:update`. Batas unit dan tahun ajaran token tetap berlaku. API memanggil workflow `spmb_mark_milestone()` existing; tidak menjalankan update biodata atau proses penerimaan/aktivasi siswa.

| Permintaan | Hasil |
|---|---|
| Token read-only | `403 forbidden` |
| Token tidak valid, kedaluwarsa, atau dicabut | `401 unauthorized` |
| ID tidak ditemukan atau di luar unit/tahun ajaran | `404 not_found` |
| Lulus/Tidak Lulus sebelum Tes | `400 business_rule_failed` |
| Action valid dengan prasyarat terpenuhi | `200` |
| Request ulang action yang sama | `200`, `marked_at` tetap sama |
| Payload tidak valid/field tambahan | `400` |

Contoh respons sukses:

```json
{"data":{"pendaftaran_id":"00000000-0000-4000-8000-000000000001","action":"tes","marked_at":"2026-09-17T04:00:00+00:00"},"request_id":"00000000-0000-4000-8000-000000000002"}
```

`tes`, `lulus`, dan `tidak_lulus` bersifat idempotent berdasarkan pendaftaran dan action, termasuk request bersamaan. `daftar_ulang` tetap tidak tersedia melalui API pihak ketiga. Tidak perlu `Idempotency-Key`. Waktu milestone ditentukan workflow dan tidak dapat dikirim atau direset oleh pihak ketiga. Audit mencatat integration ID, token ID, request ID, action dan hasil tanpa token mentah/biodata. Setiap request ulang tetap dicatat sebagai akses.

Jika terjadi `503` atau respons terputus, ulangi **action yang sama**: workflow mengembalikan timestamp existing jika operasi sebelumnya sudah berhasil. Audit intent disimpan sebelum workflow; bila pencatatan hasil gagal, API mengembalikan `503` agar tidak mengklaim hasil yang belum terkonfirmasi.

## Identitas stabil

`pendaftaran.id` berasal dari `siswa_detail.pendaftaran_id` dan **berbeda** dari `siswa.id`. `pendaftaran.siswa_id` bernilai `null` selama status `calon`, lalu menunjuk ID siswa setelah diterima. Jangan gunakan nama, NIK, NISN, nomor urut, atau path dokumen sebagai primary key sinkronisasi.

Dokumen memakai ID stabil `<pendaftaran_id>.<jenis>`. Signed URL bukan identitas permanen dan hanya berlaku 60 detik.

## Payload pendaftaran

`status_kelulusan` bernilai `lulus`, `tidak_lulus`, atau `null` bila keputusan belum dibuat. `tanggal_keputusan` diisi saat keputusan Lulus/Tidak Lulus ditetapkan.

Field dasar mencakup `id`, `siswa_id`, `status`, `tanggal_pendaftaran`, `unit`, `tahun_ajaran`, `angkatan`, `identitas`, `jenis_pendaftaran`, `kategori`, `status_asrama`, `tanggal_tes`, `status_kelulusan`, `tanggal_kelulusan`, `tanggal_keputusan`, `tanggal_daftar_ulang`, `verifikasi`, dan `pembayaran_pendaftaran`.

`pembayaran_pendaftaran` berbentuk:

```json
{
  "status": "paid",
  "tanggal_bayar": "2026-09-16T08:15:00+00:00",
  "jumlah": 250000,
  "gratis_gelombang_pertama": false
}
```

Status berasal dari resolver server-side Hijrah yang menggabungkan pencatatan pembayaran internal dan transaksi pembayaran SPMB. Detail provider, token pembayaran, Snap token, metadata gateway, dan secret tidak pernah diekspor. Consumer harus memperlakukan nilai status baru sebagai enum yang mungkin berkembang.

Dengan `pendaftaran:sensitive:read`, `data_sensitif` mencakup NIK/KK, TTL, agama, alamat, telepon/email, data fisik, penyakit/perjalanan, ayah/ibu, kontak orang tua, sekolah asal, dan kemampuan Iqro/Latin/hafalan. Field yang UI SPMB sedang sembunyikan tetap ada dalam kontrak tetapi dapat `null`.

Dengan `pendaftaran:documents:read`, `dokumen` berisi metadata `id`, `jenis`, `nama_file`, `mime_type`, `ukuran`, `version`, dan `download_path`. `version` berubah bila path objek sumber berubah. Path storage privat tidak diekspor.

## Bootstrap dan incremental sync

Untuk bootstrap yang aman: ambil checkpoint awal dari endpoint sync (`checkpoint` pada respons pertama), simpan nilainya, selesaikan seluruh snapshot melalui endpoint list, lalu mulai incremental dari checkpoint tersebut. Perubahan setelah high-water mark akan muncul pada incremental. Jangan mengambil checkpoint baru setelah snapshot karena dapat melewatkan perubahan yang terjadi selama snapshot.

Setiap event incremental memiliki `id`, `change`, `version`, `changed_at`, dan `data`. `version` adalah sequence monoton server. `change` dapat berupa `upsert`, `delete`, atau `scope_exit`. Consumer harus idempotent: simpan objek berdasarkan `(source='hijrah', object_type, external_id)`, abaikan event dengan version lebih lama/sama, dan commit data + cursor/checkpoint dalam transaksi lokal yang sama.

`scope_exit` berarti objek pernah berada dalam cakupan consumer tetapi kini tidak boleh dibaca. Arsipkan salinan sinkronisasi; jangan otomatis menghapus data transaksi lokal seperti absensi/peminjaman. Retensi change log adalah 90 hari. Checkpoint yang terlalu lama menghasilkan HTTP `410 checkpoint_expired` dan membutuhkan bootstrap/reconciliation ulang.

## Error dan rate limit

Format error:

```json
{"error":{"code":"...","message":"...","request_id":"uuid"}}
```

Status utama: `400` parameter/cursor, `401` token, `403` scope/filter di luar izin, `404` objek tidak ada/di luar scope, `410` checkpoint expired, `429` rate limit, dan `503` gangguan sementara. Limit default 300 request/menit per integrasi; autentikasi token invalid dibatasi 20 percobaan/menit per prefix. Respons 429 mengirim header `Retry-After`; gunakan exponential backoff + jitter.

## Pola consumer

Simpan token di secret manager backend. Jalankan hanya satu worker per kombinasi integrasi+jenis data. Untuk setiap halaman: verifikasi HTTP status, proses event secara idempotent, lalu simpan cursor/checkpoint bersama perubahan data dalam satu transaksi. Tombol manual **Sinkronkan** dan scheduler sebaiknya memakai engine yang sama agar klik ulang aman.

## Kompatibilitas

Breaking change memakai path versi baru (`/api/v2`). Dalam `/api/v1`, field atau enum baru dapat ditambahkan; consumer harus mengabaikan field yang tidak dikenal dan tidak crash pada enum baru.

Spesifikasi mesin: `docs/openapi-integration-v1.yaml`. Koleksi uji: `docs/postman/Hijrah-Integration-v1.postman_collection.json`.