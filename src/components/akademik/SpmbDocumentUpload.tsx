import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { spmbCreateAdminDocumentUpload, spmbGetDocumentUrl } from "@/server/spmbDocuments";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function SpmbDocumentUpload({ kind, label, value, onChange, onBusy }: {
  kind: string; label: string; value?: string;
  onChange: (path: string) => void; onBusy: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  return <div className="space-y-2">
    <label htmlFor={`spmb-${kind}`} className="text-sm font-medium">{label}</label>
    <Input id={`spmb-${kind}`} type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={busy} onChange={async (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      setBusy(true); onBusy(true);
      try {
        const { path, token } = await spmbCreateAdminDocumentUpload({ data: { kind, fileName: file.name, size: file.size, mime: file.type } });
        const { error } = await supabase.storage.from("pmb-dokumen").uploadToSignedUrl(path, token, file, { contentType: file.type });
        if (error) throw error;
        onChange(path); setFileName(file.name);
        toast.success("Dokumen diunggah. Simpan formulir untuk menerapkan perubahan.");
      } catch (error: any) { toast.error(error.message || "Upload gagal"); }
      finally { setBusy(false); onBusy(false); }
    }} />
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>{busy ? "Mengunggah..." : fileName || (value ? "Dokumen tersedia" : "Belum diunggah")} · Maksimal 10 MB</span>
      {value && <Button type="button" size="sm" variant="outline" onClick={async () => {
        try { const { url } = await spmbGetDocumentUrl({ data: { path: value } }); window.open(url, "_blank", "noopener,noreferrer"); }
        catch (error: any) { toast.error(error.message || "Dokumen gagal dibuka"); }
      }}>Buka</Button>}
    </div>
  </div>;
}
