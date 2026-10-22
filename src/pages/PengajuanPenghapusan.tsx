import { useState } from "react";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { listDeletionRequests,reviewDeletionRequest } from "@/server/dataDeletion";
import { deletionLabels } from "@/lib/dataDeletion";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardHeader,CardTitle } from "@/components/ui/card";
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import Unauthorized from "@/pages/Unauthorized";

const statuses: Record<string,string> = { pending:"Menunggu admin",approved:"Disetujui",rejected:"Ditolak",changed:"Data berubah",executed:"Dijalankan langsung" };
const actions: Record<string,string> = { delete:"Penghapusan",cancel_bill:"Pembatalan tagihan",correct_bill:"Koreksi nominal",cancel_payment:"Pembatalan pembayaran" };
const fields: Record<string,string> = {
  nama:"Nama",nis:"NIS",nomor:"Nomor",judul:"Judul",keterangan:"Keterangan",tanggal:"Tanggal",
  nominal:"Nominal",nominal_bruto:"Nominal bruto",nominal_diskon:"Potongan",jumlah:"Jumlah",
  status:"Status",bulan:"Bulan",periode_mulai:"Mulai periode",periode_selesai:"Akhir periode",
  total_debit:"Total debit",total_kredit:"Total kredit",aktif:"Aktif",
  kode:"Kode",kode_kd:"Kode KD",deskripsi:"Deskripsi",hari:"Hari",jam_mulai:"Jam mulai",jam_selesai:"Jam selesai",ruangan:"Ruangan",label:"Label",
};
function displayValue(key: string,value: unknown) {
  if (typeof value==="boolean") return value ? "Ya" : "Tidak";
  if (["nominal","nominal_bruto","nominal_diskon","jumlah","total_debit","total_kredit"].includes(key)) {
    return new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(value));
  }
  return String(value);
}
function when(value: string) { return new Date(value).toLocaleString("id-ID",{ timeZone:"Asia/Jakarta" }); }
function Details({ row }: { row: any }) {
  const record=row.snapshot?.record || {};
  const context=row.snapshot?.context || {};
  return <div className="space-y-3 text-sm">
    <p><strong>Jenis tindakan:</strong> {actions[row.action] || row.action} — {deletionLabels[row.target_table] || row.target_table}</p>
    <p><strong>Pengaju:</strong> {row.requester?.email || "Akun tidak tersedia"} ({row.requester?.role || "—"})</p>
    <p><strong>Diajukan:</strong> {when(row.requested_at)}</p>
    <p className="whitespace-pre-wrap break-words"><strong>Alasan:</strong> {row.reason}</p>
    <div className="rounded border p-3 space-y-1">
      <p className="font-medium">Data saat diajukan</p>
      {context.student_name && <p><strong>Siswa:</strong> {context.student_name} {context.student_nis ? "("+context.student_nis+")" : ""}</p>}
      {context.payment_type && <p><strong>Jenis pembayaran:</strong> {context.payment_type}</p>}
      {context.department && <p><strong>Lembaga:</strong> {context.department}</p>}
      {context.class && <p><strong>Kelas:</strong> {context.class}</p>}
      {context.subject && <p><strong>Mata pelajaran:</strong> {context.subject}</p>}
      {context.employee && <p><strong>Pegawai:</strong> {context.employee}</p>}
      {context.financial_year && <p><strong>Tahun buku:</strong> {context.financial_year}</p>}
      {Object.entries(fields).filter(([key])=>record[key]!==undefined && record[key]!==null).map(([key,label])=>
        <p className="break-words" key={key}><span className="text-muted-foreground">{label}: </span>{displayValue(key,record[key])}</p>)}
      {row.action==="correct_bill" && <p><strong>Nominal baru:</strong> {displayValue("nominal",row.payload?.nominal_baru)}</p>}
      {row.payload?.tanggal && <p><strong>Tanggal tindakan:</strong> {row.payload.tanggal}</p>}
    </div>
    {row.review_note && <p className="whitespace-pre-wrap"><strong>Catatan keputusan:</strong> {row.review_note}</p>}
    {row.reviewed_at && <p><strong>Diputuskan:</strong> {when(row.reviewed_at)} oleh {row.reviewer?.email || "Admin"}</p>}
  </div>;
}
export default function PengajuanPenghapusan() {
  const { role }=useAuth();
  if (!role || ["siswa","ortu"].includes(role)) return <Unauthorized />;
  return <DeletionRequestsContent />;
}
function DeletionRequestsContent() {
  const { role }=useAuth();
  const qc=useQueryClient();
  const [status,setStatus]=useState<"pending"|"history">("pending");
  const [page,setPage]=useState(0);
  const [selected,setSelected]=useState<any>(null);
  const [note,setNote]=useState("");
  const query=useQuery({queryKey:["deletion_requests",status,page],queryFn:()=>listDeletionRequests({data:{status,page}})});
  const review=useMutation({
    mutationFn:(approve:boolean)=>reviewDeletionRequest({data:{id:selected.id,approve,note}}),
    onSuccess: async result=>{
      await qc.invalidateQueries();
      if (result.status==="changed") toast.warning("Data sudah berubah. Pengajuan tidak dijalankan; periksa dan ajukan kembali.");
      else toast.success(result.status==="approved" ? "Pengajuan disetujui dan tindakan berhasil dijalankan." : "Pengajuan ditolak. Data tetap tersimpan.");
      setSelected(null);setNote("");
    },
    onError:(error:Error)=>toast.error(error.message),
  });
  return <div className="space-y-4">
    <div><h1 className="text-2xl font-bold">{role==="admin" ? "Persetujuan Penghapusan" : "Pengajuan Penghapusan"}</h1>
      <p className="text-muted-foreground">{role==="admin"
        ? "Periksa alasan dan data sebelum menyetujui. Data yang berubah sejak pengajuan akan ditahan."
        : "Pantau pengajuan Anda. Data tetap tersimpan sampai admin menyetujui."}</p></div>
    <div className="flex gap-2"><Button variant={status==="pending" ? "default" : "outline"} onClick={()=>{setStatus("pending");setPage(0);}}>Menunggu</Button>
      <Button variant={status==="history" ? "default" : "outline"} onClick={()=>{setStatus("history");setPage(0);}}>Riwayat</Button>
      <Button variant="outline" onClick={()=>query.refetch()} disabled={query.isFetching}>Muat ulang</Button></div>
    {query.isLoading && <p>Memuat pengajuan…</p>}
    {query.isError && <div role="alert" className="text-destructive">Gagal memuat pengajuan: {query.error.message}</div>}
    {!query.isLoading && !query.isError && !query.data?.items.length && <Card><CardContent className="py-8 text-center text-muted-foreground">Belum ada pengajuan pada daftar ini.</CardContent></Card>}
    {(query.data?.items || []).map((row:any)=><Card key={row.id}><CardHeader className="pb-2">
      <div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="text-base">
        {deletionLabels[row.target_table] || row.target_table} — {row.snapshot?.context?.student_name || row.snapshot?.record?.nama || row.snapshot?.record?.nomor || row.snapshot?.record?.judul || row.snapshot?.record?.keterangan || actions[row.action]}
      </CardTitle><Badge variant="outline">{statuses[row.status] || row.status}</Badge></div>
    </CardHeader><CardContent className="space-y-2">
      <p className="text-sm text-muted-foreground">{row.requester?.email || "Akun tidak tersedia"} · {when(row.requested_at)}</p>
      <p className="text-sm whitespace-pre-wrap break-words">{row.reason}</p>
      <Button variant="outline" onClick={()=>{setSelected(row);setNote("");}}>{role==="admin" && row.status==="pending" ? "Periksa pengajuan" : "Lihat detail"}</Button>
    </CardContent></Card>)}
    <div className="flex items-center gap-3"><Button variant="outline" disabled={page===0 || query.isFetching} onClick={()=>setPage(value=>value-1)}>Sebelumnya</Button>
      <span className="text-sm">Halaman {page+1}</span>
      <Button variant="outline" disabled={!query.data?.hasMore || query.isFetching} onClick={()=>setPage(value=>value+1)}>Berikutnya</Button></div>
    <Dialog open={!!selected} onOpenChange={open=>{if(!open && !review.isPending)setSelected(null);}}>
      <DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader>
        <DialogTitle>Detail pengajuan</DialogTitle><DialogDescription>Penghapusan hanya dijalankan setelah keputusan admin berhasil disimpan.</DialogDescription>
      </DialogHeader>
      {selected && <Details row={selected}/>}
      {role==="admin" && selected?.status==="pending" && <div className="space-y-2"><Label htmlFor="review-deletion-note">Catatan keputusan</Label>
        <Textarea id="review-deletion-note" value={note} onChange={e=>setNote(e.target.value)} maxLength={2000} placeholder="Minimal 5 karakter" disabled={review.isPending}/></div>}
      <DialogFooter><Button variant="outline" disabled={review.isPending} onClick={()=>setSelected(null)}>Tutup</Button>
        {role==="admin" && selected?.status==="pending" && <>
          <Button variant="outline" disabled={review.isPending || note.trim().length<5} onClick={()=>review.mutate(false)}>Tolak</Button>
          <Button variant="destructive" disabled={review.isPending || note.trim().length<5} onClick={()=>review.mutate(true)}>{review.isPending ? "Memproses…" : "Setujui dan jalankan"}</Button>
        </>}
      </DialogFooter></DialogContent>
    </Dialog>
  </div>;
}
