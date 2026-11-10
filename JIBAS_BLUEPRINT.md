# 🏫 Hijrah At-Tauhid — Blueprint & Panduan Pembangunan Versi Baru

> **Hijrah At-Tauhid** — Sistem Informasi Sekolah (penerus konsep Jaringan Informasi Bersama Antar Sekolah/JIBAS)  
> Versi Baru: React 18 + TypeScript + Supabase  
> Referensi Lama: JIBAS 32.0 (PHP + MySQL + frame-based layout)

---

## 📌 Daftar Isi

1. [Perbandingan JIBAS Lama vs Baru](#1-perbandingan-jibas-lama-vs-baru)
2. [Tech Stack](#2-tech-stack)
3. [Struktur Folder Proyek](#3-struktur-folder-proyek)
4. [Arsitektur Aplikasi](#4-arsitektur-aplikasi)
5. [Database Schema (Supabase/PostgreSQL)](#5-database-schema-supabasepostgresql)
6. [Sistem Autentikasi & Role](#6-sistem-autentikasi--role)
7. [Modul-Modul Aplikasi](#7-modul-modul-aplikasi)
   - 7.1 [Akademik](#71-akademik)
   - 7.2 [Keuangan](#72-keuangan)
   - 7.3 [Kepegawaian](#73-kepegawaian)
   - 7.4 [CBE (Competency-Based Education)](#74-cbe-competency-based-education)
   - 7.5 [SIMTAKA (Sistem Manajemen Perpustakaan)](#75-simtaka)
   - 7.6 [Buletin](#76-buletin)
   - 7.7 [Pengaturan](#77-pengaturan)
8. [Routing Lengkap](#8-routing-lengkap)
9. [Multi-Lembaga (Yayasan)](#9-multi-lembaga-yayasan)
10. [Panduan Setup & Build](#10-panduan-setup--build)
11. [Urutan Pembangunan yang Disarankan](#11-urutan-pembangunan-yang-disarankan)
12. [Fitur JIBAS 32.0 yang Belum Ada di Versi Baru](#12-fitur-jibas-320-yang-belum-ada-di-versi-baru)
13. [Konvensi Kode](#13-konvensi-kode)

---

## 1. Perbandingan JIBAS Lama vs Baru

| Aspek | JIBAS 32.0 (Lama) | JIBAS Versi Baru |
|---|---|---|
| **Bahasa** | PHP 5/7 | TypeScript + React 18 |
| **Database** | MySQL (jibas_db.sql) | PostgreSQL via Supabase |
| **Auth** | PHP Session + tabel `user` | Supabase Auth (JWT) |
| **UI** | HTML + CSS + jQuery + frame-based | React + Tailwind CSS + shadcn/ui |
| **Layout** | Frame (`frametop`, `frameleft`, `frameright`, `framebottom`) | SPA dengan AppLayout + Sidebar |
| **State Management** | PHP session + JavaScript global | TanStack Query + React Context |
| **Routing** | File-based (tiap `.php` = route) | React Router v6 |
| **Build System** | Apache/XAMPP, tidak ada bundler | Vite 5 |
| **Export** | Excel (PHP fopen), Print CSS | XLSX library + browser print |
| **Multi-Sekolah** | 1 instalasi = 1 sekolah | Multi-lembaga dalam 1 yayasan |
| **RLS / Keamanan Data** | Tidak ada RLS (semua query langsung) | PostgreSQL Row Level Security (RLS) |
| **Deployment** | XAMPP lokal / shared hosting | Supabase Cloud + Vite build (Vercel/Netlify/VPS) |

### Perbedaan Konsep Utama
- **JIBAS 32.0** menggunakan konsep **1 sekolah per instalasi**, dengan modul terpisah (`/akademik`, `/keuangan`, `/kepegawaian`) yang memiliki login masing-masing.
- **Hijrah At-Tauhid** menggunakan konsep **yayasan multi-lembaga**: satu login, satu dashboard, semua lembaga (TK/SD/SMP/SMA/MTQ) terkelola dalam satu aplikasi dengan data yang terpisah per lembaga (`departemen_id`) namun bisa dilihat secara konsolidasi.

---

## 2. Tech Stack

```
Frontend
├── React 18.3          → UI library
├── TypeScript 5.8      → Type safety
├── Vite 5.4            → Build tool & dev server
├── React Router v6     → Client-side routing
├── TanStack Query v5   → Server state, caching, refetch
├── React Hook Form v7  → Form handling
├── Zod                 → Schema validation
└── date-fns            → Date utilities

UI & Styling
├── Tailwind CSS 3.4    → Utility-first CSS
├── shadcn/ui           → Component library (Radix UI based)
├── Lucide React        → Icon set
├── Recharts 2          → Chart/grafik
└── next-themes         → Dark/light mode

Backend (BaaS)
├── Supabase Auth       → Authentication (email+password, JWT)
├── Supabase PostgreSQL → Database dengan RLS
└── Supabase Storage    → File/foto upload (opsional)

Testing
├── Vitest              → Unit test runner
└── Testing Library     → React component testing

Export
└── xlsx (SheetJS)      → Export ke Excel
```

---

## 3. Struktur Folder Proyek

```
jibas-2-main/
├── jibas-32.0/              ← Referensi kode lama (PHP)
│   ├── jibas/
│   │   ├── akademik/        ← Modul akademik PHP
│   │   ├── keuangan/        ← Modul keuangan PHP
│   │   ├── kepegawaian/     ← Modul kepegawaian PHP
│   │   ├── cbe/             ← CBE PHP
│   │   ├── simtaka/         ← SIMTAKA PHP
│   │   ├── buletin/         ← Buletin PHP
│   │   └── ...
│   └── jibas_db.sql         ← Skema database MySQL lama
│
├── src/
│   ├── App.tsx              ← Root router & layout
│   ├── main.tsx             ← Entry point
│   ├── index.css            ← Global styles
│   │
│   ├── pages/               ← Semua halaman/routes
│   │   ├── Index.tsx        ← Redirect ke /
│   │   ├── Login.tsx        ← Halaman login
│   │   ├── Dashboard.tsx    ← Dashboard utama
│   │   ├── Akademik.tsx     ← Hub modul akademik
│   │   ├── Keuangan.tsx     ← Hub modul keuangan
│   │   ├── Kepegawaian.tsx  ← Hub modul kepegawaian
│   │   ├── CBE.tsx          ← Hub modul CBE
│   │   ├── Simtaka.tsx      ← Hub modul SIMTAKA
│   │   ├── Buletin.tsx      ← Hub modul buletin
│   │   ├── Pengaturan.tsx   ← Hub pengaturan
│   │   ├── Unauthorized.tsx ← Halaman akses ditolak
│   │   ├── NotFound.tsx     ← Halaman 404
│   │   │
│   │   ├── akademik/
│   │   │   ├── DaftarSiswa.tsx
│   │   │   ├── FormSiswa.tsx    ← Add & Edit siswa
│   │   │   ├── DetailSiswa.tsx
│   │   │   ├── MutasiSiswa.tsx
│   │   │   └── PSB.tsx          ← Penerimaan Siswa Baru
│   │   │
│   │   ├── keuangan/
│   │   │   ├── InputPembayaran.tsx
│   │   │   ├── TunggakanPembayaran.tsx
│   │   │   ├── InputPengeluaran.tsx
│   │   │   ├── TabunganSiswa.tsx
│   │   │   ├── LaporanKeuangan.tsx
│   │   │   │   ├── TabArusKas.tsx
│   │   │   │   ├── TabLabaRugi.tsx
│   │   │   │   └── TabNeracaAkuntansi.tsx
│   │   │   ├── ReferensiKeuangan.tsx
│   │   │   ├── JurnalUmum.tsx
│   │   │   └── BukuBesar.tsx
│   │   │
│   │   ├── kepegawaian/
│   │   │   ├── DataPegawai.tsx
│   │   │   └── PresensiPegawai.tsx
│   │   │
│   │   └── pengaturan/
│   │       ├── ProfilYayasan.tsx
│   │       └── ManajemenPengguna.tsx
│   │
│   ├── components/
│   │   ├── ui/              ← shadcn/ui components (auto-generated)
│   │   ├── auth/
│   │   │   └── ProtectedRoute.tsx
│   │   ├── layout/
│   │   │   └── AppLayout.tsx  ← Sidebar + Header + Outlet
│   │   ├── shared/          ← Reusable components
│   │   └── NavLink.tsx
│   │
│   ├── contexts/
│   │   └── AuthContext.tsx   ← Auth state, role, signIn/Out
│   │
│   ├── hooks/
│   │   ├── useAkademikData.ts
│   │   ├── useKeuangan.ts
│   │   ├── useJurnal.ts
│   │   ├── useSiswa.ts
│   │   ├── use-mobile.tsx
│   │   └── use-toast.ts
│   │
│   ├── integrations/
│   │   └── supabase/
│   │       ├── client.ts     ← Supabase client instance
│   │       └── types.ts      ← Auto-generated DB types
│   │
│   ├── lib/
│   │   └── utils.ts          ← cn() helper, format helpers
│   │
│   └── test/                 ← Test files
│
├── supabase/
│   ├── config.toml
│   ├── migrations/           ← SQL migration files
│   └── functions/            ← Edge functions (opsional)
│
├── public/                   ← Static assets
├── index.html
├── package.json
├── vite.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

---

## 4. Arsitektur Aplikasi

```
Browser
  └── React SPA (Vite)
        ├── BrowserRouter
        │     ├── /login              → Login (public)
        │     └── /...                → ProtectedRoute
        │           └── AppLayout
        │                 ├── Sidebar (navigasi modul)
        │                 ├── Header (user info, notif)
        │                 └── <Outlet /> → halaman aktif
        │
        ├── AuthContext (global state: user, session, role)
        ├── QueryClient (TanStack Query: server state)
        └── ToastProvider / TooltipProvider

Data Flow:
  Page Component
    → Custom Hook (useKeuangan, useSiswa, dll)
      → Supabase Client (query/mutation)
        → Supabase PostgreSQL (dengan RLS)
          ← Response difilter berdasarkan role & lembaga
        ← TanStack Query cache
      ← Hook returns { data, isLoading, error, mutate }
    ← Component render
```

### Pola Data Fetching

Semua akses data menggunakan hook TanStack Query:

```typescript
// Contoh pola di custom hook
export function useSiswa() {
  return useQuery({
    queryKey: ['siswa'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('siswa')
        .select('*, angkatan(*), kelas_siswa(kelas(*))')
        .eq('status', 'aktif')
        .order('nama');
      if (error) throw error;
      return data;
    }
  });
}
```

---

## 5. Database Schema (Supabase/PostgreSQL)

### Tabel Referensi

```sql
-- Identitas sekolah/yayasan
sekolah (id, nama, alamat, kota, telepon, email, logo_url,
         kepala_sekolah, npsn, akreditasi)

-- Tahun akademik
tahun_ajaran (id, nama, tanggal_mulai, tanggal_selesai, aktif, keterangan)
semester     (id, tahun_ajaran_id, nama, urutan, aktif)

-- Struktur lembaga/departemen (dipakai sebagai "lembaga" di yayasan)
departemen (id, nama, kode, keterangan, aktif)
tingkat    (id, nama, urutan, departemen_id, aktif)
kelas      (id, nama, tingkat_id, departemen_id, wali_kelas_id,
            kapasitas, aktif)
angkatan   (id, nama, departemen_id, aktif, keterangan)
```

### Tabel Kepegawaian

```sql
pegawai (id, nip, nama, jenis_kelamin [L/P], tempat_lahir,
         tanggal_lahir, agama, alamat, telepon, email,
         foto_url, jabatan, status [aktif/nonaktif],
         departemen_id, created_at)

-- Tabel baru (v2)
presensi_pegawai (id, pegawai_id, tanggal, jam_masuk, jam_keluar,
                  status [H/I/S/A/T], keterangan, departemen_id)
```

### Tabel Akademik (Siswa)

```sql
siswa (id, nis, nama, jenis_kelamin [L/P], tempat_lahir,
       tanggal_lahir, agama, alamat, telepon, email,
       foto_url, status [aktif/lulus/pindah/dropout],
       angkatan_id, created_at)

siswa_detail (id, siswa_id, nama_ayah, nama_ibu,
              pekerjaan_ayah, pekerjaan_ibu,
              telepon_ortu, alamat_ortu)

kelas_siswa (id, siswa_id, kelas_id, tahun_ajaran_id, aktif)
```

### Tabel Akademik (Pembelajaran)

```sql
mata_pelajaran (id, kode, nama, departemen_id, tingkat_id,
               keterangan, aktif)

pegawai_mapel (id, pegawai_id, mapel_id)

jadwal (id, kelas_id, mapel_id, pegawai_id, hari,
        jam_mulai, jam_selesai, ruangan,
        tahun_ajaran_id, semester_id)

presensi_siswa (id, siswa_id, kelas_id, tanggal,
               status [H/I/S/A], keterangan,
               tahun_ajaran_id, semester_id, pegawai_id)

penilaian (id, siswa_id, mapel_id, kelas_id,
           tahun_ajaran_id, semester_id,
           jenis_ujian, nilai, keterangan)
```

### Tabel Keuangan

```sql
-- Penerimaan dari siswa
jenis_pembayaran (id, nama, nominal, keterangan, aktif,
                  departemen_id [lembaga])

pembayaran (id, siswa_id, jenis_id, tahun_ajaran_id,
            bulan, jumlah, tanggal_bayar,
            petugas_id, keterangan,
            departemen_id [lembaga])

-- Pengeluaran
jenis_pengeluaran (id, nama, keterangan, aktif,
                   departemen_id [lembaga])

pengeluaran (id, jenis_id, jumlah, tanggal,
             keterangan, petugas_id,
             departemen_id [lembaga])

-- Akuntansi
akun_rekening (id, kode, nama, jenis [Aset/Kewajiban/Modal/Pendapatan/Beban],
               saldo_normal [D/K], saldo_awal, keterangan, aktif,
               departemen_id [lembaga])

jurnal (id, nomor, tanggal, keterangan, referensi,
        total_debit, total_kredit, status [draft/posted],
        dibuat_oleh, departemen_id)

jurnal_detail (id, jurnal_id, akun_id, keterangan,
               debit, kredit, urutan)

-- Tabungan siswa
tabungan_siswa (id, siswa_id, saldo, updated_at)

transaksi_tabungan (id, siswa_id, jenis [setor/tarik],
                    jumlah, saldo_sesudah, tanggal,
                    keterangan, petugas_id)
```

### Tabel Auth & Users

```sql
users_profile (id [FK auth.users], email, role, pegawai_id,
               siswa_id, aktif, created_at)
```

### Trigger & Function Penting

```sql
-- Auto-create profile saat user baru daftar
handle_new_user()              → trigger on auth.users INSERT

-- Helper functions (SECURITY DEFINER)
get_user_role(user_id)         → returns role text
has_role(user_id, role)        → returns boolean
is_admin_or_kepala(user_id)    → returns boolean

-- Validasi
validate_pegawai_jk()          → jenis_kelamin IN ('L', 'P')
validate_siswa_jk()            → jenis_kelamin IN ('L', 'P')
validate_presensi_status()     → status IN ('H', 'I', 'S', 'A')
validate_user_role()           → role IN (valid_roles)
```

### Row Level Security (RLS)

Semua tabel menggunakan RLS. Pola kebijakan:

| Tabel | Baca | Tulis |
|---|---|---|
| Tabel referensi | Semua `authenticated` | Hanya `admin`, `kepala_sekolah` |
| `pegawai`, `siswa` | Semua `authenticated` | Hanya `admin`, `kepala_sekolah` |
| `presensi_siswa`, `penilaian` | Semua `authenticated` | `admin`, `kepala_sekolah`, `guru` |
| `pembayaran`, `pengeluaran` | Semua `authenticated` | `admin`, `kepala_sekolah`, `keuangan`, `kasir` |
| `users_profile` | User sendiri + `admin` | Hanya `admin` |

---

## 6. Sistem Autentikasi & Role

### Cara Kerja Auth

1. User login via `supabase.auth.signInWithPassword(email, password)`
2. Setelah login, `AuthContext` mengambil `role` dari tabel `users_profile`
3. `ProtectedRoute` membungkus semua route yang butuh login
4. `ProtectedRoute` dapat menerima `allowedRoles` untuk membatasi akses per halaman

### Role yang Tersedia

| Role | Akses |
|---|---|
| `admin` | Akses penuh semua modul |
| `kepala_sekolah` | Akses penuh, bisa lihat semua laporan |
| `guru` | Akademik (presensi, penilaian), lihat data siswa |
| `keuangan` | Semua menu keuangan kecuali pembayaran kasir |
| `kasir` | Input pembayaran & tunggakan siswa saja |
| `pustakawan` | Modul SIMTAKA (perpustakaan) |
| `siswa` | Lihat data sendiri (portal siswa — future) |

### Contoh Penggunaan ProtectedRoute

```typescript
// Route terbuka untuk semua yang sudah login
<Route path="/keuangan/pembayaran" element={<InputPembayaran />} />

// Route hanya untuk role tertentu
<Route element={<ProtectedRoute allowedRoles={["admin", "kepala_sekolah", "keuangan"]} />}>
  <Route path="/keuangan/laporan" element={<LaporanKeuangan />} />
</Route>
```

---

## 7. Modul-Modul Aplikasi

### 7.1 Akademik

**Referensi JIBAS 32.0:** `/jibas/akademik/`

#### Sub-Modul yang Sudah Ada di Versi Baru

| Halaman | Route | Deskripsi |
|---|---|---|
| Hub Akademik | `/akademik` | Menu utama, tab navigasi |
| Daftar Siswa | `/akademik/siswa` | List semua siswa aktif, search, filter |
| Form Siswa | `/akademik/siswa/tambah` | Input siswa baru |
| Form Siswa | `/akademik/siswa/:id/edit` | Edit data siswa |
| Detail Siswa | `/akademik/siswa/:id` | Profil lengkap, riwayat kelas, nilai |
| PSB | `/akademik/psb` | Penerimaan Siswa Baru / calon siswa |
| Mutasi Siswa | `/akademik/mutasi` | Naik kelas, lulus, pindah, dropout |

#### Sub-Modul yang Perlu Dibangun (Ada di JIBAS 32.0)

| Fitur | Referensi Lama | Prioritas |
|---|---|---|
| Jadwal Pelajaran (per kelas & per guru) | `/akademik/jadwal/` | Tinggi |
| Presensi Siswa (harian & per pelajaran) | `/akademik/presensi/` | Tinggi |
| Penilaian / Input Nilai | `/akademik/penilaian/` | Tinggi |
| Cetak Rapor | `penilaian/cetak_rapor_kelas.php` | Tinggi |
| Legger Nilai | `penilaian/legger.kelas.php` | Sedang |
| Kalender Akademik | `/akademik/jadwal/kalender_*.php` | Sedang |
| Data Guru (dari sisi akademik) | `/akademik/guru/` | Sedang |
| Referensi Akademik (mata pelajaran, dll) | `/akademik/referensi/` | Sedang |
| Statistik Siswa | `siswa/statistik_*.php` | Rendah |
| Alumni | `siswa/alumni_*.php` | Rendah |

#### Tabel Database Akademik yang Perlu Ditambah

```sql
-- Kalender akademik
kalender_akademik (id, judul, tanggal_mulai, tanggal_selesai,
                   jenis, keterangan, departemen_id)

-- Calon siswa (PSB)
calon_siswa (id, nama, jenis_kelamin, tempat_lahir, tanggal_lahir,
             alamat, telepon, asal_sekolah, tahun_daftar,
             departemen_id, status [daftar/diterima/ditolak])
```

---

### 7.2 Keuangan

**Referensi JIBAS 32.0:** `/jibas/keuangan/`

#### Sub-Modul yang Sudah Ada di Versi Baru

| Halaman | Route | Deskripsi |
|---|---|---|
| Hub Keuangan | `/keuangan` | Dashboard ringkasan keuangan |
| Input Pembayaran | `/keuangan/pembayaran` | Bayar SPP/iuran siswa |
| Tunggakan | `/keuangan/tunggakan` | Daftar siswa nunggak |
| Input Pengeluaran | `/keuangan/pengeluaran` | Catat pengeluaran |
| Tabungan Siswa | `/keuangan/tabungan` | Setor & tarik tabungan |
| Laporan Keuangan | `/keuangan/laporan` | Arus Kas, Laba Rugi, Neraca |
| Referensi Keuangan | `/keuangan/referensi` | Jenis pembayaran, pengeluaran |
| Jurnal Umum | `/keuangan/jurnal` | Input jurnal akuntansi |
| Buku Besar | `/keuangan/buku-besar` | Laporan buku besar per akun |

#### Sub-Modul yang Sudah Dibangun (Fase 3 ✅)

| Halaman | Route | Deskripsi |
|---|---|---|
| Laporan Bayar per Siswa | `/keuangan/laporan-siswa` | Histori pembayaran 1 siswa |
| Laporan Bayar per Kelas | `/keuangan/laporan-kelas` | Status bayar per bulan seluruh kelas |
| Rekap Harian | `/keuangan/rekap-harian` | Ringkasan penerimaan & pengeluaran harian |
| Pembayaran PSB | `/keuangan/pembayaran-psb` | Pembayaran calon siswa |
| Tutup Buku | `/keuangan/tutup-buku` | Proses akhir tahun buku |
| Kuitansi Print | (komponen) | `PrintKuitansi.tsx` — cetak kuitansi dari InputPembayaran |
| Lap. Pengeluaran per Jenis | `/keuangan/laporan-pengeluaran` | Ringkasan & detail pengeluaran per jenis |
| Penerimaan Lain | `/keuangan/penerimaan-lain` | Penerimaan non-SPP (pendaftaran, uang pangkal, dll) |
| Audit Trail | `/keuangan/audit-trail` | Log seluruh transaksi penerimaan & pengeluaran |
| Bukti Pengeluaran | (dalam InputPengeluaran) | Dialog cetak bukti pengeluaran |

#### Sub-Modul yang Masih Perlu Dibangun

| Fitur | Referensi Lama | Prioritas |
|---|---|---|
| Online Payment | `/keuangan/onlinepay/` | Rendah |
| SchoolPay | `/keuangan/schoolpay/` | Rendah |

---

### 7.3 Kepegawaian

**Referensi JIBAS 32.0:** `/jibas/kepegawaian/`

#### Sub-Modul yang Sudah Ada di Versi Baru

| Halaman | Route | Deskripsi |
|---|---|---|
| Hub Kepegawaian | `/kepegawaian` | Menu utama |
| Data Pegawai | `/kepegawaian/pegawai` | CRUD pegawai, multi-departemen |
| Presensi Pegawai | `/kepegawaian/presensi` | Input & rekap kehadiran |

#### Sub-Modul yang Perlu Dibangun (Ada di JIBAS 32.0)

| Fitur | Referensi Lama | Prioritas |
|---|---|---|
| Detail Pegawai (riwayat lengkap) | `daftarpribadi.php`, `detailpegawai.php` | Tinggi |
| Riwayat Jabatan | `daftarjabatan.php`, `jabatan*.php` | Tinggi |
| Riwayat Golongan / Pangkat | `daftargolongan.php`, `dukpangkat.php` | Sedang |
| Riwayat Gaji | `daftargaji.php` | Sedang |
| Riwayat Pendidikan | `daftarsekolah.php` | Sedang |
| Sertifikasi | `daftarserti.php` | Sedang |
| Diklat / Pelatihan | `daftardiklat.php` | Sedang |
| Riwayat Keluarga | `daftarkeluarga.php` | Sedang |
| Jadwal Pegawai | `jadwal.php`, `jadwalcal.php` | Sedang |
| Statistik Kepegawaian | `statistik.php`, `rekapgolongan.php` | Rendah |
| Struktur Organisasi | `struktur.php` | Rendah |
| Pensiun | `daftarpensiun.php` | Rendah |

#### Tabel yang Perlu Ditambah untuk Kepegawaian Lengkap

```sql
riwayat_jabatan  (id, pegawai_id, jabatan, tmt, sampai, sk_nomor, sk_tanggal)
riwayat_golongan (id, pegawai_id, golongan, tmt, sk_nomor, sk_tanggal)
riwayat_gaji     (id, pegawai_id, gaji_pokok, tunjangan, tmt)
riwayat_sekolah  (id, pegawai_id, jenjang, nama_sekolah, jurusan,
                  tahun_lulus, ijazah_nomor)
riwayat_diklat   (id, pegawai_id, nama_diklat, penyelenggara,
                  tanggal_mulai, tanggal_selesai, sertifikat)
sertifikasi      (id, pegawai_id, bidang_studi, no_sertifikat, tahun)
keluarga_pegawai (id, pegawai_id, nama, hubungan, tanggal_lahir,
                  pekerjaan, keterangan)
```

---

### 7.4 CBE (Competency-Based Education)

**Referensi JIBAS 32.0:** `/jibas/cbe/`

> Modul penilaian berbasis kompetensi (KKM, indikator per kompetensi dasar).  
> Di versi baru, halaman `/cbe` dan `/cbe/:tab` sudah ada sebagai shell — konten perlu dibangun.

#### Yang Perlu Dibangun

| Fitur | Prioritas |
|---|---|
| Setup KKM per mapel per kelas | Tinggi |
| Input nilai kompetensi dasar (KD) | Tinggi |
| Perhitungan nilai akhir per KD | Tinggi |
| Laporan pencapaian kompetensi | Sedang |
| Remedial & pengayaan | Sedang |

#### Tabel yang Dibutuhkan

```sql
kompetensi_dasar (id, mapel_id, kode_kd, deskripsi, semester_id)
kkm              (id, mapel_id, kelas_id, tahun_ajaran_id, semester_id, nilai_kkm)
nilai_kd         (id, siswa_id, kd_id, kelas_id, tahun_ajaran_id,
                  semester_id, nilai, keterangan)
```

---

### 7.5 SIMTAKA

**Referensi JIBAS 32.0:** `/jibas/simtaka/`

> Sistem Manajemen Perpustakaan (koleksi buku, peminjaman, pengembalian).  
> Di versi baru, halaman `/simtaka` dan `/simtaka/:tab` sudah ada sebagai shell.

#### Yang Perlu Dibangun

| Fitur | Prioritas |
|---|---|
| Katalog koleksi buku | Tinggi |
| Input peminjaman buku | Tinggi |
| Pengembalian & denda | Tinggi |
| Pencarian koleksi | Sedang |
| Laporan peminjaman | Sedang |
| Statistik pengunjung perpustakaan | Rendah |

#### Tabel yang Dibutuhkan

```sql
koleksi_buku  (id, kode, judul, pengarang, penerbit, tahun,
               isbn, kategori, jumlah_total, jumlah_tersedia,
               lokasi, foto_url, aktif)

peminjaman    (id, koleksi_id, peminjam_id, peminjam_tipe [siswa/pegawai],
               tanggal_pinjam, tanggal_kembali_rencana,
               tanggal_kembali_aktual, status [dipinjam/kembali/terlambat],
               denda, petugas_id)
```

---

### 7.6 Buletin

**Referensi JIBAS 32.0:** `/jibas/buletin/`

> Papan pengumuman & informasi sekolah untuk siswa dan wali murid.  
> Di versi baru, halaman `/buletin` sudah ada sebagai shell.

#### Yang Perlu Dibangun

| Fitur | Prioritas |
|---|---|
| Buat & publish pengumuman | Tinggi |
| Kategori pengumuman | Sedang |
| Lampiran file pada pengumuman | Sedang |
| Target penerima (per kelas / semua) | Sedang |
| Arsip pengumuman | Rendah |

#### Tabel yang Dibutuhkan

```sql
pengumuman (id, judul, konten, kategori, lampiran_url,
            target_tipe [semua/kelas/tingkat/departemen],
            target_id, tanggal_tayang, tanggal_kadaluarsa,
            penulis_id, departemen_id, aktif, created_at)
```

---

### 7.7 Pengaturan

**Referensi JIBAS 32.0:** `include/school.config.php`, `include/application.config.php`

#### Sub-Modul yang Sudah Ada di Versi Baru

| Halaman | Route | Deskripsi |
|---|---|---|
| Hub Pengaturan | `/pengaturan` | Menu tab pengaturan |
| Profil Yayasan | `/pengaturan/sekolah` | Nama, logo, alamat, NPS yayasan |
| Manajemen Pengguna | `/pengaturan/pengguna` | Buat/edit user, assign role |

#### Yang Perlu Dibangun

| Fitur | Prioritas |
|---|---|
| Pengaturan tahun ajaran aktif | Tinggi |
| Pengaturan semester aktif | Tinggi |
| Template nomor kuitansi/jurnal | Sedang |
| Backup / export data | Rendah |

---

## 8. Routing Lengkap

```
/login                          → Login (public)
/unauthorized                   → Akses ditolak

/ (Dashboard)                   → Semua role yang login

/akademik                       → Hub Akademik
/akademik/siswa                 → Daftar Siswa
/akademik/siswa/tambah          → Form Tambah Siswa
/akademik/siswa/:id             → Detail Siswa
/akademik/siswa/:id/edit        → Form Edit Siswa
/akademik/psb                   → Penerimaan Siswa Baru
/akademik/mutasi                → Mutasi Siswa
/akademik/:tab                  → Hub Akademik (tab tertentu)

/keuangan                       → Hub Keuangan (semua role termasuk kasir)
/keuangan/pembayaran            → Input Pembayaran (semua role)
/keuangan/tunggakan             → Tunggakan Pembayaran (semua role)
/keuangan/pengeluaran           → Input Pengeluaran [bukan kasir]
/keuangan/tabungan              → Tabungan Siswa [bukan kasir]
/keuangan/laporan               → Laporan Keuangan [bukan kasir]
/keuangan/referensi             → Referensi Keuangan [bukan kasir]
/keuangan/jurnal                → Jurnal Umum [bukan kasir]
/keuangan/buku-besar            → Buku Besar [bukan kasir]
/keuangan/laporan-siswa         → Laporan Bayar per Siswa [bukan kasir]
/keuangan/laporan-kelas         → Laporan Bayar per Kelas [bukan kasir]
/keuangan/rekap-harian          → Rekap Keuangan Harian [bukan kasir]
/keuangan/pembayaran-psb        → Pembayaran Calon Siswa [bukan kasir]
/keuangan/tutup-buku            → Tutup Buku [bukan kasir]

/kepegawaian                    → Hub Kepegawaian
/kepegawaian/pegawai            → Data Pegawai
/kepegawaian/presensi           → Presensi Pegawai

/cbe                            → Hub CBE
/cbe/:tab                       → CBE (tab tertentu)

/simtaka                        → Hub SIMTAKA
/simtaka/:tab                   → SIMTAKA (tab tertentu)

/buletin                        → Buletin/Pengumuman

/pengaturan                     → Hub Pengaturan
/pengaturan/sekolah             → Profil Yayasan
/pengaturan/pengguna            → Manajemen Pengguna
/pengaturan/:tab                → Pengaturan (tab tertentu)

*                               → NotFound (404)
```

---

## 9. Multi-Lembaga (Yayasan)

### Konsep

Satu yayasan memiliki beberapa **lembaga** (contoh: TK Al-Huda, SD Al-Huda, SMP Al-Huda, SMA Al-Huda, MTQ Al-Huda). Semua lembaga dikelola dalam **satu aplikasi** dan **satu database**.

Lembaga direpresentasikan oleh tabel `departemen`:

```sql
departemen (id, nama, kode, keterangan, aktif)
-- Contoh data:
-- | id | nama     | kode |
-- | .. | TK       | TK   |
-- | .. | SD       | SD   |
-- | .. | SMP      | SMP  |
-- | .. | SMA      | SMA  |
-- | .. | MTQ      | MTQ  |
```

### Cara Implementasi di Kode

**1. Kolom `departemen_id` di setiap tabel finansial:**

```sql
-- Semua tabel ini memiliki kolom departemen_id:
pembayaran, jenis_pembayaran, pengeluaran, jenis_pengeluaran,
akun_rekening, jurnal, tabungan_siswa, presensi_pegawai
```

**2. Hook `useLembaga` untuk filter:**

```typescript
// src/hooks/useLembaga.ts
export function useLembaga() {
  const [lembagaAktif, setLembagaAktif] = useState<string | 'semua'>('semua');
  
  const { data: daftarLembaga } = useQuery({
    queryKey: ['departemen'],
    queryFn: async () => {
      const { data } = await supabase
        .from('departemen')
        .select('*')
        .eq('aktif', true)
        .order('nama');
      return data;
    }
  });

  return { lembagaAktif, setLembagaAktif, daftarLembaga };
}
```

**3. Filter query berdasarkan lembaga aktif:**

```typescript
// Di setiap hook keuangan, filter berdasarkan lembaga
const query = supabase.from('pembayaran').select('...');
if (lembagaAktif !== 'semua') {
  query.eq('departemen_id', lembagaAktif);
}
```

**4. Selector lembaga di form:**

Setiap form input pembayaran/pengeluaran wajib memiliki dropdown selector lembaga.

**5. Dashboard Yayasan (Konsolidasi):**

Dashboard menampilkan ringkasan keuangan **semua lembaga** sekaligus, dengan kemampuan drill-down per lembaga menggunakan recharts.

---

## 10. Panduan Setup & Build

### Prasyarat

- Node.js ≥ 18
- npm ≥ 9
- Akun Supabase (https://supabase.com)

### Langkah Setup

```bash
# 1. Clone & install dependencies
cd jibas-2-main
npm install

# 2. Setup environment variables
# Buat file .env.local di root proyek:
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here

# 3. Jalankan migrasi database
# Buka Supabase Dashboard → SQL Editor
# Jalankan file-file di supabase/migrations/ SECARA BERURUTAN:
#   20260304073505_... (schema utama)
#   20260304073525_... (RLS policies)
#   20260305055217_... (dst)
# ATAU gunakan Supabase CLI:
supabase db push

# 4. Jalankan development server
npm run dev

# 5. Build untuk production
npm run build

# 6. Preview production build
npm run preview
```

### Urutan Jalankan Migrasi

```
1. 20260304073505_... → Schema utama (tabel + triggers + fungsi helper + RLS)
2. 20260304073525_... → RLS policies tambahan
3. 20260305055217_... → Tambahan tabel/kolom batch 1
4. 20260305055249_... → Tambahan tabel/kolom batch 2
5. 20260306003947_... → Multi-lembaga: kolom departemen_id di tabel finansial
6. 20260306011526_... → Multi-lembaga: update RLS policies
7. 20260306025428_... → Role kasir + kebijakan kasir
8. 20260306025444_... → Role kasir: update users_profile validation trigger
9. 20260306030021_... → Kepegawaian: kolom departemen_id di pegawai
10. 20260306030040_... → Kepegawaian: tabel presensi_pegawai
11. 20260306040728_... → Pengaturan: profil yayasan
12. 20260306044929_... → Pengaturan: manajemen pengguna RLS
13. 20260306044945_... → Fix/patch terakhir
```

### Membuat User Admin Pertama

Setelah setup database, buat user admin melalui Supabase Dashboard:

```sql
-- 1. Daftar via Supabase Auth (Dashboard → Authentication → Users → Add User)
-- Email: admin@hijrahattauhid.sch.id  Password: (password kuat)

-- 2. Update role menjadi admin
UPDATE public.users_profile
SET role = 'admin'
WHERE email = 'admin@hijrahattauhid.sch.id';
```

### Environment Variables yang Dibutuhkan

```env
# Wajib
VITE_SUPABASE_URL=         # URL project Supabase
VITE_SUPABASE_ANON_KEY=    # Anon/public key Supabase

# Opsional
VITE_APP_NAME=Hijrah At-Tauhid
VITE_APP_VERSION=2.0.0
```

---

## 11. Urutan Pembangunan yang Disarankan

Gunakan urutan ini saat membangun fitur baru, khususnya bila menggunakan AI assistant. Selalu baca `CLAUDE.md` dan `SESI_NOTES.md` terlebih dahulu di setiap sesi baru.

### Fase 1 — Fondasi (SUDAH SELESAI ✅)

- [x] Setup Supabase + migrasi schema awal
- [x] Autentikasi (login, logout, role)
- [x] Layout aplikasi (sidebar, header, routing)
- [x] Modul Akademik: CRUD Siswa, PSB, Mutasi
- [x] Modul Keuangan: Pembayaran, Pengeluaran, Tabungan, Jurnal, Buku Besar, Laporan
- [x] Modul Kepegawaian: Data Pegawai, Presensi
- [x] Multi-lembaga: kolom `departemen_id` + selector lembaga di form keuangan
- [x] Role `kasir` dengan akses terbatas
- [x] Pengaturan: Profil Yayasan, Manajemen Pengguna

### Fase 2 — Akademik Lengkap (PRIORITAS BERIKUTNYA)

- [ ] **Jadwal Pelajaran** — setup jam pelajaran, input jadwal per kelas, lihat jadwal per guru
- [ ] **Presensi Siswa Harian** — input per kelas per tanggal, rekap kehadiran
- [ ] **Presensi Siswa per Pelajaran** — presensi saat KBM berlangsung
- [ ] **Input Nilai / Penilaian** — nilai per jenis ujian, per mapel, per semester
- [ ] **Cetak Rapor** — generate rapor siswa (HTML/PDF)
- [ ] **Legger Nilai** — rekap nilai seluruh kelas dalam tabel
- [ ] **Kalender Akademik** — event, libur, jadwal ujian

### Fase 3 — Keuangan Lengkap (SUDAH SELESAI ✅)

- [x] **Kuitansi Pembayaran** — cetak kuitansi PDF/print per transaksi (`PrintKuitansi.tsx`)
- [x] **Laporan Bayar per Siswa** — histori lengkap pembayaran 1 siswa (`LaporanBayarSiswa.tsx`)
- [x] **Laporan Bayar per Kelas** — rekapitulasi pembayaran seluruh kelas (`LaporanBayarKelas.tsx`)
- [x] **Laporan Tunggak per Kelas** — daftar siswa nunggak per kelas & jenis (via `TunggakanPembayaran.tsx`)
- [x] **Rekap Keuangan Harian** — ringkasan penerimaan & pengeluaran per hari (`RekapHarian.tsx`)
- [x] **Pembayaran Calon Siswa** — bayar biaya pendaftaran PSB (`PembayaranPSB.tsx`)
- [x] **Tutup Buku** — proses akhir tahun buku (`TutupBuku.tsx`)

### Fase 4 — Kepegawaian Lengkap

- [x] **Detail Riwayat Pegawai** — jabatan, golongan, gaji, pendidikan (`DetailPegawai.tsx`)
- [x] **Diklat & Sertifikasi** — riwayat pelatihan dan sertifikat (`DetailPegawai.tsx`)
- [x] **Jadwal Pegawai** — jadwal mengajar/tugas per pegawai (`JadwalPegawai.tsx`)
- [x] **Statistik Kepegawaian** — grafik per golongan, jenis kelamin, usia (`StatistikPegawai.tsx`)
- [x] **Struktur Organisasi** — visualisasi hierarki jabatan (`StrukturOrganisasi.tsx`)
- [x] **DUK** — Daftar Urut Kepangkatan (`DUK.tsx`)
- [x] **Cetak Biodata** — cetak biodata pegawai (`CetakBiodata.tsx`)

### Fase 5 — Modul Tambahan

- [x] **CBE** — penilaian berbasis kompetensi dasar (KD) (`CBE.tsx` + `LaporanPencapaian.tsx` + `RemedialPengayaan.tsx`)
- [x] **SIMTAKA** — katalog buku, peminjaman, pengembalian (`Simtaka.tsx`)
- [x] **Buletin** — pengumuman sekolah (`Buletin.tsx`)

### Fase 6 — Portal & Integrasi

- [x] **Portal Orang Tua/Siswa** — lihat nilai, presensi, tagihan (`portal/`)
- [x] **SMS/WhatsApp Gateway** — notifikasi tunggakan, nilai rapor (`NotifikasiGateway.tsx`)
- [x] **SchoolPay / Online Payment** — integrasi payment gateway (`OnlinePayment.tsx`)
- [x] **InfoGuru** — portal mandiri untuk guru (`InfoGuru.tsx`)
- [x] **Anjungan (Kiosk)** — layanan mandiri di sekolah (`Anjungan.tsx`)

---

## 12. Fitur JIBAS 32.0 yang Belum Ada di Versi Baru

Tabel ini adalah **backlog lengkap** fitur dari JIBAS 32.0 yang perlu diimplementasikan:

### Akademik

| Fitur | Modul PHP | Status |
|---|---|---|
| Jadwal pelajaran per kelas | `jadwal/jadwal_kelas_*.php` | ✅ Selesai (`JadwalPelajaran.tsx`) |
| Jadwal mengajar guru | `jadwal/jadwal_guru_*.php` | ✅ Selesai (`JadwalPegawai.tsx`) |
| Presensi harian siswa | `presensi/input_presensi_*.php` | ✅ Selesai (`PresensiSiswa.tsx`) |
| Presensi per pelajaran (KBM) | `presensi/presensikeg.siswa2.*.php` | ✅ Selesai (`PresensiKBM.tsx`) |
| Rekap absensi siswa | `presensi/lap_*.php` | ✅ Selesai (via `PresensiSiswa.tsx`) |
| Input nilai per ujian | `penilaian/formpenilaian.php` | ✅ Selesai (`Penilaian.tsx`) |
| Import nilai dari Excel | `penilaian/impnilai.php` | ⚠️ Partial |
| Export nilai ke Excel | `penilaian/expnilai.php` | ✅ Selesai (via `ExportButton.tsx`) |
| Hitung nilai akhir | `penilaian/hitung_nilai_akhir.php` | ✅ Selesai (edge function `hitung-nilai-akhir`) |
| Cetak rapor (Word/HTML) | `penilaian/cetak_rapor_kelas.php` | ✅ Selesai (`CetakRapor.tsx`) |
| Legger nilai per kelas | `penilaian/legger.kelas.php` | ✅ Selesai (`LeggerNilai.tsx`) |
| Komentar rapor | `penilaian/komentar.*.php` | ✅ Selesai (`KomentarRapor.tsx`) |
| RPP (Rencana Pelaksanaan Pembelajaran) | `penilaian/rpp.php` | ✅ Selesai (`RPP.tsx`) |
| Kalender akademik | `jadwal/kalender_*.php` | ✅ Selesai (`KalenderAkademik.tsx`) |
| Statistik siswa (grafik) | `siswa/statistik_*.php` | ✅ Selesai (`StatistikSiswa.tsx`) |
| Data alumni | `siswa/alumni_*.php` | ✅ Selesai (`DataAlumni.tsx`) |
| PSB — lengkap dengan pembayaran | `siswa_baru/` | ✅ Selesai (`PSB.tsx` + `PembayaranPSB.tsx`) |

### Keuangan

| Fitur | Modul PHP | Status |
|---|---|---|
| Kuitansi bayar siswa (print) | `kuitansiiuran.php` | ✅ Selesai (`PrintKuitansi.tsx`) |
| Kuitansi JTT (print) | `kuitansijtt.php` | ✅ Selesai (via `PrintKuitansi.tsx`) |
| Laporan bayar per siswa | `lapbayarsiswa_*.php` | ✅ Selesai (`LaporanBayarSiswa.tsx`) |
| Laporan bayar per kelas | `lapbayarsiswa_kelas_*.php` | ✅ Selesai (`LaporanBayarKelas.tsx`) |
| Laporan tunggak per kelas | `lapbayarsiswa_nunggak_*.php` | ✅ Selesai (via `TunggakanPembayaran.tsx`) |
| Laporan bayar calon siswa | `lapbayarcalon_*.php` | ✅ Selesai (`PembayaranPSB.tsx`) |
| Rekap keuangan harian | `laprekapharian_*.php` | ✅ Selesai (`RekapHarian.tsx`) |
| Rekap keuangan per siswa | `laprekapsiswa_*.php` | ✅ Selesai (`LaporanBayarSiswa.tsx`) |
| Tutup buku tahunan | `tutupbuku.php` | ✅ Selesai (`TutupBuku.tsx`) |
| Pembayaran calon siswa | `pembayaran_iurancalon.php` | ✅ Selesai (`PembayaranPSB.tsx`) |
| Laporan penerimaan lain | `lappenerimaanlain_*.php` | ✅ Selesai (`LaporanPenerimaanLain.tsx`) |
| Laporan pengeluaran per jenis | `lappengeluaran_jenis_*.php` | ✅ Selesai (`LaporanPengeluaran.tsx`) |
| Tahun buku | `tahunbuku_*.php` | ✅ Selesai (via `TutupBuku.tsx` + `ReferensiKeuangan.tsx`) |
| Audit trail transaksi | `lapaudit_*.php` | ✅ Selesai (`AuditTrail.tsx`) |
| Pengeluaran bukti cetak | `buktipengeluaran.php` | ✅ Selesai (via `InputPengeluaran.tsx`) |

### Kepegawaian

| Fitur | Modul PHP | Status |
|---|---|---|
| Riwayat jabatan lengkap | `pegawai/daftarjabatan.php` | ✅ Selesai (`DetailPegawai.tsx`) |
| Riwayat golongan/pangkat | `pegawai/daftargolongan.php` | ✅ Selesai (`DetailPegawai.tsx`) |
| DUK (Daftar Urut Kepangkatan) | `pegawai/dukpangkat.php` | ✅ Selesai (`DUK.tsx`) |
| Riwayat gaji | `pegawai/daftargaji.php` | ✅ Selesai (`DetailPegawai.tsx`) |
| Riwayat pendidikan | `pegawai/daftarsekolah.php` | ✅ Selesai (`DetailPegawai.tsx`) |
| Sertifikasi guru | `pegawai/daftarserti.php` | ✅ Selesai (`DetailPegawai.tsx`) |
| Diklat/pelatihan | `pegawai/daftardiklat.php` | ✅ Selesai (`DetailPegawai.tsx`) |
| Data keluarga | `pegawai/daftarkeluarga.php` | ✅ Selesai (`DetailPegawai.tsx`) |
| Jadwal pegawai | `pegawai/jadwal*.php` | ✅ Selesai (`JadwalPegawai.tsx`) |
| Statistik kepegawaian | `pegawai/statistik.php` | ✅ Selesai (`StatistikPegawai.tsx`) |
| Struktur organisasi | `pegawai/struktur.php` | ✅ Selesai (`StrukturOrganisasi.tsx`) |
| Pensiun | `pegawai/daftarpensiun.php` | ✅ Selesai (via `DetailPegawai.tsx`) |
| Cetak biodata pegawai | `pegawai/daftarpribadi_cetak.php` | ✅ Selesai (`CetakBiodata.tsx`) |

---

## 13. Konvensi Kode

### Penamaan File & Komponen

```
PascalCase    → Komponen React:   DaftarSiswa.tsx, FormSiswa.tsx
camelCase     → Hooks:            useKeuangan.ts, useSiswa.ts
kebab-case    → Routes:           /akademik/daftar-siswa
SCREAMING     → Konstanta:        USER_ROLES, JENIS_UJIAN
```

### Pola Komponen Halaman

```typescript
// src/pages/modul/NamaHalaman.tsx
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

export default function NamaHalaman() {
  const { role } = useAuth();
  
  // 1. Query data
  const { data, isLoading } = useQuery({ ... });
  
  // 2. Mutations
  const mutation = useMutation({ ... });
  
  // 3. Render
  if (isLoading) return <div>Memuat...</div>;
  return ( ... );
}
```

### Pola Custom Hook

```typescript
// src/hooks/useNamaData.ts
export function useNamaData(filters?: FilterType) {
  return useQuery({
    queryKey: ['nama_data', filters],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nama_tabel')
        .select('*');
      if (error) throw error;
      return data;
    }
  });
}

export function useCreateNamaData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: InsertType) => {
      const { data, error } = await supabase
        .from('nama_tabel')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nama_data'] });
      toast({ title: 'Berhasil disimpan' });
    }
  });
}
```

### Format Angka & Tanggal (Indonesia)

```typescript
// Format Rupiah
const formatRupiah = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);

// Format Tanggal Indonesia
const formatTanggal = (d: string) =>
  new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });

// Format Bulan
const BULAN = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
               'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
```

### Struktur Form dengan React Hook Form + Zod

```typescript
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const schema = z.object({
  nama: z.string().min(1, "Nama wajib diisi"),
  jumlah: z.number().positive("Jumlah harus lebih dari 0"),
});

type FormValues = z.infer<typeof schema>;

function NamaForm() {
  const form = useForm<FormValues>({ resolver: zodResolver(schema) });
  const onSubmit = (values: FormValues) => { /* ... */ };
  return <form onSubmit={form.handleSubmit(onSubmit)}>...</form>;
}
```

---

## 📎 Referensi Cepat

| Kebutuhan | File/Lokasi |
|---|---|
| Tambah halaman baru | `src/pages/` + daftarkan di `src/App.tsx` |
| Tambah menu sidebar | `src/components/layout/AppLayout.tsx` |
| Tambah hook data | `src/hooks/` |
| Tambah tabel database | `supabase/migrations/` (file SQL baru) |
| Tambah role baru | `AuthContext.tsx` (type `UserRole`) + trigger `validate_user_role` di DB |
| Schema database lama | `jibas-32.0/jibas_db.sql` |
| Referensi kode PHP lama | `jibas-32.0/jibas/` |

---

*Dokumen ini dibuat berdasarkan analisis kode JIBAS 32.0 dan Hijrah At-Tauhid versi baru (React/Supabase).*  
*Update dokumen ini setiap ada modul baru yang selesai dibangun.*