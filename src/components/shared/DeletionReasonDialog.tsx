import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { deletionLabels, registerDeletionReasonHandler } from "@/lib/dataDeletion";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function DeletionReasonDialog() {
  const { role, user } = useAuth();
  const [table, setTable] = useState<string | null>(null);
  const [reason,setReason] = useState("");
  const resolve = useRef<((reason: string | null) => void) | null>(null);
  const finish = (value: string | null) => { resolve.current?.(value); resolve.current=null; setTable(null); setReason(""); };
  useEffect(() => {
    const unregister = registerDeletionReasonHandler(target => new Promise<string | null>(done => {
      resolve.current?.(null);
      resolve.current=done; setReason(""); setTable(target);
    }));
    return () => { unregister(); resolve.current?.(null); resolve.current=null; setTable(null); };
  }, [user?.id]);
  return <Dialog open={table !== null} onOpenChange={open => { if (!open) finish(null); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>{role==="admin" ? "Alasan penghapusan" : "Ajukan penghapusan"}</DialogTitle>
        <DialogDescription>{deletionLabels[table || ""] || table}. {role==="admin"
          ? "Alasan dan data sebelum perubahan akan disimpan dalam riwayat."
          : "Data tetap tersimpan sampai admin menyetujui. Draf jurnal milik sendiri dapat dihapus langsung."}</DialogDescription></DialogHeader>
      <div className="space-y-2"><Label htmlFor="deletion-reason">Alasan</Label>
        <Textarea id="deletion-reason" value={reason} onChange={e=>setReason(e.target.value)} maxLength={2000} placeholder="Jelaskan mengapa data perlu dihapus (minimal 5 karakter)" autoFocus /></div>
      <DialogFooter><Button variant="outline" onClick={()=>finish(null)}>Batal</Button>
        <Button variant={role==="admin" ? "destructive" : "default"} disabled={reason.trim().length<5} onClick={()=>finish(reason.trim())}>
          {role==="admin" ? "Hapus dan catat alasan" : "Kirim pengajuan"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
