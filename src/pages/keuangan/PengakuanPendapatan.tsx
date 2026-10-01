import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useTahunBuku, formatRupiah, namaBulanTahun } from "@/hooks/useKeuangan";
import { akuiPendapatanDimuka } from "@/server/akrual";
import { recognitionDueDate, canRecognizeRevenue } from "@/lib/recognitionDate";
import { toast } from "sonner";
import { CheckCircle, ArrowRight, AlertTriangle, Clock } from "lucide-react";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";

type RevenueAdvanceRow = {
  id: string;
  status: string;
  bulan: number | null;
  jumlah: number;
  pembayaran_id: string;
  tanggal_pengakuan: string | null;
  siswa: { nama: string; nis: string | null } | null;
  jenis: { nama: string; tipe: string; hari_jatuh_tempo: number | null } | null;
  tahun_pembayaran: { nama: string } | null;
  tahun_target: { nama: string; tanggal_mulai: string } | null;
  pembayaran: {
    tagihan: {
      jatuh_tempo: string | null;
      tanggal_pengakuan: string | null;
      tahun_akademik: { nama: string } | null;
    } | null;
  } | null;
};

export default function PengakuanPendapatan() {
  const [filterTahunTarget, setFilterTahunTarget] = useState("");
  const [confirmRecognize, setConfirmRecognize] = useState<string | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const qc = useQueryClient();

  const { data: tahunBukuList } = useTahunBuku();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());

  const { data: dimukaList, isLoading } = useQuery({
    queryKey: ["pendapatan_dimuka", filterTahunTarget],
    queryFn: async () => {
      let q = supabase
        .from("pendapatan_dimuka")
        .select(`
          *,
          siswa:siswa_id(id, nama, nis),
          jenis:jenis_id(id, nama, tipe, hari_jatuh_tempo),
          tahun_pembayaran:tahun_ajaran_pembayaran_id(id, nama),
          tahun_target:tahun_ajaran_target_id(id, nama, tanggal_mulai),
          pembayaran:pembayaran_id(id, tanggal_bayar, jumlah, tagihan:tagihan_id(jatuh_tempo, tanggal_pengakuan, tahun_akademik:tahun_akademik_id(nama)))
        `)
        .order("created_at", { ascending: false });

      if (filterTahunTarget) {
        q = q.eq("tahun_ajaran_target_id", filterTahunTarget);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as RevenueAdvanceRow[];
    },
  });

  const pendingItems = dimukaList?.filter((d: RevenueAdvanceRow) => d.status === "pending") || [];
  const diakuiItems = dimukaList?.filter((d: RevenueAdvanceRow) => d.status === "diakui") || [];
  const totalPending = pendingItems.reduce((s: number, d: RevenueAdvanceRow) => s + Number(d.jumlah || 0), 0);
  const totalDiakui = diakuiItems.reduce((s: number, d: RevenueAdvanceRow) => s + Number(d.jumlah || 0), 0);

  const recognizeMutation = useMutation({
    mutationFn: async (dimukaId: string) => {
      const item = dimukaList?.find((d: RevenueAdvanceRow) => d.id === dimukaId);
      if (!item) throw new Error("Data tidak ditemukan");

      await akuiPendapatanDimuka({ data: { id: dimukaId } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pendapatan_dimuka"] });
      qc.invalidateQueries({ queryKey: ["jurnal"] });
      toast.success("Pendapatan berhasil diakui");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dueFor = (item: RevenueAdvanceRow) => recognitionDueDate({
    billRecognitionDate: item.pembayaran?.tagihan?.tanggal_pengakuan,
    paymentName: item.jenis?.nama,
    paymentType: item.jenis?.tipe,
    billDueDate: item.pembayaran?.tagihan?.jatuh_tempo,
    targetBookStart: item.tahun_target?.tanggal_mulai,
    month: item.bulan,
    dueDay: item.jenis?.hari_jatuh_tempo,
  });
  const readyItems = pendingItems.filter((item: RevenueAdvanceRow) => canRecognizeRevenue(dueFor(item), today));

  const bulkRecognizeMutation = useMutation({
    mutationFn: async () => {
      if (!readyItems.length) throw new Error("Belum ada pendapatan yang mencapai tanggal pengakuan.");
      for (const item of readyItems) {
        await akuiPendapatanDimuka({ data: { id: item.id } });
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["pendapatan_dimuka"] });
      qc.invalidateQueries({ queryKey: ["jurnal"] });
    },
    onSuccess: () => toast.success("Pendapatan yang sudah mencapai tanggal pengakuan berhasil diakui"),
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: DataTableColumn<RevenueAdvanceRow>[] = [
    {
      key: "siswa",
      label: "Siswa",
      render: (_, r) => (
        <div>
          <p className="font-medium text-sm">{r.siswa?.nama || "-"}</p>
          <p className="text-xs text-muted-foreground">NIS: {r.siswa?.nis || "-"}</p>
        </div>
      ),
    },
    { key: "jenis", label: "Jenis", render: (_, r) => r.jenis?.nama || "-" },
    { key: "bulan", label: "Bulan", render: (v, r) => v ? namaBulanTahun(v as number, { tahunBukuNama: r.tahun_target?.nama }) : "-" },
    { key: "jumlah", label: "Jumlah", render: (v) => formatRupiah(Number(v)) },
    {
      key: "tahun_pembayaran",
      label: "Tahun Buku Penerimaan",
      render: (_, r) => <Badge variant="outline">{r.tahun_pembayaran?.nama || "-"}</Badge>,
    },
    {
      key: "tahun_target",
      label: "Tahun Buku Target",
      render: (_, r) => <Badge variant="secondary">{r.tahun_target?.nama || "-"}</Badge>,
    },
    {
      key: "tahun_akademik",
      label: "Tahun Ajaran",
      render: (_, r) => r.pembayaran?.tagihan?.tahun_akademik?.nama || "-",
    },
    {
      key: "jadwal_pengakuan",
      label: "Dapat Diakui Mulai",
      render: (_, r) => {
        const due = dueFor(r);
        return due ? format(new Date(due + "T00:00:00"), "dd MMM yyyy", { locale: idLocale }) : "Belum ditentukan";
      },
    },
    {
      key: "status",
      label: "Status",
      render: (v) =>
        v === "diakui" ? (
          <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
            <CheckCircle className="h-3 w-3 mr-1" /> Diakui
          </Badge>
        ) : (
          <Badge variant="outline" className="text-amber-600 border-amber-300">
            <Clock className="h-3 w-3 mr-1" /> Pending
          </Badge>
        ),
    },
    {
      key: "tanggal_pengakuan",
      label: "Tgl Pengakuan",
      render: (v) => v ? format(new Date(v as string), "dd MMM yyyy", { locale: idLocale }) : "-",
    },
    {
      key: "aksi",
      label: "Aksi",
      render: (_, r) => {
        const row = r;
        if (row.status === "diakui") return <span className="text-xs text-muted-foreground">Selesai</span>;
        return (
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => { e.stopPropagation(); setConfirmRecognize(row.id); }}
            disabled={recognizeMutation.isPending || !canRecognizeRevenue(dueFor(row), today)}
          >
            <ArrowRight className="h-3 w-3 mr-1" />
            Akui
          </Button>
        );
      },
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Pengakuan Pendapatan</h1>
        <p className="text-sm text-muted-foreground">
          SPP diakui penuh pada akhir bulan layanan. Jatuh tempo pembayaran tetap mengikuti batas pembayaran yang ditetapkan.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-100 dark:bg-amber-900 flex items-center justify-center">
                <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pending Pengakuan</p>
                <p className="text-lg font-bold">{formatRupiah(totalPending)}</p>
                <p className="text-xs text-muted-foreground">{pendingItems.length} item</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center">
                <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Sudah Diakui</p>
                <p className="text-lg font-bold">{formatRupiah(totalDiakui)}</p>
                <p className="text-xs text-muted-foreground">{diakuiItems.length} item</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center justify-center">
            <Button
              onClick={() => setConfirmBulk(true)}
              disabled={!readyItems.length || bulkRecognizeMutation.isPending}
              className="w-full"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Akui Semua yang Siap
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Alert */}
      {readyItems.length > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 p-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Ada <strong>{readyItems.length}</strong> pembayaran di muka yang sudah mencapai tanggal pengakuan dan siap diakui sebagai pendapatan.
          </p>
        </div>
      )}

      {/* Filter + Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Daftar Pendapatan Diterima di Muka</CardTitle>
            <Select value={filterTahunTarget || "__all__"} onValueChange={(v) => setFilterTahunTarget(v === "__all__" ? "" : v)}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Filter Tahun Buku target" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Semua Tahun Buku</SelectItem>
                {tahunBukuList?.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.nama} {t.aktif ? "(Aktif)" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={dimukaList || []} loading={isLoading} pageSize={20} />
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!confirmRecognize}
        onOpenChange={() => setConfirmRecognize(null)}
        title="Akui Pendapatan"
        description="Pendapatan diterima di muka ini akan diakui sebagai pendapatan sesungguhnya. Jurnal penyesuaian akan dibuat otomatis (Debit: Pend. Diterima di Muka, Kredit: Pendapatan). Lanjutkan?"
        onConfirm={() => {
          if (confirmRecognize) recognizeMutation.mutate(confirmRecognize);
          setConfirmRecognize(null);
        }}
      />

      <ConfirmDialog
        open={confirmBulk}
        onOpenChange={() => setConfirmBulk(false)}
        title="Akui Semua Pendapatan yang Siap"
        description={`Semua pendapatan di muka yang sudah mencapai tanggal pengakuan (${readyItems.length} item, total ${formatRupiah(readyItems.reduce((s: number, d: RevenueAdvanceRow) => s + Number(d.jumlah || 0), 0))}) akan diakui. Lanjutkan?`}
        onConfirm={() => {
          bulkRecognizeMutation.mutate();
          setConfirmBulk(false);
        }}
      />
    </div>
  );
}
