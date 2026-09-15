import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ─── Period Lock Check (unit-aware) ───
//
// Logika tutup buku dipisah per unit:
//   - Unit Pendidikan  → kolom tahun_ajaran.ditutup = true, SEKALIGUS ada log_tutup_buku dengan unit='unit_pendidikan'
//   - Unit Usaha & Dana → HANYA cek log_tutup_buku dengan unit='unit_usaha_dana'
//
// Kategori departemen:
//   unit_pendidikan   → ['unit_pendidikan']
//   unit_usaha_dana   → ['unit_usaha', 'unit_dana_terikat', 'unit_yayasan']
//
// Jika departemen_id tidak diberikan (atau null), anggap unit_pendidikan (lebih ketat).
export async function checkPeriodeLocked(tanggal: string, departemenId?: string | null): Promise<void> {
  // 1. Cari tahun_buku yang mencakup tanggal ini
  const { data: tbList } = await supabase
    .from("tahun_buku" as any)
    .select("id, nama, ditutup, tanggal_mulai, tanggal_selesai")
    .lte("tanggal_mulai", tanggal)
    .gte("tanggal_selesai", tanggal)
    .limit(1);
  const tb = ((tbList as any[]) || [])[0];
  if (!tb) return; // tidak ada tahun buku untuk tanggal ini → bebas

  // 2. Tentukan kategori unit dari departemen_id
  let unitDept: string = "unit_pendidikan"; // default → lebih ketat
  if (departemenId) {
    const { data: dept } = await supabase
      .from("departemen")
      .select("kategori")
      .eq("id", departemenId)
      .maybeSingle();
    const kat = (dept as any)?.kategori as string | null;
    if (kat && ["unit_usaha", "unit_dana_terikat", "unit_yayasan"].includes(kat)) {
      unitDept = "unit_usaha_dana";
    }
  }

  // 3. Cek apakah log_tutup_buku untuk unit + tahun_buku ini sudah ada
  const { data: logRows } = await supabase
    .from("log_tutup_buku" as any)
    .select("id")
    .eq("tahun_ajaran_id", tb.id)
    .eq("unit", unitDept)
    .limit(1);

  if (logRows && (logRows as any[]).length > 0) {
    const unitLabel = unitDept === "unit_pendidikan" ? "Unit Pendidikan" : "Unit Usaha & Dana";
    throw new Error(
      `Transaksi ditolak: periode "${tb.nama}" untuk ${unitLabel} sudah ditutup buku.`
    );
  }
}

// ─── LEMBAGA (Departemen) ───
export function useLembaga() {
  return useQuery({
    queryKey: ["lembaga_list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("departemen")
        .select("id, nama, kode, keterangan")
        .eq("aktif", true)
        .order("nama");
      if (error) throw error;
      return data || [];
    },
  });
}

