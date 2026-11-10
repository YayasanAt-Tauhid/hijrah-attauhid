import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download, Database, Loader2 } from "lucide-react";
import * as XLSX from "xlsx";
import { getErrorMessage } from "@/lib/errorMessage";

const TABLES = [
  { key: "siswa", label: "Data Siswa" },
  { key: "pegawai", label: "Data Pegawai" },
  { key: "kelas", label: "Kelas" },
  { key: "kelas_siswa", label: "Kelas Siswa" },
  { key: "mata_pelajaran", label: "Mata Pelajaran" },
  { key: "departemen", label: "Departemen" },
  { key: "tahun_ajaran", label: "Tahun Ajaran" },
  { key: "semester", label: "Semester" },
  { key: "pembayaran", label: "Pembayaran" },
  { key: "pengeluaran", label: "Pengeluaran" },
  { key: "penilaian", label: "Penilaian" },
  { key: "presensi_siswa", label: "Presensi Siswa" },
  { key: "presensi_pegawai", label: "Presensi Pegawai" },
  { key: "jadwal", label: "Jadwal" },
  { key: "koleksi_buku", label: "Koleksi Buku" },
  { key: "peminjaman", label: "Peminjaman" },
  { key: "kompetensi_dasar", label: "Kompetensi Dasar" },
  { key: "nilai_kd", label: "Nilai KD" },
  { key: "kkm", label: "KKM" },
  { key: "jurnal", label: "Jurnal" },
  { key: "jurnal_detail", label: "Jurnal Detail" },
  { key: "sekolah", label: "Profil Sekolah" },
] as const;

type TableKey = (typeof TABLES)[number]["key"];

export default function BackupExport() {
  const [selected, setSelected] = useState<Set<string>>(new Set(TABLES.map(t => t.key)));
  const [exporting, setExporting] = useState(false);

  const toggle = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(TABLES.map(t => t.key)));
  const selectNone = () => setSelected(new Set());

  const handleExport = async () => {
    if (selected.size === 0) { toast.error("Pilih minimal 1 tabel"); return; }
    setExporting(true);
    try {
      const wb = XLSX.utils.book_new();
      for (const key of Array.from(selected)) {
        const { data, error } = await (supabase.from(key as any).select("*") as any);
        if (error) { console.warn(`Error fetching ${key}:`, error.message); continue; }
        const ws = XLSX.utils.json_to_sheet(data || []);
        XLSX.utils.book_append_sheet(wb, ws, key.substring(0, 31));
      }
      const dateStr = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `backup_hijrah_attauhid_${dateStr}.xlsx`);
      toast.success(`Berhasil export ${selected.size} tabel`);
    } catch (e: unknown) {
      toast.error("Gagal export: " + getErrorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Backup & Export Data</h1>
        <p className="text-sm text-muted-foreground">Export seluruh data ke file Excel untuk backup</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Pilih Tabel untuk di-Export
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <Button variant="outline" size="sm" onClick={selectAll}>Pilih Semua</Button>
            <Button variant="outline" size="sm" onClick={selectNone}>Hapus Semua</Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {TABLES.map((t) => (
              <div key={t.key} className="flex items-center gap-2">
                <Checkbox id={t.key} checked={selected.has(t.key)} onCheckedChange={() => toggle(t.key)} />
                <Label htmlFor={t.key} className="text-sm cursor-pointer">{t.label}</Label>
              </div>
            ))}
          </div>
          <div className="pt-4 border-t flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{selected.size} dari {TABLES.length} tabel dipilih</p>
            <Button onClick={handleExport} disabled={exporting || selected.size === 0}>
              {exporting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Mengexport...</> : <><Download className="h-4 w-4 mr-2" />Export ke Excel</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Export Data Keuangan
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ExportKeuanganButton label="Export Kode Akun (.xlsx)" onClick={async () => {
              const { data } = await supabase.from("akun_rekening").select("*").order("kode");
              const rows = (data || []).map((a: any) => ({
                kode_akun: a.kode, nama_akun: a.nama, tipe_akun: a.jenis,
                pos_isak35: a.pos_isak35 || "", saldo_normal: a.saldo_normal === "D" ? "debit" : "kredit",
                urutan: a.urutan_isak35 || "", kode_isak35: a.kode_isak35 || "",
              }));
              const ws = XLSX.utils.json_to_sheet(rows);
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, "Kode Akun");
              XLSX.writeFile(wb, `kode_akun_${new Date().toISOString().slice(0, 10)}.xlsx`);
              toast.success("Export kode akun berhasil");
            }} />
            <ExportKeuanganButton label="Export Jurnal Lengkap (.xlsx)" onClick={async () => {
              const { data: jurnals } = await supabase.from("jurnal").select("id, nomor, tanggal, keterangan, referensi, status");
              const { data: details } = await supabase.from("jurnal_detail").select("jurnal_id, akun_id, debit, kredit, keterangan, akun_rekening(kode, nama)");
              const rows = (details || []).map((d: any) => {
                const j = (jurnals || []).find((j: any) => j.id === d.jurnal_id);
                return {
                  nomor_jurnal: j?.nomor || "", tanggal: j?.tanggal || "", keterangan_jurnal: j?.keterangan || "",
                  kode_akun: d.akun_rekening?.kode || "", nama_akun: d.akun_rekening?.nama || "",
                  debit: d.debit || 0, kredit: d.kredit || 0, referensi: j?.referensi || "",
                };
              });
              const ws = XLSX.utils.json_to_sheet(rows);
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, "Jurnal");
              XLSX.writeFile(wb, `jurnal_${new Date().toISOString().slice(0, 10)}.xlsx`);
              toast.success("Export jurnal berhasil");
            }} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <p className="text-sm text-muted-foreground">
            <strong>Catatan:</strong> Export akan mengunduh data dalam format XLSX (Excel). Setiap tabel menjadi 1 sheet.
            Data yang di-export terbatas pada data yang dapat diakses sesuai role pengguna Anda (RLS).
            Untuk backup lengkap database, gunakan Supabase Dashboard.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ExportKeuanganButton({ label, onClick }: { label: string; onClick: () => Promise<void> }) {
  const [loading, setLoading] = useState(false);
  const handle = async () => {
    setLoading(true);
    try { await onClick(); } catch (e: unknown) { toast.error(getErrorMessage(e)); }
    setLoading(false);
  };
  return (
    <Button variant="outline" className="justify-start h-auto py-3" onClick={handle} disabled={loading}>
      {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
      {label}
    </Button>
  );
}
