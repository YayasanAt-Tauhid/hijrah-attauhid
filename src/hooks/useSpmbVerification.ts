import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SpmbVerificationRequirement = {
  key: string;
  label: string;
  kind: "field" | "document";
  required: boolean;
  valid: boolean;
  display_value?: string | null;
  path?: string | null;
};

export type SpmbVerificationHistory = {
  status: "terverifikasi" | "perlu_verifikasi_ulang";
  created_at: string;
  petugas?: string | null;
  reason?: string | null;
};

export type SpmbVerificationState = {
  siswa_id: string;
  student_status: string;
  status: "belum_verifikasi" | "terverifikasi" | "perlu_verifikasi_ulang";
  version: string;
  verified_version?: string | null;
  verified_at?: string | null;
  verified_by_name?: string | null;
  last_reason?: string | null;
  can_verify: boolean;
  can_submit: boolean;
  data_current: boolean;
  checklist: Record<string, boolean>;
  requirements: SpmbVerificationRequirement[];
  required_total: number;
  required_checked: number;
  invalid_required: string[];
  unchecked_required: string[];
  history: SpmbVerificationHistory[];
};

export const spmbVerificationQueryKey = (siswaId: string) => ["spmb_verification_state", siswaId] as const;

export async function fetchSpmbVerificationState(siswaId: string): Promise<SpmbVerificationState> {
  const { data, error } = await (supabase as any).rpc("spmb_verification_state", { p_siswa_id: siswaId });
  if (error) throw error;
  return data as SpmbVerificationState;
}

export async function saveSpmbVerificationFields(
  siswaId: string,
  changes: Record<string, boolean>,
  version: string,
): Promise<SpmbVerificationState> {
  const { data, error } = await (supabase as any).rpc("spmb_set_field_verifications", {
    p_siswa_id: siswaId,
    p_changes: changes,
    p_version: version,
  });
  if (error) throw error;
  return data as SpmbVerificationState;
}

export function useSpmbVerificationState(siswaId: string) {
  return useQuery({
    queryKey: spmbVerificationQueryKey(siswaId),
    queryFn: () => fetchSpmbVerificationState(siswaId),
    enabled: Boolean(siswaId),
  });
}

export function useRefreshSpmbVerification(siswaId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: spmbVerificationQueryKey(siswaId) }),
      queryClient.invalidateQueries({ queryKey: ["siswa", siswaId] }),
      queryClient.invalidateQueries({ queryKey: ["siswa_detail", siswaId] }),
      queryClient.invalidateQueries({ queryKey: ["siswa", "calon"] }),
    ]);
  };
}
