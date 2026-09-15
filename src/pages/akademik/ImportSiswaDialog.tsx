import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllPages } from "@/lib/fetchAll";
import {
  type AngkatanRef, type DepartemenRef, type ExistingStudentForImport, type KelasRef,
  type PreparedImportRow, type SiswaImportRow, type TahunAjaranRef, type TingkatRef,
  normalize, prepareImportRows, rowHasAnyImportValue, templateWorkbook,
} from "@/lib/siswaImport";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, XCircle } from "lucide-react";

interface ImportSiswaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  departemenList: DepartemenRef[];
  tingkatList: TingkatRef[];
  kelasList: KelasRef[];
  tahunAjaranList: TahunAjaranRef[];
  angkatanList: AngkatanRef[];
  onImported: () => void;
}

type UiImportRow = PreparedImportRow & { runStatus: "pending" | "success" | "error"; runMessage?: string };
interface ImportResult { success: number; updated: number; error: number }
const QUERY_CHUNK_SIZE = 150;

function chunks<T>(items: T[], size = QUERY_CHUNK_SIZE): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message || "Gagal menyimpan");
  return "Gagal menyimpan baris";
}
function detailRecord(detail: unknown): Record<string, any> {
  if (Array.isArray(detail)) return (detail[0] as Record<string, any>) || {};
  return (detail as Record<string, any> | null) || {};
}

