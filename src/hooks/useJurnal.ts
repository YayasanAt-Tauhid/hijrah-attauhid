import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ─── Akun Rekening ───
export function useAkunRekening() {
  return useQuery({
    queryKey: ["akun_rekening", "aktif"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("akun_rekening")
        .select("*")
        .eq("aktif", true)
        .order("kode");
      if (error) throw error;
      return data as any[];
    },
  });
}

export function useAllAkunRekening() {
  return useQuery({
    queryKey: ["akun_rekening", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("akun_rekening")
        .select("*")
        .order("kode");
      if (error) throw error;
      return data as any[];
    },
  });
}

export function useCreateAkunRekening() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: { kode: string; nama: string; jenis: string; saldo_normal: string; saldo_awal?: number; keterangan?: string; aktif?: boolean; departemen_id?: string }) => {
      const { error } = await supabase.from("akun_rekening").insert(values);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["akun_rekening"] });
      toast.success("Akun rekening berhasil ditambahkan");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateAkunRekening() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: { id: string; kode?: string; nama?: string; jenis?: string; saldo_normal?: string; saldo_awal?: number; keterangan?: string; aktif?: boolean; departemen_id?: string | null }) => {
      const { error } = await supabase.from("akun_rekening").update(values).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["akun_rekening"] });
      toast.success("Akun rekening berhasil diperbarui");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteAkunRekening() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data: used } = await supabase
        .from("jurnal_detail")
        .select("id")
        .eq("akun_id", id)
        .limit(1);
      if (used && used.length > 0) throw new Error("Akun ini sudah digunakan dalam jurnal dan tidak bisa dihapus");
      const { error } = await supabase.from("akun_rekening").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["akun_rekening"] });
      toast.success("Akun rekening berhasil dihapus");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ─── Jurnal ───
export function useJurnalPenginput() {
  return useQuery({
    queryKey: ["jurnal", "penginput"],
    queryFn: async () => {
      const names = new Map<string, string>();
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("jurnal")
          .select("id, dibuat_oleh, penginput:dibuat_oleh(nama)")
          .not("dibuat_oleh", "is", null)
          .order("id")
          .range(from, from + pageSize - 1);
        if (error) throw error;
        for (const row of data || []) {
          if (row.dibuat_oleh) {
            names.set(row.dibuat_oleh, row.penginput?.nama || "Penginput tidak tersedia");
          }
        }
        if ((data || []).length < pageSize) break;
      }
      return [...names].map(([id, nama]) => ({ id, nama }))
        .sort((a, b) => a.nama.localeCompare(b.nama, "id"));
    },
  });
}

export function useJurnalList(tanggalDari?: string, tanggalSampai?: string, departemenId?: string, penginputId?: string) {
  return useQuery({
    queryKey: ["jurnal", tanggalDari, tanggalSampai, departemenId, penginputId],
    queryFn: async () => {
      const rows: any[] = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        let q = supabase
          .from("jurnal")
          .select("*, departemen:departemen_id(nama, kode), penginput:dibuat_oleh(nama)")
          .order("tanggal", { ascending: false })
          .order("id");
        if (tanggalDari) q = q.gte("tanggal", tanggalDari);
        if (tanggalSampai) q = q.lte("tanggal", tanggalSampai);
        if (departemenId) q = q.eq("departemen_id", departemenId);
        if (penginputId === "__online__") {
          q = q.is("dibuat_oleh", null).like("referensi", "HAT-%");
        } else if (penginputId === "__unknown__") {
          q = q.is("dibuat_oleh", null)
            .or("referensi.is.null,referensi.not.like.HAT-%");
        } else if (penginputId) {
          q = q.eq("dibuat_oleh", penginputId);
        }
        const { data, error } = await q.range(from, from + pageSize - 1);
        if (error) throw error;
        rows.push(...(data || []));
        if ((data || []).length < pageSize) break;
      }
      return rows;
    },
  });
}

