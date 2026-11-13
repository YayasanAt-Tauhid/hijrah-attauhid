# Potongan kakak-adik per bulan SPP

Diterapkan ke produksi (Rustbase, `proj_kqylkreswang`) pada 13 November 2026 lewat empat migrasi manual
(`20261113031900` s.d. `20261113031903`). Dokumen ini merangkum aturan, objek database, cara memulihkan, dan hasil verifikasi.

## Aturan

- Potongan kakak-adik untuk bulan SPP **M** sah hanya bila minimal **2 saudara aktif di bulan M** (satu `keluarga_id`, dihitung lintas lembaga TK/SD/SMP/SMA/MTA).
- **Aktif di bulan M** = terdaftar pada hari mana pun di bulan M. Siswa berstatus `aktif`, `diterima` (calon yang sudah diterima, dihitung sejak `tanggal_mulai_aktif`), atau yang sudah `pindah`/`alumni`/`keluar` tetapi `tanggal_akhir_aktif` masih di bulan M atau sesudahnya. Status `calon` tidak dihitung.
- Potongan yang tidak lagi sah **dicabut otomatis** mulai bulan pertama yang tidak sah, dan dicatat di `log_potongan_saudara`:

| Status tagihan bulan itu | Tindakan |
|---|---|
| `terjadwal` | kembali ke nominal bruto tanpa jurnal |
| `belum_bayar` | nominal naik ke bruto + jurnal koreksi Dr 1300 Piutang / Cr 4601 Potongan SPP |
| `sebagian` | nominal naik pada tagihan yang sama + jurnal koreksi; sisa tagihan ikut naik |
| `lunas` | tagihan lunas tidak diubah; dibuat tagihan baru jenis "Koreksi Potongan Saudara <lembaga>" + jurnal piutang. Bila jenis koreksi tidak aktif atau tahun buku sudah ditutup: hanya ditandai untuk admin (`tandai_admin`), proses tidak gagal |
| `dibatalkan` | tidak disentuh |

- Histori utuh: baris `siswa_diskon` yang sudah disetujui tidak diubah langsung. Baris lama dibatalkan dan dibuat baris awalan baru untuk bulan-bulan yang masih sah (mis. Jan-Mei), tagihan bulan itu diarahkan ke baris baru.
- Kasus acuan: Thariq (kakak, lulus akhir Juni 2027) + Thaha + Shofea (diterima, mulai SD Juli 2027): potongan Thaha tidak terputus karena sejak Juli Thaha + Shofea masih dua saudara aktif.

## Migrasi

| Berkas | Isi | sha256 (16 hex awal) |
|---|---|---|
| `20261113031900_siswa_aktif_per_bulan.sql` | kolom `siswa.tanggal_mulai_aktif`/`tanggal_akhir_aktif`, `siswa_aktif_di_bulan`, `jumlah_saudara_aktif` per bulan, validasi potongan per bulan | `c5597fa862016e80` |
| `20261113031901_perbaiki_akhiri_siswa_potongan_saudara.sql` | `akademik_akhiri_siswa` tidak lagi mengubah baris disetujui langsung; hitung per bulan | `a364377d307cd937` |
| `20261113031902_cabut_potongan_saudara.sql` | `cabut_potongan_saudara`, tabel `log_potongan_saudara`, 5 jenis "Koreksi Potongan Saudara <lembaga>" | `38d728189ff39acc` |
| `20261113031903_tinjau_potongan_saudara_per_bulan.sql` | `tinjau_potongan_saudara`, `tinjau_potongan_saudara_semua`, trigger `trg_tinjau_potongan_saudara`, sinkronisasi per bulan, perbaikan `akademik_nonaktifkan_siswa` | `420cac20814b39c6` |

Semua fungsi baru `SECURITY DEFINER`, `search_path = public`; `tinjau_*` hanya bisa dieksekusi `service_role`.

Lima jenis koreksi memakai akun yang sama dengan SPP lembaganya: 4101 PENDAPATAN SPP (pendapatan) dan 4601 POTONGAN/KERINGANAN SPP (potongan). Bendahara perlu memastikan pemetaan itu sesuai.

## Jaring pengaman harian

