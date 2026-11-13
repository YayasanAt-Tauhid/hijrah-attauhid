import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllPages } from "@/lib/fetchAll";
import { useAuth } from "@/contexts/AuthContext";
import { getAkademikManagedDepartemenIds } from "@/lib/akademikScope";
import { SERAGAM_SISWA_STATUSES, type SeragamSiswaSource } from "@/lib/seragamSiswa";

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
            siswa_detail(ukuran_seragam, spmb_departemen_tujuan_id),
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
