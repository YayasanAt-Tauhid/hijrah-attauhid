import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface TarifAtomikRow {
  jenis_id: string;
  siswa_id?: string | null;
  kelas_id?: string | null;
  angkatan_id?: string | null;
  tahun_ajaran_id: string;
  nominal: number;
  keterangan?: string | null;
}

export interface GenerateGroupAtomik {
  tahun_buku_id: string;
  bulan_list: Array<number | null>;
}

export interface SimpanTarifGenerateAtomikInput {
  tarif_rows: TarifAtomikRow[];
  tahun_akademik_id: string;
  jenis_id: string;
  generate_groups: GenerateGroupAtomik[];
  departemen_id?: string | null;
  siswa_ids?: string[] | null;
  siswa_id?: string | null;
  kelas_id?: string | null;
  angkatan_id?: string | null;
  sampai_akhir_jenjang?: boolean;
  rencana_mulai?: string | null;
  rencana_rows?: Array<{ siswa_id: string; nominal: number }>;
  bulan_terakhir?: number;
}

export interface SimpanTarifGenerateAtomikResult {
  success: boolean;
  tarif_inserted: number;
  generated: number;
  skipped: number;
  scheduled: number;
  sampai_akhir_jenjang?: boolean;
  rencana_count?: number;
  rencana_massal?: Array<{ siswa_id: string; selesai: string }>;
  rencana?: {
    rencana_id: string;
    mulai: string;
    selesai: string;
    tarif_id: string;
  } | null;
}

export function useSimpanTarifGenerateAtomik() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: SimpanTarifGenerateAtomikInput) => {
      const { data, error } = input.rencana_rows
        ? await (supabase as any).rpc("simpan_tarif_generate_rencana_massal_atomik", {
            p_tarif_rows: input.tarif_rows,
            p_tahun_akademik_id: input.tahun_akademik_id,
            p_jenis_id: input.jenis_id,
            p_generate_groups: input.generate_groups,
            p_rencana_rows: input.rencana_rows,
            p_rencana_mulai: input.rencana_mulai,
            p_bulan_terakhir: input.bulan_terakhir ?? 6,
          })
        : await (supabase as any).rpc(
        "simpan_tarif_generate_dan_rencana_atomik",
        {
          p_tarif_rows: input.tarif_rows,
          p_tahun_akademik_id: input.tahun_akademik_id,
          p_jenis_id: input.jenis_id,
          p_generate_groups: input.generate_groups,
          p_departemen_id: input.departemen_id || null,
          p_siswa_ids: input.siswa_ids?.length ? input.siswa_ids : null,
          p_siswa_id: input.siswa_id || null,
          p_kelas_id: input.kelas_id || null,
          p_angkatan_id: input.angkatan_id || null,
          p_sampai_akhir_jenjang: input.sampai_akhir_jenjang === true,
          p_rencana_mulai: input.rencana_mulai || null,
        }
      );
      if (error) throw error;
      return data as SimpanTarifGenerateAtomikResult;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["tarif_tagihan"] });
      qc.invalidateQueries({ queryKey: ["tagihan"] });
      qc.invalidateQueries({ queryKey: ["jurnal"] });
      qc.invalidateQueries({ queryKey: ["rencana_tagihan_siswa"] });

      const scheduledInfo = data.scheduled > 0
        ? `, ${data.scheduled} belum jatuh tempo`
        : "";
      const rencanaInfo = data.rencana_count
        ? ` · ${data.rencana_count} rencana SPP sampai akhir jenjang`
        : data.sampai_akhir_jenjang && data.rencana?.selesai
        ? ` · otomatis sampai akhir jenjang (${new Date(`${data.rencana.selesai}T00:00:00`).toLocaleDateString("id-ID")})`
        : "";

      if (data.tarif_inserted === 0) {
        toast.success(
          `Tagihan berhasil diproses tanpa membuat override: ${data.generated} tagihan baru, ${data.skipped} sudah ada${scheduledInfo}${rencanaInfo}`
        );
        return;
      }

      toast.success(
        `Override & tagihan berhasil disimpan atomik: ${data.tarif_inserted} override, ${data.generated} tagihan baru, ${data.skipped} sudah ada${scheduledInfo}${rencanaInfo}`
      );
    },
    onError: (e: any) => {
      toast.error(`Proses tarif/tagihan dibatalkan/rollback: ${e.message}`);
    },
  });
}
