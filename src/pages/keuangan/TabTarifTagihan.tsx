import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { useState, useMemo, useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { SiswaCombobox, SiswaRingkas } from "@/components/shared/SiswaCombobox";
import { RupiahInput } from "@/components/shared/RupiahInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, PowerOff, Info, Zap, AlertCircle, Users } from "lucide-react";
import TarifMassalDialog from "./TarifMassalDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatRupiah, useAllJenisPembayaran, useTahunBuku, useLembaga, namaBulan, namaBulanTahun } from "@/hooks/useKeuangan";
import { useAllTarifTagihan, useCreateTarifTagihan, useUpdateTarifTagihan, useNonaktifkanTarifTagihan } from "@/hooks/useTarifTagihan";
import { useSimpanTarifGenerateAtomik } from "@/hooks/useTarifGenerateAtomik";
import { useTagihanList } from "@/hooks/useTagihan";
import { useKelas, useAngkatan, useTahunAjaran } from "@/hooks/useAkademikData";
import {
  BULAN_ORDER_AKADEMIK,
  bulanKalenderTahunAjaran,
  kelompokkanBulanKeTahunBuku,
  labelBulanKalender,
  targetTahunBukuTarif,
} from "@/lib/periodeTagihan";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";

const tarifFormSchema = z.object({
  deptId: z.string(),
  jenisId: z.string(),
  siswa: z.custom<SiswaRingkas | null>(),
  kelasId: z.string(),
  angkatanId: z.string(),
  // Tahun Ajaran akademik untuk mode tambah. Pada tabel DB, tarif tetap
  // disimpan per Tahun Buku melalui pemetaan Juli-Juni -> Jan-Des.
  tahunAjaranId: z.string(),
  nominal: z.string(),
  keterangan: z.string(),
  autoGenerate: z.boolean(),
  genBulanList: z.array(z.number()),
  genDeptId: z.string(),
  sampaiAkhirJenjang: z.boolean(),
});
type TarifFormValues = z.infer<typeof tarifFormSchema>;

const tarifFormDefaults: TarifFormValues = {
  deptId: "", jenisId: "", siswa: null, kelasId: "", angkatanId: "", tahunAjaranId: "",
  nominal: "", keterangan: "", autoGenerate: true, genBulanList: [], genDeptId: "",
  sampaiAkhirJenjang: false,
};

function buildTarifSchema(opts: { isEditMode: boolean; jenisById: Map<string, any> }) {
  return tarifFormSchema.superRefine((data, ctx) => {
    if (!data.nominal) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nominal"], message: "Nominal belum diisi" });
    } else if (Number(data.nominal) <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nominal"], message: "Nominal harus lebih dari 0" });
    }
    if (opts.isEditMode) return;

    if (!data.jenisId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["jenisId"], message: "Jenis Pembayaran belum dipilih" });
    }
    if (data.autoGenerate) {
      if (!data.tahunAjaranId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tahunAjaranId"], message: "Tahun Ajaran wajib dipilih saat opsi generate tagihan aktif" });
      }
      const isSekali = data.jenisId ? opts.jenisById.get(data.jenisId)?.tipe === "sekali" : false;
      if (data.jenisId && !isSekali && data.genBulanList.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["genBulanList"], message: "Pilih minimal satu bulan untuk generate tagihan" });
      }
      if (data.sampaiAkhirJenjang && !data.siswa) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sampaiAkhirJenjang"], message: "Rencana sampai akhir jenjang hanya dapat dibuat untuk satu siswa" });
      }
      if (data.sampaiAkhirJenjang && isSekali) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sampaiAkhirJenjang"], message: "Rencana sampai akhir jenjang hanya berlaku untuk pembayaran bulanan" });
      }
    } else if (data.sampaiAkhirJenjang) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sampaiAkhirJenjang"], message: "Aktifkan Generate tagihan otomatis untuk memakai rencana sampai akhir jenjang" });
    }
  });
}

interface TabTarifTagihanProps {
  initialSiswa?: SiswaRingkas;
  dialogOnly?: boolean;
  onClose?: () => void;
}

