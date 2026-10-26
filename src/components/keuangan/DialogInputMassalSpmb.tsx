import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RupiahInput } from "@/components/shared/RupiahInput";
import { supabase } from "@/integrations/supabase/client";
import { formatRupiah } from "@/hooks/useKeuangan";
import { getSpmbBillingCandidates, type SpmbBillingCandidate } from "@/server/spmbBilling";
import { bulanKalenderTahunAjaran, labelBulanKalender, type PeriodeTanggal } from "@/lib/periodeTagihan";
import {
  bulkError, bulkSppTypes, createBulkDraft, needsBulkAlumni, prepareBulkRow, runBulkBilling,
  type BulkBillingDraft, type BulkPaymentType, type BulkRowResult, type BulkRpc, type PreparedBulkRow,
} from "@/lib/spmbBulkBilling";
import { toast } from "sonner";

const selectClass = "h-10 w-full rounded-md border border-input bg-background px-2 text-sm";
const rpc: BulkRpc = async (name, args) => {
  // Existing, role-checked RPCs own transactions, journals and duplicate guards.
  const result = await supabase.rpc(name as never, args as never);
  return { data: result.data, error: result.error };
};

export function DialogInputMassalSpmb({ siswa, jenis, tahunBuku, onClose, onKeringanan }: {
  siswa: SpmbBillingCandidate[]; jenis: BulkPaymentType[]; tahunBuku: PeriodeTanggal[];
  onClose: () => void; onKeringanan: (siswa: SpmbBillingCandidate) => void;
}) {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState(() => siswa.map(row => createBulkDraft(row, jenis)));
  const [prepared, setPrepared] = useState<PreparedBulkRow[] | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState<Record<string, BulkRowResult>>({});
  const lock = useRef(false);
  const [commonMode, setCommonMode] = useState<BulkBillingDraft["sppMode"]>("awal");
  const [commonJenis, setCommonJenis] = useState("");
  const [commonNominal, setCommonNominal] = useState("");
  const [commonMonth, setCommonMonth] = useState("");
  const [commonPangkal, setCommonPangkal] = useState(false);
  const hasResults = Object.keys(results).length > 0;
  const locked = busy || hasResults;
  const failedRows = Object.values(results).filter(row => row.spp?.status === "failed" || row.pangkal?.status === "failed");
  const actions = Object.values(results).flatMap(row => [row.spp, row.pangkal].filter(Boolean));
  const commonTypes = jenis.filter(j => drafts.every(draft => bulkSppTypes(draft.siswa, jenis).some(option => option.id === j.id)));
  const valid = !!prepared?.length && prepared.every(row => !row.error);

  function invalidateReview() { setPrepared(null); setConfirmed(false); }
  function change(id: string, patch: Partial<BulkBillingDraft>) {
    if (locked) return;
    setDrafts(current => current.map(draft => draft.siswa.id === id ? { ...draft, ...patch } : draft));
    invalidateReview();
  }
  function applyCommon() {
    if (locked) return;
    setDrafts(current => current.map(draft => ({ ...draft, sppMode: commonMode,
      ...(commonJenis ? { jenisId: commonJenis } : {}),
      ...(commonNominal !== "" ? { nominal: commonNominal } : {}),
      ...(commonMonth ? { mulai: `${commonMonth}-01` } : {}), pangkal: commonPangkal,
    })));
    invalidateReview();
  }
  async function review() {
    if (lock.current || hasResults) return;
    lock.current = true; setBusy(true); setConfirmed(false); setPrepared(null);
    try {
      const rows: PreparedBulkRow[] = [];
      for (const draft of drafts) {
        setProgress(`Memeriksa ${rows.length + 1}/${drafts.length}: ${draft.siswa.nama}`);
        rows.push(await prepareBulkRow(draft, jenis, tahunBuku, rpc));
      }
      setPrepared(rows);
    } finally { setBusy(false); lock.current = false; setProgress(""); }
  }
  async function save() {
    if (lock.current || !valid || !confirmed || !prepared || hasResults) return;
    lock.current = true; setBusy(true); setConfirmed(false);
    try {
      setProgress("Memeriksa kembali kesiapan siswa...");
      const fresh = await getSpmbBillingCandidates();
      await runBulkBilling(prepared, fresh.items, rpc, result => {
        setResults(current => ({ ...current, [result.id]: result }));
        setProgress(`Memproses ${drafts.find(draft => draft.siswa.id === result.id)?.siswa.nama || "siswa"}...`);
      });
    } catch (error) { toast.error("Input massal belum selesai", { description: bulkError(error), duration: 10000 }); }
    finally {
      // A failed action must not conceal successful actions from the same row.
      await Promise.allSettled(["spmb_billing_candidates", "tagihan", "tarif_tagihan", "tunggakan", "jurnal", "siswa_diskon", "spmb_pangkal_preview", "spmb_payment_monitor", "tagihan_diskon_target"]
        .map(key => qc.invalidateQueries({ queryKey: [key] })));
      setBusy(false); lock.current = false; setProgress("");
    }
  }
  function retryFailed() {
    setDrafts(current => current.filter(draft => failedRows.some(row => row.id === draft.siswa.id)).map(draft => ({ ...draft,
      sppMode: results[draft.siswa.id].spp?.status === "failed" ? draft.sppMode : "none",
      pangkal: results[draft.siswa.id].pangkal?.status === "failed",
    })));
    setResults({}); invalidateReview();
  }

  return <Dialog open onOpenChange={open => { if (!open && !lock.current) onClose(); }}>
    <DialogContent className="flex max-h-[94vh] w-[96vw] max-w-7xl flex-col overflow-hidden p-4 sm:p-6"
      onInteractOutside={event => { if (busy) event.preventDefault(); }} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle className="pr-6">Input Massal Tagihan Siswa Baru</DialogTitle>
        <DialogDescription>{drafts.length} siswa dipilih. Isi per siswa, periksa ringkasan, kemudian simpan semua.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        <Alert><AlertDescription>
          SPP awal hanya menerbitkan satu bulan dan bisa tanpa kelas. Rencana SPP memerlukan kelas tujuan dan berlanjut sampai Juni akhir jenjang.
          Uang pangkal memakai bruto SK; keringanan alumni diajukan untuk persetujuan yayasan.
          Tagihan atau rencana yang sudah ada dilewati. Hasil setiap tindakan dicatat terpisah.
        </AlertDescription></Alert>
        <fieldset disabled={locked} className="space-y-3 rounded-lg border bg-muted/20 p-3">
          <legend className="px-1 text-sm font-semibold">Isian bersama (opsional)</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1 text-sm">Mode SPP
              <select aria-label="Mode SPP bersama" className={selectClass} value={commonMode} onChange={event => setCommonMode(event.target.value as BulkBillingDraft["sppMode"])}>
                <option value="none">Tanpa SPP</option><option value="awal">SPP awal satu bulan</option><option value="rencana">Rencana sampai akhir jenjang</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">Jenis SPP
              <select aria-label="Jenis SPP bersama" className={selectClass} value={commonJenis} onChange={event => setCommonJenis(event.target.value)}>
                <option value="">Pertahankan pilihan per siswa</option>
                {commonTypes.map(j => <option key={j.id} value={j.id}>{j.nama}</option>)}
              </select>
            </label>
            <div className="space-y-1"><Label htmlFor="bulk-nominal">Nominal SPP bersama</Label>
              <RupiahInput id="bulk-nominal" value={commonNominal} onChange={setCommonNominal} placeholder="Kosong: tetap per siswa" />
            </div>
            <div className="space-y-1"><Label htmlFor="bulk-month">Bulan mulai bersama</Label>
              <Input id="bulk-month" type="month" value={commonMonth} onChange={event => setCommonMonth(event.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={commonPangkal} onCheckedChange={value => setCommonPangkal(value === true)} />Sertakan uang pangkal</label>
            <Button variant="outline" size="sm" onClick={applyCommon}>Terapkan ke semua baris</Button>
          </div>
          <p className="text-xs text-muted-foreground">Pilihan alumni dan fase MTA tetap diperiksa per siswa. Isian di tabel dapat diubah setelah penerapan.</p>
        </fieldset>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[1050px] text-sm">
            <thead className="bg-muted"><tr><th className="sticky left-0 z-10 min-w-[190px] bg-muted p-3 text-left">Siswa</th><th className="min-w-[260px] p-3 text-left">SPP dan bulan mulai</th><th className="min-w-[300px] p-3 text-left">Uang pangkal bruto</th><th className="min-w-[260px] p-3 text-left">Pemeriksaan / hasil</th></tr></thead>
            <tbody>{drafts.map(draft => {
              const student = draft.siswa;
              const row = prepared?.find(item => item.draft.siswa.id === student.id);
              const result = results[student.id];
              const preview = row?.preview;
              const bruto = preview ? preview.verifikasi ? Number(preview.verifikasi.nominal_bruto)
                : draft.bruto === "" ? Number(preview.bruto_acuan) : Number(draft.bruto) : null;
              const calendar = bulanKalenderTahunAjaran(student.tahun_ajaran_id && student.tahun_ajaran_mulai && student.tahun_ajaran_selesai
                ? { id: student.tahun_ajaran_id, tanggal_mulai: student.tahun_ajaran_mulai, tanggal_selesai: student.tahun_ajaran_selesai } : null);
              return <tr key={student.id} className="border-t align-top">
                <td className="sticky left-0 z-10 bg-background p-3">
                  <p className="font-semibold">{student.nama}</p><p className="text-xs text-muted-foreground">NIS {student.nis || "—"}</p>
                  <p className="mt-1 text-xs">{student.target_departemen_kode} · {student.tahun_ajaran_nama}</p>
                  <p className="text-xs">{student.status_asrama === "asrama" ? "Asrama" : student.status_asrama === "non_asrama" ? "Non Asrama" : "Asrama belum ditentukan"} · {student.spmb_internal ? "Internal" : "Eksternal"}</p>
                  <p className="text-xs text-muted-foreground">{student.kelas_nama || "Belum ada kelas tujuan"}</p>
                  <Button className="mt-3" size="sm" variant="outline" disabled={busy} onClick={() => { invalidateReview(); onKeringanan(student); }}>Input Keringanan</Button>
                  <p className="mt-1 text-xs text-muted-foreground">Pengajuan terpisah; menunggu persetujuan yayasan.</p>
                </td>
                <td className="space-y-2 p-3">
                  <select aria-label={`Mode SPP ${student.nama}`} className={selectClass} disabled={locked} value={draft.sppMode} onChange={event => change(student.id, { sppMode: event.target.value as BulkBillingDraft["sppMode"] })}>
                    <option value="none">Tanpa SPP</option><option value="awal">SPP awal satu bulan</option>
                    <option value="rencana" disabled={!student.ready_for_spp || !student.kelas_id}>Rencana sampai akhir jenjang</option>
                  </select>
                  {draft.sppMode !== "none" && <>
                    <select aria-label={`Jenis SPP ${student.nama}`} className={selectClass} disabled={locked} value={draft.jenisId} onChange={event => {
                      const j = jenis.find(option => option.id === event.target.value);
                      change(student.id, { jenisId: event.target.value, nominal: j?.nominal ? String(j.nominal) : draft.nominal });
                    }}><option value="">Pilih jenis SPP</option>{bulkSppTypes(student, jenis).map(j => <option key={j.id} value={j.id}>{j.nama}</option>)}</select>
                    <Label className="sr-only" htmlFor={`bulk-spp-${student.id}`}>Nominal SPP {student.nama}</Label>
                    <RupiahInput id={`bulk-spp-${student.id}`} value={draft.nominal} disabled={locked} onChange={value => change(student.id, { nominal: value })} />
                    <select aria-label={`Bulan mulai ${student.nama}`} className={selectClass} disabled={locked} value={draft.mulai} onChange={event => change(student.id, { mulai: event.target.value })}>
                      <option value="">Pilih bulan</option>{calendar.map(month => <option key={month.tanggal} value={month.tanggal}>{labelBulanKalender(month)}</option>)}
                    </select>
                    {student.rencana_spp && draft.sppMode === "rencana" && <p className="text-xs text-muted-foreground">Rencana sudah ada, akan dilewati.</p>}
                    {student.spp_awal?.tagihan.some(bill => bill.periode === draft.mulai) && draft.sppMode === "awal" && <p className="text-xs text-muted-foreground">SPP bulan ini sudah ada, akan dilewati.</p>}
                  </>}
                </td>
                <td className="space-y-2 p-3">
                  <label className="flex items-center gap-2"><Checkbox disabled={locked} checked={draft.pangkal} onCheckedChange={value => change(student.id, { pangkal: value === true })} />Uang pangkal {student.nama}</label>
                  {draft.pangkal && <>
                    {student.target_departemen_kode === "MTA" && <select aria-label={`Fase MTA ${student.nama}`} disabled={locked} className={selectClass} value={draft.fase} onChange={event => change(student.id, { fase: event.target.value as BulkBillingDraft["fase"], alumni: event.target.value === "sma" ? "" : "none", bruto: "" })}>
                      <option value="">Pilih fase MTA</option><option value="smp">MTA 1–3 · setara SMP</option><option value="sma">MTA 4–6 · setara SMA</option>
                    </select>}
                    {needsBulkAlumni(draft) && <select aria-label={`Status alumni ${student.nama}`} disabled={locked} className={selectClass} value={draft.alumni} onChange={event => change(student.id, { alumni: event.target.value as BulkBillingDraft["alumni"], bruto: "" })}>
                      <option value="">Periksa status alumni</option><option value="none">Bukan alumni SMPITA/MTA setara SMP</option><option value="asrama">Alumni · sebelumnya asrama</option><option value="non_asrama">Alumni · sebelumnya nonasrama</option>
                    </select>}
                    <Label className="sr-only" htmlFor={`bulk-pangkal-${student.id}`}>Bruto uang pangkal {student.nama}</Label>
                    <RupiahInput id={`bulk-pangkal-${student.id}`} disabled={locked} value={draft.bruto} placeholder="Kosong: bruto sesuai SK" onChange={value => change(student.id, { bruto: value })} />
                    <Input aria-label={`Catatan uang pangkal ${student.nama}`} disabled={locked} value={draft.catatan} placeholder="Alasan jika bruto berbeda dari SK" onChange={event => change(student.id, { catatan: event.target.value })} />
                    <p className="text-xs text-muted-foreground">Potongan dicatat melalui keringanan, bruto tetap utuh.</p>
                    {preview && <div className="rounded border bg-muted/30 p-2 text-xs">
                      <p>Acuan SK: {formatRupiah(Number(preview.bruto_acuan))}</p><p>Bruto: {formatRupiah(bruto || 0)}</p>
                      <p>Pengajuan alumni: {formatRupiah(Number(preview.verifikasi?.keringanan_diajukan ?? preview.keringanan_alumni))}</p>
                      <p>Neto setelah persetujuan: {formatRupiah(Math.max((bruto || 0) - Number(preview.verifikasi?.keringanan_diajukan ?? preview.keringanan_alumni), 0))}</p>
                      {preview.tagihan && <p className="mt-1">Tagihan sudah ada ({preview.tagihan.status}); diperiksa oleh sistem tanpa duplikasi.</p>}
                      {preview.verifikasi && <p>Sudah diverifikasi; akan dilewati.</p>}
                    </div>}
                  </>}
                </td>
                <td className="space-y-2 p-3" aria-live="polite">
                  {row?.error && <p role="alert" className="text-destructive">{row.error}</p>}
                  {!result && !row?.error && (prepared ? <div className="space-y-1"><p className="font-medium text-emerald-700">Siap disimpan</p>
                    {draft.sppMode !== "none" && <p>{draft.sppMode === "awal" ? "SPP satu bulan" : "SPP mulai bulan pilihan sampai Juni akhir jenjang"}: {formatRupiah(Number(draft.nominal))}/bulan</p>}
                    {draft.pangkal && <p>Uang pangkal bruto: {formatRupiah(bruto || 0)}</p>}
                  </div> : <p className="text-muted-foreground">Belum diperiksa</p>)}
                  {result && ([['SPP', result.spp], ['Uang pangkal', result.pangkal]] as const).map(([label, action]) => action && <div key={label} className={action.status === "failed" ? "text-destructive" : "text-foreground"}>
                    <p className="font-medium">{label}: {action.status === "saved" ? "Berhasil" : action.status === "skipped" ? "Dilewati" : "Gagal"}</p><p className="text-xs">{action.message}</p>
                  </div>)}
                </td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        {prepared && !valid && <p role="alert" className="text-sm text-destructive">Perbaiki baris yang ditandai, lalu periksa ringkasan kembali. Belum ada tagihan disimpan pada tahap pemeriksaan.</p>}
        {valid && !hasResults && <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
          <Checkbox disabled={busy} checked={confirmed} onCheckedChange={value => setConfirmed(value === true)} />
          Saya sudah memeriksa siswa, jenis SPP, bulan mulai, nominal bruto, status alumni, dan pengajuan keringanan pada seluruh baris.
        </label>}
        {busy && <p role="status" className="text-sm">{progress} Biarkan jendela ini terbuka sampai proses selesai.</p>}
        {hasResults && !busy && <p role="status" className="rounded-md border p-3 text-sm">
          Proses selesai: {actions.filter(action => action?.status === "saved").length} tindakan berhasil, {actions.filter(action => action?.status === "skipped").length} dilewati, {actions.filter(action => action?.status === "failed").length} gagal.
          {failedRows.length > 0 && " Hasil yang berhasil tetap tersimpan. Periksa pesan kegagalan sebelum mencoba ulang."}
        </p>}
      </div>
      <DialogFooter className="flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={onClose}>{hasResults ? "Selesai" : "Batal"}</Button>
        {hasResults ? failedRows.length > 0 && <Button variant="outline" disabled={busy} onClick={retryFailed}>Periksa Ulang yang Gagal</Button>
          : <><Button variant="outline" disabled={busy} onClick={() => void review()}>Periksa Ringkasan</Button>
            <Button disabled={busy || !valid || !confirmed} onClick={() => void save()}>{busy ? "Memproses..." : "Simpan Semua"}</Button></>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
