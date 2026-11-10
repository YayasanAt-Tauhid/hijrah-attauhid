# Memperbarui `src/integrations/supabase/types.ts` dari skema Rustbase

Backend produksi adalah Rustbase, bukan Supabase, jadi `supabase gen types` tidak berlaku.
Skrip di sini membaca katalog Postgres produksi (hanya `SELECT`) dan **menambahkan** tabel dan
RPC yang dipakai kode tetapi belum ada di `types.ts`. Entri yang sudah ada tidak pernah diubah.

## Langkah

1. Cari nama yang dipakai kode tetapi belum ada di `types.ts` (tabel dari `.from("...")`,
   RPC dari `.rpc("...")`).
2. Jalankan `katalog.sql` di VM Rustbase (hanya membaca), isi `tabel` dan `rpc` dengan nama
   dipisah koma tanpa spasi:

   ```sh
   sudo docker exec -i rustbase-deploy-postgres-1 \
     psql -U rustbase -d proj_kqylkreswang -X -At -v ON_ERROR_STOP=1 \
     -v "tabel=nama_tabel_1,nama_tabel_2" -v "rpc=nama_rpc_1" \
     < katalog.sql > katalog.json
   ```

3. Tambahkan ke `types.ts`:

   ```sh
   python3 scripts/db-types/generate.py --catalog katalog.json \
     --types src/integrations/supabase/types.ts \
     --wanted-tables nama_tabel_1,nama_tabel_2 --wanted-rpcs nama_rpc_1
   ```

   Ringkasan JSON di stdout memuat `added_*`, `skipped`, `unknown_types`, dan
   `not_found_*` (nama yang diminta tetapi tidak ada di database).
4. Jalankan `npx tsc -p tsconfig.app.json --noEmit` dan bandingkan dengan `main`
   (`scripts/qa/compare-typecheck.py`): tidak boleh ada diagnosis baru.

## Batasan yang disengaja

- **Hanya menambah.** Bila kolom tabel lama di `types.ts` berbeda dari DB, skrip tidak
  memperbaikinya; itu keputusan terpisah karena bisa memunculkan diagnosis `tsc` baru.
- **Fungsi ber-overload dilewati** (dilaporkan di `skipped`); union tipenya ditulis manual.
- **Argumen RPC tidak ber-`| null`.** Postgres tidak menyimpan apakah argumen boleh NULL,
  jadi bentuknya mengikuti keluaran `supabase gen types`. Bila pemanggil mengirim `null`,
  sesuaikan di pemanggil atau tulis manual.
- **Kolom keluaran `RETURNS TABLE` tidak ber-`| null`** (sama seperti `supabase gen types`).
- Tipe Postgres yang belum dikenal (mis. `geometry`) menjadi `unknown` dan dilaporkan.
- Enum tidak ditangani (database saat ini tidak punya enum di skema `public`).
