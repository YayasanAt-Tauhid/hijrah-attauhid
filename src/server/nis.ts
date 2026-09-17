/**
 * Server function: generateNis
 * Migrasi dari supabase/functions/generate-nis.
 * Generate & simpan NIS unik untuk siswa. Hanya admin / kepala_sekolah.
 */
import { createServerFn } from "@tanstack/react-start";
import { getKodeRombel } from "@/lib/nisRombel";
import { authMiddleware, requireContext, requireRole } from "./auth";
import { createAdminClient } from "./supabase";

export interface GenerateNisInput {
  siswa_id: string;
  departemen_id: string;
  angkatan_id: string;
  kelas_id: string;
}

export const generateNis = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: GenerateNisInput) => d)
  .handler(async ({ data, context }): Promise<{ success: true; nis: string }> => {
    const admin = createAdminClient();
    await requireRole(admin, requireContext(context).userId, ["admin", "kepala_sekolah"]);

    const { siswa_id, departemen_id, angkatan_id, kelas_id } = data;
    if (!siswa_id || !departemen_id || !angkatan_id || !kelas_id) {
      throw new Error(
        "siswa_id, departemen_id, angkatan_id, dan kelas_id diperlukan"
      );
    }

    // 1. Departemen → NPSN
    const { data: dept } = await admin
      .from("departemen")
      .select("npsn")
      .eq("id", departemen_id)
      .single();
    if (!dept?.npsn) throw new Error("NPSN belum diisi untuk jenjang ini");
    const npsn4 = dept.npsn.slice(-4);

    // 2. Angkatan → tahun
    const { data: angkatan } = await admin
      .from("angkatan")
      .select("nama")
      .eq("id", angkatan_id)
      .single();
    if (!angkatan) throw new Error("Angkatan tidak ditemukan");
    const tahunMatch = angkatan.nama.trim().match(/\d{4}/);
    if (!tahunMatch) {
      throw new Error(
        "Format nama angkatan harus mengandung tahun, contoh: 2025 atau 2025/2026"
      );
    }
    const tahun2 = tahunMatch[0].slice(-2);

    // 3. Kelas → kode rombel
    const { data: kelas } = await admin
      .from("kelas")
      .select("nama")
      .eq("id", kelas_id)
      .single();
    if (!kelas) throw new Error("Kelas tidak ditemukan");
    const rombelCode = getKodeRombel(kelas.nama);
    if (rombelCode === null) {
      throw new Error(
        "Format nama kelas tidak valid; gunakan akhiran huruf A-Z atau angka 1-9"
      );
    }
    const kodeRombel = String(rombelCode);

    // 4. Cari nomor urut berikutnya. Pola: {npsn4}{3 digit urut}{kodeRombel}{tahun2}
    const likePattern = `${npsn4}___${kodeRombel}${tahun2}`;
    const MAX_RETRIES = 5;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const { count } = await admin
        .from("siswa")
        .select("*", { count: "exact", head: true })
        .like("nis", likePattern);

      const urut = (count || 0) + 1 + attempt;
      const urutStr = String(urut).padStart(3, "0");
      const generatedNIS = `${npsn4}${urutStr}${kodeRombel}${tahun2}`;

      const { count: existCount } = await admin
        .from("siswa")
        .select("*", { count: "exact", head: true })
        .eq("nis", generatedNIS);

      if ((existCount || 0) === 0) {
        const { error: updateErr } = await admin
          .from("siswa")
          .update({ nis: generatedNIS })
          .eq("id", siswa_id);
        if (updateErr) throw new Error(updateErr.message);
        return { success: true, nis: generatedNIS };
      }
    }

    throw new Error("Gagal generate NIS, coba lagi");
  });
