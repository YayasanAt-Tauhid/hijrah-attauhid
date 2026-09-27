import { useState, useMemo, useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FilterToolbar, ActiveFilter } from "@/components/shared/FilterToolbar";
import { useJenisPembayaran, useLembaga, useTahunBukuAktif, useTahunBuku, formatRupiah, namaBulan, BULAN_ORDER_AKADEMIK } from "@/hooks/useKeuangan";
import { useKelas } from "@/hooks/useAkademikData";
import { prosesPembayaran } from "@/server/pembayaran";
import { rekapTunggakanBatch } from "@/server/tunggakan";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router-compat";
import { AlertTriangle, Users, X, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function TunggakanPembayaran() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [departemenId, setDepartemenId] = useState<string>("");
  const [kelasId, setKelasId] = useState<string>("");
  const [jenisId, setJenisId] = useState<string>("");
  const [bulanDari, setBulanDari] = useState("7");
  const [bulanSampai, setBulanSampai] = useState("6");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);
  const [isBulkPaying, setIsBulkPaying] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [tahunAjaranId, setTahunAjaranId] = useState<string>("");

  const { data: lembagaList } = useLembaga();
  const { data: tahunAjaranList } = useTahunBuku();
  const { data: tahunAjaranAktif } = useTahunBukuAktif();

  // Auto-select active tahun ajaran
  useEffect(() => {
    if (tahunAjaranAktif?.id && !tahunAjaranId) {
      setTahunAjaranId(tahunAjaranAktif.id);
    }
  }, [tahunAjaranAktif]);
  const { data: jenisList } = useJenisPembayaran(departemenId || undefined);
  const { data: kelasList } = useKelas();

  const filteredKelas = useMemo(() => {
    if (!kelasList) return [];
    if (!departemenId) return kelasList;
    return kelasList.filter((k: any) => k.departemen_id === departemenId);
  }, [kelasList, departemenId]);

  const selectedJenis = jenisList?.find((j: any) => j.id === jenisId);
  const isSekaliBayar = (selectedJenis as any)?.tipe === "sekali";

  // Rentang bulan yang dicek (mendukung wrap-around, mis. 7→6), hanya
  // relevan untuk jenis tipe bulanan -- tagihan tipe sekali tidak punya bulan.
  const bulanRange = useMemo(() => {
    if (isSekaliBayar) return undefined;
    const dari = Number(bulanDari);
    const sampai = Number(bulanSampai);
    const range: number[] = [];
    if (dari <= sampai) {
      for (let b = dari; b <= sampai; b++) range.push(b);
    } else {
      for (let b = dari; b <= 12; b++) range.push(b);
      for (let b = 1; b <= sampai; b++) range.push(b);
    }
    return range;
  }, [isSekaliBayar, bulanDari, bulanSampai]);

  const { data: tunggakanData, isLoading } = useQuery({
    queryKey: ["tunggakan", departemenId, kelasId, jenisId, tahunAjaranId, bulanRange],
    enabled: !!jenisId && !!tahunAjaranId,
    queryFn: async () => {
      const res = await rekapTunggakanBatch({
        data: {
          jenis_id: jenisId,
          tahun_ajaran_id: tahunAjaranId,
          kelas_id: kelasId || undefined,
          departemen_id: departemenId || undefined,
          bulan_list: bulanRange,
        },
      });
      return res.rows.map((r) => ({
        id: r.siswa_id,
        nis: r.nis || "-",
        nama: r.nama || "-",
        kelas: r.kelas || "-",
        bulan_tunggak: isSekaliBayar ? "Sekali Bayar" : r.bulan_tunggak.map(namaBulan).join(", "),
        bulan_tunggak_arr: r.bulan_tunggak,
        tagihan_tunggak: r.tagihan_tunggak,
        jumlah_bulan: r.bulan_tunggak.length,
        total: r.total,
      }));
    },
  });

  const totalSiswa = tunggakanData?.length || 0;
  const totalNominal = tunggakanData?.reduce((s, r) => s + r.total, 0) || 0;

  const selectedRows = tunggakanData?.filter((r) => selectedIds.has(r.id)) || [];
  const selectedTotal = selectedRows.reduce((s, r) => s + r.total, 0);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!tunggakanData) return;
    if (selectedIds.size === tunggakanData.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tunggakanData.map((r) => r.id)));
    }
  };

  const handleBulkPay = async () => {
    if (!selectedRows.length || !jenisId || !tahunAjaranId) return;
    setIsBulkPaying(true);

    // Hitung total transaksi (bisa lebih dari jumlah siswa karena multi-bulan)
    const allTx = selectedRows.flatMap((sr) =>
      sr.tagihan_tunggak.map((t) => ({
        siswaId: sr.id,
        bulan: t.bulan,
        tagihanId: t.tagihan_id,
        sisa: t.sisa,
      }))
    );
    setBulkProgress({ done: 0, total: allTx.length });

    const today = new Date().toISOString().split("T")[0];
    let berhasil = 0;
    const gagalList: string[] = [];

    for (let i = 0; i < allTx.length; i++) {
      const tx = allTx[i];
      try {
        await prosesPembayaran({
          data: {
            siswa_id: tx.siswaId,
            jenis_id: jenisId,
            bulan: tx.bulan,
            // Server memvalidasi nominal dari tagihan yang dipilih.
            jumlah: tx.sisa,
            tagihan_id: tx.tagihanId,
            tanggal_bayar: today,
            departemen_id: departemenId || undefined,
            tahun_ajaran_id: tahunAjaranId,
            is_bayar_dimuka: false,
          },
        });
        berhasil++;
      } catch (e: any) {
        const namaRow = selectedRows.find((r) => r.id === tx.siswaId)?.nama ?? tx.siswaId;
        gagalList.push(`${namaRow}: ${e.message}`);
      }
      setBulkProgress({ done: i + 1, total: allTx.length });
    }

    // Invalidate semua cache yang relevan
    queryClient.invalidateQueries({ queryKey: ["tunggakan"] });
    queryClient.invalidateQueries({ queryKey: ["pembayaran"] });
    queryClient.invalidateQueries({ queryKey: ["tagihan"] });
    queryClient.invalidateQueries({ queryKey: ["jurnal"] });

    if (berhasil > 0 && gagalList.length === 0) {
      toast.success(`${berhasil} pembayaran berhasil — jurnal & tagihan terupdate otomatis`);
    } else if (berhasil > 0) {
      toast.success(`${berhasil} berhasil`);
      toast.error(`${gagalList.length} gagal:\n${gagalList.slice(0, 3).join("\n")}${gagalList.length > 3 ? `\n…dan ${gagalList.length - 3} lainnya` : ""}`);
    } else {
      toast.error(`Semua pembayaran gagal. Cek koneksi atau konfigurasi akun.`);
    }

    setSelectedIds(new Set());
    setBulkProgress(null);
    setIsBulkPaying(false);
    setShowConfirm(false);
  };

  // Build active filters for badge display
  const lembagaNama = lembagaList?.find((l: any) => l.id === departemenId);
  const kelasNama = filteredKelas?.find((k: any) => k.id === kelasId);
  const jenisNama = jenisList?.find((j: any) => j.id === jenisId);
  const tahunAjaranNama = tahunAjaranList?.find((t: any) => t.id === tahunAjaranId);

  const activeFilters: ActiveFilter[] = [
    ...(tahunAjaranId ? [{
      key: "tahun", label: "Tahun Ajaran", value: tahunAjaranNama?.nama || tahunAjaranId,
      onClear: () => setTahunAjaranId(""),
    }] : []),
    ...(departemenId ? [{
      key: "lembaga", label: "Lembaga", value: lembagaNama?.kode || lembagaNama?.nama || departemenId,
      onClear: () => { setDepartemenId(""); setJenisId(""); setKelasId(""); setSelectedIds(new Set()); },
    }] : []),
    ...(jenisId ? [{
      key: "jenis", label: "Jenis", value: jenisNama?.nama || jenisId,
      onClear: () => { setJenisId(""); setSelectedIds(new Set()); },
    }] : []),
    ...(kelasId ? [{
      key: "kelas", label: "Kelas", value: kelasNama?.nama || kelasId,
      onClear: () => setKelasId(""),
    }] : []),
    ...(!isSekaliBayar && jenisId ? [{
      key: "periode", label: "Periode", value: `${namaBulan(Number(bulanDari)).slice(0, 3)}–${namaBulan(Number(bulanSampai)).slice(0, 3)}`,
      onClear: () => { setBulanDari("7"); setBulanSampai("6"); },
    }] : []),
  ];

  const columns: DataTableColumn<any>[] = [
    {
      key: "_select", label: "", className: "w-10",
      render: (_, r) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={selectedIds.has(r.id as string)} onCheckedChange={() => toggleSelect(r.id as string)} />
        </div>
      ),
    },
    { key: "nis", label: "NIS", sortable: true },
    { key: "nama", label: "Nama Siswa", sortable: true },
    { key: "kelas", label: "Kelas" },
    { key: "bulan_tunggak", label: isSekaliBayar ? "Tipe" : "Bulan Tunggak" },
    ...(!isSekaliBayar ? [{ key: "jumlah_bulan", label: "Jml Bulan" }] : []),
    { key: "total", label: "Total Tunggakan", render: (v: unknown) => formatRupiah(Number(v)) },
  ];

  return (
    <div className="space-y-0 animate-fade-in">
      {/* Header + Stats inline */}
      <div className="flex items-center justify-between gap-4 mb-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Tunggakan Pembayaran</h1>
          <p className="text-xs text-muted-foreground">Laporan siswa yang belum membayar</p>
        </div>
        {jenisId && tunggakanData && (
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Badge variant="secondary" className="gap-1.5 py-1 px-2.5 text-xs font-medium">
              <Users className="h-3 w-3" />
              {totalSiswa} siswa
            </Badge>
            <Badge variant="destructive" className="gap-1.5 py-1 px-2.5 text-xs font-medium">
              <AlertTriangle className="h-3 w-3" />
              {formatRupiah(totalNominal)}
            </Badge>
          </div>
        )}
      </div>

      {/* Filter toolbar with popover */}
      <div className="border-b border-border pb-3 mb-4">
        <FilterToolbar activeFilters={activeFilters}>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Lembaga</Label>
              <Select value={departemenId || "__all__"} onValueChange={(v) => {
                setDepartemenId(v === "__all__" ? "" : v);
                setJenisId(""); setKelasId(""); setSelectedIds(new Set());
              }}>
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
              <Label className="text-xs">Tahun Ajaran</Label>
              <Select value={tahunAjaranId} onValueChange={(v) => { setTahunAjaranId(v); setSelectedIds(new Set()); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pilih tahun ajaran" /></SelectTrigger>
                <SelectContent>
                  {tahunAjaranList?.map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>{t.nama}{t.aktif ? " (Aktif)" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Jenis Pembayaran</Label>
              <Select value={jenisId} onValueChange={(v) => { setJenisId(v); setSelectedIds(new Set()); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pilih jenis" /></SelectTrigger>
                <SelectContent>
                  {jenisList?.map((j: any) => <SelectItem key={j.id} value={j.id}>{j.nama}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Kelas</Label>
              <Select value={kelasId || "__all__"} onValueChange={(v) => setKelasId(v === "__all__" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Semua" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Semua</SelectItem>
                  {filteredKelas?.map((k: any) => <SelectItem key={k.id} value={k.id}>{k.nama}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {!isSekaliBayar && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Bulan Dari</Label>
                  <Select value={bulanDari} onValueChange={setBulanDari}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {BULAN_ORDER_AKADEMIK.map((m) => (
                        <SelectItem key={m} value={String(m)}>{namaBulan(m)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Bulan Sampai</Label>
                  <Select value={bulanSampai} onValueChange={setBulanSampai}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {BULAN_ORDER_AKADEMIK.map((m) => (
                        <SelectItem key={m} value={String(m)}>{namaBulan(m)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        </FilterToolbar>
      </div>

      {/* Table */}
      {!jenisId ? (
        <p className="text-sm text-muted-foreground text-center py-12">Pilih jenis pembayaran dari menu Filter untuk melihat tunggakan</p>
      ) : (
        <>
          {tunggakanData && tunggakanData.length > 0 && (
            <div className="flex items-center gap-2 mb-2">
              <Checkbox checked={tunggakanData.length > 0 && selectedIds.size === tunggakanData.length} onCheckedChange={toggleAll} />
              <span className="text-xs text-muted-foreground">Pilih Semua</span>
            </div>
          )}
          <DataTable
            columns={columns}
            data={tunggakanData || []}
            loading={isLoading}
            exportable
            exportFilename="tunggakan-pembayaran"
            pageSize={20}
            onRowClick={(row) => navigate(`/keuangan/pembayaran?siswa=${row.id}`)}
          />
        </>
      )}

      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-card border shadow-xl rounded-xl px-6 py-3 flex items-center gap-4 animate-fade-in">
          {isBulkPaying && bulkProgress ? (
            <div className="flex items-center gap-3 min-w-[280px]">
              <span className="text-sm font-medium shrink-0">
                Memproses {bulkProgress.done}/{bulkProgress.total}…
              </span>
              <Progress value={Math.round((bulkProgress.done / bulkProgress.total) * 100)} className="flex-1 h-2" />
            </div>
          ) : (
            <>
              <span className="text-sm font-medium">
                {selectedIds.size} siswa dipilih — Total: <span className="text-primary font-bold">{formatRupiah(selectedTotal)}</span>
              </span>
              <Button size="sm" onClick={() => setShowConfirm(true)} disabled={isBulkPaying}>
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                Bayar Sekarang
              </Button>
              <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set())} disabled={isBulkPaying}>
                <X className="h-4 w-4 mr-1" />Batal
              </Button>
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={showConfirm}
        onOpenChange={setShowConfirm}
        title="Konfirmasi Pembayaran Massal"
        description={`Akan memproses pembayaran untuk ${selectedRows.length} siswa (${selectedRows.reduce((s, r) => s + r.bulan_tunggak_arr.length, 0)} transaksi).\nTotal: ${formatRupiah(selectedTotal)}\n\nJurnal otomatis akan dibuat dan tagihan diupdate via Edge Function.`}
        confirmLabel="Konfirmasi & Proses"
        onConfirm={handleBulkPay}
        loading={isBulkPaying}
        variant="default"
      />
    </div>
  );
}
