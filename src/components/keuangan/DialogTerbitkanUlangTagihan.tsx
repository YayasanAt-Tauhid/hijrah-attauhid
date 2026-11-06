import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RupiahInput } from "@/components/shared/RupiahInput";
import { supabase } from "@/integrations/supabase/client";
import { formatRupiah } from "@/hooks/useKeuangan";
import type { SpmbBillingCandidate } from "@/server/spmbBilling";
import type { AlumniAsrama, FaseMta } from "@/lib/spmbUangPangkal";
import {
  buildReissueParams, describeReissue, validateReissueInput,
  type CancelledBill, type ReissueKind, type ReissuePreview,
} from "@/lib/reissueCancelledBill";
import { toast } from "sonner";

const KATEGORI: Record<string, string> = { asrama: "Asrama", non_asrama: "Non Asrama" };
const tampil = (value: string) => KATEGORI[value] ?? value;
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
// Pratinjau (terbit_ulang_preview) sengaja tidak di-invalidate: setelah diterapkan, memuat ulangnya akan menolak karena tagihan sudah terjadwal.
const INVALIDATE_KEYS = ["spmb_billing_candidates", "spmb_pangkal_preview", "tagihan", "tagihan_dibatalkan",
  "tarif_tagihan", "tunggakan", "siswa_diskon", "tagihan_diskon_target", "spp_kategori_periode"];

function periodeLabel(periode: string | null) {
  if (!periode) return null;
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "Asia/Jakarta" }).format(new Date(periode + "T00:00:00Z"));
}

type Props = { siswa: SpmbBillingCandidate; bill: CancelledBill; kind: ReissueKind; onClose: () => void };

