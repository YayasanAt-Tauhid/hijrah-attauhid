import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

import { fromJson } from "@/lib/rpcJson";
// Get nominal for a specific siswa+jenis using DB function get_tarif_siswa
export function useTarifSiswa(
  jenisId?: string,
  siswaId?: string,
  kelasId?: string,
  tahunAjaranId?: string,
  angkatanId?: string,
) {
  return useQuery({
    queryKey: ["tarif_siswa", jenisId, siswaId, kelasId, tahunAjaranId, angkatanId],
    enabled: !!jenisId && !!siswaId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_tarif_siswa", {
        p_jenis_id: jenisId!,
        p_siswa_id: siswaId!,
        p_kelas_id: kelasId || null,
        p_tahun_ajaran_id: tahunAjaranId || null,
        p_angkatan_id: angkatanId || null,
      });
      if (error) throw error;
      return Number(data) || 0;
    },
  });
}

// Batch get tarif for multiple students (client-side, for reports)
export async function getTarifBatch(
  jenisId: string,
  siswaIds: string[],
  kelasId?: string | null,
  tahunAjaranId?: string | null,
  angkatanMap?: Map<string, string>, // siswaId → angkatanId
): Promise<Map<string, number>> {
  const result = new Map<string, number>();

  // Get all tarif_tagihan entries for this jenis
  const { data: tarifList } = await supabase
    .from("tarif_tagihan")
    .select("siswa_id, kelas_id, tahun_ajaran_id, angkatan_id, nominal")
    .eq("jenis_id", jenisId)
    .eq("aktif", true);

  const defaultNominal = 0;

  for (const siswaId of siswaIds) {
    if (!tarifList?.length) {
      result.set(siswaId, defaultNominal);
      continue;
    }

    const angkatanId = angkatanMap?.get(siswaId) ?? null;

    // Priority: siswa+kelas+tahun > siswa+tahun > siswa > kelas+tahun > kelas
    //         > angkatan+tahun > angkatan > tahun > default
    const match =
      tarifList.find(t => t.siswa_id === siswaId && t.kelas_id === kelasId && t.tahun_ajaran_id === tahunAjaranId) ||
      tarifList.find(t => t.siswa_id === siswaId && !t.kelas_id && t.tahun_ajaran_id === tahunAjaranId) ||
      tarifList.find(t => t.siswa_id === siswaId && !t.kelas_id && !t.tahun_ajaran_id) ||
      tarifList.find(t => !t.siswa_id && t.kelas_id === kelasId && t.tahun_ajaran_id === tahunAjaranId) ||
      tarifList.find(t => !t.siswa_id && t.kelas_id === kelasId && !t.tahun_ajaran_id) ||
      (angkatanId
        ? tarifList.find(t => !t.siswa_id && !t.kelas_id && t.angkatan_id === angkatanId && t.tahun_ajaran_id === tahunAjaranId)
        : undefined) ||
      (angkatanId
        ? tarifList.find(t => !t.siswa_id && !t.kelas_id && t.angkatan_id === angkatanId && !t.tahun_ajaran_id)
        : undefined) ||
      tarifList.find(t => !t.siswa_id && !t.kelas_id && !t.angkatan_id && t.tahun_ajaran_id === tahunAjaranId);

    result.set(siswaId, match ? Number(match.nominal) : defaultNominal);
  }

  return result;
}