Trigger hanya mencabut (tidak pernah menambah potongan) dan tidak boleh menggagalkan perubahan data siswa: kegagalan hanya menjadi `WARNING`. Untuk kondisi yang lolos, pemeriksaan ulang dijalankan tiap hari oleh systemd timer di VM `hijrah-attauhid` (tidak ada pg_cron):

`/etc/systemd/system/hijrah-tinjau-potongan-saudara.service`

```ini
[Unit]
Description=Hijrah tinjau ulang potongan kakak-adik harian
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/bin/hijrah-cron-sql 'select public.tinjau_potongan_saudara_semua(current_date)'
TimeoutStartSec=700
```

`/etc/systemd/system/hijrah-tinjau-potongan-saudara.timer`

```ini
[Unit]
Description=Timer: Hijrah tinjau ulang potongan kakak-adik harian
[Timer]
OnCalendar=*-*-* 00:30:00 UTC
Persistent=false
AccuracySec=1s
[Install]
WantedBy=timers.target
```

Pemeriksaan pertama terjadwal 14 November 2026 00:30 UTC (07:30 WIB). Lihat hasil: `journalctl -u hijrah-tinjau-potongan-saudara.service` dan `select * from log_potongan_saudara order by dibuat_at desc`.

## Rollback

Urutan terbalik dari penerapan. Objek baru cukup di-`DROP`; fungsi lama dipulihkan dari definisinya sebelum migrasi:

1. `DROP TRIGGER trg_tinjau_potongan_saudara ON public.siswa;` lalu `DROP FUNCTION` untuk `pemicu_tinjau_potongan_saudara()`, `tinjau_potongan_saudara_semua(date)`, `tinjau_potongan_saudara(uuid,date,uuid,uuid,text,boolean)`, dan `cabut_potongan_saudara`.
2. Pulihkan definisi asli `akademik_akhiri_siswa`, `akademik_nonaktifkan_siswa`, `sinkronkan_diskon_kakak_adik_keluarga`, `validasi_diskon_kakak_adik` dari migrasi sebelum `20261113031900` (definisi terakhir di riwayat git) atau dari salinan asli di VM `~/saudara/asli/`.
3. Kolom `tanggal_mulai_aktif`/`tanggal_akhir_aktif`, tabel `log_potongan_saudara`, dan lima jenis koreksi sebaiknya dibiarkan (tidak merugikan); hapus hanya bila belum berisi data.
4. Nonaktifkan timer: `sudo systemctl disable --now hijrah-tinjau-potongan-saudara.timer`.

Cadangan penuh sebelum penerapan: `~/backups/proj_kqylkreswang-pra-saudara-20261113T031803Z.dump` (VM `hijrah-attauhid`).

## Tes

`supabase/tests/potongan_saudara/` (lihat `jalankan_uji.sh`): `uji_01` (hitung saudara per bulan, 9 skenario), `uji_02` (akhiri siswa + validasi, 4), `uji_03` (pencabut: semua status tagihan, log, idempoten, tahun buku tertutup), `uji_04` (sinkronisasi per bulan, nonaktifkan, trigger, pemeriksaan harian, hak akses; 10 skenario). Semua berjalan di salinan database dalam transaksi `BEGIN ... ROLLBACK`. Jalankan `uji_03` dan `uji_04` di transaksi terpisah.

## Verifikasi produksi (13 November 2026)

- Dry-run `BEGIN ... ROLLBACK` di database produksi: semua tes lulus, objek kembali seperti semula.
- Setelah penerapan: 8 fungsi baru, trigger, `log_potongan_saudara`, dua kolom baru pada `siswa`, jenis pembayaran 66 menjadi 71. Jumlah baris tabel kunci tidak berubah (siswa 1.235, jurnal 25.947, tagihan 11.354). Pemeriksaan semua keluarga pada data nyata: 0 potongan dicabut.
- Timer terpasang dan dijalankan sekali manual dengan sukses.

## Belum dikerjakan

- Thariq (kakak, lulus akhir Juni 2027) belum dikeluarkan di data; lakukan lewat alur akhiri/nonaktifkan saat waktunya. (Data Shofea NIS 2702076 sudah diisi 13 Nov 2026: keluarga Bapak Reno Ismanto, mulai 2027-07-01.)
- Tidak ada tampilan UI untuk `log_potongan_saudara` (hanya SQL).
- Pemetaan akun lima jenis koreksi perlu dikonfirmasi bendahara.
