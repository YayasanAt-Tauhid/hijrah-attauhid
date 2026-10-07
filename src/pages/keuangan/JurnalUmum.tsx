import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FilterToolbar, ActiveFilter } from "@/components/shared/FilterToolbar";
import { Badge } from "@/components/ui/badge";
import { useJurnalList, useJurnalPenginput, useJurnalDetail, useCreateJurnal, useUpdateJurnal, useDeleteJurnal, usePostJurnal, useAkunRekening, useKoreksiJurnal, useJurnalDikoreksiIds } from "@/hooks/useJurnal";
import { AkunCombobox } from "@/components/shared/AkunCombobox";
import { RupiahInput } from "@/components/shared/RupiahInput";
import { formatRupiah, useLembaga } from "@/hooks/useKeuangan";
import { StatsCard } from "@/components/shared/StatsCard";
import { Plus, Eye, Pencil, Trash2, Lock, Send, Search, BookOpen, CheckCircle, FileEdit, RotateCcw, Printer } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";

interface DetailRow {
  akun_id: string;
  keterangan: string;
  debit: number;
  kredit: number;
}

const defaultDari = format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), "yyyy-MM-dd");
const defaultSampai = format(new Date(), "yyyy-MM-dd");

// Jurnal online payment (webhook Midtrans) tidak punya penginput manusia —
// dikenali dari referensi berupa order_id dengan prefix "HAT-"
const isJurnalOtomatis = (referensi?: string | null) => !!referensi?.startsWith("HAT-");

const PenginputCell = ({ nama, referensi }: { nama?: string | null; referensi?: string | null }) => {
  if (nama) return <>{nama}</>;
  if (isJurnalOtomatis(referensi)) {
    return (
      <Badge variant="outline" className="bg-info/15 text-info border-info/30">
        Otomatis (Online Payment)
      </Badge>
    );
  }
  return <>-</>;
};

