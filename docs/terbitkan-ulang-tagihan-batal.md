# Terbitkan ulang tagihan SPMB yang dibatalkan

Menu: **Keuangan → Rencana Tagihan Siswa Baru**, kolom *SPP Awal* / *Uang Pangkal* pada status **Perlu diperiksa**.
Akses: admin dan keuangan aktif.

## Masalah

`tagihan_unique` (siswa, jenis, tahun buku, bulan) tidak mengecualikan status batal. Tagihan yang dibatalkan
(mis. siswa pindah asrama ↔ non asrama) tetap menempati slot-nya, sehingga Input Massal dan alur SPMB menolak
dengan *"periksa melalui koreksi tagihan"*. Tidak ada jalur koreksi untuk baris yang sudah dibatalkan.

## Solusi

Satu RPC `public.terbitkan_ulang_tagihan_batal(...)` dan satu tabel riwayat immutable
`public.tagihan_riwayat_terbit_ulang`. Migration **aditif**: `tagihan_unique`, 12 definisi generate yang memakainya,
serta fungsi lain tidak diubah.

- Mode pratinjau (`p_apply=false`) tidak menulis apa pun dan mengembalikan `preview_hash`.
- Penerapan (`p_apply=true`) wajib membawa hash yang sama; data berubah → ditolak.
- Satu transaksi: tarif per siswa lama dinonaktifkan beralasan dan tarif baru dibuat; baris tagihan yang sama
  dikembalikan ke `terjadwal` dengan nominal baru; kondisi lama (tagihan, tarif, verifikasi) masuk riwayat;
  `audit_keuangan` dicatat.
- SPP: kategori/akun/nominal diubah lewat protokol otorisasi `guard_snapshot_spp_tagihan` (baris
  `spp_kategori_periode_audit` pada transaksi yang sama) dan `spp_kategori_periode` ikut dicatat.
- Uang pangkal: verifikasi ulang memakai `spmb_finance_private.verify_pangkal`; baris verifikasi lama (jika ada)
  dipindah ke riwayat lalu diganti baris baru. Keringanan alumni ikut tertangani.

## Batasan v1 (ditolak dengan pesan jelas)

- Hanya status `dibatalkan` (bukan `dihapusbuku`), tanpa pembayaran/hapus buku, tahun buku belum ditutup.
- Tanpa link pembayaran aktif, tanpa sesi Midtrans aktif, tanpa rencana tagihan aktif untuk jenis yang sama.
- SPP: hanya SMP/SMA/MTA, hanya bulan mendatang, belum pernah dijurnal.
- Uang pangkal: hanya jatuh tempo di masa depan. Jatuh tempo yang sudah lewat butuh posting jurnal per tagihan yang
  belum tersedia (posting piutang hanya batch global) → gunakan koreksi keuangan.
- Tagihan baru `terjadwal` tanpa jurnal; jurnal piutang diposting oleh proses pengakuan yang sudah ada.
  Catatan: tidak ditemukan pemanggil otomatis `posting_piutang_jatuh_tempo` (tidak ada pg_cron, tidak ada di `src`);
  ini perilaku sistem yang sudah ada, bukan akibat fitur ini, tetapi perlu dipastikan siapa yang menjalankannya.

## Migration dan rollout

Target: Hijrah V5, `cmvzcpeiuompqgdvflky` (produksi). SQL: `supabase/migrations/20261029093000_terbitkan_ulang_tagihan_batal.sql`.
Preflight memverifikasi keberadaan dependensi dan hash `verify_pangkal`, `preview_pangkal`,
`guard_snapshot_spp_tagihan`, `batalkan_tagihan_atomik`; jika berubah, hentikan dan tinjau ulang.
Terapkan manual lewat MCP hanya setelah SQL ditinjau dan **disetujui eksplisit oleh pengguna**.

Urutan: terapkan migration → deploy aplikasi → `p_apply=false` untuk tagihan target (tanpa menulis) → pengguna
menyetujui hasil → eksekusi lewat dialog.

## Validasi (29 Oktober 2026)

- `supabase/tests/terbitkan_ulang_tagihan_batal.sql`: 27 pemeriksaan lulus di Clone `flxbrbnyzclcthjwynsh`
  (fixture Qa139 diklon dalam transaksi, semua di-rollback). Termasuk: alur lama menolak dengan pesan identik produksi,
  baris SPP hasil terbit ulang setara dengan hasil generate baru, uang pangkal dengan dan tanpa verifikasi lama.
  Jangan menjalankan script ini di produksi.
- Clone membutuhkan tabel stub `payment_link` (kolom sama dengan produksi); stub bukan bagian migration.
- `npx vitest run`: 129 berkas, 1.031 tes lulus. `tsc --noEmit`: 0 galat. `npm run build`: sukses.

## Kasus pemicu

Nadhif Alvarez (V5): uang pangkal SMP Rp13.100.000 dan SPP SMP Juli 2027 Rp1.350.000 dibatalkan 29 Okt 2026
(alasan "pindah ke non asrama"); target non asrama: uang pangkal Rp10.100.000 (acuan SK) dan SPP Rp500.000.
Keduanya belum pernah dijurnal, tanpa pembayaran, tanpa baris verifikasi.

## Status rollout

- 29 Okt 2026: migration diterapkan ke V5 (`cmvzcpeiuompqgdvflky`) atas persetujuan pengguna. Ledger remote mencatat
  `20261029094702 terbitkan_ulang_tagihan_batal` (nama file repo `20261029093000`; ledger memang dapat berbeda dari nama file).
  Verifikasi pasca-migrasi: RLS aktif, `anon` tidak dapat memanggil RPC, `authenticated` tidak dapat menulis langsung ke riwayat,
  riwayat kosong, data Nadhif tidak berubah.
- Pratinjau (`p_apply=false`, dalam transaksi yang di-rollback) untuk dua tagihan Nadhif: SPP Juli 2027 asrama Rp1.350.000 -> non asrama
  Rp500.000 (akun 4102 -> 4103); uang pangkal Rp13.100.000 -> Rp10.100.000 (program non_asrama, tanpa verifikasi lama).
- Eksekusi untuk Nadhif belum dilakukan; menunggu persetujuan pengguna. Aplikasi (tombol) belum di-deploy.
