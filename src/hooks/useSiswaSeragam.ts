import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllPages } from "@/lib/fetchAll";
import { useAuth } from "@/contexts/AuthContext";
import { getAkademikManagedDepartemenIds } from "@/lib/akademikScope";
import { SERAGAM_SISWA_STATUSES, type SeragamSiswaSource } from "@/lib/seragamSiswa";
import { canViewUangPangkal, uangPangkalFromMonitor } from "@/lib/seragamUangPangkal";
import { getSpmbPaymentMonitor } from "@/server/spmbPaymentMonitor";

/**
 * Uang pangkal per siswa dari Monitoring Pembayaran SPMB (nominal netto dari tagihan, dibayar dari pembayaran).
 * Hanya peran yang berhak melihat keuangan; server tetap memeriksa izin dan membatasi lembaga Admin TU.
 * Kunci query sama dengan halaman monitoring agar cache dipakai bersama.
 */
export function useSeragamUangPangkal() {
  const { user, role, can } = useAuth();
  const allowed = canViewUangPangkal(role, can("keuangan.pembayaran"));
  const query = useQuery({
    queryKey: ["spmb_payment_monitor", user?.id, role],
    queryFn: () => getSpmbPaymentMonitor(),
    enabled: allowed && Boolean(user),
    staleTime: 60_000,
    retry: 1,
  });
  const byStudent = useMemo(() => uangPangkalFromMonitor(query.data?.items ?? []), [query.data]);
  return { allowed, isLoading: allowed && query.isLoading, error: allowed ? query.error : null, byStudent };
}

/** Daftar gelombang SPMB untuk filter; kunci query sama dengan halaman SPMB agar cache dipakai bersama. */
export function useSpmbGelombang() {
  return useQuery({
    queryKey: ["spmb", "waves", "statistics"],
    queryFn: async () => {
      const { data, error } = await supabase.from("spmb_gelombang").select("id,nama").order("urutan");
      if (error) throw error;
      return data || [];
    },
  });
}

/**
 * Daftar siswa aktif dan calon diterima beserta ukuran seragamnya.
 * Hak akses lembaga mengikuti useSiswaList: admin_tu hanya melihat lembaga yang dikelolanya.
 * Kunci query diawali "siswa" agar ikut tersegarkan saat data siswa diubah.
 */
export function useSiswaSeragamList() {
  const { role } = useAuth();
  return useQuery({
    queryKey: ["siswa", "seragam", role === "admin_tu" ? "scoped" : "all"],
    queryFn: async () => {
      const managedDepartemenIds = await getAkademikManagedDepartemenIds(role);
      if (role === "admin_tu" && !managedDepartemenIds?.length) return [] as SeragamSiswaSource[];

      const data = await fetchAllPages((from, to) => {
        let q = supabase
          .from("siswa")
          .select(`
            id, nis, nama, jenis_kelamin, status, departemen_id,
            siswa_detail(ukuran_seragam, ukuran_baju, spmb_departemen_tujuan_id, tahun_ajaran_id, spmb_gelombang_id),
            kelas_siswa(id, aktif, kelas:kelas_id(id, nama, departemen_id))
          `)
          .in("status", [...SERAGAM_SISWA_STATUSES])
          .order("nama")
          .order("id");
        if (managedDepartemenIds) q = q.in("departemen_id", managedDepartemenIds);
        return q.range(from, to);
      });
      return data as unknown as SeragamSiswaSource[];
    },
  });
}