// ID jurnal yang sudah dikoreksi (punya jurnal pembalik yang menunjuk ke dia)
export function useJurnalDikoreksiIds() {
  return useQuery({
    queryKey: ["jurnal", "dikoreksi_ids"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jurnal")
        .select("jurnal_asal_id")
        .eq("tipe", "pembalik")
        .not("jurnal_asal_id", "is", null);
      if (error) throw error;
      return new Set((data || []).map((r: any) => r.jurnal_asal_id as string));
    },
  });
}

export function useJurnalDetail(jurnalId?: string) {
  return useQuery({
    queryKey: ["jurnal", "detail", jurnalId],
    enabled: !!jurnalId,
    queryFn: async () => {
      const { data: jurnal, error: jErr } = await supabase
        .from("jurnal")
        .select("*, departemen:departemen_id(nama, kode), penginput:dibuat_oleh(nama)")
        .eq("id", jurnalId!)
        .single();
      if (jErr) throw jErr;

      const { data: details, error: dErr } = await supabase
        .from("jurnal_detail")
        .select("*, akun_rekening:akun_id(kode, nama)")
        .eq("jurnal_id", jurnalId!)
        .order("urutan");
      if (dErr) throw dErr;

      return { ...(jurnal as any), details: details as any[] };
    },
  });
}

// ─── Period Lock Check (unit-aware) — sama dengan useKeuangan.ts ───
async function checkPeriodeLocked(tanggal: string, departemenId?: string | null): Promise<void> {
  const { data: taList } = await supabase
    .from("tahun_ajaran")
    .select("id, nama, ditutup, tanggal_mulai, tanggal_selesai")
    .lte("tanggal_mulai", tanggal)
    .gte("tanggal_selesai", tanggal)
    .limit(1);
  const ta = (taList || [])[0] as any;
  if (!ta) return;

  let unitDept = "unit_pendidikan";
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

  const { data: logRows } = await supabase
    .from("log_tutup_buku" as any)
    .select("id")
    .eq("tahun_ajaran_id", ta.id)
    .eq("unit", unitDept)
    .limit(1);

  if (logRows && (logRows as any[]).length > 0) {
    const unitLabel = unitDept === "unit_pendidikan" ? "Unit Pendidikan" : "Unit Usaha & Dana";
    throw new Error(
      `Transaksi ditolak: periode "${ta.nama}" untuk ${unitLabel} sudah ditutup buku.`
    );
  }
}

async function generateNomorJurnal(tahun: number): Promise<string> {
  const { data, error } = await supabase.rpc("generate_nomor_jurnal", {
    p_prefix: "JU",
    p_tahun: tahun,
  });
  if (error) throw error;
  if (!data) throw new Error("Gagal mendapatkan nomor jurnal");
  return data;
}

// Cari pegawai_id milik user yang sedang login (untuk mencatat siapa penginput jurnal)
async function getPegawaiIdSaatIni(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("users_profile")
    .select("pegawai_id")
    .eq("id", user.id)
    .maybeSingle();
  return (data as any)?.pegawai_id || null;
}

