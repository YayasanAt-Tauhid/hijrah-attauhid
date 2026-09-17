import { useState, useMemo, useEffect, useCallback } from "react";
import { PrintKuitansi } from "@/components/shared/PrintKuitansi";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { supabase } from "@/integrations/supabase/client";
import { prosesPembayaran, batalkanPembayaran } from "@/server/pembayaran";
import {
  useJenisPembayaran, useLembaga, useTahunBukuAktif,
  useTahunBuku, formatRupiah, terbilang, namaBulan, namaBulanTahun, BULAN_ORDER_AKADEMIK,
} from "@/hooks/useKeuangan";
import { useTarifSiswa } from "@/hooks/useTarifTagihan";
import { useTagihanBySiswa } from "@/hooks/useTagihan";
import { logAuditKeuangan } from "@/hooks/useJurnal";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, Printer, Check, X } from "lucide-react";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { cn } from "@/lib/utils";

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
  const [searchTerm,    setSearchTerm]    = useState("");
  const [selectedSiswa, setSelectedSiswa] = useState<SiswaWithKelas | null>(null);
  const [departemenId,  setDepartemenId]  = useState("");
  const [form, setForm] = useState<FormPembayaran>(FORM_DEFAULT);
  const [selectedTahunAjaranId, setSelectedTahunAjaranId] = useState("");
  const [showKuitansi, setShowKuitansi] = useState(false);
  const [lastPayment, setLastPayment] = useState<{
    pembayaran_id: string; jumlah: number; jenisNama: string;
    jenisTipe: string; siswa: SiswaWithKelas; bulan: number; tanggal_bayar: string;
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

  const { data: searchResults } = useQuery<SiswaWithKelas[]>({
    queryKey: ["search_siswa", searchTerm, departemenId],
    enabled: searchTerm.length >= 2,
    queryFn: async () => {
      // karakter khusus filter PostgREST (koma/kurung/%) bisa merusak ekspresi .or()
      const safeTerm = searchTerm.replace(/[%,()]/g, "");
      const { data } = await supabase
        .from("siswa")
        .select("id, nis, nama, foto_url, status, angkatan_id, kelas_siswa(kelas_id, aktif, kelas(id, nama, departemen_id))")
        .or(`nama.ilike.%${safeTerm}%,nis.ilike.%${safeTerm}%`)
        .eq("status", "aktif")
        .limit(10);
      const all = (data ?? []) as SiswaWithKelas[];
      if (!departemenId) return all;
      return all.filter(s => s.kelas_siswa?.some(ks => ks.kelas?.departemen_id === departemenId));
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

  const jenisList = useMemo<JenisPembayaran[]>(() => {
    if (!allJenisList) return [];
    if (!selectedSiswa || !applicableTarifJenisIds) return allJenisList as JenisPembayaran[];
    return (allJenisList as JenisPembayaran[]).filter(j => applicableTarifJenisIds.has(j.id));
  }, [allJenisList, selectedSiswa, applicableTarifJenisIds]);

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

  // Bulan yang punya tagihan (dari tabel tagihan) — hanya bulan ini yang tampil di grid & dropdown
  const { data: bulanAdaTagihan } = useQuery<Set<number>>({
    queryKey: ["cek_bulan_ada_tagihan", selectedSiswa?.id, form.jenisId, effectiveTahunAjaranId],
    enabled: !!selectedSiswa && !!form.jenisId && !isSekali,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tagihan")
        .select("bulan")
        .eq("siswa_id", selectedSiswa!.id)
        .eq("jenis_id", form.jenisId)
        .eq("tahun_ajaran_id", effectiveTahunAjaranId)
        .not("bulan", "is", null);
      if (error) throw error;
      return new Set((data ?? []).map(r => r.bulan as number));
    },
  });

  // Bulan yang tampil = bulan punya tagihan ATAU semua bulan jika belum ada tagihan sama sekali
  const bulanTampil = useMemo<number[]>(() => {
    if (!bulanAdaTagihan || bulanAdaTagihan.size === 0) return BULAN_ORDER_AKADEMIK;
    return BULAN_ORDER_AKADEMIK.filter(m => bulanAdaTagihan.has(m));
  }, [bulanAdaTagihan]);

  const { data: pembayaranSekali } = useQuery<{ totalBayar: number; lunas: boolean }>({
    queryKey: ["cek_sekali", selectedSiswa?.id, form.jenisId, effectiveTahunAjaranId, tarifNominal],
    enabled: !!selectedSiswa && !!form.jenisId && isSekali && tarifNominal != null,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pembayaran")
        .select("jumlah")
        .eq("siswa_id", selectedSiswa!.id)
        .eq("jenis_id", form.jenisId)
        .eq("tahun_ajaran_id", effectiveTahunAjaranId);
      if (error) throw error;
      const total = (data ?? []).reduce((s, r) => s + Number(r.jumlah ?? 0), 0);
      return { totalBayar: total, lunas: (tarifNominal ?? 0) > 0 && total >= (tarifNominal ?? 0) };
    },
  });

  const { data: riwayat, isLoading: loadRiwayat } = useQuery<PembayaranWithJenis[]>({
    queryKey: ["pembayaran_siswa", selectedSiswa?.id],
    enabled: !!selectedSiswa,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pembayaran")
        .select("*, jenis_pembayaran:jenis_id(id, nama, tipe)")
        .eq("siswa_id", selectedSiswa!.id)
        .order("tanggal_bayar", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as PembayaranWithJenis[];
    },
  });

  useEffect(() => {
    if (tarifNominal != null && form.jenisId) setField("jumlah", String(tarifNominal));
  }, [tarifNominal, form.jenisId]);

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
  const isBayarDimuka  = !!(selectedTahun?.tanggal_mulai && selectedTahun.tanggal_mulai > new Date().toISOString().split("T")[0]);
  const tarifTidakAda  = !!(form.jenisId && selectedSiswa && !loadingTarif && tarifNominal == null);
  const isJumlahLocked = !isSekali && tarifNominal != null;
  const sudahBayar     = bulanDibayar ? bulanTampil.filter(m => bulanDibayar.has(m)).length : 0;
  const belumBayar     = bulanTampil.length - sudahBayar;
  const kelasNama      = getKelasAktif(selectedSiswa)?.kelas?.nama ?? "-";
  const lembagaNama    = lembagaList?.find(l => l.id === departemenId)?.nama ?? "-";

  const prosesMutation = useProsesPembayaran();
  const batalMutation  = useBatalkanPembayaran();
  const { role } = useAuth();
  const canBatal = role === "admin" || role === "kepala_sekolah" || role === "keuangan";
  const [batalTarget, setBatalTarget] = useState<PembayaranWithJenis | null>(null);
  const [batalAlasan, setBatalAlasan] = useState("");

  const handleSelectSiswa = useCallback((s: SiswaWithKelas) => {
    setSelectedSiswa(s);
    setSearchTerm("");
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

  const handleSubmit = async () => {
    if (!selectedSiswa || !form.jenisId || !form.jumlah || tarifTidakAda) return;
    if (!tahunAktif?.id) { toast.error("Tahun ajaran aktif belum dikonfigurasi"); return; }
    if (isSekali && pembayaranSekali?.lunas) { toast.error("Pembayaran ini sudah lunas"); return; }

    const result = await prosesMutation.mutateAsync({
      siswa_id:        selectedSiswa.id,
      jenis_id:        form.jenisId,
      bulan:           isSekali ? 0 : form.bulan,
      jumlah:          Number(form.jumlah),
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
    });
    setShowKuitansi(true);
    resetForm();
    toast.success("Pembayaran berhasil disimpan");
  };

  const riwayatColumns: DataTableColumn<PembayaranWithJenis>[] = [
    { key: "jenis_pembayaran", label: "Jenis", render: (_, r) => r.jenis_pembayaran?.nama ?? "-" },
    { key: "bulan",   label: "Bulan",   render: (v, r) => v ? namaBulanTahun(v as number, { tanggalTransaksi: r.tanggal_bayar }) : <span className="text-muted-foreground text-xs">Sekali Bayar{r.tanggal_bayar ? ` ${new Date(r.tanggal_bayar).getFullYear()}` : ""}</span> },
    { key: "jumlah",  label: "Jumlah",  render: v => formatRupiah(Number(v)) },
    { key: "tanggal_bayar", label: "Tanggal", render: v => v ? format(new Date(v as string), "dd MMM yyyy", { locale: idLocale }) : "-" },
    ...(canBatal ? [{
      key: "aksi", label: "", render: (_: unknown, r: PembayaranWithJenis) => (
        <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive"
          onClick={() => { setBatalTarget(r); setBatalAlasan(""); }}>
          <X className="h-3.5 w-3.5 mr-1" />Batalkan
        </Button>
      ),
    } as DataTableColumn<PembayaranWithJenis>] : []),
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
            placeholder="Ketik NIS atau nama siswa untuk mencari..."
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
        <Select value={departemenId || "__all__"} onValueChange={v => { setDepartemenId(v === "__all__" ? "" : v); setSelectedSiswa(null); setField("jenisId", ""); }}>
          <SelectTrigger className="w-44 h-11"><SelectValue placeholder="Semua lembaga" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Semua Lembaga</SelectItem>
            {lembagaList?.map(l => <SelectItem key={l.id} value={l.id}>{l.kode} — {l.nama}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={selectedTahunAjaranId || tahunAktif?.id || ""} onValueChange={setSelectedTahunAjaranId}>
          <SelectTrigger className="w-48 h-11"><SelectValue placeholder="Tahun Ajaran" /></SelectTrigger>
          <SelectContent>
            {tahunAjaranList?.filter(t => !t.ditutup).map(t => (
              <SelectItem key={t.id} value={t.id}>{t.nama} {t.aktif ? "(Aktif)" : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedSiswa && (
          <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0"
            onClick={() => { setSelectedSiswa(null); setField("jenisId", ""); }}>
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
                {!loadingTarif && tarifNominal != null && (
                  <p className="text-[11px] text-primary">⚡ Tarif: {formatRupiah(tarifNominal)}</p>
                )}
                {tarifTidakAda && (
                  <p className="text-[11px] text-destructive font-medium">⚠️ Tarif belum dikonfigurasi</p>
                )}
                {existingTagihan?.status === "belum_bayar" && (
                  <p className="text-[11px] text-amber-600">📋 Piutang: {formatRupiah(Number(existingTagihan.nominal))}</p>
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
                          const sudah = bulanDibayar?.has(m);
                          return (
                            <SelectItem key={m} value={String(m)} disabled={sudah}>
                              {namaBulan(m)}{sudah ? " ✓" : ""}
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
                      {sudahBayar}/{bulanTampil.length} bulan lunas
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
                      const sudah = bulanDibayar?.has(m);
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => !sudah && setField("bulan", m)}
                          className={cn(
                            "rounded px-1.5 py-1 text-[10px] font-medium border transition-colors",
                            sudah
                              ? "bg-green-50 border-green-200 text-green-700 cursor-default"
                              : form.bulan === m
                              ? "bg-primary border-primary text-primary-foreground"
                              : "bg-background border-border text-foreground hover:border-primary/50"
                          )}
                        >
                          {namaBulan(m).slice(0, 3)}
                          {sudah && <Check className="inline ml-0.5 h-2.5 w-2.5" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Status Sekali Bayar ─────────────────────────────────────────────── */}
            {isSekali && pembayaranSekali && (
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
            )}

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
                className="h-9 text-sm"
              />
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

            {/* ── Tombol Simpan ──────────────────────────────────────────────────── */}
            <Button
              className="w-full h-9"
              onClick={handleSubmit}
              disabled={
                !form.jenisId || !form.jumlah || tarifTidakAda ||
                prosesMutation.isPending ||
                (isSekali && !!pembayaranSekali?.lunas) ||
                (!isSekali && !!bulanDibayar?.has(form.bulan))
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
                  Simpan & Cetak Kuitansi
                </span>
              )}
            </Button>
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
                siswa: lastPayment.siswa,
              }}
              kelasNama={kelasNama}
              lembagaNama={lembagaNama}
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