// ─── Jenis Pembayaran ───
export function useJenisPembayaran(departemenId?: string) {
  return useQuery({
    queryKey: ["jenis_pembayaran", "aktif", departemenId],
    queryFn: async () => {
      let q = supabase
        .from("jenis_pembayaran")
        .select("id, nama, nominal, keterangan, departemen_id, akun_pendapatan_id, tipe")
        .eq("aktif", true)
        .order("nama");
      if (departemenId) {
        q = q.or(`departemen_id.eq.${departemenId},departemen_id.is.null`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });
}

// ─── Jenis Pengeluaran ───
export function useJenisPengeluaran(departemenId?: string) {
  return useQuery({
    queryKey: ["jenis_pengeluaran", "aktif", departemenId],
    queryFn: async () => {
      let q = supabase
        .from("jenis_pengeluaran")
        .select("id, nama, keterangan, departemen_id, akun_beban_id")
        .eq("aktif", true)
        .order("nama");
      if (departemenId) {
        q = q.or(`departemen_id.eq.${departemenId},departemen_id.is.null`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });
}

export function useAllJenisPengeluaran() {
  return useQuery({
    queryKey: ["jenis_pengeluaran", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jenis_pengeluaran")
        .select("id, nama, keterangan, aktif, departemen_id, akun_beban_id, departemen:departemen_id(nama, kode), akun_beban:akun_beban_id(id, kode, nama)")
        .order("nama");
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useAllJenisPembayaran() {
  return useQuery({
    queryKey: ["jenis_pembayaran", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jenis_pembayaran")
        .select("id, nama, nominal, keterangan, aktif, departemen_id, akun_pendapatan_id, akun_dimuka_id, perlu_dimuka, tipe, tahun_masuk_dari, tahun_masuk_sampai, departemen:departemen_id(nama, kode), akun_pendapatan:akun_pendapatan_id(id, kode, nama), akun_dimuka:akun_dimuka_id(id, kode, nama)")
        .order("nama");
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

// ─── Pembayaran ───
export function usePembayaranBySiswa(siswaId?: string) {
  return useQuery({
    queryKey: ["pembayaran", siswaId],
    enabled: !!siswaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pembayaran")
        .select("*, jenis_pembayaran:jenis_id(nama, nominal)")
        .eq("siswa_id", siswaId!)
        .order("tanggal_bayar", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreatePembayaran() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      siswa_id: string;
      jenis_id: string;
      bulan: number;
      jumlah: number;
      tanggal_bayar: string;
      tahun_ajaran_id?: string;
      keterangan?: string;
      departemen_id?: string;
    }) => {
      // Check period lock — pembayaran selalu unit_pendidikan
      await checkPeriodeLocked(values.tanggal_bayar, values.departemen_id ?? null);
      const { data, error } = await supabase
        .from("pembayaran")
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pembayaran"] });
      qc.invalidateQueries({ queryKey: ["rekap"] });
      toast.success("Pembayaran berhasil disimpan");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ─── Pengeluaran ───
export function usePengeluaranList(bulan?: number, tahun?: number, departemenId?: string) {
  return useQuery({
    queryKey: ["pengeluaran", bulan, tahun, departemenId],
    queryFn: async () => {
      let q = supabase
        .from("pengeluaran")
        .select("*, jenis_pengeluaran:jenis_id(nama), departemen:departemen_id(nama, kode), jurnal:jurnal_id(id, nomor)")
        .order("tanggal", { ascending: false });
      if (bulan != null && tahun != null) {
        const start = `${tahun}-${String(bulan).padStart(2, "0")}-01`;
        const endMonth = bulan === 12 ? 1 : bulan + 1;
        const endYear = bulan === 12 ? tahun + 1 : tahun;
        const end = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;
        q = q.gte("tanggal", start).lt("tanggal", end);
      }
      if (departemenId) {
        q = q.eq("departemen_id", departemenId);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useCreatePengeluaran() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: { jenis_id: string; jumlah: number; tanggal: string; keterangan?: string; departemen_id?: string }) => {
      // Check period lock — teruskan departemenId agar pengeluaran Unit Usaha & Dana
      // tidak diblokir hanya karena Unit Pendidikan sudah tutup buku.
      await checkPeriodeLocked(values.tanggal, values.departemen_id ?? null);
      const { data, error } = await supabase
        .from("pengeluaran")
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pengeluaran"] });
      qc.invalidateQueries({ queryKey: ["rekap"] });
      toast.success("Pengeluaran berhasil disimpan");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdatePengeluaran() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: { id: string; jenis_id?: string; jumlah?: number; tanggal?: string; keterangan?: string; departemen_id?: string }) => {
      const { error } = await supabase.from("pengeluaran").update(values).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pengeluaran"] });
      toast.success("Pengeluaran berhasil diperbarui");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeletePengeluaran() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pengeluaran").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pengeluaran"] });
      toast.success("Pengeluaran berhasil dihapus");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ─── Tabungan ───
export function useTabunganSiswa(siswaId?: string) {
  return useQuery({
    queryKey: ["tabungan", siswaId],
    enabled: !!siswaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tabungan_siswa")
        .select("*")
        .eq("siswa_id", siswaId!)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });
}

export function useTransaksiTabunganList(siswaId?: string) {
  return useQuery({
    queryKey: ["transaksi_tabungan", siswaId],
    enabled: !!siswaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transaksi_tabungan")
        .select("*")
        .eq("siswa_id", siswaId!)
        .order("tanggal", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useTransaksiTabungan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      siswa_id: string;
      jenis: "setor" | "ambil";
      jumlah: number;
      tanggal: string;
      keterangan?: string;
    }) => {
      const { data: tabungan } = await supabase
        .from("tabungan_siswa")
        .select("saldo")
        .eq("siswa_id", values.siswa_id)
        .maybeSingle();

      const currentSaldo = Number((tabungan as any)?.saldo || 0);
      const newSaldo = values.jenis === "setor"
        ? currentSaldo + values.jumlah
        : currentSaldo - values.jumlah;

      if (newSaldo < 0) throw new Error("Saldo tidak mencukupi");

      // Jurnal ikut lembaga siswa agar masuk laporan per gabungan unit
      const { data: siswaRow } = await supabase
        .from("siswa")
        .select("departemen_id")
        .eq("id", values.siswa_id)
        .maybeSingle();
      const departemenId = (siswaRow as any)?.departemen_id ?? null;
      await checkPeriodeLocked(values.tanggal, departemenId);

      // Auto-jurnal
      let jurnalId: string | null = null;
      const { data: pengaturan } = await supabase.from("pengaturan_akun").select("kode_setting, akun_id");
      const kasAkunId = pengaturan?.find(p => p.kode_setting === "kas_tunai")?.akun_id;
      const tabunganAkunId = pengaturan?.find(p => p.kode_setting === "tabungan_siswa")?.akun_id;

      if (kasAkunId && tabunganAkunId) {
        const tahun = new Date(values.tanggal).getFullYear();
        const { data: nomor } = await supabase.rpc("generate_nomor_jurnal", { p_prefix: "JT", p_tahun: tahun });
        if (nomor) {
          const debitAkun = values.jenis === "setor" ? kasAkunId : tabunganAkunId;
          const kreditAkun = values.jenis === "setor" ? tabunganAkunId : kasAkunId;
          const ket = `Tabungan siswa ${values.jenis} - ${values.keterangan || ""}`.trim();

          const { data: jurnal } = await supabase.from("jurnal").insert({
            nomor, tanggal: values.tanggal, keterangan: ket, departemen_id: departemenId,
            total_debit: values.jumlah, total_kredit: values.jumlah, status: "posted",
          }).select().single();

          if (jurnal) {
            jurnalId = (jurnal as any).id;
            await supabase.from("jurnal_detail").insert([
              { jurnal_id: jurnalId, akun_id: debitAkun, keterangan: ket, debit: values.jumlah, kredit: 0, urutan: 1 },
              { jurnal_id: jurnalId, akun_id: kreditAkun, keterangan: ket, debit: 0, kredit: values.jumlah, urutan: 2 },
            ]);
          }
        }
      }

      const { error: txError } = await supabase
        .from("transaksi_tabungan")
        .insert({ ...values, saldo_sesudah: newSaldo, jurnal_id: jurnalId });
      if (txError) throw txError;

      if (tabungan) {
        const { error } = await supabase
          .from("tabungan_siswa")
          .update({ saldo: newSaldo, updated_at: new Date().toISOString() })
          .eq("siswa_id", values.siswa_id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("tabungan_siswa")
          .insert({ siswa_id: values.siswa_id, saldo: newSaldo });
        if (error) throw error;
      }
      return newSaldo;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tabungan"] });
      qc.invalidateQueries({ queryKey: ["transaksi_tabungan"] });
      qc.invalidateQueries({ queryKey: ["jurnal"] });
      toast.success("Transaksi tabungan berhasil");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ─── Tabungan Pegawai ───
export function useTabunganPegawai(pegawaiId?: string) {
  return useQuery({
    queryKey: ["tabungan_pegawai", pegawaiId],
    enabled: !!pegawaiId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tabungan_pegawai")
        .select("*")
        .eq("pegawai_id", pegawaiId!)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });
}

export function useTransaksiTabunganPegawaiList(pegawaiId?: string) {
  return useQuery({
    queryKey: ["transaksi_tabungan_pegawai", pegawaiId],
    enabled: !!pegawaiId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transaksi_tabungan_pegawai")
        .select("*")
        .eq("pegawai_id", pegawaiId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });
}

export function useTransaksiTabunganPegawai() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      pegawai_id: string;
      jenis: "setor" | "ambil";
      jumlah: number;
      tanggal: string;
      keterangan?: string;
    }) => {
      const { data: tabungan } = await supabase
        .from("tabungan_pegawai")
        .select("saldo")
        .eq("pegawai_id", values.pegawai_id)
        .maybeSingle();

      const currentSaldo = Number((tabungan as any)?.saldo || 0);
      const newSaldo = values.jenis === "setor"
        ? currentSaldo + values.jumlah
        : currentSaldo - values.jumlah;

      if (newSaldo < 0) throw new Error("Saldo tidak mencukupi");

      // Jurnal ikut lembaga pegawai agar masuk laporan per gabungan unit
      const { data: pegawaiRow } = await supabase
        .from("pegawai")
        .select("departemen_id")
        .eq("id", values.pegawai_id)
        .maybeSingle();
      const departemenId = (pegawaiRow as any)?.departemen_id ?? null;
      await checkPeriodeLocked(values.tanggal, departemenId);

      // Auto-jurnal
      let jurnalId: string | null = null;
      const { data: pengaturan } = await supabase.from("pengaturan_akun").select("kode_setting, akun_id");
      const kasAkunId = pengaturan?.find(p => p.kode_setting === "kas_tunai")?.akun_id;
      const tabunganAkunId = pengaturan?.find(p => p.kode_setting === "tabungan_pegawai")?.akun_id;

      if (kasAkunId && tabunganAkunId) {
        const tahun = new Date(values.tanggal).getFullYear();
        const { data: nomor } = await supabase.rpc("generate_nomor_jurnal", { p_prefix: "JT", p_tahun: tahun });
        if (nomor) {
          const debitAkun = values.jenis === "setor" ? kasAkunId : tabunganAkunId;
          const kreditAkun = values.jenis === "setor" ? tabunganAkunId : kasAkunId;
          const ket = `Tabungan pegawai ${values.jenis} - ${values.keterangan || ""}`.trim();

          const { data: jurnal } = await supabase.from("jurnal").insert({
            nomor, tanggal: values.tanggal, keterangan: ket, departemen_id: departemenId,
            total_debit: values.jumlah, total_kredit: values.jumlah, status: "posted",
          }).select().single();

          if (jurnal) {
            jurnalId = (jurnal as any).id;
            await supabase.from("jurnal_detail").insert([
              { jurnal_id: jurnalId, akun_id: debitAkun, keterangan: ket, debit: values.jumlah, kredit: 0, urutan: 1 },
              { jurnal_id: jurnalId, akun_id: kreditAkun, keterangan: ket, debit: 0, kredit: values.jumlah, urutan: 2 },
            ]);
          }
        }
      }

      const { error: txError } = await supabase
        .from("transaksi_tabungan_pegawai")
        .insert({ ...values, saldo_sesudah: newSaldo, jurnal_id: jurnalId } as any);
      if (txError) throw txError;

      if (tabungan) {
        const { error } = await supabase
          .from("tabungan_pegawai")
          .update({ saldo: newSaldo, updated_at: new Date().toISOString() })
          .eq("pegawai_id", values.pegawai_id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("tabungan_pegawai")
          .insert({ pegawai_id: values.pegawai_id, saldo: newSaldo } as any);
        if (error) throw error;
      }
      return newSaldo;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tabungan_pegawai"] });
      qc.invalidateQueries({ queryKey: ["transaksi_tabungan_pegawai"] });
      qc.invalidateQueries({ queryKey: ["jurnal"] });
      toast.success("Transaksi tabungan pegawai berhasil");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ─── Rekap ───
export function useRekapPembayaranBulanan(tahun?: number) {
  const y = tahun || new Date().getFullYear();
  return useQuery({
    queryKey: ["rekap", "pembayaran", y],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pembayaran")
        .select("bulan, jumlah")
        .gte("tanggal_bayar", `${y}-01-01`)
        .lte("tanggal_bayar", `${y}-12-31`);
      if (error) throw error;
      const result = Array.from({ length: 12 }, (_, i) => ({
        bulan: i + 1,
        total: 0,
      }));
      data?.forEach((r) => {
        if (r.bulan && r.bulan >= 1 && r.bulan <= 12) {
          result[r.bulan - 1].total += Number(r.jumlah || 0);
        }
      });
      return result;
    },
  });
}

export function useRekapPengeluaranBulanan(tahun?: number) {
  const y = tahun || new Date().getFullYear();
  return useQuery({
    queryKey: ["rekap", "pengeluaran", y],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pengeluaran")
        .select("tanggal, jumlah")
        .gte("tanggal", `${y}-01-01`)
        .lte("tanggal", `${y}-12-31`);
      if (error) throw error;
      const result = Array.from({ length: 12 }, (_, i) => ({ bulan: i + 1, total: 0 }));
      (data as any[])?.forEach((r: any) => {
        const m = new Date(r.tanggal).getMonth();
        result[m].total += Number(r.jumlah || 0);
      });
      return result;
    },
  });
}

export function useTotalTabungan() {
  return useQuery({
    queryKey: ["tabungan", "total"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tabungan_siswa")
        .select("saldo");
      if (error) throw error;
      return (data as any[])?.reduce((s: number, r: any) => s + Number(r.saldo || 0), 0) || 0;
    },
  });
}

// ─── Rekap Per Lembaga ───
export function useRekapKeuanganPerLembaga(tahun: number) {
  return useQuery({
    queryKey: ["rekap_per_lembaga", tahun],
    queryFn: async () => {
      const { data: depts } = await supabase
        .from("departemen")
        .select("id, nama, kode")
        .eq("aktif", true)
        .order("nama");

      if (!depts?.length) return [];

      const { data: pembayaranData } = await supabase
        .from("pembayaran")
        .select("departemen_id, jumlah, tanggal_bayar")
        .gte("tanggal_bayar", `${tahun}-01-01`)
        .lte("tanggal_bayar", `${tahun}-12-31`);

      const { data: pengeluaranData } = await supabase
        .from("pengeluaran")
        .select("departemen_id, jumlah, tanggal")
        .gte("tanggal", `${tahun}-01-01`)
        .lte("tanggal", `${tahun}-12-31`);

      return depts.map((d) => {
        const totalPemasukan = (pembayaranData || [])
          .filter((p: any) => p.departemen_id === d.id)
          .reduce((s: number, p: any) => s + Number(p.jumlah || 0), 0);

        const totalPengeluaran = ((pengeluaranData || []) as any[])
          .filter((e: any) => e.departemen_id === d.id)
          .reduce((s: number, e: any) => s + Number(e.jumlah || 0), 0);

        return {
          departemen_id: d.id,
          lembaga: d.nama,
          kode: d.kode,
          totalPemasukan,
          totalPengeluaran,
          saldo: totalPemasukan - totalPengeluaran,
        };
      });
    },
  });
}

// ─── CRUD Jenis Pembayaran ───
export function useCreateJenisPembayaran() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: { nama: string; nominal?: number; keterangan?: string; aktif?: boolean; departemen_id?: string; akun_pendapatan_id?: string | null; akun_dimuka_id?: string | null; perlu_dimuka?: boolean; tipe?: string; tahun_masuk_dari?: number | null; tahun_masuk_sampai?: number | null }) => {
      const { error } = await supabase.from("jenis_pembayaran").insert(values);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jenis_pembayaran"] });
      toast.success("Jenis pembayaran berhasil ditambahkan");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateJenisPembayaran() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: { id: string; nama?: string; nominal?: number; keterangan?: string; aktif?: boolean; departemen_id?: string | null; akun_pendapatan_id?: string | null; akun_dimuka_id?: string | null; perlu_dimuka?: boolean; tipe?: string; tahun_masuk_dari?: number | null; tahun_masuk_sampai?: number | null }) => {
      const { error } = await supabase.from("jenis_pembayaran").update(values).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jenis_pembayaran"] });
      toast.success("Jenis pembayaran berhasil diperbarui");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteJenisPembayaran() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("jenis_pembayaran").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jenis_pembayaran"] });
      toast.success("Jenis pembayaran berhasil dihapus");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ─── CRUD Jenis Pengeluaran ───
export function useCreateJenisPengeluaran() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: { nama: string; keterangan?: string; aktif?: boolean; departemen_id?: string; akun_beban_id?: string | null }) => {
      const { error } = await supabase.from("jenis_pengeluaran").insert(values);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jenis_pengeluaran"] });
      toast.success("Jenis pengeluaran berhasil ditambahkan");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateJenisPengeluaran() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: { id: string; nama?: string; keterangan?: string; aktif?: boolean; departemen_id?: string | null; akun_beban_id?: string | null }) => {
      const { error } = await supabase.from("jenis_pengeluaran").update(values).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jenis_pengeluaran"] });
      toast.success("Jenis pengeluaran berhasil diperbarui");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteJenisPengeluaran() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("jenis_pengeluaran").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jenis_pengeluaran"] });
      toast.success("Jenis pengeluaran berhasil dihapus");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ─── Helpers ───
export function formatRupiah(n: number): string {
  return `Rp ${n.toLocaleString("id-ID")}`;
}

export function terbilang(n: number): string {
  if (n === 0) return "Nol Rupiah";
  const satuan = ["", "Satu", "Dua", "Tiga", "Empat", "Lima", "Enam", "Tujuh", "Delapan", "Sembilan", "Sepuluh", "Sebelas"];
  const convert = (num: number): string => {
    if (num < 12) return satuan[num];
    if (num < 20) return satuan[num - 10] + " Belas";
    if (num < 100) return satuan[Math.floor(num / 10)] + " Puluh" + (num % 10 ? " " + satuan[num % 10] : "");
    if (num < 200) return "Seratus" + (num % 100 ? " " + convert(num % 100) : "");
    if (num < 1000) return satuan[Math.floor(num / 100)] + " Ratus" + (num % 100 ? " " + convert(num % 100) : "");
    if (num < 2000) return "Seribu" + (num % 1000 ? " " + convert(num % 1000) : "");
    if (num < 1_000_000) return convert(Math.floor(num / 1000)) + " Ribu" + (num % 1000 ? " " + convert(num % 1000) : "");
    if (num < 1_000_000_000) return convert(Math.floor(num / 1_000_000)) + " Juta" + (num % 1_000_000 ? " " + convert(num % 1_000_000) : "");
    if (num < 1_000_000_000_000) return convert(Math.floor(num / 1_000_000_000)) + " Milyar" + (num % 1_000_000_000 ? " " + convert(num % 1_000_000_000) : "");
    return convert(Math.floor(num / 1_000_000_000_000)) + " Triliun" + (num % 1_000_000_000_000 ? " " + convert(num % 1_000_000_000_000) : "");
  };
  return convert(Math.floor(n)) + " Rupiah";
}

const BULAN_NAMES = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
export function namaBulan(b: number) { return BULAN_NAMES[b - 1] || ""; }
export { BULAN_NAMES };

/**
 * Nama bulan + tahun kalender, mis. "Juli 2026" -- dipakai untuk data
 * transaksi/tagihan spesifik supaya tidak ambigu (mis. "Januari" saja tidak
 * jelas Januari tahun berapa kalau dilihat lepas dari konteks tahun buku).
 * Sumber tahun (pilih salah satu, prioritas ke yang paling akurat):
 *   - tanggalTransaksi: tanggal aktual (mis. tanggal_bayar) -- paling akurat,
 *     tidak bergantung asumsi format tahun buku.
 *   - tahunBukuNama: nama tahun buku (mis. "Tahun 2026") -- dipakai untuk
 *     tagihan yang belum ada tanggal transaksi (mis. belum dibayar). Tahun
 *     buku di sistem ini berjalan penuh Januari-Desember per tahun kalender,
 *     jadi tahun diambil langsung dari 4 digit angka pertama yang ditemukan
 *     di nama tahun buku.
 */
export function namaBulanTahun(
  bulan: number,
  opts: { tanggalTransaksi?: string | null; tahunBukuNama?: string | null }
): string {
  const nama = namaBulan(bulan);
  if (!nama) return "";
  if (opts.tanggalTransaksi) {
    const tahun = new Date(opts.tanggalTransaksi).getFullYear();
    if (!Number.isNaN(tahun)) return `${nama} ${tahun}`;
  }
  if (opts.tahunBukuNama) {
    const match = opts.tahunBukuNama.match(/\d{4}/);
    if (match) return `${nama} ${match[0]}`;
  }
  return nama;
}

/** Urutan bulan sesuai tahun ajaran: Juli–Juni */
export const BULAN_ORDER_AKADEMIK = [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6];

// ─── Tahun Ajaran / Tahun Buku ───
export function useTahunAjaran() {
  return useQuery({
    queryKey: ["tahun_ajaran"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tahun_ajaran")
        .select("*")
        .order("tanggal_mulai", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useTahunAjaranAktif() {
  return useQuery({
    queryKey: ["tahun_ajaran", "aktif"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tahun_ajaran")
        .select("*")
        .eq("aktif", true)
        .order("nama", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateTahunAjaran() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: { nama: string; tanggal_mulai: string; tanggal_selesai: string; keterangan?: string; aktif?: boolean }) => {
      if (values.aktif) {
        await supabase.from("tahun_ajaran").update({ aktif: false }).neq("id", "00000000-0000-0000-0000-000000000000");
      }
      const { error } = await supabase.from("tahun_ajaran").insert(values);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tahun_ajaran"] });
      toast.success("Tahun ajaran berhasil ditambahkan");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateTahunAjaran() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: { id: string; nama?: string; tanggal_mulai?: string; tanggal_selesai?: string; keterangan?: string; aktif?: boolean }) => {
      if (values.aktif) {
        await supabase.from("tahun_ajaran").update({ aktif: false }).neq("id", id);
      }
      const { error } = await supabase.from("tahun_ajaran").update(values).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tahun_ajaran"] });
      toast.success("Tahun ajaran berhasil diperbarui");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteTahunAjaran() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data: payments } = await supabase
        .from("pembayaran")
        .select("id")
        .eq("tahun_ajaran_id", id)
        .limit(1);
      if (payments && payments.length > 0) {
        throw new Error("Tahun ajaran ini tidak bisa dihapus karena sudah memiliki data pembayaran.");
      }
      const { error } = await supabase.from("tahun_ajaran").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tahun_ajaran"] });
      toast.success("Tahun ajaran berhasil dihapus");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useAktifkanTahunAjaran() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, nama }: { id: string; nama: string }) => {
      await supabase.from("tahun_ajaran").update({ aktif: false }).neq("id", id);
      const { error } = await supabase.from("tahun_ajaran").update({ aktif: true }).eq("id", id);
      if (error) throw error;
      return nama;
    },
    onSuccess: (nama) => {
      qc.invalidateQueries({ queryKey: ["tahun_ajaran"] });
      toast.success(`Tahun Ajaran ${nama} sekarang aktif`);
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ─── Tahun Buku (Keuangan) ───
export function useTahunBuku() {
  return useQuery({
    queryKey: ["tahun_buku"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tahun_buku" as any)
        .select("*")
        .order("tanggal_mulai", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useTahunBukuAktif() {
  return useQuery({
    queryKey: ["tahun_buku", "aktif"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tahun_buku" as any)
        .select("*")
        .eq("aktif", true)
        .order("nama", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });
}

export function useCreateTahunBuku() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: { nama: string; tanggal_mulai: string; tanggal_selesai: string; keterangan?: string; aktif?: boolean }) => {
      if (values.aktif) {
        await (supabase.from("tahun_buku" as any) as any).update({ aktif: false }).neq("id", "00000000-0000-0000-0000-000000000000");
      }
      const { error } = await (supabase.from("tahun_buku" as any) as any).insert(values);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tahun_buku"] });
      toast.success("Tahun buku berhasil ditambahkan");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateTahunBuku() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: { id: string; nama?: string; tanggal_mulai?: string; tanggal_selesai?: string; keterangan?: string; aktif?: boolean; ditutup?: boolean }) => {
      if (values.aktif) {
        await (supabase.from("tahun_buku" as any) as any).update({ aktif: false }).neq("id", id);
      }
      const { error } = await (supabase.from("tahun_buku" as any) as any).update(values).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tahun_buku"] });
      toast.success("Tahun buku berhasil diperbarui");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteTahunBuku() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Cek apakah sudah ada transaksi yang menggunakan tahun buku ini
      const { data: payments } = await supabase
        .from("pembayaran")
        .select("id")
        .eq("tahun_ajaran_id", id)
        .limit(1);
      if (payments && payments.length > 0) {
        throw new Error("Tahun buku ini tidak bisa dihapus karena sudah memiliki data pembayaran.");
      }
      const { error } = await (supabase.from("tahun_buku" as any) as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tahun_buku"] });
      toast.success("Tahun buku berhasil dihapus");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useAktifkanTahunBuku() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, nama }: { id: string; nama: string }) => {
      await (supabase.from("tahun_buku" as any) as any).update({ aktif: false }).neq("id", id);
      const { error } = await (supabase.from("tahun_buku" as any) as any).update({ aktif: true }).eq("id", id);
      if (error) throw error;
      return nama;
    },
    onSuccess: (nama) => {
      qc.invalidateQueries({ queryKey: ["tahun_buku"] });
      toast.success(`Tahun Buku ${nama} sekarang aktif`);
    },
    onError: (e: any) => toast.error(e.message),
  });
}
