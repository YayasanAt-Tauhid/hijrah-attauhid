# Pemisahan SPP asrama dan non asrama

Status 5 Oktober 2026: disiapkan pada branch `fix/spp-boarding-accounting`,
berdasarkan `main` commit `9a3b495`. Belum diterapkan atau dideploy.
Target produksi hanya Supabase `cmvzcpeiuompqgdvflky`.

## Perilaku setelah penerapan

SPP SMP, SMA, dan MTA menyimpan kategori dan akun pendapatan pada setiap
tagihan. Pembayaran menyalin kategori tagihan, termasuk cicilan dan Midtrans.
Perubahan status asrama siswa hanya memengaruhi tagihan baru. Satu master SPP
aktif per lembaga tetap dipertahankan; nominal tetap mengikuti tarif siswa.

| Kategori tagihan baru | Akun pendapatan |
| --- | --- |
| Asrama SMP/SMA/MTA | 4102 — PENDAPATAN SPP ASRAMA |
| Non Asrama SMP/SMA/MTA | 4103 — PENDAPATAN SPP NON ASRAMA |
| Status belum tersedia | Akun master 4101, kategori belum terverifikasi |
| TK/SD | Akun master, kategori umum |

Generate, pengakuan awal bulan, pengakuan uang muka, pembatalan, dan koreksi
tagihan memakai akun tersimpan. Hak akses RPC lama dipertahankan; helper baru
tidak dibuka kepada `anon` atau `authenticated`. Snapshot yang sudah terisi
tidak boleh diedit melalui aplikasi.

Laporan Penerimaan SPP menyediakan filter kategori, rekap lembaga/kategori,
kolom kategori, dan ekspor detail maupun rekap. Kas yang diterima tetap
dibedakan dari pendapatan yang diakui. Data tanpa bukti tetap masuk total
sebagai belum terverifikasi. Pembacaan pembayaran memakai pagination supaya
rekap tidak berhenti pada batas baris API. Ringkasan kas bulanan juga memberi
label kategori SPP. Rekap SPP per siswa dan laporan buku besar tidak diubah UI-nya.

## Pemulihan data lama

SQL kedua mengisi status siswa yang kosong hanya dari bukti SPP legacy pada
TA 2026/2027, dengan unit sumber yang sesuai dan satu kategori yang konsisten.
Status yang sudah terisi tidak ditimpa.

| Lembaga | Asrama | Non Asrama | Total status dipulihkan |
| --- | ---: | ---: | ---: |
| SMP | 71 | 170 | 241 |
| SMA | 30 | 46 | 76 |
| MTA | 24 | 4 | 28 |
| Total | 125 | 220 | 345 |

Empat siswa aktif yang belum memiliki bukti: Gilang Ramadhan, Jian Herdian,
Melvin Prince Wiguna (SMA), dan Naura Kayyisah Riyadi (SMP).
Khairan Alzam (SMP) berstatus non asrama sekarang, sedangkan sumber lama
asrama; status sekarang dipertahankan dan bukti periode lama tetap dipakai
untuk tagihan terkait. Dua pembayaran Gledysta Arinsyah Putri, Juli/Agustus
2026, masing-masing Rp450.000, belum mempunyai bukti kategori periode tersebut.
Tidak ada kategori yang ditebak dari nominal atau jenis kelamin.

Kategori historis ditentukan dari tautan sumber asli atau bukti siswa/unit/bulan
yang sama. Jadwal masa depan yang belum memiliki jurnal/pembayaran dapat
menggunakan status yang sudah terverifikasi. Akun historis mengikuti jurnal
yang sudah ada; akun 4101 tidak dipindahkan menjadi 4102/4103 dalam tahap ini.
Seluruh perubahan status dan metadata dicatat pada tabel audit privat.

**Pemisahan laporan penerimaan belum menyelesaikan reklasifikasi buku besar
historis.** Jurnal 4101 yang sudah terbit perlu audit dan SQL tersendiri,
termasuk jurnal gabungan beberapa tagihan, pengakuan uang muka, dan pembatalan.
Jangan menyatakan laporan laba rugi historis sudah terpisah seluruhnya.

## SQL yang perlu ditinjau

1. `supabase/migrations/20261005083943_spp_asrama_snapshot.sql`: kolom,
   guard snapshot, serta lima RPC terkait akun SPP. Preflight MD5 menolak
   penerapan jika definisi RPC produksi berubah sejak audit.
2. `supabase/migrations/20261005085418_spp_asrama_reconcile_metadata.sql`:
   pemulihan 345 status kosong dan metadata tagihan/pembayaran. SQL tidak
   mengubah nominal, status bayar, uang masuk, jurnal, atau saldo. Preflight
   menolak perubahan jumlah kandidat/konfigurasi akun; lock `NOWAIT` menolak
   eksekusi bila transaksi lain sedang menulis tabel terkait.

Masing-masing migration harus diterapkan atomik, berurutan, setelah pengguna
menyetujui SQL yang ditampilkan. Jangan memakai `supabase db push` secara buta.
Jika guard gagal, periksa perubahan dan ulangi audit, jangan menghapus guard.
Deploy frontend setelah kedua migration berhasil dan hasil audit diverifikasi.
Reklasifikasi jurnal lama tetap menunggu persetujuan terpisah atas SQL hasil audit.

## Validasi

- Migration pertama dari awal berhasil pada fixture PostgreSQL terpisah.
- 10 skenario SQL kategori: SMP/SMA/MTA, TK/SD, status kosong, perubahan status,
  cicilan, Midtrans, uang muka, pembatalan, koreksi, privilege, dan satu master.
- Fixture SQL kedua menguji 345 pengisian status, konflik yang tidak ditimpa,
  histori/jadwal, pembayaran, akses audit, serta total dan jumlah jurnal tetap.
- 16 skenario regresi SPP dan 15 skenario uang pangkal lulus. Semua skenario
  transaksi uji di-rollback; fixture tidak menyalin seluruh data/RLS produksi.
- 308 tes aplikasi dan production build lulus. Lint/typecheck repo masih
  memiliki temuan pada baseline; perubahan laporan tidak menambah diagnostik
  lint dibanding file `main`, dan helper kategori lulus lint.

Regresi menemukan pembatalan SPP saat layanan sudah diakui tetapi PD masih
pending tidak memulihkan seluruh piutang pada RPC produksi asli. Perbaikan
disertakan dan kasusnya diuji pada akun snapshot 4102. Cabang uang pangkal
tetap memerlukan jurnal pengakuan PD seperti sebelumnya. Ekspektasi uji diskon
uang pangkal disesuaikan dengan kebijakan produksi terbaru: diskon diakui
sekali pada posting jatuh tempo, bukan pada salah satu cicilan uang muka.
