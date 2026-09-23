import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@/lib/router-compat";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { StatsCard } from "@/components/shared/StatsCard";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAngkatan, useDepartemen, useTahunAjaran } from "@/hooks/useAkademikData";
import { generateNISViaEdgeFunction } from "@/utils/nisGenerator";
import {
  SPMB_CATEGORY_LABEL,
  SPMB_CATEGORY_VALUE,
  SPMB_TRANSFER_CATEGORY_LABEL,
  SPMB_TRANSFER_CATEGORY_VALUE,
  SPMB_TARGET_ACADEMIC_YEAR,
  SPMB_TARGET_COHORT,
} from "@/lib/spmbPolicy";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  Filter,
  Pencil,
  RefreshCw,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { fetchAllPages } from "@/lib/fetchAll";
import { toast } from "sonner";

function diagnosaNIS(row: Record<string, unknown>): { alasan?: "no_dept_angkatan" | "no_kelas" } {
  const departemenId = row.departemen_id as string | null;
  const angkatanId = row.angkatan_id as string | null;
  if (!departemenId || !angkatanId) return { alasan: "no_dept_angkatan" };
  return {};
}

function departemenPerluAsrama(dept: any): boolean {
  const kode = (dept?.kode || "").trim().toUpperCase();
  const nama = (dept?.nama || "").trim().toUpperCase();
  return ["SMP", "SMA", "MTA"].includes(kode) || /(^|\s)(SMP|SMA|MTA)(\s|$)/.test(nama);
}

function formatTanggal(value: unknown): string {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(date);
}

type KesiapanPenerimaan = { siap: boolean; kekurangan: string[] };

type SpmbFilterState = {
  departemen: string;
  status: string;
  jenisKelamin: string;
  tes: string;
  kelulusan: string;
  daftarUlang: string;
  biaya: string;
  kesiapan: string;
  verifikasi: string;
};

const DEFAULT_FILTERS: SpmbFilterState = {
  departemen: "all",
  status: "all",
  jenisKelamin: "all",
  tes: "all",
  kelulusan: "all",
  daftarUlang: "all",
  biaya: "all",
  kesiapan: "all",
  verifikasi: "all",
};

type RegistrationForm = {
  nama: string;
  nik: string;
  nisn: string;
  kategori: string;
  jenis_kelamin: "L" | "P";
  telepon: string;
  alamat: string;
  departemen_id: string;
  angkatan_id: string;
  tahun_ajaran_id: string;
};

type RegistrationErrors = Partial<Record<keyof RegistrationForm, string>>;

type RegistrationSuccess = {
  id: string;
  nama: string;
  gratis_pendaftaran: boolean;
  gelombang_nama: string | null;
};

function getKesiapanPenerimaan(row: Record<string, unknown>): KesiapanPenerimaan {
  if (row._readiness) return row._readiness as KesiapanPenerimaan;
  const kekurangan: string[] = [];
  const departemen = row.departemen as { npsn?: string | null; kode?: string | null; nama?: string | null } | null;
  const detail = row._spmbDetail as Record<string, any> | null;

  if (!row.terverifikasi) kekurangan.push("verifikasi data");
  if (!row._pmbConfigured && !row._pmbGratis) kekurangan.push("konfigurasi pembayaran SPMB");
  else if (!row._pmbLunas && !row._pmbGratis) kekurangan.push("pembayaran SPMB");
  if (!row.departemen_id) kekurangan.push("lembaga");
  if (!row.angkatan_id) kekurangan.push("angkatan");
  if (!row._punyaKelas) kekurangan.push("kelas");
  if (!departemen?.npsn) kekurangan.push("NPSN lembaga");
  if (!detail?.dokumen_kk_path) kekurangan.push("Kartu Keluarga");
  if (!detail?.dokumen_akta_path) kekurangan.push("Akta Kelahiran");
  if (departemenPerluAsrama(departemen) && !detail?.status_asrama) kekurangan.push("pilihan asrama");
  if (detail?.spmb_status_kelulusan !== "lulus") kekurangan.push("status kelulusan: Lulus");

  return { siap: kekurangan.length === 0, kekurangan };
}

function labelAsrama(value: string | null | undefined) {
  if (value === "asrama") return "Asrama";
  if (value === "non_asrama") return "Non Asrama";
  return "-";
}

function normalizeDigits(value: string) {
  return value.replace(/\D/g, "");
}

