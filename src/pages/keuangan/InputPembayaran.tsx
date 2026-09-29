import { useState, useMemo, useEffect, useCallback } from "react";
import { PrintKuitansi } from "@/components/shared/PrintKuitansi";
import { PrintKuitansiGabungan } from "@/components/shared/PrintKuitansiGabungan";
import { PrintTagihan } from "@/components/shared/PrintTagihan";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { supabase } from "@/integrations/supabase/client";
import {
  prosesPembayaran,
  batalkanPembayaran,
  getLegacyOutstandingBreakdown,
  cariSiswaPembayaran,
} from "@/server/pembayaran";
import type { LegacyOutstandingBreakdownRow } from "@/server/pembayaran";
import {
  useJenisPembayaran, useLembaga, useTahunBukuAktif,
  useTahunBuku, formatRupiah, terbilang, namaBulan, namaBulanTahun, BULAN_ORDER_AKADEMIK,
} from "@/hooks/useKeuangan";
import { useTarifSiswa } from "@/hooks/useTarifTagihan";
import { useTagihanBySiswa } from "@/hooks/useTagihan";
import { logAuditKeuangan } from "@/hooks/useJurnal";
import { useAuth } from "@/contexts/AuthContext";
import Unauthorized from "@/pages/Unauthorized";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, Printer, Check, X, ShoppingCart, Trash2, Clock3 } from "lucide-react";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { calculateRemainingBill } from "@/lib/installment";

import type {
  SiswaWithKelas,
  JenisPembayaran,
  PembayaranWithJenis,
  ProsesPembayaranRequest,
  FormPembayaran,
} from "@/types/keuangan";
import { isTipeSekali } from "@/types/keuangan";

const FORM_DEFAULT: FormPembayaran = {
  jenisId: "",
  bulan: new Date().getMonth() + 1,
  jumlah: "",
  tanggalBayar: new Date().toISOString().split("T")[0],
  keterangan: "",
};

type PembayaranRiwayat = PembayaranWithJenis & {
  periodeTagihanLabel?: string | null;
  tagihan_id?: string | null;
  petugas?: { nama?: string | null } | null;
  jurnal?: { nomor?: string | null } | null;
};

type PaymentCartItem = {
  key: string;
  tagihanId?: string;
  jenisId: string;
  jenisNama: string;
  jenisTipe: string;
  bulan: number;
  jumlah: number;
  tahunAjaranId: string;
  departemenId?: string;
  isBayarDimuka: boolean;
  status: string | null;
  tahunLabel: string;
};

// Ambil baris kelas_siswa yang aktif -- kelas_siswa[0] TIDAK BOLEH dipakai langsung
// karena PostgREST tidak menjamin urutan baris relasi (bisa mengembalikan baris
// kelas lama/nonaktif di posisi pertama setelah siswa naik/pindah kelas), yang
// menyebabkan tarif & jenis pembayaran salah match ke kelas lama siswa.
function getKelasAktif(siswa: SiswaWithKelas | null | undefined) {
  const list = siswa?.kelas_siswa ?? [];
  return list.find((ks: any) => ks.aktif) ?? list[0];
}

