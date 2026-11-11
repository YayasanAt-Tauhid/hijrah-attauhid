import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLaporanKomprehensif, useDepartemenGroups, PeriodeFilter, periodeLabel } from "@/hooks/useISAK35";
import { formatRupiah, useTahunBuku } from "@/hooks/useKeuangan";
import KopLaporan from "@/components/keuangan/KopLaporan";
import { labelTahunBuku } from "@/lib/labelTahunBuku";
import TandaTanganLaporan from "@/components/keuangan/TandaTanganLaporan";
import { Printer, EyeOff, Eye } from "lucide-react";

function Nominal({ value, bold }: { value: number; bold?: boolean }) {
  const cls = `text-right ${value < 0 ? "text-destructive" : ""} ${bold ? "font-bold text-base" : ""}`;
  return <span className={cls}>{formatRupiah(Math.round(value))}</span>;
}

export default function LaporanKomprehensif() {
  const currentYear = new Date().getFullYear();
  const [modePeriode, setModePeriode] = useState<"tahun" | "range">("tahun");
  const [selectedNama, setSelectedNama] = useState("");
  const [tglAwal, setTglAwal] = useState(`${currentYear}-01-01`);
  const [tglAkhir, setTglAkhir] = useState(`${currentYear}-12-31`);
  const [filterUnit, setFilterUnit] = useState("pendidikan");
  const [sembunyikanNol, setSembunyikanNol] = useState(true);
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

  const { data, isLoading, isError, error } = useLaporanKomprehensif(filter, departemenIds);

  const labelUnit =
    filterUnit === "semua" ? "Konsolidasi Semua Unit" :
    filterUnit === "pendidikan" ? "Unit Pendidikan (Gabungan)" :
    filterUnit === "usaha" ? "Unit Usaha & Dana (Gabungan)" :
    allDepts.find(d => d.id === filterUnit)?.nama ?? filterUnit;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-2xl font-bold text-foreground">Laporan Penghasilan Komprehensif</h1>
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
          <Button variant="outline" onClick={() => setSembunyikanNol(v => !v)} className="print:hidden">
            {sembunyikanNol ? <><Eye className="h-4 w-4 mr-2" /> Tampilkan Rp 0</> : <><EyeOff className="h-4 w-4 mr-2" /> Sembunyikan Rp 0</>}
          </Button>
          <Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4 mr-2" /> Cetak</Button>
        </div>
      </div>

      <Card className="print:border-0 print:shadow-none">
        <KopLaporan />
        <CardHeader className="text-center">
          <CardTitle className="text-lg">LAPORAN PENGHASILAN KOMPREHENSIF</CardTitle>
          <p className="text-sm text-muted-foreground">{labelUnit} — {modePeriode === "tahun" ? labelTahunBuku(selectedTA, undefined, namaTampil) : periodeLabel(filter)}</p>
        </CardHeader>
        <CardContent>
          {isError ? <p className="text-destructive text-sm">Gagal memuat data: {(error as any)?.message}</p> : isLoading || !data ? <p className="text-muted-foreground">Memuat...</p> : (
            <div className="space-y-6 max-w-2xl mx-auto">
              {/* Tanpa Pembatasan */}
              <div>
                <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-3">Tanpa Pembatasan dari Pemberi Sumber Daya</h3>
                <div className="space-y-1">
                  <p className="font-medium text-sm">Pendapatan:</p>
                  {data.pendapatan.filter(a => !sembunyikanNol || a.saldo !== 0).map(a => (
                    <div key={a.akun_id} className="flex justify-between text-sm pl-4"><span>{a.nama}</span><Nominal value={a.saldo} /></div>
                  ))}
                  <div className="flex justify-between font-semibold text-sm border-t pt-1"><span>Total Pendapatan</span><Nominal value={data.totalPendapatan} /></div>
                </div>
                <div className="space-y-1 mt-4">
                  <p className="font-medium text-sm">Beban:</p>
                  {data.beban.filter(a => !sembunyikanNol || a.saldo !== 0).map(a => (
                    <div key={a.akun_id} className="flex justify-between text-sm pl-4"><span>{a.nama}</span><Nominal value={a.saldo} /></div>
                  ))}
                  <div className="flex justify-between font-semibold text-sm border-t pt-1"><span>Total Beban</span><Nominal value={data.totalBeban} /></div>
                </div>
                <div className="flex justify-between font-bold text-sm border-t-2 border-foreground pt-2 mt-3">
                  <span>Surplus (Defisit)</span><Nominal value={data.surplusDefisit} bold />
                </div>
              </div>

              {/* Dengan Pembatasan */}
              <div>
                <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-3">Dengan Pembatasan dari Pemberi Sumber Daya</h3>
                <div className="space-y-1">
                  <p className="font-medium text-sm">Pendapatan:</p>
                  {data.pendapatanTerbatas.filter(a => !sembunyikanNol || a.saldo !== 0).map(a => (
                    <div key={a.akun_id} className="flex justify-between text-sm pl-4"><span>{a.nama}</span><Nominal value={a.saldo} /></div>
                  ))}
                  <div className="flex justify-between font-semibold text-sm border-t pt-1"><span>Total Pendapatan Terbatas</span><Nominal value={data.totalPT} /></div>
                </div>
                <div className="space-y-1 mt-4">
                  <p className="font-medium text-sm">Beban:</p>
                  {data.bebanTerbatas.filter(a => !sembunyikanNol || a.saldo !== 0).map(a => (
                    <div key={a.akun_id} className="flex justify-between text-sm pl-4"><span>{a.nama}</span><Nominal value={a.saldo} /></div>
                  ))}
                  <div className="flex justify-between font-semibold text-sm border-t pt-1"><span>Total Beban Terbatas</span><Nominal value={data.totalBT} /></div>
                </div>
                <div className="flex justify-between font-bold text-sm border-t-2 border-foreground pt-2 mt-3">
                  <span>Surplus (Defisit) Terbatas</span><Nominal value={data.surplusTerbatas} bold />
                </div>
              </div>

              {/* PKL & Total */}
              <div className="border-t-2 border-foreground pt-3 space-y-2">
                {(!sembunyikanNol || data.pkl !== 0) && (
                  <div className="flex justify-between text-sm"><span>Penghasilan Komprehensif Lain</span><Nominal value={data.pkl} /></div>
                )}
                <div className="flex justify-between font-bold text-lg border-t-2 border-foreground pt-2">
                  <span>TOTAL PENGHASILAN KOMPREHENSIF</span><Nominal value={data.totalKomprehensif} bold />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      <TandaTanganLaporan />
      </Card>
    </div>
  );
}
