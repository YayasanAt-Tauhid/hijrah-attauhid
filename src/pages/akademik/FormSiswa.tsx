import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "@/lib/router-compat";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useSiswaDetail, useSiswaDetailOrangtua, useCreateSiswa, useUpdateSiswa } from "@/hooks/useSiswa";
import { useAngkatan, useDepartemenPendidikan, useTingkat, useKelas, useTahunAjaran } from "@/hooks/useAkademikData";
import { generateNis } from "@/server/nis";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { FileUpload } from "@/components/shared/FileUpload";
import { FormSection } from "@/components/shared/FormSection";
import { SpmbDocumentUpload } from "@/components/akademik/SpmbDocumentUpload";
import { SpmbFieldVerification } from "@/components/akademik/SpmbFieldVerification";
import { fetchSpmbVerificationState, saveSpmbVerificationFields, spmbVerificationQueryKey, useSpmbVerificationState } from "@/hooks/useSpmbVerification";
import { ArrowLeft, Save, Wand2, Pencil, Loader2 } from "lucide-react";

const optionalString = z.string().optional();
const siswaSchema = z.object({
  dokumen_kk_path: optionalString,
  dokumen_akta_path: optionalString,
  dokumen_rapor_path: optionalString,
  dokumen_ijazah_path: optionalString,
  nis: optionalString,
  nama: z.string().min(2, "Nama minimal 2 karakter"),
  jenis_kelamin: z.enum(["L", "P"], { required_error: "Pilih jenis kelamin" }),
  tempat_lahir: optionalString,
  tanggal_lahir: optionalString,
  agama: optionalString,
  alamat: optionalString,
  telepon: optionalString,
  email: z.string().email("Email tidak valid").optional().or(z.literal("")),
  foto_url: optionalString,
  status: z.string().default("aktif"),
  angkatan_id: optionalString,
  departemen_id: z.string().uuid("Lembaga wajib dipilih"),
  tingkat_id: optionalString,
  kelas_id: optionalString,
  tahun_ajaran_id: optionalString,
  spmb_tahun_ajaran_id: optionalString,
  jenis_pendaftaran: optionalString,
  nik: optionalString,
  no_kk: optionalString,
  kategori: optionalString,
  status_asrama: optionalString,
  anak_ke: optionalString,
  jumlah_bersaudara: optionalString,
  tinggi_badan_cm: optionalString,
  berat_badan_kg: optionalString,
  lingkar_kepala_cm: optionalString,
  ukuran_baju: optionalString,
  penyakit_pernah_diderita: optionalString,
  jarak_rumah_km: optionalString,
  waktu_perjalanan_menit: optionalString,
  transportasi: optionalString,
  nama_ayah: optionalString,
  nik_ayah: optionalString,
  tempat_lahir_ayah: optionalString,
  tanggal_lahir_ayah: optionalString,
  pendidikan_ayah: optionalString,
  pekerjaan_ayah: optionalString,
  penghasilan_ayah: optionalString,
  telepon_ayah: optionalString,
  alamat_ayah: optionalString,
  nama_ibu: optionalString,
  nik_ibu: optionalString,
  tempat_lahir_ibu: optionalString,
  tanggal_lahir_ibu: optionalString,
  pendidikan_ibu: optionalString,
  pekerjaan_ibu: optionalString,
  penghasilan_ibu: optionalString,
  telepon_ibu: optionalString,
  alamat_ibu: optionalString,
  asal_sekolah: optionalString,
  alamat_sekolah_asal: optionalString,
  kabupaten_sekolah_asal: optionalString,
  kecamatan_sekolah_asal: optionalString,
  kelurahan_sekolah_asal: optionalString,
  kelas_terakhir: optionalString,
  alasan_pindah: optionalString,
  kemampuan_iqro: optionalString,
  membaca_latin: optionalString,
  menulis_latin: optionalString,
  hafalan_quran: optionalString,
});

type SiswaForm = z.infer<typeof siswaSchema>;
type Choice = { value: string; label: string };

const makeChoices = (values: string[]): Choice[] => values.map((value) => ({ value, label: value }));
const kategoriOptions = makeChoices(["MURID BARU", "MURID PINDAHAN"]);
const ukuranBajuOptions = makeChoices(["S", "M", "L", "XL", "XXL", "X3L", "X4L", "X5L"]);
const transportasiOptions = makeChoices(["Mobil Pribadi", "Sepeda Motor", "Mobil/Bus Antar Jemput", "Sepeda", "Jalan Kaki", "Lainnya"]);
const pekerjaanOptions = makeChoices(["PNS/TNI/POLRI", "KARYAWAN BUMN", "KARYAWAN SWASTA", "WIRASWASTA", "LAINNYA", "SUDAH MENINGGAL"]);
const latinOptions = makeChoices(["BAIK", "CUKUP", "KURANG"]);
const pendidikanOptions: Choice[] = [
  { value: "SD", label: "SD / Sederajat" }, { value: "SMP", label: "SMP / Sederajat" },
  { value: "SMA", label: "SMA / Sederajat" }, { value: "D3", label: "D3" },
  { value: "S1", label: "S1" }, { value: "S2", label: "S2" }, { value: "S3", label: "S3" },
];
const iqroOptions: Choice[] = [
  { value: "0", label: "Belum pernah belajar Iqro" }, { value: "1", label: "Iqro 1" },
  { value: "2", label: "Iqro 2" }, { value: "3", label: "Iqro 3" }, { value: "4", label: "Iqro 4" },
  { value: "5", label: "Iqro 5" }, { value: "6", label: "Iqro 6" }, { value: "7", label: "Sudah menamatkan Iqro" },
];
const hafalanOptions: Choice[] = [
  { value: "0", label: "Belum punya hafalan" }, { value: "1", label: "Kurang dari 1/2 juz" },
  { value: "2", label: "1/2 - 1 juz" }, { value: "3", label: "> 1 juz" },
];
const jenisPendaftaranOptions: Choice[] = [
  { value: "baru", label: "Murid Baru" }, { value: "pindahan", label: "Pindahan" }, { value: "alumni_internal", label: "Alumni Internal" },
];
const statusOptions: Choice[] = [
  { value: "calon", label: "Calon" }, { value: "diterima", label: "Diterima" }, { value: "aktif", label: "Aktif" },
  { value: "alumni", label: "Alumni" }, { value: "pindah", label: "Pindah" }, { value: "keluar", label: "Keluar" },
];
const jenisKelaminOptions: Choice[] = [{ value: "L", label: "Laki-laki" }, { value: "P", label: "Perempuan" }];
const asramaOptions: Choice[] = [{ value: "asrama", label: "Asrama" }, { value: "non_asrama", label: "Non Asrama" }];

