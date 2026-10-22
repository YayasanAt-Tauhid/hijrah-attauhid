import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { generateNis } from "@/server/nis";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface Props {
  siswaId: string;
  departemenId: string;
  angkatanId: string;
  namaLembaga: string;
}
export function SpmbNisField({ siswaId, departemenId, angkatanId, namaLembaga }: Props) {
  const client = useQueryClient();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const history = useQuery({
    queryKey: ["nis_spmb", siswaId, departemenId],
    queryFn: async () => {
      const { data, error } = await supabase.from("siswa_tahun_masuk_departemen")
        .select("nis").eq("siswa_id", siswaId).eq("departemen_id", departemenId).maybeSingle();
      if (error) throw error;
      return data?.nis || "";
    },
  });
  useEffect(() => { setValue(history.data || ""); }, [history.data]);
  async function save(manual: boolean) {
    setBusy(true);
    try {
      const { nis } = await generateNis({ data: {
        siswa_id: siswaId, departemen_id: departemenId, angkatan_id: angkatanId,
        tujuan: "spmb", ...(manual ? { nis_manual: value } : {}),
      } });
      setValue(nis);
      client.setQueryData(["nis_spmb", siswaId, departemenId], nis);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["siswa"] }),
        client.invalidateQueries({ queryKey: ["siswa_nis_departemen", siswaId] }),
      ]);
      toast.success("NIS tujuan berhasil disimpan: " + nis);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan NIS tujuan");
    } finally { setBusy(false); }
  }
  return <div className="rounded-md border p-3 space-y-2">
    <label htmlFor="spmb-nis-tujuan" className="text-sm font-medium">NIS Tujuan {namaLembaga}</label>
    <Input id="spmb-nis-tujuan" value={value} onChange={event => setValue(event.target.value)}
      inputMode="numeric" maxLength={13} placeholder="Ketik NIS tujuan atau buat otomatis"
      disabled={busy || history.isLoading || Boolean(history.data)} />
    <p className="text-xs text-muted-foreground">Bisa diisi sebelum penempatan kelas. NIS dan kelas lembaga asal tetap tersimpan.</p>
    {history.isError && <p className="text-xs text-destructive">NIS tujuan belum berhasil dimuat. Coba muat ulang.</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" disabled={busy || history.isLoading || history.isError || Boolean(history.data)}
        onClick={() => void save(false)}>Buat NIS Tujuan Otomatis</Button>
      <Button type="button" size="sm" disabled={busy || history.isLoading || history.isError || !value.trim() || Boolean(history.data)}
        onClick={() => void save(true)}>Simpan NIS Tujuan</Button>
    </div>
  </div>;
}
