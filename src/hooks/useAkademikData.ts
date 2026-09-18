import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useAngkatan() {
  const { role, departemenId } = useAuth();
  return useQuery({
    queryKey: ["angkatan", role === "admin_tu" ? departemenId : "all"],
    queryFn: async () => {
      let q = supabase
        .from("angkatan")
        .select("*, departemen:departemen_id(id, nama)")
        .order("nama", { ascending: false });
      if (role === "admin_tu" && departemenId) q = q.eq("departemen_id", departemenId);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: role !== "admin_tu" || Boolean(departemenId),
  });
}

export function useDepartemen() {
  const { role, departemenId } = useAuth();
  return useQuery({
    queryKey: ["departemen", role === "admin_tu" ? departemenId : "all"],
    queryFn: async () => {
      let q = supabase.from("departemen").select("*").eq("aktif", true).order("nama");
      if (role === "admin_tu" && departemenId) q = q.eq("id", departemenId);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: role !== "admin_tu" || Boolean(departemenId),
  });
}

export function useDepartemenPendidikan() {
  const { role, departemenId } = useAuth();
  return useQuery({
    queryKey: ["departemen", "unit_pendidikan", role === "admin_tu" ? departemenId : "all"],
    queryFn: async () => {
      let q = supabase
        .from("departemen")
        .select("*")
        .eq("aktif", true)
        .eq("kategori", "unit_pendidikan")
        .order("nama");
      if (role === "admin_tu" && departemenId) q = q.eq("id", departemenId);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: role !== "admin_tu" || Boolean(departemenId),
  });
}

export function useTingkat(departemenIdArg?: string | null) {
  const { role, departemenId } = useAuth();
  const effectiveDept = role === "admin_tu" ? departemenId : departemenIdArg;
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
    enabled: effectiveDept !== null && (role !== "admin_tu" || Boolean(departemenId)),
  });
}

export function useKelas(tingkatId?: string) {
  const { role, departemenId } = useAuth();
  return useQuery({
    queryKey: ["kelas", tingkatId, role === "admin_tu" ? departemenId : "all"],
    queryFn: async () => {
      let q = supabase
        .from("kelas")
        .select("*, tingkat:tingkat_id(id, nama), departemen:departemen_id(id, nama)")
        .eq("aktif", true)
        .order("nama");
      if (tingkatId) q = q.eq("tingkat_id", tingkatId);
      if (role === "admin_tu" && departemenId) q = q.eq("departemen_id", departemenId);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: role !== "admin_tu" || Boolean(departemenId),
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
