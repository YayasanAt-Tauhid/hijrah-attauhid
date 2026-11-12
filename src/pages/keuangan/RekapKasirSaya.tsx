import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { FileSpreadsheet, GraduationCap, Loader2, Printer, ReceiptText, Users, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import Unauthorized from "@/pages/Unauthorized";
import { getPaymentReceiptGroups, getRekapKasirSaya, type RekapKasirSayaRow } from "@/server/pembayaran";
import { formatRupiah } from "@/hooks/useKeuangan";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { StatsCard } from "@/components/shared/StatsCard";
import { PrintKuitansi } from "@/components/shared/PrintKuitansi";
import { PrintKuitansiGabungan } from "@/components/shared/PrintKuitansiGabungan";
import { ReceiptOrientationSelect, type ReceiptPrintOrientation } from "@/components/shared/ReceiptOrientationSelect";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  SEMUA_LEMBAGA,
  filterByLembaga,
  hitungStatistikRekap,
  labelLembagaFilter,
  listLembaga,
  resolveLembagaFilter,
} from "@/lib/rekapKasirLembaga";
import { parseRekapKasirRange, REKAP_KASIR_MAX_HARI } from "@/lib/rekapKasirRange";
import { unduhRekapKasirExcel } from "@/lib/rekapKasirDownload";
import { CetakRekapKasir } from "@/components/keuangan/CetakRekapKasir";

export default function RekapKasirSaya() {
  const { role, can, permissionsLoading } = useAuth();
  if (permissionsLoading) return null;
  if (!role || !can("keuangan.rekap_kasir")) {
    return <Unauthorized />;
  }
  return <RekapKasirSayaContent />;
}

