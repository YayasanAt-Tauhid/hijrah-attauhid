export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      spp_kategori_periode_audit: {
        Row: { id: string; siswa_id: string; jenis_id: string; mulai: string; selesai: string; kategori: string; nominal_bruto: number; alasan: string; dibuat_oleh: string; dibuat_at: string; transaction_id: number; perubahan: Json }
        Insert: { id?: string; siswa_id: string; jenis_id: string; mulai: string; selesai: string; kategori: string; nominal_bruto: number; alasan: string; dibuat_oleh: string; dibuat_at?: string; transaction_id?: number; perubahan: Json }
        Update: { id?: string; siswa_id?: string; jenis_id?: string; mulai?: string; selesai?: string; kategori?: string; nominal_bruto?: number; alasan?: string; dibuat_oleh?: string; dibuat_at?: string; transaction_id?: number; perubahan?: Json }
        Relationships: []
      }
      spp_kategori_periode: {
        Row: { siswa_id: string; jenis_id: string; periode: string; kategori: string; nominal_bruto: number; audit_id: string }
        Insert: { siswa_id: string; jenis_id: string; periode: string; kategori: string; nominal_bruto: number; audit_id: string }
        Update: { siswa_id?: string; jenis_id?: string; periode?: string; kategori?: string; nominal_bruto?: number; audit_id?: string }
        Relationships: []
      }
      _keep_alive_log: {
        Row: {
          id: number
          pinged_at: string | null
          source: string | null
        }
        Insert: {
          id?: number
          pinged_at?: string | null
          source?: string | null
        }
        Update: {
          id?: number
          pinged_at?: string | null
          source?: string | null
        }
        Relationships: []
      }
      akun_rekening: {
        Row: {
          aktif: boolean | null
          created_at: string | null
          departemen_id: string | null
          id: string
          jenis: string
          keterangan: string | null
          kode: string
          kode_isak35: string | null
          nama: string
          pos_isak35: string | null
          saldo_awal: number | null
          saldo_normal: string
          urutan_isak35: number | null
        }
        Insert: {
          aktif?: boolean | null
          created_at?: string | null
          departemen_id?: string | null
          id?: string
          jenis: string
          keterangan?: string | null
          kode: string
          kode_isak35?: string | null
          nama: string
          pos_isak35?: string | null
          saldo_awal?: number | null
          saldo_normal: string
          urutan_isak35?: number | null
        }
        Update: {
          aktif?: boolean | null
          created_at?: string | null
          departemen_id?: string | null
          id?: string
          jenis?: string
          keterangan?: string | null
          kode?: string
          kode_isak35?: string | null
          nama?: string
          pos_isak35?: string | null
          saldo_awal?: number | null
          saldo_normal?: string
          urutan_isak35?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "akun_rekening_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "akun_rekening_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekap_keuangan_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "akun_rekening_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekon_antar_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "akun_rekening_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["departemen_id"]
          },
        ]
      }
      angkatan: {
        Row: {
          aktif: boolean | null
          departemen_id: string | null
          id: string
          keterangan: string | null
          nama: string
        }
        Insert: {
          aktif?: boolean | null
          departemen_id?: string | null
          id?: string
          keterangan?: string | null
          nama: string
        }
        Update: {
          aktif?: boolean | null
          departemen_id?: string | null
          id?: string
          keterangan?: string | null
          nama?: string
        }
        Relationships: [
          {
            foreignKeyName: "angkatan_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "angkatan_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekap_keuangan_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "angkatan_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekon_antar_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "angkatan_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["departemen_id"]
          },
        ]
      }
      aset_tetap: {
        Row: {
          aktif: boolean | null
          created_at: string | null
          created_by: string | null
          departemen_id: string | null
          harga_perolehan: number
          id: string
          jenis_aset: string
          keterangan: string | null
          tanggal_perolehan: string
          umur_ekonomis_bulan: number
        }
        Insert: {
          aktif?: boolean | null
          created_at?: string | null
          created_by?: string | null
          departemen_id?: string | null
          harga_perolehan: number
          id?: string
          jenis_aset: string
          keterangan?: string | null
          tanggal_perolehan: string
          umur_ekonomis_bulan: number
        }
        Update: {
          aktif?: boolean | null
          created_at?: string | null
          created_by?: string | null
          departemen_id?: string | null
          harga_perolehan?: number
          id?: string
          jenis_aset?: string
          keterangan?: string | null
          tanggal_perolehan?: string
          umur_ekonomis_bulan?: number
        }
        Relationships: [
          {
            foreignKeyName: "aset_tetap_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aset_tetap_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekap_keuangan_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "aset_tetap_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekon_antar_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "aset_tetap_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["departemen_id"]
          },
        ]
      }
      audit_keuangan: {
        Row: {
          aksi: string
          created_at: string
          data_baru: Json | null
          data_lama: Json | null
          departemen_id: string | null
          dibuat_oleh: string | null
          id: string
          keterangan: string | null
          nama_pengguna: string | null
          record_id: string
          tabel_sumber: string
        }
        Insert: {
          aksi: string
          created_at?: string
          data_baru?: Json | null
          data_lama?: Json | null
          departemen_id?: string | null
          dibuat_oleh?: string | null
          id?: string
          keterangan?: string | null
          nama_pengguna?: string | null
          record_id: string
          tabel_sumber: string
        }
        Update: {
          aksi?: string
          created_at?: string
          data_baru?: Json | null
          data_lama?: Json | null
          departemen_id?: string | null
          dibuat_oleh?: string | null
          id?: string
          keterangan?: string | null
          nama_pengguna?: string | null
          record_id?: string
          tabel_sumber?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_keuangan_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_keuangan_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekap_keuangan_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "audit_keuangan_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekon_antar_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "audit_keuangan_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["departemen_id"]
          },
        ]
      }
      departemen: {
        Row: {
          akreditasi: string | null
          aktif: boolean | null
          alamat: string | null
          email: string | null
          id: string
          kategori: string | null
          kepala_sekolah: string | null
          keterangan: string | null
          kode: string | null
          kota: string | null
          logo_url: string | null
          nama: string
          npsn: string | null
          psb_dibuka: boolean
          telepon: string | null
        }
        Insert: {
          akreditasi?: string | null
          aktif?: boolean | null
          alamat?: string | null
          email?: string | null
          id?: string
          kategori?: string | null
          kepala_sekolah?: string | null
          keterangan?: string | null
          kode?: string | null
          kota?: string | null
          logo_url?: string | null
          nama: string
          npsn?: string | null
          psb_dibuka?: boolean
          telepon?: string | null
        }
        Update: {
          akreditasi?: string | null
          aktif?: boolean | null
          alamat?: string | null
          email?: string | null
          id?: string
          kategori?: string | null
          kepala_sekolah?: string | null
          keterangan?: string | null
          kode?: string | null
          kota?: string | null
          logo_url?: string | null
          nama?: string
          npsn?: string | null
          psb_dibuka?: boolean
          telepon?: string | null
        }
        Relationships: []
      }
      jadwal: {
        Row: {
          hari: string | null
          id: string
          jam_mulai: string | null
          jam_selesai: string | null
          kelas_id: string | null
          mapel_id: string | null
          pegawai_id: string | null
          ruangan: string | null
          semester_id: string | null
          tahun_ajaran_id: string | null
        }
        Insert: {
          hari?: string | null
          id?: string
          jam_mulai?: string | null
          jam_selesai?: string | null
          kelas_id?: string | null
          mapel_id?: string | null
          pegawai_id?: string | null
          ruangan?: string | null
          semester_id?: string | null
          tahun_ajaran_id?: string | null
        }
        Update: {
          hari?: string | null
          id?: string
          jam_mulai?: string | null
          jam_selesai?: string | null
          kelas_id?: string | null
          mapel_id?: string | null
          pegawai_id?: string | null
          ruangan?: string | null
          semester_id?: string | null
          tahun_ajaran_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jadwal_kelas_id_fkey"
            columns: ["kelas_id"]
            isOneToOne: false
            referencedRelation: "kelas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jadwal_mapel_id_fkey"
            columns: ["mapel_id"]
            isOneToOne: false
            referencedRelation: "mata_pelajaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jadwal_pegawai_id_fkey"
            columns: ["pegawai_id"]
            isOneToOne: false
            referencedRelation: "pegawai"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jadwal_semester_id_fkey"
            columns: ["semester_id"]
            isOneToOne: false
            referencedRelation: "semester"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jadwal_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "tahun_ajaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jadwal_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["tahun_ajaran_id"]
          },
        ]
      }
      jenis_pembayaran: {
        Row: {
          aktif: boolean | null
          akun_dimuka_id: string | null
          akun_pendapatan_id: string | null
          akun_potongan_id: string | null
          departemen_id: string | null
          hari_jatuh_tempo: number | null
          id: string
          keterangan: string | null
          nama: string
          nominal: number | null
          perlu_dimuka: boolean
          tahun_masuk_dari: number | null
          tahun_masuk_sampai: number | null
          tipe: string
        }
        Insert: {
          aktif?: boolean | null
          akun_dimuka_id?: string | null
          akun_pendapatan_id?: string | null
          akun_potongan_id?: string | null
          departemen_id?: string | null
          hari_jatuh_tempo?: number | null
          id?: string
          keterangan?: string | null
          nama: string
          nominal?: number | null
          perlu_dimuka?: boolean
          tahun_masuk_dari?: number | null
          tahun_masuk_sampai?: number | null
          tipe?: string
        }
        Update: {
          aktif?: boolean | null
          akun_dimuka_id?: string | null
          akun_pendapatan_id?: string | null
          akun_potongan_id?: string | null
          departemen_id?: string | null
          hari_jatuh_tempo?: number | null
          id?: string
          keterangan?: string | null
          nama?: string
          nominal?: number | null
          perlu_dimuka?: boolean
          tahun_masuk_dari?: number | null
          tahun_masuk_sampai?: number | null
          tipe?: string
        }
        Relationships: [
          {
            foreignKeyName: "jenis_pembayaran_akun_dimuka_id_fkey"
            columns: ["akun_dimuka_id"]
            isOneToOne: false
            referencedRelation: "akun_rekening"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jenis_pembayaran_akun_dimuka_id_fkey"
            columns: ["akun_dimuka_id"]
            isOneToOne: false
            referencedRelation: "v_saldo_akun_konsolidasi"
            referencedColumns: ["akun_id"]
          },
          {
            foreignKeyName: "jenis_pembayaran_akun_pendapatan_id_fkey"
            columns: ["akun_pendapatan_id"]
            isOneToOne: false
            referencedRelation: "akun_rekening"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jenis_pembayaran_akun_pendapatan_id_fkey"
            columns: ["akun_pendapatan_id"]
            isOneToOne: false
            referencedRelation: "v_saldo_akun_konsolidasi"
            referencedColumns: ["akun_id"]
          },
          {
            foreignKeyName: "jenis_pembayaran_akun_potongan_id_fkey"
            columns: ["akun_potongan_id"]
            isOneToOne: false
            referencedRelation: "akun_rekening"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jenis_pembayaran_akun_potongan_id_fkey"
            columns: ["akun_potongan_id"]
            isOneToOne: false
            referencedRelation: "v_saldo_akun_konsolidasi"
            referencedColumns: ["akun_id"]
          },
          {
            foreignKeyName: "jenis_pembayaran_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jenis_pembayaran_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekap_keuangan_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "jenis_pembayaran_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekon_antar_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "jenis_pembayaran_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["departemen_id"]
          },
        ]
      }
      jenis_pengeluaran: {
        Row: {
          aktif: boolean | null
          akun_beban_id: string | null
          created_at: string | null
          departemen_id: string | null
          id: string
          keterangan: string | null
          nama: string
        }
        Insert: {
          aktif?: boolean | null
          akun_beban_id?: string | null
          created_at?: string | null
          departemen_id?: string | null
          id?: string
          keterangan?: string | null
          nama: string
        }
        Update: {
          aktif?: boolean | null
          akun_beban_id?: string | null
          created_at?: string | null
          departemen_id?: string | null
          id?: string
          keterangan?: string | null
          nama?: string
        }
        Relationships: [
          {
            foreignKeyName: "jenis_pengeluaran_akun_beban_id_fkey"
            columns: ["akun_beban_id"]
            isOneToOne: false
            referencedRelation: "akun_rekening"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jenis_pengeluaran_akun_beban_id_fkey"
            columns: ["akun_beban_id"]
            isOneToOne: false
            referencedRelation: "v_saldo_akun_konsolidasi"
            referencedColumns: ["akun_id"]
          },
          {
            foreignKeyName: "jenis_pengeluaran_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jenis_pengeluaran_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekap_keuangan_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "jenis_pengeluaran_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekon_antar_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "jenis_pengeluaran_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["departemen_id"]
          },
        ]
      }
      jurnal: {
        Row: {
          created_at: string | null
          departemen_id: string | null
          dibuat_oleh: string | null
          id: string
          jurnal_asal_id: string | null
          keterangan: string
          nomor: string | null
          program_dana_id: string | null
          referensi: string | null
          status: string | null
          tanggal: string
          tipe: string | null
          total_debit: number | null
          total_kredit: number | null
        }
        Insert: {
          created_at?: string | null
          departemen_id?: string | null
          dibuat_oleh?: string | null
          id?: string
          jurnal_asal_id?: string | null
          keterangan: string
          nomor?: string | null
          program_dana_id?: string | null
          referensi?: string | null
          status?: string | null
          tanggal: string
          tipe?: string | null
          total_debit?: number | null
          total_kredit?: number | null
        }
        Update: {
          created_at?: string | null
          departemen_id?: string | null
          dibuat_oleh?: string | null
          id?: string
          jurnal_asal_id?: string | null
          keterangan?: string
          nomor?: string | null
          program_dana_id?: string | null
          referensi?: string | null
          status?: string | null
          tanggal?: string
          tipe?: string | null
          total_debit?: number | null
          total_kredit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "jurnal_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jurnal_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekap_keuangan_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "jurnal_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekon_antar_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "jurnal_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "jurnal_dibuat_oleh_fkey"
            columns: ["dibuat_oleh"]
            isOneToOne: false
            referencedRelation: "pegawai"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jurnal_jurnal_asal_id_fkey"
            columns: ["jurnal_asal_id"]
            isOneToOne: false
            referencedRelation: "jurnal"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jurnal_program_dana_id_fkey"
            columns: ["program_dana_id"]
            isOneToOne: false
            referencedRelation: "program_dana"
            referencedColumns: ["id"]
          },
        ]
      }
      jurnal_detail: {
        Row: {
          akun_id: string | null
          debit: number | null
          id: string
          jurnal_id: string | null
          keterangan: string | null
          kredit: number | null
          urutan: number | null
        }
        Insert: {
          akun_id?: string | null
          debit?: number | null
          id?: string
          jurnal_id?: string | null
          keterangan?: string | null
          kredit?: number | null
          urutan?: number | null
        }
        Update: {
          akun_id?: string | null
          debit?: number | null
          id?: string
          jurnal_id?: string | null
          keterangan?: string | null
          kredit?: number | null
          urutan?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "jurnal_detail_akun_id_fkey"
            columns: ["akun_id"]
            isOneToOne: false
            referencedRelation: "akun_rekening"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jurnal_detail_akun_id_fkey"
            columns: ["akun_id"]
            isOneToOne: false
            referencedRelation: "v_saldo_akun_konsolidasi"
            referencedColumns: ["akun_id"]
          },
          {
            foreignKeyName: "jurnal_detail_jurnal_id_fkey"
            columns: ["jurnal_id"]
            isOneToOne: false
            referencedRelation: "jurnal"
            referencedColumns: ["id"]
          },
        ]
      }
      konfigurasi_pmb: {
        Row: {
          created_at: string
          departemen_id: string
          jenis_pembayaran_id: string
          pembayaran_online_aktif: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          departemen_id: string
          jenis_pembayaran_id: string
          pembayaran_online_aktif?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          departemen_id?: string
          jenis_pembayaran_id?: string
          pembayaran_online_aktif?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "konfigurasi_pmb_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: true
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "konfigurasi_pmb_jenis_pembayaran_id_fkey"
            columns: ["jenis_pembayaran_id"]
            isOneToOne: false
            referencedRelation: "jenis_pembayaran"
            referencedColumns: ["id"]
          },
        ]
      }
      kalender_akademik: {
        Row: {
          created_at: string | null
          departemen_id: string | null
          deskripsi: string | null
          id: string
          judul: string
          kategori: string | null
          tahun_ajaran_id: string | null
          tanggal_mulai: string
          tanggal_selesai: string | null
          warna: string | null
        }
        Insert: {
          created_at?: string | null
          departemen_id?: string | null
          deskripsi?: string | null
          id?: string
          judul: string
          kategori?: string | null
          tahun_ajaran_id?: string | null
          tanggal_mulai: string
          tanggal_selesai?: string | null
          warna?: string | null
        }
        Update: {
          created_at?: string | null
          departemen_id?: string | null
          deskripsi?: string | null
          id?: string
          judul?: string
          kategori?: string | null
          tahun_ajaran_id?: string | null
          tanggal_mulai?: string
          tanggal_selesai?: string | null
          warna?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kalender_akademik_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kalender_akademik_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekap_keuangan_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "kalender_akademik_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekon_antar_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "kalender_akademik_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "kalender_akademik_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "tahun_ajaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kalender_akademik_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["tahun_ajaran_id"]
          },
        ]
      }
      kas_kecil_setting: {
        Row: {
          akun_kas_kecil_id: string | null
          akun_pengisian_id: string | null
          dana_imprest: number
          id: string
          keterangan: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          akun_kas_kecil_id?: string | null
          akun_pengisian_id?: string | null
          dana_imprest?: number
          id?: string
          keterangan?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          akun_kas_kecil_id?: string | null
          akun_pengisian_id?: string | null
          dana_imprest?: number
          id?: string
          keterangan?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kas_kecil_setting_akun_kas_kecil_id_fkey"
            columns: ["akun_kas_kecil_id"]
            isOneToOne: false
            referencedRelation: "akun_rekening"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kas_kecil_setting_akun_kas_kecil_id_fkey"
            columns: ["akun_kas_kecil_id"]
            isOneToOne: false
            referencedRelation: "v_saldo_akun_konsolidasi"
            referencedColumns: ["akun_id"]
          },
          {
            foreignKeyName: "kas_kecil_setting_akun_pengisian_id_fkey"
            columns: ["akun_pengisian_id"]
            isOneToOne: false
            referencedRelation: "akun_rekening"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kas_kecil_setting_akun_pengisian_id_fkey"
            columns: ["akun_pengisian_id"]
            isOneToOne: false
            referencedRelation: "v_saldo_akun_konsolidasi"
            referencedColumns: ["akun_id"]
          },
        ]
      }
      kelas: {
        Row: {
          aktif: boolean | null
          departemen_id: string | null
          id: string
          kapasitas: number | null
          nama: string
          tingkat_id: string | null
          wali_kelas_id: string | null
        }
        Insert: {
          aktif?: boolean | null
          departemen_id?: string | null
          id?: string
          kapasitas?: number | null
          nama: string
          tingkat_id?: string | null
          wali_kelas_id?: string | null
        }
        Update: {
          aktif?: boolean | null
          departemen_id?: string | null
          id?: string
          kapasitas?: number | null
          nama?: string
          tingkat_id?: string | null
          wali_kelas_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_wali_kelas"
            columns: ["wali_kelas_id"]
            isOneToOne: false
            referencedRelation: "pegawai"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kelas_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kelas_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekap_keuangan_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "kelas_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekon_antar_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "kelas_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "kelas_tingkat_id_fkey"
            columns: ["tingkat_id"]
            isOneToOne: false
            referencedRelation: "tingkat"
            referencedColumns: ["id"]
          },
        ]
      }
      kelas_siswa: {
        Row: {
          aktif: boolean | null
          id: string
          kelas_id: string | null
          siswa_id: string | null
          tahun_ajaran_id: string | null
        }
        Insert: {
          aktif?: boolean | null
          id?: string
          kelas_id?: string | null
          siswa_id?: string | null
          tahun_ajaran_id?: string | null
        }
        Update: {
          aktif?: boolean | null
          id?: string
          kelas_id?: string | null
          siswa_id?: string | null
          tahun_ajaran_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kelas_siswa_kelas_id_fkey"
            columns: ["kelas_id"]
            isOneToOne: false
            referencedRelation: "kelas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kelas_siswa_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: false
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kelas_siswa_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "tahun_ajaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kelas_siswa_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["tahun_ajaran_id"]
          },
        ]
      }
      keluarga: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          keterangan: string | null
          nama: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          keterangan?: string | null
          nama: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          keterangan?: string | null
          nama?: string
        }
        Relationships: []
      }
      keluarga_pegawai: {
        Row: {
          hubungan: string
          id: string
          jenis_kelamin: string | null
          keterangan: string | null
          nama: string
          pegawai_id: string | null
          pekerjaan: string | null
          tanggal_lahir: string | null
        }
        Insert: {
          hubungan: string
          id?: string
          jenis_kelamin?: string | null
          keterangan?: string | null
          nama: string
          pegawai_id?: string | null
          pekerjaan?: string | null
          tanggal_lahir?: string | null
        }
        Update: {
          hubungan?: string
          id?: string
          jenis_kelamin?: string | null
          keterangan?: string | null
          nama?: string
          pegawai_id?: string | null
          pekerjaan?: string | null
          tanggal_lahir?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "keluarga_pegawai_pegawai_id_fkey"
            columns: ["pegawai_id"]
            isOneToOne: false
            referencedRelation: "pegawai"
            referencedColumns: ["id"]
          },
        ]
      }
      kkm: {
        Row: {
          id: string
          kelas_id: string | null
          mapel_id: string | null
          nilai_kkm: number | null
          semester_id: string | null
          tahun_ajaran_id: string | null
        }
        Insert: {
          id?: string
          kelas_id?: string | null
          mapel_id?: string | null
          nilai_kkm?: number | null
          semester_id?: string | null
          tahun_ajaran_id?: string | null
        }
        Update: {
          id?: string
          kelas_id?: string | null
          mapel_id?: string | null
          nilai_kkm?: number | null
          semester_id?: string | null
          tahun_ajaran_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kkm_kelas_id_fkey"
            columns: ["kelas_id"]
            isOneToOne: false
            referencedRelation: "kelas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kkm_mapel_id_fkey"
            columns: ["mapel_id"]
            isOneToOne: false
            referencedRelation: "mata_pelajaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kkm_semester_id_fkey"
            columns: ["semester_id"]
            isOneToOne: false
            referencedRelation: "semester"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kkm_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "tahun_ajaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kkm_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["tahun_ajaran_id"]
          },
        ]
      }
      koleksi_buku: {
        Row: {
          aktif: boolean | null
          created_at: string | null
          deskripsi: string | null
          foto_url: string | null
          id: string
          isbn: string | null
          judul: string
          jumlah_tersedia: number | null
          jumlah_total: number | null
          kategori: string | null
          kode: string | null
          lokasi: string | null
          penerbit: string | null
          pengarang: string | null
          tahun_terbit: number | null
        }
        Insert: {
          aktif?: boolean | null
          created_at?: string | null
          deskripsi?: string | null
          foto_url?: string | null
          id?: string
          isbn?: string | null
          judul: string
          jumlah_tersedia?: number | null
          jumlah_total?: number | null
          kategori?: string | null
          kode?: string | null
          lokasi?: string | null
          penerbit?: string | null
          pengarang?: string | null
          tahun_terbit?: number | null
        }
        Update: {
          aktif?: boolean | null
          created_at?: string | null
          deskripsi?: string | null
          foto_url?: string | null
          id?: string
          isbn?: string | null
          judul?: string
          jumlah_tersedia?: number | null
          jumlah_total?: number | null
          kategori?: string | null
          kode?: string | null
          lokasi?: string | null
          penerbit?: string | null
          pengarang?: string | null
          tahun_terbit?: number | null
        }
        Relationships: []
      }
      komentar_rapor: {
        Row: {
          catatan_piket: string | null
          created_at: string | null
          id: string
          kelas_id: string | null
          komentar_kepala: string | null
          komentar_wali: string | null
          semester_id: string | null
          siswa_id: string
          tahun_ajaran_id: string | null
        }
        Insert: {
          catatan_piket?: string | null
          created_at?: string | null
          id?: string
          kelas_id?: string | null
          komentar_kepala?: string | null
          komentar_wali?: string | null
          semester_id?: string | null
          siswa_id: string
          tahun_ajaran_id?: string | null
        }
        Update: {
          catatan_piket?: string | null
          created_at?: string | null
          id?: string
          kelas_id?: string | null
          komentar_kepala?: string | null
          komentar_wali?: string | null
          semester_id?: string | null
          siswa_id?: string
          tahun_ajaran_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "komentar_rapor_kelas_id_fkey"
            columns: ["kelas_id"]
            isOneToOne: false
            referencedRelation: "kelas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "komentar_rapor_semester_id_fkey"
            columns: ["semester_id"]
            isOneToOne: false
            referencedRelation: "semester"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "komentar_rapor_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: false
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "komentar_rapor_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "tahun_ajaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "komentar_rapor_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["tahun_ajaran_id"]
          },
        ]
      }
      kompetensi_dasar: {
        Row: {
          aktif: boolean | null
          deskripsi: string
          id: string
          kode_kd: string
          mapel_id: string | null
          semester_id: string | null
          urutan: number | null
        }
        Insert: {
          aktif?: boolean | null
          deskripsi: string
          id?: string
          kode_kd: string
          mapel_id?: string | null
          semester_id?: string | null
          urutan?: number | null
        }
        Update: {
          aktif?: boolean | null
          deskripsi?: string
          id?: string
          kode_kd?: string
          mapel_id?: string | null
          semester_id?: string | null
          urutan?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "kompetensi_dasar_mapel_id_fkey"
            columns: ["mapel_id"]
            isOneToOne: false
            referencedRelation: "mata_pelajaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kompetensi_dasar_semester_id_fkey"
            columns: ["semester_id"]
            isOneToOne: false
            referencedRelation: "semester"
            referencedColumns: ["id"]
          },
        ]
      }
      log_tutup_buku: {
        Row: {
          id: string
          jurnal_id: string | null
          keterangan: string | null
          tahun_ajaran_id: string | null
          tahun_buku_id: string | null
          tanggal_proses: string
          total_laba_rugi: number
          unit: string | null
          user_id: string | null
        }
        Insert: {
          id?: string
          jurnal_id?: string | null
          keterangan?: string | null
          tahun_ajaran_id?: string | null
          tahun_buku_id?: string | null
          tanggal_proses?: string
          total_laba_rugi?: number
          unit?: string | null
          user_id?: string | null
        }
        Update: {
          id?: string
          jurnal_id?: string | null
          keterangan?: string | null
          tahun_ajaran_id?: string | null
          tahun_buku_id?: string | null
          tanggal_proses?: string
          total_laba_rugi?: number
          unit?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "log_tutup_buku_jurnal_id_fkey"
            columns: ["jurnal_id"]
            isOneToOne: false
            referencedRelation: "jurnal"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "log_tutup_buku_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "tahun_buku"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "log_tutup_buku_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "v_status_tutup_buku"
            referencedColumns: ["tahun_buku_id"]
          },
          {
            foreignKeyName: "log_tutup_buku_tahun_buku_id_fkey"
            columns: ["tahun_buku_id"]
            isOneToOne: false
            referencedRelation: "tahun_buku"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "log_tutup_buku_tahun_buku_id_fkey"
            columns: ["tahun_buku_id"]
            isOneToOne: false
            referencedRelation: "v_status_tutup_buku"
            referencedColumns: ["tahun_buku_id"]
          },
        ]
      }
      mata_pelajaran: {
        Row: {
          aktif: boolean | null
          departemen_id: string | null
          id: string
          keterangan: string | null
          kode: string | null
          nama: string
          tingkat_id: string | null
        }
        Insert: {
          aktif?: boolean | null
          departemen_id?: string | null
          id?: string
          keterangan?: string | null
          kode?: string | null
          nama: string
          tingkat_id?: string | null
        }
        Update: {
          aktif?: boolean | null
          departemen_id?: string | null
          id?: string
          keterangan?: string | null
          kode?: string | null
          nama?: string
          tingkat_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mata_pelajaran_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mata_pelajaran_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekap_keuangan_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "mata_pelajaran_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekon_antar_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "mata_pelajaran_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "mata_pelajaran_tingkat_id_fkey"
            columns: ["tingkat_id"]
            isOneToOne: false
            referencedRelation: "tingkat"
            referencedColumns: ["id"]
          },
        ]
      }
      nilai_kd: {
        Row: {
          id: string
          kd_id: string | null
          kelas_id: string | null
          keterangan: string | null
          nilai: number | null
          semester_id: string | null
          siswa_id: string | null
          tahun_ajaran_id: string | null
        }
        Insert: {
          id?: string
          kd_id?: string | null
          kelas_id?: string | null
          keterangan?: string | null
          nilai?: number | null
          semester_id?: string | null
          siswa_id?: string | null
          tahun_ajaran_id?: string | null
        }
        Update: {
          id?: string
          kd_id?: string | null
          kelas_id?: string | null
          keterangan?: string | null
          nilai?: number | null
          semester_id?: string | null
          siswa_id?: string | null
          tahun_ajaran_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nilai_kd_kd_id_fkey"
            columns: ["kd_id"]
            isOneToOne: false
            referencedRelation: "kompetensi_dasar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nilai_kd_kelas_id_fkey"
            columns: ["kelas_id"]
            isOneToOne: false
            referencedRelation: "kelas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nilai_kd_semester_id_fkey"
            columns: ["semester_id"]
            isOneToOne: false
            referencedRelation: "semester"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nilai_kd_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: false
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nilai_kd_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "tahun_ajaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nilai_kd_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["tahun_ajaran_id"]
          },
        ]
      }
      notifikasi_ortu: {
        Row: {
          created_at: string | null
          dibaca: boolean | null
          id: string
          judul: string
          pesan: string
          siswa_id: string | null
          tipe: string | null
          url: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          dibaca?: boolean | null
          id?: string
          judul: string
          pesan: string
          siswa_id?: string | null
          tipe?: string | null
          url?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          dibaca?: boolean | null
          id?: string
          judul?: string
          pesan?: string
          siswa_id?: string | null
          tipe?: string | null
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifikasi_ortu_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: false
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifikasi_ortu_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_profile"
            referencedColumns: ["id"]
          },
        ]
      }
      ortu_siswa: {
        Row: {
          created_at: string | null
          hubungan: string | null
          id: string
          is_primary: boolean | null
          siswa_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          hubungan?: string | null
          id?: string
          is_primary?: boolean | null
          siswa_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          hubungan?: string | null
          id?: string
          is_primary?: boolean | null
          siswa_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ortu_siswa_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: false
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ortu_siswa_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_profile"
            referencedColumns: ["id"]
          },
        ]
      }
      pegawai: {
        Row: {
          agama: string | null
          alamat: string | null
          created_at: string | null
          departemen_id: string | null
          email: string | null
          foto_url: string | null
          golongan_terakhir: string | null
          id: string
          jabatan: string | null
          jenis_kelamin: string | null
          nama: string
          nip: string | null
          status: string | null
          tanggal_lahir: string | null
          tanggal_masuk: string | null
          tanggal_pensiun: string | null
          telepon: string | null
          tempat_lahir: string | null
        }
        Insert: {
          agama?: string | null
          alamat?: string | null
          created_at?: string | null
          departemen_id?: string | null
          email?: string | null
          foto_url?: string | null
          golongan_terakhir?: string | null
          id?: string
          jabatan?: string | null
          jenis_kelamin?: string | null
          nama: string
          nip?: string | null
          status?: string | null
          tanggal_lahir?: string | null
          tanggal_masuk?: string | null
          tanggal_pensiun?: string | null
          telepon?: string | null
          tempat_lahir?: string | null
        }
        Update: {
          agama?: string | null
          alamat?: string | null
          created_at?: string | null
          departemen_id?: string | null
          email?: string | null
          foto_url?: string | null
          golongan_terakhir?: string | null
          id?: string
          jabatan?: string | null
          jenis_kelamin?: string | null
          nama?: string
          nip?: string | null
          status?: string | null
          tanggal_lahir?: string | null
          tanggal_masuk?: string | null
          tanggal_pensiun?: string | null
          telepon?: string | null
          tempat_lahir?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pegawai_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pegawai_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekap_keuangan_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "pegawai_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekon_antar_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "pegawai_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["departemen_id"]
          },
        ]
      }
      pegawai_nik: {
        Row: { pegawai_id: string; nik: string; updated_at: string; updated_by: string | null }
        Insert: { pegawai_id: string; nik: string; updated_at?: string; updated_by?: string | null }
        Update: { pegawai_id?: string; nik?: string; updated_at?: string; updated_by?: string | null }
        Relationships: [{
          foreignKeyName: "pegawai_nik_pegawai_id_fkey"
          columns: ["pegawai_id"]
          isOneToOne: true
          referencedRelation: "pegawai"
          referencedColumns: ["id"]
        }]
      }
      pegawai_mapel: {
        Row: {
          id: string
          mapel_id: string | null
          pegawai_id: string | null
        }
        Insert: {
          id?: string
          mapel_id?: string | null
          pegawai_id?: string | null
        }
        Update: {
          id?: string
          mapel_id?: string | null
          pegawai_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pegawai_mapel_mapel_id_fkey"
            columns: ["mapel_id"]
            isOneToOne: false
            referencedRelation: "mata_pelajaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pegawai_mapel_pegawai_id_fkey"
            columns: ["pegawai_id"]
            isOneToOne: false
            referencedRelation: "pegawai"
            referencedColumns: ["id"]
          },
        ]
      }
      pembayaran: {
        Row: {
          spp_kategori: string | null
          bulan: number | null
          departemen_id: string | null
          id: string
          jenis_id: string | null
          jumlah: number | null
          jurnal_id: string | null
          keterangan: string | null
          petugas_id: string | null
          siswa_id: string | null
          tagihan_id: string | null
          tahun_ajaran_id: string | null
          tanggal_bayar: string | null
        }
        Insert: {
          spp_kategori?: string | null
          bulan?: number | null
          departemen_id?: string | null
          id?: string
          jenis_id?: string | null
          jumlah?: number | null
          jurnal_id?: string | null
          keterangan?: string | null
          petugas_id?: string | null
          siswa_id?: string | null
          tagihan_id?: string | null
          tahun_ajaran_id?: string | null
          tanggal_bayar?: string | null
        }
        Update: {
          spp_kategori?: string | null
          bulan?: number | null
          departemen_id?: string | null
          id?: string
          jenis_id?: string | null
          jumlah?: number | null
          jurnal_id?: string | null
          keterangan?: string | null
          petugas_id?: string | null
          siswa_id?: string | null
          tagihan_id?: string | null
          tahun_ajaran_id?: string | null
          tanggal_bayar?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pembayaran_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pembayaran_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekap_keuangan_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "pembayaran_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekon_antar_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "pembayaran_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "pembayaran_jenis_id_fkey"
            columns: ["jenis_id"]
            isOneToOne: false
            referencedRelation: "jenis_pembayaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pembayaran_jenis_id_fkey"
            columns: ["jenis_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["jenis_id"]
          },
          {
            foreignKeyName: "pembayaran_jurnal_id_fkey"
            columns: ["jurnal_id"]
            isOneToOne: false
            referencedRelation: "jurnal"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pembayaran_petugas_id_fkey"
            columns: ["petugas_id"]
            isOneToOne: false
            referencedRelation: "pegawai"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pembayaran_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: false
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pembayaran_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "tahun_buku"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pembayaran_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "v_status_tutup_buku"
            referencedColumns: ["tahun_buku_id"]
          },
        ]
      }
      peminjaman: {
        Row: {
          created_at: string | null
          denda: number | null
          id: string
          keterangan: string | null
          koleksi_id: string | null
          peminjam_id: string
          peminjam_tipe: string | null
          petugas_id: string | null
          status: string | null
          tanggal_kembali_aktual: string | null
          tanggal_kembali_rencana: string
          tanggal_pinjam: string
        }
        Insert: {
          created_at?: string | null
          denda?: number | null
          id?: string
          keterangan?: string | null
          koleksi_id?: string | null
          peminjam_id: string
          peminjam_tipe?: string | null
          petugas_id?: string | null
          status?: string | null
          tanggal_kembali_aktual?: string | null
          tanggal_kembali_rencana: string
          tanggal_pinjam?: string
        }
        Update: {
          created_at?: string | null
          denda?: number | null
          id?: string
          keterangan?: string | null
          koleksi_id?: string | null
          peminjam_id?: string
          peminjam_tipe?: string | null
          petugas_id?: string | null
          status?: string | null
          tanggal_kembali_aktual?: string | null
          tanggal_kembali_rencana?: string
          tanggal_pinjam?: string
        }
        Relationships: [
          {
            foreignKeyName: "peminjaman_koleksi_id_fkey"
            columns: ["koleksi_id"]
            isOneToOne: false
            referencedRelation: "koleksi_buku"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "peminjaman_petugas_id_fkey"
            columns: ["petugas_id"]
            isOneToOne: false
            referencedRelation: "pegawai"
            referencedColumns: ["id"]
          },
        ]
      }
      pendapatan_dimuka: {
        Row: {
          bulan: number | null
          created_at: string
          departemen_id: string | null
          id: string
          jenis_id: string
          jumlah: number
          jurnal_pengakuan_id: string | null
          pembayaran_id: string
          siswa_id: string
          status: string
          tahun_ajaran_pembayaran_id: string
          tahun_ajaran_target_id: string
          tanggal_pengakuan: string | null
        }
        Insert: {
          bulan?: number | null
          created_at?: string
          departemen_id?: string | null
          id?: string
          jenis_id: string
          jumlah?: number
          jurnal_pengakuan_id?: string | null
          pembayaran_id: string
          siswa_id: string
          status?: string
          tahun_ajaran_pembayaran_id: string
          tahun_ajaran_target_id: string
          tanggal_pengakuan?: string | null
        }
        Update: {
          bulan?: number | null
          created_at?: string
          departemen_id?: string | null
          id?: string
          jenis_id?: string
          jumlah?: number
          jurnal_pengakuan_id?: string | null
          pembayaran_id?: string
          siswa_id?: string
          status?: string
          tahun_ajaran_pembayaran_id?: string
          tahun_ajaran_target_id?: string
          tanggal_pengakuan?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pendapatan_dimuka_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pendapatan_dimuka_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekap_keuangan_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "pendapatan_dimuka_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekon_antar_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "pendapatan_dimuka_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "pendapatan_dimuka_jenis_id_fkey"
            columns: ["jenis_id"]
            isOneToOne: false
            referencedRelation: "jenis_pembayaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pendapatan_dimuka_jenis_id_fkey"
            columns: ["jenis_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["jenis_id"]
          },
          {
            foreignKeyName: "pendapatan_dimuka_jurnal_pengakuan_id_fkey"
            columns: ["jurnal_pengakuan_id"]
            isOneToOne: false
            referencedRelation: "jurnal"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pendapatan_dimuka_pembayaran_id_fkey"
            columns: ["pembayaran_id"]
            isOneToOne: false
            referencedRelation: "pembayaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pendapatan_dimuka_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: false
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pendapatan_dimuka_tahun_ajaran_pembayaran_id_fkey"
            columns: ["tahun_ajaran_pembayaran_id"]
            isOneToOne: false
            referencedRelation: "tahun_buku"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pendapatan_dimuka_tahun_ajaran_pembayaran_id_fkey"
            columns: ["tahun_ajaran_pembayaran_id"]
            isOneToOne: false
            referencedRelation: "v_status_tutup_buku"
            referencedColumns: ["tahun_buku_id"]
          },
          {
            foreignKeyName: "pendapatan_dimuka_tahun_ajaran_target_id_fkey"
            columns: ["tahun_ajaran_target_id"]
            isOneToOne: false
            referencedRelation: "tahun_buku"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pendapatan_dimuka_tahun_ajaran_target_id_fkey"
            columns: ["tahun_ajaran_target_id"]
            isOneToOne: false
            referencedRelation: "v_status_tutup_buku"
            referencedColumns: ["tahun_buku_id"]
          },
        ]
      }
      pengaturan_akun: {
        Row: {
          akun_id: string | null
          id: string
          keterangan: string | null
          kode_setting: string
          label: string
          updated_at: string | null
        }
        Insert: {
          akun_id?: string | null
          id?: string
          keterangan?: string | null
          kode_setting: string
          label: string
          updated_at?: string | null
        }
        Update: {
          akun_id?: string | null
          id?: string
          keterangan?: string | null
          kode_setting?: string
          label?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pengaturan_akun_akun_id_fkey"
            columns: ["akun_id"]
            isOneToOne: false
            referencedRelation: "akun_rekening"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pengaturan_akun_akun_id_fkey"
            columns: ["akun_id"]
            isOneToOne: false
            referencedRelation: "v_saldo_akun_konsolidasi"
            referencedColumns: ["akun_id"]
          },
        ]
      }
      pengaturan_template: {
        Row: {
          id: string
          keterangan: string | null
          kode_template: string
          label: string
          template: string
          updated_at: string | null
        }
        Insert: {
          id?: string
          keterangan?: string | null
          kode_template: string
          label: string
          template?: string
          updated_at?: string | null
        }
        Update: {
          id?: string
          keterangan?: string | null
          kode_template?: string
          label?: string
          template?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      pengeluaran: {
        Row: {
          created_at: string | null
          departemen_id: string | null
          id: string
          jenis_id: string | null
          jumlah: number
          jurnal_id: string | null
          keterangan: string | null
          petugas_id: string | null
          tanggal: string
        }
        Insert: {
          created_at?: string | null
          departemen_id?: string | null
          id?: string
          jenis_id?: string | null
          jumlah: number
          jurnal_id?: string | null
          keterangan?: string | null
          petugas_id?: string | null
          tanggal: string
        }
        Update: {
          created_at?: string | null
          departemen_id?: string | null
          id?: string
          jenis_id?: string | null
          jumlah?: number
          jurnal_id?: string | null
          keterangan?: string | null
          petugas_id?: string | null
          tanggal?: string
        }
        Relationships: [
          {
            foreignKeyName: "pengeluaran_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pengeluaran_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekap_keuangan_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "pengeluaran_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekon_antar_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "pengeluaran_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "pengeluaran_jenis_id_fkey"
            columns: ["jenis_id"]
            isOneToOne: false
            referencedRelation: "jenis_pengeluaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pengeluaran_jurnal_id_fkey"
            columns: ["jurnal_id"]
            isOneToOne: false
            referencedRelation: "jurnal"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pengeluaran_petugas_id_fkey"
            columns: ["petugas_id"]
            isOneToOne: false
            referencedRelation: "pegawai"
            referencedColumns: ["id"]
          },
        ]
      }
      pengumuman: {
        Row: {
          aktif: boolean | null
          created_at: string | null
          departemen_id: string | null
          id: string
          judul: string
          kategori: string | null
          konten: string
          lampiran_nama: string | null
          lampiran_url: string | null
          penting: boolean | null
          penulis_id: string | null
          tanggal_kadaluarsa: string | null
          tanggal_tayang: string | null
          target_id: string | null
          target_tipe: string | null
        }
        Insert: {
          aktif?: boolean | null
          created_at?: string | null
          departemen_id?: string | null
          id?: string
          judul: string
          kategori?: string | null
          konten: string
          lampiran_nama?: string | null
          lampiran_url?: string | null
          penting?: boolean | null
          penulis_id?: string | null
          tanggal_kadaluarsa?: string | null
          tanggal_tayang?: string | null
          target_id?: string | null
          target_tipe?: string | null
        }
        Update: {
          aktif?: boolean | null
          created_at?: string | null
          departemen_id?: string | null
          id?: string
          judul?: string
          kategori?: string | null
          konten?: string
          lampiran_nama?: string | null
          lampiran_url?: string | null
          penting?: boolean | null
          penulis_id?: string | null
          tanggal_kadaluarsa?: string | null
          tanggal_tayang?: string | null
          target_id?: string | null
          target_tipe?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pengumuman_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pengumuman_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekap_keuangan_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "pengumuman_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekon_antar_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "pengumuman_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "pengumuman_penulis_id_fkey"
            columns: ["penulis_id"]
            isOneToOne: false
            referencedRelation: "users_profile"
            referencedColumns: ["id"]
          },
        ]
      }
      penilaian: {
        Row: {
          id: string
          jenis_ujian: string | null
          kelas_id: string | null
          keterangan: string | null
          mapel_id: string | null
          nilai: number | null
          semester_id: string | null
          siswa_id: string | null
          tahun_ajaran_id: string | null
        }
        Insert: {
          id?: string
          jenis_ujian?: string | null
          kelas_id?: string | null
          keterangan?: string | null
          mapel_id?: string | null
          nilai?: number | null
          semester_id?: string | null
          siswa_id?: string | null
          tahun_ajaran_id?: string | null
        }
        Update: {
          id?: string
          jenis_ujian?: string | null
          kelas_id?: string | null
          keterangan?: string | null
          mapel_id?: string | null
          nilai?: number | null
          semester_id?: string | null
          siswa_id?: string | null
          tahun_ajaran_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "penilaian_kelas_id_fkey"
            columns: ["kelas_id"]
            isOneToOne: false
            referencedRelation: "kelas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "penilaian_mapel_id_fkey"
            columns: ["mapel_id"]
            isOneToOne: false
            referencedRelation: "mata_pelajaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "penilaian_semester_id_fkey"
            columns: ["semester_id"]
            isOneToOne: false
            referencedRelation: "semester"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "penilaian_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: false
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "penilaian_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "tahun_ajaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "penilaian_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["tahun_ajaran_id"]
          },
        ]
      }
      penyisihan_piutang: {
        Row: {
          created_at: string
          departemen_id: string | null
          dibuat_oleh: string | null
          id: string
          jurnal_id: string | null
          keterangan: string | null
          metode: string
          nominal: number
          persentase: number | null
          tahun_ajaran_id: string | null
          tanggal: string
        }
        Insert: {
          created_at?: string
          departemen_id?: string | null
          dibuat_oleh?: string | null
          id?: string
          jurnal_id?: string | null
          keterangan?: string | null
          metode?: string
          nominal?: number
          persentase?: number | null
          tahun_ajaran_id?: string | null
          tanggal: string
        }
        Update: {
          created_at?: string
          departemen_id?: string | null
          dibuat_oleh?: string | null
          id?: string
          jurnal_id?: string | null
          keterangan?: string | null
          metode?: string
          nominal?: number
          persentase?: number | null
          tahun_ajaran_id?: string | null
          tanggal?: string
        }
        Relationships: [
          {
            foreignKeyName: "penyisihan_piutang_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "penyisihan_piutang_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekap_keuangan_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "penyisihan_piutang_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekon_antar_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "penyisihan_piutang_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "penyisihan_piutang_jurnal_id_fkey"
            columns: ["jurnal_id"]
            isOneToOne: false
            referencedRelation: "jurnal"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "penyisihan_piutang_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "tahun_buku"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "penyisihan_piutang_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "v_status_tutup_buku"
            referencedColumns: ["tahun_buku_id"]
          },
        ]
      }
      perangkat_push_ortu: {
        Row: {
          created_at: string
          device_name: string | null
          expo_push_token: string
          id: string
          platform: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_name?: string | null
          expo_push_token: string
          id?: string
          platform?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_name?: string | null
          expo_push_token?: string
          id?: string
          platform?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "perangkat_push_ortu_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_profile"
            referencedColumns: ["id"]
          },
        ]
      }
      presensi_kbm: {
        Row: {
          id: string
          jam_ke: number | null
          kelas_id: string | null
          keterangan: string | null
          mapel_id: string | null
          pegawai_id: string | null
          semester_id: string | null
          siswa_id: string | null
          status: string | null
          tahun_ajaran_id: string | null
          tanggal: string
        }
        Insert: {
          id?: string
          jam_ke?: number | null
          kelas_id?: string | null
          keterangan?: string | null
          mapel_id?: string | null
          pegawai_id?: string | null
          semester_id?: string | null
          siswa_id?: string | null
          status?: string | null
          tahun_ajaran_id?: string | null
          tanggal: string
        }
        Update: {
          id?: string
          jam_ke?: number | null
          kelas_id?: string | null
          keterangan?: string | null
          mapel_id?: string | null
          pegawai_id?: string | null
          semester_id?: string | null
          siswa_id?: string | null
          status?: string | null
          tahun_ajaran_id?: string | null
          tanggal?: string
        }
        Relationships: [
          {
            foreignKeyName: "presensi_kbm_kelas_id_fkey"
            columns: ["kelas_id"]
            isOneToOne: false
            referencedRelation: "kelas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presensi_kbm_mapel_id_fkey"
            columns: ["mapel_id"]
            isOneToOne: false
            referencedRelation: "mata_pelajaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presensi_kbm_pegawai_id_fkey"
            columns: ["pegawai_id"]
            isOneToOne: false
            referencedRelation: "pegawai"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presensi_kbm_semester_id_fkey"
            columns: ["semester_id"]
            isOneToOne: false
            referencedRelation: "semester"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presensi_kbm_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: false
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presensi_kbm_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "tahun_ajaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presensi_kbm_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["tahun_ajaran_id"]
          },
        ]
      }
      presensi_pegawai: {
        Row: {
          created_at: string | null
          departemen_id: string | null
          dicatat_oleh: string | null
          id: string
          jam_masuk: string | null
          jam_pulang: string | null
          keterangan: string | null
          pegawai_id: string
          status: string
          tanggal: string
        }
        Insert: {
          created_at?: string | null
          departemen_id?: string | null
          dicatat_oleh?: string | null
          id?: string
          jam_masuk?: string | null
          jam_pulang?: string | null
          keterangan?: string | null
          pegawai_id: string
          status?: string
          tanggal: string
        }
        Update: {
          created_at?: string | null
          departemen_id?: string | null
          dicatat_oleh?: string | null
          id?: string
          jam_masuk?: string | null
          jam_pulang?: string | null
          keterangan?: string | null
          pegawai_id?: string
          status?: string
          tanggal?: string
        }
        Relationships: [
          {
            foreignKeyName: "presensi_pegawai_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presensi_pegawai_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekap_keuangan_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "presensi_pegawai_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekon_antar_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "presensi_pegawai_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "presensi_pegawai_dicatat_oleh_fkey"
            columns: ["dicatat_oleh"]
            isOneToOne: false
            referencedRelation: "pegawai"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presensi_pegawai_pegawai_id_fkey"
            columns: ["pegawai_id"]
            isOneToOne: false
            referencedRelation: "pegawai"
            referencedColumns: ["id"]
          },
        ]
      }
      presensi_siswa: {
        Row: {
          id: string
          kelas_id: string | null
          keterangan: string | null
          pegawai_id: string | null
          semester_id: string | null
          siswa_id: string | null
          status: string | null
          tahun_ajaran_id: string | null
          tanggal: string
        }
        Insert: {
          id?: string
          kelas_id?: string | null
          keterangan?: string | null
          pegawai_id?: string | null
          semester_id?: string | null
          siswa_id?: string | null
          status?: string | null
          tahun_ajaran_id?: string | null
          tanggal: string
        }
        Update: {
          id?: string
          kelas_id?: string | null
          keterangan?: string | null
          pegawai_id?: string | null
          semester_id?: string | null
          siswa_id?: string | null
          status?: string | null
          tahun_ajaran_id?: string | null
          tanggal?: string
        }
        Relationships: [
          {
            foreignKeyName: "presensi_siswa_kelas_id_fkey"
            columns: ["kelas_id"]
            isOneToOne: false
            referencedRelation: "kelas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presensi_siswa_pegawai_id_fkey"
            columns: ["pegawai_id"]
            isOneToOne: false
            referencedRelation: "pegawai"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presensi_siswa_semester_id_fkey"
            columns: ["semester_id"]
            isOneToOne: false
            referencedRelation: "semester"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presensi_siswa_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: false
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presensi_siswa_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "tahun_ajaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presensi_siswa_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["tahun_ajaran_id"]
          },
        ]
      }
      program_dana: {
        Row: {
          aktif: boolean
          created_at: string | null
          id: string
          jenis_dana: string
          keterangan: string | null
          kode: string
          nama: string
        }
        Insert: {
          aktif?: boolean
          created_at?: string | null
          id?: string
          jenis_dana: string
          keterangan?: string | null
          kode: string
          nama: string
        }
        Update: {
          aktif?: boolean
          created_at?: string | null
          id?: string
          jenis_dana?: string
          keterangan?: string | null
          kode?: string
          nama?: string
        }
        Relationships: []
      }
      remedial: {
        Row: {
          created_at: string | null
          id: string
          jenis: string
          kd_id: string
          kelas_id: string | null
          keterangan: string | null
          nilai_awal: number | null
          nilai_remedial: number | null
          semester_id: string | null
          siswa_id: string
          status: string | null
          tahun_ajaran_id: string | null
          tanggal: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          jenis?: string
          kd_id: string
          kelas_id?: string | null
          keterangan?: string | null
          nilai_awal?: number | null
          nilai_remedial?: number | null
          semester_id?: string | null
          siswa_id: string
          status?: string | null
          tahun_ajaran_id?: string | null
          tanggal?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          jenis?: string
          kd_id?: string
          kelas_id?: string | null
          keterangan?: string | null
          nilai_awal?: number | null
          nilai_remedial?: number | null
          semester_id?: string | null
          siswa_id?: string
          status?: string | null
          tahun_ajaran_id?: string | null
          tanggal?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "remedial_kd_id_fkey"
            columns: ["kd_id"]
            isOneToOne: false
            referencedRelation: "kompetensi_dasar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remedial_kelas_id_fkey"
            columns: ["kelas_id"]
            isOneToOne: false
            referencedRelation: "kelas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remedial_semester_id_fkey"
            columns: ["semester_id"]
            isOneToOne: false
            referencedRelation: "semester"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remedial_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: false
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remedial_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "tahun_ajaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remedial_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["tahun_ajaran_id"]
          },
        ]
      }
      replenishment_kas_kecil: {
        Row: {
          created_at: string | null
          dibuat_oleh: string | null
          id: string
          jumlah: number
          jurnal_id: string | null
          keterangan: string | null
          tanggal: string
        }
        Insert: {
          created_at?: string | null
          dibuat_oleh?: string | null
          id?: string
          jumlah: number
          jurnal_id?: string | null
          keterangan?: string | null
          tanggal: string
        }
        Update: {
          created_at?: string | null
          dibuat_oleh?: string | null
          id?: string
          jumlah?: number
          jurnal_id?: string | null
          keterangan?: string | null
          tanggal?: string
        }
        Relationships: [
          {
            foreignKeyName: "replenishment_kas_kecil_jurnal_id_fkey"
            columns: ["jurnal_id"]
            isOneToOne: false
            referencedRelation: "jurnal"
            referencedColumns: ["id"]
          },
        ]
      }
      riwayat_diklat: {
        Row: {
          id: string
          jam_pelatihan: number | null
          nama_diklat: string
          pegawai_id: string | null
          penyelenggara: string | null
          sertifikat_nomor: string | null
          tanggal_mulai: string | null
          tanggal_selesai: string | null
        }
        Insert: {
          id?: string
          jam_pelatihan?: number | null
          nama_diklat: string
          pegawai_id?: string | null
          penyelenggara?: string | null
          sertifikat_nomor?: string | null
          tanggal_mulai?: string | null
          tanggal_selesai?: string | null
        }
        Update: {
          id?: string
          jam_pelatihan?: number | null
          nama_diklat?: string
          pegawai_id?: string | null
          penyelenggara?: string | null
          sertifikat_nomor?: string | null
          tanggal_mulai?: string | null
          tanggal_selesai?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "riwayat_diklat_pegawai_id_fkey"
            columns: ["pegawai_id"]
            isOneToOne: false
            referencedRelation: "pegawai"
            referencedColumns: ["id"]
          },
        ]
      }
      riwayat_gaji: {
        Row: {
          berlaku_mulai: string | null
          berlaku_sampai: string | null
          gaji_pokok: number
          id: string
          keterangan: string | null
          pegawai_id: string | null
          potongan: number | null
          sk_nomor: string | null
          total: number | null
          tunjangan: number | null
        }
        Insert: {
          berlaku_mulai?: string | null
          berlaku_sampai?: string | null
          gaji_pokok?: number
          id?: string
          keterangan?: string | null
          pegawai_id?: string | null
          potongan?: number | null
          sk_nomor?: string | null
          total?: number | null
          tunjangan?: number | null
        }
        Update: {
          berlaku_mulai?: string | null
          berlaku_sampai?: string | null
          gaji_pokok?: number
          id?: string
          keterangan?: string | null
          pegawai_id?: string | null
          potongan?: number | null
          sk_nomor?: string | null
          total?: number | null
          tunjangan?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "riwayat_gaji_pegawai_id_fkey"
            columns: ["pegawai_id"]
            isOneToOne: false
            referencedRelation: "pegawai"
            referencedColumns: ["id"]
          },
        ]
      }
      riwayat_golongan: {
        Row: {
          golongan: string
          id: string
          keterangan: string | null
          pangkat: string | null
          pegawai_id: string | null
          sampai: string | null
          sk_nomor: string | null
          sk_tanggal: string | null
          tmt: string | null
        }
        Insert: {
          golongan: string
          id?: string
          keterangan?: string | null
          pangkat?: string | null
          pegawai_id?: string | null
          sampai?: string | null
          sk_nomor?: string | null
          sk_tanggal?: string | null
          tmt?: string | null
        }
        Update: {
          golongan?: string
          id?: string
          keterangan?: string | null
          pangkat?: string | null
          pegawai_id?: string | null
          sampai?: string | null
          sk_nomor?: string | null
          sk_tanggal?: string | null
          tmt?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "riwayat_golongan_pegawai_id_fkey"
            columns: ["pegawai_id"]
            isOneToOne: false
            referencedRelation: "pegawai"
            referencedColumns: ["id"]
          },
        ]
      }
      riwayat_jabatan: {
        Row: {
          id: string
          jabatan: string
          keterangan: string | null
          pegawai_id: string | null
          sampai: string | null
          sk_nomor: string | null
          sk_tanggal: string | null
          tmt: string | null
          unit_kerja: string | null
        }
        Insert: {
          id?: string
          jabatan: string
          keterangan?: string | null
          pegawai_id?: string | null
          sampai?: string | null
          sk_nomor?: string | null
          sk_tanggal?: string | null
          tmt?: string | null
          unit_kerja?: string | null
        }
        Update: {
          id?: string
          jabatan?: string
          keterangan?: string | null
          pegawai_id?: string | null
          sampai?: string | null
          sk_nomor?: string | null
          sk_tanggal?: string | null
          tmt?: string | null
          unit_kerja?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "riwayat_jabatan_pegawai_id_fkey"
            columns: ["pegawai_id"]
            isOneToOne: false
            referencedRelation: "pegawai"
            referencedColumns: ["id"]
          },
        ]
      }
      riwayat_pendidikan: {
        Row: {
          id: string
          ijazah_nomor: string | null
          jenjang: string
          jurusan: string | null
          nama_institusi: string
          pegawai_id: string | null
          tahun_lulus: number | null
          tahun_masuk: number | null
        }
        Insert: {
          id?: string
          ijazah_nomor?: string | null
          jenjang: string
          jurusan?: string | null
          nama_institusi: string
          pegawai_id?: string | null
          tahun_lulus?: number | null
          tahun_masuk?: number | null
        }
        Update: {
          id?: string
          ijazah_nomor?: string | null
          jenjang?: string
          jurusan?: string | null
          nama_institusi?: string
          pegawai_id?: string | null
          tahun_lulus?: number | null
          tahun_masuk?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "riwayat_pendidikan_pegawai_id_fkey"
            columns: ["pegawai_id"]
            isOneToOne: false
            referencedRelation: "pegawai"
            referencedColumns: ["id"]
          },
        ]
      }
      rpp: {
        Row: {
          alokasi_waktu: string | null
          created_at: string | null
          id: string
          judul: string
          kelas_id: string | null
          kompetensi_dasar: string | null
          kompetensi_inti: string | null
          langkah_kegiatan: string | null
          mapel_id: string | null
          materi: string | null
          metode: string | null
          pegawai_id: string | null
          penilaian: string | null
          pertemuan_ke: number | null
          semester_id: string | null
          status: string | null
          sumber_belajar: string | null
          tahun_ajaran_id: string | null
          tujuan: string | null
        }
        Insert: {
          alokasi_waktu?: string | null
          created_at?: string | null
          id?: string
          judul: string
          kelas_id?: string | null
          kompetensi_dasar?: string | null
          kompetensi_inti?: string | null
          langkah_kegiatan?: string | null
          mapel_id?: string | null
          materi?: string | null
          metode?: string | null
          pegawai_id?: string | null
          penilaian?: string | null
          pertemuan_ke?: number | null
          semester_id?: string | null
          status?: string | null
          sumber_belajar?: string | null
          tahun_ajaran_id?: string | null
          tujuan?: string | null
        }
        Update: {
          alokasi_waktu?: string | null
          created_at?: string | null
          id?: string
          judul?: string
          kelas_id?: string | null
          kompetensi_dasar?: string | null
          kompetensi_inti?: string | null
          langkah_kegiatan?: string | null
          mapel_id?: string | null
          materi?: string | null
          metode?: string | null
          pegawai_id?: string | null
          penilaian?: string | null
          pertemuan_ke?: number | null
          semester_id?: string | null
          status?: string | null
          sumber_belajar?: string | null
          tahun_ajaran_id?: string | null
          tujuan?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rpp_kelas_id_fkey"
            columns: ["kelas_id"]
            isOneToOne: false
            referencedRelation: "kelas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rpp_mapel_id_fkey"
            columns: ["mapel_id"]
            isOneToOne: false
            referencedRelation: "mata_pelajaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rpp_pegawai_id_fkey"
            columns: ["pegawai_id"]
            isOneToOne: false
            referencedRelation: "pegawai"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rpp_semester_id_fkey"
            columns: ["semester_id"]
            isOneToOne: false
            referencedRelation: "semester"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rpp_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "tahun_ajaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rpp_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["tahun_ajaran_id"]
          },
        ]
      }
      saldo_awal_isak35: {
        Row: {
          akun_id: string | null
          departemen_id: string | null
          id: string
          saldo: number | null
          tahun: number
        }
        Insert: {
          akun_id?: string | null
          departemen_id?: string | null
          id?: string
          saldo?: number | null
          tahun: number
        }
        Update: {
          akun_id?: string | null
          departemen_id?: string | null
          id?: string
          saldo?: number | null
          tahun?: number
        }
        Relationships: [
          {
            foreignKeyName: "saldo_awal_isak35_akun_id_fkey"
            columns: ["akun_id"]
            isOneToOne: false
            referencedRelation: "akun_rekening"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saldo_awal_isak35_akun_id_fkey"
            columns: ["akun_id"]
            isOneToOne: false
            referencedRelation: "v_saldo_akun_konsolidasi"
            referencedColumns: ["akun_id"]
          },
          {
            foreignKeyName: "saldo_awal_isak35_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saldo_awal_isak35_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekap_keuangan_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "saldo_awal_isak35_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekon_antar_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "saldo_awal_isak35_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["departemen_id"]
          },
        ]
      }
      saldo_awal_usaha: {
        Row: {
          akun_id: string
          departemen_id: string | null
          id: string
          saldo: number
          tahun: number
        }
        Insert: {
          akun_id: string
          departemen_id?: string | null
          id?: string
          saldo?: number
          tahun: number
        }
        Update: {
          akun_id?: string
          departemen_id?: string | null
          id?: string
          saldo?: number
          tahun?: number
        }
        Relationships: [
          {
            foreignKeyName: "saldo_awal_usaha_akun_id_fkey"
            columns: ["akun_id"]
            isOneToOne: false
            referencedRelation: "akun_rekening"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saldo_awal_usaha_akun_id_fkey"
            columns: ["akun_id"]
            isOneToOne: false
            referencedRelation: "v_saldo_akun_konsolidasi"
            referencedColumns: ["akun_id"]
          },
          {
            foreignKeyName: "saldo_awal_usaha_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saldo_awal_usaha_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekap_keuangan_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "saldo_awal_usaha_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekon_antar_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "saldo_awal_usaha_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["departemen_id"]
          },
        ]
      }
      sekolah: {
        Row: {
          akreditasi: string | null
          alamat: string | null
          bendahara: string | null
          email: string | null
          id: string
          kepala_sekolah: string | null
          kota: string | null
          logo_url: string | null
          nama: string | null
          npsn: string | null
          telepon: string | null
        }
        Insert: {
          akreditasi?: string | null
          alamat?: string | null
          bendahara?: string | null
          email?: string | null
          id?: string
          kepala_sekolah?: string | null
          kota?: string | null
          logo_url?: string | null
          nama?: string | null
          npsn?: string | null
          telepon?: string | null
        }
        Update: {
          akreditasi?: string | null
          alamat?: string | null
          bendahara?: string | null
          email?: string | null
          id?: string
          kepala_sekolah?: string | null
          kota?: string | null
          logo_url?: string | null
          nama?: string | null
          npsn?: string | null
          telepon?: string | null
        }
        Relationships: []
      }
      semester: {
        Row: {
          aktif: boolean | null
          id: string
          nama: string | null
          tahun_ajaran_id: string | null
          urutan: number | null
        }
        Insert: {
          aktif?: boolean | null
          id?: string
          nama?: string | null
          tahun_ajaran_id?: string | null
          urutan?: number | null
        }
        Update: {
          aktif?: boolean | null
          id?: string
          nama?: string | null
          tahun_ajaran_id?: string | null
          urutan?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "semester_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "tahun_ajaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "semester_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["tahun_ajaran_id"]
          },
        ]
      }
      sertifikasi_guru: {
        Row: {
          aktif: boolean | null
          id: string
          jenis: string
          keterangan: string | null
          nomor_sertifikat: string | null
          pegawai_id: string | null
          penerbit: string | null
          tanggal_berlaku: string | null
          tanggal_terbit: string | null
        }
        Insert: {
          aktif?: boolean | null
          id?: string
          jenis: string
          keterangan?: string | null
          nomor_sertifikat?: string | null
          pegawai_id?: string | null
          penerbit?: string | null
          tanggal_berlaku?: string | null
          tanggal_terbit?: string | null
        }
        Update: {
          aktif?: boolean | null
          id?: string
          jenis?: string
          keterangan?: string | null
          nomor_sertifikat?: string | null
          pegawai_id?: string | null
          penerbit?: string | null
          tanggal_berlaku?: string | null
          tanggal_terbit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sertifikasi_guru_pegawai_id_fkey"
            columns: ["pegawai_id"]
            isOneToOne: false
            referencedRelation: "pegawai"
            referencedColumns: ["id"]
          },
        ]
      }
      siswa: {
        Row: {
          agama: string | null
          alamat: string | null
          angkatan_id: string | null
          created_at: string | null
          departemen_id: string | null
          email: string | null
          foto_url: string | null
          id: string
          id_santri_pihak3: string | null
          jenis_kelamin: string | null
          keluarga_id: string | null
          nama: string
          nis: string | null
          nisn: string | null
          status: string | null
          tanggal_lahir: string | null
          telepon: string | null
          tempat_lahir: string | null
          terverifikasi: boolean
        }
        Insert: {
          agama?: string | null
          alamat?: string | null
          angkatan_id?: string | null
          created_at?: string | null
          departemen_id?: string | null
          email?: string | null
          foto_url?: string | null
          id?: string
          id_santri_pihak3?: string | null
          jenis_kelamin?: string | null
          keluarga_id?: string | null
          nama: string
          nis?: string | null
          nisn?: string | null
          status?: string | null
          tanggal_lahir?: string | null
          telepon?: string | null
          tempat_lahir?: string | null
          terverifikasi?: boolean
        }
        Update: {
          agama?: string | null
          alamat?: string | null
          angkatan_id?: string | null
          created_at?: string | null
          departemen_id?: string | null
          email?: string | null
          foto_url?: string | null
          id?: string
          id_santri_pihak3?: string | null
          jenis_kelamin?: string | null
          keluarga_id?: string | null
          nama?: string
          nis?: string | null
          nisn?: string | null
          status?: string | null
          tanggal_lahir?: string | null
          telepon?: string | null
          tempat_lahir?: string | null
          terverifikasi?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "siswa_angkatan_id_fkey"
            columns: ["angkatan_id"]
            isOneToOne: false
            referencedRelation: "angkatan"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "siswa_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "siswa_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekap_keuangan_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "siswa_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekon_antar_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "siswa_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "siswa_keluarga_id_fkey"
            columns: ["keluarga_id"]
            isOneToOne: false
            referencedRelation: "keluarga"
            referencedColumns: ["id"]
          },
        ]
      }
      siswa_detail: {
        Row: {
          ukuran_seragam: Json | null
          alamat_ortu: string | null
          alasan_pindah: string | null
          asal_sekolah: string | null
          id: string
          jenis_pendaftaran: string | null
          kelas_terakhir: string | null
          nama_ayah: string | null
          nama_ibu: string | null
          pekerjaan_ayah: string | null
          pekerjaan_ibu: string | null
          pmb_payment_token: string | null
          siswa_id: string | null
          telepon_ortu: string | null
        }
        Insert: {
          ukuran_seragam?: Json | null
          alamat_ortu?: string | null
          alasan_pindah?: string | null
          asal_sekolah?: string | null
          id?: string
          jenis_pendaftaran?: string | null
          kelas_terakhir?: string | null
          nama_ayah?: string | null
          nama_ibu?: string | null
          pekerjaan_ayah?: string | null
          pekerjaan_ibu?: string | null
          pmb_payment_token?: string | null
          siswa_id?: string | null
          telepon_ortu?: string | null
        }
        Update: {
          ukuran_seragam?: Json | null
          alamat_ortu?: string | null
          alasan_pindah?: string | null
          asal_sekolah?: string | null
          id?: string
          jenis_pendaftaran?: string | null
          kelas_terakhir?: string | null
          nama_ayah?: string | null
          nama_ibu?: string | null
          pekerjaan_ayah?: string | null
          pekerjaan_ibu?: string | null
          pmb_payment_token?: string | null
          siswa_id?: string | null
          telepon_ortu?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "siswa_detail_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: false
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
        ]
      }
      siswa_diskon: {
        Row: {
          alasan_penolakan: string | null
          catatan: string | null
          diajukan_at: string
          diajukan_oleh: string | null
          diputuskan_at: string | null
          diputuskan_oleh: string | null
          diterapkan_at: string | null
          dokumen_url: string | null
          id: string
          jenis_id: string
          nilai: number | null
          periode_mulai: string
          periode_selesai: string
          siswa_id: string
          skema_diskon_id: string
          status: string
        }
        Insert: {
          alasan_penolakan?: string | null
          catatan?: string | null
          diajukan_at?: string
          diajukan_oleh?: string | null
          diputuskan_at?: string | null
          diputuskan_oleh?: string | null
          diterapkan_at?: string | null
          dokumen_url?: string | null
          id?: string
          jenis_id: string
          nilai?: number | null
          periode_mulai: string
          periode_selesai: string
          siswa_id: string
          skema_diskon_id: string
          status?: string
        }
        Update: {
          alasan_penolakan?: string | null
          catatan?: string | null
          diajukan_at?: string
          diajukan_oleh?: string | null
          diputuskan_at?: string | null
          diputuskan_oleh?: string | null
          diterapkan_at?: string | null
          dokumen_url?: string | null
          id?: string
          jenis_id?: string
          nilai?: number | null
          periode_mulai?: string
          periode_selesai?: string
          siswa_id?: string
          skema_diskon_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "siswa_diskon_jenis_id_fkey"
            columns: ["jenis_id"]
            isOneToOne: false
            referencedRelation: "jenis_pembayaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "siswa_diskon_jenis_id_fkey"
            columns: ["jenis_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["jenis_id"]
          },
          {
            foreignKeyName: "siswa_diskon_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: false
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "siswa_diskon_skema_diskon_id_fkey"
            columns: ["skema_diskon_id"]
            isOneToOne: false
            referencedRelation: "skema_diskon"
            referencedColumns: ["id"]
          },
        ]
      }
      skema_diskon: {
        Row: {
          aktif: boolean
          created_at: string
          id: string
          kategori: string
          keterangan: string | null
          nama: string
          nilai_default: number
          perlu_approval: boolean
          tipe: string
        }
        Insert: {
          aktif?: boolean
          created_at?: string
          id?: string
          kategori: string
          keterangan?: string | null
          nama: string
          nilai_default?: number
          perlu_approval?: boolean
          tipe: string
        }
        Update: {
          aktif?: boolean
          created_at?: string
          id?: string
          kategori?: string
          keterangan?: string | null
          nama?: string
          nilai_default?: number
          perlu_approval?: boolean
          tipe?: string
        }
        Relationships: []
      }
      tabungan_pegawai: {
        Row: {
          id: string
          pegawai_id: string
          saldo: number
          updated_at: string | null
        }
        Insert: {
          id?: string
          pegawai_id: string
          saldo?: number
          updated_at?: string | null
        }
        Update: {
          id?: string
          pegawai_id?: string
          saldo?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tabungan_pegawai_pegawai_id_fkey"
            columns: ["pegawai_id"]
            isOneToOne: true
            referencedRelation: "pegawai"
            referencedColumns: ["id"]
          },
        ]
      }
      tabungan_siswa: {
        Row: {
          id: string
          saldo: number | null
          siswa_id: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          saldo?: number | null
          siswa_id?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          saldo?: number | null
          siswa_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tabungan_siswa_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: true
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
        ]
      }
      tagihan: {
        Row: {
          spp_kategori: string | null
          spp_akun_pendapatan_id: string | null
          bulan: number | null
          created_at: string
          created_by: string | null
          dibatalkan_alasan: string | null
          dibatalkan_at: string | null
          dibatalkan_oleh: string | null
          id: string
          tanggal_pengakuan: string | null
          pengakuan_spp_selesai: boolean
          jatuh_tempo: string | null
          jenis_id: string
          label_tampil: string | null
          jurnal_pembalik_id: string | null
          jurnal_piutang_id: string | null
          kelas_id: string | null
          nominal: number
          nominal_bruto: number | null
          nominal_diskon: number
          pembayaran_id: string | null
          siswa_diskon_id: string | null
          siswa_id: string
          status: string
          tahun_akademik_id: string | null
          tahun_ajaran_id: string
          write_off_id: string | null
        }
        Insert: {
          spp_kategori?: string | null
          spp_akun_pendapatan_id?: string | null
          bulan?: number | null
          created_at?: string
          created_by?: string | null
          dibatalkan_alasan?: string | null
          dibatalkan_at?: string | null
          dibatalkan_oleh?: string | null
          id?: string
          tanggal_pengakuan?: string | null
          pengakuan_spp_selesai?: boolean
          jatuh_tempo?: string | null
          jenis_id: string
          label_tampil?: string | null
          jurnal_pembalik_id?: string | null
          jurnal_piutang_id?: string | null
          kelas_id?: string | null
          nominal?: number
          nominal_bruto?: number | null
          nominal_diskon?: number
          pembayaran_id?: string | null
          siswa_diskon_id?: string | null
          siswa_id: string
          status?: string
          tahun_akademik_id?: string | null
          tahun_ajaran_id: string
          write_off_id?: string | null
        }
        Update: {
          spp_kategori?: string | null
          spp_akun_pendapatan_id?: string | null
          bulan?: number | null
          created_at?: string
          created_by?: string | null
          dibatalkan_alasan?: string | null
          dibatalkan_at?: string | null
          dibatalkan_oleh?: string | null
          id?: string
          tanggal_pengakuan?: string | null
          pengakuan_spp_selesai?: boolean
          jatuh_tempo?: string | null
          jenis_id?: string
          label_tampil?: string | null
          jurnal_pembalik_id?: string | null
          jurnal_piutang_id?: string | null
          kelas_id?: string | null
          nominal?: number
          nominal_bruto?: number | null
          nominal_diskon?: number
          pembayaran_id?: string | null
          siswa_diskon_id?: string | null
          siswa_id?: string
          status?: string
          tahun_akademik_id?: string | null
          tahun_ajaran_id?: string
          write_off_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tagihan_tahun_akademik_id_fkey"
            columns: ["tahun_akademik_id"]
            isOneToOne: false
            referencedRelation: "tahun_ajaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tagihan_jenis_id_fkey"
            columns: ["jenis_id"]
            isOneToOne: false
            referencedRelation: "jenis_pembayaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tagihan_jenis_id_fkey"
            columns: ["jenis_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["jenis_id"]
          },
          {
            foreignKeyName: "tagihan_jurnal_pembalik_id_fkey"
            columns: ["jurnal_pembalik_id"]
            isOneToOne: false
            referencedRelation: "jurnal"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tagihan_jurnal_piutang_id_fkey"
            columns: ["jurnal_piutang_id"]
            isOneToOne: false
            referencedRelation: "jurnal"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tagihan_kelas_id_fkey"
            columns: ["kelas_id"]
            isOneToOne: false
            referencedRelation: "kelas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tagihan_pembayaran_id_fkey"
            columns: ["pembayaran_id"]
            isOneToOne: false
            referencedRelation: "pembayaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tagihan_siswa_diskon_id_fkey"
            columns: ["siswa_diskon_id"]
            isOneToOne: false
            referencedRelation: "siswa_diskon"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tagihan_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: false
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tagihan_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "tahun_buku"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tagihan_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "v_status_tutup_buku"
            referencedColumns: ["tahun_buku_id"]
          },
          {
            foreignKeyName: "tagihan_write_off_id_fkey"
            columns: ["write_off_id"]
            isOneToOne: false
            referencedRelation: "write_off_piutang"
            referencedColumns: ["id"]
          },
        ]
      }
      tahun_ajaran: {
        Row: {
          aktif: boolean | null
          ditutup: boolean
          id: string
          keterangan: string | null
          nama: string
          tanggal_mulai: string | null
          tanggal_selesai: string | null
        }
        Insert: {
          aktif?: boolean | null
          ditutup?: boolean
          id?: string
          keterangan?: string | null
          nama: string
          tanggal_mulai?: string | null
          tanggal_selesai?: string | null
        }
        Update: {
          aktif?: boolean | null
          ditutup?: boolean
          id?: string
          keterangan?: string | null
          nama?: string
          tanggal_mulai?: string | null
          tanggal_selesai?: string | null
        }
        Relationships: []
      }
      tahun_buku: {
        Row: {
          aktif: boolean | null
          created_at: string | null
          ditutup: boolean | null
          id: string
          keterangan: string | null
          nama: string
          tanggal_mulai: string
          tanggal_selesai: string
        }
        Insert: {
          aktif?: boolean | null
          created_at?: string | null
          ditutup?: boolean | null
          id?: string
          keterangan?: string | null
          nama: string
          tanggal_mulai: string
          tanggal_selesai: string
        }
        Update: {
          aktif?: boolean | null
          created_at?: string | null
          ditutup?: boolean | null
          id?: string
          keterangan?: string | null
          nama?: string
          tanggal_mulai?: string
          tanggal_selesai?: string
        }
        Relationships: []
      }
      tarif_tagihan: {
        Row: {
          aktif: boolean | null
          angkatan_id: string | null
          created_at: string | null
          id: string
          jenis_id: string
          kelas_id: string | null
          keterangan: string | null
          nominal: number
          siswa_id: string | null
          tahun_ajaran_id: string | null
          updated_at: string | null
        }
        Insert: {
          aktif?: boolean | null
          angkatan_id?: string | null
          created_at?: string | null
          id?: string
          jenis_id: string
          kelas_id?: string | null
          keterangan?: string | null
          nominal?: number
          siswa_id?: string | null
          tahun_ajaran_id?: string | null
          updated_at?: string | null
        }
        Update: {
          aktif?: boolean | null
          angkatan_id?: string | null
          created_at?: string | null
          id?: string
          jenis_id?: string
          kelas_id?: string | null
          keterangan?: string | null
          nominal?: number
          siswa_id?: string | null
          tahun_ajaran_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tarif_tagihan_angkatan_id_fkey"
            columns: ["angkatan_id"]
            isOneToOne: false
            referencedRelation: "angkatan"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarif_tagihan_jenis_id_fkey"
            columns: ["jenis_id"]
            isOneToOne: false
            referencedRelation: "jenis_pembayaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarif_tagihan_jenis_id_fkey"
            columns: ["jenis_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["jenis_id"]
          },
          {
            foreignKeyName: "tarif_tagihan_kelas_id_fkey"
            columns: ["kelas_id"]
            isOneToOne: false
            referencedRelation: "kelas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarif_tagihan_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: false
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarif_tagihan_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "tahun_buku"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarif_tagihan_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "v_status_tutup_buku"
            referencedColumns: ["tahun_buku_id"]
          },
        ]
      }
      tingkat: {
        Row: {
          aktif: boolean | null
          departemen_id: string | null
          id: string
          nama: string
          urutan: number | null
        }
        Insert: {
          aktif?: boolean | null
          departemen_id?: string | null
          id?: string
          nama: string
          urutan?: number | null
        }
        Update: {
          aktif?: boolean | null
          departemen_id?: string | null
          id?: string
          nama?: string
          urutan?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tingkat_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tingkat_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekap_keuangan_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "tingkat_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekon_antar_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "tingkat_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["departemen_id"]
          },
        ]
      }
      transaksi_kas_kecil: {
        Row: {
          created_at: string | null
          dibuat_oleh: string | null
          id: string
          jenis_pengeluaran_id: string | null
          jumlah: number
          keterangan: string
          no_bukti: string | null
          penerima: string | null
          replenishment_id: string | null
          tanggal: string
        }
        Insert: {
          created_at?: string | null
          dibuat_oleh?: string | null
          id?: string
          jenis_pengeluaran_id?: string | null
          jumlah: number
          keterangan: string
          no_bukti?: string | null
          penerima?: string | null
          replenishment_id?: string | null
          tanggal: string
        }
        Update: {
          created_at?: string | null
          dibuat_oleh?: string | null
          id?: string
          jenis_pengeluaran_id?: string | null
          jumlah?: number
          keterangan?: string
          no_bukti?: string | null
          penerima?: string | null
          replenishment_id?: string | null
          tanggal?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaksi_kas_kecil_jenis_pengeluaran_id_fkey"
            columns: ["jenis_pengeluaran_id"]
            isOneToOne: false
            referencedRelation: "jenis_pengeluaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaksi_kas_kecil_replenishment_id_fkey"
            columns: ["replenishment_id"]
            isOneToOne: false
            referencedRelation: "replenishment_kas_kecil"
            referencedColumns: ["id"]
          },
        ]
      }
      transaksi_midtrans: {
        Row: {
          biaya_admin: number
          created_at: string | null
          expired_at: string | null
          fraud_status: string | null
          id: string
          metadata: Json | null
          midtrans_payment_status: string | null
          midtrans_transaction_id: string | null
          order_id: string
          paid_at: string | null
          payment_type: string | null
          snap_token: string | null
          status: string
          total_amount: number
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          biaya_admin?: number
          created_at?: string | null
          expired_at?: string | null
          fraud_status?: string | null
          id?: string
          metadata?: Json | null
          midtrans_payment_status?: string | null
          midtrans_transaction_id?: string | null
          order_id: string
          paid_at?: string | null
          payment_type?: string | null
          snap_token?: string | null
          status?: string
          total_amount: number
          updated_at?: string | null
          user_id: string | null
        }
        Update: {
          biaya_admin?: number
          created_at?: string | null
          expired_at?: string | null
          fraud_status?: string | null
          id?: string
          metadata?: Json | null
          midtrans_payment_status?: string | null
          midtrans_transaction_id?: string | null
          order_id?: string
          paid_at?: string | null
          payment_type?: string | null
          snap_token?: string | null
          status?: string
          total_amount?: number
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transaksi_midtrans_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_profile"
            referencedColumns: ["id"]
          },
        ]
      }
      transaksi_midtrans_item: {
        Row: {
          bulan: number
          created_at: string | null
          departemen_id: string | null
          id: string
          jenis_id: string
          jumlah: number
          nama_item: string
          pembayaran_id: string | null
          siswa_id: string
          tagihan_id: string | null
          tahun_ajaran_id: string | null
          transaksi_id: string
        }
        Insert: {
          bulan: number
          created_at?: string | null
          departemen_id?: string | null
          id?: string
          jenis_id: string
          jumlah: number
          nama_item: string
          pembayaran_id?: string | null
          siswa_id: string
          tagihan_id?: string | null
          tahun_ajaran_id?: string | null
          transaksi_id: string
        }
        Update: {
          bulan?: number
          created_at?: string | null
          departemen_id?: string | null
          id?: string
          jenis_id?: string
          jumlah?: number
          nama_item?: string
          pembayaran_id?: string | null
          siswa_id?: string
          tagihan_id?: string | null
          tahun_ajaran_id?: string | null
          transaksi_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaksi_midtrans_item_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaksi_midtrans_item_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekap_keuangan_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "transaksi_midtrans_item_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekon_antar_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "transaksi_midtrans_item_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "transaksi_midtrans_item_jenis_id_fkey"
            columns: ["jenis_id"]
            isOneToOne: false
            referencedRelation: "jenis_pembayaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaksi_midtrans_item_jenis_id_fkey"
            columns: ["jenis_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["jenis_id"]
          },
          {
            foreignKeyName: "transaksi_midtrans_item_pembayaran_id_fkey"
            columns: ["pembayaran_id"]
            isOneToOne: false
            referencedRelation: "pembayaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaksi_midtrans_item_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: false
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaksi_midtrans_item_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "tahun_buku"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaksi_midtrans_item_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "v_status_tutup_buku"
            referencedColumns: ["tahun_buku_id"]
          },
          {
            foreignKeyName: "transaksi_midtrans_item_transaksi_id_fkey"
            columns: ["transaksi_id"]
            isOneToOne: false
            referencedRelation: "transaksi_midtrans"
            referencedColumns: ["id"]
          },
        ]
      }
      transaksi_tabungan: {
        Row: {
          created_at: string | null
          id: string
          jenis: string
          jumlah: number
          jurnal_id: string | null
          keterangan: string | null
          petugas_id: string | null
          saldo_sesudah: number | null
          siswa_id: string | null
          tanggal: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          jenis: string
          jumlah: number
          jurnal_id?: string | null
          keterangan?: string | null
          petugas_id?: string | null
          saldo_sesudah?: number | null
          siswa_id?: string | null
          tanggal: string
        }
        Update: {
          created_at?: string | null
          id?: string
          jenis?: string
          jumlah?: number
          jurnal_id?: string | null
          keterangan?: string | null
          petugas_id?: string | null
          saldo_sesudah?: number | null
          siswa_id?: string | null
          tanggal?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaksi_tabungan_jurnal_id_fkey"
            columns: ["jurnal_id"]
            isOneToOne: false
            referencedRelation: "jurnal"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaksi_tabungan_petugas_id_fkey"
            columns: ["petugas_id"]
            isOneToOne: false
            referencedRelation: "pegawai"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaksi_tabungan_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: false
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
        ]
      }
      transaksi_tabungan_pegawai: {
        Row: {
          created_at: string | null
          id: string
          jenis: string
          jumlah: number
          jurnal_id: string | null
          keterangan: string | null
          pegawai_id: string
          petugas_id: string | null
          saldo_sesudah: number | null
          tanggal: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          jenis?: string
          jumlah?: number
          jurnal_id?: string | null
          keterangan?: string | null
          pegawai_id: string
          petugas_id?: string | null
          saldo_sesudah?: number | null
          tanggal?: string
        }
        Update: {
          created_at?: string | null
          id?: string
          jenis?: string
          jumlah?: number
          jurnal_id?: string | null
          keterangan?: string | null
          pegawai_id?: string
          petugas_id?: string | null
          saldo_sesudah?: number | null
          tanggal?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaksi_tabungan_pegawai_jurnal_id_fkey"
            columns: ["jurnal_id"]
            isOneToOne: false
            referencedRelation: "jurnal"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaksi_tabungan_pegawai_pegawai_id_fkey"
            columns: ["pegawai_id"]
            isOneToOne: false
            referencedRelation: "pegawai"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaksi_tabungan_pegawai_petugas_id_fkey"
            columns: ["petugas_id"]
            isOneToOne: false
            referencedRelation: "pegawai"
            referencedColumns: ["id"]
          },
        ]
      }
      users_profile: {
        Row: {
          aktif: boolean | null
          created_at: string | null
          departemen_id: string | null
          email: string | null
          id: string
          pegawai_id: string | null
          role: string | null
          siswa_id: string | null
        }
        Insert: {
          aktif?: boolean | null
          created_at?: string | null
          departemen_id?: string | null
          email?: string | null
          id: string
          pegawai_id?: string | null
          role?: string | null
          siswa_id?: string | null
        }
        Update: {
          aktif?: boolean | null
          created_at?: string | null
          departemen_id?: string | null
          email?: string | null
          id?: string
          pegawai_id?: string | null
          role?: string | null
          siswa_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_profile_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_profile_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekap_keuangan_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "users_profile_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekon_antar_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "users_profile_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "users_profile_pegawai_id_fkey"
            columns: ["pegawai_id"]
            isOneToOne: false
            referencedRelation: "pegawai"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_profile_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: false
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
        ]
      }
      write_off_piutang: {
        Row: {
          alasan: string
          created_at: string
          departemen_id: string | null
          dibuat_oleh: string | null
          id: string
          jurnal_id: string | null
          nominal: number
          siswa_id: string
          tagihan_id: string
          tanggal: string
        }
        Insert: {
          alasan: string
          created_at?: string
          departemen_id?: string | null
          dibuat_oleh?: string | null
          id?: string
          jurnal_id?: string | null
          nominal?: number
          siswa_id: string
          tagihan_id: string
          tanggal: string
        }
        Update: {
          alasan?: string
          created_at?: string
          departemen_id?: string | null
          dibuat_oleh?: string | null
          id?: string
          jurnal_id?: string | null
          nominal?: number
          siswa_id?: string
          tagihan_id?: string
          tanggal?: string
        }
        Relationships: [
          {
            foreignKeyName: "write_off_piutang_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "write_off_piutang_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekap_keuangan_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "write_off_piutang_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_rekon_antar_lembaga"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "write_off_piutang_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["departemen_id"]
          },
          {
            foreignKeyName: "write_off_piutang_jurnal_id_fkey"
            columns: ["jurnal_id"]
            isOneToOne: false
            referencedRelation: "jurnal"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "write_off_piutang_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: false
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "write_off_piutang_tagihan_id_fkey"
            columns: ["tagihan_id"]
            isOneToOne: false
            referencedRelation: "tagihan"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "write_off_piutang_tagihan_id_fkey"
            columns: ["tagihan_id"]
            isOneToOne: false
            referencedRelation: "v_tagihan_belum_bayar"
            referencedColumns: ["tagihan_id"]
          },
        ]
      }
      admin_tu_departemen_scope: {
        Row: {
          user_id: string
          departemen_id: string
          created_at: string
        }
        Insert: {
          user_id: string
          departemen_id: string
          created_at?: string
        }
        Update: {
          user_id?: string
          departemen_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_tu_departemen_scope_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_tu_departemen_scope_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_profile"
            referencedColumns: ["id"]
          },
        ]
      }
      akrual_harian_log: {
        Row: {
          id: string
          dijalankan_at: string
          sumber: string
          sampai_tanggal: string | null
          piutang_diposting: number
          piutang_nominal: number
          pendapatan_diakui: number
          pendapatan_nominal: number
          jumlah_galat: number
          galat: Json
          galat_terpotong: boolean
          gagal_total: boolean
          pesan_gagal: string | null
        }
        Insert: {
          id?: string
          dijalankan_at?: string
          sumber?: string
          sampai_tanggal?: string | null
          piutang_diposting?: number
          piutang_nominal?: number
          pendapatan_diakui?: number
          pendapatan_nominal?: number
          jumlah_galat?: number
          galat?: Json
          galat_terpotong?: boolean
          gagal_total?: boolean
          pesan_gagal?: string | null
        }
        Update: {
          id?: string
          dijalankan_at?: string
          sumber?: string
          sampai_tanggal?: string | null
          piutang_diposting?: number
          piutang_nominal?: number
          pendapatan_diakui?: number
          pendapatan_nominal?: number
          jumlah_galat?: number
          galat?: Json
          galat_terpotong?: boolean
          gagal_total?: boolean
          pesan_gagal?: string | null
        }
        Relationships: []
      }
      integration_api_usage: {
        Row: {
          id: number
          integration_id: string | null
          route: string
          request_id: string
          status: number
          duration_ms: number
          created_at: string
        }
        Insert: {
          id?: never
          integration_id?: string | null
          route: string
          request_id: string
          status: number
          duration_ms: number
          created_at?: string
        }
        Update: {
          id?: never
          integration_id?: string | null
          route?: string
          request_id?: string
          status?: number
          duration_ms?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_api_usage_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integration_apps"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_apps: {
        Row: {
          id: string
          name: string
          active: boolean
          scopes: string[]
          department_ids: string[]
          academic_year_ids: string[]
          expires_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
          last_used_at: string | null
        }
        Insert: {
          id?: string
          name: string
          active?: boolean
          scopes?: string[]
          department_ids?: string[]
          academic_year_ids?: string[]
          expires_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
          last_used_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          active?: boolean
          scopes?: string[]
          department_ids?: string[]
          academic_year_ids?: string[]
          expires_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
          last_used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_apps_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_audit_log: {
        Row: {
          id: number
          integration_id: string | null
          actor_id: string | null
          action: string
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: never
          integration_id?: string | null
          actor_id?: string | null
          action: string
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: never
          integration_id?: string | null
          actor_id?: string | null
          action?: string
          metadata?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_audit_log_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integration_apps"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_change_log: {
        Row: {
          seq: number
          object_type: string
          object_id: string
          change_type: string
          department_id: string | null
          academic_year_id: string | null
          previous_department_id: string | null
          previous_academic_year_id: string | null
          changed_at: string
        }
        Insert: {
          seq?: never
          object_type: string
          object_id: string
          change_type: string
          department_id?: string | null
          academic_year_id?: string | null
          previous_department_id?: string | null
          previous_academic_year_id?: string | null
          changed_at?: string
        }
        Update: {
          seq?: never
          object_type?: string
          object_id?: string
          change_type?: string
          department_id?: string | null
          academic_year_id?: string | null
          previous_department_id?: string | null
          previous_academic_year_id?: string | null
          changed_at?: string
        }
        Relationships: []
      }
      integration_tokens: {
        Row: {
          id: string
          integration_id: string
          token_prefix: string
          token_hash: string
          expires_at: string | null
          revoked_at: string | null
          created_by: string | null
          created_at: string
          last_used_at: string | null
        }
        Insert: {
          id?: string
          integration_id: string
          token_prefix: string
          token_hash: string
          expires_at?: string | null
          revoked_at?: string | null
          created_by?: string | null
          created_at?: string
          last_used_at?: string | null
        }
        Update: {
          id?: string
          integration_id?: string
          token_prefix?: string
          token_hash?: string
          expires_at?: string | null
          revoked_at?: string | null
          created_by?: string | null
          created_at?: string
          last_used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_tokens_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_tokens_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integration_apps"
            referencedColumns: ["id"]
          },
        ]
      }
      kebijakan_keringanan: {
        Row: {
          id: string
          kode: string
          versi: number
          nama: string
          skema_diskon_id: string
          jenis_id: string
          kelas_regex: string | null
          tipe: string
          nilai: number
          otomatis: boolean
          perlu_pengajuan: boolean
          berlaku_mulai: string
          berlaku_selesai: string | null
          aktif: boolean
          keterangan: string | null
          dibuat_oleh: string | null
          created_at: string
        }
        Insert: {
          id?: string
          kode: string
          versi: number
          nama: string
          skema_diskon_id: string
          jenis_id: string
          kelas_regex?: string | null
          tipe: string
          nilai: number
          otomatis?: boolean
          perlu_pengajuan?: boolean
          berlaku_mulai: string
          berlaku_selesai?: string | null
          aktif?: boolean
          keterangan?: string | null
          dibuat_oleh?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          kode?: string
          versi?: number
          nama?: string
          skema_diskon_id?: string
          jenis_id?: string
          kelas_regex?: string | null
          tipe?: string
          nilai?: number
          otomatis?: boolean
          perlu_pengajuan?: boolean
          berlaku_mulai?: string
          berlaku_selesai?: string | null
          aktif?: boolean
          keterangan?: string | null
          dibuat_oleh?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kebijakan_keringanan_dibuat_oleh_fkey"
            columns: ["dibuat_oleh"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kebijakan_keringanan_jenis_id_fkey"
            columns: ["jenis_id"]
            isOneToOne: false
            referencedRelation: "jenis_pembayaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kebijakan_keringanan_skema_diskon_id_fkey"
            columns: ["skema_diskon_id"]
            isOneToOne: false
            referencedRelation: "skema_diskon"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_link: {
        Row: {
          id: string
          token_hash: string
          siswa_id: string
          tagihan_ids: string[]
          created_by: string
          created_at: string
          expires_at: string
          canceled_at: string | null
          canceled_by: string | null
          cicilan: Json
        }
        Insert: {
          id?: string
          token_hash: string
          siswa_id: string
          tagihan_ids: string[]
          created_by: string
          created_at?: string
          expires_at: string
          canceled_at?: string | null
          canceled_by?: string | null
          cicilan?: Json
        }
        Update: {
          id?: string
          token_hash?: string
          siswa_id?: string
          tagihan_ids?: string[]
          created_by?: string
          created_at?: string
          expires_at?: string
          canceled_at?: string | null
          canceled_by?: string | null
          cicilan?: Json
        }
        Relationships: [
          {
            foreignKeyName: "payment_link_canceled_by_fkey"
            columns: ["canceled_by"]
            isOneToOne: false
            referencedRelation: "users_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_link_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_link_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: false
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_receipt_items: {
        Row: {
          id: string
          receipt_id: string
          line_no: number
          payment_id: string | null
          siswa_id: string | null
          jenis_id: string | null
          tagihan_id: string | null
          tahun_ajaran_id: string | null
          bulan: number | null
          student_name: string
          student_nis: string | null
          student_nisn: string | null
          payment_type_name: string
          department_name: string | null
          period_label: string | null
          description: string
          amount: number
          status: string
          voided_at: string | null
          voided_by_user_id: string | null
          void_reason: string | null
          created_at: string
        }
        Insert: {
          id?: string
          receipt_id: string
          line_no: number
          payment_id?: string | null
          siswa_id?: string | null
          jenis_id?: string | null
          tagihan_id?: string | null
          tahun_ajaran_id?: string | null
          bulan?: number | null
          student_name: string
          student_nis?: string | null
          student_nisn?: string | null
          payment_type_name: string
          department_name?: string | null
          period_label?: string | null
          description: string
          amount: number
          status?: string
          voided_at?: string | null
          voided_by_user_id?: string | null
          void_reason?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          receipt_id?: string
          line_no?: number
          payment_id?: string | null
          siswa_id?: string | null
          jenis_id?: string | null
          tagihan_id?: string | null
          tahun_ajaran_id?: string | null
          bulan?: number | null
          student_name?: string
          student_nis?: string | null
          student_nisn?: string | null
          payment_type_name?: string
          department_name?: string | null
          period_label?: string | null
          description?: string
          amount?: number
          status?: string
          voided_at?: string | null
          voided_by_user_id?: string | null
          void_reason?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_receipt_items_jenis_id_fkey"
            columns: ["jenis_id"]
            isOneToOne: false
            referencedRelation: "jenis_pembayaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_receipt_items_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "pembayaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_receipt_items_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "payment_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_receipt_items_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: false
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_receipt_items_tagihan_id_fkey"
            columns: ["tagihan_id"]
            isOneToOne: false
            referencedRelation: "tagihan"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_receipt_items_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "tahun_buku"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_receipt_items_voided_by_user_id_fkey"
            columns: ["voided_by_user_id"]
            isOneToOne: false
            referencedRelation: "users_profile"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_receipts: {
        Row: {
          id: string
          receipt_number: string
          source: string
          source_reference: string | null
          payment_date: string
          payment_method: string | null
          status: string
          total_amount: number
          payer_user_id: string | null
          created_by_user_id: string | null
          cashier_employee_id: string | null
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          receipt_number: string
          source: string
          source_reference?: string | null
          payment_date: string
          payment_method?: string | null
          status?: string
          total_amount?: number
          payer_user_id?: string | null
          created_by_user_id?: string | null
          cashier_employee_id?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          receipt_number?: string
          source?: string
          source_reference?: string | null
          payment_date?: string
          payment_method?: string | null
          status?: string
          total_amount?: number
          payer_user_id?: string | null
          created_by_user_id?: string | null
          cashier_employee_id?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_receipts_cashier_employee_id_fkey"
            columns: ["cashier_employee_id"]
            isOneToOne: false
            referencedRelation: "pegawai"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_receipts_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_receipts_payer_user_id_fkey"
            columns: ["payer_user_id"]
            isOneToOne: false
            referencedRelation: "users_profile"
            referencedColumns: ["id"]
          },
        ]
      }
      pembatalan_pembayaran_pengajuan: {
        Row: {
          id: string
          pembayaran_id: string
          snapshot: Json
          alasan: string
          status: string
          diajukan_oleh: string | null
          diajukan_at: string
          diputuskan_oleh: string | null
          diputuskan_at: string | null
          catatan_keputusan: string | null
          tanggal_pembatalan: string | null
          jurnal_pembalik_id: string | null
        }
        Insert: {
          id?: string
          pembayaran_id: string
          snapshot: Json
          alasan: string
          status?: string
          diajukan_oleh?: string | null
          diajukan_at?: string
          diputuskan_oleh?: string | null
          diputuskan_at?: string | null
          catatan_keputusan?: string | null
          tanggal_pembatalan?: string | null
          jurnal_pembalik_id?: string | null
        }
        Update: {
          id?: string
          pembayaran_id?: string
          snapshot?: Json
          alasan?: string
          status?: string
          diajukan_oleh?: string | null
          diajukan_at?: string
          diputuskan_oleh?: string | null
          diputuskan_at?: string | null
          catatan_keputusan?: string | null
          tanggal_pembatalan?: string | null
          jurnal_pembalik_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pembatalan_pembayaran_pengajuan_diajukan_oleh_fkey"
            columns: ["diajukan_oleh"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pembatalan_pembayaran_pengajuan_diputuskan_oleh_fkey"
            columns: ["diputuskan_oleh"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      rencana_tagihan_siswa: {
        Row: {
          id: string
          siswa_id: string
          jenis_id: string
          nominal: number
          mulai: string
          selesai: string
          sampai_akhir_jenjang: boolean
          aktif: boolean
          created_by: string | null
          created_at: string
          updated_at: string
          dinonaktifkan_at: string | null
          dinonaktifkan_oleh: string | null
          dinonaktifkan_alasan: string | null
          bulan_terakhir: number
        }
        Insert: {
          id?: string
          siswa_id: string
          jenis_id: string
          nominal: number
          mulai: string
          selesai: string
          sampai_akhir_jenjang?: boolean
          aktif?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
          dinonaktifkan_at?: string | null
          dinonaktifkan_oleh?: string | null
          dinonaktifkan_alasan?: string | null
          bulan_terakhir?: number
        }
        Update: {
          id?: string
          siswa_id?: string
          jenis_id?: string
          nominal?: number
          mulai?: string
          selesai?: string
          sampai_akhir_jenjang?: boolean
          aktif?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
          dinonaktifkan_at?: string | null
          dinonaktifkan_oleh?: string | null
          dinonaktifkan_alasan?: string | null
          bulan_terakhir?: number
        }
        Relationships: [
          {
            foreignKeyName: "rencana_tagihan_siswa_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rencana_tagihan_siswa_dinonaktifkan_oleh_fkey"
            columns: ["dinonaktifkan_oleh"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rencana_tagihan_siswa_jenis_id_fkey"
            columns: ["jenis_id"]
            isOneToOne: false
            referencedRelation: "jenis_pembayaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rencana_tagihan_siswa_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: false
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permission_log: {
        Row: {
          id: string
          role: string
          granted: string[]
          revoked: string[]
          changed_by: string | null
          changed_at: string
        }
        Insert: {
          id?: string
          role: string
          granted?: string[]
          revoked?: string[]
          changed_by?: string | null
          changed_at?: string
        }
        Update: {
          id?: string
          role?: string
          granted?: string[]
          revoked?: string[]
          changed_by?: string | null
          changed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permission_log_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          role: string
          permission: string
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          role: string
          permission: string
          updated_by?: string | null
          updated_at?: string
        }
        Update: {
          role?: string
          permission?: string
          updated_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      siswa_identitas_audit: {
        Row: {
          id: string
          siswa_id: string
          field_name: string
          old_value: string | null
          new_value: string | null
          changed_by: string | null
          changed_at: string
        }
        Insert: {
          id?: string
          siswa_id: string
          field_name: string
          old_value?: string | null
          new_value?: string | null
          changed_by?: string | null
          changed_at?: string
        }
        Update: {
          id?: string
          siswa_id?: string
          field_name?: string
          old_value?: string | null
          new_value?: string | null
          changed_by?: string | null
          changed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "siswa_identitas_audit_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: false
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
        ]
      }
      siswa_tahun_masuk_departemen: {
        Row: {
          id: string
          siswa_id: string
          departemen_id: string
          tahun_masuk: number
          sumber: string
          keterangan: string | null
          created_at: string
          updated_at: string
          nis: string | null
        }
        Insert: {
          id?: string
          siswa_id: string
          departemen_id: string
          tahun_masuk: number
          sumber?: string
          keterangan?: string | null
          created_at?: string
          updated_at?: string
          nis?: string | null
        }
        Update: {
          id?: string
          siswa_id?: string
          departemen_id?: string
          tahun_masuk?: number
          sumber?: string
          keterangan?: string | null
          created_at?: string
          updated_at?: string
          nis?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "siswa_tahun_masuk_departemen_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "siswa_tahun_masuk_departemen_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: false
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
        ]
      }
      spmb_gelombang: {
        Row: {
          id: string
          nama: string
          tanggal_mulai: string
          tanggal_selesai: string | null
          gratis_pendaftaran: boolean
          aktif: boolean
          urutan: number
          created_at: string
          updated_at: string
          skema_diskon_id: string | null
        }
        Insert: {
          id?: string
          nama: string
          tanggal_mulai: string
          tanggal_selesai?: string | null
          gratis_pendaftaran?: boolean
          aktif?: boolean
          urutan?: number
          created_at?: string
          updated_at?: string
          skema_diskon_id?: string | null
        }
        Update: {
          id?: string
          nama?: string
          tanggal_mulai?: string
          tanggal_selesai?: string | null
          gratis_pendaftaran?: boolean
          aktif?: boolean
          urutan?: number
          created_at?: string
          updated_at?: string
          skema_diskon_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spmb_gelombang_skema_diskon_id_fkey"
            columns: ["skema_diskon_id"]
            isOneToOne: false
            referencedRelation: "skema_diskon"
            referencedColumns: ["id"]
          },
        ]
      }
      spmb_payment_monitor_events: {
        Row: {
          id: number
          siswa_detail_id: string
          tahun_ajaran_id: string
          departemen_id: string
          gelombang_id: string
          registered_at: string
          jenis: string
          skema: string | null
          tahap: number | null
          tenggat: string | null
          catatan: string
          created_by: string
          created_at: string
        }
        Insert: {
          id?: never
          siswa_detail_id: string
          tahun_ajaran_id: string
          departemen_id: string
          gelombang_id: string
          registered_at: string
          jenis: string
          skema?: string | null
          tahap?: number | null
          tenggat?: string | null
          catatan: string
          created_by: string
          created_at?: string
        }
        Update: {
          id?: never
          siswa_detail_id?: string
          tahun_ajaran_id?: string
          departemen_id?: string
          gelombang_id?: string
          registered_at?: string
          jenis?: string
          skema?: string | null
          tahap?: number | null
          tenggat?: string | null
          catatan?: string
          created_by?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "spmb_payment_monitor_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spmb_payment_monitor_events_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spmb_payment_monitor_events_gelombang_id_fkey"
            columns: ["gelombang_id"]
            isOneToOne: false
            referencedRelation: "spmb_gelombang"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spmb_payment_monitor_events_siswa_detail_id_fkey"
            columns: ["siswa_detail_id"]
            isOneToOne: false
            referencedRelation: "siswa_detail"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spmb_payment_monitor_events_tahun_ajaran_id_fkey"
            columns: ["tahun_ajaran_id"]
            isOneToOne: false
            referencedRelation: "tahun_ajaran"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_rekap_keuangan_lembaga: {
        Row: {
          departemen_id: string | null
          kode: string | null
          lembaga: string | null
          tahun: number | null
          total_pembayaran: number | null
        }
        Relationships: []
      }
      v_rekon_antar_lembaga: {
        Row: {
          akun_nama: string | null
          departemen: string | null
          departemen_id: string | null
          kode: string | null
          saldo_neto: number | null
          total_debit: number | null
          total_kredit: number | null
        }
        Relationships: []
      }
      v_saldo_akun_konsolidasi: {
        Row: {
          akun_id: string | null
          jenis: string | null
          kode: string | null
          nama: string | null
          saldo_awal: number | null
          saldo_konsolidasi: number | null
          saldo_normal: string | null
          saldo_sebelum_eliminasi: number | null
          total_debit_jurnal: number | null
          total_kredit_jurnal: number | null
        }
        Relationships: []
      }
      v_status_tutup_buku: {
        Row: {
          aktif: boolean | null
          ditutup: boolean | null
          ditutup_unit_pendidikan: boolean | null
          ditutup_unit_usaha_dana: boolean | null
          tahun_buku: string | null
          tahun_buku_id: string | null
          tanggal_mulai: string | null
          tanggal_selesai: string | null
          tgl_tutup_unit_pendidikan: string | null
          tgl_tutup_unit_usaha_dana: string | null
        }
        Insert: {
          aktif?: boolean | null
          ditutup?: boolean | null
          ditutup_unit_pendidikan?: never
          ditutup_unit_usaha_dana?: never
          tahun_buku?: string | null
          tahun_buku_id?: string | null
          tanggal_mulai?: string | null
          tanggal_selesai?: string | null
          tgl_tutup_unit_pendidikan?: never
          tgl_tutup_unit_usaha_dana?: never
        }
        Update: {
          aktif?: boolean | null
          ditutup?: boolean | null
          ditutup_unit_pendidikan?: never
          ditutup_unit_usaha_dana?: never
          tahun_buku?: string | null
          tahun_buku_id?: string | null
          tanggal_mulai?: string | null
          tanggal_selesai?: string | null
          tgl_tutup_unit_pendidikan?: never
          tgl_tutup_unit_usaha_dana?: never
        }
        Relationships: []
      }
      v_tagihan_belum_bayar: {
        Row: {
          bulan: number | null
          departemen_id: string | null
          departemen_kode: string | null
          departemen_nama: string | null
          jatuh_tempo: string | null
          jenis_id: string | null
          jenis_kelamin: string | null
          jenis_nama: string | null
          kelas_nama: string | null
          menunggak: boolean | null
          nama_siswa: string | null
          nama_tampil: string | null
          nis: string | null
          nominal: number | null
          pembayaran_id: string | null
          siswa_id: string | null
          status: string | null
          sudah_bayar: boolean | null
          tagihan_id: string | null
          tahun_ajaran_id: string | null
          tahun_ajaran_mulai: string | null
          tahun_ajaran_nama: string | null
          tanggal_bayar: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tagihan_pembayaran_id_fkey"
            columns: ["pembayaran_id"]
            isOneToOne: false
            referencedRelation: "pembayaran"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tagihan_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: false
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      preview_uang_pangkal_spmb: {
        Args: { p_siswa_id: string; p_tahun_akademik_id: string; p_alumni_asrama?: string; p_fase_mta?: string | null }
        Returns: Json
      }
      verifikasi_uang_pangkal_spmb: {
        Args: { p_siswa_id: string; p_tahun_akademik_id: string; p_alumni_asrama: string; p_fase_mta: string | null; p_nominal_bruto: number; p_catatan: string | null; p_preview_hash: string; p_confirmed: boolean }
        Returns: Json
      }
      spmb_readiness: {
        Args: { p_siswa_id: string }
        Returns: Json
      }
      can_manage_akademik_departemen: {
        Args: { _user_id: string; _departemen_id: string }
        Returns: boolean
      }
      terbitkan_spp_awal_spmb: {
        Args: {
          p_siswa_id: string
          p_tahun_akademik_id: string
          p_jenis_id: string
          p_bulan_mulai: string
          p_nominal: number
        }
        Returns: Json
      }
      sesuaikan_kategori_spp_periode: {
        Args: { p_siswa_id: string; p_jenis_id: string; p_mulai: string; p_selesai: string; p_kategori: string; p_nominal_bruto: number; p_user_id: string; p_apply?: boolean; p_preview_hash?: string; p_alasan?: string }
        Returns: Json
      }
      nominal_spp_periode: {
        Args: { p_jenis_id: string; p_siswa_id: string; p_periode: string }
        Returns: number
      }
      snapshot_spp_periode: {
        Args: { p_jenis_id: string; p_siswa_id: string; p_periode: string }
        Returns: { kategori: string; akun_id: string }[]
      }
      akui_pendapatan_dimuka_atomik: {
        Args: { p_dimuka_id: string; p_user_id?: string }
        Returns: Json
      }

      akui_pendapatan_dimuka_jatuh_tempo: {
        Args: {
          p_limit?: number
          p_sampai_tanggal?: string
          p_user_id?: string
        }
        Returns: {
          diakui: number
          errors: string[]
          total_nominal: number
        }[]
      }
      batalkan_pembayaran_atomik: {
        Args: {
          p_alasan: string
          p_pembayaran_id: string
          p_tanggal: string
          p_user_id: string
        }
        Returns: Json
      }
      batalkan_tagihan_atomik: {
        Args: {
          p_alasan: string
          p_mode: string
          p_nominal_baru?: number
          p_tagihan_id: string
          p_tanggal: string
          p_user_id: string
        }
        Returns: Json
      }
      batalkan_tagihan_batch: {
        Args: {
          p_alasan: string
          p_tagihan_ids: string[]
          p_tanggal: string
          p_user_id: string
        }
        Returns: {
          berhasil: boolean
          error_message: string
          tagihan_id: string
        }[]
      }
      buku_besar_mutasi: {
        Args: {
          p_akun_id: string
          p_departemen_ids?: string[]
          p_exclude_koreksi?: boolean
          p_include_penutup?: boolean
          p_tgl_akhir: string
          p_tgl_awal: string
        }
        Returns: {
          debit: number
          keterangan: string
          kredit: number
          lembaga: string
          nomor: string
          tanggal: string
          tipe: string
        }[]
      }
      buku_besar_saldo_awal: {
        Args: {
          p_akun_id: string
          p_departemen_ids?: string[]
          p_exclude_koreksi?: boolean
          p_tgl_awal: string
        }
        Returns: number
      }
      daftarkan_push_token: {
        Args: { p_device_name?: string; p_platform?: string; p_token: string }
        Returns: undefined
      }
      fn_cari_kandidat_pasangan: {
        Args: {
          p_akun_kode?: string
          p_hari_toleransi?: number
          p_jurnal_id: string
        }
        Returns: {
          debit: number
          departemen: string
          jurnal_id: string
          keterangan: string
          kredit: number
          net: number
          nomor: string
          skor_kecocokan: number
          tanggal: string
        }[]
      }
      generate_nomor_jurnal: {
        Args: { p_prefix: string; p_tahun: number }
        Returns: string
      }
      generate_tagihan_batch: {
        Args: {
          p_bulan: number
          p_created_by: string
          p_departemen_id: string
          p_jenis_id: string
          p_siswa_list: Json
          p_tahun_ajaran_id: string
        }
        Returns: {
          errors: string[]
          generated: number
          scheduled: number
          skipped: number
        }[]
      }
      get_detail_jurnal_kas:
        | {
            Args: {
              p_akun_kas_ids: string[]
              p_departemen_id?: string
              p_tahun: number
            }
            Returns: {
              akun_id: string
              debit: number
              jurnal_id: string
              kredit: number
            }[]
          }
        | {
            Args: {
              p_akun_kas_ids: string[]
              p_departemen_id?: string
              p_kategori?: string[]
              p_tahun: number
            }
            Returns: {
              akun_id: string
              debit: number
              jurnal_id: string
              kredit: number
            }[]
          }
        | {
            Args: {
              p_akun_kas_ids: string[]
              p_departemen_ids?: string[]
              p_tahun: number
            }
            Returns: {
              akun_id: string
              debit: number
              jurnal_id: string
              kredit: number
            }[]
          }
      get_detail_jurnal_kas_range: {
        Args: {
          p_akun_kas_ids: string[]
          p_departemen_ids?: string[]
          p_tgl_akhir: string
          p_tgl_awal: string
        }
        Returns: {
          akun_id: string
          debit: number
          jurnal_id: string
          kredit: number
        }[]
      }
      get_my_pegawai_id: { Args: { _user_id: string }; Returns: string }
      get_my_siswa_id: { Args: { _user_id: string }; Returns: string }
      get_siswa_tahun_masuk: { Args: { p_siswa_id: string }; Returns: number }
      get_tarif_siswa: {
        Args: {
          p_angkatan_id?: string
          p_jenis_id: string
          p_kelas_id?: string
          p_siswa_id: string
          p_tahun_ajaran_id?: string
        }
        Returns: number
      }
      get_user_role: { Args: { _user_id: string }; Returns: string }
      guru_teaches_class: {
        Args: { _kelas_id: string; _user_id: string }
        Returns: boolean
      }
      guru_teaches_mapel: {
        Args: { _mapel_id: string; _user_id: string }
        Returns: boolean
      }
      has_role: { Args: { _role: string; _user_id: string }; Returns: boolean }
      hitung_bulan_periode_tagihan: {
        Args: { p_bulan: number; p_periode_id: string }
        Returns: string
      }
      hitung_diskon_tagihan: {
        Args: {
          p_bulan: number
          p_jenis_id: string
          p_nominal_bruto: number
          p_periode_id: string
          p_siswa_id: string
        }
        Returns: {
          nominal_diskon: number
          siswa_diskon_id: string
        }[]
      }
      hitung_jatuh_tempo_tagihan: {
        Args: { p_bulan: number; p_hari?: number; p_periode_id: string }
        Returns: string
      }
      hitung_laba_rugi_komersial: {
        Args: { p_departemen_id: string }
        Returns: Json
      }
      hitung_laporan_dana: { Args: { p_departemen_id: string }; Returns: Json }
      hitung_mutasi_akun: {
        Args: { p_departemen_ids?: string[]; p_tahun: number }
        Returns: {
          akun_id: string
          total_debit: number
          total_kredit: number
        }[]
      }
      hitung_mutasi_akun_incl_draft: {
        Args: { p_departemen_ids?: string[]; p_tahun: number }
        Returns: {
          akun_id: string
          total_debit: number
          total_kredit: number
        }[]
      }
      hitung_mutasi_akun_range: {
        Args: {
          p_departemen_ids?: string[]
          p_tgl_akhir: string
          p_tgl_awal: string
        }
        Returns: {
          akun_id: string
          total_debit: number
          total_kredit: number
        }[]
      }
      hitung_mutasi_akun_range_incl_draft: {
        Args: {
          p_departemen_ids?: string[]
          p_tgl_akhir: string
          p_tgl_awal: string
        }
        Returns: {
          akun_id: string
          total_debit: number
          total_kredit: number
        }[]
      }
      hitung_saldo_akun_per_kategori: {
        Args: {
          p_kategori: string[]
          p_tanggal_mulai: string
          p_tanggal_selesai: string
        }
        Returns: {
          akun_id: string
          total_debit: number
          total_kredit: number
        }[]
      }
      is_admin_or_kepala: { Args: { _user_id: string }; Returns: boolean }
      is_ortu_of: {
        Args: { p_siswa_id: string; p_user_id: string }
        Returns: boolean
      }
      is_own_pegawai: {
        Args: { _pegawai_id: string; _user_id: string }
        Returns: boolean
      }
      is_own_siswa: {
        Args: { _siswa_id: string; _user_id: string }
        Returns: boolean
      }
      is_penyetuju_diskon: { Args: { _user_id: string }; Returns: boolean }
      is_periode_ditutup: { Args: { p_tanggal: string }; Returns: boolean }
      is_unit_locked_for_transaksi: {
        Args: { p_departemen_id?: string; p_tanggal: string }
        Returns: boolean
      }
      is_unit_pendidikan_ditutup: {
        Args: { p_tahun_ajaran_id: string }
        Returns: boolean
      }
      isi_saldo_awal_isak35: {
        Args: {
          p_kategori: string[]
          p_tahun_ditutup: number
          p_tgl_mulai: string
          p_tgl_selesai: string
        }
        Returns: number
      }
      jalankan_akrual_jatuh_tempo: {
        Args: {
          p_limit?: number
          p_sampai_tanggal?: string
          p_user_id?: string
        }
        Returns: Json
      }
      konfirmasi_kelompok_keluarga: {
        Args: {
          p_keterangan?: string
          p_nama: string
          p_siswa_ids: string[]
          p_user_id?: string
        }
        Returns: string
      }
      migrate_jurnal_batch: { Args: { batch: Json }; Returns: Json }
      posting_piutang_jatuh_tempo: {
        Args: {
          p_limit?: number
          p_sampai_tanggal?: string
          p_user_id?: string
        }
        Returns: {
          diposting: number
          errors: string[]
          total_nominal: number
        }[]
      }
      proses_pembayaran_atomik: {
        Args: {
          p_bulan: number
          p_departemen_id: string
          p_is_bayar_dimuka: boolean
          p_jenis_id: string
          p_jenis_nama: string
          p_jumlah: number
          p_kas_akun_id: string
          p_keterangan: string
          p_kredit_akun_id: string
          p_kredit_label: string
          p_petugas_id: string
          p_prefix_jurnal: string
          p_siswa_id: string
          p_tagihan_id: string
          p_tahun_ajaran_id: string
          p_tanggal_bayar: string
        }
        Returns: Json
      }
      proses_pembayaran_midtrans_atomik: {
        Args: {
          p_bulan: number
          p_departemen_id: string
          p_jenis_id: string
          p_jenis_nama: string
          p_jumlah: number
          p_kas_akun_id: string
          p_kredit_akun_id: string
          p_order_id: string
          p_payment_type: string
          p_siswa_id: string
          p_tahun_ajaran_id: string
          p_tanggal_bayar: string
          p_transaksi_item_id: string
        }
        Returns: Json
      }
      putuskan_diskon_siswa: {
        Args: {
          p_alasan?: string
          p_setujui: boolean
          p_siswa_diskon_id: string
          p_user_id: string
        }
        Returns: Json
      }
      saran_kelompok_keluarga: {
        Args: { p_limit?: number }
        Returns: {
          jumlah_siswa: number
          kunci: string
          siswa: Json
          skor: number
          sumber: string
        }[]
      }
      sync_id_santri_pihak3: {
        Args: { p_updates: Json }
        Returns: Json
      }
      terapkan_diskon_siswa: {
        Args: { p_siswa_diskon_id: string; p_user_id?: string }
        Returns: Json
      }
      admin_set_admin_tu_scope: {
        Args: {
          p_user_id: string
          p_departemen_ids: string[]
        }
        Returns: string[]
      }
      ajukan_pembatalan_pembayaran: {
        Args: {
          p_pembayaran_id: string
          p_alasan: string
          p_actor_id: string
        }
        Returns: string
      }
      akademik_adopt_spmb_migration: {
        Args: {
          p_siswa_id: string
          p_current: Json
          p_kelas: Json
          p_nik_dapodik?: string
        }
        Returns: Json
      }
      akademik_find_spmb_migration_candidates: {
        Args: {
          p_nisns?: string[]
          p_niks?: string[]
        }
        Returns: {
          id: string
          nis: string
          nisn: string
          status: string
          departemen_id: string
          nik: string
          nik_dapodik: string
          spmb_gelombang_id: string
          spmb_siswa_internal: boolean
        }[]
      }
      akademik_internal_transfer_reference: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      akademik_managed_departemen_ids: {
        Args: Record<PropertyKey, never>
        Returns: {
          departemen_id: string
        }[]
      }
      akademik_mutasi: {
        Args: {
          p_ids: string[]
          p_action: string
          p_kelas_id?: string
          p_tahun_ajaran_id?: string
        }
        Returns: number
      }
      akademik_mutasi_antar_lembaga: {
        Args: {
          p_siswa_id: string
          p_departemen_tujuan_id: string
          p_angkatan_tujuan_id: string
          p_kelas_tujuan_id: string
          p_tahun_ajaran_id: string
          p_alasan: string
          p_status_asrama?: string
        }
        Returns: Json
      }
      akademik_pindah_keluar: {
        Args: {
          p_ids: string[]
          p_tanggal_efektif: string
        }
        Returns: number
      }
      akademik_save_siswa: {
        Args: {
          p_siswa: Json
          p_detail?: Json
          p_kelas?: Json
          p_id?: string
        }
        Returns: Json
      }
      batalkan_pembayaran_dengan_kuitansi_atomik: {
        Args: {
          p_pembayaran_id: string
          p_alasan: string
          p_tanggal: string
          p_user_id: string
        }
        Returns: Json
      }
      batalkan_pengajuan_pembatalan: {
        Args: {
          p_pengajuan_id: string
          p_actor_id: string
        }
        Returns: undefined
      }
      buat_versi_kebijakan_keringanan: {
        Args: {
          p_kode: string
          p_nama: string
          p_skema_diskon_id: string
          p_jenis_id: string
          p_kelas_regex: string
          p_tipe: string
          p_nilai: number
          p_otomatis: boolean
          p_perlu_pengajuan: boolean
          p_berlaku_mulai: string
          p_berlaku_selesai: string
          p_keterangan: string
          p_user_id: string
        }
        Returns: Database["public"]["Tables"]["kebijakan_keringanan"]["Row"]
      }
      claim_midtrans_reconciliation: {
        Args: {
          p_timestamp: number
          p_signature: string
        }
        Returns: boolean
      }
      get_legacy_outstanding_breakdown: {
        Args: {
          p_siswa_id: string
        }
        Returns: {
          kode_lama: string
          nama_lama: string
          nominal: number
          breakdown_total: number
          current_total: number
          exact_match: boolean
        }[]
      }
      get_midtrans_reconciliation_candidates: {
        Args: Record<PropertyKey, never>
        Returns: Database["public"]["Tables"]["transaksi_midtrans"]["Row"][]
      }
      hapus_siswa: {
        Args: {
          p_siswa_id: string
          p_actor_id: string
        }
        Returns: Json
      }
      nonaktifkan_override_tarif: {
        Args: {
          p_tarif_id: string
          p_alasan: string
        }
        Returns: Json
      }
      proses_pembayaran_dengan_kuitansi_atomik: {
        Args: {
          p_siswa_id: string
          p_jenis_id: string
          p_bulan: number
          p_jumlah: number
          p_tanggal_bayar: string
          p_keterangan: string
          p_departemen_id: string
          p_tahun_ajaran_id: string
          p_is_bayar_dimuka: boolean
          p_tagihan_id: string
          p_kas_akun_id: string
          p_kredit_akun_id: string
          p_kredit_label: string
          p_prefix_jurnal: string
          p_petugas_id: string
          p_jenis_nama: string
          p_receipt_id?: string
          p_source?: string
          p_payment_method?: string
        }
        Returns: Json
      }
      proses_pembayaran_midtrans_dengan_kuitansi_atomik: {
        Args: {
          p_transaksi_item_id: string
          p_siswa_id: string
          p_jenis_id: string
          p_bulan: number
          p_jumlah: number
          p_tanggal_bayar: string
          p_departemen_id: string
          p_tahun_ajaran_id: string
          p_order_id: string
          p_payment_type: string
          p_kas_akun_id: string
          p_kredit_akun_id: string
          p_jenis_nama: string
        }
        Returns: Json
      }
      set_role_permissions: {
        Args: {
          p_role: string
          p_permissions: string[]
          p_actor_id: string
        }
        Returns: Json
      }
      setujui_pembatalan_pembayaran: {
        Args: {
          p_pengajuan_id: string
          p_actor_id: string
          p_tanggal: string
          p_catatan: string
        }
        Returns: Json
      }
      simpan_tarif_generate_dan_rencana_atomik: {
        Args: {
          p_tarif_rows: Json
          p_tahun_akademik_id: string
          p_jenis_id: string
          p_generate_groups: Json
          p_departemen_id?: string
          p_siswa_ids?: string[]
          p_siswa_id?: string
          p_kelas_id?: string
          p_angkatan_id?: string
          p_sampai_akhir_jenjang?: boolean
          p_rencana_mulai?: string
        }
        Returns: Json
      }
      simpan_tarif_generate_dan_rencana_fleksibel_atomik: {
        Args: {
          p_tarif_rows: Json
          p_tahun_akademik_id: string
          p_jenis_id: string
          p_generate_groups: Json
          p_departemen_id?: string
          p_siswa_ids?: string[]
          p_siswa_id?: string
          p_kelas_id?: string
          p_angkatan_id?: string
          p_mode_akhir?: string
          p_rencana_mulai?: string
          p_rencana_selesai?: string
        }
        Returns: Json
      }
      simpan_tarif_generate_rencana_massal_atomik: {
        Args: {
          p_tarif_rows: Json
          p_tahun_akademik_id: string
          p_jenis_id: string
          p_generate_groups: Json
          p_rencana_rows: Json
          p_rencana_mulai: string
          p_bulan_terakhir?: number
        }
        Returns: Json
      }
      sinkronkan_diskon_kakak_adik_keluarga: {
        Args: {
          p_keluarga_id: string
          p_tanggal?: string
        }
        Returns: Json
      }
      spmb_activate_internal_student: {
        Args: {
          p_siswa_id: string
          p_kelas_id: string
          p_tahun_ajaran_id: string
        }
        Returns: Json
      }
      spmb_admin_register: {
        Args: {
          p_payload: Json
        }
        Returns: Json
      }
      spmb_change_registration_target: {
        Args: {
          p_siswa_id: string
          p_departemen_tujuan_id: string
          p_angkatan_tujuan_id: string
          p_status_asrama: string
          p_alasan: string
        }
        Returns: Json
      }
      spmb_mark_lulus_and_accept: {
        Args: {
          p_siswa_id: string
        }
        Returns: Json
      }
      spmb_mark_milestone: {
        Args: {
          p_siswa_id: string
          p_action: string
        }
        Returns: string
      }
      spmb_mark_verified: {
        Args: {
          p_siswa_id: string
          p_version: string
        }
        Returns: Json
      }
      spmb_readiness_list: {
        Args: {
          p_ids: string[]
        }
        Returns: {
          siswa_id: string
          readiness: Json
        }[]
      }
      spmb_set_field_verifications: {
        Args: {
          p_siswa_id: string
          p_changes: Json
          p_version: string
        }
        Returns: Json
      }
      spmb_set_registration_status: {
        Args: {
          p_siswa_id: string
          p_status: string
        }
        Returns: string
      }
      spmb_target_change_reference: {
        Args: {
          p_siswa_id: string
        }
        Returns: Json
      }
      spmb_verification_state: {
        Args: {
          p_siswa_id: string
        }
        Returns: Json
      }
      spmb_verification_state_list: {
        Args: {
          p_ids: string[]
        }
        Returns: {
          siswa_id: string
          verification: Json
        }[]
      }
      spmb_visible_siswa_ids: {
        Args: Record<PropertyKey, never>
        Returns: {
          siswa_id: string
        }[]
      }
      spmb_withdraw_registration: {
        Args: {
          p_siswa_id: string
          p_alasan: string
          p_tanggal_efektif: string
          p_actor_id: string
        }
        Returns: Json
      }
      terbitkan_ulang_tagihan_batal: {
        Args: {
          p_tagihan_id: string
          p_nominal_bruto: number
          p_alasan: string
          p_apply?: boolean
          p_preview_hash?: string
          p_alumni_asrama?: string
          p_fase_mta?: string
          p_catatan?: string
        }
        Returns: Json
      }
      tolak_pembatalan_pembayaran: {
        Args: {
          p_pengajuan_id: string
          p_actor_id: string
          p_catatan: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const