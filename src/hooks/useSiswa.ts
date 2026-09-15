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
      const { data: siswa, error: siswaErr } = await supabase
        .from("siswa")
        .insert(values.siswa as any)
        .select()
        .single();
      if (siswaErr) throw siswaErr;

      if (values.detail) {
        const { error: detailErr } = await supabase
          .from("siswa_detail")
          .insert({ ...values.detail, siswa_id: siswa.id } as any);
        if (detailErr) throw detailErr;
      }

      if (values.kelas_siswa) {
        const { error: kelasErr } = await supabase
          .from("kelas_siswa")
          .insert({ ...values.kelas_siswa, siswa_id: siswa.id } as any);
        if (kelasErr) throw kelasErr;
      }

      return siswa;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["siswa"] });
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
      const { error: siswaErr } = await supabase
        .from("siswa")
        .update(values.siswa as any)
        .eq("id", values.id);
      if (siswaErr) throw siswaErr;

      if (values.detail) {
        const { data: existing } = await supabase
          .from("siswa_detail")
          .select("id")
          .eq("siswa_id", values.id)
          .maybeSingle();

        if (existing) {
          const { error } = await supabase
            .from("siswa_detail")
            .update(values.detail as any)
            .eq("siswa_id", values.id);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("siswa_detail")
            .insert({ ...values.detail, siswa_id: values.id } as any);
          if (error) throw error;
        }
      }

      if (values.kelas_siswa?.kelas_id && values.kelas_siswa?.tahun_ajaran_id) {
        await supabase
          .from("kelas_siswa")
          .update({ aktif: false } as any)
          .eq("siswa_id", values.id)
          .eq("aktif", true);

        const { data: existingKs } = await supabase
          .from("kelas_siswa")
          .select("id")
          .eq("siswa_id", values.id)
          .eq("kelas_id", values.kelas_siswa.kelas_id)
          .eq("tahun_ajaran_id", values.kelas_siswa.tahun_ajaran_id)
          .maybeSingle();

        if (existingKs) {
          const { error } = await supabase
            .from("kelas_siswa")
            .update({ aktif: true } as any)
            .eq("id", existingKs.id);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("kelas_siswa")
            .insert({
              siswa_id: values.id,
              kelas_id: values.kelas_siswa.kelas_id,
              tahun_ajaran_id: values.kelas_siswa.tahun_ajaran_id,
              aktif: true,
            } as any);
          if (error) throw error;
        }
      }
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["siswa"] });
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
      qc.invalidateQueries({ queryKey: ["siswa_detail"] });
      toast.success("Siswa berhasil dihapus");
    },
    onError: (err: Error) => {
      toast.error("Gagal menghapus siswa: " + err.message);
    },
  });
}