export function useTarifTagihanList(jenisId?: string) {
  return useQuery({
    queryKey: ["tarif_tagihan", jenisId],
    queryFn: async () => {
      let q = supabase
        .from("tarif_tagihan")
        .select("*, jenis:jenis_id(id, nama), siswa:siswa_id(id, nama, nis), kelas:kelas_id(id, nama), tahun_ajaran:tahun_ajaran_id(id, nama), angkatan:angkatan_id(id, nama)")
        .eq("aktif", true)
        .order("created_at", { ascending: false });
      if (jenisId) q = q.eq("jenis_id", jenisId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useAllTarifTagihan() {
  return useQuery({
    queryKey: ["tarif_tagihan", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tarif_tagihan")
        .select("*, jenis:jenis_id(id, nama, nominal), siswa:siswa_id(id, nama, nis), kelas:kelas_id(id, nama), tahun_ajaran:tahun_ajaran_id(id, nama), angkatan:angkatan_id(id, nama)")
        .eq("aktif", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useCreateTarifTagihan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      jenis_id: string;
      siswa_id?: string | null;
      kelas_id?: string | null;
      tahun_ajaran_id?: string | null;
      /**
       * Satu tarif Tahun Ajaran dapat melintasi dua Tahun Buku (mis. TA
       * 2026/2027 = Jul–Des 2026 + Jan–Jun 2027). Jika diisi, mutation akan
       * membuat satu baris tarif per Tahun Buku dalam SATU insert atomik.
       */
      tahun_ajaran_ids?: string[];
      angkatan_id?: string | null;
      nominal: number;
      keterangan?: string;
    }) => {
      const periodeIds = values.tahun_ajaran_ids?.length
        ? [...new Set(values.tahun_ajaran_ids)]
        : [values.tahun_ajaran_id || null];

      const payload = periodeIds.map((tahunId) => ({
        jenis_id: values.jenis_id,
        siswa_id: values.siswa_id || null,
        kelas_id: values.kelas_id || null,
        tahun_ajaran_id: tahunId,
        angkatan_id: values.angkatan_id || null,
        nominal: values.nominal,
        keterangan: values.keterangan || undefined,
      }));

      const { error } = await supabase.from("tarif_tagihan").insert(payload);
      if (error) throw error;
      return payload.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["tarif_tagihan"] });
      toast.success(count > 1 ? `Tarif tagihan berhasil ditambahkan ke ${count} Tahun Buku` : "Tarif tagihan berhasil ditambahkan");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// Insert banyak tarif sekaligus dalam SATU request (input massal per-siswa).
// Satu .insert(array) bersifat atomik di Postgres: kalau ada satu baris gagal
// (mis. kena constraint), seluruh batch dibatalkan — tidak ada tarif setengah jadi.
export function useCreateTarifTagihanBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: {
      jenis_id: string;
      siswa_id: string;
      tahun_ajaran_id?: string | null;
      nominal: number;
      keterangan?: string;
    }[]) => {
      const { error } = await supabase.from("tarif_tagihan").insert(
        rows.map((v) => ({
          jenis_id: v.jenis_id,
          siswa_id: v.siswa_id,
          kelas_id: null,
          angkatan_id: null,
          tahun_ajaran_id: v.tahun_ajaran_id || null,
          nominal: v.nominal,
          keterangan: v.keterangan || undefined,
        }))
      );
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["tarif_tagihan"] });
      toast.success(`${n} tarif tagihan berhasil ditambahkan`);
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateTarifTagihan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: {
      id: string;
      nominal?: number;
      keterangan?: string;
      aktif?: boolean;
    }) => {
      const { error } = await supabase.from("tarif_tagihan").update(values).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tarif_tagihan"] });
      toast.success("Tarif tagihan berhasil diperbarui");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export interface NonaktifkanTarifResult {
  success: boolean;
  already_inactive?: boolean;
  tagihan_terkait?: number;
}

/**
 * Soft delete override tarif. Data tarif tetap disimpan untuk histori/audit;
 * tagihan dan jurnal yang sudah terbentuk tidak disentuh.
 */
export function useNonaktifkanTarifTagihan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, alasan }: { id: string; alasan: string }) => {
      const { data, error } = await supabase.rpc("nonaktifkan_override_tarif", {
        p_tarif_id: id,
        p_alasan: alasan.trim(),
      });
      if (error) throw error;
      return fromJson<NonaktifkanTarifResult>(data);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["tarif_tagihan"] });
      qc.invalidateQueries({ queryKey: ["audit_keuangan"] });
      const terkait = Number(data?.tagihan_terkait || 0);
      toast.success(
        terkait > 0
          ? `Override tarif dinonaktifkan. ${terkait} tagihan yang sudah ada tetap tidak berubah.`
          : "Override tarif berhasil dinonaktifkan"
      );
    },
    onError: (e: any) => toast.error(e.message),
  });
}
