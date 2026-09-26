# API Integrasi Hijrah v1.1

API untuk sinkronisasi **Hijrah ↔ backend aplikasi penerima**. Prefix tetap `/api/v1`; v1.1 bersifat backward-compatible sehingga endpoint, token, dan scope lama tetap berlaku. Write pihak ketiga tetap berbasis scope eksplisit: milestone SPMB dan, bila diizinkan admin, import/update data pegawai.

## Base URL produksi

`https://app.hijrah-attauhid.or.id`

Prefix endpoint: `/api/v1`.

Gunakan header pada setiap request:

```http
Authorization: Bearer <token_integrasi>
Accept: application/json
```

Token hanya boleh disimpan di backend penerima, bukan browser/APK, URL, analytics, atau source control. Token mentah hanya ditampilkan sekali saat dibuat di **Pengaturan → Integrasi API** (`/pengaturan/integrasi-api`). Hijrah menyimpan hash SHA-256 dan prefix token. Rotasi mencabut token lama.

Respons v1.1 mengirim `X-Hijrah-API-Version: 1.1`, `X-Hijrah-API-Major: 1`, dan `X-Request-ID`. Prefix URL tetap `/api/v1`.

## Scope dan pembatasan

| Scope | Akses |
|---|---|
| `pendaftaran:read` | data dasar pendaftaran, proses SPMB, status pembayaran pendaftaran |
| `pendaftaran:identity:read` | NISN, NIK/KK, tempat dan tanggal lahir |
| `pendaftaran:contact:read` | alamat, telepon/email, serta kontak dasar orang tua |
| `pendaftaran:sensitive:read` | **legacy compatibility**: seluruh blok sensitif lama, termasuk identitas, kontak, orang tua, kesehatan/fisik, sekolah asal, kemampuan |
| `pendaftaran:documents:read` | metadata dokumen dan signed URL 60 detik |
| `pendaftaran:milestone:update` | Update Status SPMB (Tes, Lulus, dan Tidak Lulus) |
| `siswa:read` | siswa non-calon dan relasi kelas |
| `kelas:read` | kelas; anggota kelas juga membutuhkan `siswa:read` |
| `pegawai:read` | data operasional pegawai: ID, NIP, nama, jenis kelamin, jabatan, status, unit, tanggal masuk/pensiun, golongan |
| `pegawai:write` | bulk import dan update data pegawai; tidak memberi akses role/login, presensi, tabungan, atau keuangan |

Scope `identity`, `contact`, `sensitive`, dan `documents` pendaftaran memerlukan `pendaftaran:read`. Scope write tidak otomatis memberikan scope read. Scope `pendaftaran:sensitive:read` tetap dipertahankan agar token lama tidak rusak; integrasi baru dianjurkan memakai scope paling sempit.

`department_ids` dan `academic_year_ids` pada integrasi adalah batas maksimum. Filter request tidak pernah memperluas akses. Cursor ditandatangani HMAC dan terikat pada integration ID, scope, unit/tahun ajaran, endpoint, dan filter.

## Endpoint

- `GET /pendaftaran` dan `GET /pendaftaran/{pendaftaran_id}`
- `GET /siswa` dan `GET /siswa/{siswa_id}`
- `GET /kelas` dan `GET /kelas/{kelas_id}/siswa`
- `GET /pegawai` dan `GET /pegawai/{pegawai_id}`
- `POST /pegawai/import` untuk bulk insert/update JSON (maksimum 200 baris/request)
- `GET /sync/pendaftaran`, `/sync/siswa`, `/sync/kelas`
- `GET /documents/{pendaftaran_id}.{jenis}` dengan `jenis`: `kk`, `akta`, `rapor`, `ijazah`
- `POST /pendaftaran/{pendaftaran_id}/milestone`

List menggunakan `limit` default 100, maksimum 200, dan `cursor` opaque. UUID harus valid. Timestamp menggunakan ISO-8601. Nilai kosong dikirim `null`; blok sensitif/dokumen yang tidak diizinkan tidak dikirim.

## Filter list v1.1

### Pendaftaran

`GET /api/v1/pendaftaran` mendukung:

