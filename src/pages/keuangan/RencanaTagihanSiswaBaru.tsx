import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { RupiahInput } from "@/components/shared/RupiahInput";
import { supabase } from "@/integrations/supabase/client";
import { formatRupiah, namaBulan, useAllJenisPembayaran, useTahunBuku } from "@/hooks/useKeuangan";
import {
  bulanKalenderTahunAjaran,
  kelompokkanBulanKeTahunBuku,
  targetTahunBukuTarif,
  type PeriodeTanggal,
} from "@/lib/periodeTagihan";
import { isSppPaymentName } from "@/lib/installment";
import { useSearchParams } from "@/lib/router-compat";
import {
  getSpmbBillingCandidates,
  updateSpmbBillingPlanEndMonth,
  type SpmbBillingCandidate,
} from "@/server/spmbBilling";
import { toast } from "sonner";
import { CalendarRange, CheckCircle2, GraduationCap, Info, Search, WalletCards } from "lucide-react";

type InitialFeeState = Record<string, { checked: boolean; nominal: string }>;

const BULAN_AKHIR_OPTIONS = [
  { value: 4, label: "April" },
  { value: 5, label: "Mei" },
  { value: 6, label: "Juni" },
];

function formatDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value + (value.includes("T") ? "" : "T00:00:00"));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