export function useCreateJurnal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      tanggal: string;
      keterangan: string;
      referensi?: string;
      departemen_id?: string;
      details: { akun_id: string; keterangan?: string; debit: number; kredit: number; urutan: number }[];
    }) => {
      const totalDebit = values.details.reduce((s, d) => s + d.debit, 0);
      const totalKredit = values.details.reduce((s, d) => s + d.kredit, 0);
      if (Math.abs(totalDebit - totalKredit) > 0.01) throw new Error("Total debit harus sama dengan total kredit");

      // Check period lock — teruskan departemenId
      await checkPeriodeLocked(values.tanggal, values.departemen_id ?? null);

      const tahun = new Date(values.tanggal).getFullYear();
      const nomor = await generateNomorJurnal(tahun);
      const dibuatOleh = await getPegawaiIdSaatIni();

      const { data: jurnal, error: jErr } = await supabase
        .from("jurnal")
        .insert({
          nomor,
          tanggal: values.tanggal,
          keterangan: values.keterangan,
          referensi: values.referensi,
          departemen_id: values.departemen_id,
          total_debit: totalDebit,
          total_kredit: totalKredit,
          dibuat_oleh: dibuatOleh,
        })
        .select()
        .single();
      if (jErr) throw jErr;

      const rows = values.details.map((d) => ({ ...d, jurnal_id: (jurnal as any).id }));
      const { error: dErr } = await supabase.from("jurnal_detail").insert(rows);
      if (dErr) throw dErr;

      await logAuditKeuangan({
        tabel_sumber: "jurnal",
        record_id: (jurnal as any).id,
        aksi: "CREATE",
        data_baru: {
          nomor,
          tanggal: values.tanggal,
          keterangan: values.keterangan,
          total_debit: totalDebit,
          total_kredit: totalKredit,
        },
        keterangan: `Buat jurnal baru ${nomor}`,
        departemen_id: values.departemen_id,
      });

      return jurnal;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jurnal"] });
      toast.success("Jurnal berhasil disimpan");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateJurnal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      id: string;
      tanggal: string;
      keterangan: string;
      referensi?: string;
      departemen_id?: string;
      details: { akun_id: string; keterangan?: string; debit: number; kredit: number; urutan: number }[];
    }) => {
      const totalDebit = values.details.reduce((s, d) => s + d.debit, 0);
      const totalKredit = values.details.reduce((s, d) => s + d.kredit, 0);
      if (Math.abs(totalDebit - totalKredit) > 0.01) throw new Error("Total debit harus sama dengan total kredit");

      // Check period lock — teruskan departemenId
      await checkPeriodeLocked(values.tanggal, values.departemen_id ?? null);

      const { data: existing } = await supabase
        .from("jurnal")
        .select("status, nomor, keterangan, tanggal, total_debit, total_kredit, referensi")
        .eq("id", values.id)
        .single();
      if ((existing as any)?.status === "posted") throw new Error("Jurnal yang sudah diposting tidak bisa diedit");

      const { error: jErr } = await supabase
        .from("jurnal")
        .update({
          tanggal: values.tanggal,
          keterangan: values.keterangan,
          referensi: values.referensi,
          departemen_id: values.departemen_id,
          total_debit: totalDebit,
          total_kredit: totalKredit,
        })
        .eq("id", values.id);
      if (jErr) throw jErr;

      await supabase.from("jurnal_detail").delete().eq("jurnal_id", values.id);
      const rows = values.details.map((d) => ({ ...d, jurnal_id: values.id }));
      const { error: dErr } = await supabase.from("jurnal_detail").insert(rows);
      if (dErr) throw dErr;

      await logAuditKeuangan({
        tabel_sumber: "jurnal",
        record_id: values.id,
        aksi: "UPDATE",
        data_lama: existing,
        data_baru: {
          tanggal: values.tanggal,
          keterangan: values.keterangan,
          referensi: values.referensi,
          total_debit: totalDebit,
          total_kredit: totalKredit,
        },
        keterangan: `Edit jurnal ${(existing as any)?.nomor || values.id}`,
        departemen_id: values.departemen_id,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jurnal"] });
      toast.success("Jurnal berhasil diperbarui");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteJurnal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data: existing } = await supabase
        .from("jurnal")
        .select("status, nomor, keterangan, tanggal, total_debit, departemen_id")
        .eq("id", id)
        .single();
      if ((existing as any)?.status === "posted") throw new Error("Jurnal yang sudah diposting tidak bisa dihapus");
      const { error } = await supabase.from("jurnal").delete().eq("id", id);
      if (error) throw error;

      await logAuditKeuangan({
        tabel_sumber: "jurnal",
        record_id: id,
        aksi: "DELETE",
        data_lama: existing,
        keterangan: `Hapus jurnal ${(existing as any)?.nomor || id}`,
        departemen_id: (existing as any)?.departemen_id,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jurnal"] });
      toast.success("Jurnal berhasil dihapus");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function usePostJurnal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data: existing } = await supabase
        .from("jurnal")
        .select("nomor, departemen_id")
        .eq("id", id)
        .single();
      const { error } = await supabase.from("jurnal").update({ status: "posted" }).eq("id", id);
      if (error) throw error;

      await logAuditKeuangan({
        tabel_sumber: "jurnal",
        record_id: id,
        aksi: "POST",
        data_baru: { status: "posted" },
        keterangan: `Posting jurnal ${(existing as any)?.nomor || id}`,
        departemen_id: (existing as any)?.departemen_id,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jurnal"] });
      qc.invalidateQueries({ queryKey: ["buku_besar"] });
      toast.success("Jurnal berhasil diposting");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ─── Audit Keuangan ───
export async function logAuditKeuangan(params: {
  tabel_sumber: string;
  record_id: string;
  aksi: "CREATE" | "UPDATE" | "DELETE" | "POST";
  data_lama?: any;
  data_baru?: any;
  keterangan?: string;
  departemen_id?: string;
  nama_pengguna?: string;
}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    await (supabase.from("audit_keuangan" as any).insert as any)({
      tabel_sumber: params.tabel_sumber,
      record_id: params.record_id,
      aksi: params.aksi,
      data_lama: params.data_lama || null,
      data_baru: params.data_baru || null,
      keterangan: params.keterangan || null,
      departemen_id: params.departemen_id || null,
      dibuat_oleh: user?.id || null,
      nama_pengguna: params.nama_pengguna || user?.email || "System",
    });
  } catch (err) {
    // best-effort; jangan gagalkan operasi utama
    console.warn("logAuditKeuangan failed:", err);
  }
}

export function useAuditKeuangan(filters: {
  tabelSumber?: string;
  aksi?: string;
  tanggalDari?: string;
  tanggalSampai?: string;
  departemenId?: string;
  searchQuery?: string;
}) {
  return useQuery({
    queryKey: ["audit_keuangan", filters],
    queryFn: async () => {
      let q: any = (supabase.from("audit_keuangan" as any).select("*") as any)
        .order("created_at", { ascending: false });

      if (filters.tabelSumber && filters.tabelSumber !== "semua") {
        q = q.eq("tabel_sumber", filters.tabelSumber);
      }
      if (filters.aksi && filters.aksi !== "semua") {
        q = q.eq("aksi", filters.aksi);
      }
      if (filters.tanggalDari) {
        q = q.gte("created_at", `${filters.tanggalDari}T00:00:00`);
      }
      if (filters.tanggalSampai) {
        q = q.lte("created_at", `${filters.tanggalSampai}T23:59:59`);
      }
      if (filters.departemenId) {
        q = q.eq("departemen_id", filters.departemenId);
      }

      const { data, error } = await q.limit(500);
      if (error) throw error;

      let rows = (data || []) as any[];
      if (filters.searchQuery?.trim()) {
        const sq = filters.searchQuery.toLowerCase();
        rows = rows.filter((r: any) =>
          r.record_id?.toLowerCase().includes(sq) ||
          r.keterangan?.toLowerCase().includes(sq) ||
          r.nama_pengguna?.toLowerCase().includes(sq) ||
          JSON.stringify(r.data_lama || {}).toLowerCase().includes(sq) ||
          JSON.stringify(r.data_baru || {}).toLowerCase().includes(sq)
        );
      }
      return rows;
    },
  });
}

// ─── Jurnal Koreksi / Pembalik ───
export function useKoreksiJurnal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      jurnal_asal_id: string;
      tanggal_koreksi: string;
      alasan: string;
      pengganti?: {
        tanggal?: string;
        keterangan: string;
        referensi?: string;
        details: { akun_id: string; keterangan?: string; debit: number; kredit: number; urutan: number }[];
      };
    }) => {
      const { data: jurnalAsal, error: e1 } = await supabase
        .from("jurnal")
        .select("*, departemen:departemen_id(nama, kode)")
        .eq("id", values.jurnal_asal_id)
        .single();
      if (e1) throw e1;
      if ((jurnalAsal as any).status !== "posted")
        throw new Error("Hanya jurnal yang sudah diposting yang bisa dikoreksi dengan cara ini.");

      const { data: detailAsal, error: e2 } = await supabase
        .from("jurnal_detail")
        .select("*")
        .eq("jurnal_id", values.jurnal_asal_id)
        .order("urutan");
      if (e2) throw e2;

      await checkPeriodeLocked(values.tanggal_koreksi);

      const tahun = new Date(values.tanggal_koreksi).getFullYear();
      const nomorPembalik = await generateNomorJurnal(tahun);
      const totalAsal = Number((jurnalAsal as any).total_debit) || 0;
      const dibuatOleh = await getPegawaiIdSaatIni();

      const { data: jurnalPembalik, error: e3 } = await supabase
        .from("jurnal")
        .insert({
          nomor: nomorPembalik,
          tanggal: values.tanggal_koreksi,
          keterangan: `KOREKSI: ${(jurnalAsal as any).keterangan}`,
          referensi: (jurnalAsal as any).nomor,
          departemen_id: (jurnalAsal as any).departemen_id,
          program_dana_id: (jurnalAsal as any).program_dana_id,
          total_debit: totalAsal,
          total_kredit: totalAsal,
          status: "posted",
          tipe: "pembalik",
          jurnal_asal_id: values.jurnal_asal_id,
          dibuat_oleh: dibuatOleh,
        } as any)
        .select()
        .single();
      if (e3) throw e3;

      const detailPembalik = (detailAsal as any[]).map((d, i) => ({
        jurnal_id: (jurnalPembalik as any).id,
        akun_id: d.akun_id,
        debit: Number(d.kredit) || 0,
        kredit: Number(d.debit) || 0,
        keterangan: d.keterangan ? `[BALIK] ${d.keterangan}` : "[BALIK]",
        urutan: i + 1,
      }));
      const { error: e4 } = await supabase.from("jurnal_detail").insert(detailPembalik);
      if (e4) throw e4;

      await logAuditKeuangan({
        tabel_sumber: "jurnal",
        record_id: (jurnalPembalik as any).id,
        aksi: "CREATE",
        data_baru: {
          tipe: "pembalik",
          jurnal_asal: (jurnalAsal as any).nomor,
          alasan: values.alasan,
        },
        keterangan: `Jurnal koreksi pembalik untuk ${(jurnalAsal as any).nomor}: ${values.alasan}`,
        departemen_id: (jurnalAsal as any).departemen_id,
      });

      let jurnalPengganti: any = null;
      if (values.pengganti && values.pengganti.details.length > 0) {
        const tanggalPengganti = values.pengganti.tanggal || values.tanggal_koreksi;
        if (tanggalPengganti !== values.tanggal_koreksi) {
          await checkPeriodeLocked(tanggalPengganti);
        }
        const totalPengganti = values.pengganti.details.reduce((s, d) => s + d.debit, 0);
        const nomorPengganti = await generateNomorJurnal(new Date(tanggalPengganti).getFullYear());

        const { data: jp, error: e5 } = await supabase
          .from("jurnal")
          .insert({
            nomor: nomorPengganti,
            tanggal: tanggalPengganti,
            keterangan: values.pengganti.keterangan,
            referensi: values.pengganti.referensi || (jurnalAsal as any).nomor,
            departemen_id: (jurnalAsal as any).departemen_id,
            program_dana_id: (jurnalAsal as any).program_dana_id,
            total_debit: totalPengganti,
            total_kredit: totalPengganti,
            status: "draft",
            tipe: "pengganti",
            jurnal_asal_id: values.jurnal_asal_id,
            dibuat_oleh: dibuatOleh,
          } as any)
          .select()
          .single();
        if (e5) throw e5;

        const rowsPengganti = values.pengganti.details.map((d) => ({
          ...d,
          jurnal_id: (jp as any).id,
        }));
        const { error: e6 } = await supabase.from("jurnal_detail").insert(rowsPengganti);
        if (e6) throw e6;

        jurnalPengganti = jp;

        await logAuditKeuangan({
          tabel_sumber: "jurnal",
          record_id: (jp as any).id,
          aksi: "CREATE",
          data_baru: { tipe: "pengganti", jurnal_asal: (jurnalAsal as any).nomor },
          keterangan: `Jurnal koreksi pengganti untuk ${(jurnalAsal as any).nomor}`,
          departemen_id: (jurnalAsal as any).departemen_id,
        });
      }

      return { jurnalPembalik, jurnalPengganti };
    },
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: ["jurnal"] });
      qc.invalidateQueries({ queryKey: ["buku_besar"] });
      const pesanPengganti = result.jurnalPengganti
        ? ` dan jurnal pengganti ${(result.jurnalPengganti as any).nomor} (draft) berhasil dibuat`
        : "";
      toast.success(
        `Jurnal pembalik ${(result.jurnalPembalik as any).nomor} berhasil dibuat${pesanPengganti}`
      );
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ─── Pengaturan Akun Sistem ───
export function usePengaturanAkun() {
  return useQuery({
    queryKey: ["pengaturan_akun"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pengaturan_akun")
        .select("*, akun:akun_id(id, kode, nama, jenis)")
        .order("kode_setting");
      if (error) throw error;
      return data as any[];
    },
  });
}