| Filter | Nilai |
|---|---|
| `departemen_id` | UUID lembaga tujuan |
| `tahun_ajaran_id` | UUID tahun ajaran |
| `status` | status pendaftaran |
| `status_tes` | `sudah_tes` atau `belum_tes` |
| `status_kelulusan` | `lulus`, `tidak_lulus`, atau `belum_diputuskan` |
| `gelombang_id` | UUID gelombang SPMB |
| `status_verifikasi` | status verifikasi SPMB |

Contoh:

```http
GET /api/v1/pendaftaran?departemen_id=<UUID_SMP>&tahun_ajaran_id=<UUID_TA>&status_tes=belum_tes
```

### Siswa

`GET /api/v1/siswa` mendukung `departemen_id`, `tahun_ajaran_id`, `status`, dan `kelas_id`.

```http
GET /api/v1/siswa?departemen_id=<UUID_SMP>&kelas_id=<UUID_KELAS_7A>
```

### Kelas

`GET /api/v1/kelas` mendukung `departemen_id` dan `tahun_ajaran_id`.

### Pegawai

`GET /api/v1/pegawai` mendukung `departemen_id` dan `status` (`aktif` / `nonaktif`). Data pegawai membutuhkan scope `pegawai:read` dan sengaja dibatasi pada data operasional. Alamat, telepon, email, tempat/tanggal lahir, agama, foto, dokumen pribadi, data keluarga, serta data sensitif pegawai tidak diekspos melalui Integration API.

Jika filter unit/tahun ajaran berada di luar scope token, server mengembalikan `403 filter_out_of_scope`. Untuk pegawai, pembatasan `department_ids` tetap berlaku; `academic_year_ids` tidak digunakan karena pegawai tidak terikat tahun ajaran.

## Payload pendaftaran

Field dasar mencakup `id`, `siswa_id`, `status`, `tanggal_pendaftaran`, `unit`, `tahun_ajaran`, `angkatan`, `identitas`, `jenis_pendaftaran`, `kategori`, `status_asrama`, `gelombang`, `status_tes`, `tanggal_tes`, `status_kelulusan`, `tanggal_kelulusan`, `tanggal_keputusan`, `tanggal_daftar_ulang`, `status_verifikasi`, `verifikasi`, dan `pembayaran_pendaftaran`.

`status_tes` bernilai `sudah_tes` bila `tanggal_tes` sudah ada dan `belum_tes` bila belum. Field `tanggal_tes` lama tetap dipertahankan.

`status_kelulusan` bernilai `lulus`, `tidak_lulus`, atau `null` bila keputusan belum dibuat. `tanggal_keputusan` diisi saat keputusan Lulus/Tidak Lulus ditetapkan.

`pembayaran_pendaftaran` berbentuk:

```json
{
  "status": "paid",
  "tanggal_bayar": "2026-09-16T08:15:00+00:00",
  "jumlah": 250000,
  "gratis_gelombang_pertama": false
}
```

Detail provider, token pembayaran, Snap token, metadata gateway, dan secret tidak pernah diekspor.

Dengan `pendaftaran:identity:read`, blok `data_sensitif` hanya berisi identitas yang diizinkan. Dengan `pendaftaran:contact:read`, blok tersebut hanya menambah data kontak yang diizinkan. Token lama dengan `pendaftaran:sensitive:read` tetap menerima bentuk lengkap seperti v1 sebelumnya.

## Write milestone SPMB

Admin memilih **Update Status SPMB (Tes, Lulus, dan Tidak Lulus)** saat membuat atau mengubah izin integrasi. Scope write tidak otomatis memberikan izin baca atau data sensitif.

```http
POST /api/v1/pendaftaran/{id}/milestone
Authorization: Bearer TOKEN
Content-Type: application/json

{"action":"tes"}
```

Payload hanya menerima satu field `action`: `tes`, `lulus`, atau `tidak_lulus`. Biodata, NIK, orang tua, pembayaran, kelas, NIS, dan aktivasi siswa tidak dapat diubah; field tambahan ditolak.

| Permintaan | Hasil |
|---|---|
| Token read-only | `403 forbidden` |
| Token tidak valid/kedaluwarsa/dicabut | `401 unauthorized` |
| ID tidak ditemukan atau di luar unit/tahun ajaran | `404 not_found` |
| Lulus/Tidak Lulus sebelum Tes | `400 business_rule_failed` |
| Action valid | `200` |
| Request ulang action yang sama | `200`, timestamp tetap |
| Payload tambahan/tidak valid | `400` |