export default function RencanaTagihanSiswaBaru() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: jenisList = [] } = useAllJenisPembayaran();
  const { data: tahunBukuList = [] } = useTahunBuku();

  const { data: candidatesData, isLoading } = useQuery({
    queryKey: ["spmb_billing_candidates"],
    queryFn: async () => getSpmbBillingCandidates(),
  });
  const candidates = candidatesData?.items ?? [];

  const [search, setSearch] = useState("");
  const [filterDept, setFilterDept] = useState("__all__");
  const [filterStatus, setFilterStatus] = useState("__all__");
  const [selected, setSelected] = useState<SpmbBillingCandidate | null>(null);
  const [sppJenisId, setSppJenisId] = useState("");
  const [sppNominal, setSppNominal] = useState("");
  const [bulanTerakhir, setBulanTerakhir] = useState(6);
  const [initialFees, setInitialFees] = useState<InitialFeeState>({});
  const [saving, setSaving] = useState(false);

  const departments = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of candidates) {
      if (row.target_departemen_id) {
        map.set(
          row.target_departemen_id,
          [row.target_departemen_kode, row.target_departemen_nama].filter(Boolean).join(" — "),
        );
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "id-ID"));
  }, [candidates]);

  const filteredCandidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates.filter((row) => {
      if (filterDept !== "__all__" && row.target_departemen_id !== filterDept) return false;
      if (filterStatus === "ready" && !row.ready_for_billing) return false;
      if (filterStatus === "planned" && !row.rencana_spp) return false;
      if (filterStatus === "unplanned" && row.rencana_spp) return false;
      if (!q) return true;
      return [
        row.nama,
        row.nis,
        row.target_departemen_nama,
        row.target_departemen_kode,
        row.kelas_nama,
        row.tahun_ajaran_nama,
      ].filter(Boolean).join(" ").toLowerCase().includes(q);
    });
  }, [candidates, search, filterDept, filterStatus]);

  const availableJenis = useMemo(() => {
    if (!selected) return [];
    return (jenisList as any[]).filter((jenis) =>
      jenis.aktif !== false &&
      (!jenis.departemen_id || jenis.departemen_id === selected.target_departemen_id)
    );
  }, [jenisList, selected]);

  const sppJenisList = useMemo(
    () => availableJenis.filter((jenis: any) => jenis.tipe === "bulanan" && isSppPaymentName(jenis.nama)),
    [availableJenis],
  );

  const initialJenisList = useMemo(
    () => availableJenis.filter((jenis: any) =>
      jenis.tipe === "sekali" &&
      !/pendaftaran|spmb|psb/i.test(String(jenis.nama || ""))
    ),
    [availableJenis],
  );

  const selectedAcademicYear = useMemo<PeriodeTanggal | null>(() => {
    if (!selected?.tahun_ajaran_id || !selected.tahun_ajaran_mulai || !selected.tahun_ajaran_selesai) return null;
    return {
      id: selected.tahun_ajaran_id,
      nama: selected.tahun_ajaran_nama,
      tanggal_mulai: selected.tahun_ajaran_mulai,
      tanggal_selesai: selected.tahun_ajaran_selesai,
    };
  }, [selected]);

  const academicCalendar = useMemo(
    () => bulanKalenderTahunAjaran(selectedAcademicYear),
    [selectedAcademicYear],
  );
  const academicMonths = useMemo(() => academicCalendar.map((x) => x.bulan), [academicCalendar]);

  const sppTariffPeriods = useMemo(
    () => targetTahunBukuTarif({
      tahunAjaran: selectedAcademicYear,
      tahunBukuList: tahunBukuList as any,
      tipeSekali: false,
    }),
    [selectedAcademicYear, tahunBukuList],
  );

  const sppGeneratePeriods = useMemo(
    () => kelompokkanBulanKeTahunBuku({
      tahunAjaran: selectedAcademicYear,
      tahunBukuList: tahunBukuList as any,
      bulanList: academicMonths,
    }),
    [selectedAcademicYear, tahunBukuList, academicMonths],
  );

  const openPlan = (row: SpmbBillingCandidate) => {
    setSelected(row);

    const currentPlan = row.rencana_spp;
    const defaultSpp =
      (currentPlan
        ? (jenisList as any[]).find((j) => j.id === currentPlan.jenis_id)
        : null) ||
      (jenisList as any[]).find((j) =>
        j.aktif !== false &&
        j.tipe === "bulanan" &&
        isSppPaymentName(j.nama) &&
        (!j.departemen_id || j.departemen_id === row.target_departemen_id)
      );

    setSppJenisId(currentPlan?.jenis_id || defaultSpp?.id || "");
    setSppNominal(
      currentPlan?.nominal
        ? String(currentPlan.nominal)
        : defaultSpp?.nominal
          ? String(defaultSpp.nominal)
          : "",
    );
    setBulanTerakhir(currentPlan?.bulan_terakhir || 6);

    const fees: InitialFeeState = {};
    for (const jenis of (jenisList as any[])) {
      if (
        jenis.aktif !== false &&
        jenis.tipe === "sekali" &&
        !/pendaftaran|spmb|psb/i.test(String(jenis.nama || "")) &&
        (!jenis.departemen_id || jenis.departemen_id === row.target_departemen_id)
      ) {
        fees[jenis.id] = {
          checked: false,
          nominal: jenis.nominal ? String(jenis.nominal) : "",
        };
      }
    }
    setInitialFees(fees);
  };

  const closePlan = () => {
    if (saving) return;
    setSelected(null);
    const next = new URLSearchParams(searchParams);
    next.delete("siswa");
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    const siswaId = searchParams.get("siswa");
    if (!siswaId || selected || candidates.length === 0) return;
    const row = candidates.find((item) => item.id === siswaId);
    if (row) openPlan(row);
  }, [candidates, searchParams, selected]);

  const setInitialChecked = (id: string, checked: boolean) => {
    setInitialFees((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || { nominal: "" }), checked },
    }));
  };

  const setInitialNominal = (id: string, nominal: string) => {
    setInitialFees((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || { checked: false }), nominal },
    }));
  };

  const handleSave = async () => {
    if (!selected) return;
    if (!selected.ready_for_billing) {
      toast.error(selected.ready_reason || "Siswa belum siap dibuatkan rencana tagihan");
      return;
    }
    if (!selectedAcademicYear) {
      toast.error("Tahun ajaran SPMB belum lengkap");
      return;
    }
    if (!sppJenisId) {
      toast.error("Pilih jenis SPP");
      return;
    }

    const sppAmount = Number(sppNominal);
    if (!Number.isFinite(sppAmount) || sppAmount <= 0) {
      toast.error("Nominal SPP harus lebih dari 0");
      return;
    }

    if (sppTariffPeriods.missing.length || sppGeneratePeriods.missing.length) {
      toast.error("Tahun Buku untuk seluruh periode tahun ajaran belum tersedia", {
        description: "Buat Tahun Buku yang hilang di Referensi Keuangan lalu ulangi.",
      });
      return;
    }
    if (sppTariffPeriods.ids.length === 0 || sppGeneratePeriods.groups.length === 0) {
      toast.error("Periode tagihan tidak dapat dipetakan ke Tahun Buku");
      return;
    }

    const checkedInitial = initialJenisList.filter((jenis: any) => initialFees[jenis.id]?.checked);
    for (const jenis of checkedInitial as any[]) {
      const nominal = Number(initialFees[jenis.id]?.nominal);
      if (!Number.isFinite(nominal) || nominal <= 0) {
        toast.error(`Nominal ${jenis.nama} belum valid`);
        return;
      }
    }

    setSaving(true);
    const failures: string[] = [];
    try {
      const sppPayload = {
        p_tarif_rows: sppTariffPeriods.ids.map((tahunBukuId) => ({
          jenis_id: sppJenisId,
          siswa_id: selected.id,
          kelas_id: null,
          angkatan_id: null,
          tahun_ajaran_id: tahunBukuId,
          nominal: sppAmount,
          keterangan: "Tarif SPP siswa baru dari SPMB",
        })),
        p_tahun_akademik_id: selectedAcademicYear.id,
        p_jenis_id: sppJenisId,
        p_generate_groups: sppGeneratePeriods.groups.map((g) => ({
          tahun_buku_id: g.tahunBukuId,
          bulan_list: g.bulanList,
        })),
        p_departemen_id: selected.target_departemen_id,
        p_siswa_ids: null,
        p_siswa_id: selected.id,
        p_kelas_id: selected.kelas_id,
        p_angkatan_id: null,
        p_sampai_akhir_jenjang: true,
        p_rencana_mulai: academicCalendar[0]?.tanggal || selectedAcademicYear.tanggal_mulai,
      };

      const { data: sppResult, error: sppError } = await (supabase as any).rpc(
        "simpan_tarif_generate_dan_rencana_atomik",
        sppPayload,
      );
      if (sppError) throw sppError;

      const rencanaId = sppResult?.rencana?.rencana_id || selected.rencana_spp?.id;
      if (rencanaId) {
        await updateSpmbBillingPlanEndMonth({
          data: { rencana_id: rencanaId, bulan_terakhir: bulanTerakhir },
        });
      }

      const oncePeriods = targetTahunBukuTarif({
        tahunAjaran: selectedAcademicYear,
        tahunBukuList: tahunBukuList as any,
        tipeSekali: true,
      });
      const onceYearBookId = oncePeriods.ids[0];

      for (const jenis of checkedInitial as any[]) {
        try {
          if (!onceYearBookId) throw new Error("Tahun Buku awal tahun ajaran belum tersedia");
          const nominal = Number(initialFees[jenis.id]?.nominal);
          const { error } = await (supabase as any).rpc(
            "simpan_tarif_generate_dan_rencana_atomik",
            {
              p_tarif_rows: [{
                jenis_id: jenis.id,
                siswa_id: selected.id,
                kelas_id: null,
                angkatan_id: null,
                tahun_ajaran_id: onceYearBookId,
                nominal,
                keterangan: "Tagihan awal siswa baru dari SPMB",
              }],
              p_tahun_akademik_id: selectedAcademicYear.id,
              p_jenis_id: jenis.id,
              p_generate_groups: [{ tahun_buku_id: onceYearBookId, bulan_list: [null] }],
              p_departemen_id: selected.target_departemen_id,
              p_siswa_ids: null,
              p_siswa_id: selected.id,
              p_kelas_id: selected.kelas_id,
              p_angkatan_id: null,
              p_sampai_akhir_jenjang: false,
              p_rencana_mulai: null,
            },
          );
          if (error) throw error;
        } catch (error) {
          failures.push(`${jenis.nama}: ${error instanceof Error ? error.message : "gagal"}`);
        }
      }

      await Promise.all([
        qc.invalidateQueries({ queryKey: ["spmb_billing_candidates"] }),
        qc.invalidateQueries({ queryKey: ["tarif_tagihan"] }),
        qc.invalidateQueries({ queryKey: ["tagihan"] }),
        qc.invalidateQueries({ queryKey: ["jurnal"] }),
      ]);

      if (failures.length === 0) {
        toast.success("Rencana tagihan siswa baru berhasil disimpan", {
          description: `SPP ${formatRupiah(sppAmount)} · otomatis sampai ${namaBulan(bulanTerakhir)} tahun kelulusan.`,
        });
        closePlan();
      } else {
        toast.warning("Rencana SPP tersimpan, tetapi ada tagihan awal yang gagal", {
          description: failures.slice(0, 3).join(" | "),
          duration: 10000,
        });
      }
    } catch (error) {
      toast.error("Gagal menyimpan rencana tagihan", {
        description: error instanceof Error ? error.message : "Terjadi kesalahan teknis",
        duration: 10000,
      });
    } finally {
      setSaving(false);
    }
  };

  const plannedCount = candidates.filter((x) => x.rencana_spp).length;
  const readyCount = candidates.filter((x) => x.ready_for_billing).length;

  const columns: DataTableColumn<SpmbBillingCandidate>[] = [
    {
      key: "nama",
      label: "Siswa",
      className: "min-w-[220px]",
      render: (_, row) => (
        <div>
          <p className="font-medium">{row.nama}</p>
          <p className="text-xs text-muted-foreground">NIS: {row.nis || "—"}</p>
        </div>
      ),
    },
    {
      key: "target_departemen_nama",
      label: "Jenjang Tujuan",
      className: "min-w-[150px]",
      render: (_, row) => (
        <div>
          <p>{row.target_departemen_kode || row.target_departemen_nama || "—"}</p>
          <p className="text-xs text-muted-foreground">{row.kelas_nama || "Kelas belum ditentukan"}</p>
        </div>
      ),
    },
    {
      key: "tahun_ajaran_nama",
      label: "Tahun Masuk",
      className: "min-w-[140px]",
      render: (_, row) => row.tahun_ajaran_nama || "—",
    },
    {
      key: "status",
      label: "Kesiapan",
      className: "min-w-[170px]",
      render: (_, row) => row.ready_for_billing ? (
        <Badge className="border-emerald-300 bg-emerald-100 text-emerald-700">
          <CheckCircle2 className="mr-1 h-3 w-3" /> Siap
        </Badge>
      ) : (
        <div>
          <Badge variant="outline">Belum aktif</Badge>
          <p className="mt-1 max-w-[240px] text-[11px] text-muted-foreground">{row.ready_reason}</p>
        </div>
      ),
    },
    {
      key: "rencana_spp",
      label: "Rencana SPP",
      className: "min-w-[210px]",
      render: (_, row) => row.rencana_spp ? (
        <div>
          <Badge className="border-blue-300 bg-blue-100 text-blue-700">Aktif</Badge>
          <p className="mt-1 text-xs font-medium">{formatRupiah(row.rencana_spp.nominal)}/bulan</p>
          <p className="text-[11px] text-muted-foreground">
            s.d. {formatDate(row.rencana_spp.selesai)}
          </p>
        </div>
      ) : (
        <Badge variant="secondary">Belum dibuat</Badge>
      ),
    },
    {
      key: "id",
      label: "Aksi",
      className: "min-w-[130px]",
      render: (_, row) => (
        <Button
          size="sm"
          variant={row.rencana_spp ? "outline" : "default"}
          disabled={!row.ready_for_billing}
          onClick={() => openPlan(row)}
        >
          {row.rencana_spp ? "Edit Rencana" : "Atur Tagihan"}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Rencana Tagihan Siswa Baru</h1>
        <p className="text-sm text-muted-foreground">
          Atur nominal khusus siswa SPMB lulus, tagihan awal, dan SPP otomatis sampai menjelang lulus.
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-sm">
          Siswa harus sudah aktif pada jenjang tujuan. Tagihan SPP untuk tahun pertama dibuat sesuai Tahun Ajaran,
          sedangkan bulan tahun-tahun berikutnya dibuat otomatis oleh rencana sampai akhir jenjang. Nominal setiap siswa boleh berbeda.
        </AlertDescription>
      </Alert>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <GraduationCap className="h-5 w-5 text-primary" />
            <div><p className="text-xs text-muted-foreground">SPMB Lulus</p><p className="text-xl font-bold">{candidates.length}</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <div><p className="text-xs text-muted-foreground">Siap Diatur</p><p className="text-xl font-bold">{readyCount}</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <CalendarRange className="h-5 w-5 text-blue-600" />
            <div><p className="text-xs text-muted-foreground">Rencana SPP Aktif</p><p className="text-xl font-bold">{plannedCount}</p></div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Siswa SPMB Lulus</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 md:grid-cols-[minmax(260px,1fr)_220px_190px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama, NIS, kelas, atau jenjang..."
              />
            </div>
            <Select value={filterDept} onValueChange={setFilterDept}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Semua Jenjang</SelectItem>
                {departments.map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Semua Status</SelectItem>
                <SelectItem value="ready">Siap Diatur</SelectItem>
                <SelectItem value="unplanned">Belum Ada Rencana</SelectItem>
                <SelectItem value="planned">Rencana Aktif</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DataTable
            columns={columns}
            data={filteredCandidates}
            loading={isLoading}
            pageSize={20}
          />
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) closePlan(); }}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected?.rencana_spp ? "Edit" : "Buat"} Rencana Tagihan Siswa Baru</DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="space-y-5">
              <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">Siswa</p>
                  <p className="font-semibold">{selected.nama}</p>
                  <p className="text-xs text-muted-foreground">NIS {selected.nis || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Tujuan SPMB</p>
                  <p className="font-semibold">
                    {selected.target_departemen_kode || selected.target_departemen_nama || "—"}
                    {selected.kelas_nama ? ` · ${selected.kelas_nama}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">{selected.tahun_ajaran_nama || "Tahun ajaran belum tersedia"}</p>
                </div>
              </div>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <WalletCards className="h-4 w-4 text-primary" /> SPP sampai akhir jenjang
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Jenis SPP *</Label>
                      <Select value={sppJenisId} onValueChange={(value) => {
                        setSppJenisId(value);
                        const jenis = sppJenisList.find((j: any) => j.id === value) as any;
                        if (!selected.rencana_spp && jenis?.nominal) setSppNominal(String(jenis.nominal));
                      }}>
                        <SelectTrigger><SelectValue placeholder="Pilih jenis SPP" /></SelectTrigger>
                        <SelectContent>
                          {sppJenisList.map((jenis: any) => (
                            <SelectItem key={jenis.id} value={jenis.id}>
                              {jenis.nama}{jenis.nominal ? ` · ${formatRupiah(Number(jenis.nominal))}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Nominal SPP siswa *</Label>
                      <RupiahInput value={sppNominal} onChange={setSppNominal} />
                      <p className="mt-1 text-xs text-muted-foreground">Boleh berbeda untuk setiap siswa.</p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Bulan mulai</Label>
                      <Input
                        readOnly
                        value={academicCalendar[0] ? `${namaBulan(academicCalendar[0].bulan)} ${academicCalendar[0].tahun}` : "—"}
                        className="bg-muted/40"
                      />
                    </div>
                    <div>
                      <Label>Bulan terakhir pada tahun kelulusan</Label>
                      <Select value={String(bulanTerakhir)} onValueChange={(v) => setBulanTerakhir(Number(v))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {BULAN_AKHIR_OPTIONS.map((item) => (
                            <SelectItem key={item.value} value={String(item.value)}>{item.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
                    Tahun pertama: {selected.tahun_ajaran_nama || "—"} ({academicCalendar.length || 0} bulan).
                    Setelah itu sistem membuat SPP bulanan otomatis sampai {namaBulan(bulanTerakhir)} pada tahun kelulusan.
                    Jika siswa tinggal kelas, akhir rencana ikut bergeser. Jika pindah atau menjadi alumni, rencana dihentikan.
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Tagihan Awal (opsional)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Pilih biaya satu kali seperti Uang Pangkal, Daftar Ulang, atau Seragam. Biaya pendaftaran SPMB tidak ditampilkan agar tidak tertagih dua kali.
                  </p>
                  {initialJenisList.length === 0 ? (
                    <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                      Tidak ada jenis pembayaran sekali bayar untuk jenjang ini.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {initialJenisList.map((jenis: any) => {
                        const state = initialFees[jenis.id] || { checked: false, nominal: "" };
                        return (
                          <div key={jenis.id} className="grid items-center gap-2 rounded-md border p-3 sm:grid-cols-[24px_minmax(180px,1fr)_220px]">
                            <Checkbox
                              checked={state.checked}
                              onCheckedChange={(value) => setInitialChecked(jenis.id, value === true)}
                            />
                            <div>
                              <p className="text-sm font-medium">{jenis.nama}</p>
                              {jenis.nominal ? <p className="text-xs text-muted-foreground">Default {formatRupiah(Number(jenis.nominal))}</p> : null}
                            </div>
                            <RupiahInput
                              value={state.nominal}
                              onChange={(value) => setInitialNominal(jenis.id, value)}
                              disabled={!state.checked}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {selected.rencana_spp && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    Rencana saat ini: {selected.rencana_spp.jenis_nama} {formatRupiah(selected.rencana_spp.nominal)}/bulan,
                    {formatDate(selected.rencana_spp.mulai)} s.d. {formatDate(selected.rencana_spp.selesai)}.
                    Menyimpan ulang akan memperbarui tarif untuk periode berikutnya tanpa mengubah pembayaran yang sudah terjadi.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closePlan} disabled={saving}>Batal</Button>
            <Button onClick={() => void handleSave()} disabled={saving || !selected?.ready_for_billing}>
              {saving ? "Menyimpan..." : "Simpan Rencana Tagihan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}