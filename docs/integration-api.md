# API Integrasi Hijrah v1

API baca untuk sinkronisasi **Hijrah → aplikasi penerima**. Kontrak eksternal berada pada TanStack Start server routes, bukan Supabase Edge Functions. Aplikasi penerima tidak memerlukan akses Supabase.

## Base URL dan autentikasi

Gunakan origin deployment Hijrah yang sama dengan halaman `/spmb`, lalu prefix `/api/v1`. Base URL produksi harus diambil dari deployment Cloudflare yang berhasil; jangan menebak hostname dari project Supabase.

```http
Authorization: Bearer <token_integrasi>
Accept: application/json
```

Token hanya untuk backend penerima. Jangan simpan di browser/APK, URL, analytics, atau source control. Token mentah hanya ditampilkan sekali saat dibuat di **Pengaturan → Integrasi API** (`/pengaturan/integrasi-api`). Hijrah menyimpan SHA-256 token dan prefix saja. Rotasi langsung mencabut token lama. Pencabutan menghentikan akses berikutnya tetapi tidak menghapus salinan yang sudah disimpan pihak ketiga.

## Scope

| Scope | Akses |
|---|---|
| `pendaftaran:read` | identitas pendaftaran, nama, status, unit, tahun ajaran, angkatan, tanggal proses |
| `pendaftaran:sensitive:read` | NIK/KK, alamat/kontak, orang tua, kesehatan/fisik, sekolah asal, kemampuan; wajib bersama `pendaftaran:read` |
| `pendaftaran:documents:read` | metadata dan signed URL dokumen; wajib bersama `pendaftaran:read` |
| `siswa:read` | data siswa non-calon dan relasi kelas aktif |
| `kelas:read` | kelas dan anggota kelas; daftar anggota juga memerlukan `siswa:read` |

Pembatasan `department_ids` dan `academic_year_ids` diterapkan lagi pada setiap request/detail/sync. Filter request tidak dapat memperluas cakupan token.

## Endpoint

`GET /api/v1/pendaftaran`, `/api/v1/pendaftaran/{id}`, `/api/v1/siswa`, `/api/v1/siswa/{id}`, `/api/v1/kelas`, `/api/v1/kelas/{id}/siswa`, `/api/v1/sync/pendaftaran`, `/api/v1/sync/siswa`, `/api/v1/sync/kelas`, dan `/api/v1/documents/{id}`.

List memakai `limit` (default 100, maksimum 200) dan cursor opaque. Filter yang tersedia sesuai endpoint: `departemen_id`, `tahun_ajaran_id`, dan `status`. UUID harus valid. Respons bertimestamp menggunakan ISO-8601 PostgreSQL (`timestamptz`, UTC offset eksplisit); tanggal lahir adalah `YYYY-MM-DD`. Field yang tersimpan kosong dikirim `null`; field sensitif/dokumen yang tidak diizinkan **tidak dikirim**.

## Identitas

`pendaftaran.id` berasal dari `siswa_detail.pendaftaran_id` dan berbeda dari `siswa.id`. `pendaftaran.siswa_id` bernilai `null` selama status masih `calon`, dan baru menunjuk ID siswa setelah proses penerimaan mengubah status sesuai model akademik. Nama/NIK/NISN bukan kunci sinkronisasi.

## Pemetaan field SPMB

| JSON | Database | Scope |
|---|---|---|
| `id` | `siswa_detail.pendaftaran_id` | pendaftaran:read |
| `siswa_id` | `siswa.id` setelah bukan calon | pendaftaran:read |
| `status`, `tanggal_pendaftaran` | `siswa.status`, `siswa.created_at` | pendaftaran:read |
| `unit.id`, `angkatan.id` | `siswa.departemen_id`, `siswa.angkatan_id` | pendaftaran:read |
| `tahun_ajaran.id` | `siswa_detail.tahun_ajaran_id` | pendaftaran:read |
| `identitas.nama`, `identitas.jenis_kelamin` | `siswa.nama`, `siswa.jenis_kelamin` | pendaftaran:read |
| `jenis_pendaftaran`, `kategori`, `status_asrama` | kolom sama di `siswa_detail` | pendaftaran:read |
| `tanggal_tes`, `tanggal_kelulusan`, `tanggal_daftar_ulang` | `spmb_tanggal_tes`, `spmb_tanggal_lulus`, `spmb_tanggal_daftar_ulang` | pendaftaran:read |
| `verifikasi.status`, `verifikasi.waktu` | `spmb_verifikasi_status`, `spmb_verifikasi_at` | pendaftaran:read |
| `data_sensitif.nik`, `no_kk` | `siswa_detail.nik`, `no_kk` | sensitive |
| tempat/tanggal lahir, alamat, telepon | `siswa.*` | sensitive |
| anak ke, jumlah saudara, tinggi/berat/lingkar kepala, ukuran baju | `siswa_detail.*` | sensitive |
| penyakit, jarak, waktu perjalanan, transportasi | `siswa_detail.*` | sensitive |
| ayah/ibu: nama, NIK, TTL, pendidikan, pekerjaan, penghasilan, telepon, alamat | `siswa_detail.*_ayah`, `*_ibu` | sensitive |
| kontak/alamat orang tua | `siswa_detail.telepon_ortu`, `alamat_ortu` | sensitive |
| sekolah asal, kelas terakhir, alasan pindah, alamat/kab/kec/kel | `siswa_detail.asal_sekolah`, `kelas_terakhir`, `alasan_pindah`, `*_sekolah_asal` | sensitive |
| Iqro, membaca Latin, menulis Latin, hafalan Quran | `siswa_detail.kemampuan_iqro`, `membaca_latin`, `menulis_latin`, `hafalan_quran` | sensitive |
| dokumen KK/Akta/Rapor/Ijazah | `siswa_detail.dokumen_*_path` → metadata serializer | documents |

