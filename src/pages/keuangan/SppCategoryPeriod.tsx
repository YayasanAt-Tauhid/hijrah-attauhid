import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { getSppPeriodHistory, getSppPeriodOptions, previewOrApplySppPeriod } from "@/server/sppPeriod";
import { categoryLabel, nextJakartaMonth, type SppPeriodPreview } from "@/lib/sppPeriod";
import { formatRupiah } from "@/hooks/useKeuangan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "sonner";

const actionLabels = { ubah_tagihan: "Sesuaikan tagihan", jadwalkan: "Kategori untuk tagihan baru", terkunci: "Terkunci", sudah_sesuai: "Sudah sesuai" };
function monthLabel(value: string) {
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(value.slice(0, 7) + "-01T00:00:00Z"));
}

export default function SppCategoryPeriod({ departemenId }: { departemenId?: string }) {
  const { role } = useAuth();
  const qc = useQueryClient();
  const minMonth = nextJakartaMonth();
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [siswaId, setSiswaId] = useState("");
  const [jenisId, setJenisId] = useState("");
  const [mulai, setMulai] = useState(minMonth);
  const [selesai, setSelesai] = useState(minMonth);
  const [kategori, setKategori] = useState<"asrama" | "non_asrama">("non_asrama");
  const [alasan, setAlasan] = useState("");
  const [preview, setPreview] = useState<SppPeriodPreview | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const allowed = role === "admin" || role === "keuangan";

  useEffect(() => { const timer = setTimeout(() => setSearchQuery(search), 350); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { setSiswaId(""); setJenisId(""); setSearch(""); setSearchQuery(""); }, [departemenId]);
  useEffect(() => { setPreview(null); setConfirmOpen(false); }, [siswaId, jenisId, mulai, selesai, kategori, searchQuery]);
  const options = useQuery({
    queryKey: ["spp_period_options", searchQuery, departemenId],
    queryFn: () => getSppPeriodOptions({ data: { search: searchQuery, departemen_id: departemenId || undefined } }),
    enabled: allowed && searchQuery.trim().length >= 2,
  });
  const selected = options.data?.siswa.find((s) => s.id === siswaId);
  const jenisList = options.data?.jenis.filter((j) => j.departemen_id === selected?.departemen_id) || [];
  const history = useQuery({
    queryKey: ["spp_period_history", siswaId],
    queryFn: () => getSppPeriodHistory({ data: { siswa_id: siswaId } }),
    enabled: allowed && !!siswaId,
  });
  const input = { siswa_id: siswaId, jenis_id: jenisId, mulai, selesai, kategori };
  const mutation = useMutation({
    mutationFn: (apply: boolean) => previewOrApplySppPeriod({
      data: { ...input, apply, preview_hash: apply ? preview?.preview_hash : undefined, alasan: apply ? alasan : undefined },
    }),
    onSuccess: (result) => {
      if (result.applied) {
        toast.success(`${result.bulan_dapat_disesuaikan} bulan disesuaikan; ${result.tagihan_diubah} tagihan diperbarui.`);
        setPreview(null); setAlasan(""); setConfirmOpen(false);
        qc.invalidateQueries({ queryKey: ["spp_period_history", siswaId] });
        qc.invalidateQueries({ queryKey: ["tagihan_terjadwal"] });
        qc.invalidateQueries({ queryKey: ["tagihan"] });
      } else setPreview(result);
    },
    onError: (error: Error) => { setPreview(null); setConfirmOpen(false); toast.error(error.message); },
  });
  if (!allowed) return <p className="text-sm text-muted-foreground">Penyesuaian kategori SPP tersedia untuk admin dan keuangan.</p>;
  const busy = mutation.isPending;

  return <div className="space-y-4">
    <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
      <p className="font-medium">Kategori SPP per bulan layanan</p>
      <p>Pilih Asrama atau Non Asrama untuk rentang bulan mendatang. Kategori disimpan pada setiap tagihan; status siswa dan nominal tidak berubah.</p>
      <p className="text-muted-foreground">Tagihan yang sudah dibayar, memiliki jurnal, pembayaran online aktif, atau berada dalam periode tutup buku akan dikunci.</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor="spp-student-search">Cari siswa aktif SMP / SMA / MTA</Label>
        <Input id="spp-student-search" value={search} disabled={busy} placeholder="Ketik minimal 2 huruf nama atau NIS"
          onChange={(e) => { setSearch(e.target.value); setSiswaId(""); setJenisId(""); setPreview(null); }} />
        {options.isFetching && <p className="text-xs text-muted-foreground">Mencari siswa…</p>}
        {options.error && <p role="alert" className="text-xs text-destructive">{options.error.message}</p>}
        {options.data && !options.data.siswa.length && <p className="text-xs text-muted-foreground">Tidak ada siswa yang sesuai pencarian.</p>}
      </div>
      <div className="space-y-1">
        <Label>Siswa</Label>
        <Select value={siswaId} disabled={busy || !options.data?.siswa.length} onValueChange={(value) => {
          setSiswaId(value);
          const siswa = options.data?.siswa.find((s) => s.id === value);
          const kinds = options.data?.jenis.filter((j) => j.departemen_id === siswa?.departemen_id) || [];
          setJenisId(kinds.length === 1 ? kinds[0].id : "");
        }}>
          <SelectTrigger aria-label="Siswa"><SelectValue placeholder="Pilih hasil pencarian" /></SelectTrigger>
          <SelectContent>{options.data?.siswa.map((s) => <SelectItem key={s.id} value={s.id}>{s.nama} · {s.nis || "Tanpa NIS"} · {s.lembaga}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>Jenis SPP</Label>
        <Select value={jenisId} disabled={busy || !siswaId} onValueChange={setJenisId}>
          <SelectTrigger aria-label="Jenis SPP"><SelectValue placeholder="Pilih jenis SPP" /></SelectTrigger>
          <SelectContent>{jenisList.map((j) => <SelectItem key={j.id} value={j.id}>{j.nama}</SelectItem>)}</SelectContent>
        </Select>
        {siswaId && !jenisList.length && <p className="text-xs text-destructive">Jenis SPP aktif belum tersedia pada lembaga siswa.</p>}
      </div>
      <div className="space-y-1">
        <Label>Kategori layanan</Label>
        <Select value={kategori} disabled={busy} onValueChange={(value) => setKategori(value as "asrama" | "non_asrama")}>
          <SelectTrigger aria-label="Kategori layanan"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="asrama">Asrama</SelectItem><SelectItem value="non_asrama">Non Asrama</SelectItem></SelectContent>
        </Select>
      </div>
      <div className="space-y-1"><Label htmlFor="spp-start-month">Bulan mulai</Label><Input id="spp-start-month" type="month" min={minMonth} disabled={busy} value={mulai} onChange={(e) => setMulai(e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="spp-end-month">Bulan akhir</Label><Input id="spp-end-month" type="month" min={mulai || minMonth} disabled={busy} value={selesai} onChange={(e) => setSelesai(e.target.value)} /></div>
    </div>
    <Button disabled={busy || !siswaId || !jenisId || !mulai || !selesai} variant="outline" onClick={() => mutation.mutate(false)}>
      {busy ? "Memproses…" : "Lihat pratinjau"}
    </Button>
    {preview && <div className="space-y-3 rounded-md border p-3">
      <p className="text-sm font-medium">{preview.bulan_dapat_disesuaikan} bulan dapat disesuaikan ke {categoryLabel(kategori)}.</p>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th className="p-2">Periode</th><th className="p-2">Kategori tersimpan</th><th className="p-2 text-right">Nominal tetap</th><th className="p-2">Tindakan</th></tr></thead>
        <tbody>{preview.rows.map((row) => <tr className="border-b" key={row.periode}>
          <td className="p-2 whitespace-nowrap">{monthLabel(row.periode)}</td>
          <td className="p-2">{categoryLabel(row.kategori_lama)}</td>
          <td className="p-2 text-right whitespace-nowrap">{row.nominal == null ? "Belum ada tagihan" : formatRupiah(Number(row.nominal))}</td>
          <td className="p-2"><p className={row.aksi === "terkunci" ? "text-destructive" : ""}>{actionLabels[row.aksi]}</p>{row.alasan && <p className="text-xs text-muted-foreground">{row.alasan}</p>}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="text-xs text-muted-foreground">Bulan tanpa tagihan menyimpan kategori untuk pembuatan tagihan berikutnya. Tagihan baru tidak dibuat oleh penyesuaian ini.</p>
      {preview.bulan_dapat_disesuaikan > 0 && <>
        <Label htmlFor="spp-change-reason">Alasan perubahan</Label>
        <Textarea id="spp-change-reason" value={alasan} maxLength={1000} disabled={busy} onChange={(e) => setAlasan(e.target.value)} placeholder="Contoh: Pindah non asrama mulai November berdasarkan konfirmasi wali siswa." />
        <Button disabled={busy || alasan.trim().length < 10} onClick={() => setConfirmOpen(true)}>Simpan penyesuaian</Button>
      </>}
    </div>}
    {siswaId && <div className="space-y-2">
      <h3 className="font-medium text-sm">Riwayat penyesuaian</h3>
      {history.error && <p role="alert" className="text-sm text-destructive">{history.error.message}</p>}
      {!history.isLoading && !history.error && !history.data?.length && <p className="text-sm text-muted-foreground">Belum ada penyesuaian kategori per periode.</p>}
      {history.data?.map((item) => <div key={item.id} className="rounded-md border p-3 text-sm">
        <p className="font-medium">{monthLabel(item.mulai)} – {monthLabel(item.selesai)} · {categoryLabel(item.kategori)}</p>
        <p>{item.alasan}</p>
        <p className="text-xs text-muted-foreground">{new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(item.dibuat_at))} WIB</p>
      </div>)}
    </div>}
    <ConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen} title="Simpan kategori SPP per periode?"
      description={`Sesuaikan ${preview?.bulan_dapat_disesuaikan || 0} bulan untuk ${selected?.nama || "siswa"} ke ${categoryLabel(kategori)}. Bulan terkunci dilewati. Nominal dan status siswa tetap.`}
      variant="default" confirmLabel="Simpan penyesuaian" loading={busy} onConfirm={() => mutation.mutate(true)} />
  </div>;
}