`daftar_ulang` tetap tidak tersedia melalui API pihak ketiga.


## Integrasi data pegawai

Endpoint baca (data operasional saja):

```http
GET /api/v1/pegawai?limit=100&departemen_id=<UUID>&status=aktif
GET /api/v1/pegawai/{pegawai_id}
```

Dengan `pegawai:read`, respons berisi data operasional: ID, NIP, nama, **email**, jenis kelamin, jabatan, unit/lembaga, status, tanggal masuk, tanggal pensiun, golongan terakhir, dan waktu pembuatan record. **Email pegawai tersedia melalui API**. Data pribadi lain seperti alamat, nomor HP, TTL, agama, foto, dokumen, serta data keluarga tetap tidak tersedia melalui API.

Bulk import/update membutuhkan scope `pegawai:write`:

```http
POST /api/v1/pegawai/import
Authorization: Bearer TOKEN
Content-Type: application/json

{
  "update_existing": true,
  "rows": [
    {
      "pegawai_id": "00000000-0000-4000-8000-000000000001",
      "nip": "19870001",
      "nama": "Ahmad Fulan",
      "email": "ahmad.fulan@example.com",
      "jabatan": "Guru",
      "departemen_id": "00000000-0000-4000-8000-000000000010",
      "status": "aktif"
    }
  ]
}
```

Aturan pencocokan sama dengan import pada halaman kepegawaian: `pegawai_id` diprioritaskan, lalu NIP. Nama, email, dan telepon **tidak** dipakai sebagai kunci update otomatis. Bila `pegawai_id` dan NIP menunjuk dua pegawai berbeda, baris ditolak.

`update_existing=false` (default) menolak record yang sudah ada. Dengan `update_existing=true`, record lama diperbarui pada ID yang sama sehingga relasi akun pengguna, presensi, riwayat jabatan, tabungan, dan data terkait tidak dibuat ulang atau diputus. Field kosong pada update diabaikan; untuk memindahkan pegawai menjadi pegawai Yayasan/lintas lembaga, kirim `"departemen_id": null`.

Field yang diterima: `pegawai_id`, `nip`, `nama`, `email`, `jenis_kelamin`, `jabatan`, `departemen_id`, `status`, `tanggal_masuk`, `tanggal_pensiun`, dan `golongan_terakhir`. Field lain ditolak. Endpoint ini dapat membaca dan menulis **email pegawai**, tetapi **tidak dapat** membaca/menulis alamat, telepon, TTL, agama, foto, dokumen pribadi, data keluarga, role/login pengguna, `users_profile`, presensi, tabungan, jurnal, pembayaran, atau tabel keuangan.

Tanggal menggunakan `YYYY-MM-DD`, `jenis_kelamin` menggunakan `L` / `P`, dan `status` menggunakan `aktif` / `nonaktif`. Maksimum 200 baris per request dan bulk write dibatasi 30 request/menit per integrasi.

Contoh hasil:

```json
{
  "data": {
    "summary": {"created": 1, "updated": 2, "failed": 1, "total": 4},
    "rows": [
      {"row": 1, "status": "updated", "pegawai_id": "00000000-0000-4000-8000-000000000001"},
      {"row": 2, "status": "error", "error": {"code": "already_exists", "message": "Pegawai sudah ada; set update_existing=true untuk memperbarui"}}
    ]
  }
}
```

Endpoint pegawai saat ini memakai list/detail dan bulk import. Belum ada incremental sync/webhook khusus pegawai; webhook yang tersedia tetap untuk `pendaftaran`, `siswa`, `kelas`, dan `dokumen`.

## Webhook event v1.1

Webhook bersifat opsional dan dikonfigurasi administrator pada **Pengaturan → Integrasi API**. URL wajib HTTPS. Signing secret webhook berbeda dari Bearer token dan hanya ditampilkan saat webhook pertama dibuat atau secret dirotasi.