export default function SPMB() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const angkatanQuery = useAngkatan();
  const departemenQuery = useDepartemen();
  const tahunQuery = useTahunAjaran();
  const angkatanList = angkatanQuery.data || [];
  const departemenList = departemenQuery.data || [];
  const tahunList = tahunQuery.data || [];

  const targetYear = useMemo(
    () => tahunList.find((t: any) => String(t.nama || "").trim() === SPMB_TARGET_ACADEMIC_YEAR),
    [tahunList],
  );

  const emptyForm = (): RegistrationForm => ({
    nama: "",
    nik: "",
    nisn: "",
    kategori: SPMB_CATEGORY_VALUE,
    jenis_kelamin: "L",
    telepon: "",
    alamat: "",
    departemen_id: "",
    angkatan_id: "",
    tahun_ajaran_id: targetYear?.id || "",
  });

  const [isSaving, setIsSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [formData, setFormData] = useState<RegistrationForm>(() => emptyForm());
  const [formErrors, setFormErrors] = useState<RegistrationErrors>({});
  const [registrationSuccess, setRegistrationSuccess] = useState<RegistrationSuccess | null>(null);
  const [nisLoadingId, setNisLoadingId] = useState<string | null>(null);
  const [milestoneLoadingId, setMilestoneLoadingId] = useState<string | null>(null);
  const [activationRow, setActivationRow] = useState<Record<string, unknown> | null>(null);
  const [activationClassId, setActivationClassId] = useState("");
  const [activationLoading, setActivationLoading] = useState(false);
  const [filters, setFilters] = useState<SpmbFilterState>(DEFAULT_FILTERS);
  const [sortMode, setSortMode] = useState("registration_desc");

  useEffect(() => {
    if (!targetYear?.id) return;
    setFormData((current) => current.tahun_ajaran_id
      ? current
      : { ...current, tahun_ajaran_id: targetYear.id });
  }, [targetYear?.id]);

  useEffect(() => {
    if (!formData.departemen_id) return;
    const matching = angkatanList.find((a: any) =>
      a.departemen_id === formData.departemen_id &&
      String(a.nama || "").trim() === SPMB_TARGET_COHORT &&
      a.aktif !== false,
    );
    if (matching?.id && formData.angkatan_id !== matching.id) {
      setFormData((current) => ({ ...current, angkatan_id: matching.id }));
    }
  }, [angkatanList, formData.departemen_id, formData.angkatan_id]);

  const spmbDepartemenOrder = ["TK", "SD", "SMP", "SMA", "MTA"];
  const spmbDepartemenList = spmbDepartemenOrder
    .map((kode) => departemenList.find((d: any) =>
      String(d.kode || "").trim().toUpperCase() === kode &&
      d.kategori === "unit_pendidikan" &&
      d.psb_dibuka === true,
    ))
    .filter(Boolean) as any[];

  const labelDepartemenSpmb = (d: any) => {
    const kode = String(d?.kode || "").trim().toUpperCase();
    return kode === "MTA" ? "MT" : kode;
  };

  const targetAngkatan = formData.departemen_id
    ? angkatanList.find((a: any) =>
        a.departemen_id === formData.departemen_id &&
        String(a.nama || "").trim() === SPMB_TARGET_COHORT &&
        a.aktif !== false,
      )
    : undefined;
  const selectedDept = departemenList.find((d: any) => d.id === formData.departemen_id);
  const selectedDeptNeedsNisn = departemenPerluAsrama(selectedDept);

  const initialSnapshot = emptyForm();
  const isDirty = (Object.keys(initialSnapshot) as Array<keyof RegistrationForm>).some(
    (key) => formData[key] !== initialSnapshot[key],
  );

  const resetRegistration = () => {
    setFormData(emptyForm());
    setFormErrors({});
    setRegistrationSuccess(null);
    setDiscardOpen(false);
  };

  const openRegistration = () => {
    resetRegistration();
    setDialogOpen(true);
  };

  const closeRegistration = () => {
    setDialogOpen(false);
    resetRegistration();
  };

  const requestCloseRegistration = () => {
    if (isSaving) return;
    if (registrationSuccess) {
      closeRegistration();
      return;
    }
    if (isDirty) {
      setDiscardOpen(true);
      return;
    }
    closeRegistration();
  };

  const setFilter = (key: keyof SpmbFilterState, value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const resetFilters = () => setFilters({ ...DEFAULT_FILTERS });

  const { data: calonList = [], isLoading } = useQuery({
    queryKey: ["siswa", "calon"],
    queryFn: async () => {
      const { data: visibleRows, error: visibleError } = await (supabase as any).rpc("spmb_visible_siswa_ids");
      if (visibleError) throw visibleError;

      const visibleIds = [...new Set(
        (visibleRows || []).map((row: any) => row.siswa_id).filter(Boolean),
      )] as string[];
      if (!visibleIds.length) return [];

      // Query hanya pendaftaran yang memang menjadi tanggung jawab lembaga tujuan TU.
      // Siswa internal tetap terlihat di daftar siswa lembaga asal, tetapi tidak bocor
      // ke daftar SPMB lembaga asal ketika tujuan pendaftarannya berbeda.
      const details: any[] = [];
      for (let i = 0; i < visibleIds.length; i += 150) {
        const chunk = visibleIds.slice(i, i + 150);
        const rows = await fetchAllPages<any>((from, to) => (supabase as any)
          .from("siswa_detail")
          .select("siswa_id,tahun_ajaran_id,status_asrama,kategori,dokumen_kk_path,dokumen_akta_path,spmb_tanggal_tes,spmb_tanggal_lulus,spmb_tanggal_daftar_ulang,spmb_status_kelulusan,spmb_tanggal_keputusan,spmb_departemen_tujuan_id,spmb_angkatan_tujuan_id,spmb_status_pendaftaran,spmb_siswa_internal,spmb_kelas_tujuan_id,spmb_tanggal_aktivasi,spmb_gelombang_id,spmb_registered_at")
          .in("siswa_id", chunk)
          .not("spmb_gelombang_id", "is", null)
          .order("siswa_id")
          .range(from, to));
        details.push(...rows);
      }
      if (!details.length) return [];

      const siswaIds = [...new Set(details.map((d: any) => d.siswa_id).filter(Boolean))];
      const siswaRows: any[] = [];
      for (let i = 0; i < siswaIds.length; i += 150) {
        const chunk = siswaIds.slice(i, i + 150);
        const { data, error } = await supabase
          .from("siswa")
          .select("*, angkatan:angkatan_id(nama), departemen:departemen_id(nama,kode,npsn)")
          .in("id", chunk);
        if (error) throw error;
        siswaRows.push(...(data || []));
      }
      const siswaById = new Map<string, any>(siswaRows.map((row: any) => [row.id, row]));

      const targetDeptIds = [...new Set(details.map((d: any) => d.spmb_departemen_tujuan_id).filter(Boolean))];
      const targetCohortIds = [...new Set(details.map((d: any) => d.spmb_angkatan_tujuan_id).filter(Boolean))];
      const targetDeptById = new Map<string, any>();
      const targetCohortById = new Map<string, any>();
      if (targetDeptIds.length) {
        const { data, error } = await supabase.from("departemen").select("id,nama,kode,npsn").in("id", targetDeptIds);
        if (error) throw error;
        for (const item of data || []) targetDeptById.set(item.id, item);
      }
      if (targetCohortIds.length) {
        const { data, error } = await supabase.from("angkatan").select("id,nama").in("id", targetCohortIds);
        if (error) throw error;
        for (const item of data || []) targetCohortById.set(item.id, item);
      }

      const { data: readinessRows, error } = await (supabase as any).rpc("spmb_readiness_list", { p_ids: siswaIds });
      if (error) throw error;
      const byId = new Map<string, any>((readinessRows || []).map((r: any) => [r.siswa_id, r.readiness]));

      return details.flatMap((detail: any) => {
        const s = siswaById.get(detail.siswa_id);
        if (!s) return [];
        const r = byId.get(s.id);
        const targetDeptId = detail.spmb_departemen_tujuan_id || s.departemen_id;
        const targetCohortId = detail.spmb_angkatan_tujuan_id || s.angkatan_id;
        const targetDept = targetDeptById.get(targetDeptId) || s.departemen;
        const targetCohort = targetCohortById.get(targetCohortId) || s.angkatan;
        const registrationStatus = detail.spmb_status_pendaftaran
          || (["calon", "diterima"].includes(s.status) ? s.status : "calon");
        const biayaSort = r?.gratis_pendaftaran
          ? "gratis"
          : !r?.configured
            ? "belum_diatur"
            : r?.lunas
              ? "lunas"
              : "belum_bayar";
        return [{
          ...s,
          status: registrationStatus,
          departemen_id: targetDeptId,
          angkatan_id: targetCohortId,
          departemen: targetDept,
          angkatan: targetCohort,
          _academicStatus: s.status,
          _academicDepartemenId: s.departemen_id,
          _academicLembagaNama: s.departemen?.nama || "",
          _spmbInternal: detail.spmb_siswa_internal === true,
          _readiness: r,
          _pmbConfigured: r?.configured,
          _pmbLunas: r?.lunas,
          _pmbGratis: r?.gratis_pendaftaran,
          _pmbTanggalBayar: r?.tanggal_pembayaran,
          _punyaKelas: r?.punya_kelas,
          _spmbDetail: detail,
          _lembagaNama: targetDept?.nama || "",
          _angkatanNama: targetCohort?.nama || "",
          _spmbAsrama: labelAsrama(detail?.status_asrama),
          _spmbTesStatus: detail?.spmb_tanggal_tes ? "sudah" : "belum",
          _spmbTanggalTes: detail?.spmb_tanggal_tes || null,
          _spmbTanggalLulus: detail?.spmb_tanggal_lulus || null,
          _spmbTanggalKeputusan: detail?.spmb_tanggal_keputusan || null,
          _spmbStatusKelulusan: detail?.spmb_status_kelulusan || null,
          _spmbTanggalDaftarUlang: detail?.spmb_tanggal_daftar_ulang || null,
          _spmbTahunAjaranId: detail?.tahun_ajaran_id || null,
          _spmbKelasTujuanId: detail?.spmb_kelas_tujuan_id || null,
          _spmbTanggalAktivasi: detail?.spmb_tanggal_aktivasi || null,
          _spmbRegisteredAt: detail?.spmb_registered_at || s.created_at || null,
          _biayaSort: biayaSort,
          _kesiapanSort: r?.siap ? "siap" : "belum",
          _verifikasiSort: s.terverifikasi ? "sudah" : "belum",
        }];
      });
    },
  });

  const activationTargetDeptId = activationRow?.departemen_id as string | undefined;
  const activationDetail = activationRow?._spmbDetail as Record<string, any> | undefined;
  const activationYear = activationDetail?.tahun_ajaran_id
    ? tahunList.find((item: any) => item.id === activationDetail.tahun_ajaran_id)
    : undefined;

  const { data: activationClasses = [], isLoading: activationClassesLoading } = useQuery({
    queryKey: ["spmb", "activation-classes", activationTargetDeptId],
    enabled: Boolean(activationTargetDeptId),
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("kelas")
        .select("id,nama,departemen_id,aktif,tingkat:tingkat_id(id,nama,urutan)")
        .eq("departemen_id", activationTargetDeptId)
        .eq("aktif", true)
        .order("nama");
      if (error) throw error;
      return [...(data || [])].sort((a: any, b: any) => {
        const urutanA = Number(a.tingkat?.urutan ?? 999);
        const urutanB = Number(b.tingkat?.urutan ?? 999);
        if (urutanA !== urutanB) return urutanA - urutanB;
        return String(a.nama || "").localeCompare(String(b.nama || ""), "id");
      });
    },
  });

  const calonCount = calonList.filter((s: any) => s.status === "calon").length;
  const diterimaCount = calonList.filter((s: any) => s.status === "diterima").length;
  const nisKosongCount = calonList.filter((s: any) => s.status === "diterima" && !s.nis).length;
  const asramaCount = calonList.filter((s: any) => s._spmbDetail?.status_asrama === "asrama").length;
  const nonAsramaCount = calonList.filter((s: any) => s._spmbDetail?.status_asrama === "non_asrama").length;
  const lakiCount = calonList.filter((s: any) => s.jenis_kelamin === "L").length;
  const perempuanCount = calonList.filter((s: any) => s.jenis_kelamin === "P").length;
  const belumSiapCount = calonList.filter(
    (s: any) => s.status === "calon" && !getKesiapanPenerimaan(s as Record<string, unknown>).siap,
  ).length;
  const hasActiveFilters = Object.values(filters).some((value) => value !== "all");
  const filteredCalonList = calonList.filter((s: any) => {
    if (filters.departemen !== "all" && s.departemen_id !== filters.departemen) return false;
    if (filters.status !== "all" && s.status !== filters.status) return false;
    if (filters.jenisKelamin !== "all" && s.jenis_kelamin !== filters.jenisKelamin) return false;
    if (filters.tes !== "all" && Boolean(s._spmbTanggalTes) !== (filters.tes === "sudah")) return false;
    if (filters.kelulusan === "lulus" && s._spmbStatusKelulusan !== "lulus") return false;
    if (filters.kelulusan === "tidak_lulus" && s._spmbStatusKelulusan !== "tidak_lulus") return false;
    if (filters.kelulusan === "belum" && s._spmbStatusKelulusan) return false;
    if (filters.daftarUlang !== "all" && Boolean(s._spmbTanggalDaftarUlang) !== (filters.daftarUlang === "sudah")) return false;
    if (filters.biaya !== "all" && s._biayaSort !== filters.biaya) return false;
    if (filters.kesiapan !== "all" && getKesiapanPenerimaan(s as Record<string, unknown>).siap !== (filters.kesiapan === "siap")) return false;
    if (filters.verifikasi !== "all" && Boolean(s.terverifikasi) !== (filters.verifikasi === "sudah")) return false;
    return true;
  });

  const sortedCalonList = [...filteredCalonList].sort((a: any, b: any) => {
    const createdA = new Date(a._spmbRegisteredAt || a.created_at || 0).getTime();
    const createdB = new Date(b._spmbRegisteredAt || b.created_at || 0).getTime();
    const paidA = a._pmbTanggalBayar ? new Date(a._pmbTanggalBayar).getTime() : null;
    const paidB = b._pmbTanggalBayar ? new Date(b._pmbTanggalBayar).getTime() : null;
    if (sortMode === "registration_asc") return createdA - createdB;
    if (sortMode === "payment_desc") {
      if (paidA === null) return 1;
      if (paidB === null) return -1;
      return paidB - paidA;
    }
    if (sortMode === "payment_asc") {
      if (paidA === null) return 1;
      if (paidB === null) return -1;
      return paidA - paidB;
    }
    return createdB - createdA;
  });

  const focusFirstError = (errors: RegistrationErrors) => {
    const order: Array<keyof RegistrationForm> = ["nama", "nik", "nisn", "departemen_id", "tahun_ajaran_id", "angkatan_id", "telepon", "alamat"];
    const first = order.find((key) => errors[key]);
    if (!first) return;
    window.requestAnimationFrame(() => document.getElementById(`spmb-${first}`)?.focus());
  };

  const validateRegistration = (): boolean => {
    const errors: RegistrationErrors = {};
    const cleanName = formData.nama.trim();
    const cleanNik = normalizeDigits(formData.nik);
    const cleanPhone = formData.telepon.trim();

    if (cleanName.length < 2) errors.nama = "Nama lengkap minimal 2 karakter dan tidak boleh hanya spasi.";
    if (cleanNik.length !== 16) errors.nik = "NIK Calon Murid harus terdiri dari tepat 16 digit.";
    if (selectedDeptNeedsNisn && normalizeDigits(formData.nisn).length !== 10) errors.nisn = "NISN wajib terdiri dari tepat 10 digit untuk SMP, SMA, dan MTA.";
    if (!formData.departemen_id) errors.departemen_id = "Pilih lembaga tujuan pendaftaran.";
    if (!targetYear || formData.tahun_ajaran_id !== targetYear.id) {
      errors.tahun_ajaran_id = `${SPMB_TARGET_ACADEMIC_YEAR} belum tersedia atau belum terpilih.`;
    }
    if (!formData.departemen_id) {
      errors.angkatan_id = "Pilih lembaga terlebih dahulu.";
    } else if (!targetAngkatan || formData.angkatan_id !== targetAngkatan.id) {
      errors.angkatan_id = `${SPMB_TARGET_COHORT} untuk lembaga ini belum tersedia.`;
    }
    if (!cleanPhone) {
      errors.telepon = "No. HP / WhatsApp yang bisa dihubungi wajib diisi.";
    } else if (!/^(?:\+62|62|0)[0-9]{7,16}$/.test(cleanPhone.replace(/[\s-]/g, ""))) {
      errors.telepon = "Masukkan nomor HP / WhatsApp yang valid, misalnya 08xxxxxxxxxx.";
    }
    if (!formData.alamat.trim()) errors.alamat = "Alamat rumah wajib diisi.";

    setFormErrors(errors);
    if (Object.keys(errors).length) {
      focusFirstError(errors);
      return false;
    }
    return true;
  };

  const handleDaftar = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving || !validateRegistration()) return;

    setIsSaving(true);
    try {
      const { data, error } = await (supabase as any).rpc("spmb_admin_register", {
        p_payload: {
          nama: formData.nama.trim(),
          nik: normalizeDigits(formData.nik),
          nisn: selectedDeptNeedsNisn ? normalizeDigits(formData.nisn) : null,
          kategori: formData.kategori,
          jenis_kelamin: formData.jenis_kelamin,
          telepon: formData.telepon.trim() || null,
          alamat: formData.alamat.trim() || null,
          departemen_id: formData.departemen_id,
        },
      });
      if (error) throw error;
      const id = data?.id as string | undefined;
      if (!id) throw new Error("Pendaftaran tersimpan tetapi ID calon murid tidak diterima dari server");

      await Promise.all([
        qc.invalidateQueries({ queryKey: ["siswa"] }),
        qc.invalidateQueries({ queryKey: ["siswa", "calon"] }),
      ]);
      setRegistrationSuccess({
        id,
        nama: formData.nama.trim(),
        gratis_pendaftaran: data?.gratis_pendaftaran === true,
        gelombang_nama: data?.gelombang_nama || null,
      });
      setFormErrors({});
      toast.success("Pendaftaran Penerimaan Murid Baru Berhasil", {
        description: "Data disimpan sebagai calon murid dan belum menyatakan kelulusan atau penerimaan.",
      });
    } catch (error: any) {
      toast.error("Gagal menyimpan pendaftaran", {
        description: error?.message || "Periksa data lalu coba kembali. Isian Anda tetap dipertahankan.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const generateNIS = async (siswaId: string, departemenId: string, angkatanId: string, namaSiswa: string): Promise<boolean> => {
    const { data: kelasSiswa } = await supabase
      .from("kelas_siswa")
      .select("kelas_id")
      .eq("siswa_id", siswaId)
      .eq("aktif", true)
      .maybeSingle();
    if (!kelasSiswa?.kelas_id) {
      toast.warning(`NIS belum dibuat untuk ${namaSiswa}`, {
        description: "Siswa belum dimasukkan ke kelas. Atur kelas melalui Data Siswa lalu buat NIS.",
        duration: 8000,
      });
      return false;
    }
    try {
      const { nis } = await generateNISViaEdgeFunction({
        siswa_id: siswaId,
        departemen_id: departemenId,
        angkatan_id: angkatanId,
        kelas_id: kelasSiswa.kelas_id,
      });
      toast.success(`NIS berhasil dibuat: ${nis}`, { description: namaSiswa });
      return true;
    } catch (error: any) {
      const pesan: string = error.message || "Terjadi kesalahan teknis";
      toast.error(`NIS gagal dibuat untuk ${namaSiswa}`, {
        description: pesan.toLowerCase().includes("npsn") ? "NPSN belum diisi pada data lembaga. Hubungi admin." : pesan,
        duration: 10000,
      });
      return false;
    }
  };

  const handleTerima = async (row: Record<string, unknown>) => {
    const kesiapan = getKesiapanPenerimaan(row);
    if (!kesiapan.siap) {
      toast.error("Calon murid belum siap diterima", {
        description: `Lengkapi terlebih dahulu: ${kesiapan.kekurangan.join(", ")}.`,
      });
      return;
    }
    const id = row.id as string;
    const departemenId = row.departemen_id as string;
    const angkatanId = row.angkatan_id as string;
    const namaSiswa = row.nama as string;
    setNisLoadingId(id);
    try {
      if (row._spmbInternal) {
        const { error } = await (supabase as any).rpc("spmb_set_registration_status", {
          p_siswa_id: id,
          p_status: "diterima",
        });
        if (error) throw error;
        await qc.invalidateQueries({ queryKey: ["siswa", "calon"] });
        toast.success(`${namaSiswa} berhasil diterima pada SPMB`, {
          description: "Status akademik dan kelas saat ini tetap dipertahankan sampai proses perpindahan jenjang.",
        });
        return;
      }
      if (!row.nis) {
        const nisBerhasil = await generateNIS(id, departemenId, angkatanId, namaSiswa);
        if (!nisBerhasil) return;
      }
      const { error } = await supabase.from("siswa").update({ status: "diterima" } as any).eq("id", id);
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["siswa"] });
      toast.success(`${namaSiswa} berhasil diterima`, {
        description: "Verifikasi, dokumen, biaya pendaftaran, angkatan, kelas, dan NIS sudah lengkap.",
      });
    } catch (error: any) {
      toast.error("Gagal menerima murid", { description: error?.message || "Terjadi kesalahan teknis" });
    } finally {
      setNisLoadingId(null);
    }
  };

  const handleBuatNIS = async (row: Record<string, unknown>) => {
    const id = row.id as string;
    const departemenId = row.departemen_id as string | null;
    const angkatanId = row.angkatan_id as string | null;
    if (!departemenId || !angkatanId) {
      toast.error("Tidak bisa membuat NIS", { description: "Lembaga dan angkatan murid belum diisi. Edit data terlebih dahulu." });
      return;
    }
    setNisLoadingId(id);
    try {
      const berhasil = await generateNIS(id, departemenId, angkatanId, row.nama as string);
      if (berhasil) qc.invalidateQueries({ queryKey: ["siswa"] });
    } finally {
      setNisLoadingId(null);
    }
  };

  const handleAktifkan = async (row: Record<string, unknown>) => {
    if (!row.nis) {
      toast.error("Murid belum siap diaktifkan", { description: "Buat NIS terlebih dahulu sebelum mengaktifkan murid." });
      return;
    }
    const { error } = await supabase.from("siswa").update({ status: "aktif" } as any).eq("id", row.id as string);
    if (error) {
      toast.error("Gagal mengaktifkan murid: " + error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["siswa"] });
    toast.success("Murid diaktifkan");
  };

  const handleMilestone = async (row: Record<string, unknown>, action: "tes" | "lulus" | "tidak_lulus" | "daftar_ulang", label: string) => {
    const loadingKey = `${row.id}:${action}`;
    setMilestoneLoadingId(loadingKey);
    try {
      const { error } = await (supabase as any).rpc("spmb_mark_milestone", {
        p_siswa_id: row.id,
        p_action: action,
      });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["siswa", "calon"] });
      toast.success(`${label} berhasil dicatat`, { description: row.nama as string });
    } catch (error: any) {
      toast.error(`Gagal mencatat ${label.toLowerCase()}`, { description: error?.message || "Terjadi kesalahan teknis" });
    } finally {
      setMilestoneLoadingId(null);
    }
  };

  const openInternalActivation = (row: Record<string, unknown>) => {
    setActivationClassId("");
    setActivationRow(row);
  };

  const closeInternalActivation = () => {
    if (activationLoading) return;
    setActivationRow(null);
    setActivationClassId("");
  };

  const handleInternalActivation = async () => {
    if (!activationRow || !activationClassId) {
      toast.error("Pilih kelas tujuan terlebih dahulu");
      return;
    }
    const detail = activationRow._spmbDetail as Record<string, any> | undefined;
    const tahunAjaranId = detail?.tahun_ajaran_id as string | undefined;
    if (!tahunAjaranId) {
      toast.error("Periode SPMB tidak ditemukan");
      return;
    }

    setActivationLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc("spmb_activate_internal_student", {
        p_siswa_id: activationRow.id,
        p_kelas_id: activationClassId,
        p_tahun_ajaran_id: tahunAjaranId,
      });
      if (error) throw error;

      await Promise.all([
        qc.invalidateQueries({ queryKey: ["siswa"] }),
        qc.invalidateQueries({ queryKey: ["siswa", "calon"] }),
        qc.invalidateQueries({ queryKey: ["kelas_siswa"] }),
      ]);

      const result = Array.isArray(data) ? data[0] : data;
      toast.success(`${activationRow.nama as string} berhasil diaktifkan ke jenjang tujuan`, {
        description: result?.nis_baru
          ? `NIS baru: ${result.nis_baru}. NIS lama tetap tercatat pada audit identitas.`
          : "Riwayat kelas asal tetap tersimpan.",
        duration: 9000,
      });
      setActivationRow(null);
      setActivationClassId("");
    } catch (error: any) {
      toast.error("Gagal mengaktifkan ke jenjang tujuan", {
        description: error?.message || "Terjadi kesalahan teknis",
        duration: 10000,
      });
    } finally {
      setActivationLoading(false);
    }
  };

  const columns: DataTableColumn<Record<string, unknown>>[] = [
    { key: "nama", label: "Nama", sortable: true },
    {
      key: "nis",
      label: "NIS",
      sortable: true,
      render: (value, row) => {
        if (value) return <span className="font-mono text-xs">{value as string}</span>;
        if (row.status === "diterima") {
          const { alasan } = diagnosaNIS(row);
          return (
            <span
              className="inline-flex cursor-help items-center gap-1 text-xs text-warning"
              title={alasan === "no_dept_angkatan" ? "Lembaga/angkatan belum diisi" : "Kelas belum diatur"}
            >
              <AlertTriangle className="h-3 w-3" />Belum ada
            </span>
          );
        }
        return <span className="text-xs text-muted-foreground">-</span>;
      },
    },
    { key: "jenis_kelamin", label: "JK", sortable: true, render: (value) => value === "L" ? "L" : "P" },
    { key: "_lembagaNama", label: "Lembaga", sortable: true, render: (value) => (value as string) || "-" },
    { key: "_spmbAsrama", label: "Asrama", sortable: true, render: (value) => (value as string) || "-" },
    { key: "_angkatanNama", label: "Angkatan", sortable: true, render: (value) => (value as string) || "-" },
    { key: "_spmbRegisteredAt", label: "Tgl Pendaftaran", sortable: true, render: (value) => formatTanggal(value) },
    { key: "_pmbTanggalBayar", label: "Tgl Bayar Pendaftaran", sortable: true, render: (value) => formatTanggal(value) },
    { key: "_spmbTesStatus", label: "Status Tes", sortable: true, render: (value) => value === "sudah" ? <span className="text-xs text-success">Sudah Tes</span> : <span className="text-xs text-warning">Belum Tes</span> },
    { key: "_spmbTanggalTes", label: "Tgl Tes", sortable: true, render: (value) => formatTanggal(value) },
    { key: "_spmbStatusKelulusan", label: "Status Kelulusan", sortable: true, render: (value) => value === "lulus" ? <span className="text-xs text-success">Lulus</span> : value === "tidak_lulus" ? <span className="text-xs text-destructive">Tidak Lulus</span> : <span className="text-xs text-muted-foreground">Belum Ditentukan</span> },
    { key: "_spmbTanggalKeputusan", label: "Tgl Keputusan", sortable: true, render: (value) => formatTanggal(value) },
    { key: "_spmbTanggalLulus", label: "Tgl Lulus", sortable: true, render: (value) => formatTanggal(value) },
    { key: "_spmbTanggalDaftarUlang", label: "Tgl Daftar Ulang", sortable: true, render: (value) => formatTanggal(value) },
    {
      key: "_biayaSort",
      label: "Biaya Pendaftaran",
      sortable: true,
      render: (_, row) => {
        if (row._pmbGratis) return <span className="inline-flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" />Gratis</span>;
        if (!row._pmbConfigured) return <span className="text-xs text-warning">Belum diatur</span>;
        if (row._pmbLunas) return <span className="inline-flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" />Lunas</span>;
        return <span className="text-xs text-destructive">Belum bayar</span>;
      },
    },
    {
      key: "_kesiapanSort",
      label: "Kesiapan",
      sortable: true,
      render: (_, row) => {
        const kesiapan = getKesiapanPenerimaan(row);
        return kesiapan.siap
          ? <span className="inline-flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" />Siap diterima</span>
          : <span className="inline-flex cursor-help items-center gap-1 text-xs text-warning" title={`Belum lengkap: ${kesiapan.kekurangan.join(", ")}`}><AlertTriangle className="h-3.5 w-3.5" />{kesiapan.kekurangan.length} belum lengkap</span>;
      },
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (value, row) => {
        const status = value as string;
        const colors: Record<string, string> = {
          calon: "bg-warning/15 text-warning border-warning/30",
          diterima: "bg-info/15 text-info border-info/30",
          selesai: "bg-success/15 text-success border-success/30",
        };
        return (
          <div className="flex items-center gap-1.5">
            <span className={`rounded-full border px-2 py-0.5 text-xs ${colors[status] || ""}`}>{status}</span>
            {row._spmbInternal && (
              <span className="rounded-full border border-info/30 bg-info/10 px-1.5 py-0.5 text-xs text-info" title={`Siswa internal masih aktif di ${row._academicLembagaNama || "lembaga asal"}`}>Internal</span>
            )}
            {row.terverifikasi && (
              <span className="inline-flex items-center gap-0.5 rounded-full border border-success/30 bg-success/15 px-1.5 py-0.5 text-xs text-success" title="Sudah diverifikasi pada Data SPMB">
                <CheckCircle2 className="h-3 w-3" />Verified
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "id",
      label: "Aksi",
      className: "w-80",
      render: (_, row) => {
        const status = row.status as string;
        const internalStudent = row._spmbInternal === true;
        const loading = nisLoadingId === (row.id as string);
        const kesiapan = getKesiapanPenerimaan(row);
        const detail = row._spmbDetail as Record<string, any> | undefined;
        const tesLoading = milestoneLoadingId === `${row.id}:tes`;
        const lulusLoading = milestoneLoadingId === `${row.id}:lulus`;
        const daftarUlangLoading = milestoneLoadingId === `${row.id}:daftar_ulang`;
        const targetYearForRow = detail?.tahun_ajaran_id
          ? tahunList.find((item: any) => item.id === detail.tahun_ajaran_id)
          : undefined;
        const activationStart = targetYearForRow?.tanggal_mulai
          ? new Date(`${targetYearForRow.tanggal_mulai}T00:00:00`)
          : null;
        const activationDateReady = !activationStart || Date.now() >= activationStart.getTime();
        const internalReadyForActivation = internalStudent
          && status === "diterima"
          && detail?.spmb_status_kelulusan === "lulus"
          && Boolean(detail?.spmb_tanggal_daftar_ulang)
          && !detail?.spmb_tanggal_aktivasi;
        return (
          <div className="flex flex-wrap gap-1" onClick={(event) => event.stopPropagation()}>
            <Button size="sm" variant="outline" onClick={() => navigate(`/akademik/siswa/${row.id}`)} title="Lihat biodata, checklist verifikasi & dokumen SPMB"><Eye className="h-3 w-3" /></Button>
            <Button size="sm" variant="outline" onClick={() => navigate(`/akademik/siswa/${row.id}/edit`)} title="Edit data lengkap"><Pencil className="h-3 w-3" /></Button>
            {!detail?.spmb_tanggal_tes && <Button size="sm" variant="outline" disabled={tesLoading} onClick={() => handleMilestone(row, "tes", "Sudah Tes")}>{tesLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : "Sudah Tes"}</Button>}
            {detail?.spmb_tanggal_tes && !detail?.spmb_status_kelulusan && <>
              <Button size="sm" variant="outline" disabled={lulusLoading} onClick={() => handleMilestone(row, "lulus", "Lulus")}>{lulusLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : "Lulus"}</Button>
              <Button size="sm" variant="outline" className="border-destructive/40 text-destructive" disabled={milestoneLoadingId === `${row.id}:tidak_lulus`} onClick={() => handleMilestone(row, "tidak_lulus", "Tidak Lulus")}>{milestoneLoadingId === `${row.id}:tidak_lulus` ? <RefreshCw className="h-3 w-3 animate-spin" /> : "Tidak Lulus"}</Button>
            </>}
            {detail?.spmb_status_kelulusan === "lulus" && !detail?.spmb_tanggal_daftar_ulang && <Button size="sm" variant="outline" disabled={daftarUlangLoading} onClick={() => handleMilestone(row, "daftar_ulang", "Daftar Ulang")}>{daftarUlangLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : "Daftar Ulang"}</Button>}
            {status === "calon" && (
              <span title={kesiapan.kekurangan.length ? `Lengkapi: ${kesiapan.kekurangan.join(", ")}` : "Terima calon murid"}>
                <Button size="sm" variant="outline" disabled={loading || !kesiapan.siap} onClick={() => handleTerima(row)}>{loading ? <RefreshCw className="h-3 w-3 animate-spin" /> : "Terima"}</Button>
              </span>
            )}
            {!internalStudent && status === "diterima" && !row.nis && <Button size="sm" variant="outline" className="border-warning/50 text-warning hover:bg-warning/10" disabled={loading} onClick={() => handleBuatNIS(row)}>{loading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <><RefreshCw className="mr-1 h-3 w-3" />Buat NIS</>}</Button>}
            {!internalStudent && status === "diterima" && (
              <span title={!row.nis ? "Buat NIS terlebih dahulu" : "Aktifkan murid"}>
                <Button size="sm" disabled={loading || !row.nis} onClick={() => handleAktifkan(row)}>Aktifkan</Button>
              </span>
            )}
            {internalReadyForActivation && (
              <span title={activationDateReady ? "Pilih kelas tujuan dan selesaikan perpindahan jenjang" : `Aktivasi baru dapat dilakukan mulai ${formatTanggal(targetYearForRow?.tanggal_mulai)}`}>
                <Button
                  size="sm"
                  disabled={!activationDateReady}
                  onClick={() => openInternalActivation(row)}
                >
                  Aktifkan ke Jenjang
                </Button>
              </span>
            )}
            {internalStudent && detail?.spmb_tanggal_aktivasi && (
              <span className="inline-flex items-center rounded-md border border-success/30 bg-success/10 px-2 py-1 text-xs text-success" title={`Diaktifkan ${formatTanggal(detail.spmb_tanggal_aktivasi)}`}>
                Aktif di Tujuan
              </span>
            )}
          </div>
        );
      },
    },
  ];

  const optionsLoading = angkatanQuery.isLoading || departemenQuery.isLoading || tahunQuery.isLoading;
  const optionsError = angkatanQuery.error || departemenQuery.error || tahunQuery.error;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Sistem Penerimaan Murid Baru (SPMB)</h1>
          <p className="text-sm text-muted-foreground">Pantau pendaftaran, seleksi, kelulusan, daftar ulang, dan penerimaan murid baru</p>
        </div>

        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            if (open) openRegistration();
            else requestCloseRegistration();
          }}
        >
          <DialogTrigger asChild>
            <Button className="min-h-11 px-4"><UserPlus className="mr-2 h-4 w-4" />Daftarkan Calon Murid</Button>
          </DialogTrigger>
          <DialogContent
            className="max-h-[92dvh] overflow-hidden p-0 sm:max-w-2xl"
            onEscapeKeyDown={(event) => {
              if (isSaving) event.preventDefault();
            }}
            onInteractOutside={(event) => {
              if (isSaving) event.preventDefault();
            }}
          >
            {registrationSuccess ? (
              <div className="p-6 sm:p-7">
                <div className="mx-auto flex max-w-xl flex-col items-center text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-success"><CheckCircle2 className="h-8 w-8" /></div>
                  <DialogHeader className="items-center">
                    <DialogTitle className="text-xl">Pendaftaran Penerimaan Murid Baru Berhasil</DialogTitle>
                  </DialogHeader>
                  <p className="mt-2 text-sm text-muted-foreground">
                    <strong>{registrationSuccess.nama}</strong> sudah tercatat sebagai <strong>calon murid</strong>. Penyimpanan ini belum menyatakan lulus atau diterima.
                  </p>

                  <div className="mt-5 w-full space-y-3 rounded-lg border bg-muted/30 p-4 text-left text-sm">
                    <p className="font-medium">Data yang masih perlu dilengkapi</p>
                    <p className="text-muted-foreground">Lengkapi biodata, Kartu Keluarga dan Akta Kelahiran. Rapor serta Ijazah/SKHUN mengikuti ketentuan bila tersedia. Penempatan kelas dilakukan sebelum tahap penerimaan.</p>
                    {hasActiveFilters && <p className="rounded-md border bg-background p-2 text-xs text-muted-foreground">Filter daftar pendaftar sedang aktif dan dapat menyembunyikan record baru. Tombol “Lengkapi Biodata & Dokumen” di bawah tetap membuka record yang baru dibuat melalui ID hasil penyimpanan.</p>}
                    {registrationSuccess.gratis_pendaftaran ? (
                      <p className="rounded-md border border-success/20 bg-success/5 p-3 text-success">
                        Calon murid ini mendapatkan gratis biaya pendaftaran pada <strong>{registrationSuccess.gelombang_nama || "gelombang aktif"}</strong>.
                      </p>
                    ) : (
                      <p className="rounded-md border border-warning/20 bg-warning/5 p-3 text-warning">
                        Calon murid tercatat pada <strong>{registrationSuccess.gelombang_nama || "gelombang aktif"}</strong> dengan biaya pendaftaran normal.
                      </p>
                    )}
                  </div>

                  <div className="mt-6 flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="outline" className="min-h-11" onClick={closeRegistration}>Kembali ke Daftar Pendaftar</Button>
                    <Button type="button" className="min-h-11" onClick={() => navigate(`/akademik/siswa/${registrationSuccess.id}/edit`)}>Lengkapi Biodata & Dokumen</Button>
                  </div>
                </div>
              </div>
            ) : (
              <form onSubmit={handleDaftar} className="flex max-h-[92dvh] flex-col" noValidate>
                <div className="border-b bg-background px-6 py-5">
                  <DialogHeader>
                    <DialogTitle>Daftarkan Calon Murid</DialogTitle>
                  </DialogHeader>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Catat data awal calon murid. Dokumen dan kelas dapat dilengkapi setelah penyimpanan; status tetap <strong>calon</strong> sampai seluruh syarat penerimaan terpenuhi.
                  </p>
                </div>

                <fieldset disabled={isSaving} className="min-h-0 flex-1 overflow-y-auto px-6 py-5 disabled:opacity-70">
                  <div className="space-y-6">
                    {optionsError && (
                      <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Pilihan lembaga/tahun ajaran gagal dimuat. Tutup formulir lalu coba kembali.
                      </div>
                    )}

                    <section className="space-y-4" aria-labelledby="spmb-section-calon">
                      <div>
                        <h3 id="spmb-section-calon" className="font-semibold">Data Calon Murid</h3>
                        <p className="text-xs text-muted-foreground">Identitas dasar untuk membuat record pendaftaran.</p>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label htmlFor="spmb-nama">Nama Lengkap *</Label>
                          <Input
                            id="spmb-nama"
                            autoComplete="name"
                            value={formData.nama}
                            aria-invalid={Boolean(formErrors.nama)}
                            onChange={(event) => {
                              setFormData((current) => ({ ...current, nama: event.target.value }));
                              if (formErrors.nama) setFormErrors((current) => ({ ...current, nama: undefined }));
                            }}
                          />
                          {formErrors.nama && <p className="text-xs text-destructive" role="alert">{formErrors.nama}</p>}
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="spmb-nik">NIK Calon Murid *</Label>
                          <Input
                            id="spmb-nik"
                            inputMode="numeric"
                            autoComplete="off"
                            maxLength={16}
                            value={formData.nik}
                            aria-invalid={Boolean(formErrors.nik)}
                            onChange={(event) => {
                              setFormData((current) => ({ ...current, nik: normalizeDigits(event.target.value).slice(0, 16) }));
                              if (formErrors.nik) setFormErrors((current) => ({ ...current, nik: undefined }));
                            }}
                            placeholder="16 digit NIK"
                          />
                          {formErrors.nik && <p className="text-xs text-destructive" role="alert">{formErrors.nik}</p>}
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="spmb-jenis_kelamin">Jenis Kelamin *</Label>
                          <Select value={formData.jenis_kelamin} onValueChange={(value: "L" | "P") => setFormData((current) => ({ ...current, jenis_kelamin: value }))}>
                            <SelectTrigger id="spmb-jenis_kelamin" className="min-h-11"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="L">Laki-laki</SelectItem><SelectItem value="P">Perempuan</SelectItem></SelectContent>
                          </Select>
                        </div>
                      </div>
                    </section>

                    <section className="space-y-4" aria-labelledby="spmb-section-tujuan">
                      <div>
                        <h3 id="spmb-section-tujuan" className="font-semibold">Tujuan Pendaftaran</h3>
                        <p className="text-xs text-muted-foreground">Lembaga, periode dan angkatan mengikuti ketentuan SPMB saat ini.</p>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label htmlFor="spmb-departemen_id">Lembaga / Sekolah *</Label>
                          <Select
                            value={formData.departemen_id}
                            onValueChange={(value) => {
                              const matching = angkatanList.find((a: any) => a.departemen_id === value && String(a.nama || "").trim() === SPMB_TARGET_COHORT && a.aktif !== false);
                              setFormData((current) => ({ ...current, departemen_id: value, angkatan_id: matching?.id || "" }));
                              setFormErrors((current) => ({ ...current, departemen_id: undefined, angkatan_id: undefined }));
                            }}
                          >
                            <SelectTrigger id="spmb-departemen_id" className="min-h-11" aria-invalid={Boolean(formErrors.departemen_id)}>
                              <SelectValue placeholder={optionsLoading ? "Memuat lembaga..." : "Pilih lembaga"} />
                            </SelectTrigger>
                            <SelectContent>
                              {spmbDepartemenList.length ? spmbDepartemenList.map((dept: any) => <SelectItem key={dept.id} value={dept.id}>{labelDepartemenSpmb(dept)}</SelectItem>) : <SelectItem value="__empty" disabled>Belum ada lembaga SPMB yang tersedia</SelectItem>}
                            </SelectContent>
                          </Select>
                          {formErrors.departemen_id && <p className="text-xs text-destructive" role="alert">{formErrors.departemen_id}</p>}
                          {selectedDept && !selectedDept.npsn && <p className="flex items-center gap-1.5 text-xs text-warning"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />NPSN lembaga belum tersedia. Pendaftaran tetap dapat dicatat, tetapi NPSN harus dilengkapi sebelum pembuatan NIS/penerimaan.</p>}
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="spmb-tahun_ajaran_id">Periode Tahun Ajaran *</Label>
                          <Input id="spmb-tahun_ajaran_id" value={targetYear ? "2027–2028" : "Belum dikonfigurasi"} disabled aria-invalid={Boolean(formErrors.tahun_ajaran_id)} />
                          {formErrors.tahun_ajaran_id && <p className="text-xs text-destructive" role="alert">{formErrors.tahun_ajaran_id}</p>}
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="spmb-angkatan_id">Angkatan *</Label>
                          <Input id="spmb-angkatan_id" value={!formData.departemen_id ? "Pilih lembaga terlebih dahulu" : targetAngkatan ? "2027" : "Belum dikonfigurasi untuk lembaga ini"} disabled aria-invalid={Boolean(formErrors.angkatan_id)} />
                          {formErrors.angkatan_id && <p className="text-xs text-destructive" role="alert">{formErrors.angkatan_id}</p>}
                        </div>
                        <div className="space-y-1.5">
                          <Label>Kategori *</Label>
                          <Select value={formData.kategori} onValueChange={(value) => setFormData((current) => ({ ...current, kategori: value }))}>
                            <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={SPMB_CATEGORY_VALUE}>{SPMB_CATEGORY_LABEL}</SelectItem>
                              <SelectItem value={SPMB_TRANSFER_CATEGORY_VALUE}>{SPMB_TRANSFER_CATEGORY_LABEL}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {selectedDeptNeedsNisn && (
                          <div className="space-y-1.5">
                            <Label htmlFor="spmb-nisn">NISN *</Label>
                            <Input
                              id="spmb-nisn"
                              inputMode="numeric"
                              maxLength={10}
                              value={formData.nisn}
                              aria-invalid={Boolean(formErrors.nisn)}
                              onChange={(event) => {
                                setFormData((current) => ({ ...current, nisn: normalizeDigits(event.target.value).slice(0, 10) }));
                                if (formErrors.nisn) setFormErrors((current) => ({ ...current, nisn: undefined }));
                              }}
                              placeholder="10 digit NISN"
                            />
                            {formErrors.nisn && <p className="text-xs text-destructive" role="alert">{formErrors.nisn}</p>}
                          </div>
                        )}
                      </div>
                    </section>

                    <section className="space-y-4" aria-labelledby="spmb-section-kontak">
                      <div>
                        <h3 id="spmb-section-kontak" className="font-semibold">Kontak Orang Tua / Wali</h3>
                        <p className="text-xs text-muted-foreground">Kontak awal untuk menghubungi keluarga terkait jadwal dan tahapan seleksi.</p>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="spmb-telepon">No. HP / WhatsApp yang Bisa Dihubungi *</Label>
                          <Input
                            id="spmb-telepon"
                            inputMode="tel"
                            autoComplete="tel"
                            value={formData.telepon}
                            aria-invalid={Boolean(formErrors.telepon)}
                            onChange={(event) => {
                              setFormData((current) => ({ ...current, telepon: event.target.value }));
                              if (formErrors.telepon) setFormErrors((current) => ({ ...current, telepon: undefined }));
                            }}
                            placeholder="08xxxxxxxxxx"
                          />
                          {formErrors.telepon && <p className="text-xs text-destructive" role="alert">{formErrors.telepon}</p>}
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label htmlFor="spmb-alamat">Alamat Rumah *</Label>
                          <Textarea
                            id="spmb-alamat"
                            value={formData.alamat}
                            aria-invalid={Boolean(formErrors.alamat)}
                            onChange={(event) => {
                              setFormData((current) => ({ ...current, alamat: event.target.value }));
                              if (formErrors.alamat) setFormErrors((current) => ({ ...current, alamat: undefined }));
                            }}
                            rows={3}
                          />
                          {formErrors.alamat && <p className="text-xs text-destructive" role="alert">{formErrors.alamat}</p>}
                        </div>
                      </div>
                    </section>

                    <section className="space-y-3 rounded-lg border bg-muted/20 p-4" aria-labelledby="spmb-section-lanjutan">
                      <div>
                        <h3 id="spmb-section-lanjutan" className="font-semibold">Setelah Pendaftaran Disimpan</h3>
                        <p className="mt-1 text-sm text-muted-foreground">Jalur admin ini hanya mencatat data awal. KK dan Akta Kelahiran wajib dilengkapi sebelum penerimaan. Rapor dan Ijazah/SKHUN hanya diwajibkan untuk Siswa Pindahan. Tinggi badan, berat badan, lingkar kepala dan ukuran baju belum diisi pada tahap ini.</p>
                      </div>
                      <div className="rounded-md border border-warning/20 bg-warning/5 p-3 text-xs text-warning">
                        Kelas tidak dipaksakan saat pendaftaran awal. Sistem tetap mewajibkan kelas, verifikasi, dokumen, biaya pendaftaran (atau hak gratis), angkatan dan NPSN sebelum calon murid dapat diterima.
                      </div>
                    </section>
                  </div>
                </fieldset>

                <div className="flex flex-col-reverse gap-2 border-t bg-background px-6 py-4 sm:flex-row sm:justify-end">
                  <Button type="button" variant="outline" className="min-h-11" disabled={isSaving} onClick={requestCloseRegistration}>Batal</Button>
                  <Button type="submit" className="min-h-11" disabled={isSaving || optionsLoading || Boolean(optionsError)}>
                    {isSaving ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Menyimpan…</> : <><UserPlus className="mr-2 h-4 w-4" />Simpan Pendaftaran</>}
                  </Button>
                </div>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <Dialog
        open={Boolean(activationRow)}
        onOpenChange={(open) => {
          if (!open) closeInternalActivation();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Aktifkan ke Jenjang Tujuan</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{activationRow?.nama as string || "-"}</p>
              <p className="mt-1 text-muted-foreground">
                {activationRow?._academicLembagaNama as string || "Lembaga asal"} → {activationRow?._lembagaNama as string || "Lembaga tujuan"}
                {activationYear?.nama ? ` · ${activationYear.nama}` : ""}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Kelas Tujuan *</Label>
              <Select value={activationClassId} onValueChange={setActivationClassId} disabled={activationClassesLoading || activationLoading}>
                <SelectTrigger>
                  <SelectValue placeholder={activationClassesLoading ? "Memuat kelas..." : "Pilih kelas tujuan"} />
                </SelectTrigger>
                <SelectContent>
                  {activationClasses.map((kelas: any) => (
                    <SelectItem key={kelas.id} value={kelas.id}>
                      {kelas.tingkat?.nama ? `Tingkat ${kelas.tingkat.nama} · ` : ""}{kelas.nama}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!activationClassesLoading && activationClasses.length === 0 && (
                <p className="text-xs text-destructive">Belum ada kelas aktif pada lembaga tujuan.</p>
              )}
            </div>

            <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-muted-foreground">
              Proses ini atomik: kelas asal akan dinonaktifkan sebagai riwayat, siswa dipindahkan ke lembaga/angkatan tujuan, kelas baru diaktifkan, NIS tujuan dibuat otomatis, dan status SPMB menjadi selesai. NIS lama tetap tercatat pada audit identitas.
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={activationLoading} onClick={closeInternalActivation}>Batal</Button>
              <Button disabled={activationLoading || !activationClassId || activationClasses.length === 0} onClick={handleInternalActivation}>
                {activationLoading ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Memproses…</> : "Aktifkan ke Jenjang Tujuan"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Buang perubahan formulir?</AlertDialogTitle>
            <AlertDialogDescription>Isian pendaftaran yang belum disimpan akan hilang. Pilih “Tetap Mengisi” untuk kembali ke formulir.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Tetap Mengisi</AlertDialogCancel>
            <AlertDialogAction onClick={closeRegistration}>Buang Perubahan</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className={`grid gap-4 ${nisKosongCount > 0 ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
        <StatsCard title="Total Pendaftar" value={calonList.length} icon={Users} color="primary" />
        <StatsCard title="Menunggu" value={calonCount} icon={Clock} color="warning" />
        <StatsCard title="Diterima" value={diterimaCount} icon={UserCheck} color="success" />
        {nisKosongCount > 0 && <StatsCard title="NIS Belum Dibuat" value={nisKosongCount} icon={AlertTriangle} color="destructive" />}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard title="Asrama" value={asramaCount} icon={Users} color="primary" />
        <StatsCard title="Non Asrama" value={nonAsramaCount} icon={Users} color="warning" />
        <StatsCard title="Laki-laki" value={lakiCount} icon={Users} color="primary" />
        <StatsCard title="Perempuan" value={perempuanCount} icon={Users} color="success" />
      </div>

      {belumSiapCount > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div>
            <p className="font-medium">{belumSiapCount} calon belum siap diterima</p>
            <p className="text-muted-foreground">Verifikasi data dilakukan dari tab Data SPMB pada detail siswa. Tombol Terima aktif setelah verifikasi, dokumen wajib tersedia, biaya pendaftaran lunas atau gratis, angkatan dan kelas terisi, serta NPSN lembaga tersedia.</p>
          </div>
        </div>
      )}

      <div className="space-y-4 rounded-xl border bg-card p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Filter Pendaftar</p>
              <p className="text-xs text-muted-foreground">Menampilkan {filteredCalonList.length} dari {calonList.length} pendaftar</p>
            </div>
          </div>
          <Button variant="outline" size="sm" disabled={!hasActiveFilters} onClick={resetFilters}>Reset Filter</Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <div className="space-y-1"><Label className="text-xs">Urutkan</Label><Select value={sortMode} onValueChange={setSortMode}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="registration_desc">Pendaftaran terbaru</SelectItem><SelectItem value="registration_asc">Pendaftaran terlama</SelectItem><SelectItem value="payment_desc">Pembayaran terbaru</SelectItem><SelectItem value="payment_asc">Pembayaran terlama</SelectItem></SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">Lembaga</Label><Select value={filters.departemen} onValueChange={(value) => setFilter("departemen", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Semua lembaga</SelectItem>{spmbDepartemenList.map((dept: any) => <SelectItem key={dept.id} value={dept.id}>{labelDepartemenSpmb(dept)}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">Status</Label><Select value={filters.status} onValueChange={(value) => setFilter("status", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Semua status</SelectItem><SelectItem value="calon">Calon</SelectItem><SelectItem value="diterima">Diterima</SelectItem><SelectItem value="selesai">Selesai</SelectItem></SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">Jenis Kelamin</Label><Select value={filters.jenisKelamin} onValueChange={(value) => setFilter("jenisKelamin", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Semua</SelectItem><SelectItem value="L">Laki-laki</SelectItem><SelectItem value="P">Perempuan</SelectItem></SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">Tes</Label><Select value={filters.tes} onValueChange={(value) => setFilter("tes", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Semua</SelectItem><SelectItem value="sudah">Sudah tes</SelectItem><SelectItem value="belum">Belum tes</SelectItem></SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">Kelulusan</Label><Select value={filters.kelulusan} onValueChange={(value) => setFilter("kelulusan", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Semua</SelectItem><SelectItem value="lulus">Lulus</SelectItem><SelectItem value="tidak_lulus">Tidak Lulus</SelectItem><SelectItem value="belum">Belum ditentukan</SelectItem></SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">Daftar Ulang</Label><Select value={filters.daftarUlang} onValueChange={(value) => setFilter("daftarUlang", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Semua</SelectItem><SelectItem value="sudah">Sudah daftar ulang</SelectItem><SelectItem value="belum">Belum daftar ulang</SelectItem></SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">Biaya Pendaftaran</Label><Select value={filters.biaya} onValueChange={(value) => setFilter("biaya", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Semua</SelectItem><SelectItem value="gratis">Gratis</SelectItem><SelectItem value="lunas">Lunas</SelectItem><SelectItem value="belum_bayar">Belum bayar</SelectItem><SelectItem value="belum_diatur">Belum diatur</SelectItem></SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">Kesiapan</Label><Select value={filters.kesiapan} onValueChange={(value) => setFilter("kesiapan", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Semua</SelectItem><SelectItem value="siap">Siap diterima</SelectItem><SelectItem value="belum">Belum lengkap</SelectItem></SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">Verifikasi</Label><Select value={filters.verifikasi} onValueChange={(value) => setFilter("verifikasi", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Semua</SelectItem><SelectItem value="sudah">Sudah diverifikasi</SelectItem><SelectItem value="belum">Belum diverifikasi</SelectItem></SelectContent></Select></div>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={sortedCalonList as Record<string, unknown>[]}
        searchPlaceholder="Cari nama, NIS, lembaga, atau angkatan..."
        loading={isLoading}
        pageSize={20}
        onRowClick={(row) => navigate(`/akademik/siswa/${row.id}`)}
      />
    </div>
  );
}
