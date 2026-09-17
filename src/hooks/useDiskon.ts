/**
 * Hooks: diskon/keringanan SPP
 *
 * Pembagian jalur akses:
 *   - master `skema_diskon` -> langsung lewat supabase client + RLS
 *   - daftar `siswa_diskon` -> lewat server function agar penyetuju hanya
 *     menerima data siswa ringkas yang dibutuhkan tanpa membuka tabel siswa
 *   - mutasi yang menyentuh jurnal/keputusan (ajukan, setujui, terapkan,
 *     kelompok keluarga) -> lewat server function di `src/server/diskon.ts`,
 *     karena RPC-nya dikunci ke service_role di database
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  listSiswaDiskon,
  ajukanDiskonSiswa,
  putuskanDiskonSiswa,
  terapkanDiskonSiswa,
  saranKelompokKeluarga,
  konfirmasiKelompokKeluarga,
  type AjukanDiskonInput,
  type PutuskanDiskonInput,
  type KonfirmasiKeluargaInput,
} from "@/server/diskon";

export type KategoriDiskon =
  | "beasiswa"
  | "keringanan"
  | "kakak_adik"
  | "bantuan"
  | "promo"
  | "lainnya";

export type StatusDiskon = "diajukan" | "disetujui" | "ditolak" | "dibatalkan";

export const LABEL_KATEGORI: Record<KategoriDiskon, string> = {
  beasiswa: "Beasiswa",
  keringanan: "Keringanan",
  kakak_adik: "Kakak-Adik",
  bantuan: "Bantuan",
  promo: "Promo",
  lainnya: "Lainnya",
};

export const LABEL_STATUS: Record<StatusDiskon, string> = {
  diajukan: "Menunggu Persetujuan",
  disetujui: "Disetujui",
  ditolak: "Ditolak",
  dibatalkan: "Dibatalkan",
};

export interface SkemaDiskon {
  id: string;
  nama: string;
  kategori: KategoriDiskon;
  tipe: "persen" | "nominal";
  nilai_default: number;
  perlu_approval: boolean;
  aktif: boolean;
  keterangan: string | null;
}

// ─── Skema diskon (master) ───

export function useSkemaDiskon(hanyaAktif = false) {
  return useQuery({
    queryKey: ["skema_diskon", { hanyaAktif }],
    queryFn: async () => {
      let q = supabase
        .from("skema_diskon")
        .select("id, nama, kategori, tipe, nilai_default, perlu_approval, aktif, keterangan")
        .order("kategori")
        .order("nama");
      if (hanyaAktif) q = q.eq("aktif", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as SkemaDiskon[];
    },
  });
}

export function useCreateSkemaDiskon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Omit<SkemaDiskon, "id">) => {
      const { error } = await supabase.from("skema_diskon").insert(values);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skema_diskon"] });
      toast.success("Skema diskon berhasil ditambahkan");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateSkemaDiskon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<SkemaDiskon> & { id: string }) => {
      const { error } = await supabase.from("skema_diskon").update(values).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skema_diskon"] });
      toast.success("Skema diskon berhasil diperbarui");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteSkemaDiskon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("skema_diskon").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skema_diskon"] });
      toast.success("Skema diskon dihapus");
    },
    onError: (e: Error) =>
      toast.error(
        e.message.includes("foreign key") || e.message.includes("violates")
          ? "Skema ini sudah dipakai pada pemberian diskon siswa, jadi tidak bisa dihapus. Nonaktifkan saja."
          : e.message
      ),
  });
}

// ─── Pemberian diskon per siswa ───

export interface SiswaDiskonRow {
  id: string;
  siswa_id: string;
  skema_diskon_id: string;
  jenis_id: string;
  periode_mulai: string;
  periode_selesai: string;
  nilai: number | null;
  status: StatusDiskon;
  catatan: string | null;
  dokumen_url: string | null;
  alasan_penolakan: string | null;
  diajukan_at: string;
  diputuskan_at: string | null;
  diterapkan_at: string | null;
  siswa: { nama: string; nis: string | null } | null;
  skema_diskon: Pick<SkemaDiskon, "nama" | "kategori" | "tipe" | "nilai_default"> | null;
  jenis_pembayaran: { nama: string } | null;
  /** Jumlah pengajuan lama untuk siswa+jenis+periode yang sama. */
  riwayat_count: number;
}

