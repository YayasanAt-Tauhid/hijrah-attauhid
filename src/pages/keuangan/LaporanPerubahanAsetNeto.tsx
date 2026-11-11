import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLaporanKomprehensif, useLaporanPosisiKeuangan, useDepartemenGroups, PeriodeFilter, periodeLabel } from "@/hooks/useISAK35";
import { formatRupiah, useTahunBuku } from "@/hooks/useKeuangan";
import KopLaporan from "@/components/keuangan/KopLaporan";
import { labelTahunBuku } from "@/lib/labelTahunBuku";
import TandaTanganLaporan from "@/components/keuangan/TandaTanganLaporan";
import { Printer } from "lucide-react";

function Rp({ value }: { value: number }) {
  return <span className={value < 0 ? "text-destructive" : ""}>{formatRupiah(Math.round(value))}</span>;
}

export default function LaporanPerubahanAsetNeto() {
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
  const selectedIdx = taOptions.indexOf(selectedTA);
  const prevTA = taOptions[selectedIdx + 1];
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

  // Saldo awal = posisi keuangan akhir tahun ajaran sebelumnya
  const filterSaldoAwal: PeriodeFilter = modePeriode === "tahun" && prevTA
    ? { type: "range", tglAwal: prevTA.tanggal_mulai, tglAkhir: prevTA.tanggal_selesai }
    : modePeriode === "tahun" && selectedTA
    ? { type: "range", tglAwal: `${parseInt(selectedTA.tanggal_mulai.substring(0, 4)) - 1}-01-01`, tglAkhir: `${parseInt(selectedTA.tanggal_mulai.substring(0, 4)) - 1}-12-31` }
    : { type: "range", tglAwal: `${parseInt(tglAwal.substring(0, 4)) - 1}-01-01`, tglAkhir: `${parseInt(tglAwal.substring(0, 4)) - 1}-12-31` };

  const { data: komprehensif, isLoading: l1 } = useLaporanKomprehensif(filter, departemenIds);
  const { data: posisiTahunIni,  isLoading: l2 } = useLaporanPosisiKeuangan(filter, departemenIds);
  const { data: posisiTahunLalu, isLoading: l3 } = useLaporanPosisiKeuangan(filterSaldoAwal, departemenIds);

  const isLoading = l1 || l2 || l3;
  const labelUnit =
    filterUnit === "semua" ? "Konsolidasi Semua Unit" :
    filterUnit === "pendidikan" ? "Unit Pendidikan (Gabungan)" :
    filterUnit === "usaha" ? "Unit Usaha & Dana (Gabungan)" :
    allDepts.find(d => d.id === filterUnit)?.nama ?? filterUnit;

  const surplusTP = komprehensif?.surplusDefisit ?? 0;
  const surplusTB = komprehensif?.surplusTerbatas ?? 0;
  const pkl = komprehensif?.pkl ?? 0;

  // Saldo awal = closing balance tahun ini dikurangi perubahan selama tahun ini.
  // Pendekatan ini benar untuk tahun pertama (tidak ada data tahun lalu)
  // maupun tahun berikutnya.
  const saldoNetoAkhirTP = (posisiTahunIni?.asetNetoItems || [])
    .filter((a: any) => a.pos_isak35 === "aset_neto_tidak_terikat")
    .reduce((s: number, a: any) => s + a.saldo, 0) + (posisiTahunIni?.surplusBerjalan || 0);
  const saldoNetoAkhirTB = (posisiTahunIni?.asetNetoItems || [])
    .filter((a: any) => a.pos_isak35 === "aset_neto_terikat_temporer" || a.pos_isak35 === "aset_neto_terikat_permanen")
    .reduce((s: number, a: any) => s + a.saldo, 0) + (posisiTahunIni?.surplusTerbatasBerjalan || 0);

  // Jika ada data tahun lalu, gunakan itu sebagai saldo awal (lebih akurat).
  // Jika tidak ada (tahun pertama), derive dari closing balance - perubahan.
  const saldoTPTahunLalu = (posisiTahunLalu?.asetNetoItems || [])
    .filter((a: any) => a.pos_isak35 === "aset_neto_tidak_terikat")
    .reduce((s: number, a: any) => s + a.saldo, 0);
  const hasPrevData = saldoTPTahunLalu !== 0 || (posisiTahunLalu?.surplusBerjalan || 0) !== 0;

  const saldoAwalTP = hasPrevData
    ? saldoTPTahunLalu + (posisiTahunLalu?.surplusBerjalan || 0)
    : saldoNetoAkhirTP - surplusTP - pkl;
  const saldoTBTahunLalu = (posisiTahunLalu?.asetNetoItems || [])
    .filter((a: any) => a.pos_isak35 === "aset_neto_terikat_temporer" || a.pos_isak35 === "aset_neto_terikat_permanen")
    .reduce((s: number, a: any) => s + a.saldo, 0);
  const saldoAwalTB = hasPrevData
    ? saldoTBTahunLalu + (posisiTahunLalu?.surplusTerbatasBerjalan || 0)
    : saldoNetoAkhirTB - surplusTB;

  const saldoAkhirTP = saldoAwalTP + surplusTP + pkl;
  const saldoAkhirTB = saldoAwalTB + surplusTB;

  const periodeAwal = modePeriode === "tahun"
    ? `1 Jan ${namaTampil}`
    : tglAwal;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-2xl font-bold text-foreground">Laporan Perubahan Aset Neto</h1>
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

      <Card className="print:border-0 print:shadow-none">
        <KopLaporan />
        <CardHeader className="text-center">
          <CardTitle className="text-lg">LAPORAN PERUBAHAN ASET NETO</CardTitle>
          <p className="text-sm text-muted-foreground">{labelUnit} — {modePeriode === "tahun" ? labelTahunBuku(selectedTA, undefined, namaTampil) : periodeLabel(filter)}</p>
        </CardHeader>
        <CardContent>
          {isLoading ? <p className="text-muted-foreground">Memuat...</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Keterangan</TableHead>
                  <TableHead className="text-right">Tanpa Pembatasan</TableHead>
                  <TableHead className="text-right">Dengan Pembatasan</TableHead>
                  <TableHead className="text-right">Jumlah</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Saldo Awal (per {periodeAwal})</TableCell>
                  <TableCell className="text-right"><Rp value={saldoAwalTP} /></TableCell>
                  <TableCell className="text-right"><Rp value={saldoAwalTB} /></TableCell>
                  <TableCell className="text-right"><Rp value={saldoAwalTP + saldoAwalTB} /></TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Surplus / Defisit</TableCell>
                  <TableCell className="text-right"><Rp value={surplusTP} /></TableCell>
                  <TableCell className="text-right"><Rp value={surplusTB} /></TableCell>
                  <TableCell className="text-right"><Rp value={surplusTP + surplusTB} /></TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Penghasilan Komprehensif Lain</TableCell>
                  <TableCell className="text-right"><Rp value={pkl} /></TableCell>
                  <TableCell className="text-right"><Rp value={0} /></TableCell>
                  <TableCell className="text-right"><Rp value={pkl} /></TableCell>
                </TableRow>
                <TableRow className="font-bold border-t-2">
                  <TableCell>Saldo Akhir</TableCell>
                  <TableCell className="text-right"><Rp value={saldoAkhirTP} /></TableCell>
                  <TableCell className="text-right"><Rp value={saldoAkhirTB} /></TableCell>
                  <TableCell className="text-right"><Rp value={saldoAkhirTP + saldoAkhirTB} /></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      <TandaTanganLaporan />
      </Card>
    </div>
  );
}
