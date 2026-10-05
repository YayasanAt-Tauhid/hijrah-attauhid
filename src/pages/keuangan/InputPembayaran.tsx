import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { lazy, Suspense, useState, useMemo, useEffect, useCallback } from "react";
import { PrintKuitansi } from "@/components/shared/PrintKuitansi";
import { PrintKuitansiGabungan } from "@/components/shared/PrintKuitansiGabungan";
import { ReceiptOrientationSelect, type ReceiptPrintOrientation } from "@/components/shared/ReceiptOrientationSelect";
import { PrintTagihan, type PrintTagihanItem } from "@/components/shared/PrintTagihan";
import { RupiahInput } from "@/components/shared/RupiahInput";
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
  getPaymentReceiptGroups,
} from "@/server/pembayaran";
import type { LegacyOutstandingBreakdownRow, PaymentReceiptHistoryGroup } from "@/server/pembayaran";
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
import { Search, Printer, Plus, Check, X, ShoppingCart, Trash2, WalletCards, History, Info, Lock } from "lucide-react";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { calculateRemainingBill, isSppPaymentName, isUangPangkalPaymentName } from "@/lib/installment";
import {
  billingPeriodLabel,
  findBillingPrerequisite,
  sortBillingSequence,
  type BillingSequenceBill,
} from "@/lib/billingSequence";

import type {
  SiswaWithKelas,
  JenisPembayaran,
  PembayaranWithJenis,
  ProsesPembayaranRequest,
  FormPembayaran,
} from "@/types/keuangan";
import { isTipeSekali } from "@/types/keuangan";

const TambahTagihanDialog = lazy(() => import("./TabTarifTagihan"));

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
  receiptGroup?: PaymentReceiptHistoryGroup | null;
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
  sisaTagihan: number;
};

type OpenBillRow = {
  id: string;
  jenis_id: string;
  tahun_ajaran_id: string;
  bulan: number | null;
  nominal: number;
  nominal_bruto: number | null;
  nominal_diskon: number | null;
  status: string;
  jatuh_tempo: string | null;
  jenis_pembayaran: { id: string; nama: string; tipe: string } | null;
  tahun_ajaran: { id: string; nama: string; tanggal_mulai: string | null } | null;
  terbayar: number;
  sisa: number;
};

// Ambil baris kelas_siswa yang aktif -- kelas_siswa[0] TIDAK BOLEH dipakai langsung
// karena PostgREST tidak menjamin urutan baris relasi (bisa mengembalikan baris
// kelas lama/nonaktif di posisi pertama setelah siswa naik/pindah kelas), yang
// menyebabkan tarif & jenis pembayaran salah match ke kelas lama siswa.
function getKelasAktif(siswa: SiswaWithKelas | null | undefined) {
  const list = siswa?.kelas_siswa ?? [];
  return list.find((ks: any) => ks.aktif) ?? list[0];
}

