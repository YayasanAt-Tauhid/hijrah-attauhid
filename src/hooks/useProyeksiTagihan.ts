import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalisasiBaris, type BarisRingkasan } from "@/lib/proyeksiTagihan";

/**
 * Ringkasan tagihan SPP per lembaga x bulan untuk satu tahun kalender (RPC
 * ringkasan_tagihan_periode, hanya membaca). departemenId kosong = semua lembaga.
 * Hasilnya paling banyak (jumlah lembaga x 12) baris, jadi tidak perlu paginasi RPC.
 */
export function useRingkasanTagihanPeriode({ tahun, departemenId }: { tahun: number; departemenId?: string }) {
  return useQuery({
    queryKey: ["ringkasan_tagihan_periode", tahun, departemenId ?? null],
    queryFn: async (): Promise<BarisRingkasan[]> => {
      const { data, error } = await supabase.rpc("ringkasan_tagihan_periode", {
        p_tgl_awal: `${tahun}-01-01`,
        p_tgl_akhir: `${tahun}-12-31`,
        p_departemen_id: departemenId,
      });
      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, unknown>[]).map(normalisasiBaris);
    },
  });
}
