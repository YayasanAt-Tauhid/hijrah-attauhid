import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizeAkrualRow, type AkrualLogRow } from "@/lib/akrualLog";

/** Riwayat eksekusi akrual harian terbaru (RLS: hanya admin/keuangan yang dapat membaca). */
export function useAkrualLog(limit = 14) {
  return useQuery({
    queryKey: ["akrual_harian_log", limit],
    staleTime: 60_000,
    queryFn: async (): Promise<AkrualLogRow[]> => {
      const { data, error } = await (supabase as any)
        .from("akrual_harian_log")
        .select("*")
        .order("dijalankan_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(normalizeAkrualRow);
    },
  });
}
