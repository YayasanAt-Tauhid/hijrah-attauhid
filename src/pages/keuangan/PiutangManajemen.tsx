import SppCategoryPeriod from "./SppCategoryPeriod";
import { recognitionDueDate, isMonthlySppRevenue } from "@/lib/recognitionDate";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { StatsCard } from "@/components/shared/StatsCard";
import { useLembaga, formatRupiah, BULAN_ORDER_AKADEMIK, namaBulan, namaBulanTahun } from "@/hooks/useKeuangan";
import { usePengaturanAkun, logAuditKeuangan } from "@/hooks/useJurnal";
import { useBatalkanTagihan, useBatalkanTagihanBatch } from "@/hooks/useTagihan";
import { jalankanAkrualJatuhTempo } from "@/server/akrual";
import { toast } from "sonner";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { Plus, Trash2, AlertTriangle, ShieldAlert, BookOpen, TrendingDown, CalendarClock, PlayCircle } from "lucide-react";

const now = new Date();
const currentYear = now.getFullYear();
const currentMonth = now.getMonth() + 1;

// ─── Hooks ──────────────────────────────────────────────────────────────────

function usePenyisihanList(tahun?: number, departemenId?: string) {
  return useQuery({
    queryKey: ["penyisihan_piutang", tahun, departemenId],
    queryFn: async () => {
      let q = supabase
        .from("penyisihan_piutang" as any)
        .select("*, departemen:departemen_id(kode, nama), jurnal:jurnal_id(nomor, status)")
        .order("tanggal", { ascending: false });
      if (tahun) {
        q = (q as any).gte("tanggal", `${tahun}-01-01`).lte("tanggal", `${tahun}-12-31`);
      }
      if (departemenId) q = (q as any).eq("departemen_id", departemenId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

function useWriteOffList(tahun?: number, departemenId?: string) {
  return useQuery({
    queryKey: ["write_off_piutang", tahun, departemenId],
    queryFn: async () => {
      let q = supabase
        .from("write_off_piutang" as any)
        .select(`
          *,
          siswa:siswa_id(nis, nama),
          departemen:departemen_id(kode, nama),
          jurnal:jurnal_id(nomor, status),
          tagihan:tagihan_id(nominal, bulan, jenis:jenis_id(nama))
        `)
        .order("tanggal", { ascending: false });
      if (tahun) {
        q = (q as any).gte("tanggal", `${tahun}-01-01`).lte("tanggal", `${tahun}-12-31`);
      }
      if (departemenId) q = (q as any).eq("departemen_id", departemenId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

// Tagihan belum lunas yang bisa di-write-off
function useTagihanBelumLunas(departemenId?: string) {
  return useQuery({
    queryKey: ["tagihan_belum_lunas_writeoff", departemenId],
    queryFn: async () => {
      let q = supabase
        .from("tagihan")
        .select(`
          id, nominal, bulan, status,
          siswa:siswa_id(id, nis, nama, departemen_id),
          jenis:jenis_id(nama),
          tahun_ajaran:tahun_ajaran_id(nama)
        `)
        .in("status", ["belum_bayar", "sebagian"])
        .is("write_off_id", null)
        .order("created_at", { ascending: true });
      if (departemenId) {
        // Filter lewat siswa.departemen_id tidak bisa langsung — ambil semua lalu filter client-side
      }
      const { data, error } = await q.limit(500);
      if (error) throw error;
      let rows = (data || []) as any[];
      if (departemenId) {
        rows = rows.filter((r: any) => r.siswa?.departemen_id === departemenId);
      }
      return rows;
    },
  });
}

// Tagihan yang sudah dibatalkan (untuk panel riwayat)
function useTagihanDibatalkanList(departemenId?: string) {
  return useQuery({
    queryKey: ["tagihan_dibatalkan", departemenId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tagihan")
        .select(`
          id, nominal, bulan, status, dibatalkan_alasan, dibatalkan_at,
          siswa:siswa_id(id, nis, nama, departemen_id),
          jenis:jenis_id(nama),
          tahun_ajaran:tahun_ajaran_id(nama),
          jurnal_pembalik:jurnal_pembalik_id(nomor)
        `)
        .eq("status", "dibatalkan")
        .order("dibatalkan_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      let rows = (data || []) as any[];
      if (departemenId) rows = rows.filter((r: any) => r.siswa?.departemen_id === departemenId);
      return rows;
    },
  });
}

interface TagihanTerjadwal {
  id: string;
  nominal: number;
  bulan: number | null;
  status: string;
  jatuh_tempo: string | null;
  tanggal_pengakuan: string | null;
  pembayaran: { jumlah: number }[];
  siswa: { id: string; nis: string | null; nama: string | null; departemen_id: string | null } | null;
  jenis: { nama: string | null; tipe: string } | null;
  tahun_ajaran: { nama: string | null; tanggal_mulai: string } | null;
}

// Tagihan yang sudah di-input tapi BELUM jatuh tempo — masih sekadar jadwal,
// belum menimbulkan jurnal apa pun. Yang jatuh temponya sudah lewat tapi masih
// berstatus 'terjadwal' berarti proses akrual belum dijalankan untuk baris itu.
function useTagihanTerjadwalList(departemenId?: string) {
  return useQuery({
    queryKey: ["tagihan_terjadwal", departemenId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tagihan")
        .select(`
          id, nominal, bulan, status, jatuh_tempo, tanggal_pengakuan,
          pembayaran:pembayaran!pembayaran_tagihan_id_fkey(jumlah),
          siswa:siswa_id(id, nis, nama, departemen_id),
          jenis:jenis_id(nama,tipe),
          tahun_ajaran:tahun_ajaran_id(nama,tanggal_mulai)
        `)
        .in("status", ["terjadwal", "belum_bayar", "sebagian", "lunas"])
        .is("jurnal_piutang_id", null)
        .eq("pengakuan_spp_selesai", false)
        .order("jatuh_tempo", { ascending: true })
        .limit(1000);
      if (error) throw error;
      let rows = ((data || []) as unknown as TagihanTerjadwal[])
        .filter((row) => row.status === "terjadwal" || isMonthlySppRevenue(row.jenis?.nama, row.jenis?.tipe))
        .map((row) => ({ ...row, nominal: Math.max(0, Number(row.nominal) -
          (row.pembayaran || []).reduce((sum, payment) => sum + Number(payment.jumlah), 0)) }));
      if (departemenId) rows = rows.filter((r) => r.siswa?.departemen_id === departemenId);
      return rows;
    },
  });
}

async function generateNomorJurnal(prefix: string, tahun: number) {
  const { data, error } = await supabase.rpc("generate_nomor_jurnal", { p_prefix: prefix, p_tahun: tahun });
  if (error) throw error;
  if (!data) throw new Error("Gagal mendapatkan nomor jurnal");
  return data as string;
}

function recognitionForScheduledBill(t: TagihanTerjadwal): string | null {
  return recognitionDueDate({
    billRecognitionDate: t.tanggal_pengakuan,
    billDueDate: t.jatuh_tempo,
    targetBookStart: t.tahun_ajaran?.tanggal_mulai,
    month: t.bulan,
    paymentName: t.jenis?.nama,
    paymentType: t.jenis?.tipe,
  });
}

// ─── Komponen Utama ─────────────────────────────────────────────────────────

export default function PiutangManajemen() {
  const qc = useQueryClient();
  const [tahun, setTahun] = useState(currentYear);
  const [departemenId, setDepartemenId] = useState("");
  const [activeTab, setActiveTab] = useState("penyisihan");

  // Penyisihan state
  const [penyisihanOpen, setPenyisihanOpen] = useState(false);
  const [deletePs, setDeletePs] = useState<string | null>(null);
  const [psMetode, setPsMetode] = useState<"persentase" | "individual" | "aging">("persentase");
  const [psTanggal, setPsTanggal] = useState(format(now, "yyyy-MM-dd"));
  const [psPersentase, setPsPersentase] = useState("");
  const [psNominal, setPsNominal] = useState("");
  const [psKeterangan, setPsKeterangan] = useState("");
  const [psFormDept, setPsFormDept] = useState("");

  // Write-off state
  const [writeOffOpen, setWriteOffOpen] = useState(false);
  const [woTagihanId, setWoTagihanId] = useState("");
  const [woTanggal, setWoTanggal] = useState(format(now, "yyyy-MM-dd"));
  const [woAlasan, setWoAlasan] = useState("");
  const [woFormDept, setWoFormDept] = useState("");
  const [woSearch, setWoSearch] = useState("");

  // Koreksi / Pembatalan tagihan state
  const [koreksiOpen, setKoreksiOpen] = useState(false);
  const [krMode, setKrMode] = useState<"batal" | "koreksi_nominal">("batal");
  const [krTagihanId, setKrTagihanId] = useState("");
  const [krSearch, setKrSearch] = useState("");
  const [krAlasan, setKrAlasan] = useState("");
  const [krNominalBaru, setKrNominalBaru] = useState("");
  const [krTanggal, setKrTanggal] = useState(format(now, "yyyy-MM-dd"));
  // Batalkan massal (hanya untuk mode "batal")
  const [krSelectedIds, setKrSelectedIds] = useState<Set<string>>(new Set());
  const [batalMassalOpen, setBatalMassalOpen] = useState(false);
  const [isBatalMassal, setIsBatalMassal] = useState(false);
  const [batalMassalProgress, setBatalMassalProgress] = useState<{ done: number; total: number } | null>(null);
  const [batalMassalGagal, setBatalMassalGagal] = useState<{ id: string; nama: string; error: string }[]>([]);

  const { data: lembagaList } = useLembaga();
  const { data: pengaturanAkun } = usePengaturanAkun();
  const { data: penyisihanList, isLoading: loadPs } = usePenyisihanList(tahun, departemenId || undefined);
  const { data: writeOffList, isLoading: loadWo } = useWriteOffList(tahun, departemenId || undefined);
  const { data: tagihanList } = useTagihanBelumLunas(woFormDept || departemenId || undefined);

  // Tagihan yang difilter untuk autocomplete write-off
  const tagihanFiltered = useMemo(() => {
    if (!tagihanList) return [];
    if (!woSearch.trim()) return tagihanList.slice(0, 50);
    const q = woSearch.toLowerCase();
    return tagihanList.filter((t: any) =>
      t.siswa?.nis?.toLowerCase().includes(q) ||
      t.siswa?.nama?.toLowerCase().includes(q) ||
      t.jenis?.nama?.toLowerCase().includes(q)
    ).slice(0, 50);
  }, [tagihanList, woSearch]);

  const selectedTagihan = tagihanList?.find((t: any) => t.id === woTagihanId);

  // ── Koreksi / Pembatalan tagihan ──
  const koreksiTagihan = useBatalkanTagihan();
  const batalMassalMutation = useBatalkanTagihanBatch();
  const { data: dibatalkanList, isLoading: loadDibatalkan } = useTagihanDibatalkanList(departemenId || undefined);

  // ── Akrual jatuh tempo ──
  const hariIni = format(now, "yyyy-MM-dd");
  const { data: terjadwalList, isLoading: loadTerjadwal } = useTagihanTerjadwalList(departemenId || undefined);
  const [konfirmAkrual, setKonfirmAkrual] = useState(false);

  // Tagihan yang jatuh temponya sudah lewat/tiba tapi statusnya masih
  // 'terjadwal' = piutangnya belum diakui; itulah yang akan diproses.
  const terjadwalJatuhTempo = useMemo(
    () => (terjadwalList || []).filter((t) => { const due = recognitionForScheduledBill(t); return due && due <= hariIni; }),
    [terjadwalList, hariIni]
  );
  const totalTerjadwal = useMemo(
    () => (terjadwalList || []).reduce((s, t) => s + Number(t.nominal || 0), 0),
    [terjadwalList]
  );
  const totalSiapDiakui = useMemo(
    () => terjadwalJatuhTempo.reduce((s, t) => s + Number(t.nominal || 0), 0),
    [terjadwalJatuhTempo]
  );

  const akrualMutation = useMutation({
    mutationFn: async () => jalankanAkrualJatuhTempo({ data: { sampai_tanggal: hariIni } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["tagihan_terjadwal"] });
      qc.invalidateQueries({ queryKey: ["tagihan"] });
      qc.invalidateQueries({ queryKey: ["jurnal"] });
      qc.invalidateQueries({ queryKey: ["pendapatan_dimuka"] });
      const bagian: string[] = [];
      if (res.piutang_diposting > 0)
        bagian.push(`${res.piutang_diposting} tagihan jadi piutang (${formatRupiah(res.piutang_nominal)})`);
      if (res.pendapatan_diakui > 0)
        bagian.push(`${res.pendapatan_diakui} pendapatan diterima di muka diakui (${formatRupiah(res.pendapatan_nominal)})`);
      toast.success(
        bagian.length > 0
          ? `Akrual selesai: ${bagian.join(", ")}`
          : "Tidak ada tagihan yang jatuh tempo hari ini — tidak ada jurnal yang dibuat"
      );
      if (res.errors?.length) toast.error(`${res.errors.length} baris gagal diproses: ${res.errors[0]}`);
    },
    onError: (e: any) => toast.error(e?.message || "Gagal menjalankan proses akrual"),
  });
  // Tagihan 'belum_bayar' + 'terjadwal' yang boleh dikoreksi/dibatalkan (bukan
  // sebagian/lunas). 'terjadwal' disertakan karena baris itu belum pernah
  // menimbulkan jurnal apa pun -- RPC batalkan_tagihan_atomik sudah menangani
  // ini otomatis lewat pengecekan jurnal_piutang_id IS NOT NULL, jadi tidak
  // ada jurnal pembalik yang dibuat untuk tagihan yang memang belum berjurnal.
  const tagihanBelumBayar = useMemo(
    () => [
      ...(tagihanList || []).filter((t: any) => t.status === "belum_bayar"),
      ...(terjadwalList || []).filter((t) => t.status === "terjadwal"),
    ],
    [tagihanList, terjadwalList]
  );
  const tagihanKrFiltered = useMemo(() => {
    if (!krSearch.trim()) return tagihanBelumBayar.slice(0, 50);
    const q = krSearch.toLowerCase();
    return tagihanBelumBayar.filter((t: any) =>
      t.siswa?.nis?.toLowerCase().includes(q) ||
      t.siswa?.nama?.toLowerCase().includes(q) ||
      t.jenis?.nama?.toLowerCase().includes(q)
    ).slice(0, 50);
  }, [tagihanBelumBayar, krSearch]);
  const selectedKrTagihan = tagihanBelumBayar.find((t: any) => t.id === krTagihanId);

  const resetKoreksi = () => {
    setKoreksiOpen(false); setKrTagihanId(""); setKrSearch("");
    setKrAlasan(""); setKrNominalBaru(""); setKrMode("batal");
    setKrSelectedIds(new Set());
  };
  const submitKoreksi = () => {
    if (!krTagihanId) { toast.error("Pilih tagihan dulu"); return; }
    if (!krAlasan.trim()) { toast.error("Alasan wajib diisi"); return; }
    koreksiTagihan.mutate(
      {
        mode: krMode,
        tagihan_id: krTagihanId,
        alasan: krAlasan,
        nominal_baru: krMode === "koreksi_nominal" ? Number(krNominalBaru) : undefined,
        tanggal: krTanggal,
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["tagihan_dibatalkan"] });
          resetKoreksi();
        },
      }
    );
  };

  // ── Batalkan Tagihan Massal ──
  const toggleKrSelect = (id: string) => {
    setKrSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const krSelectedRows = useMemo(
    () => tagihanBelumBayar.filter((t: any) => krSelectedIds.has(t.id)),
    [tagihanBelumBayar, krSelectedIds]
  );
  const krSelectedTotal = krSelectedRows.reduce((s: number, t: any) => s + Number(t.nominal || 0), 0);
  const allKrFilteredSelected = tagihanKrFiltered.length > 0 && tagihanKrFiltered.every((t: any) => krSelectedIds.has(t.id));
  const toggleSelectAllKrFiltered = () => {
    setKrSelectedIds((prev) => {
      const next = new Set(prev);
      if (allKrFilteredSelected) {
        tagihanKrFiltered.forEach((t: any) => next.delete(t.id));
      } else {
        tagihanKrFiltered.forEach((t: any) => next.add(t.id));
      }
      return next;
    });
  };

  const submitBatalMassal = async () => {
    if (!krAlasan.trim()) { toast.error("Alasan wajib diisi"); return; }
    const ids = Array.from(krSelectedIds);
    if (ids.length === 0) return;

    setIsBatalMassal(true);
    setBatalMassalGagal([]);
    setBatalMassalProgress({ done: 0, total: ids.length });

    try {
      // Satu panggilan ke server function batalkanTagihanBatch — loop RPC
      // atomik dijalankan di server (Cloudflare Worker), bukan di browser.
      // Ini menghindari risiko state tidak konsisten jika koneksi klien
      // terputus di tengah proses: tiap tagihan tetap all-or-nothing di
      // level database, dan seluruh batch selesai diproses di server
      // terlepas dari apakah koneksi pengguna masih terbuka atau tidak.
      const res = await batalMassalMutation.mutateAsync({
        tagihan_ids: ids,
        alasan: krAlasan,
        tanggal: krTanggal,
      });

      setBatalMassalProgress({ done: ids.length, total: ids.length });

      const gagalDenganNama = res.gagal.map((g) => {
        const row = tagihanBelumBayar.find((t: any) => t.id === g.tagihan_id);
        const label = row
          ? `${row.siswa?.nis ?? "-"} — ${row.siswa?.nama ?? "-"} (${row.jenis?.nama ?? ""}${row.bulan ? ` ${namaBulanTahun(row.bulan, { tahunBukuNama: row.tahun_ajaran?.nama })}` : ""})`
          : g.tagihan_id;
        return { id: g.tagihan_id, nama: label, error: g.error };
      });
      setBatalMassalGagal(gagalDenganNama);

      if (gagalDenganNama.length === 0) {
        setBatalMassalOpen(false);
        resetKoreksi();
      } else {
        // Sisakan hanya yang gagal di seleksi, supaya bisa dicoba ulang / ditinjau
        setKrSelectedIds(new Set(gagalDenganNama.map((g) => g.id)));
      }
    } catch (e: any) {
      toast.error(e?.message || "Gagal memproses pembatalan massal");
    } finally {
      setIsBatalMassal(false);
    }
  };

  // Stats
  const totalPenyisihan = (penyisihanList || []).reduce((s: number, r: any) => s + Number(r.nominal || 0), 0);
  const totalWriteOff = (writeOffList || []).reduce((s: number, r: any) => s + Number(r.nominal || 0), 0);
  const jumlahWriteOff = (writeOffList || []).length;

  // ─── Mutation: Buat Penyisihan ───────────────────────────────────────────
  const createPenyisihan = useMutation({
    mutationFn: async () => {
      const akunBeban = pengaturanAkun?.find((p: any) => p.kode_setting === "beban_piutang_macet")?.akun?.id;
      const akunPenyisihan = pengaturanAkun?.find((p: any) => p.kode_setting === "penyisihan_piutang")?.akun?.id;
      const nominal = Number(psNominal);
      if (!nominal || nominal <= 0) throw new Error("Nominal harus lebih dari 0");

      let jurnalId: string | null = null;
      if (akunBeban && akunPenyisihan) {
        const tahunPs = new Date(psTanggal).getFullYear();
        const nomor = await generateNomorJurnal("PS", tahunPs);
        const ket = psKeterangan || `Penyisihan piutang tak tertagih ${psMetode}`;
        const { data: jrn, error: jErr } = await supabase.from("jurnal").insert({
          nomor, tanggal: psTanggal,
          keterangan: ket,
          departemen_id: psFormDept || null,
          total_debit: nominal, total_kredit: nominal,
          status: "posted",
        }).select().single();
        if (jErr) throw jErr;
        await supabase.from("jurnal_detail").insert([
          { jurnal_id: (jrn as any).id, akun_id: akunBeban,      debit: nominal, kredit: 0,       keterangan: "Beban kerugian piutang",      urutan: 1 },
          { jurnal_id: (jrn as any).id, akun_id: akunPenyisihan, debit: 0,       kredit: nominal, keterangan: "Penyisihan piutang tak tertagih", urutan: 2 },
        ]);
        jurnalId = (jrn as any).id;
      }

      const { data, error } = await (supabase.from("penyisihan_piutang" as any).insert({
        tanggal: psTanggal, metode: psMetode,
        persentase: psMetode === "persentase" ? Number(psPersentase) : null,
        nominal, keterangan: psKeterangan || null,
        departemen_id: psFormDept || null,
        jurnal_id: jurnalId,
      }) as any).select().single();
      if (error) throw error;

      await logAuditKeuangan({ tabel_sumber: "penyisihan_piutang", record_id: (data as any).id,
        aksi: "CREATE", data_baru: { nominal, metode: psMetode },
        keterangan: `Penyisihan piutang ${formatRupiah(nominal)}`, departemen_id: psFormDept || undefined });

      if (!akunBeban || !akunPenyisihan) {
        toast.warning("Penyisihan tersimpan, tapi jurnal tidak dibuat — konfigurasikan akun di Referensi Keuangan.");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["penyisihan_piutang"] });
      qc.invalidateQueries({ queryKey: ["jurnal"] });
      toast.success("Penyisihan piutang berhasil dicatat");
      setPenyisihanOpen(false);
      setPsNominal(""); setPsPersentase(""); setPsKeterangan("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ─── Mutation: Hapus Penyisihan ──────────────────────────────────────────
  const deletePenyisihan = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from("penyisihan_piutang" as any).delete().eq("id", id) as any);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["penyisihan_piutang"] }); toast.success("Penyisihan dihapus"); },
    onError: (e: any) => toast.error(e.message),
  });

  // ─── Mutation: Write-Off Piutang ─────────────────────────────────────────
  const createWriteOff = useMutation({
    mutationFn: async () => {
      if (!woTagihanId) throw new Error("Pilih tagihan yang akan dihapusbukukan");
      if (!woAlasan.trim()) throw new Error("Alasan wajib diisi");
      const tagihan = tagihanList?.find((t: any) => t.id === woTagihanId);
      if (!tagihan) throw new Error("Tagihan tidak ditemukan");
      const nominal = Number(tagihan.nominal);

      const akunBeban = pengaturanAkun?.find((p: any) => p.kode_setting === "beban_piutang_macet")?.akun?.id;
      const akunPiutang = pengaturanAkun?.find((p: any) => p.kode_setting === "piutang_siswa")?.akun?.id;
      const akunPenyisihan = pengaturanAkun?.find((p: any) => p.kode_setting === "penyisihan_piutang")?.akun?.id;

      let jurnalId: string | null = null;
      if (akunPiutang) {
        const tahunWo = new Date(woTanggal).getFullYear();
        const nomor = await generateNomorJurnal("WO", tahunWo);
        const keterangan = `Write-off piutang: ${tagihan.siswa?.nama || ""} — ${tagihan.jenis?.nama || ""}`;

        // Jika ada akun penyisihan, gunakan itu (hapus buku lewat penyisihan)
        // Jika tidak, langsung ke beban kerugian
        const akunLawan = akunPenyisihan || akunBeban;
        if (!akunLawan) throw new Error("Akun penyisihan / beban kerugian piutang belum dikonfigurasi di Referensi Keuangan");

        const { data: jrn, error: jErr } = await supabase.from("jurnal").insert({
          nomor, tanggal: woTanggal, keterangan,
          departemen_id: tagihan.siswa?.departemen_id || null,
          total_debit: nominal, total_kredit: nominal,
          status: "posted",
        }).select().single();
        if (jErr) throw jErr;

        await supabase.from("jurnal_detail").insert([
          { jurnal_id: (jrn as any).id, akun_id: akunLawan,  debit: nominal, kredit: 0,       keterangan: akunPenyisihan ? "Penyisihan piutang digunakan" : "Beban kerugian piutang", urutan: 1 },
          { jurnal_id: (jrn as any).id, akun_id: akunPiutang, debit: 0,       kredit: nominal, keterangan: "Hapus buku piutang siswa", urutan: 2 },
        ]);
        jurnalId = (jrn as any).id;
      }

      // Insert write_off_piutang
      const { data: wo, error: woErr } = await (supabase.from("write_off_piutang" as any).insert({
        tagihan_id: woTagihanId,
        siswa_id: tagihan.siswa_id || tagihan.siswa?.id,
        departemen_id: tagihan.siswa?.departemen_id || null,
        tanggal: woTanggal,
        nominal,
        alasan: woAlasan,
        jurnal_id: jurnalId,
      }) as any).select().single();
      if (woErr) throw woErr;

      // Update tagihan: status → dihapusbuku, write_off_id
      await supabase.from("tagihan")
        .update({ status: "dihapusbuku", write_off_id: (wo as any).id })
        .eq("id", woTagihanId);

      await logAuditKeuangan({ tabel_sumber: "write_off_piutang", record_id: (wo as any).id,
        aksi: "CREATE", data_baru: { tagihan_id: woTagihanId, nominal, alasan: woAlasan },
        keterangan: `Write-off piutang ${tagihan.siswa?.nama} ${formatRupiah(nominal)}` });

      if (!akunPiutang) {
        toast.warning("Write-off tersimpan, tapi jurnal tidak dibuat — konfigurasikan akun piutang siswa di Referensi Keuangan.");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["write_off_piutang"] });
      qc.invalidateQueries({ queryKey: ["tagihan_belum_lunas_writeoff"] });
      qc.invalidateQueries({ queryKey: ["jurnal"] });
      qc.invalidateQueries({ queryKey: ["tunggakan"] });
      toast.success("Piutang berhasil dihapusbukukan");
      setWriteOffOpen(false);
      setWoTagihanId(""); setWoAlasan(""); setWoSearch("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ─── Kolom Tabel Penyisihan ───────────────────────────────────────────────
  const colsPenyisihan: DataTableColumn<any>[] = [
    { key: "tanggal", label: "Tanggal", sortable: true,
      render: (v) => v ? format(new Date(v as string), "d MMM yyyy", { locale: idLocale }) : "-" },
    { key: "metode", label: "Metode",
      render: (v) => {
        const map: Record<string, string> = { persentase: "Persentase", individual: "Individual", aging: "Aging" };
        return <Badge variant="outline">{map[v as string] || (v as string)}</Badge>;
      }},
    { key: "persentase", label: "%", render: (v) => v ? `${v}%` : "-" },
    { key: "nominal", label: "Nominal", render: (v) => formatRupiah(Number(v)) },
    { key: "departemen", label: "Lembaga", render: (_, r) => (r as any).departemen?.kode || "-" },
    { key: "keterangan", label: "Keterangan", render: (v) => (v as string) || "-" },
    { key: "jurnal", label: "Jurnal",
      render: (_, r) => {
        const j = (r as any).jurnal;
        return j?.nomor
          ? <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300">{j.nomor}</Badge>
          : <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">Belum dijurnal</Badge>;
      }},
    { key: "aksi", label: "Aksi",
      render: (_, r) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeletePs((r as any).id)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )},
  ];

  // ─── Kolom Tabel Write-Off ─────────────────────────────────────────────────
  const colsWriteOff: DataTableColumn<any>[] = [
    { key: "tanggal", label: "Tanggal", sortable: true,
      render: (v) => v ? format(new Date(v as string), "d MMM yyyy", { locale: idLocale }) : "-" },
    { key: "siswa", label: "Siswa",
      render: (_, r) => {
        const s = (r as any).siswa;
        return s ? <span>{s.nis} — {s.nama}</span> : "-";
      }},
    { key: "tagihan", label: "Tagihan",
      render: (_, r) => {
        const t = (r as any).tagihan;
        if (!t) return "-";
        const bln = t.bulan ? namaBulanTahun(t.bulan, { tanggalTransaksi: (r as any).tanggal }) : "";
        return <span className="text-xs">{t.jenis?.nama || "-"}{bln ? ` (${bln})` : ""}</span>;
      }},
    { key: "nominal", label: "Nominal", render: (v) => formatRupiah(Number(v)) },
    { key: "departemen", label: "Lembaga", render: (_, r) => (r as any).departemen?.kode || "-" },
    { key: "alasan", label: "Alasan", render: (v) => (v as string) || "-" },
    { key: "jurnal", label: "Jurnal",
      render: (_, r) => {
        const j = (r as any).jurnal;
        return j?.nomor
          ? <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300">{j.nomor}</Badge>
          : <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">Belum dijurnal</Badge>;
      }},
  ];

  // ─── Kolom Tabel Tagihan Dibatalkan ───────────────────────────────────────
  const colsDibatalkan: DataTableColumn<any>[] = [
    { key: "dibatalkan_at", label: "Dibatalkan", sortable: true,
      render: (v) => v ? format(new Date(v as string), "d MMM yyyy HH:mm", { locale: idLocale }) : "-" },
    { key: "siswa", label: "Siswa", render: (_, r) => `${(r as any).siswa?.nis || "-"} — ${(r as any).siswa?.nama || "-"}` },
    { key: "jenis", label: "Jenis", render: (_, r) => {
        const bln = (r as any).bulan ? namaBulanTahun((r as any).bulan, { tahunBukuNama: (r as any).tahun_ajaran?.nama }) : "";
        return <span className="text-xs">{(r as any).jenis?.nama || "-"}{bln ? ` (${bln})` : ""}</span>;
      }},
    { key: "nominal", label: "Nominal", render: (v) => formatRupiah(Number(v)) },
    { key: "dibatalkan_alasan", label: "Alasan", render: (v) => (v as string) || "-" },
    { key: "jurnal_pembalik", label: "Jurnal Pembalik",
      render: (_, r) => {
        const j = (r as any).jurnal_pembalik;
        return j?.nomor
          ? <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300">{j.nomor}</Badge>
          : <Badge variant="outline" className="bg-muted text-muted-foreground">Tanpa jurnal</Badge>;
      }},
  ];

  const colsTerjadwal: DataTableColumn<TagihanTerjadwal>[] = [
    { key: "jatuh_tempo", label: "Jatuh Tempo", sortable: true,
      render: (v) => {
        if (!v) return <span className="text-muted-foreground">-</span>;
        const tgl = v as string;
        const lewat = tgl <= hariIni;
        return (
          <span className={lewat ? "text-warning font-medium" : ""}>
            {format(new Date(tgl), "d MMM yyyy", { locale: idLocale })}
          </span>
        );
      }},
    { key: "tanggal_pengakuan", label: "Tanggal Pengakuan",
      render: (_, r) => {
        const due = recognitionForScheduledBill(r);
        return due ? format(new Date(due + "T00:00:00"), "d MMM yyyy", { locale: idLocale }) : "-";
      }},
    { key: "siswa", label: "Siswa", render: (_, r) => `${r.siswa?.nis || "-"} — ${r.siswa?.nama || "-"}` },
    { key: "jenis", label: "Jenis", render: (_, r) => {
        const bln = r.bulan ? namaBulanTahun(r.bulan, { tahunBukuNama: r.tahun_ajaran?.nama }) : "";
        return <span className="text-xs">{r.jenis?.nama || "-"}{bln ? ` (${bln})` : ""}</span>;
      }},
    { key: "nominal", label: "Nominal", render: (v) => formatRupiah(Number(v)) },
    { key: "status", label: "Keterangan",
      render: (_, r) => (
        recognitionForScheduledBill(r) && recognitionForScheduledBill(r)! <= hariIni
          ? <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30">Siap diakui jadi piutang</Badge>
          : <Badge variant="outline" className="bg-muted text-muted-foreground">Menunggu tanggal pengakuan</Badge>
      )},
  ];

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Manajemen Piutang</h1>
          <p className="text-xs text-muted-foreground">Penyisihan piutang tak tertagih &amp; write-off piutang siswa</p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-3 items-end flex-wrap">
        <div>
          <Label className="text-xs">Lembaga</Label>
          <Select value={departemenId || "__all__"} onValueChange={(v) => setDepartemenId(v === "__all__" ? "" : v)}>
            <SelectTrigger className="h-8 text-xs w-44"><SelectValue placeholder="Semua lembaga" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Semua Lembaga</SelectItem>
              {lembagaList?.map((l: any) => <SelectItem key={l.id} value={l.id}>{l.kode} — {l.nama}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Tahun</Label>
          <Input type="number" className="h-8 text-xs w-24" value={tahun} onChange={(e) => setTahun(Number(e.target.value))} />
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatsCard title="Total Penyisihan" value={formatRupiah(totalPenyisihan)} icon={ShieldAlert} color="warning" />
        <StatsCard title="Total Write-Off" value={formatRupiah(totalWriteOff)} icon={TrendingDown} color="destructive" />
        <StatsCard title="Transaksi Write-Off" value={jumlahWriteOff} icon={BookOpen} color="info" />
      </div>

      {/* Peringatan akun belum dikonfigurasi */}
      {!pengaturanAkun?.find((p: any) => p.kode_setting === "penyisihan_piutang")?.akun?.id && (
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>
            Akun <strong>Penyisihan Piutang</strong> dan <strong>Beban Kerugian Piutang</strong> belum dikonfigurasi.
            Jurnal otomatis tidak akan dibuat. Silakan atur di <strong>Referensi Keuangan → Pengaturan Akun</strong>.
          </span>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-auto flex flex-wrap justify-start">
          <TabsTrigger value="akrual">Akrual Pendapatan</TabsTrigger>
          <TabsTrigger value="penyisihan">Penyisihan Piutang</TabsTrigger>
          <TabsTrigger value="writeoff">Write-Off Piutang</TabsTrigger>
          <TabsTrigger value="koreksi">Koreksi / Pembatalan Tagihan</TabsTrigger>
          <TabsTrigger value="kategori_spp">Kategori SPP per Bulan</TabsTrigger>
        </TabsList>

        {/* ── Tab Akrual Pendapatan ── */}
        <TabsContent value="akrual" className="space-y-3 mt-3">
          <div className="rounded-md border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">
              SPP dibukukan pada akhir bulan layanan; jatuh tempo pembayaran tetap tanggal yang ditetapkan.
            </p>
            <p>
              • <strong>Belum mencapai tanggal pengakuan</strong> — tagihan hanya berupa jadwal (status{" "}
              <em>terjadwal</em>): <strong>tidak ada jurnal sama sekali</strong>, tidak muncul di neraca
              maupun laporan pendapatan. Kalau orang tua membayarnya lebih awal, uangnya dicatat sebagai{" "}
              <strong>Pendapatan Diterima di Muka</strong> (liabilitas), bukan pendapatan.
            </p>
            <p>
              • <strong>Saat tanggal pengakuan tiba</strong> — proses ini memposting{" "}
              <strong>(D) Piutang Siswa / (K) Pendapatan</strong> dan mengubah status jadi{" "}
              <em>belum bayar</em>. Untuk yang sudah dibayar di muka, yang diposting{" "}
              <strong>(D) Pendapatan Diterima di Muka / (K) Pendapatan</strong>.
            </p>
            <p>
              • <strong>Lewat jatuh tempo tanpa bayar</strong> = <strong>tunggakan</strong>. Tidak ada
              setelah pengakuan, akunnya tetap Piutang Siswa. Sebelum akhir bulan, SPP dapat terlambat bayar meski belum dibukukan sebagai piutang.
            </p>
            <p>Proses ini aman dijalankan berulang kali; baris yang sudah diproses tidak diproses lagi.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <StatsCard title="Sisa tagihan menunggu pengakuan" value={formatRupiah(totalTerjadwal)}
              icon={CalendarClock} color="info" />
            <StatsCard title="Siap diakui jadi piutang hari ini" value={formatRupiah(totalSiapDiakui)}
              icon={AlertTriangle} color="warning" />
          </div>

          <div className="flex justify-end">
            <Button size="sm" className="h-8 text-xs"
              disabled={akrualMutation.isPending}
              onClick={() => setKonfirmAkrual(true)}>
              <PlayCircle className="h-3.5 w-3.5 mr-1.5" />
              {akrualMutation.isPending ? "Memproses…" : "Jalankan Akrual Pendapatan"}
            </Button>
          </div>

          <DataTable columns={colsTerjadwal} data={terjadwalList || []} loading={loadTerjadwal}
            pageSize={20} exportable exportFilename={`tagihan-terjadwal-${hariIni}`} />
        </TabsContent>

        {/* ── Tab Penyisihan ── */}
        <TabsContent value="penyisihan" className="space-y-3 mt-3">
          <div className="flex justify-end">
            <Button size="sm" className="h-8 text-xs" onClick={() => { setPsFormDept(departemenId || ""); setPenyisihanOpen(true); }}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />Catat Penyisihan
            </Button>
          </div>
          <DataTable columns={colsPenyisihan} data={penyisihanList || []} loading={loadPs}
            pageSize={20} exportable exportFilename={`penyisihan-piutang-${tahun}`} />
        </TabsContent>

        {/* ── Tab Write-Off ── */}
        <TabsContent value="writeoff" className="space-y-3 mt-3">
          <div className="flex justify-end">
            <Button size="sm" className="h-8 text-xs" variant="destructive"
              onClick={() => { setWoFormDept(departemenId || ""); setWriteOffOpen(true); }}>
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />Hapusbuku Piutang
            </Button>
          </div>
          <DataTable columns={colsWriteOff} data={writeOffList || []} loading={loadWo}
            pageSize={20} exportable exportFilename={`writeoff-piutang-${tahun}`} />
        </TabsContent>

        {/* ── Tab Koreksi / Pembatalan Tagihan ── */}
        <TabsContent value="koreksi" className="space-y-3 mt-3">
          <div className="rounded-md border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Panduan: perbaiki kesalahan input tagihan yang BELUM dibayar.</p>
            <p>• <strong>Batalkan tagihan</strong> — jika tagihan tidak seharusnya ada (salah siswa, dobel, salah jenis).</p>
            <p>• <strong>Koreksi nominal</strong> — jika tagihan benar tapi angkanya salah; isi nominal yang benar.</p>
            <p>Keduanya otomatis membuat <strong>jurnal pembalik (posted)</strong> — kecuali untuk tagihan status <em>terjadwal</em> (lihat tab <strong>Akrual Pendapatan</strong>), yang belum pernah berjurnal sama sekali sehingga langsung diproses tanpa jurnal. Wajib isi alasan; tercatat di <strong>Audit Perubahan Data</strong>.</p>
            <p>Tagihan yang <strong>sudah dibayar</strong> tidak muncul di sini — perbaiki lewat <strong>Input Pembayaran → tabel Riwayat → Batalkan</strong>.</p>
          </div>
          <div className="flex justify-end">
            <Button size="sm" className="h-8 text-xs" variant="outline"
              onClick={() => setKoreksiOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />Koreksi / Batalkan Tagihan
            </Button>
          </div>
          <DataTable columns={colsDibatalkan} data={dibatalkanList || []} loading={loadDibatalkan}
            pageSize={20} exportable exportFilename={`tagihan-dibatalkan-${tahun}`} />
        </TabsContent>
        <TabsContent value="kategori_spp" className="mt-3">
          <SppCategoryPeriod departemenId={departemenId || undefined} />
        </TabsContent>
      </Tabs>

      {/* Dialog Penyisihan */}
      <Dialog open={penyisihanOpen} onOpenChange={setPenyisihanOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-warning" />
              Catat Penyisihan Piutang Tak Tertagih
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tanggal *</Label>
                <Input type="date" value={psTanggal} onChange={(e) => setPsTanggal(e.target.value)} />
              </div>
              <div>
                <Label>Lembaga</Label>
                <Select value={psFormDept || "__all__"} onValueChange={(v) => setPsFormDept(v === "__all__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Semua" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Semua Lembaga</SelectItem>
                    {lembagaList?.map((l: any) => <SelectItem key={l.id} value={l.id}>{l.kode} — {l.nama}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Metode Perhitungan *</Label>
              <Select value={psMetode} onValueChange={(v) => setPsMetode(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="persentase">Persentase dari total piutang</SelectItem>
                  <SelectItem value="individual">Individual (per siswa)</SelectItem>
                  <SelectItem value="aging">Aging schedule (umur piutang)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {psMetode === "persentase" && (
              <div>
                <Label>Persentase (%)</Label>
                <Input type="number" step="0.01" placeholder="mis. 5" value={psPersentase}
                  onChange={(e) => setPsPersentase(e.target.value)} />
              </div>
            )}
            <div>
              <Label>Nominal Penyisihan (Rp) *</Label>
              <Input type="number" placeholder="0" value={psNominal}
                onChange={(e) => setPsNominal(e.target.value)} />
              {psNominal && <p className="text-xs text-muted-foreground mt-1">{formatRupiah(Number(psNominal))}</p>}
            </div>
            <div>
              <Label>Keterangan</Label>
              <Textarea rows={2} placeholder="Dasar pertimbangan penyisihan..." value={psKeterangan}
                onChange={(e) => setPsKeterangan(e.target.value)} />
            </div>
            <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Jurnal yang akan dibuat (otomatis, status: Posted):</p>
              <p>Dr. Beban Kerugian Piutang &nbsp;&nbsp;&nbsp;Rp {formatRupiah(Number(psNominal) || 0)}</p>
              <p>Cr. Penyisihan Piutang Tak Tertagih &nbsp;Rp {formatRupiah(Number(psNominal) || 0)}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPenyisihanOpen(false)}>Batal</Button>
            <Button onClick={() => createPenyisihan.mutate()} disabled={!psNominal || createPenyisihan.isPending}>
              {createPenyisihan.isPending ? "Menyimpan..." : "Simpan & Buat Jurnal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Write-Off */}
      <Dialog open={writeOffOpen} onOpenChange={setWriteOffOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              Hapusbuku Piutang Siswa (Write-Off)
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border border-destructive/20 bg-destructive/5 p-2 text-xs text-destructive">
              ⚠ Tindakan ini <strong>tidak dapat dibatalkan</strong>. Piutang akan ditandai "dihapusbuku" dan jurnal pembalik akan dibuat.
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tanggal Write-Off *</Label>
                <Input type="date" value={woTanggal} onChange={(e) => setWoTanggal(e.target.value)} />
              </div>
              <div>
                <Label>Filter Lembaga</Label>
                <Select value={woFormDept || "__all__"} onValueChange={(v) => setWoFormDept(v === "__all__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Semua" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Semua Lembaga</SelectItem>
                    {lembagaList?.map((l: any) => <SelectItem key={l.id} value={l.id}>{l.kode} — {l.nama}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Cari & Pilih Tagihan *</Label>
              <Input placeholder="Ketik NIS atau nama siswa..." value={woSearch}
                onChange={(e) => { setWoSearch(e.target.value); setWoTagihanId(""); }}
                className="mb-1" />
              <div className="border rounded-md max-h-40 overflow-y-auto text-xs">
                {tagihanFiltered.length === 0
                  ? <p className="p-2 text-muted-foreground">Tidak ada tagihan belum lunas</p>
                  : tagihanFiltered.map((t: any) => (
                    <button key={t.id}
                      className={`w-full text-left px-3 py-2 border-b last:border-0 hover:bg-muted/60 transition-colors ${woTagihanId === t.id ? "bg-primary/10 font-semibold" : ""}`}
                      onClick={() => { setWoTagihanId(t.id); setWoSearch(`${t.siswa?.nis} — ${t.siswa?.nama}`); }}>
                      <span className="font-medium">{t.siswa?.nis} — {t.siswa?.nama}</span>
                      <span className="text-muted-foreground ml-2">{t.jenis?.nama}{t.bulan ? ` (${namaBulanTahun(t.bulan, { tahunBukuNama: t.tahun_ajaran?.nama })})` : ""}</span>
                      <span className="float-right font-semibold text-destructive">{formatRupiah(Number(t.nominal))}</span>
                    </button>
                  ))
                }
              </div>
            </div>

            {selectedTagihan && (
              <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1">
                <p className="font-semibold">Detail Tagihan Dipilih:</p>
                <p>Siswa: <span className="font-medium">{selectedTagihan.siswa?.nama}</span></p>
                <p>Jenis: <span className="font-medium">{selectedTagihan.jenis?.nama}</span></p>
                <p>Nominal: <span className="font-semibold text-destructive">{formatRupiah(Number(selectedTagihan.nominal))}</span></p>
                <p>Tahun Ajaran: <span className="font-medium">{selectedTagihan.tahun_ajaran?.nama}</span></p>
                <div className="border-t pt-1 mt-1">
                  <p className="font-medium text-foreground">Jurnal yang akan dibuat:</p>
                  <p>Dr. Penyisihan Piutang / Beban Kerugian &nbsp;{formatRupiah(Number(selectedTagihan.nominal))}</p>
                  <p>Cr. Piutang Siswa &nbsp;{formatRupiah(Number(selectedTagihan.nominal))}</p>
                </div>
              </div>
            )}

            <div>
              <Label>Alasan Write-Off *</Label>
              <Textarea rows={2} placeholder="mis. Siswa pindah sekolah, tidak bisa dihubungi..." value={woAlasan}
                onChange={(e) => setWoAlasan(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setWriteOffOpen(false); setWoTagihanId(""); setWoSearch(""); setWoAlasan(""); }}>
              Batal
            </Button>
            <Button variant="destructive" onClick={() => createWriteOff.mutate()}
              disabled={!woTagihanId || !woAlasan.trim() || createWriteOff.isPending}>
              {createWriteOff.isPending ? "Memproses..." : "Hapusbuku & Buat Jurnal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Koreksi / Pembatalan Tagihan */}
      <Dialog open={koreksiOpen} onOpenChange={(o) => { if (!o) resetKoreksi(); else setKoreksiOpen(true); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-info" />
              Koreksi / Pembatalan Tagihan (Belum Dibayar)
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Tindakan *</Label>
              <Select value={krMode} onValueChange={(v) => setKrMode(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="batal">Batalkan tagihan (tidak seharusnya ada)</SelectItem>
                  <SelectItem value="koreksi_nominal">Koreksi nominal (angka salah)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Tanggal Koreksi *</Label>
              <Input type="date" value={krTanggal} onChange={(e) => setKrTanggal(e.target.value)} />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label>Cari & Pilih Tagihan *</Label>
                {krMode === "batal" && tagihanKrFiltered.length > 0 && (
                  <button type="button" className="text-xs text-primary hover:underline"
                    onClick={toggleSelectAllKrFiltered}>
                    {allKrFilteredSelected ? "Batalkan pilih semua" : "Pilih semua hasil"}
                  </button>
                )}
              </div>
              <Input placeholder="Ketik NIS atau nama siswa..." value={krSearch}
                onChange={(e) => { setKrSearch(e.target.value); setKrTagihanId(""); }}
                className="mb-1" />
              {krMode === "batal" && (
                <p className="text-xs text-muted-foreground mb-1">
                  Centang untuk pilih beberapa tagihan sekaligus, atau klik baris untuk pilih satu.
                </p>
              )}
              <div className="border rounded-md max-h-40 overflow-y-auto text-xs">
                {tagihanKrFiltered.length === 0
                  ? <p className="p-2 text-muted-foreground">Tidak ada tagihan belum dibayar</p>
                  : tagihanKrFiltered.map((t: any) => (
                    <div key={t.id}
                      className={`w-full flex items-center gap-2 px-3 py-2 border-b last:border-0 hover:bg-muted/60 transition-colors ${krTagihanId === t.id ? "bg-primary/10 font-semibold" : ""}`}>
                      {krMode === "batal" && (
                        <Checkbox
                          checked={krSelectedIds.has(t.id)}
                          onCheckedChange={() => toggleKrSelect(t.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}
                      <button type="button" className="flex-1 text-left"
                        onClick={() => { setKrTagihanId(t.id); setKrSearch(`${t.siswa?.nis} — ${t.siswa?.nama}`); }}>
                        <span className="font-medium">{t.siswa?.nis} — {t.siswa?.nama}</span>
                        <span className="text-muted-foreground ml-2">{t.jenis?.nama}{t.bulan ? ` (${namaBulanTahun(t.bulan, { tahunBukuNama: t.tahun_ajaran?.nama })})` : ""}</span>
                        {t.status === "terjadwal" && (
                          <Badge variant="outline" className="ml-2 bg-muted text-muted-foreground text-[10px] py-0">Terjadwal</Badge>
                        )}
                        <span className="float-right font-semibold">{formatRupiah(Number(t.nominal))}</span>
                      </button>
                    </div>
                  ))
                }
              </div>
            </div>

            {krMode === "batal" && krSelectedIds.size > 0 && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {krSelectedIds.size} tagihan dipilih — Total {formatRupiah(krSelectedTotal)}
                  </span>
                  <button type="button" className="text-muted-foreground hover:text-foreground"
                    onClick={() => setKrSelectedIds(new Set())}>
                    Kosongkan
                  </button>
                </div>
                <p className="text-muted-foreground">
                  Isi Alasan di bawah, lalu klik <strong>"Batalkan {krSelectedIds.size} Tagihan Terpilih"</strong>.
                  Setiap tagihan akan mendapat jurnal pembalik sendiri-sendiri.
                </p>
              </div>
            )}

            {selectedKrTagihan && (
              <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1">
                <p className="font-semibold">Detail Tagihan Dipilih:</p>
                <p>Siswa: <span className="font-medium">{selectedKrTagihan.siswa?.nama}</span></p>
                <p>Jenis: <span className="font-medium">{selectedKrTagihan.jenis?.nama}</span></p>
                <p>Nominal saat ini: <span className="font-semibold">{formatRupiah(Number(selectedKrTagihan.nominal))}</span></p>
                <div className="border-t pt-1 mt-1">
                  {selectedKrTagihan.status === "terjadwal" ? (
                    <>
                      <p className="font-medium text-foreground">Tidak ada jurnal yang dibuat/dibalik:</p>
                      <p className="text-muted-foreground">
                        Tagihan ini belum jatuh tempo — belum pernah berjurnal, jadi {krMode === "batal" ? "langsung ditandai batal" : "nominalnya langsung diperbarui"} tanpa jurnal.
                      </p>
                    </>
                  ) : krMode === "batal" ? (
                    <>
                      <p className="font-medium text-foreground">Jurnal yang akan dibuat (otomatis, Posted):</p>
                      <p>Dr. Pendapatan &nbsp;{formatRupiah(Number(selectedKrTagihan.nominal))}</p>
                      <p>Cr. Piutang Siswa &nbsp;{formatRupiah(Number(selectedKrTagihan.nominal))}</p>
                      <p className="text-muted-foreground">(membalik jurnal piutang asal)</p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium text-foreground">Jurnal yang akan dibuat (otomatis, Posted):</p>
                      <p>1. Balik jurnal piutang lama {formatRupiah(Number(selectedKrTagihan.nominal))}</p>
                      <p>2. Jurnal piutang baru {krNominalBaru ? formatRupiah(Number(krNominalBaru)) : "(isi nominal baru)"}</p>
                    </>
                  )}
                </div>
              </div>
            )}

            {krMode === "koreksi_nominal" && (
              <div>
                <Label>Nominal Baru (Rp) *</Label>
                <Input type="number" placeholder="0" value={krNominalBaru}
                  onChange={(e) => setKrNominalBaru(e.target.value)} />
                {krNominalBaru && <p className="text-xs text-muted-foreground mt-1">{formatRupiah(Number(krNominalBaru))}</p>}
              </div>
            )}

            <div>
              <Label>Alasan *</Label>
              <Textarea rows={2} placeholder="mis. Salah pilih siswa / tagihan dobel / tarif keliru..." value={krAlasan}
                onChange={(e) => setKrAlasan(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetKoreksi}>Batal</Button>
            {krMode === "batal" && krSelectedIds.size > 1 ? (
              <Button variant="destructive" onClick={() => setBatalMassalOpen(true)}
                disabled={!krAlasan.trim() || koreksiTagihan.isPending}>
                Batalkan {krSelectedIds.size} Tagihan Terpilih
              </Button>
            ) : (
              <Button onClick={submitKoreksi}
                disabled={!krTagihanId || !krAlasan.trim() || (krMode === "koreksi_nominal" && !krNominalBaru) || koreksiTagihan.isPending}>
                {koreksiTagihan.isPending ? "Memproses..." : (krMode === "batal" ? "Batalkan & Buat Jurnal" : "Koreksi & Buat Jurnal")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Konfirmasi Batalkan Massal */}
      <Dialog open={batalMassalOpen} onOpenChange={(o) => { if (!o && !isBatalMassal) { setBatalMassalOpen(false); setBatalMassalProgress(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Konfirmasi Batalkan {krSelectedRows.length} Tagihan
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>
              Total nominal: <span className="font-semibold">{formatRupiah(krSelectedTotal)}</span>.
              Setiap tagihan akan dibalik jurnal piutangnya secara terpisah (jurnal pembalik per tagihan),
              dan tercatat di Audit Perubahan Data.
            </p>
            <div className="border rounded-md max-h-40 overflow-y-auto text-xs">
              {krSelectedRows.map((t: any) => (
                <div key={t.id} className="px-3 py-1.5 border-b last:border-0">
                  <span className="font-medium">{t.siswa?.nis} — {t.siswa?.nama}</span>
                  <span className="text-muted-foreground ml-2">{t.jenis?.nama}{t.bulan ? ` (${namaBulanTahun(t.bulan, { tahunBukuNama: t.tahun_ajaran?.nama })})` : ""}</span>
                  <span className="float-right font-semibold">{formatRupiah(Number(t.nominal))}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Alasan: <span className="italic">{krAlasan || "-"}</span> · Tanggal: {krTanggal}
            </p>

            {isBatalMassal && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium">Memproses {batalMassalProgress?.total ?? krSelectedRows.length} tagihan di server…</p>
                <Progress value={100} className="h-2 animate-pulse" />
                <p className="text-xs text-muted-foreground">Mohon tunggu, proses berjalan meski koneksi sempat lambat.</p>
              </div>
            )}

            {!isBatalMassal && batalMassalGagal.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs space-y-1">
                <p className="font-medium text-destructive">{batalMassalGagal.length} tagihan gagal dibatalkan:</p>
                {batalMassalGagal.map((g) => (
                  <p key={g.id}>• {g.nama} — <span className="text-muted-foreground">{g.error}</span></p>
                ))}
                <p className="text-muted-foreground">Tagihan yang gagal masih tercentang, bisa dicoba lagi.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={isBatalMassal}
              onClick={() => { setBatalMassalOpen(false); setBatalMassalProgress(null); }}>
              Tutup
            </Button>
            <Button variant="destructive" onClick={submitBatalMassal} disabled={isBatalMassal || krSelectedRows.length === 0}>
              {isBatalMassal ? "Memproses..." : `Batalkan ${krSelectedRows.length} Tagihan`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Hapus Penyisihan */}
      <ConfirmDialog open={!!deletePs} onOpenChange={() => setDeletePs(null)}
        title="Hapus Catatan Penyisihan"
        description="Jurnal terkait tidak akan otomatis dibatalkan. Hapus catatan penyisihan ini?"
        onConfirm={() => { if (deletePs) deletePenyisihan.mutate(deletePs); setDeletePs(null); }}
        loading={deletePenyisihan.isPending} />

      <ConfirmDialog open={konfirmAkrual} onOpenChange={setKonfirmAkrual}
        title="Jalankan Akrual Pendapatan"
        variant="default"
        confirmLabel="Ya, Jalankan"
        description={
          terjadwalJatuhTempo.length > 0
            ? `${terjadwalJatuhTempo.length} tagihan (${formatRupiah(totalSiapDiakui)}) akan diakui jadi piutang dengan jurnal posted per hari ini. Pembayaran yang sudah diterima di muka untuk periode yang sama juga akan diakui jadi pendapatan.`
            : "Tidak ada tagihan yang mencapai tanggal pengakuan hari ini. Proses tetap akan memeriksa pendapatan diterima di muka yang sudah waktunya diakui."
        }
        onConfirm={() => { setKonfirmAkrual(false); akrualMutation.mutate(); }}
        loading={akrualMutation.isPending} />
    </div>
  );
}