export function useUpdatePengaturanAkun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ kode_setting, akun_id }: { kode_setting: string; akun_id: string | null }) => {
      const { error } = await supabase
        .from("pengaturan_akun")
        .update({ akun_id, updated_at: new Date().toISOString() })
        .eq("kode_setting", kode_setting);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pengaturan_akun"] });
      toast.success("Pengaturan akun berhasil disimpan");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useCreatePengaturanAkun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: { kode_setting: string; label: string; keterangan?: string; akun_id?: string | null }) => {
      const { error } = await supabase.from("pengaturan_akun").insert(values);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pengaturan_akun"] });
      toast.success("Setting akun berhasil ditambahkan");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeletePengaturanAkun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pengaturan_akun").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pengaturan_akun"] });
      toast.success("Setting akun berhasil dihapus");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ─── Akun by Jenis ───
export function useAkunByJenis(jenis: string) {
  return useQuery({
    queryKey: ["akun_rekening", "jenis", jenis],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("akun_rekening")
        .select("id, kode, nama")
        .eq("jenis", jenis.toLowerCase())
        .eq("aktif", true)
        .order("kode");
      if (error) throw error;
      return data as any[];
    },
  });
}

// ─── Buku Besar ───
export interface BukuBesarMutasiRow {
  tanggal: string;
  nomor: string;
  lembaga: string;
  keterangan: string;
  debit: number;
  kredit: number;
  tipe: string;
}

