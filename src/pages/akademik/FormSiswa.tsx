import { useEffect, useState } from "react";
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
import { ArrowLeft, Save, Wand2, Pencil, Loader2 } from "lucide-react";

const optionalString = z.string().optional();

const siswaSchema = z.object({
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
  departemen_id: optionalString,
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

type SelectOption = string | readonly [string, string];

const agamaOptions = ["Islam", "Kristen", "Katolik", "Hindu", "Buddha", "Konghucu"];
const kategoriOptions = ["MURID BARU", "MURID PINDAHAN"];
const ukuranBajuOptions = ["S", "M", "L", "XL", "XXL", "X3L", "X4L", "X5L"];
const transportasiOptions = ["Mobil Pribadi", "Sepeda Motor", "Mobil/Bus Antar Jemput", "Sepeda", "Jalan Kaki", "Lainnya"];
const pendidikanOptions: SelectOption[] = [
  ["SD", "SD / Sederajat"], ["SMP", "SMP / Sederajat"], ["SMA", "SMA / Sederajat"],
  ["D3", "D3"], ["S1", "S1"], ["S2", "S2"], ["S3", "S3"],
];
const pekerjaanOptions = ["PNS/TNI/POLRI", "KARYAWAN BUMN", "KARYAWAN SWASTA", "WIRASWASTA", "LAINNYA", "SUDAH MENINGGAL"];
const iqroOptions: SelectOption[] = [
  ["0", "Belum pernah belajar Iqro"], ["1", "Iqro 1"], ["2", "Iqro 2"], ["3", "Iqro 3"],
  ["4", "Iqro 4"], ["5", "Iqro 5"], ["6", "Iqro 6"], ["7", "Sudah menamatkan Iqro"],
];
const latinOptions = ["BAIK", "CUKUP", "KURANG"];
const hafalanOptions: SelectOption[] = [
  ["0", "Belum punya hafalan"], ["1", "Kurang dari 1/2 juz"], ["2", "1/2 - 1 juz"], ["3", "> 1 juz"],
];

function optionValue(option: SelectOption) {
  return typeof option === "string" ? option : option[0];
}

function optionLabel(option: SelectOption) {
  return typeof option === "string" ? option : option[1];
}

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

function TextField({ form, name, label, type = "text", placeholder, inputMode }: {
  form: UseFormReturn<SiswaForm>;
  name: keyof SiswaForm;
  label: string;
  type?: string;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <FormField control={form.control} name={name as any} render={({ field }) => (
      <FormItem>
        <FormLabel>{label}</FormLabel>
        <FormControl><Input type={type} placeholder={placeholder} inputMode={inputMode} {...field} /></FormControl>
        <FormMessage />
      </FormItem>
    )} />
  );
}

function TextAreaField({ form, name, label, placeholder }: {
  form: UseFormReturn<SiswaForm>;
  name: keyof SiswaForm;
  label: string;
  placeholder?: string;
}) {
  return (
    <FormField control={form.control} name={name as any} render={({ field }) => (
      <FormItem>
        <FormLabel>{label}</FormLabel>
        <FormControl><Textarea placeholder={placeholder} {...field} /></FormControl>
        <FormMessage />
      </FormItem>
    )} />
  );
}

function SelectField({ form, name, label, options, placeholder = "Pilih" }: {
  form: UseFormReturn<SiswaForm>;
  name: keyof SiswaForm;
  label: string;
  options: SelectOption[];
  placeholder?: string;
}) {
  return (
    <FormField control={form.control} name={name as any} render={({ field }) => (
      <FormItem>
        <FormLabel>{label}</FormLabel>
        <Select onValueChange={field.onChange} value={field.value || ""}>
          <FormControl><SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger></FormControl>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={optionValue(option)} value={optionValue(option)}>{optionLabel(option)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FormMessage />
      </FormItem>
    )} />
  );
}

export default function FormSiswa() {
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

  const [nisMode, setNisMode] = useState<"otomatis" | "manual" | "ketik">(isEdit ? "manual" : "otomatis");
  const [savedSiswaId, setSavedSiswaId] = useState<string | null>(null);
  const [isGeneratingNis, setIsGeneratingNis] = useState(false);

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
    if (!wajibAsrama && form.getValues("status_asrama")) form.setValue("status_asrama", "");
  }, [wajibAsrama, form]);

  useEffect(() => {
    if (!isEdit || !siswa) return;
    const activeKelas = siswa.kelas_siswa?.find((ks) => ks.aktif);
    form.reset({
      nis: siswa.nis || "",
      nama: siswa.nama,
      jenis_kelamin: (siswa.jenis_kelamin as "L" | "P") || undefined,
      tempat_lahir: siswa.tempat_lahir || "",
      tanggal_lahir: siswa.tanggal_lahir || "",
      agama: siswa.agama || "Islam",
      alamat: siswa.alamat || "",
      telepon: siswa.telepon || "",
      email: siswa.email || "",
      foto_url: siswa.foto_url || "",
      status: siswa.status || "aktif",
      angkatan_id: siswa.angkatan_id || "",
      departemen_id: activeKelas?.kelas?.departemen?.id || (siswa as any).departemen_id || "",
      tingkat_id: activeKelas?.kelas?.tingkat?.id || "",
      kelas_id: activeKelas?.kelas?.id || "",
      tahun_ajaran_id: activeKelas?.tahun_ajaran?.id || "",

      spmb_tahun_ajaran_id: detail?.tahun_ajaran_id || "",
      jenis_pendaftaran: detail?.jenis_pendaftaran || "baru",
      nik: detail?.nik || "",
      no_kk: detail?.no_kk || "",
      kategori: detail?.kategori || "",
      status_asrama: detail?.status_asrama || "",
      anak_ke: detail?.anak_ke?.toString?.() || "",
      jumlah_bersaudara: detail?.jumlah_bersaudara?.toString?.() || "",
      tinggi_badan_cm: detail?.tinggi_badan_cm?.toString?.() || "",
      berat_badan_kg: detail?.berat_badan_kg?.toString?.() || "",
      lingkar_kepala_cm: detail?.lingkar_kepala_cm?.toString?.() || "",
      ukuran_baju: detail?.ukuran_baju || "",
      penyakit_pernah_diderita: detail?.penyakit_pernah_diderita || "",
      jarak_rumah_km: detail?.jarak_rumah_km?.toString?.() || "",
      waktu_perjalanan_menit: detail?.waktu_perjalanan_menit?.toString?.() || "",
      transportasi: detail?.transportasi || "",

      nama_ayah: detail?.nama_ayah || "",
      nik_ayah: detail?.nik_ayah || "",
      tempat_lahir_ayah: detail?.tempat_lahir_ayah || "",
      tanggal_lahir_ayah: detail?.tanggal_lahir_ayah || "",
      pendidikan_ayah: detail?.pendidikan_ayah || "",
      pekerjaan_ayah: detail?.pekerjaan_ayah || "",
      penghasilan_ayah: detail?.penghasilan_ayah?.toString?.() || "",
      telepon_ayah: detail?.telepon_ayah || detail?.telepon_ortu || "",
      alamat_ayah: detail?.alamat_ayah || detail?.alamat_ortu || "",

      nama_ibu: detail?.nama_ibu || "",
      nik_ibu: detail?.nik_ibu || "",
      tempat_lahir_ibu: detail?.tempat_lahir_ibu || "",
      tanggal_lahir_ibu: detail?.tanggal_lahir_ibu || "",
      pendidikan_ibu: detail?.pendidikan_ibu || "",
      pekerjaan_ibu: detail?.pekerjaan_ibu || "",
      penghasilan_ibu: detail?.penghasilan_ibu?.toString?.() || "",
      telepon_ibu: detail?.telepon_ibu || "",
      alamat_ibu: detail?.alamat_ibu || "",

      asal_sekolah: detail?.asal_sekolah || "",
      alamat_sekolah_asal: detail?.alamat_sekolah_asal || "",
      kabupaten_sekolah_asal: detail?.kabupaten_sekolah_asal || "",
      kecamatan_sekolah_asal: detail?.kecamatan_sekolah_asal || "",
      kelurahan_sekolah_asal: detail?.kelurahan_sekolah_asal || "",
      kelas_terakhir: detail?.kelas_terakhir || "",
      alasan_pindah: detail?.alasan_pindah || "",

      kemampuan_iqro: detail?.kemampuan_iqro || "",
      membaca_latin: detail?.membaca_latin || "",
      menulis_latin: detail?.menulis_latin || "",
      hafalan_quran: detail?.hafalan_quran || "",
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

  const onSubmit = async (values: SiswaForm) => {
    if (wajibAsrama && !values.status_asrama) {
      toast.error("Pilihan Asrama / Non Asrama wajib diisi untuk SMP, SMA, atau MTA");
      return;
    }

    const siswaData: Record<string, unknown> = {
      nama: values.nama,
      nis: values.nis || null,
      jenis_kelamin: values.jenis_kelamin,
      tempat_lahir: values.tempat_lahir || null,
      tanggal_lahir: values.tanggal_lahir || null,
      agama: values.agama || null,
      alamat: values.alamat || null,
      telepon: values.telepon || null,
      email: values.email || null,
      foto_url: values.foto_url || null,
      status: values.status,
      angkatan_id: values.angkatan_id || null,
      departemen_id: values.departemen_id || null,
    };

    const detailData: Record<string, unknown> = {
      tahun_ajaran_id: values.spmb_tahun_ajaran_id || null,
      jenis_pendaftaran: values.jenis_pendaftaran || null,
      nik: values.nik || null,
      no_kk: values.no_kk || null,
      kategori: values.kategori || null,
      status_asrama: wajibAsrama ? values.status_asrama || null : null,
      anak_ke: numberOrNull(values.anak_ke),
      jumlah_bersaudara: numberOrNull(values.jumlah_bersaudara),
      tinggi_badan_cm: numberOrNull(values.tinggi_badan_cm),
      berat_badan_kg: numberOrNull(values.berat_badan_kg),
      lingkar_kepala_cm: numberOrNull(values.lingkar_kepala_cm),
      ukuran_baju: values.ukuran_baju || null,
      penyakit_pernah_diderita: values.penyakit_pernah_diderita || null,
      jarak_rumah_km: numberOrNull(values.jarak_rumah_km),
      waktu_perjalanan_menit: numberOrNull(values.waktu_perjalanan_menit),
      transportasi: values.transportasi || null,

      nama_ayah: values.nama_ayah || null,
      nik_ayah: values.nik_ayah || null,
      tempat_lahir_ayah: values.tempat_lahir_ayah || null,
      tanggal_lahir_ayah: values.tanggal_lahir_ayah || null,
      pendidikan_ayah: values.pendidikan_ayah || null,
      pekerjaan_ayah: values.pekerjaan_ayah || null,
      penghasilan_ayah: numberOrNull(values.penghasilan_ayah),
      telepon_ayah: values.telepon_ayah || null,
      alamat_ayah: values.alamat_ayah || null,

      nama_ibu: values.nama_ibu || null,
      nik_ibu: values.nik_ibu || null,
      tempat_lahir_ibu: values.tempat_lahir_ibu || null,
      tanggal_lahir_ibu: values.tanggal_lahir_ibu || null,
      pendidikan_ibu: values.pendidikan_ibu || null,
      pekerjaan_ibu: values.pekerjaan_ibu || null,
      penghasilan_ibu: numberOrNull(values.penghasilan_ibu),
      telepon_ibu: values.telepon_ibu || null,
      alamat_ibu: values.alamat_ibu || null,

      telepon_ortu: values.telepon_ayah || values.telepon_ibu || null,
      alamat_ortu: values.alamat_ayah || values.alamat_ibu || null,
      asal_sekolah: values.asal_sekolah || null,
      alamat_sekolah_asal: values.alamat_sekolah_asal || null,
      kabupaten_sekolah_asal: values.kabupaten_sekolah_asal || null,
      kecamatan_sekolah_asal: values.kecamatan_sekolah_asal || null,
      kelurahan_sekolah_asal: values.kelurahan_sekolah_asal || null,
      kelas_terakhir: values.kelas_terakhir || null,
      alasan_pindah: values.alasan_pindah || null,
      kemampuan_iqro: values.kemampuan_iqro || null,
      membaca_latin: values.membaca_latin || null,
      menulis_latin: values.menulis_latin || null,
      hafalan_quran: values.hafalan_quran || null,
    };

    if (isEdit) {
      const kelasData = values.kelas_id && values.tahun_ajaran_id
        ? { kelas_id: values.kelas_id, tahun_ajaran_id: values.tahun_ajaran_id }
        : undefined;
      await updateSiswa.mutateAsync({ id: id!, siswa: siswaData, detail: detailData, kelas_siswa: kelasData });

      if (nisMode === "otomatis" && nisParamsComplete) {
        try {
          const nis = await invokeGenerateNis(id!, watchDept!, watchAngkatan!, watchKelas!);
          toast.success("Siswa disimpan. NIS: " + nis);
        } catch (err: any) {
          toast.warning("Siswa disimpan, tapi NIS gagal di-generate: " + (err.message || ""));
        }
      }
      navigate(`/akademik/siswa/${id}`);
      return;
    }

    const kelasData = values.kelas_id && values.tahun_ajaran_id
      ? { kelas_id: values.kelas_id, tahun_ajaran_id: values.tahun_ajaran_id, aktif: true }
      : undefined;
    const result = await createSiswa.mutateAsync({ siswa: siswaData, detail: detailData, kelas_siswa: kelasData });
    const newSiswaId = (result as any)?.id;

    if (nisMode === "otomatis") {
      if (nisParamsComplete && newSiswaId) {
        try {
          const nis = await invokeGenerateNis(newSiswaId, watchDept!, watchAngkatan!, watchKelas!);
          toast.success("Siswa disimpan. NIS: " + nis);
        } catch (err: any) {
          toast.warning("Siswa disimpan, tapi NIS gagal di-generate: " + (err.message || ""));
        }
      }
      navigate("/akademik/siswa");
    } else if (nisMode === "ketik") {
      navigate("/akademik/siswa");
    } else if (newSiswaId) {
      setSavedSiswaId(newSiswaId);
      toast.success("Siswa disimpan. Klik Generate NIS setelah data akademik lengkap.");
    } else {
      navigate("/akademik/siswa");
    }
  };

  const canGenerateManual = isEdit ? nisParamsComplete : !!(savedSiswaId && nisParamsComplete);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4" /></Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{isEdit ? "Edit Data Siswa" : "Tambah Siswa Baru"}</h1>
          <p className="text-sm text-muted-foreground">
            {isEdit ? `Data master, akademik, dan SPMB ${siswa?.nama || ""}` : "Isi data siswa baru secara lengkap"}
          </p>
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
              <Card><CardContent className="pt-6 space-y-6">
                <FormSection title="Foto Siswa">
                  <FileUpload bucket="avatars-siswa" accept="image/*" maxSize={2} value={form.watch("foto_url")} onChange={(url) => form.setValue("foto_url", url || "")} />
                </FormSection>
                <FormSection title="Identitas">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField control={form.control} name="nama" render={({ field }) => (
                      <FormItem><FormLabel>Nama Lengkap *</FormLabel><FormControl><Input placeholder="Nama lengkap siswa" {...field} /></FormControl><FormMessage /></FormItem>
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
                      {nisMode === "manual" && <Button type="button" size="sm" variant="outline" disabled={!canGenerateManual || isGeneratingNis} onClick={handleGenerateNisClick}>{isGeneratingNis ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wand2 className="h-3 w-3 mr-1" />}Generate NIS</Button>}
                    </div>
                    <SelectField form={form} name="jenis_kelamin" label="Jenis Kelamin *" options={[["L", "Laki-laki"], ["P", "Perempuan"]]} />
                    <SelectField form={form} name="agama" label="Agama" options={agamaOptions} />
                    <TextField form={form} name="tempat_lahir" label="Tempat Lahir" />
                    <TextField form={form} name="tanggal_lahir" label="Tanggal Lahir" type="date" />
                    <TextField form={form} name="telepon" label="No. HP Siswa / Pendaftar" inputMode="tel" />
                    <TextField form={form} name="email" label="Email" type="email" />
                  </div>
                  <TextAreaField form={form} name="alamat" label="Alamat Rumah" />
                </FormSection>
              </Card></CardContent>
            </TabsContent>

            <TabsContent value="akademik">
              <Card><CardContent className="pt-6"><FormSection title="Data Akademik">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField control={form.control} name="departemen_id" render={({ field }) => (
                    <FormItem><FormLabel>Lembaga / Departemen</FormLabel><Select onValueChange={(v) => { field.onChange(v); form.setValue("tingkat_id", ""); form.setValue("kelas_id", ""); form.setValue("angkatan_id", ""); }} value={field.value || ""}><FormControl><SelectTrigger><SelectValue placeholder="Pilih lembaga" /></SelectTrigger></FormControl><SelectContent>{departemenList.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.nama}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="angkatan_id" render={({ field }) => (
                    <FormItem><FormLabel>Angkatan</FormLabel><Select onValueChange={field.onChange} value={field.value || ""} disabled={!watchDept}><FormControl><SelectTrigger><SelectValue placeholder="Pilih angkatan" /></SelectTrigger></FormControl><SelectContent>{angkatanList.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.nama}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>
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
                  <SelectField form={form} name="status" label="Status Siswa" options={[["calon", "Calon"], ["diterima", "Diterima"], ["aktif", "Aktif"], ["alumni", "Alumni"], ["pindah", "Pindah"], ["keluar", "Keluar"]]} />
                </div>
              </FormSection></CardContent></Card>
            </TabsContent>

            <TabsContent value="spmb">
              <Card><CardContent className="pt-6 space-y-6">
                <FormSection title="Data Pendaftaran SPMB">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField control={form.control} name="spmb_tahun_ajaran_id" render={({ field }) => (
                      <FormItem><FormLabel>Periode Tahun Ajaran SPMB</FormLabel><Select onValueChange={field.onChange} value={field.value || ""}><FormControl><SelectTrigger><SelectValue placeholder="Pilih periode" /></SelectTrigger></FormControl><SelectContent>{tahunAjaranList.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.nama} {t.aktif ? "(Aktif)" : ""}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>
                    )} />
                    <SelectField form={form} name="jenis_pendaftaran" label="Jenis Pendaftaran" options={[["baru", "Murid Baru"], ["pindahan", "Pindahan"], ["alumni_internal", "Alumni Internal"]]} />
                    <TextField form={form} name="nik" label="NIK" inputMode="numeric" />
                    <TextField form={form} name="no_kk" label="No. KK" inputMode="numeric" />
                    <SelectField form={form} name="kategori" label="Kategori" options={kategoriOptions} />
                    {wajibAsrama && <SelectField form={form} name="status_asrama" label="Asrama / Non Asrama *" options={[["asrama", "Asrama"], ["non_asrama", "Non Asrama"]]} />}
                    <TextField form={form} name="anak_ke" label="Anak ke" type="number" />
                    <TextField form={form} name="jumlah_bersaudara" label="Dari Bersaudara" type="number" />
                    <TextField form={form} name="tinggi_badan_cm" label="Tinggi Badan (cm)" type="number" />
                    <TextField form={form} name="berat_badan_kg" label="Berat Badan (kg)" type="number" />
                    <TextField form={form} name="lingkar_kepala_cm" label="Lingkar Kepala (cm)" type="number" />
                    <SelectField form={form} name="ukuran_baju" label="Ukuran Baju" options={ukuranBajuOptions} />
                    <TextField form={form} name="jarak_rumah_km" label="Jarak Rumah ke Sekolah (km)" type="number" />
                    <TextField form={form} name="waktu_perjalanan_menit" label="Waktu Perjalanan (menit)" type="number" />
                    <SelectField form={form} name="transportasi" label="Transportasi" options={transportasiOptions} />
                  </div>
                  <TextAreaField form={form} name="penyakit_pernah_diderita" label="Penyakit yang Pernah Diderita" placeholder="Kosongkan jika tidak ada" />
                </FormSection>
              </Card></CardContent>
            </TabsContent>

            <TabsContent value="orangtua">
              <div className="grid gap-4 xl:grid-cols-2">
                <Card><CardContent className="pt-6"><FormSection title="Data Ayah"><div className="grid gap-4 sm:grid-cols-2">
                  <TextField form={form} name="nik_ayah" label="NIK Ayah" inputMode="numeric" />
                  <TextField form={form} name="nama_ayah" label="Nama Ayah" />
                  <TextField form={form} name="tempat_lahir_ayah" label="Tempat Lahir" />
                  <TextField form={form} name="tanggal_lahir_ayah" label="Tanggal Lahir" type="date" />
                  <SelectField form={form} name="pendidikan_ayah" label="Pendidikan Terakhir" options={pendidikanOptions} />
                  <SelectField form={form} name="pekerjaan_ayah" label="Pekerjaan" options={pekerjaanOptions} />
                  <TextField form={form} name="penghasilan_ayah" label="Penghasilan (Rp)" type="number" />
                  <TextField form={form} name="telepon_ayah" label="No. HP / WA" inputMode="tel" />
                </div><TextAreaField form={form} name="alamat_ayah" label="Alamat Ayah" /></FormSection></CardContent></Card>
                <Card><CardContent className="pt-6"><FormSection title="Data Ibu"><div className="grid gap-4 sm:grid-cols-2">
                  <TextField form={form} name="nik_ibu" label="NIK Ibu" inputMode="numeric" />
                  <TextField form={form} name="nama_ibu" label="Nama Ibu" />
                  <TextField form={form} name="tempat_lahir_ibu" label="Tempat Lahir" />
                  <TextField form={form} name="tanggal_lahir_ibu" label="Tanggal Lahir" type="date" />
                  <SelectField form={form} name="pendidikan_ibu" label="Pendidikan Terakhir" options={pendidikanOptions} />
                  <SelectField form={form} name="pekerjaan_ibu" label="Pekerjaan" options={pekerjaanOptions} />
                  <TextField form={form} name="penghasilan_ibu" label="Penghasilan (Rp)" type="number" />
                  <TextField form={form} name="telepon_ibu" label="No. HP / WA" inputMode="tel" />
                </div><TextAreaField form={form} name="alamat_ibu" label="Alamat Ibu" /></FormSection></CardContent></Card>
              </div>
            </TabsContent>

            <TabsContent value="sekolah">
              <Card><CardContent className="pt-6 space-y-6">
                <FormSection title="Data Sekolah Asal">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField form={form} name="asal_sekolah" label="Nama Sekolah Asal" />
                    <TextField form={form} name="kelas_terakhir" label="Kelas Terakhir" />
                    <TextField form={form} name="kabupaten_sekolah_asal" label="Kabupaten / Kota" />
                    <TextField form={form} name="kecamatan_sekolah_asal" label="Kecamatan" />
                    <TextField form={form} name="kelurahan_sekolah_asal" label="Desa / Kelurahan" />
                  </div>
                  <TextAreaField form={form} name="alamat_sekolah_asal" label="Alamat Sekolah" />
                  <TextAreaField form={form} name="alasan_pindah" label="Alasan Pindah" />
                </FormSection>
                <FormSection title="Kemampuan Dasar Siswa">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SelectField form={form} name="kemampuan_iqro" label="Kemampuan Dasar (Iqro)" options={iqroOptions} />
                    <SelectField form={form} name="membaca_latin" label="Membaca Latin" options={latinOptions} />
                    <SelectField form={form} name="menulis_latin" label="Menulis Latin" options={latinOptions} />
                    <SelectField form={form} name="hafalan_quran" label="Hafalan Qur'an" options={hafalanOptions} />
                  </div>
                </FormSection>
              </Card></CardContent>
            </TabsContent>
          </Tabs>

          <div className="sticky bottom-0 bg-background border-t py-4 mt-6 flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => navigate(-1)}>Batal</Button>
            <Button type="submit" disabled={createSiswa.isPending || updateSiswa.isPending || isGeneratingNis}>
              <Save className="h-4 w-4 mr-2" />{isEdit ? "Simpan Perubahan" : "Simpan Siswa"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