export function DialogTerbitkanUlangTagihan({ siswa, bill, kind, onClose }: Props) {
  const qc = useQueryClient();
  const isSpp = kind === "spp";
  const isMta = siswa.target_departemen_kode === "MTA";
  const [nominal, setNominal] = useState("");
  const [fase, setFase] = useState<FaseMta | "">("");
  const [alumni, setAlumni] = useState<AlumniAsrama | "">(siswa.target_departemen_kode === "SMA" ? "" : "none");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const needsAlumni = !isSpp && (siswa.target_departemen_kode === "SMA" || (isMta && fase === "sma"));
  const nominalNum = nominal ? Number(nominal) : null;
  const inputsReady = isSpp ? Boolean(nominalNum && nominalNum > 0)
    : (!isMta || Boolean(fase)) && (!needsAlumni || Boolean(alumni));

  const { data: preview, isFetching, error, refetch } = useQuery({
    queryKey: ["terbit_ulang_preview", bill.id, nominalNum, alumni, fase],
    enabled: inputsReady,
    retry: false,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("terbitkan_ulang_tagihan_batal",
        buildReissueParams({ tagihanId: bill.id, kind, nominal: nominalNum, apply: false, alumni, fase }));
      if (error) throw new Error(error.message);
      return data as ReissuePreview;
    },
  });
  useEffect(() => { setConfirmed(false); }, [preview?.preview_hash]);

  const differsFromSk = Boolean(!isSpp && nominalNum !== null && preview && Number(preview.bruto_acuan) !== nominalNum);
  const validation = validateReissueInput({ kind, nominal: nominalNum, reason, differsFromSk, note, needsAlumni, alumni });
  const canSubmit = Boolean(preview && !isFetching && !error && !validation && confirmed && !saving);

  async function submit() {
    if (!canSubmit || !preview) return;
    setSaving(true);
    try {
      const { data, error } = await (supabase as any).rpc("terbitkan_ulang_tagihan_batal", buildReissueParams({
        tagihanId: bill.id, kind, nominal: nominalNum, apply: true, previewHash: preview.preview_hash, reason, alumni, fase, note,
      }));
      if (error) throw new Error(error.message);
      const result = data as ReissuePreview;
      await Promise.all(INVALIDATE_KEYS.map((key) => qc.invalidateQueries({ queryKey: [key] })));
      toast.success(isSpp ? "SPP berhasil diterbitkan ulang" : "Uang pangkal berhasil diterbitkan ulang", {
        description: "Tagihan lama tersimpan di riwayat penerbitan ulang" + (result.riwayat_id ? "." : ""),
      });
      onClose();
    } catch (err) {
      toast.error("Penerbitan ulang belum diproses", { description: err instanceof Error ? err.message : "Terjadi kesalahan", duration: 10000 });
      setConfirmed(false);
      void refetch();
    } finally { setSaving(false); }
  }

  const periode = periodeLabel(bill.periode);
  const rows = preview ? describeReissue(preview, formatRupiah) : [];
  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
    <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Terbitkan ulang {isSpp ? "SPP awal" : "uang pangkal"} — {siswa.nama}</DialogTitle>
        <DialogDescription>
          Tagihan dibatalkan: {bill.nama}{periode ? " · " + periode : ""} · nominal lama {formatRupiah(bill.nominal)}.
          Tagihan lama tidak dihapus; kondisinya disimpan di riwayat.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {isSpp ? <div className="space-y-1">
          <Label htmlFor="terbit-ulang-nominal">Nominal bruto SPP baru</Label>
          <RupiahInput id="terbit-ulang-nominal" value={nominal} onChange={setNominal} placeholder="Nominal SPP sesuai program saat ini" disabled={saving} />
          <p className="text-xs text-muted-foreground">Kategori mengikuti status asrama tujuan siswa saat ini ({tampil(siswa.status_asrama ?? "-")}).</p>
        </div> : <div className="space-y-3">
          {isMta && <div className="space-y-1">
            <Label htmlFor="terbit-ulang-fase">Fase masuk MTA</Label>
            <select id="terbit-ulang-fase" aria-label="Fase MTA" className={selectClass} disabled={saving} value={fase}
              onChange={(e) => { const v = e.target.value as FaseMta | ""; setFase(v); setAlumni(v === "sma" ? "" : "none"); }}>
              <option value="">Pilih fase MTA</option><option value="smp">MTA setara SMP</option><option value="sma">MTA setara SMA</option>
            </select>
          </div>}
          {needsAlumni && <div className="space-y-1">
            <Label htmlFor="terbit-ulang-alumni">Status alumni</Label>
            <select id="terbit-ulang-alumni" aria-label="Status alumni" className={selectClass} disabled={saving} value={alumni}
              onChange={(e) => setAlumni(e.target.value as AlumniAsrama | "")}>
              <option value="">Periksa status alumni</option><option value="none">Bukan alumni SMPITA/MTA setara SMP</option>
              <option value="asrama">Alumni · sebelumnya asrama</option><option value="non_asrama">Alumni · sebelumnya nonasrama</option>
            </select>
          </div>}
          <div className="space-y-1">
            <Label htmlFor="terbit-ulang-nominal">Nominal bruto khusus</Label>
            <RupiahInput id="terbit-ulang-nominal" value={nominal} onChange={setNominal} placeholder="Kosong: bruto sesuai SK" disabled={saving} />
          </div>
          {differsFromSk && <div className="space-y-1">
            <Label htmlFor="terbit-ulang-catatan">Catatan nominal khusus</Label>
            <Textarea id="terbit-ulang-catatan" value={note} onChange={(e) => setNote(e.target.value)} disabled={saving}
              placeholder="Alasan jika bruto berbeda dari SK (minimal 10 karakter)" />
          </div>}
        </div>}

        {isFetching && <p className="text-sm text-muted-foreground">Memuat pratinjau…</p>}
        {error && <Alert variant="destructive"><AlertDescription>{error instanceof Error ? error.message : "Pratinjau gagal dimuat"}</AlertDescription></Alert>}
        {preview && !isFetching && !error && <div className="overflow-hidden rounded-md border text-sm">
          <div className="grid grid-cols-3 bg-muted/50 px-3 py-2 text-xs font-medium"><span>Item</span><span>Sebelum</span><span>Sesudah</span></div>
          {rows.map((row) => <div key={row.label} className="grid grid-cols-3 gap-2 border-t px-3 py-2">
            <span className="text-muted-foreground">{row.label}</span><span>{tampil(row.lama)}</span><span className="font-medium">{tampil(row.baru)}</span>
          </div>)}
        </div>}

        <Alert><AlertDescription>
          Tagihan baru berstatus terjadwal dan belum dijurnal. Jurnal piutang diposting oleh proses pengakuan yang sudah ada saat jatuh tempo.
          Tarif per siswa diperbarui agar sesuai.
        </AlertDescription></Alert>

        <div className="space-y-1">
          <Label htmlFor="terbit-ulang-alasan">Alasan penerbitan ulang</Label>
          <Textarea id="terbit-ulang-alasan" value={reason} onChange={(e) => setReason(e.target.value)} disabled={saving}
            placeholder="Mis. siswa pindah dari asrama ke non asrama (minimal 10 karakter)" />
        </div>
        <div className="flex items-start gap-2">
          <Checkbox id="terbit-ulang-konfirmasi" checked={confirmed} disabled={!preview || isFetching || Boolean(error) || saving}
            onCheckedChange={(value) => setConfirmed(value === true)} />
          <Label htmlFor="terbit-ulang-konfirmasi" className="text-sm font-normal">
            Saya sudah memeriksa perbandingan sebelum dan sesudah, dan nominal serta alasannya benar.
          </Label>
        </div>
        {validation && reason.trim().length > 0 && <p className="text-xs text-destructive">{validation}</p>}
      </div>

      <DialogFooter>
        <Button variant="outline" disabled={saving} onClick={onClose}>Batal</Button>
        <Button disabled={!canSubmit} onClick={() => void submit()}>{saving ? "Memproses..." : "Terbitkan Ulang"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
