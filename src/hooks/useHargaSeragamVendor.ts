import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizeUkuranList, pesanGalatHarga, type HargaInput, type HargaSeragamVendor } from "@/lib/seragamVendor";

const KEY = "harga_seragam_vendor";
const COLUMNS = "id, tahun_ajaran_id, departemen_id, jenis_kelamin, nama_stel, ukuran, harga, catatan, aktif";
const TABLE = "harga_seragam_vendor";

/** Harga vendor satu tahun ajaran. RLS: hanya admin dan keuangan yang mendapat baris. */
export function useHargaSeragamVendor(tahunAjaranId: string) {
  return useQuery({
    queryKey: [KEY, tahunAjaranId],
    enabled: Boolean(tahunAjaranId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from(TABLE)
        .select(COLUMNS)
        .eq("tahun_ajaran_id", tahunAjaranId)
        .order("departemen_id")
        .order("nama_stel")
        .order("id");
      if (error) throw new Error(pesanGalatHarga(error));
      return ((data ?? []) as unknown as Array<HargaSeragamVendor & { harga: number | string }>).map((row) => ({
        ...row,
        harga: Number(row.harga),
        ukuran: row.ukuran ?? [],
      })) as HargaSeragamVendor[];
    },
  });
}

function rapikan(input: HargaInput): HargaInput {
  return { ...input, nama_stel: input.nama_stel.trim(), ukuran: normalizeUkuranList(input.ukuran) };
}

export function useSimpanHargaSeragamVendor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: HargaInput & { id?: string }) => {
      const payload = rapikan(input);
      const { error } = id
        ? await supabase.from(TABLE).update(payload).eq("id", id)
        : await supabase.from(TABLE).insert(payload);
      if (error) throw new Error(pesanGalatHarga(error));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useUbahAktifHarga() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, aktif }: { id: string; aktif: boolean }) => {
      const { error } = await supabase.from(TABLE).update({ aktif }).eq("id", id);
      if (error) throw new Error(pesanGalatHarga(error));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useSalinHargaSeragam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (baris: HargaInput[]) => {
      const { error } = await supabase.from(TABLE).insert(baris.map(rapikan));
      if (error) throw new Error(pesanGalatHarga(error));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}
