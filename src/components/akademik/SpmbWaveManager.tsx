import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

type Wave = {
  id: string;
  nama: string;
  tanggal_mulai: string;
  tanggal_selesai: string | null;
  gratis_pendaftaran: boolean;
  aktif: boolean;
  urutan: number;
};

function toLocalInput(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function displayDate(value?: string | null): string {
  if (!value) return "Tanpa batas akhir";
  return new Date(value).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }) + " WIB";
}

export function SpmbWaveManager() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const canEdit = role === "admin";
  const [editId, setEditId] = useState<string | null>(null);
  const [nama, setNama] = useState("");
  const [mulai, setMulai] = useState("");
  const [selesai, setSelesai] = useState("");
  const [gratis, setGratis] = useState(false);
  const [aktif, setAktif] = useState(true);
  const [urutan, setUrutan] = useState("1");
  const [saving, setSaving] = useState(false);

  const { data: waves = [], isLoading } = useQuery({
    queryKey: ["spmb_gelombang"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("spmb_gelombang")
        .select("id,nama,tanggal_mulai,tanggal_selesai,gratis_pendaftaran,aktif,urutan")
        .order("urutan")
        .order("tanggal_mulai");
      if (error) throw error;
      return (data || []) as Wave[];
    },
  });

  const activeId = useMemo(() => {
    const now = Date.now();
    return waves.find((wave) =>
      wave.aktif &&
      now >= new Date(wave.tanggal_mulai).getTime() &&
      (!wave.tanggal_selesai || now < new Date(wave.tanggal_selesai).getTime())
    )?.id || null;
  }, [waves]);

  const reset = () => {
    setEditId(null);
    setNama("");
    setMulai("");
    setSelesai("");
    setGratis(false);
    setAktif(true);
    setUrutan(String(Math.max(0, ...waves.map((wave) => wave.urutan || 0)) + 1));
  };

  const edit = (wave: Wave) => {
    setEditId(wave.id);
    setNama(wave.nama);
    setMulai(toLocalInput(wave.tanggal_mulai));
    setSelesai(toLocalInput(wave.tanggal_selesai));
    setGratis(wave.gratis_pendaftaran);
    setAktif(wave.aktif);
    setUrutan(String(wave.urutan));
  };

  const save = async () => {
    if (!canEdit) return;
    if (!nama.trim() || !mulai) {
      toast.error("Nama dan tanggal mulai gelombang wajib diisi");
      return;
    }
    const start = new Date(mulai);
    const end = selesai ? new Date(selesai) : null;
    if (Number.isNaN(start.getTime()) || (end && Number.isNaN(end.getTime()))) {
      toast.error("Tanggal gelombang tidak valid");
      return;
    }
    if (end && end <= start) {
      toast.error("Tanggal selesai harus setelah tanggal mulai");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        nama: nama.trim(),
        tanggal_mulai: start.toISOString(),
        tanggal_selesai: end?.toISOString() || null,
        gratis_pendaftaran: gratis,
        aktif,
        urutan: Math.max(1, Number.parseInt(urutan, 10) || 1),
      };
      const query = editId
        ? (supabase as any).from("spmb_gelombang").update(payload).eq("id", editId)
        : (supabase as any).from("spmb_gelombang").insert(payload);
      const { error } = await query;
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["spmb_gelombang"] });
      toast.success(editId ? "Gelombang SPMB diperbarui" : "Gelombang SPMB ditambahkan");
      reset();
    } catch (error: any) {
      toast.error(error?.message || "Gagal menyimpan gelombang SPMB");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-5 w-5" /> Gelombang SPMB
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Gelombang aktif menentukan apakah /spmb terbuka. Hak gratis/berbayar melekat pada gelombang saat siswa mendaftar.
          </p>
        </div>
        {canEdit && <Button type="button" variant="outline" size="sm" onClick={reset}><Plus className="mr-1 h-4 w-4" />Tambah</Button>}
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          {isLoading ? <p className="text-sm text-muted-foreground">Memuat gelombang...</p> : waves.map((wave) => (
            <div key={wave.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{wave.nama}</span>
                  {activeId === wave.id && <Badge>Aktif sekarang</Badge>}
                  {!wave.aktif && <Badge variant="secondary">Dinonaktifkan</Badge>}
                  <Badge variant={wave.gratis_pendaftaran ? "default" : "outline"}>
                    {wave.gratis_pendaftaran ? "Gratis pendaftaran" : "Biaya normal"}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {displayDate(wave.tanggal_mulai)} — {displayDate(wave.tanggal_selesai)}
                </p>
              </div>
              {canEdit && <Button type="button" variant="ghost" size="sm" onClick={() => edit(wave)}><Pencil className="mr-1 h-4 w-4" />Edit</Button>}
            </div>
          ))}
        </div>

        {canEdit && (editId !== null || nama || mulai || selesai) && (
          <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Nama Gelombang *</Label>
                <Input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="Gelombang 3" />
              </div>
              <div className="space-y-1.5">
                <Label>Urutan</Label>
                <Input type="number" min={1} value={urutan} onChange={(e) => setUrutan(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Mulai (waktu lokal/WIB) *</Label>
                <Input type="datetime-local" value={mulai} onChange={(e) => setMulai(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Selesai (kosong = tanpa batas)</Label>
                <Input type="datetime-local" value={selesai} onChange={(e) => setSelesai(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:gap-8">
              <div className="flex items-center gap-2"><Switch checked={gratis} onCheckedChange={setGratis} /><Label>Gratis biaya pendaftaran</Label></div>
              <div className="flex items-center gap-2"><Switch checked={aktif} onCheckedChange={setAktif} /><Label>Gelombang aktif</Label></div>
            </div>
            <p className="text-xs text-muted-foreground">
              Periode gelombang aktif tidak boleh tumpang tindih. Jangan mengubah gelombang lama untuk memindahkan histori siswa; pendaftar sudah menyimpan gelombang asalnya.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={reset}>Batal</Button>
              <Button type="button" onClick={save} disabled={saving}>{saving ? "Menyimpan..." : "Simpan Gelombang"}</Button>
            </div>
          </div>
        )}

        {canEdit && editId === null && !nama && !mulai && !selesai && (
          <p className="text-xs text-muted-foreground">Klik Tambah untuk membuat Gelombang 3 atau Edit untuk mengubah jadwal yang ada.</p>
        )}
      </CardContent>
    </Card>
  );
}