Event dikirim asinkron sehingga kegagalan server penerima **tidak menggagalkan transaksi SPMB**. Hijrah menggunakan outbox, retry bertahap, dan dispatcher terjadwal. Event hanya dikirim bila objek berada dalam scope unit/tahun ajaran integrasi.

Contoh body:

```json
{
  "event_id": "chg_12345",
  "type": "integration.change",
  "api_version": "1.1",
  "object_type": "pendaftaran",
  "object_id": "00000000-0000-4000-8000-000000000001",
  "change": "upsert",
  "version": 12345,
  "changed_at": "2026-09-24T08:10:00+00:00"
}
```

Webhook sengaja tidak membawa biodata/PII. Setelah menerima event, backend penerima mengambil objek melalui endpoint API biasa sehingga scope tetap berlaku.

Header webhook:

```http
Content-Type: application/json
X-Hijrah-Event-ID: chg_12345
X-Hijrah-API-Version: 1.1
X-Hijrah-Signature: sha256=<hex_hmac_sha256>
```

Verifikasi `X-Hijrah-Signature` dengan HMAC-SHA256 terhadap **raw request body** menggunakan signing secret. Jangan melakukan parse lalu serialize ulang sebelum verifikasi.

Event yang tersedia: `pendaftaran`, `siswa`, `kelas`, dan `dokumen`. Event `dokumen` hanya dikirim bila integrasi memiliki `pendaftaran:read` **dan** `pendaftaran:documents:read`. Tombol **Kirim tes** menghasilkan event `integration.test`.

## Identitas stabil

`pendaftaran.id` berasal dari `siswa_detail.pendaftaran_id` dan berbeda dari `siswa.id`. `pendaftaran.siswa_id` dapat `null` selama status calon. Jangan gunakan nama, NIK, NISN, NIS, nomor urut, atau path dokumen sebagai primary key sinkronisasi.

Dokumen memakai ID stabil `<pendaftaran_id>.<jenis>`. Signed URL bukan identitas permanen dan hanya berlaku 60 detik.

## Bootstrap dan incremental sync

Untuk bootstrap: ambil checkpoint awal dari endpoint sync, simpan nilainya, selesaikan snapshot melalui endpoint list, lalu mulai incremental dari checkpoint tersebut. Jangan mengambil checkpoint baru setelah snapshot karena perubahan yang terjadi selama snapshot bisa terlewat.

Setiap event incremental memiliki `id`, `change`, `version`, `changed_at`, dan `data`. `change` dapat berupa `upsert`, `delete`, atau `scope_exit`. Consumer harus idempotent dan menyimpan cursor/checkpoint bersama perubahan data secara atomik.

Retensi change log adalah 90 hari. Checkpoint terlalu lama menghasilkan `410 checkpoint_expired` dan membutuhkan bootstrap ulang.

## Monitoring dan error

Administrator dapat melihat jumlah request/error 24 jam, rata-rata durasi 24 jam, request/error 7 hari, pemakaian terakhir, serta status webhook terakhir dari halaman Integrasi API.

Format error:

```json
{"error":{"code":"...","message":"...","request_id":"uuid"}}
```

Status utama: `400`, `401`, `403`, `404`, `410`, `429`, dan `503`. Limit default 300 request/menit per integrasi. Respons `429` mengirim `Retry-After`; gunakan exponential backoff + jitter.

## Kompatibilitas dan deprecation

- `/api/v1` mempertahankan kompatibilitas field dan endpoint lama.
- Field baru boleh ditambahkan di v1; consumer harus mengabaikan field yang tidak dikenal.
- Enum baru dapat ditambahkan bila tidak mengubah arti nilai lama.
- Field lama tidak akan dihapus atau diganti tipe di v1 tanpa masa deprecation.
- Jika suatu saat field v1 perlu dihentikan, dokumentasi akan mencantumkan tanggal deprecation/sunset terlebih dahulu.
- Breaking change menggunakan path versi baru, misalnya `/api/v2`.
- Token v1 lama tidak perlu dirotasi hanya karena penambahan endpoint pegawai. Scope pegawai harus diberikan eksplisit oleh administrator.

Spesifikasi mesin: `docs/openapi-integration-v1.yaml`. Koleksi uji: `docs/postman/Hijrah-Integration-v1.postman_collection.json`.