export interface BukuBesarData {
  saldoAwal: number;
  mutasi: BukuBesarMutasiRow[];
}

/** Buku besar per akun: saldo awal periode + mutasi dihitung di server
 *  (RPC buku_besar_saldo_awal & buku_besar_mutasi, exclude jurnal penutup
 *  kecuali diminta). Mutasi diambil per 1000 baris karena batas PostgREST. */
export function useBukuBesar(
  akunId?: string,
  tglAwal?: string,
  tglAkhir?: string,
  departemenIds?: string[],
  includePenutup?: boolean,
  excludeKoreksi?: boolean,
) {
  return useQuery({
    queryKey: ["buku_besar", akunId, tglAwal, tglAkhir, departemenIds, includePenutup, excludeKoreksi],
    enabled: !!akunId && !!tglAwal && !!tglAkhir,
    queryFn: async (): Promise<BukuBesarData> => {
      const depts = departemenIds && departemenIds.length > 0 ? departemenIds : null;

      const { data: saldoAwalData, error: saErr } = await (supabase as any).rpc("buku_besar_saldo_awal", {
        p_akun_id: akunId,
        p_tgl_awal: tglAwal,
        p_departemen_ids: depts,
        p_exclude_koreksi: excludeKoreksi ?? false,
      });
      if (saErr) throw saErr;

      const pageSize = 1000;
      const mutasi: BukuBesarMutasiRow[] = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await (supabase as any)
          .rpc("buku_besar_mutasi", {
            p_akun_id: akunId,
            p_tgl_awal: tglAwal,
            p_tgl_akhir: tglAkhir,
            p_departemen_ids: depts,
            p_include_penutup: includePenutup ?? false,
            p_exclude_koreksi: excludeKoreksi ?? false,
          })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const rows = (data || []) as any[];
        for (const r of rows) {
          mutasi.push({ ...r, debit: Number(r.debit || 0), kredit: Number(r.kredit || 0) });
        }
        if (rows.length < pageSize) break;
      }

      return { saldoAwal: Number(saldoAwalData || 0), mutasi };
    },
  });
}