export default function TabTarifTagihan({ initialSiswa, dialogOnly = false, onClose }: TabTarifTagihanProps = {}) {
  const { data: tarifList, isLoading } = useAllTarifTagihan();
  const { data: jenisList } = useAllJenisPembayaran();
  const { data: kelasList } = useKelas();
  const { data: tahunList } = useTahunBuku();
  const { data: tahunAjaranList } = useTahunAjaran();
  const { data: lembagaList } = useLembaga();
  const { data: angkatanList } = useAngkatan();

  const createMut = useCreateTarifTagihan();
  const updateMut = useUpdateTarifTagihan();
  const nonaktifMut = useNonaktifkanTarifTagihan();
  const atomicMut = useSimpanTarifGenerateAtomik();

  const [dialogOpen, setDialogOpen] = useState(dialogOnly);
  const [editItem, setEditItem] = useState<any>(null);
  const [nonaktifItem, setNonaktifItem] = useState<any | null>(null);
  const [nonaktifAlasan, setNonaktifAlasan] = useState("");
  const [broadConfirmOpen, setBroadConfirmOpen] = useState(false);
  const [pendingSaveData, setPendingSaveData] = useState<TarifFormValues | null>(null);
  const [massalOpen, setMassalOpen] = useState(false);

  const jenisById = useMemo(() => new Map((jenisList ?? []).map((j: any) => [j.id, j])), [jenisList]);

  const form = useForm<TarifFormValues>({
    resolver: zodResolver(buildTarifSchema({ isEditMode: !!editItem, jenisById })),
    mode: "onChange",
    defaultValues: { ...tarifFormDefaults, siswa: initialSiswa ?? null, deptId: initialSiswa?.departemen_id ?? "" },
  });
  const deptId = form.watch("deptId");
  const jenisId = form.watch("jenisId");
  const siswa = form.watch("siswa");
  const kelasId = form.watch("kelasId");
  const angkatanId = form.watch("angkatanId");
  const tahunAjaranId = form.watch("tahunAjaranId");

  useEffect(() => {
    if (!dialogOnly || form.getValues("tahunAjaranId")) return;
    const activeYear = tahunAjaranList?.find((year) => year.aktif);
    if (activeYear) form.setValue("tahunAjaranId", activeYear.id, { shouldValidate: true });
  }, [dialogOnly, tahunAjaranList, form]);

  const selectedJenisForm = jenisById.get(jenisId);
  const effectiveDeptId = deptId || selectedJenisForm?.departemen_id || "";

  const filteredKelasList = useMemo(() => {
    if (!kelasList) return [];
    if (!effectiveDeptId) return kelasList;
    return kelasList.filter((k: any) => k.departemen_id === effectiveDeptId);
  }, [kelasList, effectiveDeptId]);

  const filteredAngkatanList = useMemo(() => {
    if (!angkatanList) return [];
    if (!effectiveDeptId) return angkatanList;
    return angkatanList.filter((a: any) => !a.departemen_id || a.departemen_id === effectiveDeptId);
  }, [angkatanList, effectiveDeptId]);

  const jenisListForForm = useMemo(() => {
    if (!jenisList) return [];
    if (!deptId) return jenisList;
    return jenisList.filter((j: any) => !j.departemen_id || j.departemen_id === deptId);
  }, [jenisList, deptId]);

  const handleLembagaChange = (v: string) => {
    const newDept = v === "__none__" ? "" : v;
    form.setValue("deptId", newDept, { shouldValidate: true });
    form.setValue("kelasId", "", { shouldValidate: true });
    const jenisTerpilih = jenisById.get(jenisId);
    if (newDept && jenisTerpilih?.departemen_id && jenisTerpilih.departemen_id !== newDept) {
      form.setValue("jenisId", "", { shouldValidate: true });
      toast.info("Pilihan Jenis Pembayaran direset karena tidak berlaku untuk lembaga yang dipilih.");
    }
    const angkatanTerpilih = angkatanList?.find((a: any) => a.id === angkatanId);
    if (newDept && angkatanTerpilih?.departemen_id && angkatanTerpilih.departemen_id !== newDept) {
      form.setValue("angkatanId", "", { shouldValidate: true });
      toast.info("Pilihan Angkatan direset karena tidak berlaku untuk lembaga yang dipilih.");
    }
  };

  const autoGenerate = form.watch("autoGenerate");
  const genBulanList = form.watch("genBulanList");
  const genDeptId = form.watch("genDeptId");
  const sampaiAkhirJenjang = form.watch("sampaiAkhirJenjang");

  const [filterJenis, setFilterJenis] = useState("");
  const [filterTarifKelas, setFilterTarifKelas] = useState("");
  const [filterTarifTahun, setFilterTarifTahun] = useState("");
  const [filterTarifSiswa, setFilterTarifSiswa] = useState<SiswaRingkas | null>(null);

  const [filterTahunId, setFilterTahunId] = useState("");
  const [filterJenisId, setFilterJenisId] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterTagihanKelas, setFilterTagihanKelas] = useState("");
  const [filterSiswa, setFilterSiswa] = useState<SiswaRingkas | null>(null);

  const { data: tagihanDataRaw, isLoading: loadingTagihan } = useTagihanList({
    tahun_ajaran_id: filterTahunId || undefined,
    jenis_id: filterJenisId || undefined,
    status: filterStatus || undefined,
    siswa_id: filterSiswa?.id || undefined,
  });
  const tagihanData = useMemo(() => {
    if (!tagihanDataRaw) return tagihanDataRaw;
    let result = tagihanDataRaw;
    if (!filterStatus) result = result.filter((t: any) => t.status !== "dibatalkan");
    if (filterTagihanKelas) result = result.filter((t: any) => t.kelas_id === filterTagihanKelas);
    return result;
  }, [tagihanDataRaw, filterStatus, filterTagihanKelas]);

  const filteredData = useMemo(() => {
    if (!tarifList) return [];
    let result = tarifList;
    if (filterJenis) result = result.filter((t: any) => t.jenis_id === filterJenis);
    if (filterTarifKelas) result = result.filter((t: any) => t.kelas_id === filterTarifKelas);
    if (filterTarifTahun) result = result.filter((t: any) => t.tahun_ajaran_id === filterTarifTahun);
    if (filterTarifSiswa) result = result.filter((t: any) => t.siswa_id === filterTarifSiswa.id);
    return result;
  }, [tarifList, filterJenis, filterTarifKelas, filterTarifTahun, filterTarifSiswa]);

  const selectedJenis = jenisById.get(jenisId);
  const isSekali = selectedJenis?.tipe === "sekali";
  const selectedTahunAjaran = tahunAjaranList?.find((t: any) => t.id === tahunAjaranId) || null;
  const kalenderAkademik = useMemo(
    () => bulanKalenderTahunAjaran(selectedTahunAjaran as any),
    [selectedTahunAjaran],
  );
  const allMonths = kalenderAkademik.length ? kalenderAkademik.map((x) => x.bulan) : BULAN_ORDER_AKADEMIK;
  const allSelected = allMonths.length > 0 && allMonths.every((b) => genBulanList.includes(b));
  const rencanaMulai = useMemo(() => {
    const first = kalenderAkademik.find((item) => genBulanList.includes(item.bulan));
    if (!first) return null;
    return `${first.tahun}-${String(first.bulan).padStart(2, "0")}-01`;
  }, [kalenderAkademik, genBulanList]);

  const tarifPeriods = useMemo(
    () => targetTahunBukuTarif({
      tahunAjaran: selectedTahunAjaran as any,
      tahunBukuList: tahunList as any,
      tipeSekali: isSekali,
    }),
    [selectedTahunAjaran, tahunList, isSekali],
  );
  const generatePeriods = useMemo(
    () => kelompokkanBulanKeTahunBuku({
      tahunAjaran: selectedTahunAjaran as any,
      tahunBukuList: tahunList as any,
      bulanList: genBulanList,
    }),
    [selectedTahunAjaran, tahunList, genBulanList],
  );

  const toggleBulan = (b: number) => {
    const next = genBulanList.includes(b) ? genBulanList.filter((x) => x !== b) : [...genBulanList, b];
    form.setValue("genBulanList", next, { shouldValidate: true });
  };

  const openAdd = () => {
    setEditItem(null);
    form.reset(tarifFormDefaults);
    setDialogOpen(true);
  };

  const openEdit = (item: any) => {
    setEditItem(item);
    form.reset({ ...tarifFormDefaults, nominal: String(item.nominal ?? "").replace(/\D/g, ""), keterangan: item.keterangan || "" });
    setDialogOpen(true);
  };

  const openNonaktif = (item: any) => {
    setNonaktifItem(item);
    setNonaktifAlasan("");
  };

  const closeNonaktif = () => {
    if (nonaktifMut.isPending) return;
    setNonaktifItem(null);
    setNonaktifAlasan("");
  };

  const confirmNonaktif = async () => {
    if (!nonaktifItem || nonaktifAlasan.trim().length < 3) return;
    try {
      await nonaktifMut.mutateAsync({ id: nonaktifItem.id, alasan: nonaktifAlasan });
      setNonaktifItem(null);
      setNonaktifAlasan("");
    } catch {
      // Toast mutation sudah menampilkan alasan kegagalan. Dialog tetap terbuka.
    }
  };

  useEffect(() => {
    if (dialogOpen) void form.trigger();
  }, [dialogOpen, editItem, form]);

  const matchingTarifPeriods = useMemo(() => {
    const ids = new Set<string>();
    if (!tarifList || !jenisId || editItem) return ids;
    const norm = (x: string | null | undefined) => x || null;
    for (const t of tarifList as any[]) {
      if (
        t.jenis_id === jenisId &&
        norm(t.siswa_id) === norm(siswa?.id) &&
        norm(t.kelas_id) === norm(kelasId) &&
        norm(t.angkatan_id) === norm(angkatanId)
      ) {
        if (t.tahun_ajaran_id) ids.add(t.tahun_ajaran_id);
        else ids.add("__none__");
      }
    }
    return ids;
  }, [tarifList, jenisId, siswa, kelasId, angkatanId, editItem]);

  const duplicateFull = !editItem && !!jenisId && (
    tahunAjaranId
      ? tarifPeriods.ids.length > 0 && tarifPeriods.ids.every((id) => matchingTarifPeriods.has(id))
      : matchingTarifPeriods.has("__none__")
  );

  const missingTahunBukuLabels = useMemo(() => {
    const years = new Map<number, string>();
    for (const item of tarifPeriods.missing) years.set(item.tahun, labelBulanKalender(item));
    return Array.from(years.values());
  }, [tarifPeriods.missing]);

  const validationWarnings = useMemo(() => {
    const warns: string[] = [];
    if (!editItem && siswa && effectiveDeptId && siswa.departemen_id && siswa.departemen_id !== effectiveDeptId) {
      warns.push("Siswa terpilih tercatat di lembaga lain dari Lembaga/Jenis Pembayaran ini — pastikan ini memang disengaja (mis. tarif jenjang berikutnya).");
    }
    if (!editItem && tahunAjaranId && !duplicateFull && tarifPeriods.ids.some((id) => matchingTarifPeriods.has(id))) {
      warns.push("Sebagian Tahun Buku dalam Tahun Ajaran ini sudah mempunyai tarif. Sistem hanya akan menambahkan periode yang belum ada.");
    }
    return warns;
  }, [editItem, siswa, effectiveDeptId, tahunAjaranId, duplicateFull, tarifPeriods.ids, matchingTarifPeriods]);

  const validationErrors = useMemo(() => {
    const errors = Object.values(form.formState.errors).map((e) => e?.message).filter((m): m is string => !!m);
    if (!editItem && tahunAjaranId && missingTahunBukuLabels.length > 0) {
      errors.push(`Tahun Buku untuk ${missingTahunBukuLabels.join(", ")} belum tersedia — buat dulu di tab Tahun Buku`);
    }
    if (!editItem && duplicateFull) {
      errors.push("Tarif dengan jenis & scope ini sudah lengkap untuk Tahun Ajaran yang dipilih — edit tarif yang ada, jangan buat duplikat");
    }
    return [...new Set(errors)];
  }, [form.formState.errors, editItem, tahunAjaranId, missingTahunBukuLabels, duplicateFull]);

  const canSave = form.formState.isValid && validationErrors.length === 0;
  const isSaving = createMut.isPending || updateMut.isPending || atomicMut.isPending;

  const changeDialogOpen = (open: boolean) => {
    if (isSaving) return;
    setDialogOpen(open);
    if (!open) onClose?.();
  };

  const performSave = async (data: TarifFormValues) => {
    const nominalNum = Number(data.nominal || 0);
    const isSekaliData = data.jenisId ? jenisById.get(data.jenisId)?.tipe === "sekali" : false;
    try {
      if (editItem) {
        await updateMut.mutateAsync({ id: editItem.id, nominal: nominalNum, keterangan: data.keterangan || undefined });
      } else {
        let tahunIds: string[] | undefined;
        if (data.tahunAjaranId) {
          tahunIds = tarifPeriods.ids.filter((id) => !matchingTarifPeriods.has(id));
          if (tahunIds.length === 0) return;
        }

        if (data.autoGenerate && data.tahunAjaranId && data.jenisId) {
          const tarifRows = (tahunIds || []).map((tahunBukuId) => ({
            jenis_id: data.jenisId,
            siswa_id: data.siswa?.id || null,
            kelas_id: data.kelasId || null,
            angkatan_id: data.angkatanId || null,
            tahun_ajaran_id: tahunBukuId,
            nominal: nominalNum,
            keterangan: data.keterangan || null,
          }));

          const generateGroups = isSekaliData
            ? [{ tahun_buku_id: tarifPeriods.ids[0], bulan_list: [null] as Array<number | null> }]
            : generatePeriods.groups.map((group) => ({
                tahun_buku_id: group.tahunBukuId,
                bulan_list: group.bulanList as Array<number | null>,
              }));

          const effectiveGenDeptId = data.genDeptId || data.deptId;
          await atomicMut.mutateAsync({
            tarif_rows: tarifRows,
            tahun_akademik_id: data.tahunAjaranId,
            jenis_id: data.jenisId,
            generate_groups: generateGroups,
            departemen_id: effectiveGenDeptId || null,
            siswa_id: data.siswa?.id || null,
            kelas_id: data.kelasId || null,
            angkatan_id: data.angkatanId || null,
            sampai_akhir_jenjang: data.sampaiAkhirJenjang,
            rencana_mulai: data.sampaiAkhirJenjang ? rencanaMulai : null,
          });
        } else {
          await createMut.mutateAsync({
            jenis_id: data.jenisId,
            siswa_id: data.siswa?.id || null,
            kelas_id: data.kelasId || null,
            angkatan_id: data.angkatanId || null,
            tahun_ajaran_id: data.tahunAjaranId ? undefined : null,
            tahun_ajaran_ids: tahunIds,
            nominal: nominalNum,
            keterangan: data.keterangan || undefined,
          });
        }
      }
      setDialogOpen(false);
      onClose?.();
    } catch {
      // Toast mutation sudah menjelaskan error; form tetap terbuka agar input tidak hilang.
    }
  };

  const onSubmit = (data: TarifFormValues) => {
    const isBroadGenerate = !editItem && data.autoGenerate && !data.siswa && !data.kelasId && !(data.genDeptId || data.deptId);
    if (isBroadGenerate) {
      setPendingSaveData(data);
      setBroadConfirmOpen(true);
      return;
    }
    void performSave(data);
  };

  const getLevelBadge = (row: any) => {
    const parts: string[] = [];
    if (row.siswa_id) parts.push("Siswa");
    if (row.kelas_id) parts.push("Kelas");
    if (row.angkatan_id) parts.push("Angkatan");
    if (row.tahun_ajaran_id) parts.push("Tahun");
    if (parts.length === 0) return <Badge variant="outline">Umum</Badge>;
    return <Badge variant="secondary">{parts.join(" + ")}</Badge>;
  };

  const tarifColumns: DataTableColumn<any>[] = [
    { key: "jenis", label: "Jenis Pembayaran", className: "min-w-[150px]", render: (_, r) => (r as any).jenis?.nama || "-", sortable: true },
    { key: "level", label: "Berlaku untuk", className: "min-w-[120px]", render: (_, r) => getLevelBadge(r) },
    { key: "siswa", label: "Siswa", className: "min-w-[180px]", render: (_, r) => { const s = (r as any).siswa; return s ? <span>{s.nama} <span className="text-muted-foreground text-xs">({s.nis || '-'})</span></span> : <span className="text-muted-foreground">—</span>; } },
    { key: "kelas", label: "Kelas", className: "min-w-[100px]", render: (_, r) => (r as any).kelas?.nama || <span className="text-muted-foreground">—</span> },
    { key: "angkatan", label: "Angkatan", className: "min-w-[110px]", render: (_, r) => (r as any).angkatan?.nama || <span className="text-muted-foreground">—</span> },
    { key: "tahun_ajaran", label: "Tahun Buku", className: "min-w-[140px]", render: (_, r) => (r as any).tahun_ajaran?.nama || <span className="text-muted-foreground">—</span> },
    { key: "nominal_default", label: "Nominal Default", className: "min-w-[130px]", render: (_, r) => { const def = (r as any).jenis?.nominal; return def ? <span className="text-muted-foreground">{formatRupiah(Number(def))}</span> : "-"; } },
    { key: "nominal", label: "Nominal Khusus", className: "min-w-[140px]", render: (v) => <span className="font-semibold text-primary">{formatRupiah(Number(v))}</span> },
    { key: "keterangan", label: "Keterangan", className: "min-w-[160px]", render: (v) => (v as string) || "-" },
    {
      key: "aksi", label: "Aksi", className: "min-w-[90px]",
      render: (_, r) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive"
            title="Nonaktifkan override tarif"
            aria-label="Nonaktifkan override tarif"
            onClick={() => openNonaktif(r)}
          >
            <PowerOff className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const tagihanColumns: DataTableColumn<any>[] = [
    { key: "siswa", label: "Siswa", className: "min-w-[180px]", render: (_, r) => { const s = (r as any).siswa; return s ? <span>{s.nama} <span className="text-muted-foreground text-xs">({s.nis || '-'})</span></span> : "-"; }, sortable: true },
    { key: "jenis", label: "Jenis", className: "min-w-[130px]", render: (_, r) => (r as any).jenis?.nama || "-" },
    { key: "kelas", label: "Kelas", className: "min-w-[100px]", render: (_, r) => (r as any).kelas?.nama || "-" },
    { key: "tahun_ajaran", label: "Tahun Buku", className: "min-w-[140px]", render: (_, r) => (r as any).tahun_ajaran?.nama || "-" },
    { key: "bulan", label: "Bulan", className: "min-w-[130px]", render: (v, r) => v ? namaBulanTahun(v as number, { tahunBukuNama: (r as any).tahun_ajaran?.nama }) : <Badge variant="outline">Sekali — {(r as any).tahun_ajaran?.nama || "-"}</Badge> },
    { key: "nominal", label: "Nominal", className: "min-w-[120px]", render: (v) => <span className="font-semibold">{formatRupiah(Number(v))}</span> },
    {
      key: "status", label: "Status", className: "min-w-[110px]",
      render: (v) => v === "lunas"
        ? <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300">Lunas</Badge>
        : v === "sebagian"
          ? <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">Sebagian</Badge>
        : v === "dihapusbuku"
          ? <Badge variant="outline">Dihapusbuku</Badge>
        : v === "terjadwal"
          ? <Badge variant="secondary">Terjadwal</Badge>
          : v === "dibatalkan"
            ? <Badge variant="outline" className="bg-muted text-muted-foreground border-muted-foreground/30">Dibatalkan</Badge>
            : <Badge variant="destructive">Belum Bayar</Badge>,
    },
  ];

  return (
    <>
      {!dialogOnly && <>
      <Card className="mt-4">
        <CardContent className="space-y-4 px-3 pt-4 sm:px-6 sm:pt-6">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs leading-relaxed sm:text-sm">
              Atur nominal tagihan untuk <strong>siswa</strong>, <strong>kelas</strong>, atau <strong>angkatan</strong>.
              Pilih Tahun Ajaran yang sesuai; sistem menempatkan tagihan pada Tahun Buku secara otomatis.
            </AlertDescription>
          </Alert>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="w-full sm:w-64">
              <Label className="text-xs">Filter Jenis Pembayaran</Label>
              <SearchableSelect
                value={filterJenis || "__all__"}
                onValueChange={(v) => setFilterJenis(v === "__all__" ? "" : v)}
                placeholder="Semua jenis"
                groupPaymentTypes
                options={[
                  { value: "__all__", label: <>Semua Jenis</> },
                  ...(jenisList?.map((j: any) => ({ value: j.id, label: <>{j.nama}</> })) ??
                    []),
                ]}
              />
            </div>
            <div className="w-full sm:w-48">
              <Label className="text-xs">Filter Kelas</Label>
              <SearchableSelect
                value={filterTarifKelas || "__all__"}
                onValueChange={(v) => setFilterTarifKelas(v === "__all__" ? "" : v)}
                placeholder="Semua kelas"
                options={[
                  { value: "__all__", label: <>Semua Kelas</> },
                  ...(kelasList?.map((k: any) => ({
                    value: k.id,
                    label: (
                      <>
                        {k.nama}
                        {k.departemen?.nama ? ` — ${k.departemen.nama}` : ""}
                      </>
                    ),
                  })) ?? []),
                ]}
              />
            </div>
            <div className="w-full sm:w-48">
              <Label className="text-xs">Filter Tahun Buku</Label>
              <Select value={filterTarifTahun || "__all__"} onValueChange={(v) => setFilterTarifTahun(v === "__all__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Semua tahun buku" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Semua Tahun Buku</SelectItem>
                  {tahunList?.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.nama}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:w-56">
              <Label className="text-xs">Filter Siswa</Label>
              <SiswaCombobox value={filterTarifSiswa} onChange={setFilterTarifSiswa} placeholder="Semua siswa" />
            </div>
            {(filterJenis || filterTarifKelas || filterTarifTahun || filterTarifSiswa) && (
              <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground"
                onClick={() => { setFilterJenis(""); setFilterTarifKelas(""); setFilterTarifTahun(""); setFilterTarifSiswa(null); }}>
                Reset Filter
              </Button>
            )}
          </div>
          <DataTable columns={tarifColumns} data={filteredData} loading={isLoading} pageSize={20} actions={
            <div className="flex w-full gap-2 sm:w-auto">
              <Button size="sm" variant="outline" className="flex-1 sm:flex-none" onClick={() => setMassalOpen(true)}><Users className="h-4 w-4 mr-2" />Tambah Massal</Button>
              <Button size="sm" className="flex-1 sm:flex-none" onClick={openAdd}><Plus className="h-4 w-4 mr-2" />Tambah Tarif</Button>
            </div>
          } />
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardContent className="space-y-4 px-3 pt-4 sm:px-6 sm:pt-6">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-lg">Daftar Tagihan</h3>
          </div>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs leading-relaxed sm:text-sm">
              Tagihan dibuat saat opsi generate dijalankan. Tagihan yang sudah jatuh tempo otomatis membuat jurnal <strong>Debit Piutang | Kredit Pendapatan</strong>.
              Periode mendatang berstatus <strong>Terjadwal</strong> dan baru dijurnal saat jatuh tempo. Saat pembayaran diterima, jurnal pembayaran adalah <strong>Debit Kas | Kredit Piutang</strong>.
            </AlertDescription>
          </Alert>

          <div className="flex flex-wrap gap-2 items-end">
            <div className="w-full sm:w-48">
              <Label className="text-xs">Tahun Buku</Label>
              <Select value={filterTahunId || "__all__"} onValueChange={(v) => setFilterTahunId(v === "__all__" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Semua</SelectItem>
                  {tahunList?.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.nama}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:w-48">
              <Label className="text-xs">Jenis Pembayaran</Label>
              <SearchableSelect
                value={filterJenisId || "__all__"}
                onValueChange={(v) => setFilterJenisId(v === "__all__" ? "" : v)}
                placeholder="Pilih atau cari..."
                groupPaymentTypes
                options={[
                  { value: "__all__", label: <>Semua</> },
                  ...(jenisList?.map((j: any) => ({ value: j.id, label: <>{j.nama}</> })) ??
                    []),
                ]}
              />
            </div>
            <div className="w-full sm:w-40">
              <Label className="text-xs">Status</Label>
              <Select value={filterStatus || "__all__"} onValueChange={(v) => setFilterStatus(v === "__all__" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Semua</SelectItem>
                  <SelectItem value="terjadwal">Terjadwal</SelectItem>
                  <SelectItem value="belum_bayar">Belum Bayar</SelectItem>
                  <SelectItem value="sebagian">Sebagian</SelectItem>
                  <SelectItem value="lunas">Lunas</SelectItem>
                  <SelectItem value="dihapusbuku">Dihapusbuku</SelectItem>
                  <SelectItem value="dibatalkan">Dibatalkan</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:w-48">
              <Label className="text-xs">Kelas</Label>
              <SearchableSelect
                value={filterTagihanKelas || "__all__"}
                onValueChange={(v) => setFilterTagihanKelas(v === "__all__" ? "" : v)}
                placeholder="Pilih atau cari..."
                options={[
                  { value: "__all__", label: <>Semua</> },
                  ...(kelasList?.map((k: any) => ({
                    value: k.id,
                    label: (
                      <>
                        {k.nama}
                        {k.departemen?.nama ? ` — ${k.departemen.nama}` : ""}
                      </>
                    ),
                  })) ?? []),
                ]}
              />
            </div>
            <div className="w-full sm:w-56">
              <Label className="text-xs">Siswa</Label>
              <SiswaCombobox value={filterSiswa} onChange={setFilterSiswa} placeholder="Semua siswa" />
            </div>
            {(filterTahunId || filterJenisId || filterStatus || filterTagihanKelas || filterSiswa) && (
              <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground"
                onClick={() => { setFilterTahunId(""); setFilterJenisId(""); setFilterStatus(""); setFilterTagihanKelas(""); setFilterSiswa(null); }}>
                Reset Filter
              </Button>
            )}
          </div>

          <DataTable columns={tagihanColumns} data={tagihanData || []} loading={loadingTagihan} pageSize={20} />
        </CardContent>
      </Card>

      </>}
      <Dialog open={dialogOpen} onOpenChange={changeDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{dialogOnly ? "Tambah Tagihan" : `${editItem ? "Edit" : "Tambah"} Tarif Tagihan`}</DialogTitle></DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {dialogOnly && initialSiswa && (
              <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                <p className="font-semibold">{initialSiswa.nama}</p>
                <p className="text-xs text-muted-foreground">NIS: {initialSiswa.nis || "-"} · {lembagaList?.find((lembaga) => lembaga.id === initialSiswa.departemen_id)?.kode || "-"}</p>
              </div>
            )}
            {editItem ? (
              <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1.5">
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Jenis Pembayaran</span><span className="font-medium text-right">{editItem.jenis?.nama || "-"}</span></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Siswa</span><span className="text-right">{editItem.siswa ? `${editItem.siswa.nama} (${editItem.siswa.nis || "-"})` : "Semua siswa"}</span></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Kelas</span><span className="text-right">{editItem.kelas?.nama || "Semua kelas"}</span></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Angkatan</span><span className="text-right">{editItem.angkatan?.nama || "Semua angkatan"}</span></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Tahun Buku</span><span className="text-right">{editItem.tahun_ajaran?.nama || "Semua tahun buku"}</span></div>
                <p className="text-xs text-muted-foreground pt-1.5 border-t mt-2">
                  Jenis & scope tidak bisa diubah agar tagihan yang sudah ada tetap valid. Nonaktifkan override ini lalu buat override baru jika perlu mengubah scope.
                </p>
              </div>
            ) : (
              <>
                {!dialogOnly && (
                <div>
                  <Label>Lembaga (opsional)</Label>
                  <SearchableSelect
                    value={deptId || "__none__"}
                    onValueChange={handleLembagaChange}
                    placeholder="Semua lembaga"
                    options={[
                      { value: "__none__", label: <>— Semua Lembaga —</> },
                      ...(lembagaList?.map((l: any) => ({
                        value: l.id,
                        label: (
                          <>
                            {l.kode} — {l.nama}
                          </>
                        ),
                      })) ?? []),
                    ]}
                  />
                  <p className="text-xs text-muted-foreground mt-1">Memfilter pilihan jenis pembayaran, kelas, dan angkatan di bawah</p>
                </div>
                )}
                <div>
                  <Label>Jenis Pembayaran *</Label>
                  <Controller control={form.control} name="jenisId" render={({ field }) => (
                    <SearchableSelect
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v);
                        form.setValue("genBulanList", [], { shouldValidate: true });
                        form.setValue("sampaiAkhirJenjang", false, { shouldValidate: true });
                      }}
                      placeholder="Pilih jenis pembayaran..."
                      groupPaymentTypes
                      options={[
                        ...(jenisListForForm?.map((j: any) => ({
                          value: j.id,
                          label: (
                            <>
                              {j.nama}{" "}
                              {j.nominal ? `(Default: ${formatRupiah(Number(j.nominal))})` : ""}
                            </>
                          ),
                        })) ?? []),
                      ]}
                    />
                  )} />
                </div>
                {!dialogOnly && (
                <div>
                  <Label>Siswa (opsional)</Label>
                  <Controller control={form.control} name="siswa" render={({ field }) => (
                    <SiswaCombobox
                      value={field.value}
                      onChange={(s) => {
                        field.onChange(s);
                        if (!s) form.setValue("sampaiAkhirJenjang", false, { shouldValidate: true });
                        if (s && !deptId && s.departemen_id) {
                          form.setValue("deptId", s.departemen_id, { shouldValidate: true });
                          form.setValue("kelasId", "", { shouldValidate: true });
                          toast.info("Lembaga otomatis diisi dari data siswa — bisa diganti manual jika perlu.");
                        }
                      }}
                      placeholder="Semua siswa — atau cari nama/NIS..."
                    />
                  )} />
                </div>
                )}
                {!dialogOnly && (
                <details className="rounded-lg border p-3" open={!siswa || undefined}>
                  <summary className="cursor-pointer text-sm font-medium">Pengaturan tambahan: kelas dan angkatan</summary>
                  <div className="mt-3 space-y-3">
                <div>
                  <Label>Kelas (opsional)</Label>
                  <Controller control={form.control} name="kelasId" render={({ field }) => (
                    <SearchableSelect
                      value={field.value || "__none__"}
                      onValueChange={(v) => field.onChange(v === "__none__" ? "" : v)}
                      placeholder="Semua kelas"
                      options={[
                        { value: "__none__", label: <>— Semua Kelas —</> },
                        ...(filteredKelasList?.map((k: any) => ({
                          value: k.id,
                          label: (
                            <>
                              {k.nama}
                              {k.departemen?.nama ? ` — ${k.departemen.nama}` : ""}
                            </>
                          ),
                        })) ?? []),
                      ]}
                    />
                  )} />
                </div>
                <div>
                  <Label>Angkatan (opsional)</Label>
                  <Controller control={form.control} name="angkatanId" render={({ field }) => (
                    <SearchableSelect
                      value={field.value || "__none__"}
                      onValueChange={(v) => field.onChange(v === "__none__" ? "" : v)}
                      placeholder="Semua angkatan"
                      options={[
                        { value: "__none__", label: <>— Semua Angkatan —</> },
                        ...(filteredAngkatanList?.map((a: any) => ({
                          value: a.id,
                          label: (
                            <>
                              {a.nama}
                              {a.departemen ? ` — ${a.departemen.nama}` : ""}
                            </>
                          ),
                        })) ?? []),
                      ]}
                    />
                  )} />
                </div>
                  </div>
                </details>
                )}
                <div>
                  <Label>Tahun Ajaran {autoGenerate ? "*" : "(opsional)"}</Label>
                  <Controller control={form.control} name="tahunAjaranId" render={({ field }) => (
                    <Select value={field.value || "__none__"} onValueChange={(v) => { field.onChange(v === "__none__" ? "" : v); form.setValue("genBulanList", [], { shouldValidate: true }); }}>
                      <SelectTrigger><SelectValue placeholder="Pilih tahun ajaran" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Tanpa Tahun Ajaran (berlaku semua periode) —</SelectItem>
                        {tahunAjaranList?.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.nama}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )} />
                  <p className="text-xs text-muted-foreground mt-1">Tahun Ajaran mengikuti Juli–Juni; penyimpanan keuangan otomatis dibagi ke Tahun Buku Jan–Des.</p>
                </div>

                {tahunAjaranId && tarifPeriods.ids.length > 0 && (
                  <Alert className="py-2">
                    <Info className="h-3 w-3" />
                    <AlertDescription className="text-xs">
                      <strong>{selectedTahunAjaran?.nama}</strong> → {tarifPeriods.ids.map((id) => (tahunList as any[])?.find((tb: any) => tb.id === id)?.nama).filter(Boolean).join(" + ")}.
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}

            <div>
              <Label>{siswa ? "Nominal untuk siswa ini" : "Nominal tagihan"} *</Label>
              <Controller control={form.control} name="nominal" render={({ field }) => (
                <RupiahInput value={field.value} onChange={field.onChange} />
              )} />
              <p className="text-xs text-muted-foreground mt-1">
                Nominal tagihan sebelum potongan yang berlaku
                {!editItem && selectedJenis?.nominal ? <> (default saat ini: <strong>{formatRupiah(Number(selectedJenis.nominal))}</strong>)</> : null}
              </p>
            </div>
            <div>
              <Label>Keterangan</Label>
              <Textarea {...form.register("keterangan")} placeholder="Contoh: Uang Pangkal sesuai kesepakatan pendaftaran" />
            </div>

            {!editItem && (
              <>
                <Separator />
                <div className="space-y-3">
                  {!dialogOnly && <label className="flex items-center gap-2 cursor-pointer">
                    <Controller control={form.control} name="autoGenerate" render={({ field }) => (
                      <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(!!v)} />
                    )} />
                    <span className="text-sm font-medium">Buat tagihan setelah disimpan</span>
                  </label>}

                  {autoGenerate && (
                    <div className="space-y-3 pl-4 sm:pl-6 border-l-2 border-primary/20">
                      <Alert className="py-2">
                        <Info className="h-3 w-3" />
                        <AlertDescription className="text-xs">
                          Akan membuat tagihan untuk{" "}
                          {siswa
                            ? <strong>siswa {siswa.nama}</strong>
                            : kelasId
                              ? <strong>siswa di kelas {filteredKelasList.find((k: any) => k.id === kelasId)?.nama}</strong>
                              : (deptId || genDeptId)
                                ? <strong>siswa di lembaga {lembagaList?.find((l: any) => l.id === (deptId || genDeptId))?.kode}</strong>
                                : <strong>semua siswa aktif di Tahun Ajaran terpilih</strong>
                          }. Periode mendatang disimpan sebagai terjadwal dan jurnal piutang baru dibuat saat jatuh tempo.
                        </AlertDescription>
                      </Alert>

                      {jenisId && isSekali && (
                        <div className="text-xs text-muted-foreground">
                          Tipe <Badge variant="outline" className="text-xs">1x Bayar</Badge> — tagihan ditempatkan pada Tahun Buku yang memuat awal Tahun Ajaran.
                        </div>
                      )}

                      {jenisId && !isSekali && (
                        <div>
                          <Label className="text-xs">Bulan Tahun Ajaran *</Label>
                          <div className="flex items-center gap-2 mb-2 mt-1">
                            <Checkbox
                              id="select-all-months"
                              checked={allSelected}
                              onCheckedChange={(checked) => form.setValue("genBulanList", checked ? [...allMonths] : [], { shouldValidate: true })}
                            />
                            <label htmlFor="select-all-months" className="text-sm cursor-pointer">Pilih semua (Juli–Juni)</label>
                          </div>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
                          {generatePeriods.groups.length > 1 && (
                            <div className="mt-3 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground space-y-1">
                              {generatePeriods.groups.map((g) => (
                                <p key={g.tahunBukuId}>{g.bulanList.map(namaBulan).join(", ")} → <strong className="text-foreground">{g.tahunBukuNama}</strong></p>
                              ))}
                            </div>
                          )}

                          {siswa && (
                            <div className="mt-4 rounded-md border bg-muted/30 p-3 space-y-2">
                              <label className="flex items-start gap-2 cursor-pointer">
                                <Controller control={form.control} name="sampaiAkhirJenjang" render={({ field }) => (
                                  <Checkbox
                                    className="mt-0.5"
                                    checked={field.value}
                                    onCheckedChange={(value) => field.onChange(value === true)}
                                  />
                                )} />
                                <span>
                                  <span className="text-sm font-medium">Lanjutkan SPP otomatis sampai akhir jenjang</span>
                                  <span className="block text-xs text-muted-foreground mt-0.5">
                                    SD &amp; MTA sampai tingkat 6, SMP sampai kelas 9, SMA sampai kelas 12.
                                    Jika tidak naik kelas, batas akhir otomatis diperpanjang; jika pindah keluar/lulus,
                                    rencana dihentikan. Nominal dapat diubah untuk bulan berikutnya tanpa mengubah histori.
                                  </span>
                                </span>
                              </label>
                              {sampaiAkhirJenjang && rencanaMulai && (
                                <p className="text-xs text-primary">
                                  Rencana mulai {new Date(`${rencanaMulai}T00:00:00`).toLocaleDateString("id-ID", { month: "long", year: "numeric" })}.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {!deptId && !siswa && !kelasId && (
                        <div>
                          <Label className="text-xs">Lembaga (opsional — filter generate)</Label>
                          <Controller control={form.control} name="genDeptId" render={({ field }) => (
                            <SearchableSelect
                              value={field.value || "__all__"}
                              onValueChange={(v) => field.onChange(v === "__all__" ? "" : v)}
                              placeholder="Pilih atau cari..."
                              options={[
                                { value: "__all__", label: <>Semua Lembaga</> },
                                ...(lembagaList?.map((l: any) => ({
                                  value: l.id,
                                  label: (
                                    <>
                                      {l.kode} — {l.nama}
                                    </>
                                  ),
                                })) ?? []),
                              ]}
                            />
                          )} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {validationWarnings.length > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
                {validationWarnings.map((w) => (
                  <p key={w} className="text-xs text-amber-700 dark:text-amber-500 flex items-start gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-[1px]" />
                    {w}
                  </p>
                ))}
              </div>
            )}

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

            <DialogFooter>
              <Button type="button" variant="outline" disabled={isSaving} onClick={() => changeDialogOpen(false)}>Batal</Button>
              <Button type="submit" disabled={!canSave || isSaving}>
                {isSaving ? "Memproses..." : editItem ? "Simpan" : autoGenerate ? "Simpan & Buat Tagihan" : "Simpan Tarif"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <TarifMassalDialog open={massalOpen} onOpenChange={setMassalOpen} />

      <ConfirmDialog
        open={broadConfirmOpen}
        onOpenChange={setBroadConfirmOpen}
        title="Generate untuk Semua Siswa Aktif?"
        description="Tidak ada siswa, kelas, atau lembaga yang dipilih — tagihan akan dibuat untuk SEMUA siswa aktif pada Tahun Ajaran terpilih. Periode mendatang baru dijurnal saat jatuh tempo. Lanjutkan?"
        onConfirm={() => { setBroadConfirmOpen(false); if (pendingSaveData) void performSave(pendingSaveData); }}
      />

      <Dialog open={!!nonaktifItem} onOpenChange={(open) => { if (!open) closeNonaktif(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nonaktifkan Override Tarif</DialogTitle>
          </DialogHeader>

          {nonaktifItem && (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1.5">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Jenis Pembayaran</span>
                  <span className="font-medium text-right">{nonaktifItem.jenis?.nama || "-"}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Scope</span>
                  <span className="text-right">
                    {nonaktifItem.siswa
                      ? `${nonaktifItem.siswa.nama} (${nonaktifItem.siswa.nis || "-"})`
                      : nonaktifItem.kelas
                        ? `Kelas ${nonaktifItem.kelas.nama}`
                        : nonaktifItem.angkatan
                          ? nonaktifItem.angkatan.nama
                          : "Umum"}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Tahun Buku</span>
                  <span className="text-right">{nonaktifItem.tahun_ajaran?.nama || "Semua periode"}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Nominal Khusus</span>
                  <span className="font-semibold text-right">{formatRupiah(Number(nonaktifItem.nominal || 0))}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Nominal Default Jenis</span>
                  <span className="text-right">
                    {Number(nonaktifItem.jenis?.nominal || 0) > 0
                      ? formatRupiah(Number(nonaktifItem.jenis.nominal))
                      : "Tidak ada"}
                  </span>
                </div>
              </div>

              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs leading-relaxed">
                  Override ini hanya akan <strong>dinonaktifkan</strong>, bukan dihapus permanen.
                  Tagihan, pembayaran, dan jurnal yang sudah terbentuk <strong>tidak berubah</strong>.
                  Generate berikutnya akan mencari aturan tarif prioritas berikutnya, lalu nominal default jenis jika tidak ada override lain.
                </AlertDescription>
              </Alert>

              <div>
                <Label htmlFor="alasan-nonaktif-tarif">Alasan penonaktifan *</Label>
                <Textarea
                  id="alasan-nonaktif-tarif"
                  value={nonaktifAlasan}
                  onChange={(e) => setNonaktifAlasan(e.target.value)}
                  placeholder="Contoh: salah input override; siswa kembali mengikuti tarif default"
                  className="mt-1"
                  disabled={nonaktifMut.isPending}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Alasan, waktu, dan pengguna akan dicatat di Audit Trail.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeNonaktif} disabled={nonaktifMut.isPending}>
              Batal
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmNonaktif()}
              disabled={nonaktifAlasan.trim().length < 3 || nonaktifMut.isPending}
            >
              {nonaktifMut.isPending ? "Memproses..." : "Nonaktifkan Override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