export default function JurnalUmum() {
  const [departemenId, setDepartemenId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"semua" | "draft" | "posted">("semua");
  const [sembunyikanKoreksi, setSembunyikanKoreksi] = useState(true);
  const [akunFilter, setAkunFilter] = useState("");
  const [penginputId, setPenginputId] = useState("");
  const [tanggalDari, setTanggalDari] = useState(defaultDari);
  const [tanggalSampai, setTanggalSampai] = useState(defaultSampai);
  const { data: lembagaList } = useLembaga();
  const { data: jurnalList, isLoading } = useJurnalList(tanggalDari || undefined, tanggalSampai || undefined, departemenId || undefined, penginputId || undefined);
  const { data: penginputList, isLoading: penginputLoading, isError: penginputError } = useJurnalPenginput();
  const { data: dikoreksiIds } = useJurnalDikoreksiIds();
  const { data: akunList } = useAkunRekening();
  const createMut = useCreateJurnal();
  const updateMut = useUpdateJurnal();
  const deleteMut = useDeleteJurnal();
  const postMut = usePostJurnal();

  const [formOpen, setFormOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [postId, setPostId] = useState<string | null>(null);

  // Jurnal Koreksi state
  const [koreksiOpen, setKoreksiOpen] = useState(false);
  const [koreksiTarget, setKoreksiTarget] = useState<any>(null);
  const [tanggalKoreksi, setTanggalKoreksi] = useState(format(new Date(), "yyyy-MM-dd"));
  const [alasanKoreksi, setAlasanKoreksi] = useState("");
  const [buatPengganti, setBuatPengganti] = useState(false);
  const [tanggalPengganti, setTanggalPengganti] = useState(format(new Date(), "yyyy-MM-dd"));
  const [penggantiKeterangan, setPenggantiKeterangan] = useState("");
  const [penggantiReferensi, setPenggantiReferensi] = useState("");
  const [penggantiDetails, setPenggantiDetails] = useState<DetailRow[]>([
    { akun_id: "", keterangan: "", debit: 0, kredit: 0 },
    { akun_id: "", keterangan: "", debit: 0, kredit: 0 },
  ]);
  const koreksiMut = useKoreksiJurnal();
  const { data: koreksiTargetDetail } = useJurnalDetail(koreksiTarget?.id);

  const openKoreksi = (item: any) => {
    setKoreksiTarget(item);
    setTanggalKoreksi(format(new Date(), "yyyy-MM-dd"));
    setAlasanKoreksi("");
    setBuatPengganti(false);
    setTanggalPengganti(item.tanggal || format(new Date(), "yyyy-MM-dd"));
    setPenggantiKeterangan(`KOREKSI ${item.keterangan}`);
    setPenggantiReferensi(item.nomor || "");
    setPenggantiDetails([
      { akun_id: "", keterangan: "", debit: 0, kredit: 0 },
      { akun_id: "", keterangan: "", debit: 0, kredit: 0 },
    ]);
    setKoreksiOpen(true);
  };

  const totalPenggantiDebit = penggantiDetails.reduce((s, d) => s + (d.debit || 0), 0);
  const totalPenggantiKredit = penggantiDetails.reduce((s, d) => s + (d.kredit || 0), 0);
  const isPenggantiBalanced = Math.abs(totalPenggantiDebit - totalPenggantiKredit) < 0.01 && totalPenggantiDebit > 0;

  const handleKoreksi = async () => {
    if (!koreksiTarget || !alasanKoreksi.trim()) return;
    await koreksiMut.mutateAsync({
      jurnal_asal_id: koreksiTarget.id,
      tanggal_koreksi: tanggalKoreksi,
      alasan: alasanKoreksi,
      ...(buatPengganti && isPenggantiBalanced ? {
        pengganti: {
          tanggal: tanggalPengganti,
          keterangan: penggantiKeterangan,
          referensi: penggantiReferensi,
          details: penggantiDetails.filter(d => d.akun_id).map((d, i) => ({ ...d, urutan: i + 1 })),
        },
      } : {}),
    });
    setKoreksiOpen(false);
    setKoreksiTarget(null);
  };

  const gabungPenggantiKeterangan = () => {
    const combined = penggantiDetails
      .map((d) => d.keterangan.trim())
      .filter(Boolean)
      .join("; ");
    if (combined) setPenggantiKeterangan(combined);
    else toast.info("Isi dulu keterangan pada baris akun untuk digabungkan");
  };

  const addPenggantiRow = () =>
    setPenggantiDetails([...penggantiDetails, { akun_id: "", keterangan: "", debit: 0, kredit: 0 }]);
  const removePenggantiRow = (i: number) => {
    if (penggantiDetails.length > 2)
      setPenggantiDetails(penggantiDetails.filter((_, idx) => idx !== i));
  };
  const updatePenggantiRow = (i: number, field: keyof DetailRow, value: any) => {
    const next = [...penggantiDetails];
    (next[i] as any)[field] = value;
    setPenggantiDetails(next);
  };

  const [tanggal, setTanggal] = useState(format(new Date(), "yyyy-MM-dd"));
  const [keterangan, setKeterangan] = useState("");
  const [referensi, setReferensi] = useState("");
  const [formDepartemenId, setFormDepartemenId] = useState("");
  const [details, setDetails] = useState<DetailRow[]>([
    { akun_id: "", keterangan: "", debit: 0, kredit: 0 },
    { akun_id: "", keterangan: "", debit: 0, kredit: 0 },
  ]);

  const { data: viewData } = useJurnalDetail(viewId || editId || undefined);

  const totalDebit = details.reduce((s, d) => s + (d.debit || 0), 0);
  const totalKredit = details.reduce((s, d) => s + (d.kredit || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalKredit) < 0.01 && totalDebit > 0;

  const openCreate = () => {
    setEditId(null);
    setTanggal(format(new Date(), "yyyy-MM-dd"));
    setKeterangan("");
    setReferensi("");
    setFormDepartemenId(departemenId || "");
    setDetails([
      { akun_id: "", keterangan: "", debit: 0, kredit: 0 },
      { akun_id: "", keterangan: "", debit: 0, kredit: 0 },
    ]);
    setFormOpen(true);
  };

  const openEdit = (item: any) => {
    setEditId(item.id);
    setTanggal(item.tanggal);
    setKeterangan(item.keterangan);
    setReferensi(item.referensi || "");
    setFormDepartemenId(item.departemen_id || "");
    // Reset detail ke placeholder dulu — useEffect akan mengisi saat viewData siap
    setDetails([
      { akun_id: "", keterangan: "", debit: 0, kredit: 0 },
      { akun_id: "", keterangan: "", debit: 0, kredit: 0 },
    ]);
    setFormOpen(true);
  };

  useEffect(() => {
    if (editId && viewData?.details) {
      setDetails(
        viewData.details.map((d: any) => ({
          akun_id: d.akun_id,
          keterangan: d.keterangan || "",
          debit: Number(d.debit) || 0,
          kredit: Number(d.kredit) || 0,
        }))
      );
    }
  }, [editId, viewData]);

  const handleSave = async () => {
    const payload = {
      tanggal,
      keterangan,
      referensi: referensi || undefined,
      departemen_id: formDepartemenId || undefined,
      details: details.filter(d => d.akun_id).map((d, i) => ({ ...d, urutan: i + 1 })),
    };
    if (editId) {
      await updateMut.mutateAsync({ id: editId, ...payload });
    } else {
      await createMut.mutateAsync(payload);
    }
    setFormOpen(false);
  };

  // Gabungkan keterangan tiap baris (yang terisi) menjadi keterangan header
  const gabungKeterangan = () => {
    const combined = details
      .map((d) => d.keterangan.trim())
      .filter(Boolean)
      .join("; ");
    if (combined) setKeterangan(combined);
    else toast.info("Isi dulu keterangan pada baris akun untuk digabungkan");
  };

  const addRow = () => setDetails([...details, { akun_id: "", keterangan: "", debit: 0, kredit: 0 }]);
  const removeRow = (i: number) => { if (details.length > 2) setDetails(details.filter((_, idx) => idx !== i)); };
  const updateRow = (i: number, field: keyof DetailRow, value: any) => {
    const next = [...details];
    (next[i] as any)[field] = value;
    setDetails(next);
  };

  const lembagaNama = lembagaList?.find((l: any) => l.id === departemenId);

  // Cetak detail jurnal via popup terpisah (pola sama dengan printBukti di PortalRiwayat)
  const printJurnal = (j: any) => {
    const w = window.open("", "_blank", "width=800,height=650");
    if (!w) { toast.error("Popup diblokir. Izinkan popup untuk mencetak."); return; }
    const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const rows = (j.details || []).map((d: any) => `
      <tr>
        <td>${esc(d.akun_rekening?.kode)} - ${esc(d.akun_rekening?.nama)}</td>
        <td>${esc(d.keterangan || "-")}</td>
        <td class="num">${Number(d.debit) > 0 ? formatRupiah(Number(d.debit)) : "-"}</td>
        <td class="num">${Number(d.kredit) > 0 ? formatRupiah(Number(d.kredit)) : "-"}</td>
      </tr>`).join("");
    w.document.write(`
      <html><head><title>Jurnal ${esc(j.nomor)}</title>
      <style>
        body{font-family:sans-serif;padding:24px;color:#111;font-size:13px}
        h2{margin:0 0 2px}
        .sub{color:#555;margin:0 0 16px}
        .meta{margin:4px 0}
        table{width:100%;border-collapse:collapse;margin-top:12px}
        th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
        th{background:#f0f0f0}
        .num{text-align:right}
        tfoot td{font-weight:bold;background:#f7f7f7}
        .footer{margin-top:32px;font-size:11px;color:#666}
        @media print{button{display:none}}
      </style>
      </head><body>
      <h2>Detail Jurnal Umum</h2>
      <p class="sub">Arsip cetak — ${new Date().toLocaleString("id-ID")}</p>
      <p class="meta"><b>Nomor:</b> ${esc(j.nomor)}</p>
      <p class="meta"><b>Tanggal:</b> ${format(new Date(j.tanggal), "d MMMM yyyy", { locale: idLocale })}</p>
      <p class="meta"><b>Status:</b> ${j.status === "posted" ? "Posted" : "Draft"}</p>
      <p class="meta"><b>Lembaga:</b> ${esc(j.departemen?.kode || "-")}</p>
      <p class="meta"><b>Diinput Oleh:</b> ${esc(j.penginput?.nama || (isJurnalOtomatis(j.referensi) ? "Otomatis (Online Payment)" : "-"))}</p>
      <p class="meta"><b>Keterangan:</b> ${esc(j.keterangan)}</p>
      <table>
        <thead><tr><th>Akun</th><th>Keterangan</th><th class="num">Debit</th><th class="num">Kredit</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="2" class="num">Total</td><td class="num">${formatRupiah(Number(j.total_debit) || 0)}</td><td class="num">${formatRupiah(Number(j.total_kredit) || 0)}</td></tr></tfoot>
      </table>
      <p class="footer">Dicetak dari aplikasi keuangan untuk keperluan arsip.</p>
      <br/><button onclick="window.print()">Cetak</button>
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  // Query jurnal IDs that contain a specific akun (when akunFilter is set)
  const { data: jurnalIdsByAkun } = useQuery({
    queryKey: ["jurnal_by_akun", akunFilter],
    enabled: !!akunFilter,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jurnal_detail")
        .select("jurnal_id")
        .eq("akun_id", akunFilter);
      if (error) throw error;
      return new Set((data || []).map((r: any) => r.jurnal_id));
    },
  });

  const filteredJurnal = useMemo(() => {
    let list = (jurnalList as any[]) || [];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((j: any) =>
        j.nomor?.toLowerCase().includes(q) ||
        j.keterangan?.toLowerCase().includes(q) ||
        j.referensi?.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "semua") {
      list = list.filter((j: any) => j.status === statusFilter);
    }
    if (akunFilter && jurnalIdsByAkun) {
      list = list.filter((j: any) => jurnalIdsByAkun.has(j.id));
    }
    if (sembunyikanKoreksi) {
      list = list.filter((j: any) => j.tipe !== "pembalik" && !dikoreksiIds?.has(j.id));
    }
    return list;
  }, [jurnalList, searchQuery, statusFilter, akunFilter, jurnalIdsByAkun, sembunyikanKoreksi, dikoreksiIds]);

  const totalJurnal = filteredJurnal.length;
  const jurnalPosted = filteredJurnal.filter((j: any) => j.status === "posted").length;
  const jurnalDraft = filteredJurnal.filter((j: any) => j.status === "draft").length;

  const penginputNama = penginputId === "__online__"
    ? "Otomatis (Online Payment)"
    : penginputId === "__unknown__"
      ? "Belum tercatat"
      : penginputList?.find((p) => p.id === penginputId)?.nama || "Penginput terpilih";

  const activeFilters: ActiveFilter[] = [
    ...(penginputId ? [{
      key: "penginput", label: "Diinput Oleh", value: penginputNama,
      onClear: () => setPenginputId(""),
    }] : []),
    ...(departemenId ? [{
      key: "lembaga", label: "Lembaga", value: lembagaNama?.kode || lembagaNama?.nama || "",
      onClear: () => setDepartemenId(""),
    }] : []),
    ...(statusFilter !== "semua" ? [{
      key: "status", label: "Status", value: statusFilter === "posted" ? "Posted" : "Draft",
      onClear: () => setStatusFilter("semua"),
    }] : []),
    ...(akunFilter ? [{
      key: "akun", label: "Akun",
      value: akunList?.find((a: any) => a.id === akunFilter)?.kode || "—",
      onClear: () => setAkunFilter(""),
    }] : []),
    ...(sembunyikanKoreksi ? [{
      key: "koreksi", label: "Koreksi", value: "Disembunyikan",
      onClear: () => setSembunyikanKoreksi(false),
    }] : []),
    ...(tanggalDari || tanggalSampai ? [{
      key: "rentang", label: "Rentang",
      value: `${tanggalDari || "…"} → ${tanggalSampai || "…"}`,
      onClear: () => { setTanggalDari(defaultDari); setTanggalSampai(defaultSampai); },
    }] : []),
  ];

  const columns: DataTableColumn<any>[] = [
    { key: "nomor", label: "Nomor", sortable: true },
    {
      key: "tanggal", label: "Tanggal", sortable: true,
      render: (v) => v ? format(new Date(v as string), "d MMMM yyyy", { locale: idLocale }) : "-",
    },
    { key: "keterangan", label: "Keterangan" },
    { key: "departemen", label: "Lembaga", render: (_, r) => (r as any).departemen?.kode || "-" },
    {
      key: "penginput", label: "Diinput Oleh",
      render: (_, r: any) => <PenginputCell nama={r.penginput?.nama} referensi={r.referensi} />,
    },
    { key: "total_debit", label: "Total Debit", render: (v) => formatRupiah(Number(v) || 0) },
    { key: "total_kredit", label: "Total Kredit", render: (v) => formatRupiah(Number(v) || 0) },
    {
      key: "status", label: "Status",
      render: (v) => (
        <Badge variant="outline" className={v === "posted" ? "bg-success/15 text-success border-success/30" : "bg-warning/15 text-warning border-warning/30"}>
          {v === "posted" ? "Posted" : "Draft"}
        </Badge>
      ),
    },
    {
      key: "tipe", label: "Tipe",
      render: (v, r: any) => {
        if (!v || v === "normal") {
          return dikoreksiIds?.has(r.id) ? (
            <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30">Dikoreksi</Badge>
          ) : null;
        }
        const cfg: Record<string, { label: string; color: string }> = {
          pembalik:  { label: "Pembalik",  color: "bg-destructive/15 text-destructive border-destructive/30" },
          pengganti: { label: "Pengganti", color: "bg-info/15 text-info border-info/30" },
        };
        const c = cfg[v as string];
        return c ? (
          <Badge variant="outline" className={c.color}>{c.label}</Badge>
        ) : null;
      },
    },
    {
      key: "aksi", label: "Aksi",
      render: (_, r: any) => (
        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setViewId(r.id); setViewOpen(true); }}>
                <Eye className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Lihat detail</TooltipContent>
          </Tooltip>

          {r.status === "draft" ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(r)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Edit jurnal</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteId(r.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Hapus jurnal</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-primary hover:text-primary" onClick={() => setPostId(r.id)}>
                    <Send className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Posting jurnal</TooltipContent>
              </Tooltip>
            </>
          ) : (
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex h-8 w-8 items-center justify-center">
                    <Lock className="h-4 w-4 text-muted-foreground" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>Jurnal sudah diposting — tidak bisa diedit</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-warning hover:text-warning"
                    onClick={() => openKoreksi(r)}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Buat jurnal koreksi / pembalik</TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-0 animate-fade-in">
      <div className="flex items-center justify-between gap-4 mb-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Jurnal Umum</h1>
          <p className="text-xs text-muted-foreground">Catat transaksi keuangan dalam jurnal umum</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        <StatsCard title="Total Jurnal" value={totalJurnal} icon={BookOpen} color="info" />
        <StatsCard title="Sudah Diposting" value={jurnalPosted} icon={CheckCircle} color="success" />
        <StatsCard
          title="Masih Draft"
          value={jurnalDraft}
          icon={FileEdit}
          color="warning"
          active={statusFilter === "draft"}
          onClick={() => setStatusFilter(f => f === "draft" ? "semua" : "draft")}
        />
      </div>

      {/* Filter toolbar */}
      <div className="border-b border-border pb-3 mb-4">
        <FilterToolbar
          activeFilters={activeFilters}
          actions={
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Cari nomor / keterangan / referensi..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 text-xs w-72 pl-7"
                />
              </div>
              <Button size="sm" className="h-8 text-xs" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />Buat Jurnal
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Lembaga</Label>
              <Select value={departemenId || "__all__"} onValueChange={(v) => setDepartemenId(v === "__all__" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Semua lembaga" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Semua Lembaga</SelectItem>
                  {lembagaList?.map((l: any) => (
                    <SelectItem key={l.id} value={l.id}>{l.kode} — {l.nama}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-penginput-jurnal" className="text-xs">Diinput Oleh</Label>
              <Select value={penginputId || "__all__"} onValueChange={(v) => setPenginputId(v === "__all__" ? "" : v)}>
                <SelectTrigger id="filter-penginput-jurnal" className="h-8 text-xs"><SelectValue placeholder="Semua Penginput" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Semua Penginput</SelectItem>
                  {penginputList?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.nama}</SelectItem>
                  ))}
                  <SelectItem value="__online__">Otomatis (Online Payment)</SelectItem>
                  <SelectItem value="__unknown__">Belum tercatat</SelectItem>
                </SelectContent>
              </Select>
              {penginputLoading && <p className="text-xs text-muted-foreground">Memuat nama penginput...</p>}
              {penginputError && <p className="text-xs text-destructive">Nama penginput gagal dimuat. Muat ulang halaman.</p>}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="semua">Semua Status</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="posted">Posted</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Akun</Label>
              <Select value={akunFilter || "__all__"} onValueChange={(v) => setAkunFilter(v === "__all__" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Semua akun" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="__all__">Semua Akun</SelectItem>
                  {akunList?.map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>{a.kode} — {a.nama}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={sembunyikanKoreksi}
                onChange={(e) => setSembunyikanKoreksi(e.target.checked)}
                className="h-4 w-4 rounded"
              />
              <span className="text-xs">Sembunyikan jurnal terkoreksi & pembaliknya</span>
            </label>
            <div className="space-y-1">
              <Label className="text-xs">Dari Tanggal</Label>
              <Input type="date" className="h-8 text-xs" value={tanggalDari} onChange={(e) => setTanggalDari(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sampai Tanggal</Label>
              <Input type="date" className="h-8 text-xs" value={tanggalSampai} onChange={(e) => setTanggalSampai(e.target.value)} />
            </div>
          </div>
        </FilterToolbar>
      </div>

      {/* Table — no Card wrapper */}
      <DataTable
        columns={columns}
        data={filteredJurnal}
        loading={isLoading}
        pageSize={20}
        searchable={false}
        exportable
        exportFilename={`jurnal-${tanggalDari || "awal"}-sd-${tanggalSampai || "akhir"}`}
      />

      {/* Form Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editId ? (
                <>
                  Edit Jurnal
                  {viewData?.nomor && (
                    <Badge variant="outline" className="font-mono">{viewData.nomor}</Badge>
                  )}
                  <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30">Draft</Badge>
                </>
              ) : "Buat Jurnal Baru"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div><Label>Tanggal</Label><Input type="date" value={tanggal} onChange={e => setTanggal(e.target.value)} /></div>
              <div>
                <div className="flex items-center justify-between">
                  <Label>Keterangan *</Label>
                  <button
                    type="button"
                    onClick={gabungKeterangan}
                    disabled={!details.some((d) => d.keterangan.trim())}
                    className="text-xs text-primary hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                  >
                    Gabung dari baris
                  </button>
                </div>
                <Input value={keterangan} onChange={e => setKeterangan(e.target.value)} placeholder="Keterangan jurnal" />
              </div>
              <div><Label>Referensi</Label><Input value={referensi} onChange={e => setReferensi(e.target.value)} placeholder="No. dokumen sumber" /></div>
              <div>
                <Label>Lembaga</Label>
                <Select value={formDepartemenId || "__all__"} onValueChange={(v) => setFormDepartemenId(v === "__all__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Semua lembaga" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Semua Lembaga</SelectItem>
                    {lembagaList?.map((l: any) => (
                      <SelectItem key={l.id} value={l.id}>{l.kode} — {l.nama}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="border rounded-md overflow-x-auto">
              <table className="w-full text-sm table-fixed">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left w-10">No</th>
                    <th className="p-2 text-left w-[200px]">Akun</th>
                    <th className="p-2 text-left w-[150px]">Keterangan</th>
                    <th className="p-2 text-right w-40">Debit (Rp)</th>
                    <th className="p-2 text-right w-40">Kredit (Rp)</th>
                    <th className="p-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {details.map((row, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2">{i + 1}</td>
                      <td className="p-2">
                        <AkunCombobox
                          value={row.akun_id}
                          onChange={(v) => updateRow(i, "akun_id", v)}
                          akunList={akunList || []}
                        />
                      </td>
                      <td className="p-2"><Input value={row.keterangan} onChange={e => updateRow(i, "keterangan", e.target.value)} placeholder="Ket. baris" /></td>
                      <td className="p-2"><RupiahInput value={row.debit ? String(row.debit) : ""} onChange={(raw) => updateRow(i, "debit", Number(raw) || 0)} /></td>
                      <td className="p-2"><RupiahInput value={row.kredit ? String(row.kredit) : ""} onChange={(raw) => updateRow(i, "kredit", Number(raw) || 0)} /></td>
                      <td className="p-2">
                        {details.length > 2 && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeRow(i)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t bg-muted/30 font-semibold">
                  <tr>
                    <td colSpan={3} className="p-2 text-right">Total</td>
                    <td className="p-2 text-right">{formatRupiah(totalDebit)}</td>
                    <td className="p-2 text-right">{formatRupiah(totalKredit)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {!isBalanced && totalDebit > 0 && (
              <p className="text-sm text-destructive font-medium">⚠ Total Debit dan Kredit harus sama (selisih: {formatRupiah(Math.abs(totalDebit - totalKredit))})</p>
            )}
            <Button variant="outline" size="sm" onClick={addRow}><Plus className="h-4 w-4 mr-2" />Tambah Baris</Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Batal</Button>
            <Button onClick={handleSave} disabled={!isBalanced || !keterangan || !tanggal}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={viewOpen} onOpenChange={v => { setViewOpen(v); if (!v) setViewId(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Detail Jurnal</DialogTitle></DialogHeader>
          {viewData && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div><span className="text-muted-foreground">Nomor:</span> <span className="font-medium">{viewData.nomor}</span></div>
                <div><span className="text-muted-foreground">Tanggal:</span> <span className="font-medium">{format(new Date(viewData.tanggal), "d MMMM yyyy", { locale: idLocale })}</span></div>
                <div><span className="text-muted-foreground">Status:</span> <Badge variant="outline" className={viewData.status === "posted" ? "bg-success/15 text-success border-success/30" : "bg-warning/15 text-warning border-warning/30"}>{viewData.status === "posted" ? "Posted" : "Draft"}</Badge></div>
                <div><span className="text-muted-foreground">Lembaga:</span> <span className="font-medium">{viewData.departemen?.kode || "-"}</span></div>
                <div><span className="text-muted-foreground">Diinput Oleh:</span> <span className="font-medium"><PenginputCell nama={(viewData as any).penginput?.nama} referensi={(viewData as any).referensi} /></span></div>
              </div>
              <div><span className="text-muted-foreground text-sm">Keterangan:</span> <p className="font-medium">{viewData.keterangan}</p></div>
              <div className="border rounded-md overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="p-2 text-left">Akun</th>
                      <th className="p-2 text-left">Keterangan</th>
                      <th className="p-2 text-right">Debit</th>
                      <th className="p-2 text-right">Kredit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewData.details?.map((d: any, i: number) => (
                      <tr key={i} className="border-t">
                        <td className="p-2">{d.akun_rekening?.kode} - {d.akun_rekening?.nama}</td>
                        <td className="p-2">{d.keterangan || "-"}</td>
                        <td className="p-2 text-right">{Number(d.debit) > 0 ? formatRupiah(Number(d.debit)) : "-"}</td>
                        <td className="p-2 text-right">{Number(d.kredit) > 0 ? formatRupiah(Number(d.kredit)) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t bg-muted/30 font-semibold">
                    <tr>
                      <td colSpan={2} className="p-2 text-right">Total</td>
                      <td className="p-2 text-right">{formatRupiah(Number(viewData.total_debit) || 0)}</td>
                      <td className="p-2 text-right">{formatRupiah(Number(viewData.total_kredit) || 0)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => printJurnal(viewData)}>
                  <Printer className="h-4 w-4 mr-2" />Print
                </Button>
                {viewData.status === "draft" && (
                  <Button onClick={() => { postMut.mutate(viewData.id); setViewOpen(false); setViewId(null); }}>
                    <Send className="h-4 w-4 mr-2" />Posting Jurnal
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)} title="Hapus Jurnal" description="Yakin ingin menghapus jurnal ini?" onConfirm={() => { if (deleteId) deleteMut.mutate(deleteId); setDeleteId(null); }} />
      <ConfirmDialog open={!!postId} onOpenChange={() => setPostId(null)} title="Posting Jurnal" description="Jurnal yang sudah diposting tidak bisa diedit lagi. Lanjutkan?" onConfirm={() => { if (postId) postMut.mutate(postId); setPostId(null); }} />

      {/* Dialog Jurnal Koreksi */}
      <Dialog open={koreksiOpen} onOpenChange={(v) => { setKoreksiOpen(v); if (!v) setKoreksiTarget(null); }}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-warning" />
              Buat Jurnal Koreksi
              {koreksiTarget?.nomor && (
                <Badge variant="outline" className="font-mono">{koreksiTarget.nomor}</Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Info jurnal asli */}
            <div className="rounded-md border border-warning/30 bg-warning/5 p-3 space-y-2">
              <p className="text-sm font-semibold text-warning">⚠ Jurnal Asli yang Akan Dikoreksi</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div><span className="text-muted-foreground">Nomor:</span> <span className="font-medium">{koreksiTarget?.nomor}</span></div>
                <div><span className="text-muted-foreground">Tanggal:</span> <span className="font-medium">{koreksiTarget?.tanggal ? format(new Date(koreksiTarget.tanggal), "d MMM yyyy", { locale: idLocale }) : "-"}</span></div>
                <div><span className="text-muted-foreground">Total:</span> <span className="font-medium">{formatRupiah(Number(koreksiTarget?.total_debit) || 0)}</span></div>
                <div><span className="text-muted-foreground">Lembaga:</span> <span className="font-medium">{koreksiTarget?.departemen?.kode || "-"}</span></div>
              </div>
              <p className="text-xs"><span className="text-muted-foreground">Keterangan:</span> <span className="font-medium">{koreksiTarget?.keterangan}</span></p>
            </div>

            {/* Preview detail jurnal asli */}
            {koreksiTargetDetail?.details && (
              <div className="space-y-2">
                <p className="text-sm font-semibold">Detail Jurnal Asli (akan dibalik debit↔kredit):</p>
                <div className="border rounded-md overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-2 text-left">Akun</th>
                        <th className="p-2 text-right">Debit Asli → Kredit Baru</th>
                        <th className="p-2 text-right">Kredit Asli → Debit Baru</th>
                      </tr>
                    </thead>
                    <tbody>
                      {koreksiTargetDetail.details.map((d: any, i: number) => (
                        <tr key={i} className="border-t">
                          <td className="p-2">{d.akun_rekening?.kode} - {d.akun_rekening?.nama}</td>
                          <td className="p-2 text-right">{Number(d.debit) > 0 ? formatRupiah(Number(d.debit)) : "-"}</td>
                          <td className="p-2 text-right">{Number(d.kredit) > 0 ? formatRupiah(Number(d.kredit)) : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Form koreksi */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Tanggal Koreksi *</Label>
                <Input type="date" value={tanggalKoreksi} onChange={(e) => setTanggalKoreksi(e.target.value)} />
              </div>
              <div>
                <Label>Alasan Koreksi *</Label>
                <Textarea
                  rows={2}
                  placeholder="Jelaskan alasan koreksi..."
                  value={alasanKoreksi}
                  onChange={(e) => setAlasanKoreksi(e.target.value)}
                />
              </div>
            </div>

            {/* Toggle jurnal pengganti */}
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={buatPengganti}
                onChange={(e) => {
                  setBuatPengganti(e.target.checked);
                  // Prefill dari jurnal asli supaya tidak perlu tulis ulang
                  if (
                    e.target.checked &&
                    koreksiTargetDetail?.details?.length &&
                    penggantiDetails.every((d) => !d.akun_id && !d.debit && !d.kredit)
                  ) {
                    setPenggantiDetails(
                      koreksiTargetDetail.details.map((d: any) => ({
                        akun_id: d.akun_id || "",
                        keterangan: d.keterangan || "",
                        debit: Number(d.debit) || 0,
                        kredit: Number(d.kredit) || 0,
                      }))
                    );
                  }
                }}
                className="h-4 w-4 rounded mt-0.5"
              />
              <span className="text-sm">
                Sekaligus buat jurnal pengganti yang benar
                <span className="text-muted-foreground ml-1">(opsional — bisa dibuat manual nanti)</span>
              </span>
            </label>

            {/* Form jurnal pengganti */}
            {buatPengganti && (
              <div className="rounded-md border bg-muted/20 p-3 space-y-3">
                <p className="text-sm font-semibold">Jurnal Pengganti (akan disimpan sebagai Draft)</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <Label>Tanggal Jurnal Pengganti *</Label>
                    <Input type="date" value={tanggalPengganti} onChange={(e) => setTanggalPengganti(e.target.value)} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <Label>Keterangan Jurnal Pengganti *</Label>
                      <button
                        type="button"
                        onClick={gabungPenggantiKeterangan}
                        disabled={!penggantiDetails.some((d) => d.keterangan.trim())}
                        className="text-xs text-primary hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                      >
                        Gabung dari baris
                      </button>
                    </div>
                    <Input value={penggantiKeterangan} onChange={(e) => setPenggantiKeterangan(e.target.value)} />
                  </div>
                  <div>
                    <Label>Referensi</Label>
                    <Input value={penggantiReferensi} onChange={(e) => setPenggantiReferensi(e.target.value)} />
                  </div>
                </div>
                <div className="border rounded-md overflow-x-auto bg-background">
                  <table className="w-full text-sm table-fixed">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-2 text-left w-10">No</th>
                        <th className="p-2 text-left w-[200px]">Akun</th>
                        <th className="p-2 text-left w-[150px]">Keterangan</th>
                        <th className="p-2 text-right w-36">Debit (Rp)</th>
                        <th className="p-2 text-right w-36">Kredit (Rp)</th>
                        <th className="p-2 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {penggantiDetails.map((row, i) => (
                        <tr key={i} className="border-t">
                          <td className="p-2">{i + 1}</td>
                          <td className="p-2">
                            <AkunCombobox
                              value={row.akun_id}
                              onChange={(v) => updatePenggantiRow(i, "akun_id", v)}
                              akunList={akunList || []}
                            />
                          </td>
                          <td className="p-2">
                            <Input value={row.keterangan} onChange={(e) => updatePenggantiRow(i, "keterangan", e.target.value)} placeholder="Ket. baris" />
                          </td>
                          <td className="p-2">
                            <RupiahInput value={row.debit ? String(row.debit) : ""} onChange={(raw) => updatePenggantiRow(i, "debit", Number(raw) || 0)} />
                          </td>
                          <td className="p-2">
                            <RupiahInput value={row.kredit ? String(row.kredit) : ""} onChange={(raw) => updatePenggantiRow(i, "kredit", Number(raw) || 0)} />
                          </td>
                          <td className="p-2">
                            {penggantiDetails.length > 2 && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removePenggantiRow(i)}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t bg-muted/30 font-semibold">
                      <tr>
                        <td colSpan={3} className="p-2 text-right">Total</td>
                        <td className="p-2 text-right">{formatRupiah(totalPenggantiDebit)}</td>
                        <td className="p-2 text-right">{formatRupiah(totalPenggantiKredit)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {!isPenggantiBalanced && totalPenggantiDebit > 0 && (
                  <p className="text-sm text-destructive font-medium">
                    ⚠ Total Debit dan Kredit harus sama (selisih: {formatRupiah(Math.abs(totalPenggantiDebit - totalPenggantiKredit))})
                  </p>
                )}
                <Button variant="outline" size="sm" onClick={addPenggantiRow}>
                  <Plus className="h-4 w-4 mr-2" />Tambah Baris
                </Button>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setKoreksiOpen(false); setKoreksiTarget(null); }}>
              Batal
            </Button>
            <Button
              onClick={handleKoreksi}
              disabled={
                !alasanKoreksi.trim() ||
                koreksiMut.isPending ||
                (buatPengganti && (!isPenggantiBalanced || !tanggalPengganti))
              }
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              {koreksiMut.isPending ? "Memproses..." : "Buat Jurnal Koreksi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
