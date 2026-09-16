import { createServerFn } from "@tanstack/react-start";
import { createAdminClient } from "./supabase";
import { isSpmbFirstWaveFree, isSpmbPaymentVisible } from "@/lib/spmbPolicy";

export interface SpmbPolicyStatusResult {
  siswa_id: string;
  registered_at: string;
  gratis_pendaftaran: boolean;
  payment_visible: boolean;
}

export const spmbGetPolicyStatus = createServerFn({ method: "POST" })
  .inputValidator((d: { payment_token: string }) => d)
  .handler(async ({ data }): Promise<SpmbPolicyStatusResult> => {
    const token = (data.payment_token || "").trim();
    if (!token) throw new Error("Token pendaftaran SPMB tidak lengkap");

    const admin = createAdminClient();
    const { data: detail, error: detailError } = await admin
      .from("siswa_detail")
      .select("siswa_id")
      .eq("pmb_payment_token", token)
      .maybeSingle();
    if (detailError || !detail?.siswa_id) throw new Error("Pendaftaran SPMB tidak ditemukan");

    const { data: siswa, error: siswaError } = await admin
      .from("siswa")
      .select("id, created_at")
      .eq("id", detail.siswa_id)
      .maybeSingle();
    if (siswaError || !siswa?.created_at) throw new Error("Data calon murid SPMB tidak ditemukan");

    return {
      siswa_id: siswa.id,
      registered_at: siswa.created_at,
      gratis_pendaftaran: isSpmbFirstWaveFree(siswa.created_at),
      payment_visible: isSpmbPaymentVisible(),
    };
  });