function RekapKasirSayaContent() {
  const hariIni = format(new Date(), "yyyy-MM-dd");
  const [tanggalDari, setTanggalDari] = useState(hariIni);
  const [tanggalSampai, setTanggalSampai] = useState(hariIni);
  const [lembagaFilter, setLembagaFilter] = useState<string>(SEMUA_LEMBAGA);
  const [mengunduh, setMengunduh] = useState(false);
  const [mencetak, setMencetak] = useState(false);
  const sudahDicetak = useRef(false);
  const [printRow, setPrintRow] = useState<RekapKasirSayaRow | null>(null);
  const [kuitansiOrientation, setKuitansiOrientation] = useState<ReceiptPrintOrientation>("landscape");

  const rangeError = useMemo(() => {
    try {
      parseRekapKasirRange({ tanggal_dari: tanggalDari, tanggal_sampai: tanggalSampai });
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Periode tidak valid";
    }
  }, [tanggalDari, tanggalSampai]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["rekap_kasir_saya", tanggalDari, tanggalSampai],
    enabled: !rangeError,
    queryFn: async () => getRekapKasirSaya({ data: { tanggal_dari: tanggalDari, tanggal_sampai: tanggalSampai } }),
  });

  // Filter lembaga dijalankan di klien: setiap transaksi sudah membawa lembaganya.
  // Tabel, statistik, cetak/PDF, dan Excel semuanya memakai baris terfilter yang sama.
  const semuaItems = useMemo(() => data?.items ?? [], [data]);
  const opsiLembaga = useMemo(() => listLembaga(semuaItems), [semuaItems]);
  const lembagaAktif = resolveLembagaFilter(semuaItems, lembagaFilter);
  const itemsTerfilter = useMemo(() => filterByLembaga(semuaItems, lembagaAktif), [semuaItems, lembagaAktif]);
  const lembagaLabel = labelLembagaFilter(semuaItems, lembagaAktif);
  const statistik = useMemo(() => hitungStatistikRekap(itemsTerfilter), [itemsTerfilter]);

  // Cetak / PDF: render laporan cetak, tunggu logo termuat (maks. 2 detik),
  // lalu buka dialog cetak browser (pilih printer atau "Simpan sebagai PDF").
  const cetakSekarang = useCallback(() => {
    if (sudahDicetak.current) return;
    sudahDicetak.current = true;
    window.print();
  }, []);

  useEffect(() => {
    if (!mencetak) return;
    sudahDicetak.current = false;
    const selesai = () => setMencetak(false);
    window.addEventListener("afterprint", selesai);
    const cadangan = window.setTimeout(cetakSekarang, 2000);
    return () => {
      window.clearTimeout(cadangan);
      window.removeEventListener("afterprint", selesai);
    };
  }, [mencetak, cetakSekarang]);

  const unduhExcel = async () => {
    if (!data) return;
    setMengunduh(true);
    try {
      await unduhRekapKasirExcel({ ...data, items: itemsTerfilter, lembaga_label: lembagaLabel });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat laporan Excel");
    } finally {
      setMengunduh(false);
    }
  };

  const { data: printReceiptGroups = {} } = useQuery({
    queryKey: ["rekap_kasir_receipt", printRow?.id],
    enabled: !!printRow,
    queryFn: async () => getPaymentReceiptGroups({ data: { payment_ids: [printRow!.id] } }),
  });
  const printReceipt = printRow ? printReceiptGroups[printRow.id] ?? null : null;

  const columns: DataTableColumn<RekapKasirSayaRow>[] = [
    {
      key: "tanggal_bayar",
      label: "Tanggal",
      render: (value) => value ? format(new Date(String(value) + "T00:00:00"), "dd/MM/yyyy") : "-",
    },
    { key: "receipt_number", label: "No. Kwitansi", render: (value) => (value as string) || "-" },
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
    { key: "payment_method", label: "Metode", render: (value) => (value as string) || "-" },
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

  const labelTanggal = (iso: string) => format(new Date(iso + "T00:00:00"), "EEEE, dd MMMM yyyy", { locale: idLocale });
  const tanggalLabel = rangeError
    ? ""
    : tanggalDari === tanggalSampai
      ? labelTanggal(tanggalDari)
      : labelTanggal(tanggalDari) + " s.d. " + labelTanggal(tanggalSampai);

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
              <Label htmlFor="rekap-dari">Dari Tanggal</Label>
              <Input
                id="rekap-dari"
                type="date"
                value={tanggalDari}
                onChange={(event) => setTanggalDari(event.target.value)}
                className="w-44"
              />
            </div>
            <div>
              <Label htmlFor="rekap-sampai">Sampai Tanggal</Label>
              <Input
                id="rekap-sampai"
                type="date"
                value={tanggalSampai}
                onChange={(event) => setTanggalSampai(event.target.value)}
                className="w-44"
              />
            </div>
            <div>
              <Label htmlFor="rekap-lembaga">Lembaga</Label>
              <Select value={lembagaAktif} onValueChange={setLembagaFilter} disabled={!!rangeError || isLoading || !data}>
                <SelectTrigger id="rekap-lembaga" className="w-56">
                  <SelectValue placeholder="Semua Lembaga" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEMUA_LEMBAGA}>Semua Lembaga</SelectItem>
                  {opsiLembaga.map((opsi) => (
                    <SelectItem key={opsi.key} value={opsi.key}>
                      {opsi.label} ({opsi.count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="text-sm text-muted-foreground">
              {rangeError ? (
                <p className="text-destructive">{rangeError}</p>
              ) : (
                <p>{tanggalLabel}</p>
              )}
              {data?.petugas_nama && <p>Petugas: <span className="font-medium text-foreground">{data.petugas_nama}</span></p>}
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => setMencetak(true)}
                disabled={!!rangeError || isLoading || !data || mencetak}
                title="Buka dialog cetak: pilih printer atau Simpan sebagai PDF"
              >
                {mencetak ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Printer className="mr-1.5 h-4 w-4" />}
                Cetak / PDF
              </Button>
              <Button
                onClick={unduhExcel}
                disabled={!!rangeError || isLoading || !data || mengunduh}
                title={`Rekapitulasi dan rincian, maksimal ${REKAP_KASIR_MAX_HARI} hari`}
              >
                {mengunduh ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-1.5 h-4 w-4" />}
                Unduh Laporan Excel
              </Button>
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
          <StatsCard title="Total Penerimaan" value={formatRupiah(statistik.total_penerimaan)} icon={Wallet} color="success" />
          <StatsCard title="Jumlah Transaksi" value={String(statistik.jumlah_transaksi)} icon={ReceiptText} color="primary" />
          <StatsCard title="Pembayaran Siswa" value={String(statistik.transaksi_siswa)} icon={Users} color="info" />
          <StatsCard title="Pembayaran SPMB" value={String(statistik.transaksi_spmb)} icon={GraduationCap} color="primary" />
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={itemsTerfilter}
            loading={isLoading}
            searchable={false}
            pageSize={20}
            emptyMessage={
              lembagaLabel
                ? "Belum ada transaksi di lembaga ini pada periode ini."
                : "Belum ada transaksi yang Anda catat pada periode ini."
            }
          />
        </CardContent>
      </Card>

      {mencetak && data && (
        <CetakRekapKasir
          items={itemsTerfilter}
          lembagaLabel={lembagaLabel}
          petugasNama={data.petugas_nama}
          bendaharaNama={data.bendahara_nama}
          dari={data.tanggal_dari}
          sampai={data.tanggal_sampai}
          dicetakPada={new Date()}
          onReady={cetakSekarang}
        />
      )}

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
            {printReceipt ? (
              <PrintKuitansiGabungan
                nomorBukti={printReceipt.receipt_number}
                items={printReceipt.items.map(item => ({
                  id: item.id,
                  jumlah: item.jumlah,
                  bulan: item.bulan ?? 0,
                  jenisNama: item.jenis_nama,
                  periodeLabel: item.periode_label || undefined,
                  status: item.status,
                }))}
                tanggalBayar={printReceipt.payment_date}
                siswa={{
                  nama: printReceipt.siswa.nama,
                  nis: printReceipt.siswa.nis || undefined,
                  nisn: printReceipt.siswa.nisn || undefined,
                }}
                kelasNama={printRow.siswa_status === "calon" ? "Calon Murid" : printRow.kelas_nama || "-"}
                lembagaNama={printReceipt.lembaga_nama || printRow.departemen_nama}
                petugasNama={printReceipt.petugas_nama || data?.petugas_nama || undefined}
                metode={printReceipt.payment_method || "Tunai"}
                receiptStatus={printReceipt.status}
                orientation={kuitansiOrientation}
              />
            ) : (
              <PrintKuitansi
                payment={{
                  id: printRow.id,
                  nomorJurnal: printRow.jurnal_nomor || undefined,
                  jumlah: printRow.jumlah,
                  bulan: printRow.bulan || 0,
                  tanggal_bayar: printRow.tanggal_bayar || tanggalDari,
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
                orientation={kuitansiOrientation}
              />
            )}
            <ReceiptOrientationSelect
              id="kuitansi-orientation-rekap"
              value={kuitansiOrientation}
              onValueChange={setKuitansiOrientation}
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
