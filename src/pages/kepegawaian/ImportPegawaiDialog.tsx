import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, XCircle } from "lucide-react";

type LembagaRef = { id: string; kode?: string | null; nama?: string | null };

interface ImportPegawaiDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lembagaList: LembagaRef[];
  onImported: () => void;
}

type PegawaiImportRow = Record<string, unknown> & {
  pegawai_id?: unknown;
  nip?: unknown;
  nama?: unknown;
  jenis_kelamin?: unknown;
  tempat_lahir?: unknown;
  tanggal_lahir?: unknown;
  agama?: unknown;
  alamat?: unknown;
  telepon?: unknown;
  email?: unknown;
  jabatan?: unknown;
  departemen?: unknown;
  status?: unknown;
  tanggal_masuk?: unknown;
  tanggal_pensiun?: unknown;
  golongan_terakhir?: unknown;
  foto_url?: unknown;
};

type ExistingPegawai = {
  id: string;
  nip: string | null;
  nama: string;
};

type PreparedRow = {
  rowNumber: number;
  raw: PegawaiImportRow;
  action: "insert" | "update";
  existingId?: string;
  payload: Record<string, unknown>;
  errors: string[];
  runStatus: "pending" | "success" | "error";
  runMessage?: string;
};

type ImportResult = { success: number; updated: number; error: number };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function key(value: unknown): string {
  return text(value).toLocaleLowerCase("id-ID").replace(/\s+/g, " ");
}

function nullable(value: unknown): string | null {
  const valueText = text(value);
  return valueText || null;
}

