import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLaporanArusKas, useDepartemenGroups, PeriodeFilter, periodeLabel } from "@/hooks/useISAK35";
import { formatRupiah, useTahunBuku } from "@/hooks/useKeuangan";
import KopLaporan from "@/components/keuangan/KopLaporan";
import { labelTahunBuku } from "@/lib/labelTahunBuku";
import TandaTanganLaporan from "@/components/keuangan/TandaTanganLaporan";
import { Printer, Info } from "lucide-react";

function Row({ label, value, bold, indent }: { label: string; value: number; bold?: boolean; indent?: boolean }) {
  const neg = value < 0;
  const display = neg ? `(${formatRupiah(Math.abs(Math.round(value)))})` : formatRupiah(Math.round(value));
  return (
    <div className={`flex justify-between text-sm ${bold ? "font-bold text-base" : ""} ${indent ? "pl-4" : ""} ${neg ? "text-destructive" : ""}`}>
      <span>{label}</span><span>{display}</span>
    </div>
  );
}

export default function LaporanArusKasISAK35() {
  const currentYear = new Date().getFullYear();
  const [modePeriode, setModePeriode] = useState<"tahun" | "range">("tahun");
  const [selectedNama, setSelectedNama] = useState("");
  const [tglAwal, setTglAwal] = useState(`${currentYear}-01-01`);
  const [tglAkhir, setTglAkhir] = useState(`${currentYear}-12-31`);
  const [filterUnit, setFilterUnit] = useState("pendidikan");
  const { data: taList = [] } = useTahunBuku();
  const { data: deptGroups } = useDepartemenGroups();

  const taOptions = taList
    .filter((t: any) => t.tanggal_selesai)
    .sort((a: any, b: any) => b.tanggal_selesai.localeCompare(a.tanggal_selesai));

  const selectedTA = taOptions.find((t: any) => t.nama === selectedNama) ?? taOptions[0];
  const namaTampil = selectedTA?.nama ?? String(currentYear);

  const allDepts = [...(deptGroups?.pendidikanDepts ?? []), ...(deptGroups?.usahaDepts ?? [])];
  const departemenIds =
    filterUnit === "semua" ? undefined :
    filterUnit === "pendidikan" ? deptGroups?.pendidikanIds :
    filterUnit === "usaha" ? deptGroups?.usahaIds :
    allDepts.some(d => d.id === filterUnit) ? [filterUnit] :
    undefined;

  const filter: PeriodeFilter = modePeriode === "tahun" && selectedTA
    ? { type: "range", tglAwal: selectedTA.tanggal_mulai, tglAkhir: selectedTA.tanggal_selesai }
    : { type: "range", tglAwal, tglAkhir };

  const { data, isLoading, isError, error } = useLaporanArusKas(filter, departemenIds);

  const labelUnit =
    filterUnit === "semua" ? "Konsolidasi Semua Unit" :
    filterUnit === "pendidikan" ? "Unit Pendidikan (Gabungan)" :
    filterUnit === "usaha" ? "Unit Usaha & Dana (Gabungan)" :
    allDepts.find(d => d.id === filterUnit)?.nama ?? filterUnit;

  const rincianMasuk = data ? Object.entries(data.rincianPenerimaanOperasi || {}).filter(([, v]) => v !== 0) : [];
  const rincianKeluar = data ? Object.entries(data.rincianPengeluaranOperasi || {}).filter(([, v]) => v !== 0) : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-2xl font-bold text-foreground">Laporan Arus Kas (ISAK 35)</h1>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {/* Toggle mode periode */}
          <div className="flex rounded-md border overflow-hidden text-sm">
            <button
              className={`px-3 py-1.5 ${modePeriode === "tahun" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
              onClick={() => setModePeriode("tahun")}>Per Tahun</button>
            <button
              className={`px-3 py-1.5 ${modePeriode === "range" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
              onClick={() => setModePeriode("range")}>Rentang Tanggal</button>
          </div>

          {modePeriode === "tahun" ? (
            <Select value={selectedTA?.nama ?? ""} onValueChange={setSelectedNama}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>{taOptions.map((t: any) => <SelectItem key={t.id} value={t.nama}>{t.nama}</SelectItem>)}</SelectContent>
            </Select>
          ) : (
            <div className="flex items-center gap-1">
              <Input type="date" className="w-36 h-9" value={tglAwal} onChange={e => setTglAwal(e.target.value)} />
              <span className="text-muted-foreground text-sm">s.d.</span>
              <Input type="date" className="w-36 h-9" value={tglAkhir} onChange={e => setTglAkhir(e.target.value)} />
            </div>
          )}

          <Select value={filterUnit} onValueChange={v => setFilterUnit(v)}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="semua">Konsolidasi Semua Unit (Internal)</SelectItem>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Unit Pendidikan</SelectLabel>
                <SelectItem value="pendidikan">— Gabungan Pendidikan</SelectItem>
                {deptGroups?.pendidikanDepts?.map(d => (
                  <SelectItem key={d.id} value={d.id}>{d.nama}</SelectItem>
                ))}
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Unit Usaha & Dana</SelectLabel>
                <SelectItem value="usaha">— Gabungan Usaha & Dana</SelectItem>
                {deptGroups?.usahaDepts?.map(d => (
                  <SelectItem key={d.id} value={d.id}>{d.nama}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4 mr-2" /> Cetak</Button>
        </div>
      </div>

      <Card className="border-info/30 bg-info/5 print:hidden">
        <CardContent className="pt-4 flex items-start gap-2 text-sm text-muted-foreground">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <p>Disajikan dengan <strong>Metode Langsung</strong> sesuai ISAK 35 — penerimaan & pengeluaran kas dirinci dari mutasi akun kas/bank pada jurnal posted.
          {modePeriode === "range" && <> Kas Awal Periode = saldo awal kas per 1 Januari tahun berjalan.</>}</p>
        </CardContent>
      </Card>

      <Card className="print:border-0 print:shadow-none">
        <KopLaporan />
        <CardHeader className="text-center">
          <CardTitle className="text-lg">LAPORAN ARUS KAS</CardTitle>
          <p className="text-sm text-muted-foreground">{labelUnit} — {modePeriode === "tahun" ? labelTahunBuku(selectedTA, undefined, namaTampil) : periodeLabel(filter)}</p>
          <p className="text-xs text-muted-foreground">(Metode Langsung)</p>
        </CardHeader>
        <CardContent>
          {isError ? <p className="text-destructive text-sm">Gagal memuat data: {(error as any)?.message}</p> : isLoading || !data ? <p className="text-muted-foreground">Memuat...</p> : (
            <div className="space-y-6 max-w-2xl mx-auto">
              <div>
                <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-2">Arus Kas dari Aktivitas Operasi</h3>
                <p className="text-xs italic text-muted-foreground mb-1 pl-1">Penerimaan Kas:</p>
                {rincianMasuk.length === 0 && <p className="text-xs text-muted-foreground pl-4">— tidak ada —</p>}
                {rincianMasuk.map(([k, v]) => <Row key={k} label={k} value={v as number} indent />)}
                <p className="text-xs italic text-muted-foreground mt-2 mb-1 pl-1">Pengeluaran Kas:</p>
                {rincianKeluar.length === 0 && <p className="text-xs text-muted-foreground pl-4">— tidak ada —</p>}
                {rincianKeluar.map(([k, v]) => <Row key={k} label={k} value={-(v as number)} indent />)}
                <div className="border-t my-1" />
                <Row label="Arus Kas Bersih dari Aktivitas Operasi" value={data.arusOperasi} bold />
              </div>

              <div>
                <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-2">Arus Kas dari Aktivitas Investasi</h3>
                <Row label="Penerimaan dari Pelepasan Aset Tetap" value={data.investasiPenerimaan} indent />
                <Row label="Pembayaran untuk Pembelian Aset Tetap" value={-data.investasiPengeluaran} indent />
                <div className="border-t my-1" />
                <Row label="Arus Kas Bersih dari Aktivitas Investasi" value={data.arusInvestasi} bold />
              </div>

              <div>
                <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-2">Arus Kas dari Aktivitas Pendanaan</h3>
                <Row label="Penerimaan dari Utang/Setoran Modal" value={data.pendanaanPenerimaan} indent />
                <Row label="Pembayaran Utang" value={-data.pendanaanPengeluaran} indent />
                <div className="border-t my-1" />
                <Row label="Arus Kas Bersih dari Aktivitas Pendanaan" value={data.arusPendanaan} bold />
              </div>

              <div className="border-t-2 border-foreground pt-3 space-y-2">
                <Row label="Kenaikan (Penurunan) Bersih Kas dan Setara Kas" value={data.kenaikanKas} />
                <Row label="Kas dan Setara Kas Awal Periode" value={data.kasAwal} />
                <div className="border-t-2 border-foreground my-2" />
                <Row label="KAS DAN SETARA KAS AKHIR PERIODE" value={data.kasAkhir} bold />
              </div>
            </div>
          )}
        </CardContent>
      <TandaTanganLaporan />
      </Card>
    </div>
  );
}
