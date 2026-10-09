# Monitoring Pembayaran SPMB

Menu Keuangan > Monitoring Pembayaran SPMB berada di /keuangan/monitoring-spmb.
Halaman SPMB menyediakan tindakan Monitoring pembayaran untuk admin.
Fitur memantau uang pangkal pendaftaran lulus tes, termasuk siswa yang telah
diaktifkan. Tidak mengubah status penerimaan, tagihan, pembayaran, atau jurnal.

## Dasar aturan dan cakupan

Rujukan pengguna: Surat Pernyataan Penerimaan Siswa Baru Non Alumni 2027/2028,
diunggah 9 Oktober 2026. Surat menetapkan pembayaran sekaligus dalam 14 hari
sejak lulus tes, atau cicilan minimal 25%, minimal 25%, lalu sisa, dengan
jarak 30 hari antar cicilan. Nominal contoh non asrama Rp10.100.000 dan asrama
Rp13.100.000 tidak dijadikan tarif global.

Petugas memilih skema per pendaftaran berdasarkan kesepakatan yang berlaku.
Nominal monitoring berasal dari tagihan netto, sehingga keringanan resmi
tercermin. Jenjang/alumni lain tidak otomatis dikenai skema surat tersebut.
Jika belum dipilih, status Skema belum ditentukan dan tenggat penagihan belum
diaktifkan. Uang pangkal nol dengan tagihan valid dinyatakan selesai.

Keputusan implementasi: pembayaran kecil digabung sampai minimum cicilan
terpenuhi. Tanggal ketika minimum cicilan pertama terpenuhi menjadi awal
30 hari untuk cicilan kedua. Pembayaran di bawah minimum tidak menggeser
tenggat pertama 14 hari sejak lulus. Cicilan kedua minimal 25% dari total
ditambahkan pada pembayaran pertama yang sebenarnya; cicilan terakhir
mengambil sisa. Contoh pembayaran pertama 50%, kedua minimal 25%, terakhir
sisa 25%. Tidak memaksakan cicilan terakhir 50% jika pembayaran awal lebih besar.
Perhitungan tanggal memakai kalender Asia/Jakarta.

## Sumber pembayaran

Hanya jenis UANG PANGKAL TK/SD/SMP/SMA/MTA yang dipantau. Pemilihan tagihan
harus cocok siswa, lembaga tujuan master jenis, dan tahun_akademik_id
pendaftaran, dengan status terjadwal/belum_bayar/sebagian/lunas.
Jenis SALDO UANG PANGKAL LAMA tidak termasuk.
Pembayaran dihitung hanya dari pembayaran.tagihan_id yang menunjuk tagihan
terpilih. Baris pembayaran adalah hasil pencatatan kasir atau settlement
portal. Order Midtrans menunggu belum merupakan pembayaran.

Tagihan tanpa tahun akademik tidak ditebak dari tahun buku, tanggal cetak,
atau kelas aktif siswa. UI menampilkan peringatan verifikasi; jika tidak
ada tagihan sesuai dan ada tagihan tanpa tahun, status Perlu verifikasi.
Semua pembacaan memakai pagination dan chunk ID. Kesalahan query tidak
boleh disamarkan menjadi daftar kosong.

## Riwayat dan akses

Tabel baru spmb_payment_monitor_events hanya menyimpan skema, catatan tindak
lanjut, dan perpanjangan tenggat. Riwayat append-only; koreksi menambah event.
Identitas siklus mencakup siswa_detail, tahun ajaran, lembaga tujuan,
gelombang, dan tanggal pendaftaran. Catatan lama tidak dipakai setelah siklus
berubah. Koreksi skema mengakhiri keberlakuan perpanjangan versi sebelumnya.

Admin/keuangan aktif dapat memilih skema dan memperpanjang tahap berjalan.
Kasir aktif dapat membaca dan menambah tindak lanjut. Ortu, guru, kepala
sekolah, dan TU tidak memperoleh endpoint keuangan ini.
RLS aktif, akses anon/authenticated dicabut, dan fungsi server memverifikasi
JWT serta profil aktif sebelum memakai service role. Tidak ada kunci
server di browser. Tidak ada UPDATE/DELETE lewat aplikasi; trigger juga
menolak perubahan/penghapusan histori.

Perpanjangan memerlukan alasan, tahap yang sedang berjalan, tanggal kalender
valid, tanggal setelah tenggat sebelumnya, dan tanggal tidak di masa lalu.
Dua perpanjangan bersamaan tidak dapat memperpendek tenggat: pembacaan
memakai tenggat paling panjang pada versi skema dan tahap yang sama.
Perpanjangan tidak mengubah status diterima.

## Verifikasi dan penerapan

Sebelum koneksi VPS terputus, 398 tes aplikasi lulus, termasuk minimum cicilan,
pembayaran pertama lebih besar, tahun/jenjang lama, tenggat WIB, perpanjangan,
dan role aktif. SQL migration diuji pada PostgreSQL 16 disposable:
grant/RLS, insert service, constraint event, serta larangan update/delete
histori lulus. Fixture browser tanpa jaringan produksi menguji filter,
pencarian, penyimpanan tindak lanjut/perpanjangan, kasir, desktop dan 390 px.
Build berhasil. Lint seluruh repo memiliki masalah lama; semua file baru
bersih dan jumlah masalah file SPMB tidak bertambah. Typecheck seluruh
repo belum selesai karena batas memori; jangan menyatakannya lulus.

Setelah pemulihan, 19 skenario perhitungan yang sama dijalankan ulang memakai
Node native test runner di workspace terpisah; semuanya lulus.

Perubahan dipulihkan dari kode yang dibuat pada sesi ini dan disimpan lewat
GitHub API karena MCP VPS timeout. Parent commit memuat PR135 yang menambah
dua tes rekonsiliasi; 398 adalah hasil sebelum perubahan main tersebut,
bukan klaim rerun seluruh suite pada parent terbaru. Setelah VPS kembali,
cocokkan worktree /home/attauhid/projects/hijrah-spmb-payment-monitor
dengan commit GitHub sebelum melanjutkan supaya salinan lama tidak menimpa
perubahan yang telah dikirim.

SQL produksi belum diterapkan. Menu belum dirilis ke main. SESI_NOTES.md
mewajibkan persetujuan SQL baru setelah SQL ditampilkan pada commit final.
Migration hanya membuat tabel/index/trigger monitoring; tidak menyentuh saldo
atau transaksi. Setelah persetujuan: terapkan migration hanya ke project
cmvzcpeiuompqgdvflky, verifikasi schema/grants/advisors, merge PR dan pantau
deployment Cloudflare. Pemeriksaan browser produksi memerlukan verifikasi
sesi yang sah, tidak membuat pembayaran uji.
