import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useAngkatan() {
  const { role } = useAuth();
  return useQuery({
    queryKey: ["angkatan", role === "admin_tu" ? "scoped" : "all"],
    queryFn: async () => {
      let q = supabase
        .from("angkatan")
        .select("*, departemen:departemen_id(id, nama)")
        .order("nama", { ascending: false });
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });
}

export function useDepartemen() {
  const { role } = useAuth();
  return useQuery({
    queryKey: ["departemen", role === "admin_tu" ? "scoped" : "all"],
    queryFn: async () => {
      let q = supabase.from("departemen").select("*").eq("aktif", true).order("nama");
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });
}

export function useDepartemenPendidikan() {
  const { role } = useAuth();
  return useQuery({
    queryKey: ["departemen", "unit_pendidikan", role === "admin_tu" ? "scoped" : "all"],
    queryFn: async () => {
      let q = supabase
        .from("departemen")
        .select("*")
        .eq("aktif", true)
        .eq("kategori", "unit_pendidikan")
        .order("nama");
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });
}

export function useTingkat(departemenIdArg?: string | null) {
  const { role } = useAuth();
  const effectiveDept = departemenIdArg;
  return useQuery({
    queryKey: ["tingkat", effectiveDept, role],
    queryFn: async () => {
      if (effectiveDept === null) return [];
      let q = supabase.from("tingkat").select("*").eq("aktif", true).order("urutan");
      if (effectiveDept) q = q.eq("departemen_id", effectiveDept);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: effectiveDept !== null,
  });
}

export function useKelas(tingkatId?: string) {
  const { role } = useAuth();
  return useQuery({
    queryKey: ["kelas", tingkatId, role === "admin_tu" ? "scoped" : "all"],
    queryFn: async () => {
      let q = supabase
        .from("kelas")
        .select("*, tingkat:tingkat_id(id, nama), departemen:departemen_id(id, nama)")
        .eq("aktif", true)
        .order("nama");
      if (tingkatId) q = q.eq("tingkat_id", tingkatId);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });
}

export function useTahunAjaran() {
  return useQuery({
    queryKey: ["tahun_ajaran"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tahun_ajaran")
        .select("*")
        .order("nama", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useSemester(tahunAjaranId?: string) {
  return useQuery({
    queryKey: ["semester", tahunAjaranId],
    queryFn: async () => {
      let q = supabase.from("semester").select("*").order("urutan");
      if (tahunAjaranId) q = q.eq("tahun_ajaran_id", tahunAjaranId);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });
}
