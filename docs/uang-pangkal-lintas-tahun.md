# Uang pangkal lintas tahun

Pembayaran uang pangkal untuk TA 2027/2028 yang diterima pada 2026 dibukukan
pada Tahun Buku 2026 sebagai debit kas/bank dan kredit akun 2106
(Pendapatan Diterima Dimuka-Uang Pangkal). Tahun ajaran akademik disimpan
pada tagihan; awal TA, 1 Juli 2027, menjadi jatuh tempo/pengakuan.

Migration: `supabase/migrations/20261001140054_uang_pangkal_dimuka_tahun_akademik.sql`.

## Cakupan

- Hanya lima jenis utama: UANG PANGKAL TK, SD, SMP, SMA, MTA.
- Kolom keuangan `tahun_ajaran_id` tetap menunjuk Tahun Buku. Kolom baru
  `tagihan.tahun_akademik_id` menunjuk Tahun Ajaran akademik.
- Generator meneruskan TA dari pilihan SPMB/Tarif. Caller lama hanya boleh
  memakai fallback bila tepat satu TA dimulai dalam Tahun Buku target.
- Pembayaran uang pangkal memerlukan tagihan agar target periode tidak hilang.
- Jurnal/tagihan/pembayaran historis tidak direklasifikasi.
- Cicilan tagihan yang sudah menjadi piutang tetap melunasi piutang.
  Ketentuan pembayaran penuh tagihan terjadwal yang sudah ada tetap berlaku.
- Pengakuan manual dan cron memakai transaksi yang sama, lock pembayaran dan
  pendapatan, serta akun kewajiban dari jurnal penerimaan. Status sudah diakui
  membuat panggilan ulang tidak menerbitkan jurnal lagi.
- Cutoff masa depan dibatasi hari ini (Asia/Jakarta), termasuk posting piutang,
  agar pilihan tanggal tidak dapat mempercepat pengakuan.
- RPC baru hanya dapat dipanggil service_role; halaman memakai server function
  dengan autentikasi dan role admin/keuangan.

## Validasi

- 15 skenario SQL di Postgres 16 lokal dengan kolom/default dan RPC produksi:
  penerimaan kasir/online 2026, target Juli 2027, pengakuan dini ditolak,
  idempotensi, akun kewajiban setelah konfigurasi berubah, potongan bruto/netto,
  pelunasan piutang/cicilan lama, TA ambigu/mismatch, caller wrapper,
  penolakan pembayaran tanpa target, cutoff akrual gabungan, jurnal balance.
- Helper tarif/diskon/auth pada fixture dikendalikan untuk mengisolasi jurnal.
  Ini bukan pengujian RLS atau clone data produksi. Tes SQL menolak nama
  database selain fixture lokal dan berakhir ROLLBACK.
- Dua sesi Postgres bersamaan mengakui item yang sama: hanya satu jurnal PD,
  panggilan kedua memakai jurnal yang sama, saldo kewajiban bersih nol.
- Tes komponen memastikan Januari 2027 masih memblokir pengakuan dan Juli 2027
  membukanya; tahun buku dan tahun ajaran ditampilkan terpisah.
- Full Vitest dan build Cloudflare dijalankan.
- Full lint repository memiliki masalah lama; file UI/helper/server pengakuan
  yang diubah lolos lint terarah. Pemeriksaan TypeScript penuh kehabisan heap
  VPS; pemeriksaan terarah menemukan tipe RPC lama
  `can_manage_akademik_departemen` yang belum terdaftar di types.ts pada main.

## Catatan data historis

Audit read-only menemukan 115 catatan pendapatan di muka, semuanya pending dan
masing-masing menunjuk pembayaran unik. Sebanyak 37 pembayaran tidak mempunyai
jurnal_id; jurnal penerimaan juga tidak dapat dicocokkan lewat referensi ID
pembayaran. Alur baru menolak pengakuan catatan tersebut tanpa membuat jurnal.
Rekonstruksi/reklasifikasi data lama memerlukan audit dan persetujuan tersendiri;
migration ini tidak melakukan koreksi saldo atau penghapusan data historis.

## Penerapan produksi

1. Tinjau dan minta persetujuan SQL lengkap sebelum migration produksi.
2. Verifikasi lagi project produksi cmvzcpeiuompqgdvflky dan definisi RPC.
   Migration memeriksa MD5 definisi yang diaudit agar tidak menimpa perubahan
   dari sesi lain. Jika berubah, berhenti dan susun ulang migration dari live.
3. Terapkan hanya migration ini, dalam transaksi, melalui apply_migration.
   Jangan db push seluruh ledger historis.
4. Verifikasi konfigurasi kelima jenis terhubung akun 2106, kolom/FK akademik
   tersedia, RPC baru tidak dapat dieksekusi anon/authenticated.
5. Setelah migration berhasil, merge/deploy kode dan verifikasi GitHub Actions.
   Query halaman baru memerlukan kolom migration; jangan deploy terlebih dulu.

Per 1 Oktober 2026: migration BELUM diterapkan ke produksi. Persetujuan SQL
masih diperlukan. Tidak ada perubahan data keuangan produksi pada sesi ini.
