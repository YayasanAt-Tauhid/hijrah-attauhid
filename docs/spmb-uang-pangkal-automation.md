# Uang pangkal SPMB setelah verifikasi nominal

Lokasi: **Keuangan → Rencana Tagihan Siswa Baru → Uang Pangkal Otomatis** pada baris siswa. Tarif bruto terisi dari SK 050/SKep/YAAB/09/2026, lampiran halaman 3-4, khusus TA 2027/2028. Petugas admin/keuangan memeriksa program, asal alumni, dan nominal, lalu memilih **Verifikasi & Terbitkan Otomatis**. Tindakan ini membuat tagihan dan, jika diperlukan, pengajuan keringanan alumni dalam satu transaksi.

Ini bukan penagihan seluruh siswa saat migrasi atau saat baru mendaftar. Siswa wajib sudah lulus dan diterima; penerbitan terjadi setelah verifikasi per siswa. Kelas belum perlu tersedia. MTA tanpa kelas memerlukan pilihan fase masuk setara SMP/SMA.

| Tujuan/program | Bruto | Neto alumni sebelumnya asrama | Neto alumni sebelumnya nonasrama |
| --- | ---: | ---: | ---: |
| TK reguler/day care | 4.200.000 | - | - |
| SD | 9.400.000 | - | - |
| SMP asrama | 13.100.000 | - | - |
| SMP nonasrama | 10.100.000 | - | - |
| SMA asrama | 13.100.000 | 5.500.000 | 8.500.000 |
| SMA nonasrama | 10.100.000 | 5.500.000 | 5.500.000 |
| MTA setara SMP | 10.000.000 | - | - |
| MTA setara SMA | 10.000.000 | 4.250.000 | 5.250.000 |

Untuk SMA, alumni dalam SK adalah alumni SMPITA. Untuk MTA setara SMA, alumni SMPITA atau MTA setara SMP. Riwayat asrama dikonfirmasi petugas, tidak disimpulkan hanya dari status internal/eksternal. Keringanan = bruto acuan dikurangi neto alumni. Bruto alumni wajib mengikuti SK; pengajuan memakai skema Keringanan Alumni, tipe nominal, dengan nilai eksplisit sesuai program. Nilai default skema tidak dipakai sebagai tarif neto atau potongan.

Pengajuan berstatus **diajukan**, tidak diputuskan otomatis. Potongan baru mengurangi tagihan setelah persetujuan melalui alur yang sudah ada. Untuk nonalumni, bruto khusus memerlukan alasan minimal 10 karakter; keringanan lainnya tetap melalui menu Keringanan.

## Integritas dan audit

- Tarif SK dan audit verifikasi hanya dapat dibaca admin/keuangan melalui RLS; tidak ada hak tulis langsung bagi klien.
- RPC publik memakai SECURITY INVOKER, dan implementasi transaksi berada pada schema privat dengan pemeriksaan auth.uid serta role pada setiap entry point. Tidak ada akses anonim.
- Pratinjau memiliki hash keadaan siswa, tarif, dan tagihan. Data berubah berarti petugas harus memeriksa ulang.
- Transaksi mengunci pendaftaran dan kunci biaya sekali bayar. Penerbitan ulang tidak menggandakan tagihan/pengajuan maupun mengubah nominal, pembayaran, atau keputusan yang sudah ada.
- Tagihan lama dengan bruto berbeda atau pengajuan lain yang tumpang tindih memerlukan koreksi; bukan ditimpa otomatis.
- Audit menyimpan pendaftaran, TA, versi tarif, bruto, nilai pengajuan, ID tagihan/pengajuan, petugas, waktu, dan snapshot pratinjau.

## Verifikasi

`DialogUangPangkalSpmb.test.tsx` menguji pilihan alumni wajib, bruto penuh, konfirmasi, bruto khusus dengan alasan, penolakan penerbitan ulang, dan fase MTA.

`scripts/test-spmb-uang-pangkal.sql` membuat fixture sementara di clone dan melakukan rollback: 8 tarif program, 6 kombinasi alumni, bruto tetap penuh sampai persetujuan, keputusan melalui RPC yang ada, neto setelah persetujuan, deduplikasi, stale preview, input bruto, akses authenticated, hak tulis langsung dan RLS non-staff.