Field fisik/ukuran baju tetap dipetakan walau UI SPMB sedang menyembunyikannya; nilai yang belum pernah diisi tetap `null`. `pmb_payment_token`, token Snap, payload provider pembayaran, `spmb_verifikasi_by/reason/checklist`, secret, dan auth user tidak pernah masuk kontrak. Status pembayaran publik berasal dari `transaksi_midtrans` tetapi payload internal provider tidak diekspor; tanggal pembayaran dapat ditambahkan ke versi minor setelah relasi pembayaran diserialisasi secara eksplisit.

## Dokumen

Metadata memakai ID stabil `<siswa_id>.<jenis>`; signed URL bukan identitas permanen. `GET /api/v1/documents/{id}` memeriksa token + scope + unit/tahun ajaran, lalu menerbitkan signed URL storage selama **60 detik**. Bucket tetap privat. URL yang sudah diterbitkan dapat tetap berlaku sampai kedaluwarsa. Jangan log signed URL.

## Bootstrap dan incremental

1. Ambil halaman list sampai `has_more=false` untuk snapshot awal.
2. Sebelum/bersamaan bootstrap, panggil endpoint sync tanpa cursor untuk memperoleh `sync.checkpoint` (high-water mark change log).
3. Setelah snapshot selesai, baca incremental mulai checkpoint yang disimpan. Perubahan yang terjadi selama bootstrap ada setelah high-water mark dan tidak hilang.
4. Untuk setiap halaman incremental, proses `version` monoton, upsert berdasarkan `(source='hijrah', object_type, external_id)`, lalu simpan data + cursor/checkpoint **dalam transaksi lokal yang sama**.
5. Simpan checkpoint final hanya ketika `checkpoint_safe=true`. Halaman boleh diproses ulang; consumer harus idempotent dan menolak versi lebih lama dari `version` lokal.

Change log menggunakan sequence server sebagai versi perubahan, bukan `updated_at`; ini menghindari collision timestamp dan pagination timestamp sama. Trigger mencatat perubahan siswa, detail SPMB/dokumen, kelas, dan keanggotaan kelas. `scope_exit` berarti objek sebelumnya mungkin dimiliki consumer tetapi kini tidak dapat dibaca dalam cakupan token; arsipkan salinan sinkronisasi tanpa menghapus absensi/peminjaman lokal. `delete` berbeda dari siswa berstatus nonaktif.

Retensi change log kontrak adalah 90 hari. Checkpoint lebih tua menghasilkan HTTP `410 checkpoint_expired`; lakukan bootstrap/reconciliation ulang. Perubahan scope sensitif harus diikuti cleanup field sensitif di database penerima. Perubahan scope/unit/tahun ajaran yang besar sebaiknya diikuti reconciliation penuh.

## Error dan rate limit

Error konsisten: `{ "error": { "code", "message", "request_id" } }`. Status utama: `400` parameter/cursor, `401` token, `403` scope, `404` tidak ada/di luar scope, `410` checkpoint expired, `429` rate limit, `503` gangguan sementara. Limit default integrasi: **300 request/menit/integrasi**; token invalid dibatasi 20 percobaan/menit per prefix. Hormati `Retry-After`/nilai `retry_after` dan gunakan exponential backoff + jitter untuk 429/5xx.

## Contoh backend penerima (TypeScript/pseudocode)

```ts
async function syncAll(db, kind) {
  // advisory lock / distributed lock: hanya satu worker per integrasi+kind
  await db.transaction(async tx => {
    let state = await tx.syncState.lockForUpdate('hijrah', kind)
    let cursor = state.cursor
    do {
      const r = await fetch(`${process.env.HIJRAH_BASE_URL}/api/v1/sync/${kind}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, {
        headers: { Authorization: `Bearer ${process.env.HIJRAH_TOKEN}` }
      })
      if (r.status === 410) { await tx.markNeedsBootstrap(kind); return }
      if (r.status === 429 || r.status >= 500) throw new Retryable(await r.json(), r.headers.get('Retry-After'))
      if (!r.ok) throw new Error('Sinkronisasi ditolak')
      const body = await r.json()
      for (const ch of body.data) {
        const old = await tx.externalObject.get('hijrah', kind, ch.id)
        if (old && old.version >= ch.version) continue
        if (ch.change === 'delete' || ch.change === 'scope_exit') await tx.externalObject.archive('hijrah', kind, ch.id, ch.version)
        else await tx.externalObject.upsert({source:'hijrah', kind, externalId:ch.id, version:ch.version, payload:ch.data})
        // tabel absensi/peminjaman lokal tidak disentuh
      }
      cursor = body.sync.next_cursor
      await tx.syncState.save(kind, {cursor, checkpoint: body.sync.checkpoint})
    } while (cursor)
  })
}
```

Scheduler memanggil fungsi yang sama. Retry harus membaca `Retry-After`, backoff eksponensial + jitter, dan tidak membuka worker kedua untuk integrasi yang sama. UI tombol **Sinkronkan** menampilkan status berjalan/berhasil/gagal, waktu sukses terakhir, added/updated/archived, dan pesan aman; klik ulang menjalankan engine idempotent yang sama.

## Kompatibilitas

Perubahan breaking memakai versi path baru (`/api/v2`). Dalam `/api/v1`, field baru boleh ditambahkan; consumer harus mengabaikan field yang tidak dikenal. Enum baru dapat muncul dan harus diperlakukan sebagai nilai tak dikenal, bukan crash.

Lihat `docs/openapi-integration-v1.yaml` dan `docs/postman/Hijrah-Integration-v1.postman_collection.json`.