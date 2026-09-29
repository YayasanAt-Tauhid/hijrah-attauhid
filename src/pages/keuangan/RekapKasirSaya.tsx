import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { GraduationCap, Printer, ReceiptText, Users, Wallet } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import Unauthorized from "@/pages/Unauthorized";
import { getRekapKasirSaya, type RekapKasirSayaRow } from "@/server/pembayaran";
import { formatRupiah } from "@/hooks/useKeuangan";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { StatsCard } from "@/components/shared/StatsCard";
import { PrintKuitansi } from "@/components/shared/PrintKuitansi";
import { Skeleton } from "@/components/ui/skeleton";

export default function RekapKasirSaya() {
  const { role } = useAuth();
  if (!role || !["admin", "keuangan", "kasir"].includes(role)) {
    return <Unauthorized />;
  }
  return <RekapKasirSayaContent />;
}

function RekapKasirSayaContent() {
  const [tanggal, setTanggal] = useState(format(new Date(), "yyyy-MM-dd"));
  const [printRow, setPrintRow] = useState<RekapKasirSayaRow | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["rekap_kasir_saya", tanggal],
    queryFn: async () => getRekapKasirSaya({ data: { tanggal } }),
  });

  const columns: DataTableColumn<RekapKasirSayaRow>[] = [
    {
      key: "siswa_nama",
      label: "Siswa / Calon Murid",
      render: (_, row) => (
        <div>
          <p className="font-medium">{row.siswa_nama}</p>
          <p className="text-xs text-muted-foreground">{[row.siswa_nis, row.siswa_nisn].filter(Boolean).join(" / ") || "Belum memiliki NIS/NISN"}</p>
        </div>
      ),
    },
    {
      key: "siswa_status",
      label: "Konteks",
      render: (_, row) => row.siswa_status === "calon" ? "SPMB" : "Siswa",
    },
    { key: "jenis_nama", label: "Jenis Pembayaran" },
    {
      key: "departemen_nama",
      label: "Lembaga",
      render: (_, row) => row.departemen_kode ? row.departemen_kode + " — " + row.departemen_nama : row.departemen_nama,
    },
    { key: "jumlah", label: "Jumlah", render: (value) => formatRupiah(Number(value || 0)) },
    { key: "jurnal_nomor", label: "No. Jurnal", render: (value) => (value as string) || "-" },
    { key: "keterangan", label: "Keterangan", render: (value) => (value as string) || "-" },
    {
      key: "aksi",
      label: "Aksi",
      render: (_, row) => (
        <Button variant="outline" size="sm" onClick={() => setPrintRow(row)}>
          <Printer className="mr-1.5 h-4 w-4" />
          Cetak Kuitansi
        </Button>
      ),
    },
  ];

  const tanggalLabel = format(new Date(tanggal + "T00:00:00"), "EEEE, dd MMMM yyyy", { locale: idLocale });

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Rekap Kasir Saya</h1>
        <p className="text-sm text-muted-foreground">
          Hanya menampilkan transaksi loket yang dicatat oleh akun petugas yang sedang login.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <Label>Tanggal</Label>
              <Input
                type="date"
                value={tanggal}
                onChange={(event) => setTanggal(event.target.value)}
                className="w-44"
              />
            </div>
            <div className="text-sm text-muted-foreground">
              <p>{tanggalLabel}</p>
              {data?.petugas_nama && <p>Petugas: <span className="font-medium text-foreground">{data.petugas_nama}</span></p>}
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm text-destructive">
            {error instanceof Error ? error.message : "Gagal mengambil rekap kasir."}
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-24" />)}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard title="Total Penerimaan" value={formatRupiah(data?.total_penerimaan || 0)} icon={Wallet} color="success" />
          <StatsCard title="Jumlah Transaksi" value={String(data?.jumlah_transaksi || 0)} icon={ReceiptText} color="primary" />
          <StatsCard title="Pembayaran Siswa" value={String(data?.transaksi_siswa || 0)} icon={Users} color="info" />
          <StatsCard title="Pembayaran SPMB" value={String(data?.transaksi_spmb || 0)} icon={GraduationCap} color="primary" />
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={data?.items || []}
            loading={isLoading}
            searchable={false}
            exportable
            exportFilename={"rekap-kasir-saya-" + tanggal}
            pageSize={20}
            emptyMessage="Belum ada transaksi yang Anda catat pada tanggal ini."
          />
        </CardContent>
      </Card>

      {printRow && (
        <Dialog open={!!printRow} onOpenChange={(open) => !open && setPrintRow(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Cetak Ulang Kuitansi</DialogTitle>
            </DialogHeader>
            <div className="space-y-1 text-sm">
              <p>{printRow.siswa_nama}</p>
              <p className="font-semibold">{formatRupiah(printRow.jumlah)}</p>
              {printRow.jurnal_nomor && <p className="font-mono text-xs">{printRow.jurnal_nomor}</p>}
            </div>
            <PrintKuitansi
              payment={{
                id: printRow.id,
                nomorJurnal: printRow.jurnal_nomor || undefined,
                jumlah: printRow.jumlah,
                bulan: printRow.bulan || 0,
                tanggal_bayar: printRow.tanggal_bayar || tanggal,
                keterangan: printRow.keterangan || undefined,
                jenisNama: printRow.jenis_nama,
                siswa: {
                  nama: printRow.siswa_nama,
                  nis: printRow.siswa_nis || undefined,
                  nisn: printRow.siswa_nisn || undefined,
                },
              }}
              kelasNama={printRow.siswa_status === "calon" ? "Calon Murid" : printRow.kelas_nama || "-"}
              lembagaNama={printRow.departemen_nama}
              petugasNama={data?.petugas_nama || undefined}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setPrintRow(null)}>Tutup</Button>
              <Button onClick={() => window.print()}>
                <Printer className="mr-1.5 h-4 w-4" />
                Cetak Kuitansi
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