function parseDate(value: unknown): string | null | "invalid" {
  if (value == null || text(value) === "") return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return "invalid";
    return `${parsed.y.toString().padStart(4, "0")}-${parsed.m.toString().padStart(2, "0")}-${parsed.d.toString().padStart(2, "0")}`;
  }

  const raw = text(value);
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const y = Number(iso[1]), m = Number(iso[2]), d = Number(iso[3]);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d) {
      return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
    }
    return "invalid";
  }

  const dmy = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (dmy) {
    const d = Number(dmy[1]), m = Number(dmy[2]), y = Number(dmy[3]);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d) {
      return `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
    }
  }

  return "invalid";
}

function normalizeGender(value: unknown): string | null | "invalid" {
  const v = key(value).replace(/[._]/g, " ");
  if (!v) return null;
  if (["l", "laki-laki", "laki laki", "pria", "ikhwan"].includes(v)) return "L";
  if (["p", "perempuan", "wanita", "akhwat"].includes(v)) return "P";
  return "invalid";
}

function normalizeStatus(value: unknown): string | null | "invalid" {
  const v = key(value);
  if (!v) return null;
  if (["aktif", "active"].includes(v)) return "aktif";
  if (["nonaktif", "non-aktif", "tidak aktif", "inactive"].includes(v)) return "nonaktif";
  return "invalid";
}

function rowHasValue(row: PegawaiImportRow): boolean {
  return Object.values(row).some((value) => text(value) !== "");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || "Gagal menyimpan");
  }
  return "Gagal menyimpan baris";
}

function makeTemplateWorkbook() {
  const columns = [
    "pegawai_id", "nip", "nama", "jenis_kelamin", "tempat_lahir", "tanggal_lahir",
    "agama", "alamat", "telepon", "email", "jabatan", "departemen", "status",
    "tanggal_masuk", "tanggal_pensiun", "golongan_terakhir", "foto_url",
  ];
  const sample = {
    pegawai_id: "",
    nip: "19870001",
    nama: "Ahmad Fulan",
    jenis_kelamin: "L",
    tempat_lahir: "Pangkalpinang",
    tanggal_lahir: "1987-05-12",
    agama: "Islam",
    alamat: "Alamat pegawai",
    telepon: "081234567890",
    email: "ahmad@example.com",
    jabatan: "Guru",
    departemen: "SD",
    status: "aktif",
    tanggal_masuk: "2020-07-01",
    tanggal_pensiun: "",
    golongan_terakhir: "",
    foto_url: "",
  };
  const template = XLSX.utils.json_to_sheet([sample], { header: columns });
  const instructions = XLSX.utils.aoa_to_sheet([
    ["IMPORT DATA PEGAWAI"],
    ["Kunci update aman", "pegawai_id terlebih dahulu, lalu NIP."],
    ["Update data lama", "Centang opsi 'Izinkan update pegawai yang sudah ada' sebelum menjalankan import."],
    ["Kolom kosong saat update", "Tidak menghapus data lama. Isi nilai baru hanya pada kolom yang ingin diubah."],
    ["Pindah ke Yayasan", "Isi kolom departemen dengan 'Yayasan'. Kolom departemen kosong pada update berarti tidak diubah."],
    ["Departemen", "Boleh memakai kode, nama, atau UUID departemen yang tersedia di aplikasi."],
    ["Jenis kelamin", "L / P, atau Laki-laki / Perempuan."],
    ["Status", "aktif / nonaktif."],
    ["Tanggal", "Gunakan format YYYY-MM-DD, misalnya 2026-07-01."],
    ["Catatan", "Nama/email/telepon tidak dipakai sebagai kunci update otomatis untuk menghindari salah taut."],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, instructions, "Petunjuk");
  XLSX.utils.book_append_sheet(workbook, template, "Template");
  return workbook;
}

export function ImportPegawaiDialog({
  open, onOpenChange, lembagaList, onImported,
}: ImportPegawaiDialogProps) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<PreparedRow[]>([]);
  const [rawRows, setRawRows] = useState<PegawaiImportRow[]>([]);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exportingCurrent, setExportingCurrent] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const validationRevisionRef = useRef(0);
  const importGuardRef = useRef(false);

  const busy = validating || importing || exportingCurrent;
  const hasSuccessfulRows = rows.some((row) => row.runStatus === "success");
  const executableRows = rows.filter((row) => row.errors.length === 0 && row.runStatus !== "success");
  const validationErrorRows = rows.filter((row) => row.errors.length > 0);
  const previewRows = validationErrorRows.length
    ? [...validationErrorRows, ...rows.filter((row) => row.errors.length === 0)].slice(0, 20)
    : rows.slice(0, 20);

  const resolveDepartment = (value: unknown): { id?: string | null; error?: string } => {
    const raw = text(value);
    if (!raw) return {};
    const normalized = key(raw);
    if (["yayasan", "lintas lembaga", "pegawai yayasan", "__yayasan"].includes(normalized)) {
      return { id: null };
    }
    const matches = lembagaList.filter((item) =>
      item.id === raw || key(item.kode) === normalized || key(item.nama) === normalized
    );
    if (matches.length === 1) return { id: matches[0].id };
    if (matches.length > 1) return { error: `Departemen "${raw}" ambigu. Gunakan kode atau UUID.` };
    return { error: `Departemen "${raw}" tidak ditemukan.` };
  };

  const loadExistingPegawai = async (): Promise<ExistingPegawai[]> => {
    const { data, error } = await (supabase as any)
      .from("pegawai")
      .select("id,nip,nama")
      .order("nama");
    if (error) throw error;
    return (data || []) as ExistingPegawai[];
  };

  const prepareRows = async (data: PegawaiImportRow[], allowUpdate: boolean): Promise<PreparedRow[]> => {
    const existing = await loadExistingPegawai();
    const byId = new Map(existing.map((item) => [item.id, item]));
    const byNip = new Map(existing.filter((item) => text(item.nip)).map((item) => [key(item.nip), item]));

    const idCounts = new Map<string, number>();
    const nipCounts = new Map<string, number>();
    for (const raw of data) {
      const id = key(raw.pegawai_id);
      const nip = key(raw.nip);
      if (id) idCounts.set(id, (idCounts.get(id) || 0) + 1);
      if (nip) nipCounts.set(nip, (nipCounts.get(nip) || 0) + 1);
    }

    return data.map((raw, index) => {
      const rowNumber = index + 2;
      const errors: string[] = [];
      const employeeId = text(raw.pegawai_id);
      const nip = text(raw.nip);
      const idMatch = employeeId ? byId.get(employeeId) : undefined;
      const nipMatch = nip ? byNip.get(key(nip)) : undefined;

      if (employeeId && !UUID_RE.test(employeeId)) errors.push("pegawai_id harus UUID yang valid.");
      if (employeeId && (idCounts.get(key(employeeId)) || 0) > 1) errors.push("pegawai_id duplikat di dalam file.");
      if (nip && (nipCounts.get(key(nip)) || 0) > 1) errors.push("NIP duplikat di dalam file.");
      if (employeeId && UUID_RE.test(employeeId) && !idMatch) errors.push("pegawai_id tidak ditemukan pada data pegawai.");
      if (idMatch && nipMatch && idMatch.id !== nipMatch.id) {
        errors.push("pegawai_id dan NIP mengarah ke dua pegawai yang berbeda.");
      }

      const existingMatch = idMatch || nipMatch;
      const action: "insert" | "update" = existingMatch ? "update" : "insert";

      if (existingMatch && !allowUpdate) {
        errors.push(`Pegawai sudah ada berdasarkan ${idMatch ? "pegawai_id" : "NIP"}. Centang opsi update untuk memperbarui record lama.`);
      }

      const gender = normalizeGender(raw.jenis_kelamin);
      if (gender === "invalid") errors.push("Jenis kelamin harus L/P atau Laki-laki/Perempuan.");

      const status = normalizeStatus(raw.status);
      if (status === "invalid") errors.push("Status harus aktif atau nonaktif.");

      const birthDate = parseDate(raw.tanggal_lahir);
      const joinDate = parseDate(raw.tanggal_masuk);
      const pensionDate = parseDate(raw.tanggal_pensiun);
      if (birthDate === "invalid") errors.push("Tanggal lahir tidak valid.");
      if (joinDate === "invalid") errors.push("Tanggal masuk tidak valid.");
      if (pensionDate === "invalid") errors.push("Tanggal pensiun tidak valid.");

      const department = resolveDepartment(raw.departemen);
      if (department.error) errors.push(department.error);

      if (action === "insert" && !text(raw.nama)) errors.push("Nama wajib diisi untuk pegawai baru.");
      if (action === "insert" && !text(raw.jabatan)) errors.push("Jabatan wajib diisi untuk pegawai baru.");

      const payload: Record<string, unknown> = {};
      const assign = (column: string, value: unknown, allowBlank = false) => {
        const normalized = text(value);
        if (action === "insert") {
          payload[column] = allowBlank ? normalized : (normalized || null);
        } else if (normalized) {
          payload[column] = normalized;
        }
      };

      assign("nip", raw.nip);
      assign("nama", raw.nama);
      if (gender && gender !== "invalid") payload.jenis_kelamin = gender;
      assign("tempat_lahir", raw.tempat_lahir);
      if (birthDate && birthDate !== "invalid") payload.tanggal_lahir = birthDate;
      assign("agama", raw.agama);
      assign("alamat", raw.alamat);
      assign("telepon", raw.telepon);
      assign("email", raw.email);
      assign("jabatan", raw.jabatan);

      if (action === "insert") {
        payload.departemen_id = Object.prototype.hasOwnProperty.call(department, "id") ? department.id ?? null : null;
        payload.status = status && status !== "invalid" ? status : "aktif";
      } else {
        if (text(raw.departemen) && !department.error) payload.departemen_id = department.id ?? null;
        if (status && status !== "invalid") payload.status = status;
      }

      if (joinDate && joinDate !== "invalid") payload.tanggal_masuk = joinDate;
      if (pensionDate && pensionDate !== "invalid") payload.tanggal_pensiun = pensionDate;
      assign("golongan_terakhir", raw.golongan_terakhir);
      assign("foto_url", raw.foto_url);

      if (action === "update" && Object.keys(payload).length === 0) {
        errors.push("Tidak ada nilai yang dapat diperbarui pada baris ini.");
      }

      return {
        rowNumber,
        raw,
        action,
        existingId: existingMatch?.id,
        payload,
        errors,
        runStatus: "pending",
      };
    });
  };

  const validateData = async (data: PegawaiImportRow[], allowUpdate: boolean) => {
    const revision = ++validationRevisionRef.current;
    setValidating(true);
    setResult(null);
    try {
      const prepared = await prepareRows(data, allowUpdate);
      if (revision !== validationRevisionRef.current) return;
      setRows(prepared);
      setProgress(0);
    } catch (error) {
      if (revision !== validationRevisionRef.current) return;
      setRows([]);
      toast.error("Gagal memvalidasi file: " + errorMessage(error));
    } finally {
      if (revision === validationRevisionRef.current) setValidating(false);
    }
  };

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || importing || hasSuccessfulRows) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const workbook = XLSX.read(ev.target?.result, { type: "array", cellDates: false });
        const sheetName = workbook.SheetNames.includes("Template") ? "Template" : workbook.SheetNames[0];
        const parsed = XLSX.utils
          .sheet_to_json<PegawaiImportRow>(workbook.Sheets[sheetName], { defval: "", raw: true })
          .filter(rowHasValue);
        if (!parsed.length) {
          setRawRows([]);
          setRows([]);
          setResult(null);
          toast.error("File tidak berisi baris pegawai untuk diimport.");
          return;
        }
        setRawRows(parsed);
        void validateData(parsed, updateExisting);
      } catch {
        setRawRows([]);
        setRows([]);
        setResult(null);
        toast.error("Gagal membaca file. Gunakan template import pegawai terbaru.");
      }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = "";
  };

  const handleToggleUpdateExisting = (checked: boolean) => {
    if (busy) return;
    if (hasSuccessfulRows) {
      toast.info("Opsi update dikunci setelah ada baris berhasil agar record yang sudah tersimpan tidak diproses ulang.");
      return;
    }
    setUpdateExisting(checked);
    if (rawRows.length) void validateData(rawRows, checked);
  };

  const downloadTemplate = () => {
    XLSX.writeFile(makeTemplateWorkbook(), "template_import_pegawai.xlsx");
  };

  const downloadCurrentData = async () => {
    if (busy) return;
    setExportingCurrent(true);
    try {
      const { data, error } = await (supabase as any)
        .from("pegawai")
        .select("id,nip,nama,jenis_kelamin,tempat_lahir,tanggal_lahir,agama,alamat,telepon,email,jabatan,departemen_id,status,tanggal_masuk,tanggal_pensiun,golongan_terakhir,foto_url,departemen:departemen_id(kode,nama)")
        .order("nama");
      if (error) throw error;

      const exportRows = (data || []).map((item: any) => ({
        pegawai_id: item.id,
        nip: item.nip || "",
        nama: item.nama || "",
        jenis_kelamin: item.jenis_kelamin || "",
        tempat_lahir: item.tempat_lahir || "",
        tanggal_lahir: item.tanggal_lahir || "",
        agama: item.agama || "",
        alamat: item.alamat || "",
        telepon: item.telepon || "",
        email: item.email || "",
        jabatan: item.jabatan || "",
        departemen: item.departemen?.kode || item.departemen?.nama || "Yayasan",
        status: item.status || "aktif",
        tanggal_masuk: item.tanggal_masuk || "",
        tanggal_pensiun: item.tanggal_pensiun || "",
        golongan_terakhir: item.golongan_terakhir || "",
        foto_url: item.foto_url || "",
      }));

      const worksheet = XLSX.utils.json_to_sheet(exportRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Data Pegawai");
      XLSX.writeFile(workbook, "data_pegawai_untuk_update.xlsx");
      toast.success("Data pegawai berhasil diunduh. pegawai_id disertakan agar update record lama tetap aman.");
    } catch (error) {
      toast.error("Gagal mengunduh data pegawai: " + errorMessage(error));
    } finally {
      setExportingCurrent(false);
    }
  };

  const updateRow = (index: number, patch: Partial<PreparedRow>) => {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  };

  const handleImport = async () => {
    if (importGuardRef.current || importing || validating || !executableRows.length) return;
    importGuardRef.current = true;
    setImporting(true);
    setProgress(0);
    setResult(null);

    const pending = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.errors.length === 0 && row.runStatus !== "success");

    let inserted = rows.filter((row) => row.runStatus === "success" && row.action === "insert").length;
    let updated = rows.filter((row) => row.runStatus === "success" && row.action === "update").length;
    let failedThisRun = 0;
    const validationFailures = rows.filter((row) => row.errors.length > 0).length;

    try {
      for (let cursor = 0; cursor < pending.length; cursor++) {
        const { row, index } = pending[cursor];
        try {
          if (row.action === "update") {
            if (!row.existingId) throw new Error("ID pegawai existing tidak ditemukan.");
            const { error } = await (supabase as any).from("pegawai").update(row.payload).eq("id", row.existingId);
            if (error) throw error;
            updated++;
            updateRow(index, { runStatus: "success", runMessage: "Berhasil diperbarui" });
          } else {
            const { error } = await (supabase as any).from("pegawai").insert(row.payload);
            if (error) throw error;
            inserted++;
            updateRow(index, { runStatus: "success", runMessage: "Berhasil ditambahkan" });
          }
        } catch (error) {
          failedThisRun++;
          updateRow(index, { runStatus: "error", runMessage: errorMessage(error) });
        }
        setProgress(Math.round(((cursor + 1) / pending.length) * 100));
      }

      const failed = validationFailures + failedThisRun;
      setResult({ success: inserted, updated, error: failed });

      if (inserted || updated) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["pegawai_list"] }),
          queryClient.invalidateQueries({ queryKey: ["pegawai_statistik"] }),
          queryClient.invalidateQueries({ queryKey: ["kepegawaian_rekap_pegawai"] }),
          queryClient.invalidateQueries({ queryKey: ["pegawai_for_jadwal"] }),
        ]);
        onImported();
      }

      if (!failed) toast.success(`Import selesai: ${inserted} baru, ${updated} diperbarui.`);
      else toast.warning(`Import selesai: ${inserted} baru, ${updated} diperbarui, ${failed} gagal. Unduh laporan untuk rinciannya.`);
    } finally {
      setImporting(false);
      importGuardRef.current = false;
    }
  };

  const downloadReport = () => {
    const report = rows.map((row) => ({
      baris_excel: row.rowNumber,
      pegawai_id: text(row.raw.pegawai_id),
      nip: text(row.raw.nip),
      nama: text(row.raw.nama),
      aksi: row.action === "update" ? "update" : "baru",
      hasil: row.errors.length
        ? "gagal_validasi"
        : row.runStatus === "success"
          ? "berhasil"
          : row.runStatus === "error"
            ? "gagal_simpan"
            : "belum_diproses",
      alasan: row.errors.length ? row.errors.join("; ") : row.runMessage || "",
    }));
    const worksheet = XLSX.utils.json_to_sheet(report);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Hasil Import");
    XLSX.writeFile(workbook, "laporan_import_pegawai.xlsx");
  };

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen && busy) {
      toast.info("Proses sedang berjalan. Dialog tetap terbuka sampai proses selesai.");
      return;
    }
    if (!nextOpen) {
      validationRevisionRef.current++;
      setRows([]);
      setRawRows([]);
      setResult(null);
      setProgress(0);
      setUpdateExisting(false);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-w-5xl max-h-[90vh] overflow-y-auto"
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
        onPointerDownOutside={(event) => busy && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Import Data Pegawai</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={downloadTemplate} disabled={busy}>
              <Download className="h-4 w-4 mr-2" /> Unduh Template
            </Button>
            <Button variant="outline" onClick={downloadCurrentData} disabled={busy}>
              {exportingCurrent ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-2" />}
              Unduh Data Saat Ini
            </Button>
            <Label className="inline-flex h-10 cursor-pointer items-center rounded-md border px-4 text-sm font-medium hover:bg-accent">
              <Upload className="h-4 w-4 mr-2" />
              Pilih File Excel
              <input
                className="hidden"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleUpload}
                disabled={busy || hasSuccessfulRows}
              />
            </Label>
          </div>

          <div className="flex items-start gap-2 rounded-md border p-3">
            <Checkbox
              id="update-existing-pegawai"
              checked={updateExisting}
              disabled={busy || hasSuccessfulRows}
              onCheckedChange={(checked) => handleToggleUpdateExisting(checked === true)}
            />
            <Label htmlFor="update-existing-pegawai" className="text-sm cursor-pointer font-normal leading-5">
              Izinkan update pegawai yang sudah ada. Opsi ini memperbarui record existing jika cocok berdasarkan pegawai_id atau NIP.
              Relasi akun pengguna, presensi, riwayat jabatan, tabungan, dan data lain tetap terhubung karena record lama diperbarui, bukan dibuat ulang.
            </Label>
          </div>

          <p className="text-xs text-muted-foreground">
            Untuk keamanan, nama, email, dan nomor HP tidak dipakai sebagai kunci update otomatis. Pada mode update, sel kosong tidak menghapus data lama.
            Untuk memindahkan pegawai menjadi pegawai yayasan/lintas lembaga, isi kolom departemen dengan <strong>Yayasan</strong>.
          </p>

          {hasSuccessfulRows && (
            <p className="text-xs text-muted-foreground">
              File dan opsi update dikunci setelah ada baris berhasil. Tutup dialog untuk memulai file baru; baris sukses pada proses ini tidak akan dijalankan ulang.
            </p>
          )}

          {validating && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Memvalidasi file dan mencocokkan data pegawai...
            </div>
          )}

          {!!rows.length && (
            <>
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant="outline">{rows.length} baris</Badge>
                <Badge variant="outline">{rows.filter((row) => row.action === "insert" && !row.errors.length).length} baru</Badge>
                <Badge variant="outline">{rows.filter((row) => row.action === "update" && !row.errors.length).length} update</Badge>
                {rows.some((row) => row.errors.length) && (
                  <Badge variant="destructive">{rows.filter((row) => row.errors.length).length} perlu diperbaiki</Badge>
                )}
              </div>

              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Baris</TableHead>
                      <TableHead>NIP</TableHead>
                      <TableHead>Nama</TableHead>
                      <TableHead>Departemen</TableHead>
                      <TableHead className="w-24">Aksi</TableHead>
                      <TableHead>Validasi / Hasil</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.map((row, index) => (
                      <TableRow key={`${row.rowNumber}-${index}`}>
                        <TableCell>{row.rowNumber}</TableCell>
                        <TableCell>{text(row.raw.nip) || "—"}</TableCell>
                        <TableCell>{text(row.raw.nama) || "—"}</TableCell>
                        <TableCell>{text(row.raw.departemen) || "—"}</TableCell>
                        <TableCell>
                          <Badge variant={row.action === "update" ? "secondary" : "outline"}>
                            {row.action === "update" ? "Update" : "Baru"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.errors.length ? (
                            <div className="flex gap-2 text-destructive">
                              <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                              <span>{row.errors.join(" ")}</span>
                            </div>
                          ) : row.runStatus === "success" ? (
                            <div className="flex gap-2 text-emerald-600">
                              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                              <span>{row.runMessage}</span>
                            </div>
                          ) : row.runStatus === "error" ? (
                            <div className="flex gap-2 text-destructive">
                              <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                              <span>{row.runMessage}</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">Siap diproses</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {rows.length > previewRows.length && (
                <p className="text-xs text-muted-foreground">
                  Menampilkan {previewRows.length} dari {rows.length} baris. Baris bermasalah diprioritaskan di preview.
                </p>
              )}
            </>
          )}

          {importing && (
            <div className="space-y-2">
              <Progress value={progress} />
              <p className="text-xs text-muted-foreground">Memproses import... {progress}%</p>
            </div>
          )}

          {result && (
            <div className="rounded-md border p-3 text-sm">
              Import terakhir: <strong>{result.success}</strong> baru, <strong>{result.updated}</strong> diperbarui, dan <strong>{result.error}</strong> gagal.
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {!!rows.length && (
            <Button variant="outline" onClick={downloadReport} disabled={busy}>
              <Download className="h-4 w-4 mr-2" /> Unduh Laporan
            </Button>
          )}
          <Button variant="outline" onClick={() => handleClose(false)} disabled={busy}>Tutup</Button>
          <Button onClick={handleImport} disabled={busy || executableRows.length === 0}>
            {importing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
            {rows.some((row) => row.runStatus === "error") ? "Coba Lagi Baris Gagal" : "Import Pegawai"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