function numberOrNull(value?: string): number | null {
  if (!value?.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function perluPilihanAsrama(dept?: { kode?: string | null; nama?: string | null }) {
  if (!dept) return false;
  const kode = (dept.kode || "").trim().toUpperCase();
  const nama = (dept.nama || "").trim().toUpperCase();
  return ["SMP", "SMA", "MTA"].includes(kode) || /(^|\s)(SMP|SMA|MTA)(\s|$)/.test(nama);
}

function TextField({ form, name, label, type = "text", placeholder, inputMode, onValueChange, after }: {
  form: UseFormReturn<SiswaForm>;
  name: keyof SiswaForm;
  label: string;
  type?: string;
  placeholder?: string;
  inputMode?: "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search";
  onValueChange?: (value: string) => void;
  after?: ReactNode;
}) {
  return (
    <FormField control={form.control} name={name as any} render={({ field }) => (
      <FormItem>
        <FormLabel>{label}</FormLabel>
        <FormControl>
          <Input
            type={type}
            placeholder={placeholder}
            inputMode={inputMode}
            {...field}
            onChange={(event) => {
              field.onChange(event);
              onValueChange?.(event.target.value);
            }}
          />
        </FormControl>
        <FormMessage />
        {after}
      </FormItem>
    )} />
  );
}

function TextAreaField({ form, name, label, placeholder, onValueChange, after }: {
  form: UseFormReturn<SiswaForm>;
  name: keyof SiswaForm;
  label: string;
  placeholder?: string;
  onValueChange?: (value: string) => void;
  after?: ReactNode;
}) {
  return (
    <FormField control={form.control} name={name as any} render={({ field }) => (
      <FormItem>
        <FormLabel>{label}</FormLabel>
        <FormControl>
          <Textarea
            placeholder={placeholder}
            {...field}
            onChange={(event) => {
              field.onChange(event);
              onValueChange?.(event.target.value);
            }}
          />
        </FormControl>
        <FormMessage />
        {after}
      </FormItem>
    )} />
  );
}

function SelectField({ form, name, label, options, placeholder = "Pilih", onValueChange, after }: {
  form: UseFormReturn<SiswaForm>;
  name: keyof SiswaForm;
  label: string;
  options: Choice[];
  placeholder?: string;
  onValueChange?: (value: string) => void;
  after?: ReactNode;
}) {
  return (
    <FormField control={form.control} name={name as any} render={({ field }) => (
      <FormItem>
        <FormLabel>{label}</FormLabel>
        <Select onValueChange={(value) => { field.onChange(value); onValueChange?.(value); }} value={field.value || ""}>
          <FormControl><SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger></FormControl>
          <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
        <FormMessage />
        {after}
      </FormItem>
    )} />
  );
}

export default function FormSiswa({ onSaved }: { onSaved?: () => void }) {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createSiswa = useCreateSiswa();
  const updateSiswa = useUpdateSiswa();
  const { data: siswa } = useSiswaDetail(id || "");
  const { data: detailRaw } = useSiswaDetailOrangtua(id || "");
  const detail = detailRaw as Record<string, any> | null | undefined;
  const { data: allAngkatanList = [] } = useAngkatan();
  const { data: departemenList = [] } = useDepartemenPendidikan();
  const { data: tahunAjaranList = [] } = useTahunAjaran();

  const [uploadsBusy, setUploadsBusy] = useState(0);
  const [nisMode, setNisMode] = useState<"otomatis" | "manual" | "ketik">(isEdit ? "manual" : "otomatis");
  const [savedSiswaId, setSavedSiswaId] = useState<string | null>(null);
  const [isGeneratingNis, setIsGeneratingNis] = useState(false);
  const [verificationDraft, setVerificationDraft] = useState<Record<string, boolean>>({});
  const [verificationSaving, setVerificationSaving] = useState(false);
  const verificationQuery = useSpmbVerificationState(isEdit ? id! : "");
  const verificationState = verificationQuery.data;

  const form = useForm<SiswaForm>({
    resolver: zodResolver(siswaSchema),
    defaultValues: { status: "aktif", agama: "Islam", jenis_pendaftaran: "baru" },
  });

  const watchDept = form.watch("departemen_id");
  const watchTingkat = form.watch("tingkat_id");
  const watchAngkatan = form.watch("angkatan_id");
  const watchKelas = form.watch("kelas_id");
  const { data: tingkatList = [] } = useTingkat(watchDept || null);
  const { data: kelasList = [] } = useKelas(watchTingkat);
  const angkatanList = allAngkatanList.filter((a: any) => !watchDept || a.departemen_id === watchDept);
  const selectedDept = departemenList.find((d: any) => d.id === watchDept) as any;
  const wajibAsrama = perluPilihanAsrama(selectedDept);
  const nisParamsComplete = !!(watchDept && watchAngkatan && watchKelas);

  useEffect(() => {
    if (!isEdit || !verificationState?.can_verify) return;
    setVerificationDraft(verificationState.checklist || {});
  }, [isEdit, verificationState?.version, verificationState?.can_verify]);

  const setVerificationChecked = (fieldKey: string, checked: boolean) => {
    setVerificationDraft((current) => ({ ...current, [fieldKey]: checked }));
  };

  const resetVerification = (fieldKey: string) => {
    if (!isEdit || !verificationState?.can_verify) return;
    setVerificationDraft((current) => current[fieldKey] === true ? { ...current, [fieldKey]: false } : current);
  };

  const verificationControl = (fieldKey: string) => {
    if (!isEdit || !verificationState?.can_verify) return null;
    const requirement = verificationState.requirements.find((item) => item.key === fieldKey);
    if (!requirement) return null;
    return (
      <SpmbFieldVerification
        fieldKey={fieldKey}
        checked={verificationDraft[fieldKey] === true}
        disabled={verificationSaving || updateSiswa.isPending}
        label={requirement.required ? "Sudah diperiksa" : "Sudah diperiksa (opsional)"}
        onCheckedChange={setVerificationChecked}
      />
    );
  };

  useEffect(() => {
    if (departemenList.length && !wajibAsrama && form.getValues("status_asrama")) form.setValue("status_asrama", "");
  }, [wajibAsrama, departemenList, form]);

  useEffect(() => {
    if (!isEdit || !siswa || detailRaw === undefined) return;
    const activeKelas = siswa.kelas_siswa?.find((ks) => ks.aktif);
    form.reset({
      dokumen_kk_path: detail?.dokumen_kk_path || "", dokumen_akta_path: detail?.dokumen_akta_path || "",
      dokumen_rapor_path: detail?.dokumen_rapor_path || "", dokumen_ijazah_path: detail?.dokumen_ijazah_path || "",
      nis: siswa.nis || "", nama: siswa.nama, jenis_kelamin: (siswa.jenis_kelamin as "L" | "P") || undefined,
      tempat_lahir: siswa.tempat_lahir || "", tanggal_lahir: siswa.tanggal_lahir || "", agama: siswa.agama || "Islam",
      alamat: siswa.alamat || "", telepon: siswa.telepon || "", email: siswa.email || "", foto_url: siswa.foto_url || "",
      status: siswa.status || "aktif", angkatan_id: siswa.angkatan_id || "",
      departemen_id: activeKelas?.kelas?.departemen?.id || (siswa as any).departemen_id || "",
      tingkat_id: activeKelas?.kelas?.tingkat?.id || "", kelas_id: activeKelas?.kelas?.id || "", tahun_ajaran_id: activeKelas?.tahun_ajaran?.id || "",
      spmb_tahun_ajaran_id: detail?.tahun_ajaran_id || "", jenis_pendaftaran: detail?.jenis_pendaftaran || "baru",
      nik: detail?.nik || "", no_kk: detail?.no_kk || "", kategori: detail?.kategori || "", status_asrama: detail?.status_asrama || "",
      anak_ke: detail?.anak_ke?.toString?.() || "", jumlah_bersaudara: detail?.jumlah_bersaudara?.toString?.() || "",
      tinggi_badan_cm: detail?.tinggi_badan_cm?.toString?.() || "", berat_badan_kg: detail?.berat_badan_kg?.toString?.() || "",
      lingkar_kepala_cm: detail?.lingkar_kepala_cm?.toString?.() || "", ukuran_baju: detail?.ukuran_baju || "",
      penyakit_pernah_diderita: detail?.penyakit_pernah_diderita || "", jarak_rumah_km: detail?.jarak_rumah_km?.toString?.() || "",
      waktu_perjalanan_menit: detail?.waktu_perjalanan_menit?.toString?.() || "", transportasi: detail?.transportasi || "",
      nama_ayah: detail?.nama_ayah || "", nik_ayah: detail?.nik_ayah || "", tempat_lahir_ayah: detail?.tempat_lahir_ayah || "",
      tanggal_lahir_ayah: detail?.tanggal_lahir_ayah || "", pendidikan_ayah: detail?.pendidikan_ayah || "", pekerjaan_ayah: detail?.pekerjaan_ayah || "",
      penghasilan_ayah: detail?.penghasilan_ayah?.toString?.() || "", telepon_ayah: detail?.telepon_ayah || detail?.telepon_ortu || "", alamat_ayah: detail?.alamat_ayah || detail?.alamat_ortu || "",
      nama_ibu: detail?.nama_ibu || "", nik_ibu: detail?.nik_ibu || "", tempat_lahir_ibu: detail?.tempat_lahir_ibu || "",
      tanggal_lahir_ibu: detail?.tanggal_lahir_ibu || "", pendidikan_ibu: detail?.pendidikan_ibu || "", pekerjaan_ibu: detail?.pekerjaan_ibu || "",
      penghasilan_ibu: detail?.penghasilan_ibu?.toString?.() || "", telepon_ibu: detail?.telepon_ibu || "", alamat_ibu: detail?.alamat_ibu || "",
      asal_sekolah: detail?.asal_sekolah || "", alamat_sekolah_asal: detail?.alamat_sekolah_asal || "",
      kabupaten_sekolah_asal: detail?.kabupaten_sekolah_asal || "", kecamatan_sekolah_asal: detail?.kecamatan_sekolah_asal || "",
      kelurahan_sekolah_asal: detail?.kelurahan_sekolah_asal || "", kelas_terakhir: detail?.kelas_terakhir || "", alasan_pindah: detail?.alasan_pindah || "",
      kemampuan_iqro: detail?.kemampuan_iqro || "", membaca_latin: detail?.membaca_latin || "", menulis_latin: detail?.menulis_latin || "", hafalan_quran: detail?.hafalan_quran || "",
    });
  }, [siswa, detail, isEdit, form]);

  const invokeGenerateNis = async (siswaId: string, deptId: string, angkatanId: string, kelasId: string) => {
    setIsGeneratingNis(true);
    try {
      const data = await generateNis({ data: { siswa_id: siswaId, departemen_id: deptId, angkatan_id: angkatanId, kelas_id: kelasId } });
      return data.nis;
    } finally {
      setIsGeneratingNis(false);
    }
  };

  const handleGenerateNisClick = async () => {
    const siswaId = isEdit ? id! : savedSiswaId;
    if (!siswaId || !watchDept || !watchAngkatan || !watchKelas) return;
    try {
      const nis = await invokeGenerateNis(siswaId, watchDept, watchAngkatan, watchKelas);
      form.setValue("nis", nis);
      toast.success("NIS berhasil dibuat: " + nis);
      queryClient.invalidateQueries({ queryKey: ["siswa"] });
    } catch (err: any) {
      toast.error(err.message || "Gagal generate NIS");
    }
  };

  const commitVerificationDraft = async () => {
    if (!isEdit || !id || !verificationState?.can_verify) return;
    setVerificationSaving(true);
    try {
      const latest = await fetchSpmbVerificationState(id);
      const draft = Object.keys(verificationDraft).length ? verificationDraft : (verificationState.checklist || {});
      const changes = Object.fromEntries(
        latest.requirements
          .map((item) => [item.key, draft[item.key] === true]),
      );
      const saved = await saveSpmbVerificationFields(id, changes, latest.version);
      setVerificationDraft(saved.checklist || {});
      queryClient.setQueryData(spmbVerificationQueryKey(id), saved);
    } finally {
      setVerificationSaving(false);
    }
  };

  const onSubmit = async (values: SiswaForm) => {
    if (uploadsBusy > 0) { toast.error("Tunggu upload dokumen selesai"); return; }
    if (values.kelas_id && !values.tahun_ajaran_id) { toast.error("Tahun ajaran wajib diisi untuk kelas"); return; }
    if (isEdit && ["calon", "diterima"].includes(siswa?.status || "") && values.status !== siswa?.status) {
      toast.error("Ubah status penerimaan melalui halaman SPMB"); return;
    }
    if (wajibAsrama && !values.status_asrama) {
      toast.error("Pilihan Asrama / Non Asrama wajib diisi untuk SMP, SMA, atau MTA");
      return;
    }

    const siswaData: Record<string, unknown> = {
      nama: values.nama, nis: values.nis || null, jenis_kelamin: values.jenis_kelamin,
      tempat_lahir: values.tempat_lahir || null, tanggal_lahir: values.tanggal_lahir || null,
      agama: values.agama || null, alamat: values.alamat || null, telepon: values.telepon || null,
      email: values.email || null, foto_url: values.foto_url || null, status: values.status,
      angkatan_id: values.angkatan_id || null, departemen_id: values.departemen_id || null,
    };

    const detailData: Record<string, unknown> = {
      dokumen_kk_path: values.dokumen_kk_path || null, dokumen_akta_path: values.dokumen_akta_path || null,
      dokumen_rapor_path: values.dokumen_rapor_path || null, dokumen_ijazah_path: values.dokumen_ijazah_path || null,
      tahun_ajaran_id: values.spmb_tahun_ajaran_id || null, jenis_pendaftaran: values.jenis_pendaftaran || null,
      nik: values.nik || null, no_kk: values.no_kk || null, kategori: values.kategori || null,
      status_asrama: wajibAsrama ? values.status_asrama || null : null,
      anak_ke: numberOrNull(values.anak_ke), jumlah_bersaudara: numberOrNull(values.jumlah_bersaudara),
      tinggi_badan_cm: numberOrNull(values.tinggi_badan_cm), berat_badan_kg: numberOrNull(values.berat_badan_kg),
      lingkar_kepala_cm: numberOrNull(values.lingkar_kepala_cm), ukuran_baju: values.ukuran_baju || null,
      penyakit_pernah_diderita: values.penyakit_pernah_diderita || null, jarak_rumah_km: numberOrNull(values.jarak_rumah_km),
      waktu_perjalanan_menit: numberOrNull(values.waktu_perjalanan_menit), transportasi: values.transportasi || null,
      nama_ayah: values.nama_ayah || null, nik_ayah: values.nik_ayah || null, tempat_lahir_ayah: values.tempat_lahir_ayah || null,
      tanggal_lahir_ayah: values.tanggal_lahir_ayah || null, pendidikan_ayah: values.pendidikan_ayah || null,
      pekerjaan_ayah: values.pekerjaan_ayah || null, penghasilan_ayah: numberOrNull(values.penghasilan_ayah),
      telepon_ayah: values.telepon_ayah || null, alamat_ayah: values.alamat_ayah || null,
      nama_ibu: values.nama_ibu || null, nik_ibu: values.nik_ibu || null, tempat_lahir_ibu: values.tempat_lahir_ibu || null,
      tanggal_lahir_ibu: values.tanggal_lahir_ibu || null, pendidikan_ibu: values.pendidikan_ibu || null,
      pekerjaan_ibu: values.pekerjaan_ibu || null, penghasilan_ibu: numberOrNull(values.penghasilan_ibu),
      telepon_ibu: values.telepon_ibu || null, alamat_ibu: values.alamat_ibu || null,
      telepon_ortu: values.telepon_ayah || values.telepon_ibu || null, alamat_ortu: values.alamat_ayah || values.alamat_ibu || null,
      asal_sekolah: values.asal_sekolah || null, alamat_sekolah_asal: values.alamat_sekolah_asal || null,
      kabupaten_sekolah_asal: values.kabupaten_sekolah_asal || null, kecamatan_sekolah_asal: values.kecamatan_sekolah_asal || null,
      kelurahan_sekolah_asal: values.kelurahan_sekolah_asal || null, kelas_terakhir: values.kelas_terakhir || null,
      alasan_pindah: values.alasan_pindah || null, kemampuan_iqro: values.kemampuan_iqro || null,
      membaca_latin: values.membaca_latin || null, menulis_latin: values.menulis_latin || null, hafalan_quran: values.hafalan_quran || null,
    };

    if (isEdit) {
      const kelasData = values.kelas_id && values.tahun_ajaran_id ? { kelas_id: values.kelas_id, tahun_ajaran_id: values.tahun_ajaran_id } : undefined;
      await updateSiswa.mutateAsync({ id: id!, siswa: siswaData, detail: detailData, kelas_siswa: kelasData });
      if (nisMode === "otomatis" && nisParamsComplete) {
        try {
          const nis = await invokeGenerateNis(id!, watchDept!, watchAngkatan!, watchKelas!);
          form.setValue("nis", nis);
        } catch (err: any) {
          toast.warning("Data tersimpan, tetapi NIS gagal dibuat: " + (err.message || ""));
        }
      }
      try {
        await commitVerificationDraft();
      } catch (err: any) {
        form.reset(values);
        await queryClient.invalidateQueries({ queryKey: spmbVerificationQueryKey(id!) });
        toast.error("Data siswa tersimpan, tetapi checklist belum tersimpan", {
          description: err?.message || "Periksa kembali checklist lalu tekan Simpan Perubahan lagi.",
        });
        return;
      }
      form.reset({ ...values, nis: form.getValues("nis") });
      onSaved?.();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["siswa", id!] }),
        queryClient.invalidateQueries({ queryKey: ["siswa_detail", id!] }),
        queryClient.invalidateQueries({ queryKey: ["siswa", "calon"] }),
      ]);
      toast.success("Perubahan data dan checklist pemeriksaan berhasil disimpan");
      return;
    }

    const kelasData = values.kelas_id && values.tahun_ajaran_id ? { kelas_id: values.kelas_id, tahun_ajaran_id: values.tahun_ajaran_id, aktif: true } : undefined;
    const result = await createSiswa.mutateAsync({ siswa: siswaData, detail: detailData, kelas_siswa: kelasData });
    const newSiswaId = (result as any)?.id;
    if (nisMode === "otomatis") {
      if (nisParamsComplete && newSiswaId) {
        try {
          const nis = await invokeGenerateNis(newSiswaId, watchDept!, watchAngkatan!, watchKelas!);
          toast.success("Siswa disimpan. NIS: " + nis);
        } catch (err: any) {
          toast.warning("Siswa disimpan, tapi NIS gagal dibuat: " + (err.message || ""));
        }
      }
      navigate("/akademik/siswa");
    } else if (nisMode === "ketik") {
      navigate("/akademik/siswa");
    } else if (newSiswaId) {
      setSavedSiswaId(newSiswaId);
      toast.success("Siswa disimpan. Klik Generate NIS setelah data akademik lengkap.");
    }
  };

  const canGenerateManual = isEdit ? nisParamsComplete : !!(savedSiswaId && nisParamsComplete);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4" /></Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{isEdit ? "Edit Data Siswa" : "Tambah Siswa Baru"}</h1>
          <p className="text-sm text-muted-foreground">{isEdit ? `Data master, akademik, dan SPMB ${siswa?.nama || ""}` : "Isi data siswa baru secara lengkap"}</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <Tabs defaultValue="pribadi" className="space-y-4">
            <TabsList className="h-auto flex-wrap justify-start">
              <TabsTrigger value="pribadi">Data Pribadi</TabsTrigger>
              <TabsTrigger value="akademik">Data Akademik</TabsTrigger>
              <TabsTrigger value="spmb">Data SPMB</TabsTrigger>
              <TabsTrigger value="orangtua">Data Orang Tua</TabsTrigger>
              <TabsTrigger value="sekolah">Sekolah & Kemampuan</TabsTrigger>
            </TabsList>

            <TabsContent value="pribadi">
              <Card>
                <CardContent className="pt-6 space-y-6">
                  <FormSection title="Foto Siswa">
                    <FileUpload bucket="avatars-siswa" accept="image/*" maxSize={2} value={form.watch("foto_url")} onChange={(url) => form.setValue("foto_url", url || "")} />
                  </FormSection>
                  <FormSection title="Identitas">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField control={form.control} name="nama" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nama Lengkap *</FormLabel>
                          <FormControl><Input placeholder="Nama lengkap siswa" {...field} onChange={(event) => { field.onChange(event); resetVerification("nama"); }} /></FormControl>
                          <FormMessage />
                          {verificationControl("nama")}
                        </FormItem>
                      )} />
                      <div className="space-y-2">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-sm font-medium">Mode NIS</span>
                          <div className="flex gap-1 ml-2 flex-wrap">
                            <Button type="button" size="sm" variant={nisMode === "otomatis" ? "default" : "outline"} onClick={() => setNisMode("otomatis")} className="h-7 text-xs px-2"><Wand2 className="h-3 w-3 mr-1" />Otomatis</Button>
                            <Button type="button" size="sm" variant={nisMode === "manual" ? "default" : "outline"} onClick={() => setNisMode("manual")} className="h-7 text-xs px-2"><Wand2 className="h-3 w-3 mr-1" />Generate</Button>
                            <Button type="button" size="sm" variant={nisMode === "ketik" ? "default" : "outline"} onClick={() => setNisMode("ketik")} className="h-7 text-xs px-2"><Pencil className="h-3 w-3 mr-1" />Ketik Manual</Button>
                          </div>
                        </div>
                        <FormField control={form.control} name="nis" render={({ field }) => (
                          <FormItem><FormLabel>NIS</FormLabel><FormControl><Input {...field} disabled={nisMode !== "ketik"} placeholder={nisMode === "otomatis" ? "Dibuat otomatis saat simpan" : nisMode === "manual" ? "Gunakan tombol Generate NIS" : "Ketik NIS"} /></FormControl><FormMessage /></FormItem>
                        )} />
                        {nisMode === "manual" && (
                          <Button type="button" size="sm" variant="outline" disabled={!canGenerateManual || isGeneratingNis} onClick={handleGenerateNisClick}>
                            {isGeneratingNis ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wand2 className="h-3 w-3 mr-1" />}Generate NIS
                          </Button>
                        )}
                      </div>
                      <SelectField form={form} name="jenis_kelamin" label="Jenis Kelamin *" options={jenisKelaminOptions} onValueChange={() => resetVerification("jenis_kelamin")} after={verificationControl("jenis_kelamin")} />
                      <TextField form={form} name="tempat_lahir" label="Tempat Lahir" onValueChange={() => resetVerification("tempat_lahir")} after={verificationControl("tempat_lahir")} />
                      <TextField form={form} name="tanggal_lahir" label="Tanggal Lahir" type="date" onValueChange={() => resetVerification("tanggal_lahir")} after={verificationControl("tanggal_lahir")} />
                      <TextField form={form} name="telepon" label="No. HP Siswa / Pendaftar" inputMode="tel" onValueChange={() => resetVerification("telepon")} after={verificationControl("telepon")} />
                      <TextField form={form} name="email" label="Email" type="email" />
                    </div>
                    <TextAreaField form={form} name="alamat" label="Alamat Rumah" onValueChange={() => resetVerification("alamat")} after={verificationControl("alamat")} />
                  </FormSection>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="akademik">
              <Card>
                <CardContent className="pt-6">
                  <FormSection title="Data Akademik">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField control={form.control} name="departemen_id" render={({ field }) => (
                        <FormItem><FormLabel>Lembaga / Departemen</FormLabel><Select onValueChange={(v) => { field.onChange(v); form.setValue("tingkat_id", ""); form.setValue("kelas_id", ""); form.setValue("angkatan_id", ""); resetVerification("departemen_id"); resetVerification("angkatan_id"); }} value={field.value || ""}><FormControl><SelectTrigger><SelectValue placeholder="Pilih lembaga" /></SelectTrigger></FormControl><SelectContent>{departemenList.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.nama}</SelectItem>)}</SelectContent></Select><FormMessage />{verificationControl("departemen_id")}</FormItem>
                      )} />
                      <FormField control={form.control} name="angkatan_id" render={({ field }) => (
                        <FormItem><FormLabel>Angkatan</FormLabel><Select onValueChange={(value) => { field.onChange(value); resetVerification("angkatan_id"); }} value={field.value || ""} disabled={!watchDept}><FormControl><SelectTrigger><SelectValue placeholder="Pilih angkatan" /></SelectTrigger></FormControl><SelectContent>{angkatanList.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.nama}</SelectItem>)}</SelectContent></Select><FormMessage />{verificationControl("angkatan_id")}</FormItem>
                      )} />
                      <FormField control={form.control} name="tingkat_id" render={({ field }) => (
                        <FormItem><FormLabel>Tingkat</FormLabel><Select onValueChange={(v) => { field.onChange(v); form.setValue("kelas_id", ""); }} value={field.value || ""} disabled={!watchDept}><FormControl><SelectTrigger><SelectValue placeholder="Pilih tingkat" /></SelectTrigger></FormControl><SelectContent>{tingkatList.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.nama}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="kelas_id" render={({ field }) => (
                        <FormItem><FormLabel>Kelas</FormLabel><Select onValueChange={field.onChange} value={field.value || ""} disabled={!watchTingkat}><FormControl><SelectTrigger><SelectValue placeholder="Pilih kelas" /></SelectTrigger></FormControl><SelectContent>{kelasList.map((k: any) => <SelectItem key={k.id} value={k.id}>{k.nama}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="tahun_ajaran_id" render={({ field }) => (
                        <FormItem><FormLabel>Tahun Ajaran Kelas</FormLabel><Select onValueChange={field.onChange} value={field.value || ""}><FormControl><SelectTrigger><SelectValue placeholder="Pilih tahun ajaran" /></SelectTrigger></FormControl><SelectContent>{tahunAjaranList.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.nama} {t.aktif ? "(Aktif)" : ""}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>
                      )} />
                      <SelectField form={form} name="status" label="Status Siswa" options={isEdit && ["calon", "diterima"].includes(siswa?.status || "") ? statusOptions.filter((o) => o.value === siswa?.status) : statusOptions.filter((o) => o.value !== "diterima")} />
                    </div>
                  </FormSection>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="spmb">
              <Card className="mb-4"><CardContent className="pt-6 space-y-4">
                <p className="font-medium">Dokumen SPMB</p>
                {isEdit && verificationState?.can_verify && (
                  <p className="text-sm text-muted-foreground">Centang “Sudah diperiksa” setelah memeriksa nilai atau dokumen. Checklist bertanda opsional boleh dibiarkan kosong dan tidak menghalangi Verifikasi Data SPMB. Checklist disimpan bersama tombol Simpan Perubahan.</p>
                )}
                {([ ["kk", "Kartu Keluarga (wajib)"], ["akta", "Akta Kelahiran (wajib)"], ["rapor", "Rapor"], ["ijazah", "Ijazah/SKHUN (bila sudah ada)"] ] as const).map(([kind, label]) => {
                  const name = `dokumen_${kind}_path` as keyof SiswaForm;
                  const verificationKey = String(name);
                  return (
                    <div key={kind} className="space-y-2">
                      <SpmbDocumentUpload
                        kind={kind}
                        label={label}
                        value={form.watch(name)}
                        onChange={(path) => {
                          form.setValue(name, path, { shouldDirty: true });
                          resetVerification(verificationKey);
                        }}
                        onBusy={(busy) => setUploadsBusy((n) => n + (busy ? 1 : -1))}
                      />
                      {verificationControl(verificationKey)}
                    </div>
                  );
                })}
              </CardContent></Card>
              <Card>
                <CardContent className="pt-6 space-y-6">
                  <FormSection title="Data Pendaftaran SPMB">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField control={form.control} name="spmb_tahun_ajaran_id" render={({ field }) => (
                        <FormItem><FormLabel>Periode Tahun Ajaran SPMB</FormLabel><Select onValueChange={(value) => { field.onChange(value); resetVerification("tahun_ajaran_id"); }} value={field.value || ""}><FormControl><SelectTrigger><SelectValue placeholder="Pilih periode" /></SelectTrigger></FormControl><SelectContent>{tahunAjaranList.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.nama} {t.aktif ? "(Aktif)" : ""}</SelectItem>)}</SelectContent></Select><FormMessage />{verificationControl("tahun_ajaran_id")}</FormItem>
                      )} />
                      <SelectField form={form} name="jenis_pendaftaran" label="Jenis Pendaftaran" options={jenisPendaftaranOptions} onValueChange={() => resetVerification("jenis_pendaftaran")} after={verificationControl("jenis_pendaftaran")} />
                      <TextField form={form} name="nik" label="NIK" inputMode="numeric" onValueChange={() => resetVerification("nik")} after={verificationControl("nik")} />
                      <TextField form={form} name="no_kk" label="No. KK" inputMode="numeric" onValueChange={() => resetVerification("no_kk")} after={verificationControl("no_kk")} />
                      <SelectField form={form} name="kategori" label="Kategori" options={kategoriOptions} onValueChange={() => resetVerification("kategori")} after={verificationControl("kategori")} />
                      {wajibAsrama && <SelectField form={form} name="status_asrama" label="Asrama / Non Asrama *" options={asramaOptions} onValueChange={() => resetVerification("status_asrama")} after={verificationControl("status_asrama")} />}
                      <TextField form={form} name="anak_ke" label="Anak ke" type="number" onValueChange={() => resetVerification("anak_ke")} after={verificationControl("anak_ke")} />
                      <TextField form={form} name="jumlah_bersaudara" label="Dari Bersaudara" type="number" onValueChange={() => resetVerification("jumlah_bersaudara")} after={verificationControl("jumlah_bersaudara")} />
                      <TextField form={form} name="tinggi_badan_cm" label="Tinggi Badan (cm)" type="number" onValueChange={() => resetVerification("tinggi_badan_cm")} after={verificationControl("tinggi_badan_cm")} />
                      <TextField form={form} name="berat_badan_kg" label="Berat Badan (kg)" type="number" onValueChange={() => resetVerification("berat_badan_kg")} after={verificationControl("berat_badan_kg")} />
                      <TextField form={form} name="lingkar_kepala_cm" label="Lingkar Kepala (cm)" type="number" onValueChange={() => resetVerification("lingkar_kepala_cm")} after={verificationControl("lingkar_kepala_cm")} />
                      <SelectField form={form} name="ukuran_baju" label="Ukuran Baju" options={ukuranBajuOptions} onValueChange={() => resetVerification("ukuran_baju")} after={verificationControl("ukuran_baju")} />
                      <TextField form={form} name="jarak_rumah_km" label="Jarak Rumah ke Sekolah (km)" type="number" onValueChange={() => resetVerification("jarak_rumah_km")} after={verificationControl("jarak_rumah_km")} />
                      <TextField form={form} name="waktu_perjalanan_menit" label="Waktu Perjalanan (menit)" type="number" onValueChange={() => resetVerification("waktu_perjalanan_menit")} after={verificationControl("waktu_perjalanan_menit")} />
                      <SelectField form={form} name="transportasi" label="Transportasi" options={transportasiOptions} onValueChange={() => resetVerification("transportasi")} after={verificationControl("transportasi")} />
                    </div>
                    <TextAreaField form={form} name="penyakit_pernah_diderita" label="Penyakit yang Pernah Diderita" placeholder="Kosongkan jika tidak ada" onValueChange={() => resetVerification("penyakit_pernah_diderita")} after={verificationControl("penyakit_pernah_diderita")} />
                  </FormSection>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="orangtua">
              <div className="grid gap-4 xl:grid-cols-2">
                <Card>
                  <CardContent className="pt-6">
                    <FormSection title="Data Ayah">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <TextField form={form} name="nik_ayah" label="NIK Ayah" inputMode="numeric" onValueChange={() => resetVerification("nik_ayah")} after={verificationControl("nik_ayah")} />
                        <TextField form={form} name="nama_ayah" label="Nama Ayah" onValueChange={() => resetVerification("nama_ayah")} after={verificationControl("nama_ayah")} />
                        <TextField form={form} name="tempat_lahir_ayah" label="Tempat Lahir" onValueChange={() => resetVerification("tempat_lahir_ayah")} after={verificationControl("tempat_lahir_ayah")} />
                        <TextField form={form} name="tanggal_lahir_ayah" label="Tanggal Lahir" type="date" onValueChange={() => resetVerification("tanggal_lahir_ayah")} after={verificationControl("tanggal_lahir_ayah")} />
                        <SelectField form={form} name="pendidikan_ayah" label="Pendidikan Terakhir" options={pendidikanOptions} onValueChange={() => resetVerification("pendidikan_ayah")} after={verificationControl("pendidikan_ayah")} />
                        <SelectField form={form} name="pekerjaan_ayah" label="Pekerjaan" options={pekerjaanOptions} onValueChange={() => resetVerification("pekerjaan_ayah")} after={verificationControl("pekerjaan_ayah")} />
                        <TextField form={form} name="penghasilan_ayah" label="Penghasilan (Rp)" type="number" onValueChange={() => resetVerification("penghasilan_ayah")} after={verificationControl("penghasilan_ayah")} />
                        <TextField form={form} name="telepon_ayah" label="No. HP / WA" inputMode="tel" onValueChange={() => resetVerification("telepon_ayah")} after={verificationControl("telepon_ayah")} />
                      </div>
                      <TextAreaField form={form} name="alamat_ayah" label="Alamat Ayah" onValueChange={() => resetVerification("alamat_ayah")} after={verificationControl("alamat_ayah")} />
                    </FormSection>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <FormSection title="Data Ibu">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <TextField form={form} name="nik_ibu" label="NIK Ibu" inputMode="numeric" onValueChange={() => resetVerification("nik_ibu")} after={verificationControl("nik_ibu")} />
                        <TextField form={form} name="nama_ibu" label="Nama Ibu" onValueChange={() => resetVerification("nama_ibu")} after={verificationControl("nama_ibu")} />
                        <TextField form={form} name="tempat_lahir_ibu" label="Tempat Lahir" onValueChange={() => resetVerification("tempat_lahir_ibu")} after={verificationControl("tempat_lahir_ibu")} />
                        <TextField form={form} name="tanggal_lahir_ibu" label="Tanggal Lahir" type="date" onValueChange={() => resetVerification("tanggal_lahir_ibu")} after={verificationControl("tanggal_lahir_ibu")} />
                        <SelectField form={form} name="pendidikan_ibu" label="Pendidikan Terakhir" options={pendidikanOptions} onValueChange={() => resetVerification("pendidikan_ibu")} after={verificationControl("pendidikan_ibu")} />
                        <SelectField form={form} name="pekerjaan_ibu" label="Pekerjaan" options={pekerjaanOptions} onValueChange={() => resetVerification("pekerjaan_ibu")} after={verificationControl("pekerjaan_ibu")} />
                        <TextField form={form} name="penghasilan_ibu" label="Penghasilan (Rp)" type="number" onValueChange={() => resetVerification("penghasilan_ibu")} after={verificationControl("penghasilan_ibu")} />
                        <TextField form={form} name="telepon_ibu" label="No. HP / WA" inputMode="tel" onValueChange={() => resetVerification("telepon_ibu")} after={verificationControl("telepon_ibu")} />
                      </div>
                      <TextAreaField form={form} name="alamat_ibu" label="Alamat Ibu" onValueChange={() => resetVerification("alamat_ibu")} after={verificationControl("alamat_ibu")} />
                    </FormSection>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="sekolah">
              <Card>
                <CardContent className="pt-6 space-y-6">
                  <FormSection title="Data Sekolah Asal">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <TextField form={form} name="asal_sekolah" label="Nama Sekolah Asal" onValueChange={() => resetVerification("asal_sekolah")} after={verificationControl("asal_sekolah")} />
                      <TextField form={form} name="kelas_terakhir" label="Kelas Terakhir" onValueChange={() => resetVerification("kelas_terakhir")} after={verificationControl("kelas_terakhir")} />
                      <TextField form={form} name="kabupaten_sekolah_asal" label="Kabupaten / Kota" onValueChange={() => resetVerification("kabupaten_sekolah_asal")} after={verificationControl("kabupaten_sekolah_asal")} />
                      <TextField form={form} name="kecamatan_sekolah_asal" label="Kecamatan" onValueChange={() => resetVerification("kecamatan_sekolah_asal")} after={verificationControl("kecamatan_sekolah_asal")} />
                      <TextField form={form} name="kelurahan_sekolah_asal" label="Desa / Kelurahan" onValueChange={() => resetVerification("kelurahan_sekolah_asal")} after={verificationControl("kelurahan_sekolah_asal")} />
                    </div>
                    <TextAreaField form={form} name="alamat_sekolah_asal" label="Alamat Sekolah" onValueChange={() => resetVerification("alamat_sekolah_asal")} after={verificationControl("alamat_sekolah_asal")} />
                    <TextAreaField form={form} name="alasan_pindah" label="Alasan Pindah" onValueChange={() => resetVerification("alasan_pindah")} after={verificationControl("alasan_pindah")} />
                  </FormSection>
                  <FormSection title="Kemampuan Dasar Siswa">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <SelectField form={form} name="kemampuan_iqro" label="Kemampuan Dasar (Iqro)" options={iqroOptions} onValueChange={() => resetVerification("kemampuan_iqro")} after={verificationControl("kemampuan_iqro")} />
                      <SelectField form={form} name="membaca_latin" label="Membaca Latin" options={latinOptions} onValueChange={() => resetVerification("membaca_latin")} after={verificationControl("membaca_latin")} />
                      <SelectField form={form} name="menulis_latin" label="Menulis Latin" options={latinOptions} onValueChange={() => resetVerification("menulis_latin")} after={verificationControl("menulis_latin")} />
                      <SelectField form={form} name="hafalan_quran" label="Hafalan Qur'an" options={hafalanOptions} onValueChange={() => resetVerification("hafalan_quran")} after={verificationControl("hafalan_quran")} />
                    </div>
                  </FormSection>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <div className="sticky bottom-0 bg-background border-t py-4 mt-6 flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => navigate(-1)}>Batal</Button>
            <Button type="submit" disabled={uploadsBusy > 0 || createSiswa.isPending || updateSiswa.isPending || isGeneratingNis || verificationSaving}>
              {verificationSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}{isEdit ? "Simpan Perubahan" : "Simpan Siswa"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