export function ImportSiswaDialog({
  open, onOpenChange, departemenList, tingkatList, kelasList, tahunAjaranList, angkatanList, onImported,
}: ImportSiswaDialogProps) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<UiImportRow[]>([]);
  const [rawRows, setRawRows] = useState<SiswaImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [exportingCurrent, setExportingCurrent] = useState(false);
  const validationRevisionRef = useRef(0);
  const importGuardRef = useRef(false);

  const busy = importing || validating || exportingCurrent;
  const executableRows = rows.filter((row) => row.errors.length === 0 && row.runStatus !== "success");
  const hasValidationErrors = rows.some((row) => row.errors.length > 0);

  const loadExistingStudents = async (data: SiswaImportRow[]): Promise<ExistingStudentForImport[]> => {
    const ids = [...new Set(data.map((row) => normalize(row.siswa_id)).filter(Boolean))];
    const nisList = [...new Set(data.map((row) => normalize(row.nis)).filter(Boolean))];
    const found = new Map<string, ExistingStudentForImport>();
    for (const idChunk of chunks(ids)) {
      const { data: existing, error } = await supabase.from("siswa").select("id, nis, status, departemen_id").in("id", idChunk);
      if (error) throw error;
      for (const student of existing || []) found.set(student.id, student as ExistingStudentForImport);
    }
    for (const nisChunk of chunks(nisList)) {
      const { data: existing, error } = await supabase.from("siswa").select("id, nis, status, departemen_id").in("nis", nisChunk);
      if (error) throw error;
      for (const student of existing || []) found.set(student.id, student as ExistingStudentForImport);
    }
    return [...found.values()];
  };

  const validateData = async (data: SiswaImportRow[], allowUpdate: boolean) => {
    const revision = ++validationRevisionRef.current;
    setValidating(true); setResult(null);
    try {
      const existing = await loadExistingStudents(data);
      const prepared = prepareImportRows(data, { departemenList, tingkatList, kelasList, tahunAjaranList, angkatanList }, existing, allowUpdate);
      if (revision !== validationRevisionRef.current) return;
      setRows(prepared.map((row) => ({ ...row, runStatus: "pending" as const })));
      setProgress(0);
    } catch (error) {
      if (revision !== validationRevisionRef.current) return;
      setRows([]); toast.error("Gagal memvalidasi file: " + errorMessage(error));
    } finally {
      if (revision === validationRevisionRef.current) setValidating(false);
    }
  };

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || importing) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const workbook = XLSX.read(ev.target?.result, { type: "array", cellDates: false });
        const sheetName = workbook.SheetNames.includes("Template") ? "Template" : workbook.SheetNames[0];
        const parsed = XLSX.utils.sheet_to_json<SiswaImportRow>(workbook.Sheets[sheetName], { defval: "", raw: true }).filter(rowHasAnyImportValue);
        if (!parsed.length) {
          setRawRows([]); setRows([]); setResult(null); toast.error("File tidak berisi baris siswa untuk diimport."); return;
        }
        setRawRows(parsed); void validateData(parsed, updateExisting);
      } catch {
        setRawRows([]); setRows([]); setResult(null); toast.error("Gagal membaca file Excel. Gunakan template import terbaru.");
      }
    };
    reader.readAsArrayBuffer(file); event.target.value = "";
  };

  const handleToggleUpdateExisting = (checked: boolean) => {
    if (busy) return;
    setUpdateExisting(checked);
    if (rawRows.length) void validateData(rawRows, checked);
  };

  const downloadTemplate = () => XLSX.writeFile(templateWorkbook(), "template_import_siswa.xlsx");

  const downloadDataSiswaSaatIni = async () => {
    if (busy) return;
    setExportingCurrent(true);
    try {
      const siswaData = await fetchAllPages<any>((from, to) =>
        supabase.from("siswa").select(`
          id, nis, nama, jenis_kelamin, tempat_lahir, tanggal_lahir, agama, alamat,
          telepon, email, status, departemen_id,
          angkatan:angkatan_id(id, nama), siswa_detail(*),
          kelas_siswa(id, aktif, kelas:kelas_id(id, nama, tingkat:tingkat_id(id, nama), departemen:departemen_id(id, nama)), tahun_ajaran:tahun_ajaran_id(id, nama))
        `).order("nama").order("id").range(from, to)
      );
      const exportRows = siswaData.map((student: any) => {
        const activeClass = (student.kelas_siswa || []).find((item: any) => item.aktif) || student.kelas_siswa?.[0];
        const detail = detailRecord(student.siswa_detail);
        const department = departemenList.find((item) => item.id === student.departemen_id);
        const registrationPeriod = tahunAjaranList.find((item) => item.id === detail.tahun_ajaran_id);
        return {
          siswa_id: student.id, nis: student.nis || "", nama: student.nama || "", jenis_kelamin: student.jenis_kelamin || "",
          tempat_lahir: student.tempat_lahir || "", tanggal_lahir: student.tanggal_lahir || "", agama: student.agama || "", alamat: student.alamat || "",
          telepon: student.telepon || "", email: student.email || "", status: student.status || "",
          departemen: department?.nama || activeClass?.kelas?.departemen?.nama || "", tingkat: activeClass?.kelas?.tingkat?.nama || "",
          kelas: activeClass?.kelas?.nama || "", tahun_ajaran: activeClass?.tahun_ajaran?.nama || "", angkatan: student.angkatan?.nama || "",
          periode_pendaftaran: registrationPeriod?.nama || "", jenis_pendaftaran: detail.jenis_pendaftaran || "", nik: detail.nik || "", no_kk: detail.no_kk || "",
          kategori: detail.kategori || "", status_asrama: detail.status_asrama || "", anak_ke: detail.anak_ke ?? "", jumlah_bersaudara: detail.jumlah_bersaudara ?? "",
          tinggi_badan_cm: detail.tinggi_badan_cm ?? "", berat_badan_kg: detail.berat_badan_kg ?? "", lingkar_kepala_cm: detail.lingkar_kepala_cm ?? "",
          ukuran_baju: detail.ukuran_baju || "", penyakit_pernah_diderita: detail.penyakit_pernah_diderita || "", jarak_rumah_km: detail.jarak_rumah_km ?? "",
          waktu_perjalanan_menit: detail.waktu_perjalanan_menit ?? "", transportasi: detail.transportasi || "",
          nama_ayah: detail.nama_ayah || "", nik_ayah: detail.nik_ayah || "", tempat_lahir_ayah: detail.tempat_lahir_ayah || "", tanggal_lahir_ayah: detail.tanggal_lahir_ayah || "",
          pendidikan_ayah: detail.pendidikan_ayah || "", pekerjaan_ayah: detail.pekerjaan_ayah || "", penghasilan_ayah: detail.penghasilan_ayah ?? "",
          telepon_ayah: detail.telepon_ayah || detail.telepon_ortu || "", alamat_ayah: detail.alamat_ayah || detail.alamat_ortu || "",
          nama_ibu: detail.nama_ibu || "", nik_ibu: detail.nik_ibu || "", tempat_lahir_ibu: detail.tempat_lahir_ibu || "", tanggal_lahir_ibu: detail.tanggal_lahir_ibu || "",
          pendidikan_ibu: detail.pendidikan_ibu || "", pekerjaan_ibu: detail.pekerjaan_ibu || "", penghasilan_ibu: detail.penghasilan_ibu ?? "",
          telepon_ibu: detail.telepon_ibu || "", alamat_ibu: detail.alamat_ibu || "",
          asal_sekolah: detail.asal_sekolah || "", alamat_sekolah_asal: detail.alamat_sekolah_asal || "", kabupaten_sekolah_asal: detail.kabupaten_sekolah_asal || "",
          kecamatan_sekolah_asal: detail.kecamatan_sekolah_asal || "", kelurahan_sekolah_asal: detail.kelurahan_sekolah_asal || "",
          kelas_terakhir: detail.kelas_terakhir || "", alasan_pindah: detail.alasan_pindah || "", kemampuan_iqro: detail.kemampuan_iqro || "",
          membaca_latin: detail.membaca_latin || "", menulis_latin: detail.menulis_latin || "", hafalan_quran: detail.hafalan_quran || "",
        };
      });
      const worksheet = XLSX.utils.json_to_sheet(exportRows);
      const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, worksheet, "Data Siswa");
      XLSX.writeFile(workbook, "data_siswa_untuk_update.xlsx");
      toast.success("Data siswa berhasil diunduh. siswa_id disertakan agar siswa tanpa NIS tetap dapat diperbarui dengan aman.");
    } catch (error) {
      toast.error("Gagal mengunduh data siswa: " + errorMessage(error));
    } finally { setExportingCurrent(false); }
  };

  const updateRow = (index: number, patch: Partial<UiImportRow>) => {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  };

  const handleImport = async () => {
    if (importGuardRef.current || importing || validating || !executableRows.length) return;
    importGuardRef.current = true; setImporting(true); setProgress(0); setResult(null);
    const pending = rows.map((row, index) => ({ row, index })).filter(({ row }) => row.errors.length === 0 && row.runStatus !== "success");
    let inserted = rows.filter((row) => row.runStatus === "success" && row.action === "insert").length;
    let updated = rows.filter((row) => row.runStatus === "success" && row.action === "update").length;
    let failedThisRun = 0;
    const validationFailures = rows.filter((row) => row.errors.length > 0).length;
    try {
      for (let cursor = 0; cursor < pending.length; cursor++) {
        const { row, index } = pending[cursor];
        try {
          const { error } = await (supabase as any).rpc("akademik_save_siswa", {
            p_siswa: row.siswaPayload,
            p_detail: Object.keys(row.detailPayload).length ? row.detailPayload : null,
            p_kelas: row.kelasPayload,
            p_id: row.action === "update" ? row.existingId || null : null,
          });
          if (error) throw error;
          updateRow(index, { runStatus: "success", runMessage: row.action === "update" ? "Berhasil diperbarui" : "Berhasil ditambahkan" });
          if (row.action === "update") updated++; else inserted++;
        } catch (error) {
          failedThisRun++; updateRow(index, { runStatus: "error", runMessage: errorMessage(error) });
        }
        setProgress(Math.round(((cursor + 1) / pending.length) * 100));
      }
      const failed = validationFailures + failedThisRun;
      setResult({ success: inserted, updated, error: failed });
      if (inserted || updated) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["siswa"] }),
          queryClient.invalidateQueries({ queryKey: ["siswa_detail"] }),
          queryClient.invalidateQueries({ queryKey: ["statistik_siswa"] }),
        ]);
        onImported();
      }
      if (!failed) toast.success(`Import selesai: ${inserted} baru, ${updated} diperbarui.`);
      else toast.warning(`Import selesai: ${inserted} baru, ${updated} diperbarui, ${failed} gagal. Unduh laporan untuk rinciannya.`);
    } finally { setImporting(false); importGuardRef.current = false; }
  };

  const downloadReport = () => {
    const report = rows.map((row) => ({
      baris_excel: row.rowNumber, siswa_id: normalize(row.raw.siswa_id), nis: normalize(row.raw.nis), nama: normalize(row.raw.nama),
      aksi: row.action === "update" ? "update" : "baru",
      hasil: row.errors.length ? "gagal_validasi" : row.runStatus === "success" ? "berhasil" : row.runStatus === "error" ? "gagal_simpan" : "belum_diproses",
      alasan: row.errors.length ? row.errors.join("; ") : row.runMessage || "",
    }));
    const worksheet = XLSX.utils.json_to_sheet(report); const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Hasil Import"); XLSX.writeFile(workbook, "laporan_import_siswa.xlsx");
  };

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen && busy) { toast.info("Proses sedang berjalan. Dialog tetap terbuka sampai proses selesai."); return; }
    if (!nextOpen) {
      validationRevisionRef.current++; setRows([]); setRawRows([]); setResult(null); setProgress(0); setUpdateExisting(false);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" onEscapeKeyDown={(event) => busy && event.preventDefault()} onPointerDownOutside={(event) => busy && event.preventDefault()}>
        <DialogHeader><DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" /> Import Data Siswa dari Excel</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>Untuk siswa baru, <span className="font-medium text-foreground">departemen wajib</span>. Kelas harus sesuai lembaga dan tingkat serta diisi bersama tahun ajaran. Untuk update, gunakan file unduhan yang berisi <span className="font-medium text-foreground">siswa_id</span>; siswa tanpa NIS tetap dapat dicocokkan dengan aman.</p>
            <p>Sel kosong saat update mempertahankan nilai lama. Penghapusan nilai, perubahan status siswa existing, dan upload dokumen KK/Akta/Rapor/Ijazah dilakukan melalui Edit Siswa/SPMB/Mutasi. NIK dan No. KK harus 16 digit dan disimpan sebagai teks di Excel.</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={downloadTemplate} disabled={busy}><Download className="mr-2 h-4 w-4" /> Download Template</Button>
            <Button variant="outline" onClick={downloadDataSiswaSaatIni} disabled={busy}>{exportingCurrent ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />} Download Data Siswa (untuk Update)</Button>
            <Label htmlFor="upload-siswa" className={busy ? "cursor-not-allowed opacity-50" : "cursor-pointer"}>
              <Button variant="outline" asChild disabled={busy}><span><Upload className="mr-2 h-4 w-4" /> Upload File Excel</span></Button>
            </Label>
            <input id="upload-siswa" type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUpload} disabled={busy} />
            {!!rows.length && <Button variant="outline" onClick={downloadReport} disabled={importing}><Download className="mr-2 h-4 w-4" /> Download Laporan</Button>}
          </div>

          <div className="flex items-start gap-2 rounded-md border p-3">
            <Checkbox id="update-existing" checked={updateExisting} disabled={busy} onCheckedChange={(checked) => handleToggleUpdateExisting(checked === true)} />
            <Label htmlFor="update-existing" className="text-sm cursor-pointer font-normal leading-5">Izinkan update siswa yang sudah ada. Tanpa opsi ini, NIS/siswa_id yang sudah terdaftar menjadi error—tidak pernah dibuat sebagai duplikat baru.</Label>
          </div>

          {!!rows.length && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                <span>Preview {Math.min(20, rows.length)} dari {rows.length} baris{validating ? " (memvalidasi...)" : ""}</span>
                <span>{rows.filter((row) => !row.errors.length).length} valid · {rows.filter((row) => row.errors.length).length} bermasalah</span>
              </div>
              <div className="border rounded-md overflow-auto max-h-[420px]">
                <Table><TableHeader><TableRow><TableHead>Baris</TableHead><TableHead>ID / NIS</TableHead><TableHead>Nama</TableHead><TableHead>Lembaga / Kelas</TableHead><TableHead>Aksi</TableHead><TableHead>Hasil / Alasan</TableHead></TableRow></TableHeader>
                  <TableBody>{rows.slice(0, 20).map((row) => (
                    <TableRow key={`${row.rowNumber}-${normalize(row.raw.siswa_id)}-${normalize(row.raw.nis)}`} className={row.errors.length || row.runStatus === "error" ? "bg-destructive/10" : ""}>
                      <TableCell>{row.rowNumber}</TableCell>
                      <TableCell className="font-mono text-xs"><div>{normalize(row.raw.siswa_id) || "-"}</div><div className="text-muted-foreground">NIS: {normalize(row.raw.nis) || "-"}</div></TableCell>
                      <TableCell>{normalize(row.raw.nama) || "-"}</TableCell>
                      <TableCell><div>{normalize(row.raw.departemen) || "(dipertahankan)"}</div><div className="text-xs text-muted-foreground">{normalize(row.raw.kelas) || "-"}</div></TableCell>
                      <TableCell>{row.action === "update" ? <Badge variant="secondary">Update</Badge> : <Badge variant="outline">Baru</Badge>}</TableCell>
                      <TableCell className="max-w-[360px]">
                        {row.errors.length ? <span className="text-destructive text-xs">{row.errors.join("; ")}</span>
                          : row.runStatus === "success" ? <span className="inline-flex items-center gap-1 text-xs text-green-700"><CheckCircle2 className="h-4 w-4" /> {row.runMessage}</span>
                          : row.runStatus === "error" ? <span className="inline-flex items-start gap-1 text-xs text-destructive"><XCircle className="h-4 w-4 shrink-0" /> {row.runMessage}</span>
                          : <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><CheckCircle2 className="h-4 w-4" /> Siap diproses</span>}
                      </TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              </div>
              {importing && <Progress value={progress} className="h-2" />}
              {result && <div className="flex flex-wrap gap-3 text-sm">{result.success > 0 && <Badge variant="outline">{result.success} baru berhasil</Badge>}{result.updated > 0 && <Badge variant="secondary">{result.updated} update berhasil</Badge>}{result.error > 0 && <Badge variant="destructive">{result.error} gagal</Badge>}</div>}
              {hasValidationErrors && <p className="text-xs text-destructive">Baris dengan error validasi tidak akan disimpan. Baris valid tetap dapat diproses secara atomik per baris; rincian lengkap tersedia di laporan.</p>}
              {rows.some((row) => row.runStatus === "success") && executableRows.length > 0 && <p className="text-xs text-muted-foreground">Jika proses dijalankan lagi, baris yang sudah berhasil otomatis dilewati.</p>}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={busy}>Tutup</Button>
          <Button onClick={handleImport} disabled={!rows.length || !executableRows.length || importing || validating}>
            {importing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Mengimport...</> : `Simpan ${executableRows.length} Baris Valid`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
