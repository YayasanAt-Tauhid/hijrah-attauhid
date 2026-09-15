import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllPages } from "@/lib/fetchAll";
import { toast } from "sonner";

export interface SiswaWithRelations {
  id: string;
  nis: string | null;
  nama: string;
  jenis_kelamin: string | null;
  tempat_lahir: string | null;
  tanggal_lahir: string | null;
  agama: string | null;
  alamat: string | null;
  telepon: string | null;
  email: string | null;
  foto_url: string | null;
  status: string | null;
  angkatan_id: string | null;
  departemen_id?: string | null;
  created_at: string | null;
  angkatan?: { id: string; nama: string } | null;
  siswa_detail?: any;
  kelas_siswa?: {
    id: string;
    aktif: boolean | null;
    kelas: { id: string; nama: string; tingkat: { id: string; nama: string } | null; departemen: { id: string; nama: string } | null } | null;
    tahun_ajaran: { id: string; nama: string } | null;
  }[];
}

export function useSiswaList() {
  return useQuery({
    queryKey: ["siswa"],
    queryFn: async () => {
      const data = await fetchAllPages((from, to) =>
        supabase
          .from("siswa")
          .select(`
            *,
            angkatan:angkatan_id(id, nama),
            siswa_detail(status_asrama, kategori),
            kelas_siswa(
              id, aktif,
              kelas:kelas_id(id, nama, tingkat:tingkat_id(id, nama), departemen:departemen_id(id, nama)),
              tahun_ajaran:tahun_ajaran_id(id, nama)
            )
          `)
          .order("nama")
          .order("id")
          .range(from, to)
      );
      return data as SiswaWithRelations[];
    },
  });
}

export function useSiswaDetail(id: string) {
  return useQuery({
    queryKey: ["siswa", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("siswa")
        .select(`
          *,
          angkatan:angkatan_id(id, nama),
          kelas_siswa(
            id, aktif,
            kelas:kelas_id(id, nama, tingkat:tingkat_id(id, nama), departemen:departemen_id(id, nama)),
            tahun_ajaran:tahun_ajaran_id(id, nama)
          )
        `)
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as SiswaWithRelations;
    },
    enabled: !!id,
  });
}

export function useSiswaDetailOrangtua(siswaId: string) {
  return useQuery({
    queryKey: ["siswa_detail", siswaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("siswa_detail")
        .select("*")
        .eq("siswa_id", siswaId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!siswaId,
  });
}

export function useCreateSiswa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      siswa: Record<string, unknown>;
      detail?: Record<string, unknown>;
      kelas_siswa?: Record<string, unknown>;
    }) => {
      const { data, error } = await (supabase as any).rpc("akademik_save_siswa", {
        p_siswa: values.siswa, p_detail: values.detail || null,
        p_kelas: values.kelas_siswa || null, p_id: null,
      });
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["siswa"] });
      qc.invalidateQueries({ queryKey: ["statistik_siswa"] });
      qc.invalidateQueries({ queryKey: ["siswa_detail"] });
      toast.success("Siswa berhasil ditambahkan");
    },
    onError: (err: Error) => {
      toast.error("Gagal menambah siswa: " + err.message);
    },
  });
}

export function useUpdateSiswa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      id: string;
      siswa: Record<string, unknown>;
      detail?: Record<string, unknown>;
      kelas_siswa?: { kelas_id: string; tahun_ajaran_id: string };
    }) => {
      const { error } = await (supabase as any).rpc("akademik_save_siswa", {
        p_siswa: values.siswa, p_detail: values.detail || null,
        p_kelas: values.kelas_siswa || null, p_id: values.id,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["siswa"] });
      qc.invalidateQueries({ queryKey: ["statistik_siswa"] });
      qc.invalidateQueries({ queryKey: ["siswa", variables.id] });
      qc.invalidateQueries({ queryKey: ["siswa_detail", variables.id] });
      toast.success("Data siswa berhasil diperbarui");
    },
    onError: (err: Error) => {
      toast.error("Gagal memperbarui data: " + err.message);
    },
  });
}

export function useDeleteSiswa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("siswa").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["siswa"] });
      qc.invalidateQueries({ queryKey: ["statistik_siswa"] });
      qc.invalidateQueries({ queryKey: ["siswa_detail"] });
      toast.success("Siswa berhasil dihapus");
    },
    onError: (err: Error) => {
      toast.error("Gagal menghapus siswa: " + err.message);
    },
  });
}