function formatStatusSiswa(status?: string | null) {
  if (!status) return "—";
  return status.charAt(0).toUpperCase() + status.slice(1);
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
      qc.invalidateQueries({ queryKey: ["open_bills_payment_ui"] });
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
      qc.invalidateQueries({ queryKey: ["open_bills_payment_ui"] });
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
  // Filter lembaga pada kolom pencarian. Hanya berubah jika kasir memilihnya
  // sendiri; tidak ikut berubah saat siswa dipilih supaya pencarian siswa
  // berikutnya (lembaga lain) tetap menemukan hasil.
  const [filterLembagaId, setFilterLembagaId] = useState("");
  const siswaDepartemenId = getKelasAktif(selectedSiswa)?.kelas?.departemen_id ?? "";
  const departemenId = siswaDepartemenId || filterLembagaId;
  const [form, setForm] = useState<FormPembayaran>(FORM_DEFAULT);
  const [selectedTahunAjaranId, setSelectedTahunAjaranId] = useState("");
  const [showKuitansi, setShowKuitansi] = useState(false);
  const [kuitansiOrientation, setKuitansiOrientation] = useState<ReceiptPrintOrientation>("landscape");
  const [showTagihanPrint, setShowTagihanPrint] = useState(false);
  const [showTambahTagihan, setShowTambahTagihan] = useState(false);
  const [tagihanPrintItems, setTagihanPrintItems] = useState<PrintTagihanItem[]>([]);
  const [riwayatPrintTarget, setRiwayatPrintTarget] = useState<PembayaranRiwayat | null>(null);
  const [riwayatSearch, setRiwayatSearch] = useState("");
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
    receiptId?: string;
    receiptNumber?: string;
  } | null>(null);
  const [lastPayment, setLastPayment] = useState<{
    pembayaran_id: string; jumlah: number; jenisNama: string;
    jenisTipe: string; siswa: SiswaWithKelas; bulan: number; tanggal_bayar: string;
    periodeLabel?: string;
    petugasNama?: string;
    receiptId?: string;
    receiptNumber?: string;
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
  const isSiswaNonaktif = !!selectedSiswa &&
    ["keluar", "alumni", "pindah"].includes(String(selectedSiswa.status ?? ""));
  const payableTagihanStatuses = isSiswaNonaktif
    ? ["belum_bayar", "sebagian"]
    : ["belum_bayar", "sebagian", "terjadwal"];

  // Tahun buku yang sudah ditutup tetap harus dapat dipilih apabila siswa masih
  // memiliki tagihan terbuka dari periode tersebut. Ini penting untuk tunggakan
  // migrasi (mis. SPP November 2025) yang dibayar saat kas diterima pada 2026.
  const { data: openTagihanTahunIds = new Set<string>() } = useQuery<Set<string>>({
    queryKey: ["open_tagihan_tahun", selectedSiswa?.id, isSiswaNonaktif],
    enabled: !!selectedSiswa,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tagihan")
        .select("tahun_ajaran_id")
        .eq("siswa_id", selectedSiswa!.id)
        .in("status", payableTagihanStatuses);
      if (error) throw error;
      return new Set((data ?? []).map(row => row.tahun_ajaran_id).filter(Boolean) as string[]);
    },
  });

  useEffect(() => {
    if (!isSiswaNonaktif || openTagihanTahunIds.size === 0) return;
    const currentId = selectedTahunAjaranId || tahunAktif?.id || "";
    if (currentId && openTagihanTahunIds.has(currentId)) return;

    const target = (tahunAjaranList ?? [])
      .filter((tahun) => openTagihanTahunIds.has(tahun.id))
      .sort((a, b) => String(b.tanggal_mulai ?? "").localeCompare(String(a.tanggal_mulai ?? "")))[0];

    if (target?.id) setSelectedTahunAjaranId(target.id);
  }, [
    isSiswaNonaktif,
    openTagihanTahunIds,
    selectedTahunAjaranId,
    tahunAktif?.id,
    tahunAjaranList,
  ]);

  // Tagihan migrasi dapat berasal dari lembaga sebelumnya (mis. SD) sementara
  // siswa sekarang sudah berada di SMP. Jenis tagihan terbuka lintas lembaga
  // tetap harus tersedia di dropdown pembayaran, walaupun tidak termasuk
  // hasil useJenisPembayaran(departemenId) untuk lembaga siswa saat ini.
  const { data: openTagihanJenisExtras = [] } = useQuery<JenisPembayaran[]>({
    queryKey: ["open_tagihan_jenis_extras", selectedSiswa?.id, effectiveTahunAjaranId, isSiswaNonaktif],
    enabled: !!selectedSiswa && !!effectiveTahunAjaranId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tagihan")
        .select("jenis_id, jenis_pembayaran:jenis_id(id, nama, nominal, keterangan, departemen_id, akun_pendapatan_id, tipe)")
        .eq("siswa_id", selectedSiswa!.id)
        .eq("tahun_ajaran_id", effectiveTahunAjaranId)
        .in("status", payableTagihanStatuses);
      if (error) throw error;

      const byId = new Map<string, JenisPembayaran>();
      for (const row of (data ?? []) as any[]) {
        const jenis = row.jenis_pembayaran as JenisPembayaran | null;
        if (jenis?.id) byId.set(jenis.id, jenis);
      }
      return Array.from(byId.values());
    },
  });

  const { data: searchResults, isFetching: isSearching } = useQuery<SiswaWithKelas[]>({
    queryKey: ["search_siswa", searchTerm, filterLembagaId],
    enabled: searchTerm.trim().length >= 2,
    queryFn: async () => {
      const result = await cariSiswaPembayaran({
        data: {
          search: searchTerm,
          status: "aktif",
          include_nonaktif_with_open_bills: true,
          departemen_id: filterLembagaId || undefined,
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
    queryKey: ["open_tagihan_jenis", selectedSiswa?.id, effectiveTahunAjaranId, isSiswaNonaktif],
    enabled: !!selectedSiswa && !!effectiveTahunAjaranId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tagihan")
        .select("jenis_id")
        .eq("siswa_id", selectedSiswa!.id)
        .eq("tahun_ajaran_id", effectiveTahunAjaranId)
        .in("status", payableTagihanStatuses);
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

    if (isSiswaNonaktif) {
      return Array.from(merged.values()).filter(j => openTagihanJenisIds?.has(j.id));
    }

    return Array.from(merged.values()).filter(j =>
      applicableTarifJenisIds?.has(j.id) || openTagihanJenisIds?.has(j.id)
    );
  }, [
    allJenisList,
    selectedSiswa,
    applicableTarifJenisIds,
    openTagihanJenisIds,
    openTagihanJenisExtras,
    isSiswaNonaktif,
  ]);

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
    queryKey: ["cek_bulan_ada_tagihan", selectedSiswa?.id, form.jenisId, effectiveTahunAjaranId, isSiswaNonaktif],
    enabled: !!selectedSiswa && !!form.jenisId && !isSekali,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tagihan")
        .select("bulan, status")
        .eq("siswa_id", selectedSiswa!.id)
        .eq("jenis_id", form.jenisId)
        .eq("tahun_ajaran_id", effectiveTahunAjaranId)
        .in("status", payableTagihanStatuses)
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

  const { data: openBills = [], isLoading: loadOpenBills } = useQuery<OpenBillRow[]>({
    queryKey: ["open_bills_payment_ui", selectedSiswa?.id, effectiveTahunAjaranId, isSiswaNonaktif],
    enabled: !!selectedSiswa && !!effectiveTahunAjaranId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tagihan")
        .select("id, jenis_id, tahun_ajaran_id, bulan, nominal, nominal_bruto, nominal_diskon, status, jatuh_tempo, jenis_pembayaran:jenis_id(id, nama, tipe), tahun_ajaran:tahun_ajaran_id(id, nama, tanggal_mulai)")
        .eq("siswa_id", selectedSiswa!.id)
        .eq("tahun_ajaran_id", effectiveTahunAjaranId)
        .in("status", payableTagihanStatuses)
        .order("jatuh_tempo", { ascending: true });

      if (error) throw error;

      const rows = (data ?? []) as unknown as Omit<OpenBillRow, "terbayar" | "sisa">[];
      const ids = rows.map(row => row.id);
      const paidByBill = new Map<string, number>();

      if (ids.length > 0) {
        const { data: paidRows, error: paidError } = await supabase
          .from("pembayaran")
          .select("tagihan_id, jumlah")
          .in("tagihan_id", ids);
        if (paidError) throw paidError;

        for (const payment of paidRows ?? []) {
          if (!payment.tagihan_id) continue;
          paidByBill.set(
            payment.tagihan_id,
            (paidByBill.get(payment.tagihan_id) ?? 0) + Number(payment.jumlah ?? 0),
          );
        }
      }

      return rows
        .map(row => {
          const terbayar = paidByBill.get(row.id) ?? 0;
          return {
            ...row,
            terbayar,
            sisa: Math.max(0, Number(row.nominal ?? 0) - terbayar),
          };
        })
        .filter(row => row.sisa > 0);
    },
  });

  // Untuk kasir, urutan pembayaran bulanan diperiksa lintas tahun ajaran.
  // Jadi SPP lama tetap harus selesai walaupun layar sedang menampilkan tahun
  // ajaran yang lebih baru. Admin/keuangan tidak dibatasi oleh UI ini karena
  // mereka dapat membutuhkan koreksi historis.
  const { data: sequenceOpenBills = [] } = useQuery<BillingSequenceBill[]>({
    queryKey: ["open_bills_sequence", selectedSiswa?.id, isSiswaNonaktif],
    enabled: !!selectedSiswa && isKasir,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tagihan")
        .select("id, siswa_id, jenis_id, bulan, jatuh_tempo, tahun_ajaran:tahun_ajaran_id(nama, tanggal_mulai)")
        .eq("siswa_id", selectedSiswa!.id)
        .not("bulan", "is", null)
        .in("status", payableTagihanStatuses);
      if (error) throw error;
      return (data ?? []) as unknown as BillingSequenceBill[];
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

      const receiptGroups = await getPaymentReceiptGroups({
        data: { payment_ids: ids },
      });

      return rows.map(row => ({
        ...row,
        periodeTagihanLabel: periodeByPembayaran.get(row.id) ?? null,
        receiptGroup: receiptGroups[row.id] ?? null,
      }));
    },
  });

  const filteredRiwayat = useMemo(() => {
    const q = riwayatSearch.trim().toLowerCase();
    if (!q) return riwayat ?? [];
    return (riwayat ?? []).filter(row => {
      const haystack = [
        row.jenis_pembayaran?.nama,
        row.periodeTagihanLabel,
        row.tanggal_bayar,
        String(row.jumlah ?? ""),
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [riwayat, riwayatSearch]);

  const ringkasanTagihanSekali = useMemo(() => {
    if (!isSekali || !existingTagihan) return null;
    return calculateRemainingBill(
      Number(existingTagihan.nominal),
      pembayaranSekali?.totalBayar ?? 0,
    );
  }, [isSekali, existingTagihan?.id, existingTagihan?.nominal, pembayaranSekali?.totalBayar]);

  const selectedOpenBill = useMemo(
    () => openBills.find(bill => bill.id === existingTagihan?.id) ?? null,
    [openBills, existingTagihan?.id],
  );

  useEffect(() => {
    if (!form.jenisId) return;
    const isOpenBill = !!existingTagihan &&
      ["belum_bayar", "sebagian", "terjadwal"].includes(String(existingTagihan.status));
    const nominal = isOpenBill
      ? (selectedOpenBill?.sisa ??
          (isSekali && ringkasanTagihanSekali
            ? ringkasanTagihanSekali.remaining
            : Number(existingTagihan.nominal)))
      : isSekali && tarifNominal != null
        ? Math.max(Number(tarifNominal) - (pembayaranSekali?.totalBayar ?? 0), 0)
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
    selectedOpenBill?.sisa,
    pembayaranSekali?.totalBayar,
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
  const isSpp = !isSekali && isSppPaymentName(selectedJenis?.nama);
  const cicilanSekaliDiizinkan =
    isSekali &&
    !!existingTagihan &&
    (existingTagihan.status !== "terjadwal" ||
      isUangPangkalPaymentName(selectedJenis?.nama));
  const cicilanSppDiizinkan =
    isSpp && !!existingTagihan &&
    (existingTagihan.status !== "terjadwal" ||
      (!!existingTagihan.jatuh_tempo && existingTagihan.jatuh_tempo.slice(0, 7) + "-01" <= form.tanggalBayar));
  const cicilanDiizinkan = cicilanSekaliDiizinkan || cicilanSppDiizinkan;
  const sisaTagihanDipilih =
    selectedOpenBill?.sisa ??
    (isSekali && ringkasanTagihanSekali
      ? ringkasanTagihanSekali.remaining
      : Number(existingTagihan?.nominal ?? 0));
  const isJumlahLocked =
    (!!adaTagihanDipilih && !cicilanDiizinkan) ||
    (!adaTagihanDipilih && !isSekali && tarifNominal != null);
  // Untuk tunggakan tahun lama, pembayaran dicatat pada tahun buku kas saat
  // diterima (mis. 2026), sementara tagihannya tetap periode 2025. Karena itu
  // status "lunas" pada tagihan adalah sumber kebenaran tambahan selain tabel
  // pembayaran yang difilter berdasarkan tahun penerimaan.
  const bulanLunas = useMemo(
    () => new Set(
      bulanTampil.filter(m => {
        const status = statusTagihanPerBulan?.get(m);
        return status === "lunas" || (status == null && bulanDibayar?.has(m));
      })
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
  const billPeriodLabel = useCallback((bill: OpenBillRow) => {
    const year = bill.tahun_ajaran?.tanggal_mulai?.slice(0, 4) || bill.tahun_ajaran?.nama || "";
    return bill.bulan
      ? (namaBulan(bill.bulan) + " " + year).trim()
      : "Sekali Bayar" + (year ? " " + year : "");
  }, []);

  const fullySelectedPeriodicIds = useMemo(
    () =>
      new Set(
        cartItems
          .filter(
            (item) =>
              !!item.tagihanId &&
              item.bulan > 0 &&
              item.sisaTagihan > 0 &&
              item.jumlah >= item.sisaTagihan,
          )
          .map((item) => item.tagihanId as string),
      ),
    [cartItems],
  );

  const getKasirSequencePrerequisite = useCallback(
    (
      billId: string | undefined,
      selectedIds: ReadonlySet<string> = fullySelectedPeriodicIds,
    ) => {
      if (!isKasir || !billId) return null;
      const target = sequenceOpenBills.find((bill) => bill.id === billId);
      return target
        ? findBillingPrerequisite(target, sequenceOpenBills, selectedIds)
        : null;
    },
    [isKasir, sequenceOpenBills, fullySelectedPeriodicIds],
  );

  const directPaymentPrerequisite = useMemo(() => {
    if (!isKasir || isSekali || !form.jenisId) return null;
    if (existingTagihan?.id) {
      const target = sequenceOpenBills.find(
        (bill) => bill.id === existingTagihan.id,
      );
      return target
        ? findBillingPrerequisite(target, sequenceOpenBills)
        : null;
    }
    return (
      sortBillingSequence(
        sequenceOpenBills.filter(
          (bill) => bill.jenis_id === form.jenisId && Number(bill.bulan ?? 0) > 0,
        ),
      )[0] ?? null
    );
  }, [
    isKasir,
    isSekali,
    form.jenisId,
    existingTagihan?.id,
    sequenceOpenBills,
  ]);

  const cartPaymentPrerequisite = useMemo(() => {
    if (!isKasir || isSekali || !existingTagihan?.id) return null;
    return getKasirSequencePrerequisite(existingTagihan.id);
  }, [
    isKasir,
    isSekali,
    existingTagihan?.id,
    getKasirSequencePrerequisite,
  ]);

  const billToPrintItem = useCallback((bill: OpenBillRow): PrintTagihanItem | null => {
    if (!selectedSiswa || !bill.jenis_pembayaran) return null;
    return {
      id: bill.id,
      jenisNama: bill.jenis_pembayaran.nama,
      periodeLabel: billPeriodLabel(bill),
      nominal: Number(bill.nominal),
      terbayar: Number(bill.terbayar),
      sisa: Number(bill.sisa),
      status: bill.status,
      jatuhTempo: bill.jatuh_tempo,
      siswa: selectedSiswa,
    };
  }, [selectedSiswa, billPeriodLabel]);

  const tagihanPrintTotal = tagihanPrintItems.reduce((sum, item) => sum + Number(item.sisa || 0), 0);
  const allVisibleBillsSelected = openBills.length > 0 &&
    openBills.every(bill => cartItems.some(item => item.key === bill.id));
  const cartInvalid = cartItems.some(item => !Number.isFinite(item.jumlah) || item.jumlah <= 0);
  const kelasNama      = getKelasAktif(selectedSiswa)?.kelas?.nama ?? "-";
  const lembagaNama    = lembagaList?.find(l => l.id === departemenId)?.nama ?? "-";

  const prosesMutation = useProsesPembayaran();
  const batalMutation  = useBatalkanPembayaran();
  const canBatal = role === "admin" || role === "keuangan";
  const [batalTarget, setBatalTarget] = useState<PembayaranWithJenis | null>(null);
  const [batalAlasan, setBatalAlasan] = useState("");

  const handleSelectSiswa = useCallback((s: SiswaWithKelas) => {
    setSelectedSiswa(s);
    setShowTambahTagihan(false);
    setSearchTerm("");
    setCartItems([]);
    setTagihanPrintItems([]);
    setShowTagihanPrint(false);
    // Lembaga mengikuti siswa terpilih, jadi pilihan jenis dari siswa
    // sebelumnya (mungkin lembaga lain) harus direset.
    setField("jenisId", "");
    // Reset filter tahun ajaran ke tahun aktif setiap ganti siswa.
    // Tanpa ini, jika kasir sebelumnya membuka tahun ajaran lama (mis. untuk
    // cek/bayar tunggakan), pemilihan itu akan "nyangkut" dan pembayaran
    // siswa berikutnya tercatat dengan tahun_ajaran_id yang salah — sehingga
    // tidak match ke tagihan di tahun ajaran yang benar dan tetap muncul
    // sebagai belum lunas di portal ortu.
    if (tahunAktif?.id) setSelectedTahunAjaranId(tahunAktif.id);
  }, [setField, tahunAktif?.id]);

  const buildCartItemFromBill = (bill: OpenBillRow): PaymentCartItem | null => {
    if (!bill.jenis_pembayaran || bill.sisa <= 0) return null;
    const yearLabel =
      bill.tahun_ajaran?.tanggal_mulai?.slice(0, 4) ||
      bill.tahun_ajaran?.nama ||
      selectedTahunLabel;
    return {
      key: bill.id,
      tagihanId: bill.id,
      jenisId: bill.jenis_id,
      jenisNama: bill.jenis_pembayaran.nama,
      jenisTipe: bill.jenis_pembayaran.tipe,
      bulan: bill.bulan ?? 0,
      jumlah: bill.sisa,
      tahunAjaranId: bill.tahun_ajaran_id,
      departemenId: departemenId || undefined,
      isBayarDimuka,
      status: bill.status,
      tahunLabel: yearLabel,
      sisaTagihan: bill.sisa,
    };
  };

  // SPP tetap dapat dicicil sejak jatuh tempo meski pengakuannya menunggu akhir bulan.
  // Aturan yang sama dipaksa oleh server (prosesPembayaran), jadi ini hanya
  // menentukan apakah kolom jumlah boleh diubah kasir.
  const canPartialBill = (bill: OpenBillRow) =>
    !!bill.jenis_pembayaran &&
    (bill.status !== "terjadwal" ||
      (isSppPaymentName(bill.jenis_pembayaran.nama) && !!bill.jatuh_tempo && bill.jatuh_tempo.slice(0, 7) + "-01" <= form.tanggalBayar)) &&
    (bill.jenis_pembayaran.tipe === "sekali" || isSppPaymentName(bill.jenis_pembayaran.nama));

  const handleToggleBillPay = (bill: OpenBillRow, checked: boolean) => {
    if (!selectedSiswa) return;

    if (!checked) {
      setCartItems((prev) => {
        if (!isKasir || !bill.bulan) {
          return prev.filter((item) => item.key !== bill.id);
        }

        const target = sequenceOpenBills.find((row) => row.id === bill.id);
        if (!target) return prev.filter((item) => item.key !== bill.id);

        const sameSequence = sortBillingSequence(
          sequenceOpenBills.filter(
            (row) =>
              row.siswa_id === target.siswa_id &&
              row.jenis_id === target.jenis_id,
          ),
        );
        const index = sameSequence.findIndex((row) => row.id === bill.id);
        const removeIds = new Set(
          index >= 0
            ? sameSequence.slice(index).map((row) => row.id)
            : [bill.id],
        );
        return prev.filter(
          (item) => !item.tagihanId || !removeIds.has(item.tagihanId),
        );
      });
      return;
    }

    const prerequisite = getKasirSequencePrerequisite(bill.id);
    if (prerequisite) {
      toast.warning(
        `Selesaikan ${bill.jenis_pembayaran?.nama ?? "tagihan"} ${billingPeriodLabel(prerequisite)} terlebih dahulu`,
      );
      return;
    }

    const item = buildCartItemFromBill(bill);
    if (!item) return;
    setCartItems(prev => (prev.some(row => row.key === item.key) ? prev : [...prev, item]));
  };

  const handleToggleAllBillsPay = (checked: boolean) => {
    if (!selectedSiswa) return;
    const visibleIds = new Set(openBills.map(bill => bill.id));
    if (!checked) {
      setCartItems(prev => prev.filter(item => !visibleIds.has(item.key)));
      return;
    }

    if (!isKasir) {
      const items = openBills
        .map(buildCartItemFromBill)
        .filter((item): item is PaymentCartItem => !!item);
      setCartItems(prev => {
        const existing = new Set(prev.map(row => row.key));
        return [...prev, ...items.filter(item => !existing.has(item.key))];
      });
      return;
    }

    // Tambahkan hanya prefix yang sah. Bila ada tunggakan dari tahun ajaran
    // sebelumnya, tagihan yang lebih baru tetap terkunci sampai tunggakan itu
    // benar-benar ada di keranjang dengan nominal penuh.
    setCartItems((prev) => {
      const next = [...prev];
      const existingKeys = new Set(next.map((row) => row.key));
      const selectedIds = new Set(
        next
          .filter(
            (item) =>
              !!item.tagihanId &&
              item.bulan > 0 &&
              item.sisaTagihan > 0 &&
              item.jumlah >= item.sisaTagihan,
          )
          .map((item) => item.tagihanId as string),
      );

      const monthly = sortBillingSequence(
        openBills
          .filter((bill) => !!bill.bulan)
          .map((bill) => ({
            id: bill.id,
            jenis_id: bill.jenis_id,
            bulan: bill.bulan,
            jatuh_tempo: bill.jatuh_tempo,
            tahun_ajaran: bill.tahun_ajaran,
          })),
      );

      const orderedVisibleIds = new Set(monthly.map((bill) => bill.id));
      const candidates = [
        ...openBills.filter((bill) => !bill.bulan),
        ...monthly
          .map((row) => openBills.find((bill) => bill.id === row.id))
          .filter((bill): bill is OpenBillRow => !!bill),
      ];

      for (const bill of candidates) {
        if (existingKeys.has(bill.id)) continue;
        const prerequisite = bill.bulan
          ? (() => {
              const target = sequenceOpenBills.find((row) => row.id === bill.id);
              return target
                ? findBillingPrerequisite(
                    target,
                    sequenceOpenBills,
                    selectedIds,
                  )
                : null;
            })()
          : null;
        if (prerequisite) continue;

        const item = buildCartItemFromBill(bill);
        if (!item) continue;
        next.push(item);
        existingKeys.add(item.key);
        if (item.tagihanId && item.bulan > 0 && item.jumlah >= item.sisaTagihan) {
          selectedIds.add(item.tagihanId);
        }
      }

      // Variabel ini sengaja memastikan urutan bulanan sudah dihitung sebelum
      // kandidat diproses, sekaligus menjaga tipe hasil sort eksplisit.
      void orderedVisibleIds;
      return next;
    });
  };

  const handleCartAmountChange = (key: string, raw: string) => {
    const digits = raw.replace(/\D/g, "");
    const bill = openBills.find(row => row.id === key);
    let amount = digits ? Number(digits) : 0;
    if (bill && amount > bill.sisa) amount = bill.sisa;

    setCartItems((prev) => {
      let next = prev.map(item => (item.key === key ? { ...item, jumlah: amount } : item));
      if (!isKasir || !bill?.bulan || amount >= bill.sisa) return next;

      // Cicilan SPP lama boleh diterima, tetapi periode setelahnya tidak boleh
      // ikut dibayar sampai sisa periode lama benar-benar lunas.
      const target = sequenceOpenBills.find((row) => row.id === bill.id);
      if (!target) return next;
      const sameSequence = sortBillingSequence(
        sequenceOpenBills.filter(
          (row) =>
            row.siswa_id === target.siswa_id &&
            row.jenis_id === target.jenis_id,
        ),
      );
      const index = sameSequence.findIndex((row) => row.id === bill.id);
      const laterIds = new Set(
        index >= 0 ? sameSequence.slice(index + 1).map((row) => row.id) : [],
      );
      next = next.filter(
        (item) => !item.tagihanId || !laterIds.has(item.tagihanId),
      );
      return next;
    });
  };

  // Cetak tagihan yang dicentang; jika belum ada yang dicentang, cetak semua tagihan terbuka.
  const handlePrintTagihan = () => {
    const picked = openBills.filter(bill => cartItems.some(item => item.key === bill.id));
    const source = picked.length > 0 ? picked : openBills;
    const items = source
      .map(billToPrintItem)
      .filter((item): item is PrintTagihanItem => !!item);
    if (items.length === 0) return;
    setTagihanPrintItems(items);
    setShowTagihanPrint(true);
  };

  const handleAddToCart = () => {
    if (!selectedSiswa || !form.jenisId || !form.jumlah || !selectedJenis || tarifTidakAda) return;
    if (!tahunAktif?.id) { toast.error("Tahun ajaran aktif belum dikonfigurasi"); return; }
    if (isSekali && pembayaranSekali?.lunas) { toast.error("Pembayaran ini sudah lunas"); return; }
    if (!isSekali && bulanLunas.has(form.bulan)) {
      toast.error("Pembayaran bulan ini sudah lunas");
      return;
    }
    if (isKasir && !isSekali && cartPaymentPrerequisite) {
      toast.error(
        `Selesaikan ${selectedJenis.nama} ${billingPeriodLabel(cartPaymentPrerequisite)} terlebih dahulu`,
      );
      return;
    }
    if (isKasir && !isSekali && !existingTagihan?.id && directPaymentPrerequisite) {
      toast.error(
        `Selesaikan ${selectedJenis.nama} ${billingPeriodLabel(directPaymentPrerequisite)} terlebih dahulu`,
      );
      return;
    }

    const jumlah = Number(form.jumlah);
    if (!Number.isFinite(jumlah) || jumlah <= 0) return;
    if (cicilanDiizinkan && sisaTagihanDipilih > 0 && jumlah > sisaTagihanDipilih) {
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
      sisaTagihan: sisaTagihanDipilih > 0 ? sisaTagihanDipilih : jumlah,
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
    let receiptId: string | undefined;
    let receiptNumber: string | undefined;
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
            receipt_id: receiptId,
          },
        });
        berhasilKeys.add(item.key);
        receiptId = receiptId || result.receipt_id;
        receiptNumber = receiptNumber || result.receipt_number;
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
      queryClient.invalidateQueries({ queryKey: ["open_bills_payment_ui"] }),
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
        receiptId,
        receiptNumber,
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
    if (isKasir && !isSekali && directPaymentPrerequisite) {
      toast.error(
        `Selesaikan ${selectedJenis?.nama ?? "tagihan"} ${billingPeriodLabel(directPaymentPrerequisite)} terlebih dahulu`,
      );
      return;
    }
    const jumlahInput = Number(form.jumlah);
    if (!Number.isFinite(jumlahInput) || jumlahInput <= 0) {
      toast.error("Jumlah pembayaran harus lebih dari 0");
      return;
    }
    if (cicilanDiizinkan && sisaTagihanDipilih > 0 && jumlahInput > sisaTagihanDipilih) {
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
      receiptId: result.receipt_id,
      receiptNumber: result.receipt_number,
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
    { key: "status_ui", label: "Status", render: () => <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"><Check className="h-3 w-3" />Diterima</span> } as DataTableColumn<PembayaranRiwayat>,
    {
      key: "aksi",
      label: "Aksi",
      render: (_: unknown, r: PembayaranRiwayat) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRiwayatPrintTarget(r)}
          >
            <Printer className="h-4 w-4 mr-1.5" />Cetak Kuitansi
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
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Input Pembayaran</h1>
        <p className="text-sm text-muted-foreground">Input dan kelola pembayaran siswa</p>
        {!tahunAktif && (
          <p className="mt-1 text-xs font-medium text-destructive">
            Tahun ajaran aktif belum dikonfigurasi.
          </p>
        )}
      </div>

      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_190px_220px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Cari nama, NIS, atau nama + kelas (contoh: Shofiyya 2C)..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="h-10 pl-9"
          />
          {searchResults && searchResults.length > 0 && searchTerm.length >= 2 && (
            <div className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border bg-popover shadow-lg">
              {searchResults.map(siswa => (
                <button
                  key={siswa.id}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent"
                  onClick={() => handleSelectSiswa(siswa)}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {siswa.nama?.[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{siswa.nama}</p>
                      {siswa.status && siswa.status !== "aktif" && (
                        <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {formatStatusSiswa(siswa.status)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      NIS: {siswa.nis ?? "-"} · {getKelasAktif(siswa)?.kelas?.nama ?? "-"}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {searchResults && searchResults.length === 0 && !isSearching && searchTerm.trim().length >= 2 && (
            <div className="absolute z-50 mt-1 w-full rounded-lg border bg-popover px-4 py-3 text-sm text-muted-foreground shadow-lg">
              Siswa tidak ditemukan
              {filterLembagaId ? " pada lembaga yang difilter. Ubah filter ke \"Semua Lembaga\"." : "."}
            </div>
          )}
        </div>

        <SearchableSelect
          value={filterLembagaId || "__all__"}
          onValueChange={(value) => {
            setFilterLembagaId(value === "__all__" ? "" : value);
            setSelectedSiswa(null);
            setCartItems([]);
            setTagihanPrintItems([]);
            setShowTagihanPrint(false);
            setField("jenisId", "");
          }}
          className="h-10"
          placeholder="Semua lembaga"
          options={[
            { value: "__all__", label: <>Semua Lembaga</> },
            ...(lembagaList?.map((lembaga) => ({
              value: lembaga.id,
              label: (
                <>
                  {lembaga.kode} — {lembaga.nama}
                </>
              ),
            })) ?? []),
          ]}
        />

        <Select
          value={selectedTahunAjaranId || tahunAktif?.id || ""}
          onValueChange={value => {
            setSelectedTahunAjaranId(value);
            setTagihanPrintItems([]);
          }}
        >
          <SelectTrigger className="h-10">
            <SelectValue placeholder="Tahun Ajaran" />
          </SelectTrigger>
          <SelectContent>
            {tahunAjaranList
              ?.filter(tahun => !tahun.ditutup || openTagihanTahunIds.has(tahun.id))
              .map(tahun => (
                <SelectItem key={tahun.id} value={tahun.id}>
                  {tahun.nama}
                  {tahun.aktif
                    ? " (Aktif)"
                    : tahun.ditutup && openTagihanTahunIds.has(tahun.id)
                    ? " (Tunggakan lama)"
                    : ""}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      {selectedSiswa ? (
        <div className="space-y-4">
          <div className="rounded-xl border bg-card px-4 py-3 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-bold text-primary">
                {selectedSiswa.nama?.[0]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-base font-semibold">{selectedSiswa.nama}</h2>
                  {isSiswaNonaktif && (
                    <span className="rounded-full border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {formatStatusSiswa(selectedSiswa.status)}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  NIS: {selectedSiswa.nis ?? "-"} · Kelas {kelasNama} · {lembagaNama}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title="Tutup siswa"
                onClick={() => {
                  setSelectedSiswa(null);
                  setCartItems([]);
                  setTagihanPrintItems([]);
                  setShowTagihanPrint(false);
                  setField("jenisId", "");
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {isSiswaNonaktif && (
              <p className="mt-3 rounded-lg border bg-muted/30 p-2.5 text-xs text-muted-foreground">
                Siswa nonaktif hanya dapat membayar tunggakan lama yang masih terbuka.
              </p>
            )}
          </div>
          {legacyBreakdown.length > 0 && (
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Rincian dari Aplikasi Lama
              </h3>
              <div className="space-y-2">
                {legacyBreakdown.map((row, index) => (
                  <div
                    key={(row.kode_lama ?? "legacy") + "-" + row.nama_lama + "-" + index}
                    className="flex items-start justify-between gap-2 border-b pb-2 text-xs last:border-0"
                  >
                    <span className="min-w-0 font-medium">
                      {row.kode_lama ? row.kode_lama + " — " : ""}
                      {row.nama_lama}
                    </span>
                    <span className="shrink-0 font-semibold">{formatRupiah(row.nominal)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1 text-xs font-semibold">
                  <span>Total rincian legacy</span>
                  <span>{formatRupiah(legacyBreakdown[0]?.breakdown_total ?? 0)}</span>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-xl border bg-card shadow-sm">
            <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold">Tagihan Siswa</h2>
                <p className="text-xs text-muted-foreground">
                  Centang tagihan yang dibayar, lalu cek jumlah bayarnya.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
              {canBatal && !isSiswaNonaktif && (
                <Button variant="outline" size="sm" className="h-9" onClick={() => setShowTambahTagihan(true)}>
                  <Plus className="mr-2 h-4 w-4" />Tambah Tagihan
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                disabled={openBills.length === 0}
                title="Mencetak tagihan yang dicentang, atau semua tagihan jika belum ada yang dicentang"
                onClick={handlePrintTagihan}
              >
                <Printer className="mr-2 h-4 w-4" />
                Cetak Tagihan
              </Button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="w-12 px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label="Pilih semua tagihan"
                        checked={allVisibleBillsSelected}
                        onChange={event => handleToggleAllBillsPay(event.target.checked)}
                        className="h-4 w-4"
                      />
                    </th>
                    <th className="px-3 py-3 font-medium">Jenis</th>
                    <th className="px-3 py-3 font-medium">Periode</th>
                    <th className="px-3 py-3 text-right font-medium">Sisa Tagihan</th>
                    <th className="px-4 py-3 text-right font-medium">Jumlah Bayar</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loadOpenBills ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        Memuat tagihan...
                      </td>
                    </tr>
                  ) : openBills.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        Tidak ada tagihan terbuka pada tahun ajaran ini.
                      </td>
                    </tr>
                  ) : (
                    openBills.map(bill => {
                      const cartItem = cartItems.find(item => item.key === bill.id);
                      const partialOk = canPartialBill(bill);
                      const prerequisite =
                        !cartItem && bill.bulan
                          ? getKasirSequencePrerequisite(bill.id)
                          : null;
                      const sequenceLocked = !!prerequisite;
                      return (
                        <tr key={bill.id} className={cn("hover:bg-muted/20", cartItem && "bg-primary/5")}>
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              aria-label={"Pilih tagihan " + (bill.jenis_pembayaran?.nama ?? "")}
                              checked={!!cartItem}
                              disabled={isCartPaying || sequenceLocked}
                              onChange={event => handleToggleBillPay(bill, event.target.checked)}
                              className="h-4 w-4"
                            />
                          </td>
                          <td className="px-3 py-3 font-medium">{bill.jenis_pembayaran?.nama ?? "-"}</td>
                          <td className="px-3 py-3 text-muted-foreground">
                            {billPeriodLabel(bill)}
                            {bill.status === "sebagian" && (
                              <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                                Sebagian
                              </span>
                            )}
                            {sequenceLocked && prerequisite && (
                              <div className="mt-1 flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                                <Lock className="h-3 w-3" />
                                Selesaikan {bill.jenis_pembayaran?.nama ?? "tagihan"} {billingPeriodLabel(prerequisite)} terlebih dahulu
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <div className="font-medium">{formatRupiah(bill.sisa)}</div>
                            {bill.terbayar > 0 && (
                              <div className="text-[10px] text-muted-foreground">
                                dari {formatRupiah(bill.nominal)} · terbayar {formatRupiah(bill.terbayar)}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {!cartItem ? (
                              <span className="text-muted-foreground">—</span>
                            ) : partialOk ? (
                              <div className="flex items-center justify-end gap-2">
                                <div className="relative w-36">
                                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                    Rp
                                  </span>
                                  <Input
                                    inputMode="numeric"
                                    aria-label={"Jumlah bayar " + (bill.jenis_pembayaran?.nama ?? "")}
                                    className="h-9 pl-8 text-right font-medium"
                                    disabled={isCartPaying}
                                    value={cartItem.jumlah ? new Intl.NumberFormat("id-ID").format(cartItem.jumlah) : ""}
                                    onChange={event => handleCartAmountChange(bill.id, event.target.value)}
                                  />
                                </div>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-9"
                                  disabled={isCartPaying || cartItem.jumlah === bill.sisa}
                                  onClick={() => handleCartAmountChange(bill.id, String(bill.sisa))}
                                >
                                  Penuh
                                </Button>
                              </div>
                            ) : (
                              <div>
                                <span className="font-semibold">{formatRupiah(cartItem.jumlah)}</span>
                                <span className="ml-2 text-[10px] text-muted-foreground">bayar penuh</span>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {cartItems.length > 0 && (
            <div className="sticky bottom-0 z-20 rounded-xl border bg-card p-3 shadow-lg">
              <details className="mb-2 text-xs">
                <summary className="cursor-pointer select-none text-muted-foreground">Lihat rincian</summary>
                <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto">
                  {cartItems.map(item => (
                    <div
                      key={item.key}
                      className="flex items-center justify-between gap-2 rounded-lg border bg-background px-3 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{item.jenisNama}</p>
                        <p className="text-muted-foreground">
                          {item.bulan ? namaBulan(item.bulan) + " " + item.tahunLabel : "Sekali Bayar"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
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
              </details>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">{cartItems.length} tagihan dipilih</p>
                  <p className="text-xl font-bold">{formatRupiah(cartTotal)}</p>
                </div>
                <Button className="h-11 px-6" onClick={handlePayCart} disabled={isCartPaying || cartInvalid}>
                  {isCartPaying ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Memproses {cartProgress?.done ?? 0}/{cartProgress?.total ?? cartItems.length}
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Check className="h-4 w-4" />
                      Proses Pembayaran
                    </span>
                  )}
                </Button>
              </div>
              {cartInvalid && (
                <p className="mt-2 text-xs text-destructive">Isi jumlah bayar lebih dari 0 untuk semua tagihan yang dicentang.</p>
              )}
            </div>
          )}

          <details className="rounded-xl border bg-card shadow-sm">
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium">
              Pembayaran Lainnya
            </summary>
            <div className="border-t">
              <p className="px-4 pt-3 text-xs text-muted-foreground">Untuk pembayaran di muka atau tagihan yang belum terbit.</p>

              <div className="space-y-4 p-4">
                {isBayarDimuka && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                    Pembayaran di muka dicatat sebagai liabilitas dan diakui saat tahun ajaran target dimulai.
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Jenis Pembayaran</Label>
                    <SearchableSelect
                      value={form.jenisId}
                      onValueChange={(value) => {
                        setField("jenisId", value);
                        setField("jumlah", "");
                      }}
                      className="h-10"
                      placeholder="Pilih jenis pembayaran"
                      groupPaymentTypes
                      options={[
                        ...(jenisList?.map((jenis) => ({
                          value: jenis.id,
                          label: <>{jenis.nama}</>,
                        })) ?? []),
                      ]}
                    />

                    {loadingTarif && form.jenisId && (
                      <p className="text-[11px] text-muted-foreground">Mengambil tarif...</p>
                    )}
                    {!loadingTarif && tarifNominal != null && !adaTagihanDipilih && (
                      <p className="text-[11px] text-primary">Tarif: {formatRupiah(tarifNominal)}</p>
                    )}
                    {tarifTidakAda && (
                      <p className="text-[11px] font-medium text-destructive">Tarif belum dikonfigurasi.</p>
                    )}
                    {existingTagihan && adaTagihanDipilih && (
                      <p className="text-[11px] text-amber-700 dark:text-amber-300">
                        Sisa tagihan:{" "}
                        {formatRupiah(sisaTagihanDipilih)}
                        {existingTagihan.status === "sebagian" ? " · Dibayar sebagian" : ""}
                      </p>
                    )}
                    {cicilanSppDiizinkan && (
                      <div className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-2 text-[11px] text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
                        <p className="font-medium">SPP dapat dibayar sebagian.</p>
                        <p className="mt-0.5">
                          Sisa: {formatRupiah(sisaTagihanDipilih)}
                          {selectedOpenBill && selectedOpenBill.terbayar > 0
                            ? " · Sudah dibayar " + formatRupiah(selectedOpenBill.terbayar)
                            : ""}
                        </p>
                      </div>
                    )}
                    {currentAlreadyInCart && (
                      <p className="text-[11px] font-medium text-primary">Tagihan ini sudah ada di keranjang.</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Bulan / Periode</Label>
                    {!isSekali ? (
                      <Select value={String(form.bulan)} onValueChange={value => setField("bulan", Number(value))}>
                        <SelectTrigger className="h-10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {bulanTampil.map(month => {
                            const sudah = bulanLunas.has(month);
                            return (
                              <SelectItem key={month} value={String(month)} disabled={sudah}>
                                {namaBulan(month)}
                                {selectedTahunLabel ? " " + selectedTahunLabel : ""}
                                {sudah
                                  ? " ✓"
                                  : statusTagihanPerBulan?.get(month) === "terjadwal"
                                  ? " · Terjadwal"
                                  : ""}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input value="Sekali Bayar" readOnly className="h-10 bg-muted/40" />
                    )}
                    {!isSekali && form.jenisId && (
                      <p className="text-[11px] text-muted-foreground">
                        {sudahBayar} lunas · {belumBayar} jatuh tempo · {terjadwal} terjadwal
                      </p>
                    )}
                    {isKasir && !isSekali && directPaymentPrerequisite && (
                      <p className="flex items-start gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                        <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                        Selesaikan {selectedJenis?.nama ?? "tagihan"} {billingPeriodLabel(directPaymentPrerequisite)} terlebih dahulu.
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Jumlah Bayar (Rp)</Label>
                    <RupiahInput
                      value={form.jumlah}
                      onChange={value => setField("jumlah", value)}
                      readOnly={isJumlahLocked}
                      placeholder="0"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Tanggal Bayar</Label>
                    <Input
                      type="date"
                      value={form.tanggalBayar}
                      onChange={e => setField("tanggalBayar", e.target.value)}
                      readOnly={isKasir}
                      disabled={isKasir}
                      className={cn("h-10", isKasir && "cursor-not-allowed bg-muted/40")}
                    />
                    {isKasir && (
                      <p className="text-[11px] text-muted-foreground">
                        Tanggal kasir otomatis mengikuti hari ini.
                      </p>
                    )}
                  </div>
                </div>

                {isSekali && existingTagihan && adaTagihanDipilih && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                    <p className="font-medium">
                      Sisa tagihan: {formatRupiah(ringkasanTagihanSekali?.remaining ?? Number(existingTagihan.nominal))}
                    </p>
                    {ringkasanTagihanSekali && ringkasanTagihanSekali.paid > 0 && (
                      <p className="mt-0.5">Sudah dibayar: {formatRupiah(ringkasanTagihanSekali.paid)}</p>
                    )}
                    {cicilanSekaliDiizinkan && (
                      <p className="mt-1">Nominal cicilan bebas, maksimal sebesar sisa tagihan.</p>
                    )}
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs">Keterangan (opsional)</Label>
                  <Textarea
                    value={form.keterangan}
                    onChange={e => setField("keterangan", e.target.value)}
                    className="min-h-20 resize-none text-sm"
                    maxLength={200}
                    placeholder="Misal: bayar tunai, transfer BCA..."
                  />
                  <p className="text-right text-[10px] text-muted-foreground">{form.keterangan.length}/200</p>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    variant="outline"
                    className="h-10"
                    onClick={handleAddToCart}
                    disabled={
                      !form.jenisId ||
                      !form.jumlah ||
                      tarifTidakAda ||
                      isCartPaying ||
                      currentAlreadyInCart ||
                      (isSekali && !!pembayaranSekali?.lunas) ||
                      (!isSekali && bulanLunas.has(form.bulan)) ||
                      (isKasir && !isSekali && !!cartPaymentPrerequisite) ||
                      (isKasir && !isSekali && !existingTagihan?.id && !!directPaymentPrerequisite)
                    }
                  >
                    <ShoppingCart className="mr-2 h-4 w-4" />
                    Tambah ke Keranjang
                  </Button>
                  <Button
                    className="h-10"
                    onClick={handleSubmit}
                    disabled={
                      !form.jenisId ||
                      !form.jumlah ||
                      tarifTidakAda ||
                      prosesMutation.isPending ||
                      isCartPaying ||
                      currentAlreadyInCart ||
                      (isSekali && !!pembayaranSekali?.lunas) ||
                      (!isSekali && bulanLunas.has(form.bulan)) ||
                      (isKasir && !isSekali && !!directPaymentPrerequisite)
                    }
                  >
                    {prosesMutation.isPending ? (
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        Memproses...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <WalletCards className="h-4 w-4" />
                        Bayar Langsung
                      </span>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </details>

          <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              {canBatal ? (
                <>
                  <p className="font-medium">Pembatalan pembayaran hanya untuk koreksi salah input dan tidak dapat dilakukan pada periode yang sudah tutup buku.</p>
                  <p className="mt-0.5 opacity-80">Semua pembatalan dan perubahan terkait tercatat pada Audit Perubahan Data.</p>
                </>
              ) : (
                <p>Kasir tidak dapat membatalkan pembayaran. Laporkan koreksi kepada admin atau bagian keuangan.</p>
              )}
            </div>
          </div>

          <div id="riwayat-pembayaran" className="scroll-mt-20 rounded-xl border bg-card shadow-sm">
            <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <History className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="font-semibold">Riwayat Pembayaran</h2>
                  <p className="text-xs text-muted-foreground">Daftar pembayaran yang sudah dilakukan siswa.</p>
                </div>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={riwayatSearch}
                  onChange={event => setRiwayatSearch(event.target.value)}
                  placeholder="Cari riwayat..."
                  className="h-9 pl-9"
                />
              </div>
            </div>
            <div className="p-4">
              <DataTable
                columns={riwayatColumns}
                data={filteredRiwayat}
                isLoading={loadRiwayat}
                searchable={false}
                emptyMessage="Belum ada pembayaran"
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/10 px-4 text-center text-muted-foreground">
          <Search className="mb-3 h-10 w-10 opacity-20" />
          <p className="text-sm font-medium text-foreground">Cari siswa untuk memulai</p>
          <p className="mt-1 text-xs">Ketik minimal 2 karakter NIS, nama siswa, atau nama + kelas.</p>
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
              nomorBukti={lastCartPayment.receiptNumber}
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
              orientation={kuitansiOrientation}
            />
            <ReceiptOrientationSelect
              id="kuitansi-orientation-gabungan"
              value={kuitansiOrientation}
              onValueChange={setKuitansiOrientation}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCartKuitansi(false)}>Tutup</Button>
              <Button onClick={() => window.print()}>
                <Printer className="h-4 w-4 mr-1.5" />
                Cetak Kuitansi
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {showTambahTagihan && selectedSiswa && canBatal && !isSiswaNonaktif && (
        <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Membuka form tagihan...</p>}>
        <TambahTagihanDialog
          key={selectedSiswa.id}
          dialogOnly
          initialSiswa={{ id: selectedSiswa.id, nama: selectedSiswa.nama, nis: selectedSiswa.nis, departemen_id: siswaDepartemenId || null }}
          onClose={() => setShowTambahTagihan(false)}
        />
        </Suspense>
      )}

      {/* ── Cetak kuitansi dari riwayat ───────────────────────────────────────── */}
      {riwayatPrintTarget && selectedSiswa && (
        <Dialog open={!!riwayatPrintTarget} onOpenChange={(open) => !open && setRiwayatPrintTarget(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Kuitansi Pembayaran</DialogTitle>
            </DialogHeader>
            {riwayatPrintTarget.receiptGroup ? (
              <PrintKuitansiGabungan
                nomorBukti={riwayatPrintTarget.receiptGroup.receipt_number}
                items={riwayatPrintTarget.receiptGroup.items.map(item => ({
                  id: item.id,
                  jumlah: item.jumlah,
                  bulan: item.bulan ?? 0,
                  jenisNama: item.jenis_nama,
                  periodeLabel: item.periode_label || undefined,
                  status: item.status,
                }))}
                tanggalBayar={riwayatPrintTarget.receiptGroup.payment_date}
                siswa={{
                  nama: riwayatPrintTarget.receiptGroup.siswa.nama,
                  nis: riwayatPrintTarget.receiptGroup.siswa.nis || undefined,
                  nisn: riwayatPrintTarget.receiptGroup.siswa.nisn || undefined,
                }}
                kelasNama={kelasNama}
                lembagaNama={riwayatPrintTarget.receiptGroup.lembaga_nama || lembagaNama}
                petugasNama={riwayatPrintTarget.receiptGroup.petugas_nama || riwayatPrintTarget.petugas?.nama || undefined}
                metode={riwayatPrintTarget.receiptGroup.payment_method || "Tunai"}
                receiptStatus={riwayatPrintTarget.receiptGroup.status}
                orientation={kuitansiOrientation}
              />
            ) : (
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
                orientation={kuitansiOrientation}
              />
            )}
            <ReceiptOrientationSelect
              id="kuitansi-orientation-riwayat"
              value={kuitansiOrientation}
              onValueChange={setKuitansiOrientation}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setRiwayatPrintTarget(null)}>Tutup</Button>
              <Button onClick={() => window.print()}>
                <Printer className="h-4 w-4 mr-1.5" />Cetak Kuitansi
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Cetak tagihan terpilih (bisa gabungan jatuh tempo / belum jatuh tempo) ── */}
      {showTagihanPrint && tagihanPrintItems.length > 0 && selectedSiswa && (
        <Dialog open={showTagihanPrint} onOpenChange={setShowTagihanPrint}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Tagihan Siswa · {tagihanPrintItems.length} item</DialogTitle>
            </DialogHeader>
            <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
              <p><span className="font-medium">{tagihanPrintItems.length} tagihan</span> akan dicetak dalam satu dokumen.</p>
              <p>Total sisa: <span className="font-bold">{formatRupiah(tagihanPrintTotal)}</span></p>
            </div>
            <PrintTagihan
              tagihan={tagihanPrintItems}
              kelasNama={kelasNama}
              lembagaNama={lembagaNama}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowTagihanPrint(false)}>Tutup</Button>
              <Button onClick={() => window.print()}>
                <Printer className="h-4 w-4 mr-1.5" />
                Cetak {tagihanPrintItems.length} Tagihan
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
                nomorKuitansi: lastPayment.receiptNumber,
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
              orientation={kuitansiOrientation}
            />
            <ReceiptOrientationSelect
              id="kuitansi-orientation-baru"
              value={kuitansiOrientation}
              onValueChange={setKuitansiOrientation}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowKuitansi(false)}>Tutup</Button>
              <Button onClick={() => window.print()}>
                <Printer className="h-4 w-4 mr-1.5" />
                Cetak Kuitansi
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
