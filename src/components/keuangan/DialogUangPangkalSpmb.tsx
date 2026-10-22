import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RupiahInput } from "@/components/shared/RupiahInput";
import { supabase } from "@/integrations/supabase/client";
import { formatRupiah } from "@/hooks/useKeuangan";
import type { SpmbBillingCandidate } from "@/server/spmbBilling";
import type { AlumniAsrama, FaseMta, UangPangkalPreview, UangPangkalResult } from "@/lib/spmbUangPangkal";
import { toast } from "sonner";

export function DialogUangPangkalSpmb({ siswa, onClose }: { siswa: SpmbBillingCandidate; onClose: () => void }) {
  const qc = useQueryClient();
  const isMta = siswa.target_departemen_kode === "MTA";
  const [fase, setFase] = useState<FaseMta | "">("");
  const perluPilihanAlumni = siswa.target_departemen_kode === "SMA" || (isMta && fase === "sma");
  const [alumni, setAlumni] = useState<AlumniAsrama | "">(siswa.target_departemen_kode === "SMA" ? "" : "none");
  const [brutoKhusus, setBrutoKhusus] = useState<string | null>(null);
  const [catatan, setCatatan] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const modeAlumni = alumni || "none";
  const { data: preview, isFetching, error, refetch } = useQuery({
    queryKey: ["spmb_pangkal_preview", siswa.id, siswa.tahun_ajaran_id, modeAlumni, fase],
    enabled: Boolean(siswa.tahun_ajaran_id && (!isMta || fase)),
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("preview_uang_pangkal_spmb", {
        p_siswa_id: siswa.id, p_tahun_akademik_id: siswa.tahun_ajaran_id!,
        p_alumni_asrama: modeAlumni, p_fase_mta: isMta ? fase : null,
      });
      if (error) throw new Error(error.message);
      return data as unknown as UangPangkalPreview;
    },
  });
  useEffect(() => { setConfirmed(false); }, [preview?.preview_hash]);

  const bruto = brutoKhusus === null ? Number(preview?.verifikasi?.nominal_bruto ?? preview?.bruto_acuan ?? 0) : Number(brutoKhusus);
  const discount = Number(preview?.verifikasi?.keringanan_diajukan ?? preview?.keringanan_alumni ?? 0);
  const changed = Boolean(preview && bruto !== Number(preview.bruto_acuan));
  const valid = Boolean(preview && !preview.verifikasi && confirmed && !isFetching && !error &&
    (!perluPilihanAlumni || alumni) && Number.isFinite(bruto) && bruto > 0 && bruto >= discount &&
    (!changed || catatan.trim().length >= 10));

  function resetVerification() { setBrutoKhusus(null); setConfirmed(false); }
  async function submit() {
    if (!valid || !preview) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("verifikasi_uang_pangkal_spmb", {
        p_siswa_id: siswa.id, p_tahun_akademik_id: siswa.tahun_ajaran_id!,
        p_alumni_asrama: modeAlumni, p_fase_mta: isMta ? fase : null,
        p_nominal_bruto: bruto, p_catatan: catatan.trim() || null,
        p_preview_hash: preview.preview_hash, p_confirmed: confirmed,
      });
      if (error) throw new Error(error.message);
      const result = data as unknown as UangPangkalResult;
      await Promise.all(["spmb_billing_candidates", "spmb_pangkal_preview", "tagihan", "tarif_tagihan", "tunggakan", "siswa_diskon", "tagihan_diskon_target"].map(key => qc.invalidateQueries({ queryKey: [key] })));
      toast.success(result.skipped ? "Uang pangkal sudah diverifikasi; tidak diterbitkan ulang" : "Uang pangkal bruto berhasil diverifikasi dan diterbitkan", {
        description: result.siswa_diskon_id ? "Pengajuan alumni tercatat di alur keringanan. Potongan berlaku setelah persetujuan sekretaris yayasan." : "Tagihan dapat dibayar tanpa menunggu penempatan kelas.",
      });
      onClose();
    } catch (error) {
      toast.error("Uang pangkal belum diproses", { description: error instanceof Error ? error.message : "Terjadi kesalahan", duration: 10000 });
      setConfirmed(false);
      void refetch();
    } finally { setSaving(false); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
    <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
      <DialogHeader><DialogTitle>Verifikasi Uang Pangkal Otomatis</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="font-semibold">{siswa.nama}</p>
          <p className="text-sm text-muted-foreground">{siswa.target_departemen_kode} · {siswa.tahun_ajaran_nama} · {siswa.status_asrama === "asrama" ? "Asrama" : siswa.status_asrama === "non_asrama" ? "Non Asrama" : "Asrama belum ditentukan"}</p>
        </div>
        <Alert><AlertDescription>Tarif bruto terisi dari SK. Setelah data dan nominal diverifikasi, sistem menerbitkan tagihan. Keringanan alumni diajukan terpisah untuk persetujuan sekretaris yayasan.</AlertDescription></Alert>
        {isMta && <div>
          <Label>Fase masuk MTA *</Label>
          <Select value={fase} onValueChange={(value) => { setFase(value as FaseMta); setAlumni(value === "sma" ? "" : "none"); resetVerification(); }} disabled={saving || Boolean(preview?.verifikasi)}>
            <SelectTrigger aria-label="Fase masuk MTA"><SelectValue placeholder="Pilih fase tujuan" /></SelectTrigger>
            <SelectContent><SelectItem value="smp">MTA 1–3 · setara SMP</SelectItem><SelectItem value="sma">MTA 4–6 · setara SMA</SelectItem></SelectContent>
          </Select>
        </div>}
        {perluPilihanAlumni && <div>
          <Label>Status alumni dan program sebelumnya *</Label>
          <Select value={preview?.verifikasi?.alumni_asrama ?? alumni} onValueChange={(value) => { setAlumni(value as AlumniAsrama); resetVerification(); }} disabled={saving || Boolean(preview?.verifikasi)}>
            <SelectTrigger aria-label="Status alumni"><SelectValue placeholder="Periksa asal siswa" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Bukan alumni {isMta ? "SMPITA/MTA setara SMP" : "SMPITA"} At-Tauhid</SelectItem>
              <SelectItem value="asrama">Alumni {isMta ? "SMPITA/MTA setara SMP" : "SMPITA"} · sebelumnya asrama</SelectItem>
              <SelectItem value="non_asrama">Alumni {isMta ? "SMPITA/MTA setara SMP" : "SMPITA"} · sebelumnya nonasrama</SelectItem>
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">Untuk SMA, keringanan SK ini berlaku bagi alumni SMPITA. Untuk MTA setara SMA, berlaku bagi alumni SMPITA atau MTA setara SMP. Status internal saja belum menentukan nilai potongan.</p>
        </div>}
        {isFetching && <p className="text-sm text-muted-foreground">Menghitung tarif dan memeriksa tagihan...</p>}
        {error && <Alert variant="destructive"><AlertDescription>{error instanceof Error ? error.message : "Pratinjau gagal dimuat"}</AlertDescription></Alert>}
        {preview && <>
          <p className="text-xs text-muted-foreground">Acuan SK {preview.sumber_sk}: {formatRupiah(Number(preview.bruto_acuan))}</p>
          <div>
            <Label htmlFor="pangkal-bruto">Nominal bruto siswa *</Label>
            <RupiahInput id="pangkal-bruto" value={brutoKhusus ?? String(bruto)} onChange={(value) => { setBrutoKhusus(value); setConfirmed(false); }} disabled={saving || Boolean(preview.verifikasi) || discount > 0} />
            <p className="mt-1 text-xs text-muted-foreground">Potongan alumni atau keringanan lainnya dicatat melalui keringanan, bukan mengurangi angka bruto.</p>
          </div>
          <div className="space-y-2 rounded-md border p-3 text-sm">
            <div className="flex justify-between gap-3"><span>Tagihan bruto</span><strong>{formatRupiah(bruto)}</strong></div>
            <div className="flex justify-between gap-3"><span>Keringanan alumni yang diajukan</span><span>{formatRupiah(discount)}</span></div>
            <div className="flex justify-between gap-3 border-t pt-2"><span>Neto setelah keringanan disetujui</span><strong>{formatRupiah(Math.max(bruto - discount, 0))}</strong></div>
            {discount > 0 && <p className="text-xs text-muted-foreground">Sebelum persetujuan, tagihan tetap sebesar bruto.</p>}
          </div>
          {preview.tagihan && <Alert><AlertDescription>Tagihan sudah ada: bruto {formatRupiah(Number(preview.tagihan.nominal_bruto))}, neto saat ini {formatRupiah(Number(preview.tagihan.nominal))}, status {preview.tagihan.status}. Sistem menggunakan tagihan tersebut tanpa menerbitkan ulang. Perbedaan bruto atau pembayaran yang sudah terjadi perlu diperiksa melalui koreksi.</AlertDescription></Alert>}
          {preview.verifikasi ? <Alert><AlertDescription>Uang pangkal sudah diverifikasi. Perubahan berikutnya mengikuti alur koreksi tagihan atau keringanan.</AlertDescription></Alert> : <>
            <div><Label htmlFor="pangkal-catatan">Catatan {changed ? "(wajib untuk bruto khusus, minimal 10 karakter)" : "(opsional)"}</Label>
              <Textarea id="pangkal-catatan" value={catatan} onChange={(event) => { setCatatan(event.target.value); setConfirmed(false); }} disabled={saving} />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} disabled={saving || isFetching || Boolean(error) || (perluPilihanAlumni && !alumni)} />
              Saya sudah memeriksa program, asal alumni, nominal bruto, dan pengajuan keringanan siswa ini.
            </label>
          </>}
        </>}
      </div>
      <DialogFooter><Button variant="outline" disabled={saving} onClick={onClose}>Tutup</Button>
        <Button disabled={!valid || saving} onClick={() => void submit()}>{saving ? "Memproses..." : "Verifikasi & Terbitkan Otomatis"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
