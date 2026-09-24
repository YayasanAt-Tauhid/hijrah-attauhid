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
  ArrowRightLeft,
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
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { AdminSpmbRegistrationDialog } from "@/components/akademik/AdminSpmbRegistrationDialog";
import { spmbAdminUpdateRegistrantName, spmbAdminUpdateRegistrationMethod } from "@/server/pmb";

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

const SPMB_EXPORT_COLUMNS = [
  { key: "nama", label: "Nama Siswa" },
  { key: "nis", label: "NIS" },
  { key: "nisn", label: "NISN" },
  { key: "_exportNik", label: "NIK" },
  { key: "_exportJenisKelamin", label: "Jenis Kelamin" },
  { key: "telepon", label: "No. HP / WhatsApp" },
  { key: "email", label: "Email" },
  { key: "alamat", label: "Alamat" },
  { key: "_lembagaNama", label: "Lembaga Tujuan" },
  { key: "_angkatanNama", label: "Angkatan" },
  { key: "_exportKategori", label: "Kategori" },
  { key: "_spmbAsrama", label: "Status Asrama" },
  { key: "_exportTanggalPendaftaran", label: "Tanggal Pendaftaran" },
  { key: "_exportBiaya", label: "Biaya Pendaftaran" },
  { key: "_exportTanggalBayar", label: "Tanggal Bayar" },
  { key: "_exportStatusTes", label: "Status Tes" },
  { key: "_exportTanggalTes", label: "Tanggal Tes" },
  { key: "_exportStatusKelulusan", label: "Status Kelulusan" },
  { key: "_exportTanggalKeputusan", label: "Tanggal Keputusan" },
  { key: "_exportTanggalLulus", label: "Tanggal Lulus" },
  { key: "_exportStatusDaftarUlang", label: "Status Daftar Ulang" },
  { key: "_exportTanggalDaftarUlang", label: "Tanggal Daftar Ulang" },
  { key: "_exportKesiapan", label: "Kesiapan Penerimaan" },
  { key: "_exportKekurangan", label: "Kekurangan Data" },
  { key: "_exportVerifikasi", label: "Verifikasi" },
  { key: "_exportStatusPendaftaran", label: "Status Pendaftaran" },
  { key: "_exportSumber", label: "Metode Pendaftaran" },
  { key: "_spmbInputer", label: "Nama Pendaftar" },
];

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
  const { role } = useAuth();
  const canChangeSpmbTarget = role === "admin" || role === "admin_tu";
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
  const [targetChangeRow, setTargetChangeRow] = useState<Record<string, unknown> | null>(null);
  const [targetChangeDeptId, setTargetChangeDeptId] = useState("");
  const [targetChangeCohortId, setTargetChangeCohortId] = useState("");
  const [targetChangeAsrama, setTargetChangeAsrama] = useState("");
  const [targetChangeReason, setTargetChangeReason] = useState("");
  const [targetChangeLoading, setTargetChangeLoading] = useState(false);
  const [registrantEditRow, setRegistrantEditRow] = useState<Record<string, unknown> | null>(null);
  const [registrantEditName, setRegistrantEditName] = useState("");
  const [registrantEditLoading, setRegistrantEditLoading] = useState(false);
  const [methodEditRow, setMethodEditRow] = useState<Record<string, unknown> | null>(null);
  const [methodEditValue, setMethodEditValue] = useState<"online" | "offline">("online");
  const [methodEditLoading, setMethodEditLoading] = useState(false);
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
          .select("id,siswa_id,tahun_ajaran_id,nik,status_asrama,kategori,dokumen_kk_path,dokumen_akta_path,spmb_tanggal_tes,spmb_tanggal_lulus,spmb_tanggal_daftar_ulang,spmb_status_kelulusan,spmb_tanggal_keputusan,spmb_departemen_tujuan_id,spmb_angkatan_tujuan_id,spmb_status_pendaftaran,spmb_siswa_internal,spmb_kelas_tujuan_id,spmb_tanggal_aktivasi,spmb_gelombang_id,spmb_registered_at,spmb_inputer_nama,spmb_inputer_email,spmb_sumber_pendaftaran,spmb_metode_pendaftaran")
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
          _spmbInputer: detail?.spmb_inputer_nama || "",
          _spmbSource: detail?.spmb_metode_pendaftaran === "online" || detail?.spmb_metode_pendaftaran === "offline"
            ? detail.spmb_metode_pendaftaran
            : detail?.spmb_sumber_pendaftaran === "admin"
              ? "offline"
              : detail?.spmb_sumber_pendaftaran === "publik"
                ? "online"
                : "unknown",
          _biayaSort: biayaSort,
          _kesiapanSort: r?.siap ? "siap" : "belum",
          _verifikasiSort: s.terverifikasi ? "sudah" : "belum",
          _exportNik: detail?.nik || "",
          _exportJenisKelamin: s.jenis_kelamin === "L" ? "Laki-laki" : s.jenis_kelamin === "P" ? "Perempuan" : "",
          _exportKategori: detail?.kategori || "",
          _exportTanggalPendaftaran: formatTanggal(detail?.spmb_registered_at || s.created_at),
          _exportBiaya: r?.gratis_pendaftaran
            ? "Gratis"
            : !r?.configured
              ? "Belum diatur"
              : r?.lunas
                ? "Lunas"
                : "Belum bayar",
          _exportTanggalBayar: formatTanggal(r?.tanggal_pembayaran),
          _exportStatusTes: detail?.spmb_tanggal_tes ? "Sudah Tes" : "Belum Tes",
          _exportTanggalTes: formatTanggal(detail?.spmb_tanggal_tes),
          _exportStatusKelulusan: detail?.spmb_status_kelulusan === "lulus"
            ? "Lulus"
            : detail?.spmb_status_kelulusan === "tidak_lulus"
              ? "Tidak Lulus"
              : "Belum Ditentukan",
          _exportTanggalKeputusan: formatTanggal(detail?.spmb_tanggal_keputusan),
          _exportTanggalLulus: formatTanggal(detail?.spmb_tanggal_lulus),
          _exportStatusDaftarUlang: detail?.spmb_tanggal_daftar_ulang ? "Sudah Daftar Ulang" : "Belum Daftar Ulang",
          _exportTanggalDaftarUlang: formatTanggal(detail?.spmb_tanggal_daftar_ulang),
          _exportKesiapan: r?.siap ? "Siap diterima" : "Belum lengkap",
          _exportKekurangan: Array.isArray(r?.kekurangan) ? r.kekurangan.join("; ") : "",
          _exportVerifikasi: s.terverifikasi ? "Sudah diverifikasi" : "Belum diverifikasi",
          _exportStatusPendaftaran: registrationStatus === "calon"
            ? "Calon"
            : registrationStatus === "diterima"
              ? "Diterima"
              : registrationStatus === "selesai"
                ? "Selesai"
                : registrationStatus,
          _exportSumber: detail?.spmb_metode_pendaftaran === "offline"
            ? "Offline"
            : detail?.spmb_metode_pendaftaran === "online"
              ? "Online"
              : detail?.spmb_sumber_pendaftaran === "admin"
                ? "Offline"
                : detail?.spmb_sumber_pendaftaran === "publik"
                  ? "Online"
                  : "Belum diklasifikasikan",
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

  const {
    data: targetChangeRef = { departemen: [], angkatan: [] } as any,
    isLoading: targetChangeRefLoading,
    error: targetChangeRefError,
  } = useQuery({
    queryKey: ["spmb", "target-change-reference", targetChangeRow?.id],
    enabled: Boolean(targetChangeRow?.id) && canChangeSpmbTarget,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("spmb_target_change_reference", {
        p_siswa_id: targetChangeRow?.id,
      });
      if (error) throw error;
      return data || { departemen: [], angkatan: [] };
    },
  });

  const targetChangeDept = (targetChangeRef.departemen || []).find(
    (dept: any) => dept.id === targetChangeDeptId,
  );
  const targetChangeCode = String(targetChangeDept?.kode || "").trim().toUpperCase();
  const targetChangeNeedsAsrama = ["SMP", "SMA", "MTA"].includes(targetChangeCode)
    || /(^|\s)(SMP|SMA|MTA)(\s|$)/.test(String(targetChangeDept?.nama || "").trim().toUpperCase());
  const targetChangeInternal = targetChangeRow?._spmbInternal === true;
  const targetChangeCohorts = (targetChangeRef.angkatan || []).filter(
    (cohort: any) => cohort.departemen_id === targetChangeDeptId,
  );
  const targetChangeDetail = targetChangeRow?._spmbDetail as Record<string, any> | undefined;
  const targetChangeHasMilestones = Boolean(
    targetChangeDetail?.spmb_tanggal_tes
    || targetChangeDetail?.spmb_tanggal_lulus
    || targetChangeDetail?.spmb_tanggal_daftar_ulang
    || targetChangeDetail?.spmb_status_kelulusan
    || targetChangeDetail?.spmb_tanggal_keputusan
    || (targetChangeDetail?.spmb_status_pendaftaran && targetChangeDetail.spmb_status_pendaftaran !== "calon")
  );
  const targetChangeActuallyChanged = Boolean(
    targetChangeRow
    && (
      targetChangeDeptId !== targetChangeRow.departemen_id
      || targetChangeCohortId !== targetChangeRow.angkatan_id
    )
  );

  const statistikCalonList = filters.departemen === "all"
    ? calonList
    : calonList.filter((s: any) => s.departemen_id === filters.departemen);
  const statistikDepartemen = filters.departemen === "all"
    ? null
    : spmbDepartemenList.find((dept: any) => dept.id === filters.departemen);
  const statistikLabel = statistikDepartemen ? labelDepartemenSpmb(statistikDepartemen) : "Semua lembaga";

  const calonCount = statistikCalonList.filter((s: any) => s.status === "calon").length;
  const diterimaCount = statistikCalonList.filter((s: any) => s.status === "diterima").length;
  const nisKosongCount = statistikCalonList.filter((s: any) => s.status === "diterima" && !s.nis).length;
  const asramaCount = statistikCalonList.filter((s: any) => s._spmbDetail?.status_asrama === "asrama").length;
  const nonAsramaCount = statistikCalonList.filter((s: any) => s._spmbDetail?.status_asrama === "non_asrama").length;
  const lakiCount = statistikCalonList.filter((s: any) => s.jenis_kelamin === "L").length;
  const perempuanCount = statistikCalonList.filter((s: any) => s.jenis_kelamin === "P").length;
  const onlineCount = statistikCalonList.filter((s: any) => s._spmbSource === "online").length;
  const offlineCount = statistikCalonList.filter((s: any) => s._spmbSource === "offline").length;
  const unknownSourceCount = statistikCalonList.filter((s: any) => s._spmbSource === "unknown").length;
  const belumSiapCount = statistikCalonList.filter(
    (s: any) => s.status === "calon" && !getKesiapanPenerimaan(s as Record<string, unknown>).siap,
  ).length;
  const pendaftarPerLembaga = spmbDepartemenList.map((dept: any) => ({
    id: dept.id as string,
    kode: String(dept.kode || dept.nama || "Lembaga").trim().toUpperCase(),
    nama: String(dept.nama || dept.kode || "Lembaga").trim(),
    jumlah: calonList.filter((s: any) => s.departemen_id === dept.id).length,
  }));
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
    try {
      const { nis } = await generateNISViaEdgeFunction({
        siswa_id: siswaId,
        departemen_id: departemenId,
        angkatan_id: angkatanId,
      });
      toast.success(`NIS berhasil dibuat: ${nis}`, { description: namaSiswa });
      return true;
    } catch (error: any) {
      const pesan: string = error.message || "Terjadi kesalahan teknis";
      toast.error(`NIS gagal dibuat untuk ${namaSiswa}`, {
        description: pesan,
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
      const { error } = await supabase.from("siswa").update({ status: "diterima" } as any).eq("id", id);
      if (error) throw error;

      let nisBerhasil = Boolean(row.nis);
      if (!row.nis) {
        nisBerhasil = await generateNIS(id, departemenId, angkatanId, namaSiswa);
      }

      await qc.invalidateQueries({ queryKey: ["siswa"] });
      toast.success(`${namaSiswa} berhasil diterima`, {
        description: nisBerhasil
          ? "Calon sudah lulus dan diterima. NIS lembaga berhasil ditetapkan."
          : "Calon sudah diterima, tetapi NIS belum berhasil dibuat. Gunakan tombol Buat NIS sebelum aktivasi.",
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

  const openTargetChange = (row: Record<string, unknown>) => {
    const detail = row._spmbDetail as Record<string, any> | undefined;
    setTargetChangeRow(row);
    setTargetChangeDeptId((row.departemen_id as string) || "");
    setTargetChangeCohortId((row.angkatan_id as string) || "");
    setTargetChangeAsrama(detail?.status_asrama || "");
    setTargetChangeReason("");
  };

  const closeTargetChange = () => {
    if (targetChangeLoading) return;
    setTargetChangeRow(null);
    setTargetChangeDeptId("");
    setTargetChangeCohortId("");
    setTargetChangeAsrama("");
    setTargetChangeReason("");
  };

  const handleTargetChange = async () => {
    if (!targetChangeRow || !targetChangeDeptId || !targetChangeCohortId) {
      toast.error("Pilih lembaga dan angkatan tujuan");
      return;
    }
    if (!targetChangeActuallyChanged) {
      toast.error("Lembaga dan angkatan tujuan belum berubah");
      return;
    }
    if (targetChangeNeedsAsrama && !(targetChangeCode === "MTA" && !targetChangeInternal) && !targetChangeAsrama) {
      toast.error("Pilih status Asrama / Non Asrama");
      return;
    }
    if (targetChangeReason.trim().length < 5) {
      toast.error("Alasan perubahan tujuan wajib diisi minimal 5 karakter");
      return;
    }

    const oldName = (targetChangeRow._lembagaNama as string) || "lembaga lama";
    const newName = targetChangeDept?.nama || "lembaga baru";
    const resetMessage = targetChangeHasMilestones
      ? "\n\nStatus Tes/Lulus/Daftar Ulang yang sudah ada akan direset agar lembaga baru memproses ulang."
      : "";
    if (!window.confirm(
      `Ubah tujuan SPMB ${targetChangeRow.nama as string} dari ${oldName} ke ${newName}?${resetMessage}`,
    )) return;

    setTargetChangeLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc("spmb_change_registration_target", {
        p_siswa_id: targetChangeRow.id,
        p_departemen_tujuan_id: targetChangeDeptId,
        p_angkatan_tujuan_id: targetChangeCohortId,
        p_status_asrama: targetChangeNeedsAsrama
          ? (targetChangeCode === "MTA" && !targetChangeInternal ? "asrama" : targetChangeAsrama)
          : null,
        p_alasan: targetChangeReason.trim(),
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;

      await Promise.all([
        qc.invalidateQueries({ queryKey: ["siswa"] }),
        qc.invalidateQueries({ queryKey: ["siswa", "calon"] }),
        qc.invalidateQueries({ queryKey: ["siswa_detail"] }),
        qc.invalidateQueries({ queryKey: ["spmb_verification_overview"] }),
      ]);

      toast.success(`Tujuan SPMB ${targetChangeRow.nama as string} berhasil diubah ke ${newName}`, {
        description: result?.milestones_reset
          ? "Tahapan Tes/Lulus/Daftar Ulang lama direset. Pendaftaran yang sama tetap dipakai."
          : "Pendaftaran yang sama tetap dipakai; data siswa tidak digandakan.",
        duration: 10000,
      });
      closeTargetChange();
    } catch (error: any) {
      toast.error("Gagal mengubah tujuan SPMB", {
        description: error?.message || "Terjadi kesalahan teknis",
        duration: 12000,
      });
    } finally {
      setTargetChangeLoading(false);
    }
  };

  const openRegistrantEdit = (row: Record<string, unknown>) => {
    setRegistrantEditRow(row);
    setRegistrantEditName(String(row._spmbInputer || ""));
  };

  const closeRegistrantEdit = () => {
    if (registrantEditLoading) return;
    setRegistrantEditRow(null);
    setRegistrantEditName("");
  };

  const handleRegistrantEdit = async () => {
    if (!registrantEditRow) return;
    const nama = registrantEditName.trim();
    if (nama.length < 2) {
      toast.error("Nama Pendaftar wajib diisi");
      return;
    }

    setRegistrantEditLoading(true);
    try {
      const detail = registrantEditRow._spmbDetail as Record<string, any> | undefined;
      await spmbAdminUpdateRegistrantName({
        data: {
          siswa_id: String(registrantEditRow.id || ""),
          detail_id: detail?.id ? String(detail.id) : undefined,
          nama,
        },
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["siswa", "calon"] }),
        qc.invalidateQueries({ queryKey: ["siswa_detail"] }),
      ]);
      toast.success("Nama Pendaftar berhasil disimpan");
      setRegistrantEditRow(null);
      setRegistrantEditName("");
    } catch (error: any) {
      toast.error("Gagal menyimpan Nama Pendaftar", {
        description: error?.message || "Terjadi kesalahan teknis",
      });
    } finally {
      setRegistrantEditLoading(false);
    }
  };

  const openMethodEdit = (row: Record<string, unknown>) => {
    setMethodEditRow(row);
    setMethodEditValue(row._spmbSource === "offline" ? "offline" : "online");
  };

  const closeMethodEdit = () => {
    if (methodEditLoading) return;
    setMethodEditRow(null);
  };

  const handleMethodEdit = async () => {
    if (!methodEditRow) return;
    setMethodEditLoading(true);
    try {
      const detail = methodEditRow._spmbDetail as Record<string, any> | undefined;
      await spmbAdminUpdateRegistrationMethod({
        data: {
          siswa_id: String(methodEditRow.id || ""),
          detail_id: detail?.id ? String(detail.id) : undefined,
          metode: methodEditValue,
        },
      });
      await qc.invalidateQueries({ queryKey: ["siswa", "calon"] });
      toast.success("Metode pendaftaran berhasil diperbarui", {
        description: methodEditValue === "offline" ? "Ditandai sebagai pendaftaran Offline." : "Ditandai sebagai pendaftaran Online.",
      });
      setMethodEditRow(null);
    } catch (error: any) {
      toast.error("Gagal mengubah metode pendaftaran", {
        description: error?.message || "Terjadi kesalahan teknis",
      });
    } finally {
      setMethodEditLoading(false);
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
    {
      key: "_spmbSource",
      label: "Metode",
      sortable: true,
      render: (value, row) => (
        <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
          {value === "offline"
            ? <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs text-warning">Offline</span>
            : value === "online"
              ? <span className="rounded-full border border-info/30 bg-info/10 px-2 py-0.5 text-xs text-info">Online</span>
              : <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">Belum diketahui</span>}
          {canChangeSpmbTarget && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              title="Edit Online / Offline"
              onClick={() => openMethodEdit(row)}
            >
              <Pencil className="h-3 w-3" />
            </Button>
          )}
        </div>
      ),
    },
    {
      key: "_spmbInputer",
      label: "Nama Pendaftar",
      sortable: true,
      render: (value, row) => (
        <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
          <span className={(value as string) ? "text-xs" : "text-xs text-warning"}>
            {(value as string) || "Belum diisi"}
          </span>
          {canChangeSpmbTarget && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              title="Edit Nama Pendaftar"
              onClick={() => openRegistrantEdit(row)}
            >
              <Pencil className="h-3 w-3" />
            </Button>
          )}
        </div>
      ),
    },
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
            {canChangeSpmbTarget
              && !detail?.spmb_tanggal_aktivasi
              && detail?.spmb_status_pendaftaran !== "selesai"
              && (internalStudent || row._academicStatus !== "aktif")
              && (
                <span title={row._pmbLunas && !row._pmbGratis ? "Sudah ada pembayaran pendaftaran; koreksi tujuan harus diselesaikan bersama bagian keuangan." : "Ubah lembaga/jenjang tujuan SPMB"}>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={Boolean(row._pmbLunas && !row._pmbGratis)}
                    onClick={() => openTargetChange(row)}
                  >
                    <ArrowRightLeft className="mr-1 h-3 w-3" />Ubah Tujuan
                  </Button>
                </span>
              )}
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

        <AdminSpmbRegistrationDialog
          departments={spmbDepartemenList}
          cohorts={angkatanList}
          academicYears={tahunList}
          disabled={optionsLoading || Boolean(optionsError)}
          onRegistered={async () => {
            await Promise.all([
              qc.invalidateQueries({ queryKey: ["siswa"] }),
              qc.invalidateQueries({ queryKey: ["siswa", "calon"] }),
              qc.invalidateQueries({ queryKey: ["spmb_verification_overview"] }),
            ]);
          }}
        />
      </div>

      <Dialog
        open={Boolean(methodEditRow)}
        onOpenChange={(open) => {
          if (!open) closeMethodEdit();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Metode Pendaftaran</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{methodEditRow?.nama as string || "-"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Gunakan Offline bila formulir sebenarnya diisikan/dibantu petugas secara langsung, walaupun sebelumnya memakai link /spmb.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Metode Pendaftaran *</Label>
              <Select value={methodEditValue} onValueChange={(value) => setMethodEditValue(value as "online" | "offline")} disabled={methodEditLoading}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="online">Online — pendaftar mengisi melalui /spmb</SelectItem>
                  <SelectItem value="offline">Offline — diinput/dibantu petugas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
              Koreksi ini hanya mengubah klasifikasi Online/Offline untuk statistik dan laporan. Jejak teknis asal pendaftaran tetap disimpan untuk audit.
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={methodEditLoading} onClick={closeMethodEdit}>Batal</Button>
              <Button disabled={methodEditLoading} onClick={handleMethodEdit}>
                {methodEditLoading
                  ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Menyimpan…</>
                  : "Simpan Metode"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(registrantEditRow)}
        onOpenChange={(open) => {
          if (!open) closeRegistrantEdit();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Nama Pendaftar</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{registrantEditRow?.nama as string || "-"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Nama ini adalah orang yang mengisi atau menyerahkan formulir SPMB.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="spmb-edit-registrant-name">Nama Pendaftar *</Label>
              <Input
                id="spmb-edit-registrant-name"
                value={registrantEditName}
                onChange={(event) => setRegistrantEditName(event.target.value)}
                placeholder="Masukkan nama pendaftar"
                disabled={registrantEditLoading}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={registrantEditLoading} onClick={closeRegistrantEdit}>Batal</Button>
              <Button
                disabled={registrantEditLoading || registrantEditName.trim().length < 2}
                onClick={handleRegistrantEdit}
              >
                {registrantEditLoading
                  ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Menyimpan…</>
                  : "Simpan Nama Pendaftar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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

      <Dialog
        open={Boolean(targetChangeRow)}
        onOpenChange={(open) => {
          if (!open) closeTargetChange();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ubah Lembaga/Jenjang Tujuan SPMB</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{targetChangeRow?.nama as string || "-"}</p>
              <p className="mt-1 text-muted-foreground">
                Tujuan saat ini: <strong>{targetChangeRow?._lembagaNama as string || "-"}</strong>
                {targetChangeRow?._angkatanNama ? ` · Angkatan ${targetChangeRow._angkatanNama as string}` : ""}
              </p>
              {targetChangeInternal && (
                <p className="mt-1 text-xs text-info">
                  Siswa internal tetap aktif di {targetChangeRow?._academicLembagaNama as string || "lembaga asal"} sampai proses SPMB tujuan baru selesai.
                </p>
              )}
            </div>

            {targetChangeRefError && (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                Referensi tujuan gagal dimuat: {targetChangeRefError instanceof Error ? targetChangeRefError.message : "Terjadi kesalahan."}
              </p>
            )}

            <div className="space-y-1.5">
              <Label>Lembaga/Jenjang Tujuan Baru *</Label>
              <Select
                value={targetChangeDeptId}
                disabled={targetChangeRefLoading || targetChangeLoading}
                onValueChange={(value) => {
                  setTargetChangeDeptId(value);
                  const currentCohortName = String(targetChangeRow?._angkatanNama || "").trim();
                  const matching = (targetChangeRef.angkatan || []).find(
                    (cohort: any) => cohort.departemen_id === value
                      && String(cohort.nama || "").trim() === currentCohortName,
                  );
                  const fallback = (targetChangeRef.angkatan || []).find(
                    (cohort: any) => cohort.departemen_id === value,
                  );
                  setTargetChangeCohortId(matching?.id || fallback?.id || "");

                  const dept = (targetChangeRef.departemen || []).find((item: any) => item.id === value);
                  const code = String(dept?.kode || "").trim().toUpperCase();
                  const needsAsrama = ["SMP", "SMA", "MTA"].includes(code)
                    || /(^|\s)(SMP|SMA|MTA)(\s|$)/.test(String(dept?.nama || "").trim().toUpperCase());
                  if (!needsAsrama) setTargetChangeAsrama("");
                  else if (code === "MTA" && !targetChangeInternal) setTargetChangeAsrama("asrama");
                  else {
                    const existing = (targetChangeRow?._spmbDetail as any)?.status_asrama;
                    setTargetChangeAsrama(existing === "asrama" || existing === "non_asrama" ? existing : "");
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={targetChangeRefLoading ? "Memuat lembaga..." : "Pilih lembaga tujuan"} />
                </SelectTrigger>
                <SelectContent>
                  {(targetChangeRef.departemen || []).map((dept: any) => (
                    <SelectItem key={dept.id} value={dept.id}>
                      {dept.kode || dept.nama} — {dept.nama}{dept.psb_dibuka === false ? " (SPMB publik ditutup)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Angkatan Tujuan *</Label>
              <Select
                value={targetChangeCohortId}
                onValueChange={setTargetChangeCohortId}
                disabled={!targetChangeDeptId || targetChangeLoading}
              >
                <SelectTrigger><SelectValue placeholder="Pilih angkatan tujuan" /></SelectTrigger>
                <SelectContent>
                  {targetChangeCohorts.map((cohort: any) => (
                    <SelectItem key={cohort.id} value={cohort.id}>{cohort.nama}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!targetChangeRefLoading && targetChangeDeptId && targetChangeCohorts.length === 0 && (
                <p className="text-xs text-destructive">Belum ada angkatan aktif pada lembaga tujuan ini.</p>
              )}
            </div>

            {targetChangeNeedsAsrama && (
              <div className="space-y-1.5">
                <Label>Status Asrama di Tujuan *</Label>
                {targetChangeCode === "MTA" && !targetChangeInternal ? (
                  <>
                    <Input value="Asrama — wajib untuk pendaftar baru MTA" disabled />
                    <p className="text-xs text-muted-foreground">Aturan MTA otomatis menetapkan pendaftar baru sebagai Asrama.</p>
                  </>
                ) : (
                  <Select value={targetChangeAsrama} onValueChange={setTargetChangeAsrama} disabled={targetChangeLoading}>
                    <SelectTrigger><SelectValue placeholder="Pilih status asrama" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="asrama">Asrama</SelectItem>
                      <SelectItem value="non_asrama">Non Asrama{targetChangeCode === "MTA" ? " — murid lama/internal" : ""}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Alasan Perubahan *</Label>
              <Textarea
                value={targetChangeReason}
                onChange={(event) => setTargetChangeReason(event.target.value)}
                placeholder="Contoh: Salah pilih jenjang saat pendaftaran; seharusnya SMA."
                disabled={targetChangeLoading}
                rows={3}
              />
            </div>

            {targetChangeHasMilestones && (
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>Tes, hasil kelulusan, keputusan, dan daftar ulang lama akan direset agar lembaga tujuan baru memproses tahapan seleksi dari awal.</p>
              </div>
            )}

            <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
              ID pendaftaran dan data identitas siswa tetap sama. Untuk siswa internal, kelas/NIS/lembaga aktif saat ini tidak berubah.
              Jika pendaftaran mendapat promo gratis, pembukuan promo lembaga lama dikoreksi dengan jurnal pembalik lalu dibukukan ulang pada lembaga tujuan secara atomik.
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={targetChangeLoading} onClick={closeTargetChange}>Batal</Button>
              <Button
                disabled={
                  targetChangeLoading
                  || targetChangeRefLoading
                  || !targetChangeActuallyChanged
                  || !targetChangeDeptId
                  || !targetChangeCohortId
                  || (targetChangeNeedsAsrama && !(targetChangeCode === "MTA" && !targetChangeInternal) && !targetChangeAsrama)
                  || targetChangeReason.trim().length < 5
                }
                onClick={handleTargetChange}
              >
                {targetChangeLoading ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Menyimpan…</> : <><ArrowRightLeft className="mr-2 h-4 w-4" />Simpan Tujuan Baru</>}
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

      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold">Statistik SPMB</p>
          <p className="text-xs text-muted-foreground">
            Menampilkan statistik: <span className="font-medium text-foreground">{statistikLabel}</span>
          </p>
        </div>
        {spmbDepartemenList.length > 1 && (
          <div className="w-full sm:w-56">
            <Label className="text-xs">Lembaga/Jenjang Statistik</Label>
            <Select value={filters.departemen} onValueChange={(value) => setFilter("departemen", value)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua lembaga</SelectItem>
                {spmbDepartemenList.map((dept: any) => (
                  <SelectItem key={dept.id} value={dept.id}>{labelDepartemenSpmb(dept)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className={`grid gap-4 ${nisKosongCount > 0 ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
        <StatsCard title="Total Pendaftar" value={statistikCalonList.length} icon={Users} color="primary" />
        <StatsCard title="Menunggu" value={calonCount} icon={Clock} color="warning" />
        <StatsCard title="Diterima" value={diterimaCount} icon={UserCheck} color="success" />
        {nisKosongCount > 0 && <StatsCard title="NIS Belum Dibuat" value={nisKosongCount} icon={AlertTriangle} color="destructive" />}
      </div>

      <div className="space-y-2">
        <div>
          <p className="text-sm font-semibold">Sumber Pendaftaran</p>
          <p className="text-xs text-muted-foreground">
            Online berasal dari halaman /spmb. Offline berasal dari input Admin/TU melalui tombol Daftarkan Calon Murid.
          </p>
        </div>
        <div className={`grid gap-4 ${unknownSourceCount > 0 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          <StatsCard title="Pendaftaran Online" value={onlineCount} icon={Users} color="info" />
          <StatsCard title="Pendaftaran Offline" value={offlineCount} icon={UserPlus} color="warning" />
          {unknownSourceCount > 0 && (
            <StatsCard title="Sumber Belum Diketahui" value={unknownSourceCount} icon={AlertTriangle} color="destructive" />
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div>
          <p className="text-sm font-semibold">Pendaftar per Lembaga/Jenjang</p>
          <p className="text-xs text-muted-foreground">
            {role === "admin_tu"
              ? "Statistik hanya menampilkan lembaga yang menjadi cakupan Admin TU."
              : "Statistik menampilkan seluruh lembaga SPMB yang dapat Anda akses."}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {pendaftarPerLembaga.map((item) => (
            <StatsCard
              key={item.id}
              title={`Pendaftar ${item.kode}`}
              value={item.jumlah}
              icon={Users}
              color="info"
              onClick={() => setFilter("departemen", item.id)}
              active={filters.departemen === item.id}
            />
          ))}
        </div>
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
        exportable
        exportFilename={`spmb-siswa-${new Date().toISOString().slice(0, 10)}`}
        exportSheetName="Data SPMB"
        exportColumns={SPMB_EXPORT_COLUMNS}
        loading={isLoading}
        pageSize={20}
        onRowClick={(row) => navigate(`/akademik/siswa/${row.id}`)}
      />
    </div>
  );
}
