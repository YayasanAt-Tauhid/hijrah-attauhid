import { createServerFn } from "@tanstack/react-start";
import { createAdminClient } from "./supabase";

export interface SpmbWaveSummary {
  id: string;
  nama: string;
  tanggal_mulai: string;
  tanggal_selesai: string | null;
  gratis_pendaftaran: boolean;
  aktif: boolean;
  urutan: number;
}

export interface SpmbPublicWaveResult {
  registration_open: boolean;
  current_wave: SpmbWaveSummary | null;
  next_wave: SpmbWaveSummary | null;
}

export interface SpmbPolicyStatusResult {
  siswa_id: string;
  registered_at: string;
  gratis_pendaftaran: boolean;
  payment_visible: boolean;
  group_calon_siswa_url: string | null;
  gelombang_id: string | null;
  gelombang_nama: string | null;
  gelombang_mulai: string | null;
  gelombang_selesai: string | null;
}

export const spmbGetPublicWave = createServerFn({ method: "GET" }).handler(
  async (): Promise<SpmbPublicWaveResult> => {
    const admin = createAdminClient();
    const now = new Date().toISOString();

    const { data: current, error: currentError } = await (admin
      .from("spmb_gelombang") as any)
      .select("id,nama,tanggal_mulai,tanggal_selesai,gratis_pendaftaran,aktif,urutan")
      .eq("aktif", true)
      .lte("tanggal_mulai", now)
      .or(`tanggal_selesai.is.null,tanggal_selesai.gt.${now}`)
      .order("urutan")
      .order("tanggal_mulai")
      .limit(1)
      .maybeSingle();

    if (currentError) throw new Error(currentError.message);

    const { data: next, error: nextError } = await (admin
      .from("spmb_gelombang") as any)
      .select("id,nama,tanggal_mulai,tanggal_selesai,gratis_pendaftaran,aktif,urutan")
      .eq("aktif", true)
      .gt("tanggal_mulai", now)
      .order("tanggal_mulai")
      .limit(1)
      .maybeSingle();

    if (nextError) throw new Error(nextError.message);

    return {
      registration_open: Boolean(current),
      current_wave: (current as SpmbWaveSummary | null) || null,
      next_wave: (next as SpmbWaveSummary | null) || null,
    };
  }
);

export const spmbGetPolicyStatus = createServerFn({ method: "POST" })
  .inputValidator((d: { payment_token: string }) => d)
  .handler(async ({ data }): Promise<SpmbPolicyStatusResult> => {
    const token = (data.payment_token || "").trim();
    if (!token) throw new Error("Token pendaftaran SPMB tidak lengkap");

    const admin = createAdminClient();
    const { data: detail, error: detailError } = await (admin
      .from("siswa_detail") as any)
      .select("siswa_id,spmb_gelombang_id")
      .eq("pmb_payment_token", token)
      .maybeSingle();
    if (detailError || !detail?.siswa_id) throw new Error("Pendaftaran SPMB tidak ditemukan");

    const { data: siswa, error: siswaError } = await admin
      .from("siswa")
      .select("id, created_at, departemen_id")
      .eq("id", detail.siswa_id)
      .maybeSingle();
    if (siswaError || !siswa?.created_at) throw new Error("Data calon murid SPMB tidak ditemukan");

    let wave: SpmbWaveSummary | null = null;
    if (detail.spmb_gelombang_id) {
      const { data: storedWave } = await (admin
        .from("spmb_gelombang") as any)
        .select("id,nama,tanggal_mulai,tanggal_selesai,gratis_pendaftaran,aktif,urutan")
        .eq("id", detail.spmb_gelombang_id)
        .maybeSingle();
      wave = (storedWave as SpmbWaveSummary | null) || null;
    }

    if (!wave) {
      const { data: historicalWave } = await (admin
        .from("spmb_gelombang") as any)
        .select("id,nama,tanggal_mulai,tanggal_selesai,gratis_pendaftaran,aktif,urutan")
        .lte("tanggal_mulai", siswa.created_at)
        .or(`tanggal_selesai.is.null,tanggal_selesai.gt.${siswa.created_at}`)
        .order("urutan")
        .limit(1)
        .maybeSingle();
      wave = (historicalWave as SpmbWaveSummary | null) || null;
    }

    const { data: config } = await (admin
      .from("konfigurasi_pmb") as any)
      .select("group_calon_siswa_url")
      .eq("departemen_id", siswa.departemen_id)
      .maybeSingle();

    return {
      siswa_id: siswa.id,
      registered_at: siswa.created_at,
      gratis_pendaftaran: wave?.gratis_pendaftaran === true,
      payment_visible: Boolean(wave && !wave.gratis_pendaftaran),
      group_calon_siswa_url: (config as any)?.group_calon_siswa_url || null,
      gelombang_id: wave?.id || null,
      gelombang_nama: wave?.nama || null,
      gelombang_mulai: wave?.tanggal_mulai || null,
      gelombang_selesai: wave?.tanggal_selesai || null,
    };
  });
