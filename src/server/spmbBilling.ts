import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, requireContext, requireRole } from "./auth";
import { createAdminClient } from "./supabase";

export interface SpmbBillingCandidate {
  id: string;
  nama: string;
  nis: string | null;
  status: string | null;
  departemen_id: string | null;
  target_departemen_id: string | null;
  target_departemen_nama: string | null;
  target_departemen_kode: string | null;
  tahun_ajaran_id: string | null;
  tahun_ajaran_nama: string | null;
  tahun_ajaran_mulai: string | null;
  tahun_ajaran_selesai: string | null;
  kelas_id: string | null;
  kelas_nama: string | null;
  spmb_internal: boolean;
  spmb_tanggal_lulus: string | null;
  spmb_tanggal_aktivasi: string | null;
  ready_for_billing: boolean;
  ready_reason: string | null;
  rencana_spp: {
    id: string;
    jenis_id: string;
    jenis_nama: string;
    nominal: number;
    mulai: string;
    selesai: string;
    bulan_terakhir: number;
    sampai_akhir_jenjang: boolean;
  } | null;
}

export const getSpmbBillingCandidates = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ items: SpmbBillingCandidate[] }> => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    await requireRole(admin, userId, ["admin", "keuangan"]);

    const { data: detailRows, error: detailError } = await (admin as any)
      .from("siswa_detail")
      .select(
        "siswa_id,tahun_ajaran_id,spmb_status_kelulusan,spmb_tanggal_lulus,spmb_departemen_tujuan_id,spmb_kelas_tujuan_id,spmb_siswa_internal,spmb_tanggal_aktivasi,spmb_registered_at,spmb_gelombang_id"
      )
      .eq("spmb_status_kelulusan", "lulus")
      .not("spmb_gelombang_id", "is", null)
      .order("spmb_registered_at", { ascending: false })
      .limit(1000);

    if (detailError) {
      throw new Error("Gagal mengambil siswa SPMB lulus: " + detailError.message);
    }

    // Satu siswa bisa ikut SPMB lebih dari sekali. Ambil siklus lulus terbaru.
    const latestDetailBySiswa = new Map<string, any>();
    for (const row of detailRows || []) {
      if (row.siswa_id && !latestDetailBySiswa.has(row.siswa_id)) {
        latestDetailBySiswa.set(row.siswa_id, row);
      }
    }

    const siswaIds = Array.from(latestDetailBySiswa.keys());
    if (siswaIds.length === 0) return { items: [] };

    const [siswaResult, kelasResult, rencanaResult] = await Promise.all([
      admin
        .from("siswa")
        .select("id,nama,nis,status,departemen_id")
        .in("id", siswaIds),
      admin
        .from("kelas_siswa")
        .select("siswa_id,kelas_id,tahun_ajaran_id,aktif,kelas:kelas_id(id,nama,departemen_id)")
        .in("siswa_id", siswaIds)
        .eq("aktif", true),
      (admin as any)
        .from("rencana_tagihan_siswa")
        .select("id,siswa_id,jenis_id,nominal,mulai,selesai,bulan_terakhir,sampai_akhir_jenjang,aktif,jenis:jenis_id(nama,tipe)")
        .in("siswa_id", siswaIds)
        .eq("aktif", true),
    ]);

    if (siswaResult.error) throw new Error("Gagal mengambil data siswa: " + siswaResult.error.message);
    if (kelasResult.error) throw new Error("Gagal mengambil kelas siswa: " + kelasResult.error.message);
    if (rencanaResult.error) throw new Error("Gagal mengambil rencana tagihan: " + rencanaResult.error.message);

    const targetDeptIds = Array.from(
      new Set(
        Array.from(latestDetailBySiswa.values())
          .map((row: any) => row.spmb_departemen_tujuan_id)
          .filter(Boolean),
      ),
    ) as string[];
    const tahunIds = Array.from(
      new Set(
        Array.from(latestDetailBySiswa.values())
          .map((row: any) => row.tahun_ajaran_id)
          .filter(Boolean),
      ),
    ) as string[];
    const targetClassIds = Array.from(
      new Set(
        Array.from(latestDetailBySiswa.values())
          .map((row: any) => row.spmb_kelas_tujuan_id)
          .filter(Boolean),
      ),
    ) as string[];

    const [deptResult, tahunResult, targetClassResult] = await Promise.all([
      targetDeptIds.length
        ? admin.from("departemen").select("id,nama,kode").in("id", targetDeptIds)
        : Promise.resolve({ data: [], error: null }),
      tahunIds.length
        ? admin
            .from("tahun_ajaran")
            .select("id,nama,tanggal_mulai,tanggal_selesai")
            .in("id", tahunIds)
        : Promise.resolve({ data: [], error: null }),
      targetClassIds.length
        ? admin.from("kelas").select("id,nama,departemen_id").in("id", targetClassIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (deptResult.error) throw new Error("Gagal mengambil lembaga tujuan: " + deptResult.error.message);
    if (tahunResult.error) throw new Error("Gagal mengambil tahun ajaran: " + tahunResult.error.message);
    if (targetClassResult.error) throw new Error("Gagal mengambil kelas tujuan: " + targetClassResult.error.message);

    const siswaById = new Map((siswaResult.data || []).map((row: any) => [row.id, row]));
    const activeClassBySiswa = new Map<string, any>();
    for (const row of (kelasResult.data || []) as any[]) {
      if (!activeClassBySiswa.has(row.siswa_id)) activeClassBySiswa.set(row.siswa_id, row);
    }
    const deptById = new Map((deptResult.data || []).map((row: any) => [row.id, row]));
    const tahunById = new Map((tahunResult.data || []).map((row: any) => [row.id, row]));
    const classById = new Map((targetClassResult.data || []).map((row: any) => [row.id, row]));

    const sppPlanBySiswa = new Map<string, any>();
    for (const row of (rencanaResult.data || []) as any[]) {
      const tipe = row.jenis?.tipe;
      const nama = String(row.jenis?.nama || "");
      if (tipe === "bulanan" && /(^|\s|[-_/])SPP($|\s|[-_/])/i.test(nama)) {
        sppPlanBySiswa.set(row.siswa_id, row);
      }
    }

    const items: SpmbBillingCandidate[] = [];
    for (const [siswaId, detail] of latestDetailBySiswa.entries()) {
      const siswa = siswaById.get(siswaId) as any;
      if (!siswa) continue;

      const activeClass = activeClassBySiswa.get(siswaId) as any;
      const targetClass = detail.spmb_kelas_tujuan_id
        ? classById.get(detail.spmb_kelas_tujuan_id)
        : null;
      const targetDeptId =
        detail.spmb_departemen_tujuan_id ||
        targetClass?.departemen_id ||
        activeClass?.kelas?.departemen_id ||
        siswa.departemen_id ||
        null;
      const targetDept = targetDeptId ? deptById.get(targetDeptId) : null;
      const tahun = detail.tahun_ajaran_id ? tahunById.get(detail.tahun_ajaran_id) : null;

      const isInternal = detail.spmb_siswa_internal === true;
      const ready = siswa.status === "aktif" && (!isInternal || Boolean(detail.spmb_tanggal_aktivasi));
      let readyReason: string | null = null;
      if (!ready) {
        if (isInternal && !detail.spmb_tanggal_aktivasi) {
          readyReason = "Aktifkan perpindahan ke jenjang tujuan terlebih dahulu di halaman SPMB.";
        } else if (siswa.status !== "aktif") {
          readyReason = "Aktifkan siswa terlebih dahulu di halaman SPMB.";
        } else {
          readyReason = "Data aktivasi jenjang tujuan belum lengkap.";
        }
      }

      const rawPlan = sppPlanBySiswa.get(siswaId) as any;
      const plan = rawPlan && tahun?.tanggal_mulai && String(rawPlan.selesai || "") < String(tahun.tanggal_mulai)
        ? null
        : rawPlan;
      const effectiveClass = targetClass || activeClass?.kelas || null;

      items.push({
        id: siswa.id,
        nama: siswa.nama || "—",
        nis: siswa.nis || null,
        status: siswa.status || null,
        departemen_id: siswa.departemen_id || null,
        target_departemen_id: targetDeptId,
        target_departemen_nama: targetDept?.nama || null,
        target_departemen_kode: targetDept?.kode || null,
        tahun_ajaran_id: detail.tahun_ajaran_id || null,
        tahun_ajaran_nama: tahun?.nama || null,
        tahun_ajaran_mulai: tahun?.tanggal_mulai || null,
        tahun_ajaran_selesai: tahun?.tanggal_selesai || null,
        kelas_id: effectiveClass?.id || activeClass?.kelas_id || null,
        kelas_nama: effectiveClass?.nama || activeClass?.kelas?.nama || null,
        spmb_internal: isInternal,
        spmb_tanggal_lulus: detail.spmb_tanggal_lulus || null,
        spmb_tanggal_aktivasi: detail.spmb_tanggal_aktivasi || null,
        ready_for_billing: ready,
        ready_reason: readyReason,
        rencana_spp: plan
          ? {
              id: plan.id,
              jenis_id: plan.jenis_id,
              jenis_nama: plan.jenis?.nama || "SPP",
              nominal: Number(plan.nominal || 0),
              mulai: plan.mulai,
              selesai: plan.selesai,
              bulan_terakhir: Number(plan.bulan_terakhir || 6),
              sampai_akhir_jenjang: plan.sampai_akhir_jenjang !== false,
            }
          : null,
      });
    }

    items.sort((a, b) => a.nama.localeCompare(b.nama, "id-ID"));
    return { items };
  });

export const updateSpmbBillingPlanEndMonth = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: { rencana_id: string; bulan_terakhir: number; mulai: string }) => d)
  .handler(async ({ data, context }): Promise<{ success: true; mulai: string; selesai: string }> => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    await requireRole(admin, userId, ["admin", "keuangan"]);

    const rencanaId = String(data?.rencana_id || "");
    const bulan = Number(data?.bulan_terakhir);
    const mulai = String(data?.mulai || "");
    if (!rencanaId) throw new Error("Rencana tagihan tidak ditemukan");
    if (!/^\d{4}-\d{2}-01$/.test(mulai)) {
      throw new Error("Bulan mulai SPP tidak valid");
    }
    if (![4, 5, 6].includes(bulan)) {
      throw new Error("Bulan terakhir SPP hanya dapat dipilih April, Mei, atau Juni");
    }

    const { data: row, error } = await (admin as any)
      .from("rencana_tagihan_siswa")
      .select("id,mulai,selesai,aktif,sampai_akhir_jenjang")
      .eq("id", rencanaId)
      .maybeSingle();

    if (error) throw new Error("Gagal membaca rencana tagihan: " + error.message);
    if (!row || row.aktif !== true || row.sampai_akhir_jenjang !== true) {
      throw new Error("Rencana SPP aktif sampai akhir jenjang tidak ditemukan");
    }

    const existingEnd = new Date(String(row.selesai) + "T00:00:00Z");
    if (Number.isNaN(existingEnd.getTime())) throw new Error("Tanggal akhir rencana tidak valid");
    const year = existingEnd.getUTCFullYear();
    const lastDay = new Date(Date.UTC(year, bulan, 0)).toISOString().slice(0, 10);

    if (lastDay < mulai) {
      throw new Error("Bulan akhir rencana tidak boleh sebelum periode mulai");
    }

    const { error: updateError } = await (admin as any)
      .from("rencana_tagihan_siswa")
      .update({
        mulai,
        bulan_terakhir: bulan,
        selesai: lastDay,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rencanaId);

    if (updateError) throw new Error("Gagal mengubah batas akhir SPP: " + updateError.message);

    return { success: true, mulai, selesai: lastDay };
  });