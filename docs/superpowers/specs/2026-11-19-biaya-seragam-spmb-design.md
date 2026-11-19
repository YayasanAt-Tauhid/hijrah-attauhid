# Biaya Seragam SPMB — rancangan

Status: rancangan disetujui user lewat chat (19 Nov 2026, 09:52 WIB); dokumen ini menunggu tinjauan sebelum rencana implementasi. Belum ada kode.

## Tujuan

Harga seragam berasal dari vendor dan akan dibayar ke vendor. Hanya siswa SPMB yang sudah membayar minimal 25% uang pangkal yang dipesan. Halaman baru menampung harga vendor per tahun ajaran, menampilkan siapa yang boleh dipesan, dan merekap total yang harus dibayar ke vendor.

## Keputusan yang sudah diambil

- Cakupan opsi A: katalog harga + daftar pesanan + rekap vendor. Tanpa pencatatan status "sudah dipesan/dibayar" dan tanpa jurnal (itu pekerjaan lanjutan).
- Angka dari sekretaris mudir dalam ribuan rupiah (170 = Rp170.000, 95rb = Rp95.000).
- Stel yang dipesan: TK 5 stel, lembaga lain 4 stel. Form siswa tetap 5 slot untuk semua lembaga (keputusan 18 Nov tidak berubah).
- Ambang 25% memakai angka yang sudah ada: `progress.minimum = ceil(total / 4)` pada Monitoring Pembayaran SPMB. Layak bila `paid >= minimum`, `total > 0`, dan status bukan `belum_ada_tagihan` atau `perlu_verifikasi`.

## Data

Tabel baru `harga_seragam_vendor` (satu baris = satu nama stel + satu kelompok ukuran):

| Kolom | Keterangan |
|---|---|
| `id` | uuid, kunci utama |
| `tahun_ajaran_id` | FK `tahun_ajaran` (sama dengan `siswa_detail.tahun_ajaran_id`) |
| `departemen_id` | FK `departemen` (lembaga tujuan SPMB) |
| `jenis_kelamin` | `L`, `P`, atau `semua` (mis. Pramuka, Khas ungu) |
| `nama_stel` | cocok dengan nama stel siswa; pencocokan tidak peka huruf besar/kecil dan spasi dirapikan |
| `ukuran` | `text[]`; kosong = semua ukuran (mis. sablon harga rata). Ukuran dinormalkan huruf besar, X3L→3XL, X4L→4XL, X5L→5XL |
| `harga` | rupiah, bilangan bulat, ≥ 0 |
| `catatan`, `aktif`, `created_at`, `updated_at`, `created_by` | pendukung. Baris tidak dihapus dari UI; dinonaktifkan (`aktif = false`) |

Aturan basis data: pemicu menolak dua baris aktif yang bertabrakan (tahun ajaran, lembaga, nama stel sama, jenis kelamin beririsan, ukuran beririsan atau salah satunya kosong). RLS: baca dan tulis hanya untuk `admin` dan `keuangan` (`has_role`, yang juga berlaku untuk bendahara dan sekretaris yayasan berizin `keuangan.akses_data`).

Contoh baris: TK · L · "Set Gamis Merah" · {S,M} · 170000.

## Pencocokan harga

Per stel siswa (slot 1–5 untuk TK, 1–4 untuk lainnya), lembaga = `spmb_departemen_tujuan_id`:

1. Slot tanpa nama dilewati.
2. Nama ada tetapi ukuran kosong → status "ukuran belum diisi" (tidak dihitung).
3. Cari baris aktif: tahun ajaran, lembaga, nama stel cocok, jenis kelamin siswa atau `semua`, ukuran cocok atau kosong. Baris dengan jenis kelamin spesifik dan ukuran spesifik menang atas yang umum.
4. Tidak ada baris cocok → "harga belum ada" (tidak ditebak, tidak dihitung).

Total siswa = jumlah harga stel yang cocok.

## Halaman