function useProsesPembayaran() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ProsesPembayaranRequest) => {
      return await prosesPembayaran({ data: payload });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pembayaran"] });
      qc.invalidateQueries({ queryKey: ["tagihan"] });
      qc.invalidateQueries({ queryKey: ["jurnal"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

function useBatalkanPembayaran() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { pembayaran_id: string; alasan: string; jumlah: number; keterangan: string }) => {
      const data = await batalkanPembayaran({
        data: { pembayaran_id: payload.pembayaran_id, alasan: payload.alasan },
      });
      // catat ke audit (best-effort, di sisi klien agar nama pengguna terekam)
      await logAuditKeuangan({
        tabel_sumber: "pembayaran",
        record_id: payload.pembayaran_id,
        aksi: "DELETE",
        data_lama: { jumlah: payload.jumlah, keterangan: payload.keterangan },
        data_baru: { dibatalkan: true, alasan: payload.alasan, jurnal_pembalik_id: data.jurnal_pembalik_id },
        keterangan: `Pembatalan pembayaran ${payload.keterangan} ${formatRupiah(payload.jumlah)} — ${payload.alasan}`,
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pembayaran"] });
      qc.invalidateQueries({ queryKey: ["pembayaran_siswa"] });
      qc.invalidateQueries({ queryKey: ["tagihan"] });
      qc.invalidateQueries({ queryKey: ["jurnal"] });
      qc.invalidateQueries({ queryKey: ["tunggakan"] });
      toast.success("Pembayaran berhasil dibatalkan & jurnal dibalik");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export default function InputPembayaran() {
  const { role } = useAuth();
  if (!role || !["admin", "keuangan", "kasir"].includes(role)) {
    return <Unauthorized />;
  }
  return <InputPembayaranContent />;
}

function InputPembayaranContent() {
  const { role } = useAuth();
  const isKasir = role === "kasir";
  const queryClient = useQueryClient();
  const [searchTerm,    setSearchTerm]    = useState("");
  const [selectedSiswa, setSelectedSiswa] = useState<SiswaWithKelas | null>(null);
  const [departemenId,  setDepartemenId]  = useState("");
  const [form, setForm] = useState<FormPembayaran>(FORM_DEFAULT);
  const [selectedTahunAjaranId, setSelectedTahunAjaranId] = useState("");
  const [showKuitansi, setShowKuitansi] = useState(false);
  const [showTagihanPrint, setShowTagihanPrint] = useState(false);
  const [riwayatPrintTarget, setRiwayatPrintTarget] = useState<PembayaranRiwayat | null>(null);
  const [cartItems, setCartItems] = useState<PaymentCartItem[]>([]);
  const [isCartPaying, setIsCartPaying] = useState(false);
  const [cartProgress, setCartProgress] = useState<{ done: number; total: number } | null>(null);
  const [showCartKuitansi, setShowCartKuitansi] = useState(false);
  const [lastCartPayment, setLastCartPayment] = useState<{
    items: Array<{ pembayaran_id: string; jumlah: number; jenisNama: string; bulan: number; tahunLabel: string }>;
    siswa: SiswaWithKelas;
    tanggal_bayar: string;
    keterangan?: string;
    petugasNama?: string;
  } | null>(null);
  const [lastPayment, setLastPayment] = useState<{
    pembayaran_id: string; jumlah: number; jenisNama: string;
    jenisTipe: string; siswa: SiswaWithKelas; bulan: number; tanggal_bayar: string;
    periodeLabel?: string;
    petugasNama?: string;
  } | null>(null);

  const setField = useCallback(
    <K extends keyof FormPembayaran>(key: K, val: FormPembayaran[K]) =>
      setForm(prev => ({ ...prev, [key]: val })),
    []
  );
  const resetForm = useCallback(() => setForm(FORM_DEFAULT), []);

  const { data: lembagaList }     = useLembaga();
  const { data: tahunAktif }      = useTahunBukuAktif();
  const { data: tahunAjaranList } = useTahunBuku();
  const { data: allJenisList }    = useJenisPembayaran(departemenId || undefined);
  const effectiveTahunAjaranId = selectedTahunAjaranId || tahunAktif?.id || "";

  // Tahun buku yang sudah ditutup tetap harus dapat dipilih apabila siswa masih
  // memiliki tagihan terbuka dari periode tersebut. Ini penting untuk tunggakan
  // migrasi (mis. SPP November 2025) yang dibayar saat kas diterima pada 2026.
  const { data: openTagihanTahunIds = new Set<string>() } = useQuery<Set<string>>({
    queryKey: ["open_tagihan_tahun", selectedSiswa?.id],
    enabled: !!selectedSiswa,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tagihan")
        .select("tahun_ajaran_id")
        .eq("siswa_id", selectedSiswa!.id)
        .in("status", ["belum_bayar", "sebagian", "terjadwal"]);
      if (error) throw error;
      return new Set((data ?? []).map(row => row.tahun_ajaran_id).filter(Boolean) as string[]);
    },
  });

  // Tagihan migrasi dapat berasal dari lembaga sebelumnya (mis. SD) sementara
  // siswa sekarang sudah berada di SMP. Jenis tagihan terbuka lintas lembaga
  // tetap harus tersedia di dropdown pembayaran, walaupun tidak termasuk
  // hasil useJenisPembayaran(departemenId) untuk lembaga siswa saat ini.
  const { data: openTagihanJenisExtras = [] } = useQuery<JenisPembayaran[]>({
    queryKey: ["open_tagihan_jenis_extras", selectedSiswa?.id, effectiveTahunAjaranId],
    enabled: !!selectedSiswa && !!effectiveTahunAjaranId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tagihan")
        .select("jenis_id, jenis_pembayaran:jenis_id(id, nama, nominal, keterangan, departemen_id, akun_pendapatan_id, tipe)")
        .eq("siswa_id", selectedSiswa!.id)
        .eq("tahun_ajaran_id", effectiveTahunAjaranId)
        .in("status", ["belum_bayar", "sebagian", "terjadwal"]);
      if (error) throw error;

      const byId = new Map<string, JenisPembayaran>();
      for (const row of (data ?? []) as any[]) {
        const jenis = row.jenis_pembayaran as JenisPembayaran | null;
        if (jenis?.id) byId.set(jenis.id, jenis);
      }
      return Array.from(byId.values());
    },
  });

  const { data: searchResults } = useQuery<SiswaWithKelas[]>({
    queryKey: ["search_siswa", searchTerm, departemenId],
    enabled: searchTerm.trim().length >= 2,
    queryFn: async () => {
      const result = await cariSiswaPembayaran({
        data: {
          search: searchTerm,
          status: "aktif",
          departemen_id: departemenId || undefined,
          limit: 10,
        },
      });
      return result.items as SiswaWithKelas[];
    },
  });

  const siswaKelasId    = getKelasAktif(selectedSiswa)?.kelas?.id;
  const siswaAngkatanId = (selectedSiswa as any)?.angkatan_id ?? null;

  const { data: applicableTarifJenisIds } = useQuery<Set<string>>({
    queryKey: ["applicable_tarif_jenis", selectedSiswa?.id, siswaKelasId, effectiveTahunAjaranId, siswaAngkatanId],
    enabled: !!selectedSiswa,
    queryFn: async () => {
      const filters: string[] = ["siswa_id.is.null"];
      if (selectedSiswa) filters.push(`siswa_id.eq.${selectedSiswa.id}`);
      const { data, error } = await supabase
        .from("tarif_tagihan")
        .select("jenis_id, siswa_id, kelas_id, tahun_ajaran_id, angkatan_id")
        .eq("aktif", true)
        .or(filters.join(","));
      if (error) throw error;
      const validIds = new Set<string>();
      for (const t of (data ?? [])) {
        const matchSiswa    = t.siswa_id === selectedSiswa!.id || !t.siswa_id;
        const matchKelas    = t.kelas_id === siswaKelasId || !t.kelas_id;
        const matchAngkatan = t.angkatan_id === siswaAngkatanId || !t.angkatan_id;
        const matchTahun    = t.tahun_ajaran_id === effectiveTahunAjaranId || !t.tahun_ajaran_id;
        if (matchSiswa && matchKelas && matchAngkatan && matchTahun && t.jenis_id) validIds.add(t.jenis_id);
      }
      return validIds;
    },
  });

  // Jenis pembayaran yang sudah punya tagihan terbuka harus tetap dapat dipilih
  // walaupun tidak lagi memiliki tarif_tagihan aktif. Ini penting untuk
  // tunggakan/migrasi historis: nominal pembayaran bersumber dari tagihan yang
  // sudah tersimpan, bukan dari tarif baru.
  const { data: openTagihanJenisIds } = useQuery<Set<string>>({
    queryKey: ["open_tagihan_jenis", selectedSiswa?.id, effectiveTahunAjaranId],
    enabled: !!selectedSiswa && !!effectiveTahunAjaranId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tagihan")
        .select("jenis_id")
        .eq("siswa_id", selectedSiswa!.id)
        .eq("tahun_ajaran_id", effectiveTahunAjaranId)
        .in("status", ["belum_bayar", "sebagian", "terjadwal"]);
      if (error) throw error;
      return new Set((data ?? []).map(t => t.jenis_id).filter(Boolean) as string[]);
    },
  });

  const jenisList = useMemo<JenisPembayaran[]>(() => {
    if (!allJenisList) return [];
    if (!selectedSiswa) return allJenisList as JenisPembayaran[];

    const merged = new Map<string, JenisPembayaran>();
    for (const jenis of allJenisList as JenisPembayaran[]) merged.set(jenis.id, jenis);
    for (const jenis of openTagihanJenisExtras) merged.set(jenis.id, jenis);

    return Array.from(merged.values()).filter(j =>
      applicableTarifJenisIds?.has(j.id) || openTagihanJenisIds?.has(j.id)
    );
  }, [allJenisList, selectedSiswa, applicableTarifJenisIds, openTagihanJenisIds, openTagihanJenisExtras]);

  const selectedJenis = jenisList.find(j => j.id === form.jenisId) ?? null;
  const isSekali      = selectedJenis ? isTipeSekali(selectedJenis.tipe) : false;

  const { data: existingTagihan } = useTagihanBySiswa(
    selectedSiswa?.id, form.jenisId || undefined, isSekali ? undefined : form.bulan,
    effectiveTahunAjaranId,
  );

  const tarifTahunBukuId = existingTagihan?.tahun_ajaran_id || effectiveTahunAjaranId;

  const { data: tarifNominal, isLoading: loadingTarif } = useTarifSiswa(
    form.jenisId || undefined,
    selectedSiswa?.id,
    siswaKelasId,
    tarifTahunBukuId,
    (selectedSiswa as any)?.angkatan_id ?? undefined,
  );

  // Bulan yang sudah dibayar (dari tabel pembayaran)
  const { data: bulanDibayar, isLoading: loadingBulan } = useQuery<Set<number>>({
    queryKey: ["cek_bulan_dibayar", selectedSiswa?.id, form.jenisId, effectiveTahunAjaranId],
    enabled: !!selectedSiswa && !!form.jenisId && !isSekali,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pembayaran")
        .select("bulan")
        .eq("siswa_id", selectedSiswa!.id)
        .eq("jenis_id", form.jenisId)
        .eq("tahun_ajaran_id", effectiveTahunAjaranId);
      if (error) throw error;
      return new Set((data ?? []).map(r => r.bulan as number));
    },
  });

  // Bulan yang punya tagihan beserta statusnya. Status diperlukan agar UI
  // membedakan kewajiban yang sudah jatuh tempo dari tagihan masa depan
  // (terjadwal) tanpa mengubah kemampuan kasir menerima pembayaran di muka.
  const { data: statusTagihanPerBulan } = useQuery<Map<number, string>>({
    queryKey: ["cek_bulan_ada_tagihan", selectedSiswa?.id, form.jenisId, effectiveTahunAjaranId],
    enabled: !!selectedSiswa && !!form.jenisId && !isSekali,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tagihan")
        .select("bulan, status")
        .eq("siswa_id", selectedSiswa!.id)
        .eq("jenis_id", form.jenisId)
        .eq("tahun_ajaran_id", effectiveTahunAjaranId)
        .not("bulan", "is", null);
      if (error) throw error;
      return new Map(
        (data ?? [])
          .filter(r => r.bulan != null)
          .map(r => [r.bulan as number, String(r.status ?? "")])
      );
    },
  });

  const bulanAdaTagihan = useMemo(
    () => new Set(statusTagihanPerBulan ? Array.from(statusTagihanPerBulan.keys()) : []),
    [statusTagihanPerBulan],
  );

  // Bulan yang tampil = bulan punya tagihan ATAU semua bulan jika belum ada tagihan sama sekali
  const bulanTampil = useMemo<number[]>(() => {
    if (bulanAdaTagihan.size === 0) return BULAN_ORDER_AKADEMIK;
    return BULAN_ORDER_AKADEMIK.filter(m => bulanAdaTagihan.has(m));
  }, [bulanAdaTagihan]);

  const { data: pembayaranSekali } = useQuery<{ totalBayar: number; lunas: boolean }>({
    queryKey: [
      "cek_sekali",
      selectedSiswa?.id,
      form.jenisId,
      effectiveTahunAjaranId,
      existingTagihan?.id,
      existingTagihan?.nominal,
      tarifNominal,
    ],
    enabled: !!selectedSiswa && !!form.jenisId && isSekali && (!!existingTagihan || tarifNominal != null),
    queryFn: async () => {
      let query = supabase.from("pembayaran").select("jumlah");
      if (existingTagihan?.id) {
        query = query.eq("tagihan_id", existingTagihan.id);
      } else {
        query = query
          .eq("siswa_id", selectedSiswa!.id)
          .eq("jenis_id", form.jenisId)
          .eq("tahun_ajaran_id", effectiveTahunAjaranId);
      }
      const { data, error } = await query;
      if (error) throw error;
      const total = (data ?? []).reduce((sum, row) => sum + Number(row.jumlah ?? 0), 0);
      const billTotal = existingTagihan ? Number(existingTagihan.nominal) : Number(tarifNominal ?? 0);
      return { totalBayar: total, lunas: billTotal > 0 && total >= billTotal };
    },
  });

  const { data: legacyBreakdown = [] } = useQuery<LegacyOutstandingBreakdownRow[]>({
    queryKey: ["legacy_outstanding_breakdown", selectedSiswa?.id],
    enabled: !!selectedSiswa,
    queryFn: async () => {
      return await getLegacyOutstandingBreakdown({
        data: { siswa_id: selectedSiswa!.id },
      });
    },
  });

  const { data: riwayat, isLoading: loadRiwayat } = useQuery<PembayaranRiwayat[]>({
    queryKey: ["pembayaran_siswa", selectedSiswa?.id],
    enabled: !!selectedSiswa,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pembayaran")
        .select("*, jenis_pembayaran:jenis_id(id, nama, tipe), petugas:petugas_id(nama), jurnal:jurnal_id(nomor)")
        .eq("siswa_id", selectedSiswa!.id)
        .order("tanggal_bayar", { ascending: false })
        .limit(20);
      if (error) throw error;

      const rows = (data ?? []) as unknown as PembayaranRiwayat[];
      const ids = rows.map(row => row.id).filter(Boolean);
      if (ids.length === 0) return [];

      // Periode kewajiban berasal dari tagihan, bukan dari tanggal uang masuk.
      // Ini membuat pembayaran SPP November 2025 yang diterima pada 2026 tetap
      // tampil sebagai November 2025 di riwayat.
      const { data: tagihanRows, error: tagihanError } = await supabase
        .from("tagihan")
        .select("pembayaran_id, bulan, tahun_ajaran:tahun_ajaran_id(nama, tanggal_mulai)")
        .in("pembayaran_id", ids);
      if (tagihanError) throw tagihanError;

      const periodeByPembayaran = new Map<string, string>();
      for (const tagihan of (tagihanRows ?? []) as any[]) {
        if (!tagihan.pembayaran_id || !tagihan.bulan) continue;
        const tahun = tagihan.tahun_ajaran as { nama?: string; tanggal_mulai?: string } | null;
        const tahunLabel = tahun?.tanggal_mulai?.slice(0, 4) || tahun?.nama || "";
        periodeByPembayaran.set(
          tagihan.pembayaran_id,
          `${namaBulan(tagihan.bulan)} ${tahunLabel}`.trim(),
        );
      }

      return rows.map(row => ({
        ...row,
        periodeTagihanLabel: periodeByPembayaran.get(row.id) ?? null,
      }));
    },
  });

  const ringkasanTagihanSekali = useMemo(() => {
    if (!isSekali || !existingTagihan) return null;
    return calculateRemainingBill(
      Number(existingTagihan.nominal),
      pembayaranSekali?.totalBayar ?? 0,
    );
  }, [isSekali, existingTagihan?.id, existingTagihan?.nominal, pembayaranSekali?.totalBayar]);

  useEffect(() => {
    if (!form.jenisId) return;
    const isOpenBill = !!existingTagihan &&
      ["belum_bayar", "sebagian", "terjadwal"].includes(String(existingTagihan.status));
    const nominal = isOpenBill
      ? (isSekali && ringkasanTagihanSekali
          ? ringkasanTagihanSekali.remaining
          : Number(existingTagihan.nominal))
      : tarifNominal;
    if (nominal != null && Number.isFinite(nominal) && nominal > 0) {
      setField("jumlah", String(nominal));
    }
  }, [
    tarifNominal,
    existingTagihan?.id,
    existingTagihan?.nominal,
    existingTagihan?.status,
    form.jenisId,
    isSekali,
    ringkasanTagihanSekali?.remaining,
  ]);

  useEffect(() => {
    if (tahunAktif?.id && !selectedTahunAjaranId) setSelectedTahunAjaranId(tahunAktif.id);
  }, [tahunAktif?.id]);

  // Auto-set bulan ke bulan pertama yang ada tagihan saat jenis berubah
  useEffect(() => {
    if (bulanAdaTagihan && bulanAdaTagihan.size > 0 && form.jenisId) {
      const firstBulan = BULAN_ORDER_AKADEMIK.find(m => bulanAdaTagihan.has(m));
      if (firstBulan && !bulanAdaTagihan.has(form.bulan)) {
        setField("bulan", firstBulan);
      }
    }
  }, [bulanAdaTagihan, form.jenisId]);

  const selectedTahun  = tahunAjaranList?.find(t => t.id === effectiveTahunAjaranId);
  const selectedTahunLabel = selectedTahun?.tanggal_mulai?.slice(0, 4) || selectedTahun?.nama || "";
  const isBayarDimuka  = !!(selectedTahun?.tanggal_mulai && selectedTahun.tanggal_mulai > new Date().toISOString().split("T")[0]);
  const adaTagihanDipilih = !!existingTagihan &&
    ["belum_bayar", "sebagian", "terjadwal"].includes(String(existingTagihan.status));
  const tarifTidakAda  = !!(form.jenisId && selectedSiswa && !loadingTarif && tarifNominal == null && !adaTagihanDipilih);
  const cicilanSekaliDiizinkan =
    isSekali && !!existingTagihan && existingTagihan.status !== "terjadwal";
  const isJumlahLocked =
    (!!adaTagihanDipilih && !cicilanSekaliDiizinkan) ||
    (!isSekali && tarifNominal != null);
  // Untuk tunggakan tahun lama, pembayaran dicatat pada tahun buku kas saat
  // diterima (mis. 2026), sementara tagihannya tetap periode 2025. Karena itu
  // status "lunas" pada tagihan adalah sumber kebenaran tambahan selain tabel
  // pembayaran yang difilter berdasarkan tahun penerimaan.
  const bulanLunas = useMemo(
    () => new Set(
      bulanTampil.filter(m =>
        bulanDibayar?.has(m) || statusTagihanPerBulan?.get(m) === "lunas"
      )
    ),
    [bulanTampil, bulanDibayar, statusTagihanPerBulan],
  );
  const sudahBayar     = bulanLunas.size;
  const terjadwal      = bulanTampil.filter(m => statusTagihanPerBulan?.get(m) === "terjadwal").length;
  const belumBayar     = bulanTampil.filter(
    m => !bulanLunas.has(m) && statusTagihanPerBulan?.get(m) !== "terjadwal"
  ).length;
  const cartTotal      = cartItems.reduce((sum, item) => sum + item.jumlah, 0);
  const currentCartKey = form.jenisId
    ? (existingTagihan?.id ?? [form.jenisId, isSekali ? "sekali" : String(form.bulan), effectiveTahunAjaranId].join(":"))
    : "";
  const currentAlreadyInCart = !!currentCartKey && cartItems.some(item => item.key === currentCartKey);
  const kelasNama      = getKelasAktif(selectedSiswa)?.kelas?.nama ?? "-";
  const lembagaNama    = lembagaList?.find(l => l.id === departemenId)?.nama ?? "-";

  const prosesMutation = useProsesPembayaran();
  const batalMutation  = useBatalkanPembayaran();
  const canBatal = role === "admin" || role === "keuangan";
  const [batalTarget, setBatalTarget] = useState<PembayaranWithJenis | null>(null);
  const [batalAlasan, setBatalAlasan] = useState("");

  const handleSelectSiswa = useCallback((s: SiswaWithKelas) => {
    setSelectedSiswa(s);
    setSearchTerm("");
    setCartItems([]);
    const dept = getKelasAktif(s)?.kelas?.departemen_id;
    if (dept && !departemenId) setDepartemenId(dept);
    // Reset filter tahun ajaran ke tahun aktif setiap ganti siswa.
    // Tanpa ini, jika kasir sebelumnya membuka tahun ajaran lama (mis. untuk
    // cek/bayar tunggakan), pemilihan itu akan "nyangkut" dan pembayaran
    // siswa berikutnya tercatat dengan tahun_ajaran_id yang salah — sehingga
    // tidak match ke tagihan di tahun ajaran yang benar dan tetap muncul
    // sebagai belum lunas di portal ortu.
    if (tahunAktif?.id) setSelectedTahunAjaranId(tahunAktif.id);
  }, [departemenId, tahunAktif?.id]);

  const handleAddToCart = () => {
    if (!selectedSiswa || !form.jenisId || !form.jumlah || !selectedJenis || tarifTidakAda) return;
    if (!tahunAktif?.id) { toast.error("Tahun ajaran aktif belum dikonfigurasi"); return; }
    if (isSekali && pembayaranSekali?.lunas) { toast.error("Pembayaran ini sudah lunas"); return; }
    if (!isSekali && bulanLunas.has(form.bulan)) {
      toast.error("Pembayaran bulan ini sudah lunas");
      return;
    }

    const jumlah = Number(form.jumlah);
    if (!Number.isFinite(jumlah) || jumlah <= 0) return;
    if (isSekali && ringkasanTagihanSekali && jumlah > ringkasanTagihanSekali.remaining) {
      toast.error("Jumlah pembayaran melebihi sisa tagihan");
      return;
    }

    const key = currentCartKey;
    if (currentAlreadyInCart) {
      toast.info("Tagihan ini sudah ada di keranjang");
      return;
    }

    setCartItems(prev => [...prev, {
      key,
      tagihanId: existingTagihan?.id,
      jenisId: form.jenisId,
      jenisNama: selectedJenis.nama,
      jenisTipe: selectedJenis.tipe,
      bulan: isSekali ? 0 : form.bulan,
      jumlah,
      tahunAjaranId: effectiveTahunAjaranId,
      departemenId: departemenId || undefined,
      isBayarDimuka,
      status: existingTagihan?.status ?? null,
      tahunLabel: selectedTahunLabel,
    }]);

    // Untuk pembayaran bulanan, pindahkan pilihan ke bulan tagihan berikutnya
    // agar kasir bisa menambahkan beberapa bulan dengan cepat.
    if (!isSekali) {
      const nextMonth = bulanTampil.find(m =>
        m !== form.bulan &&
        !bulanLunas.has(m) &&
        !cartItems.some(item => item.jenisId === form.jenisId && item.bulan === m && item.tahunAjaranId === effectiveTahunAjaranId)
      );
      if (nextMonth) setField("bulan", nextMonth);
    } else {
      setField("jenisId", "");
      setField("jumlah", "");
    }
    toast.success("Ditambahkan ke keranjang");
  };

  const handlePayCart = async () => {
    if (!selectedSiswa || cartItems.length === 0 || isCartPaying) return;
    setIsCartPaying(true);
    setCartProgress({ done: 0, total: cartItems.length });

    const berhasilKeys = new Set<string>();
    const berhasilItems: Array<{ pembayaran_id: string; jumlah: number; jenisNama: string; bulan: number; tahunLabel: string }> = [];
    let petugasNama: string | undefined;
    const gagal: string[] = [];

    for (let i = 0; i < cartItems.length; i++) {
      const item = cartItems[i];
      try {
        const result = await prosesPembayaran({
          data: {
            siswa_id: selectedSiswa.id,
            jenis_id: item.jenisId,
            bulan: item.bulan,
            jumlah: item.jumlah,
            tanggal_bayar: form.tanggalBayar,
            keterangan: form.keterangan || undefined,
            departemen_id: item.departemenId,
            tahun_ajaran_id: item.tahunAjaranId,
            is_bayar_dimuka: item.isBayarDimuka,
            tagihan_id: item.tagihanId,
          },
        });
        berhasilKeys.add(item.key);
        petugasNama = petugasNama || result.petugas_nama || undefined;
        berhasilItems.push({
          pembayaran_id: result.pembayaran_id,
          jumlah: result.jumlah,
          jenisNama: item.jenisNama,
          bulan: item.bulan,
          tahunLabel: item.tahunLabel,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Gagal diproses";
        gagal.push(item.jenisNama + (item.bulan ? " " + namaBulan(item.bulan) : "") + ": " + message);
      }
      setCartProgress({ done: i + 1, total: cartItems.length });
    }

    setCartItems(prev => prev.filter(item => !berhasilKeys.has(item.key)));
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pembayaran"] }),
      queryClient.invalidateQueries({ queryKey: ["pembayaran_siswa"] }),
      queryClient.invalidateQueries({ queryKey: ["tagihan"] }),
      queryClient.invalidateQueries({ queryKey: ["jurnal"] }),
      queryClient.invalidateQueries({ queryKey: ["tunggakan"] }),
      queryClient.invalidateQueries({ queryKey: ["cek_bulan_dibayar"] }),
      queryClient.invalidateQueries({ queryKey: ["cek_bulan_ada_tagihan"] }),
      queryClient.invalidateQueries({ queryKey: ["open_tagihan_jenis"] }),
      queryClient.invalidateQueries({ queryKey: ["open_tagihan_jenis_extras"] }),
      queryClient.invalidateQueries({ queryKey: ["legacy_outstanding_breakdown"] }),
    ]);

    if (berhasilItems.length > 0) {
      setLastCartPayment({
        items: berhasilItems,
        siswa: selectedSiswa,
        tanggal_bayar: form.tanggalBayar,
        keterangan: form.keterangan || undefined,
        petugasNama,
      });
      setShowCartKuitansi(true);
    }

    if (berhasilKeys.size > 0 && gagal.length === 0) {
      toast.success(berhasilKeys.size + " pembayaran berhasil diproses");
    } else if (berhasilKeys.size > 0) {
      toast.success(berhasilKeys.size + " pembayaran berhasil");
      toast.error(gagal.length + " gagal: " + gagal.slice(0, 2).join(" | "));
    } else {
      toast.error("Semua item keranjang gagal diproses");
    }

    setCartProgress(null);
    setIsCartPaying(false);
  };

  const handleSubmit = async () => {
    if (!selectedSiswa || !form.jenisId || !form.jumlah || tarifTidakAda) return;
    if (!tahunAktif?.id) { toast.error("Tahun ajaran aktif belum dikonfigurasi"); return; }
    if (isSekali && pembayaranSekali?.lunas) { toast.error("Pembayaran ini sudah lunas"); return; }
    const jumlahInput = Number(form.jumlah);
    if (!Number.isFinite(jumlahInput) || jumlahInput <= 0) {
      toast.error("Jumlah pembayaran harus lebih dari 0");
      return;
    }
    if (isSekali && ringkasanTagihanSekali && jumlahInput > ringkasanTagihanSekali.remaining) {
      toast.error("Jumlah pembayaran melebihi sisa tagihan");
      return;
    }

    const result = await prosesMutation.mutateAsync({
      siswa_id:        selectedSiswa.id,
      jenis_id:        form.jenisId,
      bulan:           isSekali ? 0 : form.bulan,
      jumlah:          jumlahInput,
      tanggal_bayar:   form.tanggalBayar,
      keterangan:      isBayarDimuka
        ? `[DIMUKA] ${form.keterangan || ""} - Untuk TA: ${tahunAjaranList?.find(t => t.id === effectiveTahunAjaranId)?.nama ?? ""}`.trim()
        : form.keterangan || undefined,
      departemen_id:   departemenId || undefined,
      tahun_ajaran_id: effectiveTahunAjaranId,
      is_bayar_dimuka: isBayarDimuka,
      tagihan_id:      existingTagihan?.id,
    });
    if (!result) return;

    setLastPayment({
      pembayaran_id: result.pembayaran_id,
      jumlah:        result.jumlah,
      jenisNama:     selectedJenis?.nama ?? "",
      jenisTipe:     selectedJenis?.tipe ?? "",
      siswa:         selectedSiswa,
      bulan:         form.bulan,
      tanggal_bayar: form.tanggalBayar,
      periodeLabel: !isSekali && selectedTahunLabel
        ? `${namaBulan(form.bulan)} ${selectedTahunLabel}`
        : undefined,
      petugasNama: result.petugas_nama || undefined,
    });
    setShowKuitansi(true);
    resetForm();
    toast.success("Pembayaran berhasil disimpan");
  };

  const riwayatColumns: DataTableColumn<PembayaranRiwayat>[] = [
    { key: "jenis_pembayaran", label: "Jenis", render: (_, r) => r.jenis_pembayaran?.nama ?? "-" },
    { key: "bulan",   label: "Periode Tagihan",   render: (v, r) => v ? (r.periodeTagihanLabel || namaBulanTahun(v as number, { tanggalTransaksi: r.tanggal_bayar })) : <span className="text-muted-foreground text-xs">Sekali Bayar{r.tanggal_bayar ? ` ${new Date(r.tanggal_bayar).getFullYear()}` : ""}</span> },
    { key: "jumlah",  label: "Jumlah",  render: v => formatRupiah(Number(v)) },
    { key: "tanggal_bayar", label: "Tanggal", render: v => v ? format(new Date(v as string), "dd MMM yyyy", { locale: idLocale }) : "-" },
    {
      key: "aksi",
      label: "",
      render: (_: unknown, r: PembayaranRiwayat) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setRiwayatPrintTarget(r)}
          >
            <Printer className="h-3.5 w-3.5 mr-1" />Cetak
          </Button>
          {canBatal && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={() => { setBatalTarget(r); setBatalAlasan(""); }}
            >
              <X className="h-3.5 w-3.5 mr-1" />Batalkan
            </Button>
          )}
        </div>
      ),
    } as DataTableColumn<PembayaranRiwayat>,
  ];

  return (
    <div className="space-y-0 animate-fade-in">
      <div className="mb-3">
        <h1 className="text-xl font-bold text-foreground">Input Pembayaran</h1>
        <p className="text-xs text-muted-foreground">Input dan kelola pembayaran siswa</p>
        {!tahunAktif && <p className="text-xs text-destructive font-medium mt-1">⚠️ Tahun ajaran aktif belum dikonfigurasi.</p>}
      </div>

      <div className="flex gap-2 items-end border-b border-border pb-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            placeholder="Cari nama, NIS, atau nama + kelas (contoh: Shofiyya 2C)..."
            value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            className="pl-10 h-11 text-base"
          />
          {searchResults && searchResults.length > 0 && searchTerm.length >= 2 && (
            <div className="absolute z-50 mt-1 w-full bg-popover border rounded-lg shadow-lg max-h-60 overflow-y-auto">
              {searchResults.map(s => (
                <button key={s.id} className="w-full text-left px-4 py-2.5 hover:bg-accent flex items-center gap-3"
                  onClick={() => handleSelectSiswa(s)}>
                  <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0">{s.nama?.[0]}</div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{s.nama}</p>
                    <p className="text-xs text-muted-foreground">NIS: {s.nis ?? "-"} • {getKelasAktif(s)?.kelas?.nama ?? "-"}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <Select value={departemenId || "__all__"} onValueChange={v => { setDepartemenId(v === "__all__" ? "" : v); setSelectedSiswa(null); setCartItems([]); setField("jenisId", ""); }}>
          <SelectTrigger className="w-44 h-11"><SelectValue placeholder="Semua lembaga" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Semua Lembaga</SelectItem>
            {lembagaList?.map(l => <SelectItem key={l.id} value={l.id}>{l.kode} — {l.nama}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={selectedTahunAjaranId || tahunAktif?.id || ""} onValueChange={setSelectedTahunAjaranId}>
          <SelectTrigger className="w-48 h-11"><SelectValue placeholder="Tahun Ajaran" /></SelectTrigger>
          <SelectContent>
            {tahunAjaranList
              ?.filter(t => !t.ditutup || openTagihanTahunIds.has(t.id))
              .map(t => (
                <SelectItem key={t.id} value={t.id}>
                  {t.nama} {t.aktif ? "(Aktif)" : t.ditutup && openTagihanTahunIds.has(t.id) ? "(Tunggakan lama)" : ""}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        {selectedSiswa && (
          <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0"
            onClick={() => { setSelectedSiswa(null); setCartItems([]); setField("jenisId", ""); }}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {selectedSiswa ? (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="space-y-4">
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold text-primary shrink-0">{selectedSiswa.nama?.[0]}</div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-sm truncate">{selectedSiswa.nama}</h3>
                  <p className="text-xs text-muted-foreground">NIS: {selectedSiswa.nis ?? "-"}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1 text-xs">
                <span className="text-muted-foreground">Kelas</span><span className="font-medium">{kelasNama}</span>
                <span className="text-muted-foreground">Lembaga</span><span className="font-medium">{lembagaNama}</span>
              </div>
            </div>
            {legacyBreakdown.length > 0 && (
              <div className="rounded-lg border p-4">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Rincian dari Aplikasi Lama
                </h4>
                <div className="space-y-2">
                  {legacyBreakdown.map((row, i) => (
                    <div key={`${row.kode_lama ?? "legacy"}-${row.nama_lama}-${i}`} className="text-xs border-b border-border/50 pb-2 last:border-0 last:pb-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium leading-snug">
                            {row.kode_lama ? `${row.kode_lama} — ` : ""}{row.nama_lama}
                          </p>
                        </div>
                        <span className="font-semibold shrink-0">{formatRupiah(row.nominal)}</span>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-1 text-xs font-semibold">
                    <span>Total rincian legacy</span>
                    <span>{formatRupiah(legacyBreakdown[0]?.breakdown_total ?? 0)}</span>
                  </div>
                  {!legacyBreakdown[0]?.exact_match && (
                    <p className="text-[10px] text-amber-600 leading-relaxed">
                      Rincian di atas adalah sumber migrasi. Ada pembayaran/penyesuaian setelah snapshot,
                      sehingga jumlah bayar pada form tetap menjadi acuan saldo terkini.
                    </p>
                  )}
                </div>
              </div>
            )}
            <div className="rounded-lg border p-4">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Riwayat Terakhir</h4>
              <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                {loadRiwayat ? <p className="text-xs text-muted-foreground">Memuat...</p>
                  : riwayat?.length ? riwayat.slice(0, 8).map((r, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{r.jenis_pembayaran?.nama ?? "-"}</p>
                        <p className="text-muted-foreground">{r.bulan ? namaBulanTahun(r.bulan, { tanggalTransaksi: r.tanggal_bayar }) : "-"} • {r.tanggal_bayar ? format(new Date(r.tanggal_bayar), "dd/MM/yy") : "-"}</p>
                      </div>
                      <span className="font-medium text-primary shrink-0 ml-2">{formatRupiah(Number(r.jumlah))}</span>
                    </div>
                  )) : <p className="text-xs text-muted-foreground">Belum ada riwayat</p>}
              </div>
            </div>
          </div>

          <div className="rounded-lg border p-4 space-y-4">
            <h4 className="text-sm font-semibold">Input Pembayaran</h4>
            {isBayarDimuka && (
              <div className="rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 p-2">
                <p className="text-[11px] text-amber-700 dark:text-amber-400 font-medium">
                  ⚡ Pembayaran Di Muka — dicatat sebagai liabilitas, diakui saat tahun ajaran target dimulai.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Jenis Pembayaran</Label>
                <Select value={form.jenisId} onValueChange={v => { setField("jenisId", v); setField("jumlah", ""); }}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Pilih jenis" /></SelectTrigger>
                  <SelectContent>
                    {jenisList.map(j => <SelectItem key={j.id} value={j.id}>{j.nama}</SelectItem>)}
                  </SelectContent>
                </Select>
                {loadingTarif && form.jenisId && (
                  <p className="text-[11px] text-muted-foreground animate-pulse">Mengambil tarif...</p>
                )}
                {!loadingTarif && tarifNominal != null && !adaTagihanDipilih && (
                  <p className="text-[11px] text-primary">⚡ Tarif: {formatRupiah(tarifNominal)}</p>
                )}
                {tarifTidakAda && (
                  <p className="text-[11px] text-destructive font-medium">⚠️ Tarif belum dikonfigurasi</p>
                )}
                {existingTagihan && ["belum_bayar", "sebagian", "terjadwal"].includes(String(existingTagihan.status)) && (
                  <div className="space-y-1">
                    <p className="text-[11px] text-amber-600">
                      📋 Sisa tagihan: {formatRupiah(
                        isSekali && ringkasanTagihanSekali
                          ? ringkasanTagihanSekali.remaining
                          : Number(existingTagihan.nominal)
                      )}
                      {existingTagihan.status === "sebagian" ? " · Dibayar sebagian" : ""}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => setShowTagihanPrint(true)}
                    >
                      <Printer className="h-3.5 w-3.5 mr-1" />Cetak Tagihan
                    </Button>
                  </div>
                )}
                {currentAlreadyInCart && (
                  <p className="text-[11px] text-primary font-medium">🛒 Tagihan ini sudah ada di keranjang</p>
                )}
              </div>

              <div className="space-y-1">
                {!isSekali ? (
                  <>
                    <Label className="text-xs">
                      Bulan
                      {loadingBulan && <span className="ml-1 text-[10px] text-muted-foreground animate-pulse">memuat...</span>}
                    </Label>
                    {/* FIX: dropdown hanya tampilkan bulan yang ada tagihannya */}
                    <Select value={String(form.bulan)} onValueChange={v => setField("bulan", Number(v))}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {bulanTampil.map(m => {
                          const sudah = bulanLunas.has(m);
                          return (
                            <SelectItem key={m} value={String(m)} disabled={sudah}>
                              {namaBulan(m)}{selectedTahunLabel ? ` ${selectedTahunLabel}` : ""}
                              {sudah ? " ✓" : statusTagihanPerBulan?.get(m) === "terjadwal" ? " · Terjadwal" : ""}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </>
                ) : (
                  <div />
                )}
              </div>
            </div>

            {/* ── Grid Status Bulan ───────────────────────────────────────────────── */}
            {!isSekali && form.jenisId && selectedSiswa && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label className="text-xs">Status Bulan</Label>
                  {bulanTampil.length > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      {sudahBayar} lunas · {belumBayar} jatuh tempo · {terjadwal} terjadwal
                    </span>
                  )}
                </div>
                {loadingBulan ? (
                  <p className="text-[11px] text-muted-foreground animate-pulse">Memuat status bulan...</p>
                ) : bulanTampil.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground italic">Belum ada tagihan untuk jenis ini.</p>
                ) : (
                  <div className="grid grid-cols-4 gap-1">
                    {/* FIX: hanya render bulanTampil (bulan yg punya tagihan), bukan semua 12 bulan */}
                    {bulanTampil.map(m => {
                      const sudah = bulanLunas.has(m);
                      const isTerjadwal = statusTagihanPerBulan?.get(m) === "terjadwal";
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => !sudah && setField("bulan", m)}
                          title={sudah ? "Lunas" : isTerjadwal ? "Belum jatuh tempo" : "Belum bayar"}
                          className={cn(
                            "rounded px-1.5 py-1 text-[10px] font-medium border transition-colors",
                            sudah
                              ? "bg-green-50 border-green-200 text-green-700 cursor-default"
                              : form.bulan === m
                              ? "bg-primary border-primary text-primary-foreground"
                              : isTerjadwal
                              ? "bg-muted/60 border-dashed border-border text-muted-foreground hover:border-primary/50"
                              : "bg-background border-border text-foreground hover:border-primary/50"
                          )}
                        >
                          {namaBulan(m).slice(0, 3)}
                          {sudah && <Check className="inline ml-0.5 h-2.5 w-2.5" />}
                          {!sudah && isTerjadwal && <Clock3 className="inline ml-0.5 h-2.5 w-2.5" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Status Sekali Bayar ─────────────────────────────────────────────── */}
            {isSekali && existingTagihan && ["belum_bayar", "sebagian", "terjadwal"].includes(String(existingTagihan.status)) ? (
              <div className="rounded-md border px-3 py-2 text-xs bg-amber-50 border-amber-200 text-amber-700">
                <div className="font-medium">
                  Sisa tagihan: {formatRupiah(ringkasanTagihanSekali?.remaining ?? Number(existingTagihan.nominal))}
                </div>
                {ringkasanTagihanSekali && ringkasanTagihanSekali.paid > 0 && (
                  <div className="mt-0.5">
                    Sudah dibayar: {formatRupiah(ringkasanTagihanSekali.paid)}
                  </div>
                )}
                {cicilanSekaliDiizinkan ? (
                  <div className="mt-1 text-[11px]">
                    Nominal cicilan bebas, maksimal sebesar sisa tagihan.
                  </div>
                ) : existingTagihan.status === "terjadwal" ? (
                  <div className="mt-1 text-[11px]">
                    Belum jatuh tempo — pembayaran saat ini harus penuh.
                  </div>
                ) : null}
              </div>
            ) : isSekali && pembayaranSekali ? (
              <div className={cn(
                "rounded-md border px-3 py-2 text-xs",
                pembayaranSekali.lunas
                  ? "bg-green-50 border-green-200 text-green-700"
                  : "bg-amber-50 border-amber-200 text-amber-700"
              )}>
                {pembayaranSekali.lunas
                  ? `✓ Lunas — Total dibayar: ${formatRupiah(pembayaranSekali.totalBayar)}`
                  : `Sudah dibayar: ${formatRupiah(pembayaranSekali.totalBayar)} dari ${formatRupiah(tarifNominal ?? 0)}`}
              </div>
            ) : null}

            {/* ── Nominal ────────────────────────────────────────────────────────── */}
            <div className="space-y-1">
              <Label className="text-xs">Jumlah Bayar (Rp)</Label>
              <Input
                type="number"
                value={form.jumlah}
                onChange={e => setField("jumlah", e.target.value)}
                readOnly={isJumlahLocked}
                className={cn("h-9 text-sm", isJumlahLocked && "bg-muted")}
                placeholder="0"
              />
            </div>

            {/* ── Tanggal ────────────────────────────────────────────────────────── */}
            <div className="space-y-1">
              <Label className="text-xs">Tanggal Bayar</Label>
              <Input
                type="date"
                value={form.tanggalBayar}
                onChange={e => setField("tanggalBayar", e.target.value)}
                readOnly={isKasir}
                disabled={isKasir}
                className={cn("h-9 text-sm", isKasir && "bg-muted cursor-not-allowed")}
              />
              {isKasir && (
                <p className="text-[11px] text-muted-foreground">
                  Tanggal pembayaran kasir otomatis mengikuti tanggal hari ini.
                </p>
              )}
            </div>

            {/* ── Keterangan ─────────────────────────────────────────────────────── */}
            <div className="space-y-1">
              <Label className="text-xs">Keterangan (opsional)</Label>
              <Textarea
                value={form.keterangan}
                onChange={e => setField("keterangan", e.target.value)}
                className="text-sm resize-none h-16"
                placeholder="Misal: bayar tunai, transfer BCA..."
              />
            </div>

            {/* ── Aksi Pembayaran ──────────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="h-9"
                onClick={handleAddToCart}
                disabled={
                  !form.jenisId || !form.jumlah || tarifTidakAda ||
                  isCartPaying ||
                  currentAlreadyInCart ||
                  (isSekali && !!pembayaranSekali?.lunas) ||
                  (!isSekali && bulanLunas.has(form.bulan))
                }
              >
                <ShoppingCart className="h-3.5 w-3.5 mr-1.5" />
                Tambah ke Keranjang
              </Button>
              <Button
                className="h-9"
                onClick={handleSubmit}
                disabled={
                  !form.jenisId || !form.jumlah || tarifTidakAda ||
                  prosesMutation.isPending || isCartPaying || currentAlreadyInCart ||
                  (isSekali && !!pembayaranSekali?.lunas) ||
                  (!isSekali && bulanLunas.has(form.bulan))
                }
              >
                {prosesMutation.isPending ? (
                  <span className="flex items-center gap-1.5">
                    <span className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Memproses...
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <Printer className="h-3.5 w-3.5" />
                    Bayar Langsung
                  </span>
                )}
              </Button>
            </div>

            {cartItems.length > 0 && (
              <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <ShoppingCart className="h-4 w-4" />
                    <span className="text-sm font-semibold">Keranjang Pembayaran</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{cartItems.length} item</span>
                </div>

                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {cartItems.map(item => (
                    <div key={item.key} className="flex items-center justify-between gap-2 rounded-md border bg-background px-2.5 py-2 text-xs">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{item.jenisNama}</p>
                        <p className="text-muted-foreground">
                          {item.bulan ? `${namaBulan(item.bulan)} ${item.tahunLabel}`.trim() : "Sekali Bayar"}
                          {item.status === "terjadwal" ? " · Terjadwal" : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-semibold">{formatRupiah(item.jumlah)}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          disabled={isCartPaying}
                          onClick={() => setCartItems(prev => prev.filter(row => row.key !== item.key))}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between border-t pt-2 text-sm">
                  <span className="font-medium">Total</span>
                  <span className="font-bold">{formatRupiah(cartTotal)}</span>
                </div>

                <Button className="w-full h-9" onClick={handlePayCart} disabled={isCartPaying}>
                  {isCartPaying ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      Memproses {cartProgress?.done ?? 0}/{cartProgress?.total ?? cartItems.length}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <Check className="h-3.5 w-3.5" />
                      Bayar Semua · {formatRupiah(cartTotal)}
                    </span>
                  )}
                </Button>
                <p className="text-[10px] text-muted-foreground">
                  Setiap item divalidasi ulang oleh server. Item yang gagal tetap berada di keranjang dan tidak menggandakan pembayaran yang sudah berhasil.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
          <Search className="h-10 w-10 mb-3 opacity-20" />
          <p className="text-sm font-medium">Cari siswa untuk memulai</p>
          <p className="text-xs mt-1">Ketik minimal 2 karakter NIS atau nama siswa</p>
        </div>
      )}

      {/* ── Dialog Riwayat Pembayaran ───────────────────────────────────────────── */}
      {selectedSiswa && (
        <div className="mt-4 rounded-lg border p-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Semua Riwayat Pembayaran
          </h4>
          {canBatal && (
            <div className="mb-3 rounded-md border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Salah input pembayaran? Gunakan tombol "Batalkan" di baris yang salah.</p>
              <p>Sistem otomatis membalik jurnal kas, mengembalikan tagihan ke status belum bayar, lalu menghapus baris pembayaran sehingga bisa diinput ulang yang benar. Pembayaran di muka (termasuk yang sudah diakui) ditangani otomatis. Wajib isi alasan; tercatat di Audit Perubahan Data.</p>
              <p>Catatan: pembayaran pada periode yang sudah tutup buku tidak bisa dibatalkan. Hanya admin/keuangan yang dapat membatalkan (kasir cukup melapor).</p>
            </div>
          )}
          <DataTable
            columns={riwayatColumns}
            data={riwayat ?? []}
            isLoading={loadRiwayat}
            emptyMessage="Belum ada pembayaran"
          />
        </div>
      )}

      {/* ── Dialog Batalkan Pembayaran ──────────────────────────────────────────── */}
      <Dialog open={!!batalTarget} onOpenChange={(o) => { if (!o) { setBatalTarget(null); setBatalAlasan(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <X className="h-5 w-5" />Batalkan Pembayaran
            </DialogTitle>
          </DialogHeader>
          {batalTarget && (
            <div className="space-y-3">
              <div className="rounded-md border border-destructive/20 bg-destructive/5 p-2 text-xs text-destructive">
                Hanya untuk <strong>koreksi salah-input</strong> (uang belum benar-benar berpindah/disetor).
                Jurnal kas akan dibalik & tagihan terkait dikembalikan ke status belum bayar. Tercatat di Audit.
              </div>
              <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1">
                <p>Jenis: <span className="font-medium">{batalTarget.jenis_pembayaran?.nama ?? "-"}</span>
                  {batalTarget.bulan ? ` (${namaBulanTahun(batalTarget.bulan, { tanggalTransaksi: batalTarget.tanggal_bayar })})` : ""}</p>
                <p>Jumlah: <span className="font-semibold text-destructive">{formatRupiah(Number(batalTarget.jumlah))}</span></p>
                <p>Tanggal: <span className="font-medium">{batalTarget.tanggal_bayar ? format(new Date(batalTarget.tanggal_bayar), "dd MMM yyyy", { locale: idLocale }) : "-"}</span></p>
              </div>
              <div>
                <Label>Alasan Pembatalan *</Label>
                <Textarea rows={2} placeholder="mis. Salah pilih siswa / salah bulan / dobel input..."
                  value={batalAlasan} onChange={(e) => setBatalAlasan(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBatalTarget(null); setBatalAlasan(""); }}>Batal</Button>
            <Button variant="destructive"
              disabled={!batalAlasan.trim() || batalMutation.isPending}
              onClick={() => {
                if (!batalTarget) return;
                batalMutation.mutate(
                  {
                    pembayaran_id: batalTarget.id,
                    alasan: batalAlasan,
                    jumlah: Number(batalTarget.jumlah),
                    keterangan: `${batalTarget.jenis_pembayaran?.nama ?? ""}${batalTarget.bulan ? ` (${namaBulanTahun(batalTarget.bulan, { tanggalTransaksi: batalTarget.tanggal_bayar })})` : ""}`,
                  },
                  { onSuccess: () => { setBatalTarget(null); setBatalAlasan(""); } }
                );
              }}>
              {batalMutation.isPending ? "Memproses..." : "Batalkan & Balik Jurnal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog Kuitansi Gabungan ─────────────────────────────────────────────── */}
      {lastCartPayment && (
        <Dialog open={showCartKuitansi} onOpenChange={setShowCartKuitansi}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Bukti Pembayaran Gabungan</DialogTitle>
            </DialogHeader>
            <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
              <p><span className="font-medium">{lastCartPayment.items.length} pembayaran</span> berhasil diproses.</p>
              <p>Total: <span className="font-bold">{formatRupiah(lastCartPayment.items.reduce((sum, item) => sum + item.jumlah, 0))}</span></p>
              <p className="text-xs text-muted-foreground">Setiap item tetap memiliki referensi pembayaran dan jurnal masing-masing.</p>
            </div>
            <PrintKuitansiGabungan
              items={lastCartPayment.items.map(item => ({
                id: item.pembayaran_id,
                jumlah: item.jumlah,
                jenisNama: item.jenisNama,
                bulan: item.bulan,
                periodeLabel: item.bulan ? `${namaBulan(item.bulan)} ${item.tahunLabel}`.trim() : "Sekali Bayar",
              }))}
              tanggalBayar={lastCartPayment.tanggal_bayar}
              keterangan={lastCartPayment.keterangan}
              siswa={lastCartPayment.siswa}
              kelasNama={kelasNama}
              lembagaNama={lembagaNama}
              petugasNama={lastCartPayment.petugasNama}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCartKuitansi(false)}>Tutup</Button>
              <Button onClick={() => window.print()}>
                <Printer className="h-4 w-4 mr-1.5" />
                Cetak Bukti Gabungan
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Cetak kuitansi dari riwayat ───────────────────────────────────────── */}
      {riwayatPrintTarget && selectedSiswa && (
        <Dialog open={!!riwayatPrintTarget} onOpenChange={(open) => !open && setRiwayatPrintTarget(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Kuitansi Pembayaran</DialogTitle>
            </DialogHeader>
            <PrintKuitansi
              payment={{
                id: riwayatPrintTarget.id,
                nomorJurnal: riwayatPrintTarget.jurnal?.nomor || undefined,
                jumlah: Number(riwayatPrintTarget.jumlah || 0),
                bulan: Number(riwayatPrintTarget.bulan || 0),
                tanggal_bayar: riwayatPrintTarget.tanggal_bayar || new Date().toISOString().slice(0, 10),
                keterangan: riwayatPrintTarget.keterangan || undefined,
                jenisNama: riwayatPrintTarget.jenis_pembayaran?.nama || "Pembayaran",
                periodeLabel: riwayatPrintTarget.periodeTagihanLabel || undefined,
                siswa: selectedSiswa,
              }}
              kelasNama={kelasNama}
              lembagaNama={lembagaNama}
              petugasNama={riwayatPrintTarget.petugas?.nama || undefined}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setRiwayatPrintTarget(null)}>Tutup</Button>
              <Button onClick={() => window.print()}>
                <Printer className="h-4 w-4 mr-1.5" />Cetak
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Cetak tagihan aktif (jatuh tempo / belum jatuh tempo) ───────────── */}
      {showTagihanPrint && existingTagihan && selectedSiswa && selectedJenis && (
        <Dialog open={showTagihanPrint} onOpenChange={setShowTagihanPrint}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Tagihan Siswa</DialogTitle>
            </DialogHeader>
            <PrintTagihan
              tagihan={{
                id: existingTagihan.id,
                jenisNama: selectedJenis.nama,
                periodeLabel: isSekali
                  ? (selectedTahun?.nama ? `TA ${selectedTahun.nama}` : "Sekali Bayar")
                  : `${namaBulan(form.bulan)} ${selectedTahunLabel}`.trim(),
                nominal: Number(existingTagihan.nominal),
                terbayar: isSekali ? (ringkasanTagihanSekali?.paid ?? 0) : 0,
                sisa: isSekali && ringkasanTagihanSekali
                  ? ringkasanTagihanSekali.remaining
                  : Number(existingTagihan.nominal),
                status: String(existingTagihan.status || "belum_bayar"),
                jatuhTempo: existingTagihan.jatuh_tempo || null,
                siswa: selectedSiswa,
              }}
              kelasNama={kelasNama}
              lembagaNama={lembagaNama}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowTagihanPrint(false)}>Tutup</Button>
              <Button onClick={() => window.print()}>
                <Printer className="h-4 w-4 mr-1.5" />Cetak Tagihan
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Dialog Kuitansi ────────────────────────────────────────────────────── */}
      {lastPayment && (
        <Dialog open={showKuitansi} onOpenChange={setShowKuitansi}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Kuitansi Pembayaran</DialogTitle>
            </DialogHeader>
            <PrintKuitansi
              payment={{
                id: lastPayment.pembayaran_id,
                jumlah: lastPayment.jumlah,
                bulan: lastPayment.bulan,
                tanggal_bayar: lastPayment.tanggal_bayar,
                jenisNama: lastPayment.jenisNama,
                periodeLabel: lastPayment.periodeLabel,
                siswa: lastPayment.siswa,
              }}
              kelasNama={kelasNama}
              lembagaNama={lembagaNama}
              petugasNama={lastPayment.petugasNama}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowKuitansi(false)}>Tutup</Button>
              <Button onClick={() => window.print()}>
                <Printer className="h-4 w-4 mr-1.5" />
                Cetak
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}