import { useState, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { SiswaCombobox, SiswaRingkas } from "@/components/shared/SiswaCombobox";
import { RupiahInput } from "@/components/shared/RupiahInput";
import { Trash2, Info, Download, Upload, AlertCircle, X, Users } from "lucide-react";
import { formatRupiah, useAllJenisPembayaran, useTahunBuku, useLembaga, namaBulan } from "@/hooks/useKeuangan";
import { useKelas, useTahunAjaran } from "@/hooks/useAkademikData";
import { useAllTarifTagihan, useCreateTarifTagihanBulk } from "@/hooks/useTarifTagihan";
import { useSimpanTarifGenerateAtomik } from "@/hooks/useTarifGenerateAtomik";
import { supabase } from "@/integrations/supabase/client";
import {
  BULAN_ORDER_AKADEMIK,
  bulanKalenderTahunAjaran,
  kelompokkanBulanKeTahunBuku,
  labelBulanKalender,
  targetTahunBukuTarif,
} from "@/lib/periodeTagihan";
import { toast } from "sonner";

interface RowSiswa {
  siswa: SiswaRingkas;
  nominal: string;
  keterangan: string;
}

interface TarifMassalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MAX_ROWS = 500;

export default function TarifMassalDialog({ open, onOpenChange }: TarifMassalDialogProps) {
  const { data: jenisList } = useAllJenisPembayaran();
  const { data: tahunBukuList } = useTahunBuku();
  const { data: tahunAjaranList } = useTahunAjaran();
  const { data: lembagaList } = useLembaga();
  const { data: tarifList } = useAllTarifTagihan();
  const { data: kelasList } = useKelas();

  const bulkMut = useCreateTarifTagihanBulk();
  const atomicMut = useSimpanTarifGenerateAtomik();

  const [deptId, setDeptId] = useState("");
  const [jenisId, setJenisId] = useState("");
  const [tahunAjaranId, setTahunAjaranId] = useState("");
  const [rows, setRows] = useState<RowSiswa[]>([]);
  const [nominalUmum, setNominalUmum] = useState("");
  const [keteranganUmum, setKeteranganUmum] = useState("");
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [kelasPickId, setKelasPickId] = useState("");
  const [loadingKelas, setLoadingKelas] = useState(false);
  const [autoGenerate, setAutoGenerate] = useState(true);
  const [genBulanList, setGenBulanList] = useState<number[]>([]);
  const [sampaiAkhirJenjang, setSampaiAkhirJenjang] = useState(false);
  const [bulanTerakhir, setBulanTerakhir] = useState(6);

  const jenisListForForm = useMemo(() => {
    if (!jenisList) return [];
    if (!deptId) return jenisList;
    return jenisList.filter((j: any) => !j.departemen_id || j.departemen_id === deptId);
  }, [jenisList, deptId]);

  const selectedJenis = jenisList?.find((j: any) => j.id === jenisId);
  const selectedTahunAjaran = tahunAjaranList?.find((t: any) => t.id === tahunAjaranId) || null;
  const isSekali = selectedJenis?.tipe === "sekali";
  const isSPP = selectedJenis?.tipe === "bulanan" && /^spp([\s-]|$)/i.test(String(selectedJenis?.nama || "").trim());
  const effectiveDeptId = deptId || selectedJenis?.departemen_id || "";
  const jenisDefaultNominal = Number(selectedJenis?.nominal || 0);

  const kalenderAkademik = useMemo(
    () => bulanKalenderTahunAjaran(selectedTahunAjaran as any),
    [selectedTahunAjaran],
  );
  const allMonths = kalenderAkademik.length ? kalenderAkademik.map((x) => x.bulan) : BULAN_ORDER_AKADEMIK;
  const allSelected = allMonths.length > 0 && allMonths.every((b) => genBulanList.includes(b));
  const rencanaMulai = kalenderAkademik.find((b) => genBulanList.includes(b.bulan))?.tanggal || null;
  const setBulanMulaiRencana = (bulan: number) => {
    const index = allMonths.indexOf(bulan);
    setGenBulanList(index >= 0 ? allMonths.slice(index) : []);
  };

  const tarifPeriods = useMemo(
    () => targetTahunBukuTarif({
      tahunAjaran: selectedTahunAjaran as any,
      tahunBukuList: tahunBukuList as any,
      tipeSekali: isSekali,
    }),
    [selectedTahunAjaran, tahunBukuList, isSekali],
  );

  const generatePeriods = useMemo(
    () => kelompokkanBulanKeTahunBuku({
      tahunAjaran: selectedTahunAjaran as any,
      tahunBukuList: tahunBukuList as any,
      bulanList: genBulanList,
    }),
    [selectedTahunAjaran, tahunBukuList, genBulanList],
  );

  const targetTahunBukuIds = tarifPeriods.ids;

  const isDefaultRow = (r: RowSiswa) =>
    jenisDefaultNominal > 0 && Number(r.nominal || 0) === jenisDefaultNominal;

  const defaultRowCount = rows.filter(isDefaultRow).length;
  const overrideRowCount = rows.length - defaultRowCount;

  const toggleBulan = (b: number) => {
    setGenBulanList((prev) => prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]);
  };

  const resetState = () => {
    setDeptId("");
    setJenisId("");
    setTahunAjaranId("");
    setRows([]);
    setNominalUmum("");
    setKeteranganUmum("");
    setImportErrors([]);
    setAutoGenerate(true);
    setGenBulanList([]);
    setSampaiAkhirJenjang(false);
    setBulanTerakhir(6);
    setKelasPickId("");
  };

  const handleClose = (v: boolean) => {
    if (!v) resetState();
    onOpenChange(v);
  };

  const defaultNominal = (siswa?: SiswaRingkas) => {
    if (nominalUmum) return nominalUmum;
    if (siswa && isSPP) {
      const bookId = tahunBukuList?.find((tb: any) =>
        selectedTahunAjaran && tb.tanggal_mulai <= selectedTahunAjaran.tanggal_mulai &&
        tb.tanggal_selesai >= selectedTahunAjaran.tanggal_mulai)?.id;
      const saved = (tarifList || []).filter((t: any) =>
        t.aktif !== false && t.jenis_id === jenisId && t.siswa_id === siswa.id &&
        !t.kelas_id && !t.angkatan_id &&
        (!t.tahun_ajaran_id || t.tahun_ajaran_id === bookId)
      ).sort((a: any, b: any) => Number(!!b.tahun_ajaran_id) - Number(!!a.tahun_ajaran_id));
      if (saved[0]?.nominal) return String(Math.trunc(Number(saved[0].nominal)));
    }
    return !isSPP && selectedJenis?.nominal
      ? String(Math.trunc(Number(selectedJenis.nominal))) : "";
  };

  const addSiswa = (s: SiswaRingkas | null) => {
    if (!s) return;
    if (rows.some((r) => r.siswa.id === s.id)) {
      toast.info(`${s.nama} sudah ada di daftar.`);
      return;
    }
    if (rows.length >= MAX_ROWS) {
      toast.error(`Maksimal ${MAX_ROWS} siswa per batch.`);
      return;
    }
    setRows((prev) => [...prev, { siswa: s, nominal: defaultNominal(s), keterangan: keteranganUmum }]);
  };

  const updateRow = (id: string, patch: Partial<Pick<RowSiswa, "nominal" | "keterangan">>) => {
    setRows((prev) => prev.map((r) => (r.siswa.id === id ? { ...r, ...patch } : r)));
  };

  const removeRow = (id: string) => setRows((prev) => prev.filter((r) => r.siswa.id !== id));

  const applyNominalToAll = () => {
    if (!nominalUmum) return;
    setRows((prev) => prev.map((r) => ({ ...r, nominal: nominalUmum })));
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      { nis: "1234567890", nominal: 1250000, keterangan: "Penetapan tarif dasar khusus program" },
      { nis: "0987654321", nominal: 1200000, keterangan: "" },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tarif");
    XLSX.writeFile(wb, "template_override_tarif_massal.xlsx");
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();

    reader.onload = async (ev) => {
      setImporting(true);
      setImportErrors([]);
      try {
        const wb = XLSX.read(ev.target?.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json<{ nis?: unknown; nominal?: unknown; keterangan?: unknown }>(ws, { defval: "" });
        const errors: string[] = [];
        const parsed = data
          .map((r, i) => ({
            baris: i + 2,
            nis: String(r.nis ?? "").trim(),
            nominal: String(r.nominal ?? "").replace(/\D/g, ""),
            keterangan: String(r.keterangan ?? "").trim(),
          }))
          .filter((r) => {
            if (!r.nis) {
              if (r.nominal || r.keterangan) errors.push(`Baris ${r.baris}: kolom nis kosong — dilewati`);
              return false;
            }
            return true;
          });

        if (parsed.length === 0) {
          setImportErrors(errors.length ? errors : ["File tidak berisi data — gunakan kolom: nis, nominal, keterangan"]);
          return;
        }
        if (parsed.length > MAX_ROWS) {
          setImportErrors([`File berisi ${parsed.length} baris — maksimal ${MAX_ROWS} per batch.`]);
          return;
        }

        const nisList = [...new Set(parsed.map((r) => r.nis))];
        const { data: siswaData, error } = await supabase
          .from("siswa")
          .select("id, nama, nis, departemen_id")
          .in("nis", nisList)
          .eq("status", "aktif");
        if (error) throw error;

        const byNis = new Map((siswaData || []).map((s: any) => [String(s.nis), s as SiswaRingkas]));
        const newRows: RowSiswa[] = [];
        const seen = new Set(rows.map((r) => r.siswa.id));

        for (const r of parsed) {
          const s = byNis.get(r.nis);
          if (!s) {
            errors.push(`Baris ${r.baris}: NIS "${r.nis}" tidak ditemukan / siswa tidak aktif`);
            continue;
          }
          if (seen.has(s.id)) {
            errors.push(`Baris ${r.baris}: ${s.nama} (${r.nis}) duplikat — dilewati`);
            continue;
          }
          seen.add(s.id);
          newRows.push({ siswa: s, nominal: r.nominal || defaultNominal(s), keterangan: r.keterangan || keteranganUmum });
        }

        setRows((prev) => [...prev, ...newRows]);
        setImportErrors(errors);
        if (newRows.length > 0) toast.success(`${newRows.length} siswa berhasil diimport dari Excel.`);
      } catch {
        setImportErrors(["Gagal membaca file Excel. Pastikan format sesuai template (kolom: nis, nominal, keterangan)."]);
      } finally {
        setImporting(false);
      }
    };

    reader.readAsBinaryString(file);
    e.target.value = "";
  };

  const addFromKelas = async () => {
    if (!kelasPickId) return;
    setLoadingKelas(true);
    try {
      let q = supabase
        .from("kelas_siswa")
        .select("siswa:siswa_id(id, nama, nis, departemen_id)")
        .eq("kelas_id", kelasPickId)
        .eq("aktif", true);
      if (tahunAjaranId) q = q.eq("tahun_ajaran_id", tahunAjaranId);

      const { data, error } = await q;
      if (error) throw error;

      const siswaList = (data || [])
        .map((ks: any) => ks.siswa as SiswaRingkas | null)
        .filter((s): s is SiswaRingkas => !!s);

      if (siswaList.length === 0) {
        toast.info("Tidak ada siswa aktif di kelas ini untuk Tahun Ajaran yang dipilih.");
        return;
      }

      const seen = new Set(rows.map((r) => r.siswa.id));
      const newRows: RowSiswa[] = [];
      let skipped = 0;

      for (const s of siswaList) {
        if (seen.has(s.id)) {
          skipped++;
          continue;
        }
        if (rows.length + newRows.length >= MAX_ROWS) break;
        seen.add(s.id);
        newRows.push({ siswa: s, nominal: defaultNominal(s), keterangan: keteranganUmum });
      }

      setRows((prev) => [...prev, ...newRows]);
      if (newRows.length > 0) toast.success(`${newRows.length} siswa dari kelas berhasil ditambahkan.`);
      if (skipped > 0) toast.info(`${skipped} siswa dilewati karena sudah ada di daftar.`);
    } catch (err: any) {
      toast.error(`Gagal memuat siswa kelas: ${err.message}`);
    } finally {
      setLoadingKelas(false);
    }
  };

  const existingPeriodBySiswa = useMemo(() => {
    const map = new Map<string, Set<string>>();
    if (!tarifList || !jenisId) return map;

    for (const t of tarifList as any[]) {
      if (t.aktif === false || t.jenis_id !== jenisId || !t.siswa_id || t.kelas_id || t.angkatan_id || !t.tahun_ajaran_id) continue;
      const set = map.get(t.siswa_id) || new Set<string>();
      set.add(t.tahun_ajaran_id);
      map.set(t.siswa_id, set);
    }
    return map;
  }, [tarifList, jenisId]);

  const rowError = (r: RowSiswa): string | null => {
    if (!r.nominal || Number(r.nominal) <= 0) return "Nominal harus > 0";

    const existing = existingPeriodBySiswa.get(r.siswa.id);
    if (isDefaultRow(r) && existing && targetTahunBukuIds.some((id) => existing.has(id))) {
      return "Masih ada override siswa aktif pada periode ini — nonaktifkan/edit override lama dulu jika ingin kembali ke tarif default";
    }

    if (sampaiAkhirJenjang && autoGenerate && isSPP) {
      const conflicting = (tarifList || []).some((t: any) =>
        t.aktif !== false && t.jenis_id === jenisId && t.siswa_id === r.siswa.id &&
        !t.kelas_id && !t.angkatan_id && targetTahunBukuIds.includes(t.tahun_ajaran_id) &&
        Number(t.nominal) !== Number(r.nominal)
      );
      if (conflicting) return "Nominal berbeda dengan tarif siswa yang tersimpan — edit tarif lama terlebih dahulu";
      if (effectiveDeptId && r.siswa.departemen_id !== effectiveDeptId) return "Lembaga siswa tidak sesuai jenis SPP";
      return null;
    }

    if (!isDefaultRow(r) && existing && targetTahunBukuIds.length > 0 && targetTahunBukuIds.every((id) => existing.has(id))) {
      return "Override tarif untuk Tahun Ajaran ini sudah lengkap";
    }

    return null;
  };

  const rowWarning = (r: RowSiswa): string | null => {
    if (effectiveDeptId && r.siswa.departemen_id && r.siswa.departemen_id !== effectiveDeptId) {
      return "Tercatat di lembaga lain — pastikan ini disengaja (mis. tarif jenjang berikutnya)";
    }

    if (!isDefaultRow(r)) {
      const existing = existingPeriodBySiswa.get(r.siswa.id);
      if (existing && targetTahunBukuIds.some((id) => existing.has(id))) {
        return "Sebagian Tahun Buku sudah memiliki override; hanya periode yang belum ada yang akan ditambahkan";
      }
    }

    return null;
  };

  const errorRowCount = rows.filter((r) => rowError(r)).length;
  const totalNominal = rows.reduce((sum, r) => sum + Number(r.nominal || 0), 0);

  const missingTarifLabel = useMemo(() => {
    const unique = new Map<string, string>();
    for (const item of tarifPeriods.missing) unique.set(String(item.tahun), labelBulanKalender(item));
    return Array.from(unique.values());
  }, [tarifPeriods.missing]);

  const validationErrors = useMemo(() => {
    const errs: string[] = [];
    if (!jenisId) errs.push("Jenis Pembayaran belum dipilih");
    if (!tahunAjaranId) errs.push("Tahun Ajaran belum dipilih");
    if (tahunAjaranId && targetTahunBukuIds.length === 0 && tarifPeriods.missing.length === 0) {
      errs.push("Periode Tahun Ajaran tidak dapat dipetakan ke Tahun Buku");
    }
    if (missingTarifLabel.length > 0) {
      errs.push(`Tahun Buku untuk ${missingTarifLabel.join(", ")} belum tersedia — buat dulu di tab Tahun Buku`);
    }
    if (rows.length === 0) errs.push("Belum ada siswa di daftar — tambah lewat pencarian, kelas, atau import Excel");
    if (errorRowCount > 0) errs.push(`${errorRowCount} baris bermasalah (ditandai merah) — perbaiki atau hapus dulu`);
    if (autoGenerate && jenisId && !isSekali && genBulanList.length === 0) {
      errs.push("Pilih minimal satu bulan untuk generate tagihan");
    }
    if (sampaiAkhirJenjang && (!autoGenerate || !isSPP || !rencanaMulai)) {
      errs.push("Rencana akhir jenjang memerlukan SPP, generate otomatis, dan bulan mulai");
    }
    if (!autoGenerate && rows.length > 0 && overrideRowCount === 0 && jenisDefaultNominal > 0) {
      errs.push("Semua nominal sama dengan tarif default, jadi tidak ada override yang perlu disimpan. Aktifkan Generate Tagihan atau tutup dialog.");
    }
    return errs;
  }, [
    jenisId,
    tahunAjaranId,
    targetTahunBukuIds.length,
    tarifPeriods.missing.length,
    missingTarifLabel,
    rows.length,
    errorRowCount,
    autoGenerate,
    isSekali,
    genBulanList.length,
    overrideRowCount,
    jenisDefaultNominal,
    sampaiAkhirJenjang,
    isSPP,
    rencanaMulai,
  ]);

  const canSave = validationErrors.length === 0;
  const isSaving = bulkMut.isPending || atomicMut.isPending;

  const handleSave = async () => {
    if (!canSave || !tahunAjaranId) return;

    try {
      const tarifRows = rows
        .filter((r) => !isDefaultRow(r))
        .flatMap((r) => {
          const existing = existingPeriodBySiswa.get(r.siswa.id) || new Set<string>();
          return targetTahunBukuIds
            .filter((tahunBukuId) => !existing.has(tahunBukuId))
            .map((tahunBukuId) => ({
              jenis_id: jenisId,
              siswa_id: r.siswa.id,
              kelas_id: null,
              angkatan_id: null,
              tahun_ajaran_id: tahunBukuId,
              nominal: Number(r.nominal),
              keterangan: r.keterangan || null,
            }));
        });

      if (autoGenerate) {
        const generateGroups = isSekali
          ? [{ tahun_buku_id: targetTahunBukuIds[0], bulan_list: [null] as Array<number | null> }]
          : generatePeriods.groups.map((g) => ({
              tahun_buku_id: g.tahunBukuId,
              bulan_list: g.bulanList as Array<number | null>,
            }));

        await atomicMut.mutateAsync({
          tarif_rows: tarifRows,
          tahun_akademik_id: tahunAjaranId,
          jenis_id: jenisId,
          generate_groups: generateGroups,
          siswa_ids: rows.map((r) => r.siswa.id),
          sampai_akhir_jenjang: sampaiAkhirJenjang,
          rencana_mulai: rencanaMulai,
          rencana_rows: sampaiAkhirJenjang
            ? rows.map((r) => ({ siswa_id: r.siswa.id, nominal: Number(r.nominal) }))
            : undefined,
          bulan_terakhir: bulanTerakhir,
        });
      } else if (tarifRows.length > 0) {
        await bulkMut.mutateAsync(
          tarifRows.map((r) => ({
            jenis_id: r.jenis_id,
            siswa_id: r.siswa_id!,
            tahun_ajaran_id: r.tahun_ajaran_id,
            nominal: r.nominal,
            keterangan: r.keterangan || undefined,
          }))
        );
        if (defaultRowCount > 0) {
          toast.info(`${defaultRowCount} siswa sama dengan tarif default — tidak dibuat override per siswa.`);
        }
      }

      handleClose(false);
    } catch {
      // Toast mutation sudah menjelaskan error; dialog tetap terbuka agar data tidak hilang.
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tambah Override Tarif Dasar Massal (Per Siswa)</DialogTitle>
          <DialogDescription>
            Override hanya mengubah tarif dasar/bruto siswa. Nominal yang sama dengan tarif default tidak membuat override baru dan dapat langsung dipakai untuk generate tagihan.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs leading-relaxed sm:text-sm">
              <strong>Gunakan override hanya untuk perbedaan tarif dasar resmi</strong>, misalnya tarif kontrak lama, program/kelas tertentu, atau penetapan tarif bruto yang memang berbeda. <strong>Jangan gunakan override untuk beasiswa, diskon, potongan, atau keringanan.</strong> Untuk itu gunakan menu <strong>Siswa Penerima Keringanan</strong> di <code>/keuangan/diskon-siswa</code> agar bruto, potongan, netto, approval, dan jurnal tetap tercatat benar.
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Lembaga (opsional)</Label>
              <Select value={deptId || "__none__"} onValueChange={(v) => {
                const newDept = v === "__none__" ? "" : v;
                setDeptId(newDept);
                const jenisTerpilih = jenisList?.find((j: any) => j.id === jenisId);
                if (newDept && jenisTerpilih?.departemen_id && jenisTerpilih.departemen_id !== newDept) {
                  setJenisId("");
                  toast.info("Pilihan Jenis Pembayaran direset karena tidak berlaku untuk lembaga yang dipilih.");
                }
              }}>
                <SelectTrigger><SelectValue placeholder="Semua lembaga" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Semua Lembaga —</SelectItem>
                  {lembagaList?.map((l: any) => <SelectItem key={l.id} value={l.id}>{l.kode} — {l.nama}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Memfilter pilihan jenis pembayaran</p>
            </div>

            <div>
              <Label>Jenis Pembayaran *</Label>
              <Select value={jenisId} onValueChange={(v) => { setJenisId(v); setGenBulanList([]); setSampaiAkhirJenjang(false); }}>
                <SelectTrigger><SelectValue placeholder="Pilih jenis pembayaran..." /></SelectTrigger>
                <SelectContent>
                  {jenisListForForm?.map((j: any) => (
                    <SelectItem key={j.id} value={j.id}>
                      {j.nama} {j.nominal ? `(Default: ${formatRupiah(Number(j.nominal))})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Tahun Ajaran *</Label>
              <Select value={tahunAjaranId || "__none__"} onValueChange={(v) => { setTahunAjaranId(v === "__none__" ? "" : v); setGenBulanList([]); setSampaiAkhirJenjang(false); }}>
                <SelectTrigger><SelectValue placeholder="Pilih tahun ajaran" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Pilih Tahun Ajaran —</SelectItem>
                  {tahunAjaranList?.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.nama}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Tahun Ajaran Juli–Juni; Tahun Buku keuangan tetap Januari–Desember.</p>
            </div>

            <div>
              <Label>Keterangan Override Tarif Dasar</Label>
              <Input value={keteranganUmum} onChange={(e) => setKeteranganUmum(e.target.value)} placeholder="Misal: Tarif kontrak lama / program khusus" />
            </div>
          </div>

          {tahunAjaranId && targetTahunBukuIds.length > 0 && (
            <Alert className="py-2">
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>{selectedTahunAjaran?.nama}</strong> dipetakan ke {targetTahunBukuIds.map((id) => (tahunBukuList as any[])?.find((tb: any) => tb.id === id)?.nama).filter(Boolean).join(" + ")}.
              </AlertDescription>
            </Alert>
          )}

          <Separator />

          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[220px]">
              <Label>Tambah Siswa</Label>
              <SiswaCombobox value={null} onChange={addSiswa} placeholder="Cari nama/NIS lalu pilih untuk menambah..." />
            </div>
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-1.5" />Template
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={importing}>
              <Upload className="h-4 w-4 mr-1.5" />{importing ? "Memproses..." : "Import Excel"}
            </Button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUpload} />
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[220px]">
              <Label>Atau Tambah dari Kelas</Label>
              <Select value={kelasPickId || "__none__"} onValueChange={(v) => setKelasPickId(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Pilih kelas..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Pilih Kelas —</SelectItem>
                  {(kelasList || []).map((k: any) => (
                    <SelectItem key={k.id} value={k.id}>{k.nama} {k.tingkat?.nama ? `(${k.tingkat.nama})` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" onClick={addFromKelas} disabled={!kelasPickId || loadingKelas}>
              <Users className="h-4 w-4 mr-1.5" />{loadingKelas ? "Memuat..." : "Tambah Semua Siswa Kelas"}
            </Button>
          </div>

          {importErrors.length > 0 && (
            <Alert variant="destructive" className="py-2">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    {importErrors.slice(0, 8).map((e, i) => <p key={i}>{e}</p>)}
                    {importErrors.length > 8 && <p>… dan {importErrors.length - 8} masalah lain</p>}
                  </div>
                  <button onClick={() => setImportErrors([])} aria-label="Tutup"><X className="h-3.5 w-3.5" /></button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {rows.length > 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-44">
                <Label className="text-xs">Nominal target</Label>
                <RupiahInput value={nominalUmum} onChange={setNominalUmum} />
              </div>
              <Button variant="secondary" size="sm" onClick={applyNominalToAll} disabled={!nominalUmum}>
                Terapkan ke semua ({rows.length})
              </Button>
              {errorRowCount > 0 && (
                <Button variant="outline" size="sm" className="text-destructive" onClick={() => setRows((prev) => prev.filter((r) => !rowError(r)))}>
                  Hapus {errorRowCount} baris bermasalah
                </Button>
              )}
            </div>
          )}

          {jenisId && isSPP && (
            <Alert className="py-2">
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs leading-relaxed">
                <strong>Aturan SPP:</strong> satu master SPP per lembaga dan nominal master selalu Rp0.
                Tetapkan tarif efektif terlebih dahulu melalui daftar siswa, kelas/angkatan, atau Import Excel.
                Sistem akan <strong>menolak generate SPP</strong> untuk siswa yang belum memiliki tarif agar tidak memakai nominal yang salah.
                Potongan/keringanan diterapkan terpisah setelah tarif bruto ditetapkan.
              </AlertDescription>
            </Alert>
          )}

          {rows.length > 0 && jenisId && !isSPP && (
            <Alert className="py-2">
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs leading-relaxed">
                {jenisDefaultNominal > 0 ? (
                  <>
                    Tarif default <strong>{formatRupiah(jenisDefaultNominal)}</strong>. Dari {rows.length} siswa: <strong>{defaultRowCount}</strong> tidak memerlukan override per siswa dan <strong>{overrideRowCount}</strong> akan dibuatkan override tarif dasar.
                    {defaultRowCount > 0 && <> Saat generate, baris tanpa override siswa memakai <strong>tarif efektif</strong> sesuai prioritas sistem (mis. override kelas/angkatan/periode bila ada, lalu default).</>}
                  </>
                ) : (
                  <>Jenis ini tidak memiliki nominal default. Semua nominal siswa akan diperlakukan sebagai override tarif dasar.</>
                )}
              </AlertDescription>
            </Alert>
          )}

          {rows.length > 0 && (
            <div className="rounded-md border overflow-x-auto">
              <div className="max-h-72 min-w-[650px] overflow-y-auto divide-y">
                {rows.map((r, i) => {
                  const err = rowError(r);
                  const warn = !err ? rowWarning(r) : null;
                  const tanpaOverride = isDefaultRow(r);
                  return (
                    <div key={r.siswa.id} className={`flex items-center gap-2 px-3 py-2 ${err ? "bg-destructive/5" : warn ? "bg-amber-500/5" : ""}`}>
                      <span className="text-xs text-muted-foreground w-6 shrink-0 text-right">{i + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className="text-sm truncate">{r.siswa.nama} <span className="text-muted-foreground text-xs">({r.siswa.nis || "-"})</span></p>
                          <Badge variant={tanpaOverride ? "outline" : "secondary"} className="shrink-0 text-[10px]">
                            {isSPP ? "Tarif SPP siswa" : tanpaOverride ? "Tarif normal" : "Override tarif dasar"}
                          </Badge>
                        </div>
                        {err && <p className="text-xs text-destructive">{err}</p>}
                        {warn && <p className="text-xs text-amber-700 dark:text-amber-500">{warn}</p>}
                      </div>
                      <div className="w-36 shrink-0">
                        <RupiahInput value={r.nominal} onChange={(v) => updateRow(r.siswa.id, { nominal: v })} />
                      </div>
                      <Input className="w-44 shrink-0 text-sm" value={r.keterangan} onChange={(e) => updateRow(r.siswa.id, { keterangan: e.target.value })} placeholder={tanpaOverride ? "Tidak disimpan" : "Alasan tarif dasar berbeda"} disabled={tanpaOverride} />
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive" onClick={() => removeRow(r.siswa.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
              <div className="border-t px-3 py-2 text-xs text-muted-foreground flex justify-between gap-4">
                <span>{rows.length} siswa</span>
                <span>Total nominal input: <strong className="text-foreground">{formatRupiah(totalNominal)}</strong>{!isSekali && jenisId ? " /bulan" : ""}</span>
              </div>
            </div>
          )}

          <Separator />

          <div className="space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={autoGenerate} onCheckedChange={(v) => {
                setAutoGenerate(!!v);
                if (!v) setSampaiAkhirJenjang(false);
              }} />
              <span className="text-sm font-medium">Generate tagihan otomatis</span>
            </label>

            {autoGenerate && (
              <div className="space-y-3 pl-4 sm:pl-6 border-l-2 border-primary/20">
                <Alert className="py-2">
                  <Info className="h-3 w-3" />
                  <AlertDescription className="text-xs">
                    Tagihan dibuat hanya untuk <strong>{rows.length} siswa di daftar</strong>. Tagihan yang sudah ada akan di-skip oleh pengaman duplikasi database. Periode mendatang berstatus terjadwal dan baru dijurnal saat jatuh tempo.
                  </AlertDescription>
                </Alert>

                {jenisId && isSekali && (
                  <p className="text-xs text-muted-foreground">
                    Tipe <Badge variant="outline" className="text-xs">1x Bayar</Badge> — tagihan ditempatkan pada Tahun Buku yang memuat awal Tahun Ajaran.
                  </p>
                )}

                {isSPP && (
                  <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <Checkbox checked={sampaiAkhirJenjang} onCheckedChange={(value) => {
                        setSampaiAkhirJenjang(value === true);
                        if (value === true) {
                          setBulanMulaiRencana(kalenderAkademik.find((b) => genBulanList.includes(b.bulan))?.bulan || allMonths[0]);
                        }
                      }} />
                      <span>
                        <span className="text-sm font-medium">Lanjutkan SPP otomatis sampai akhir jenjang untuk semua siswa di daftar</span>
                        <span className="block text-xs text-muted-foreground mt-1">
                          Nominal mengikuti setiap baris. Akhir jenjang dihitung per siswa; MTA dipisahkan fase 1–3 dan 4–6.
                          Tahun pertama dibuat dari bulan mulai sampai Juni atau batas kelulusan.
                          Tahun berikutnya dibuat bertahap. Tagihan yang sudah ada dilewati.
                        </span>
                      </span>
                    </label>
                    {sampaiAkhirJenjang && (
                      <div className="space-y-2">
                        <Label className="text-xs">Bulan Terakhir SPP pada Tahun Kelulusan</Label>
                        <Select value={String(bulanTerakhir)} onValueChange={(v) => setBulanTerakhir(Number(v))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {[4, 5, 6].map((b) => <SelectItem key={b} value={String(b)}>{namaBulan(b)}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-primary">{rows.length} rencana SPP sampai akhir jenjang akan disimpan.</p>
                      </div>
                    )}
                  </div>
                )}

                {jenisId && !isSekali && (
                  <div>
                    {sampaiAkhirJenjang ? (
                      <div className="space-y-2">
                        <Label className="text-xs">Bulan Mulai SPP *</Label>
                        <Select value={rencanaMulai || ""} onValueChange={(value) => setBulanMulaiRencana(Number(value.slice(5, 7)))}>
                          <SelectTrigger><SelectValue placeholder="Pilih bulan mulai..." /></SelectTrigger>
                          <SelectContent>
                            {kalenderAkademik.map((b) => (
                              <SelectItem key={b.tanggal} value={b.tanggal}>{namaBulan(b.bulan)} {b.tahun}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                    <>
                    <Label className="text-xs">Bulan Tahun Ajaran *</Label>
                    <div className="flex items-center gap-2 mb-2 mt-1">
                      <Checkbox id="massal-select-all-months" checked={allSelected} onCheckedChange={(checked) => setGenBulanList(checked ? [...allMonths] : [])} />
                      <label htmlFor="massal-select-all-months" className="text-sm cursor-pointer">Pilih semua (Juli–Juni)</label>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {allMonths.map((b) => {
                        const kal = kalenderAkademik.find((x) => x.bulan === b);
                        return (
                          <label key={b} className="flex items-center gap-1.5 text-sm cursor-pointer">
                            <Checkbox checked={genBulanList.includes(b)} onCheckedChange={() => toggleBulan(b)} />
                            <span>{namaBulan(b)}{kal ? <span className="text-muted-foreground text-xs"> {kal.tahun}</span> : null}</span>
                          </label>
                        );
                      })}
                    </div>
                    </>
                    )}
                    {generatePeriods.groups.length > 1 && (
                      <div className="mt-3 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground space-y-1">
                        {generatePeriods.groups.map((g) => (
                          <p key={g.tahunBukuId}>{g.bulanList.map(namaBulan).join(", ")} → <strong className="text-foreground">{g.tahunBukuNama}</strong></p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {validationErrors.length > 0 && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-1">
              {validationErrors.map((err) => (
                <p key={err} className="text-xs text-destructive flex items-start gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-[1px]" />
                  {err}
                </p>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>Batal</Button>
          <Button onClick={handleSave} disabled={!canSave || isSaving}>
            {isSaving
              ? "Memproses..."
              : sampaiAkhirJenjang
                ? `Simpan Rencana & Tagihan untuk ${rows.length} Siswa`
                : autoGenerate
                ? overrideRowCount > 0
                  ? `Simpan ${overrideRowCount} Override Tarif Dasar & Generate untuk ${rows.length} Siswa`
                  : `Generate untuk ${rows.length} Siswa (Tanpa Override)`
                : `Simpan ${overrideRowCount} Override Tarif Dasar`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