export function useSiswaDiskonList(filter?: {
  status?: StatusDiskon;
  siswa_id?: string;
}) {
  return useQuery({
    queryKey: ["siswa_diskon", filter ?? {}],
    queryFn: async () => {
      const hasil = await listSiswaDiskon({ data: filter ?? {} });
      return hasil.items as unknown as SiswaDiskonRow[];
    },
  });
}

export function useAjukanDiskon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AjukanDiskonInput) => ajukanDiskonSiswa({ data: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["siswa_diskon"] });
      toast.success("Pengajuan keringanan tersimpan, menunggu persetujuan sekretaris yayasan");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function usePutuskanDiskon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PutuskanDiskonInput) => putuskanDiskonSiswa({ data: input }),
    onSuccess: (hasil) => {
      qc.invalidateQueries({ queryKey: ["siswa_diskon"] });
      qc.invalidateQueries({ queryKey: ["tagihan"] });

      if (hasil.status === "ditolak") {
        toast.success("Pengajuan ditolak");
        return;
      }

      const p = hasil.penerapan;
      const bagian: string[] = [];
      if (p?.terjadwal_diubah) bagian.push(`${p.terjadwal_diubah} tagihan terjadwal disesuaikan`);
      if (p?.dikoreksi_jurnal) bagian.push(`${p.dikoreksi_jurnal} dikoreksi lewat jurnal`);
      toast.success(
        bagian.length > 0
          ? `Disetujui — ${bagian.join(", ")}`
          : "Disetujui — belum ada tagihan pada periode ini yang perlu disesuaikan"
      );

      if (p?.dilewati) {
        toast.warning(
          `${p.dilewati} tagihan dilewati karena sudah lunas/dibayar sebagian — ` +
            "perlu ditangani manual (refund atau koreksi pembayaran)."
        );
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useTerapkanDiskon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (siswa_diskon_id: string) => terapkanDiskonSiswa({ data: { siswa_diskon_id } }),
    onSuccess: (hasil) => {
      qc.invalidateQueries({ queryKey: ["siswa_diskon"] });
      qc.invalidateQueries({ queryKey: ["tagihan"] });
      const total = hasil.terjadwal_diubah + hasil.dikoreksi_jurnal;
      toast.success(
        total > 0
          ? `${total} tagihan disesuaikan (${hasil.dikoreksi_jurnal} lewat jurnal koreksi)`
          : "Semua tagihan pada periode ini sudah sesuai"
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Kelompok keluarga (kakak-adik) ───

export function useSaranKeluarga(enabled: boolean) {
  return useQuery({
    queryKey: ["saran_keluarga"],
    enabled,
    queryFn: async () => (await saranKelompokKeluarga({ data: {} })).saran,
  });
}

export function useKonfirmasiKeluarga() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: KonfirmasiKeluargaInput) =>
      konfirmasiKelompokKeluarga({ data: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saran_keluarga"] });
      qc.invalidateQueries({ queryKey: ["siswa"] });
      toast.success("Kelompok keluarga tersimpan — potongan kakak-adik kini bisa diajukan");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Nilai potongan yang akan dipakai untuk satu pengajuan, dihitung dari skema +
 * override. Dipakai untuk preview di form; perhitungan yang mengikat tetap
 * dilakukan di database.
 */
export function hitungPreviewDiskon(
  skema: Pick<SkemaDiskon, "tipe" | "nilai_default"> | undefined,
  nilaiOverride: number | null | undefined,
  tarifBruto: number
): number {
  if (!skema || tarifBruto <= 0) return 0;
  const nilai = nilaiOverride ?? skema.nilai_default ?? 0;
  const diskon =
    skema.tipe === "persen"
      ? (tarifBruto * Math.min(Math.max(nilai, 0), 100)) / 100
      : Math.max(nilai, 0);
  return Math.min(Math.round(diskon), tarifBruto);
}