Rute `/keuangan/seragam-vendor`, menu "Biaya Seragam SPMB" di grup Keuangan bersama Monitoring Pembayaran SPMB. Filter: tahun ajaran (default terbaru), lembaga, gelombang. Tiga tab:

- **Harga**: tabel dan form tambah/ubah/nonaktifkan; tombol "Salin dari tahun ajaran sebelumnya" (hanya bila tahun tujuan masih kosong untuk lembaga itu).
- **Daftar Pesanan**: siswa layak (≥25%) dengan stel, ukuran, harga, total, dan penanda "harga belum ada" / "ukuran belum diisi". Ringkasan di atas: jumlah layak, jumlah belum memenuhi 25%, jumlah dengan masalah data.
- **Rekap Vendor**: jumlah per lembaga, stel, dan ukuran × harga satuan, subtotal, total. Baris "harga belum ada" ditampilkan terpisah. Ekspor Excel (sheet Daftar Pesanan dan Rekap Vendor) memakai `exportExcel` yang sudah ada.

Daftar dihitung langsung saat halaman dibuka, jadi bertambah otomatis saat wali murid membayar. Rekap adalah kondisi saat dibuka, bukan pemesanan yang dikunci.

## Sumber data dan akses

- Siswa layak dan uang pangkal: `getSpmbPaymentMonitor` (siswa SPMB lulus tes dengan gelombang; nominal netto dari tagihan, dibayar dari pembayaran). Server sudah memeriksa izin.
- Ukuran stel: `siswa_detail.ukuran_seragam` lewat hook yang sama dengan halaman Seragam Siswa (`readUniformSizes`).
- Izin rute: `keuangan.pembayaran` (sama dengan Monitoring Pembayaran SPMB, karena sumber datanya memakai izin itu). Menu disembunyikan untuk kasir dan Admin TU; hanya `admin` dan `keuangan` (serta bendahara/sekretaris lewat RLS) yang dapat mengubah harga.

## Pengujian (TDD)

- `src/lib/seragamVendor.ts` (fungsi murni): normalisasi ukuran, pencocokan harga dan prioritas, kelayakan 25%, jumlah stel TK 5 / lain 4, susunan baris pesanan, rekap vendor. Tes ditulis lebih dulu.
- Tes kontrak migrasi (pola `rolePermissions.migration.test.ts`): kolom, constraint, pemicu tumpang tindih, RLS.
- Tes halaman (tab, filter, ekspor) dan tes izin/menu (`permissions.test.ts`, `AppSidebar.permissions.test.tsx`).
- Sebelum commit: `npm run lint` dan `npm run test`, hasilnya ditampilkan.

## Rilis

- Satu file migrasi di `supabase/migrations/`. Penerapan ke produksi manual sesuai `CLAUDE.md`: cocokkan checksum, dry-run `BEGIN … ROLLBACK`, konfirmasi eksplisit user, `psql --single-transaction -v ON_ERROR_STOP=1`, verifikasi, catat di `SESI_NOTES.md`.
- Data harga awal tidak dimasukkan di migrasi. Setelah pemetaan stel dikonfirmasi, dimasukkan lewat satu skrip bergerbang (jumlah baris tepat) dengan konfirmasi terpisah.
- Deploy aplikasi dari `main` setelah PR digabung.

## Di luar cakupan

Status pemesanan/pembayaran per siswa, jurnal pembayaran vendor, pengeditan ukuran dari halaman ini, notifikasi ke vendor.

## Pertanyaan terbuka (tidak menghalangi pembangunan, menghalangi pengisian data)

- Padanan stel untuk "SD printing" (putra 210, putri 270) dan harga mana yang berlaku untuk tiap dari 5 stel TK (Set Gamis Merah/Hijau/Biru/Ungu, Olahraga). Daftar vendor tidak memakai nama stel sistem.
- Daftar vendor tidak memuat harga SMA putri maupun sablon SMA putri.
