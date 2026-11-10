import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useLaporanPosisiKeuangan, useJumlahDraftJurnal, useDepartemenGroups, useRekonRekeningAntar, useRekonRekeningAntarDetail, RekonAntarRow, PeriodeFilter, posisiLabel } from "@/hooks/useISAK35";
import { formatRupiah, useTahunBuku } from "@/hooks/useKeuangan";
import KopLaporan from "@/components/keuangan/KopLaporan";
import { labelTahunBuku } from "@/lib/labelTahunBuku";
import TandaTanganLaporan from "@/components/keuangan/TandaTanganLaporan";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Printer, AlertTriangle, ChevronRight, ChevronDown, FlaskConical } from "lucide-react";

function Row({ label, value, bold, indent, contraAsset }: { label: string; value: number; bold?: boolean; indent?: boolean; contraAsset?: boolean }) {
  const neg = value < 0;
  const display = neg ? `(${formatRupiah(Math.abs(Math.round(value)))})` : formatRupiah(Math.round(value));
  const colorClass = neg && !contraAsset ? "text-destructive" : "";
  return (
    <div className={`flex justify-between text-sm ${bold ? "font-bold" : ""} ${indent ? "pl-4" : ""} ${colorClass}`}>
      <span>{label}</span><span>{display}</span>
    </div>
  );
}

function Divider() { return <div className="border-t my-1" />; }
function DoubleDivider() { return <div className="border-t-2 border-foreground my-2" />; }

function RekonRow({ row, filter }: { row: RekonAntarRow; filter: PeriodeFilter }) {
  const [open, setOpen] = useState(false);
  const { data: detail, isLoading } = useRekonRekeningAntarDetail(
    filter, row.akun_id, row.departemen_id, open,
  );

  return (
    <div className="rounded border border-amber-500/30 bg-background/40">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between gap-4 px-2 py-1 text-left hover:bg-amber-100/40 dark:hover:bg-amber-900/20"
      >
        <span className="flex items-center gap-1">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {row.kode} {row.nama} — {row.departemen}
        </span>
        <span className="font-medium tabular-nums">{formatRupiah(Math.round(row.saldo))}</span>
      </button>

      {open && (
        <div className="border-t border-amber-500/20 px-2 py-2 text-xs">
          {isLoading || !detail ? (
            <p className="text-muted-foreground">Memuat rincian...</p>
          ) : (
            <table className="w-full tabular-nums">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">Tanggal</th>
                  <th className="py-1 pr-2 font-medium">No. Jurnal</th>
                  <th className="py-1 pr-2 font-medium">Keterangan</th>
                  <th className="py-1 pr-2 text-right font-medium">Debit</th>
                  <th className="py-1 pr-2 text-right font-medium">Kredit</th>
                  <th className="py-1 text-right font-medium">Saldo</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t">
                  <td className="py-1 pr-2" colSpan={5}>Saldo awal periode</td>
                  <td className="py-1 text-right">{formatRupiah(Math.round(detail.saldoAwal))}</td>
                </tr>
                {detail.rows.map((d, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-1 pr-2 whitespace-nowrap">{d.tanggal}</td>
                    <td className="py-1 pr-2 whitespace-nowrap">{d.nomor}</td>
                    <td className="py-1 pr-2">{d.keterangan}</td>
                    <td className="py-1 pr-2 text-right">{d.debit ? formatRupiah(Math.round(d.debit)) : "-"}</td>
                    <td className="py-1 pr-2 text-right">{d.kredit ? formatRupiah(Math.round(d.kredit)) : "-"}</td>
                    <td className="py-1 text-right">{formatRupiah(Math.round(d.saldoRunning))}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-foreground/40 font-medium">
                  <td className="py-1 pr-2" colSpan={5}>Saldo akhir (perlu dinolkan)</td>
                  <td className="py-1 text-right">{formatRupiah(Math.round(detail.saldoAkhir))}</td>
                </tr>
              </tbody>
            </table>
          )}
          {detail && detail.rows.length === 0 && (
            <p className="mt-1 text-muted-foreground italic">
              Tidak ada mutasi tahun berjalan — saldo berasal dari saldo awal/tahun sebelumnya.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function LaporanPosisiKeuangan() {
  const currentYear = new Date().getFullYear();
  const [modePeriode, setModePeriode] = useState<"tahun" | "range">("tahun");
  const [selectedNama, setSelectedNama] = useState("");
  const [tglAwal, setTglAwal] = useState(`${currentYear}-01-01`);
  const [tglAkhir, setTglAkhir] = useState(`${currentYear}-12-31`);
  const [filterUnit, setFilterUnit] = useState("pendidikan");
  const [includeDraf, setIncludeDraf] = useState(false);
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

  const { data, isLoading, isError, error } = useLaporanPosisiKeuangan(filter, departemenIds, includeDraf);
  const { data: rekonAntar } = useRekonRekeningAntar(filter);
  const { data: jumlahDraft = 0 } = useJumlahDraftJurnal(filter, departemenIds);

  const labelUnit =
    filterUnit === "semua" ? "Konsolidasi Semua Unit" :
    filterUnit === "pendidikan" ? "Unit Pendidikan (Gabungan)" :
    filterUnit === "usaha" ? "Unit Usaha & Dana (Gabungan)" :
    allDepts.find(d => d.id === filterUnit)?.nama ?? filterUnit;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-2xl font-bold text-foreground">Laporan Posisi Keuangan</h1>
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
          <div className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
            <Checkbox
              id="incl-draf"
              checked={includeDraf}
              onCheckedChange={v => setIncludeDraf(!!v)}
            />
            <Label htmlFor="incl-draf" className="cursor-pointer select-none font-normal">
              Sertakan jurnal draf
            </Label>
          </div>
          <Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4 mr-2" /> Cetak</Button>
        </div>
      </div>

      {includeDraf && (
        <Alert className="print:hidden border-blue-500/60 bg-blue-50 dark:bg-blue-950/30 [&>svg]:text-blue-600">
          <FlaskConical className="h-4 w-4" />
          <AlertDescription>
            <span className="font-medium">Laporan Percobaan</span> — angka bersifat sementara dan belum dapat dijadikan laporan resmi.{" "}
            {jumlahDraft > 0
              ? <>{jumlahDraft} jurnal draf ikut dihitung dalam periode ini.</>
              : <>Tidak ada jurnal draf di periode ini — angka sama dengan laporan resmi.</>}
          </AlertDescription>
        </Alert>
      )}

      {rekonAntar && rekonAntar.rows.length > 0 && (
        <Alert className="print:hidden border-amber-500/60 bg-amber-50 dark:bg-amber-950/30 [&>svg]:text-amber-600">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <p className="font-medium">
              Saldo rekening antar lembaga/bagian belum nol (total {formatRupiah(Math.round(rekonAntar.total))}) —
              perlu jurnal penyelesaian/reklasifikasi sebelum menyusun laporan eksternal.
            </p>
            <div className="mt-2 space-y-0.5 text-sm">
              {rekonAntar.rows.map((r, i) => (
                <RekonRow key={i} row={r} filter={filter} />
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Saldo tersisa berarti ada transfer yang baru dicatat satu sisi: buat jurnal di unit penerima
              (debit kas/bank, kredit rekening antar), atau reklasifikasi ke piutang/hutang antar lembaga.
            </p>
          </AlertDescription>
        </Alert>
      )}

      <Card className="print:border-0 print:shadow-none">
        <KopLaporan />
        <CardHeader className="text-center">
          <CardTitle className="text-lg">
            LAPORAN POSISI KEUANGAN{includeDraf && <span className="ml-2 text-blue-600 text-base font-semibold">(PERCOBAAN)</span>}
          </CardTitle>
          <p className="text-sm text-muted-foreground">{labelUnit} — {modePeriode === "tahun" ? labelTahunBuku(selectedTA, undefined, namaTampil) : posisiLabel(filter)}</p>
        </CardHeader>
        <CardContent>
          {isError ? <p className="text-destructive text-sm">Gagal memuat data: {(error as any)?.message}</p> : isLoading || !data ? <p className="text-muted-foreground">Memuat...</p> : (
            <div className="space-y-4 max-w-2xl mx-auto">
              <h3 className="font-bold text-sm uppercase tracking-wider">ASET</h3>
              <div className="space-y-1">
                <p className="font-medium text-sm">Aset Lancar:</p>
                {data.asetLancarItems.filter(a => a.saldo !== 0).map(a => (
                  <Row key={a.akun_id} label={a.nama} value={a.saldo} indent />
                ))}
                <Divider />
                <Row label="Total Aset Lancar" value={data.totalAL} bold />
              </div>
              <div className="space-y-1">
                <p className="font-medium text-sm">Aset Tidak Lancar:</p>
                {data.asetTidakLancarItems.filter(a => a.saldo > 0).map(a => (
                  <Row key={a.akun_id} label={a.nama} value={a.saldo} indent />
                ))}
                {data.asetTidakLancarItems.filter(a => a.saldo < 0).map(a => (
                  <Row key={a.akun_id} label={`Dikurangi: ${a.nama}`} value={a.saldo} indent contraAsset />
                ))}
                <Divider />
                <Row label="Total Aset Tidak Lancar (Nilai Buku)" value={data.totalATL} bold />
              </div>
              <DoubleDivider />
              <Row label="TOTAL ASET" value={data.totalAset} bold />

              <h3 className="font-bold text-sm uppercase tracking-wider mt-6">LIABILITAS</h3>
              <div className="space-y-1">
                <p className="font-medium text-sm">Liabilitas Jangka Pendek:</p>
                {data.liabJPItems.filter(a => a.saldo !== 0).map(a => (
                  <Row key={a.akun_id} label={a.nama} value={a.saldo} indent />
                ))}
                <Divider />
                <Row label="Total Liabilitas Jangka Pendek" value={data.totalLJP} bold />
              </div>
              {data.liabJGItems.length > 0 && (
                <div className="space-y-1">
                  <p className="font-medium text-sm">Liabilitas Jangka Panjang:</p>
                  {data.liabJGItems.filter(a => a.saldo !== 0).map(a => (
                    <Row key={a.akun_id} label={a.nama} value={a.saldo} indent />
                  ))}
                  <Divider />
                  <Row label="Total Liabilitas Jangka Panjang" value={data.totalLJG} bold />
                </div>
              )}
              <DoubleDivider />
              <Row label="TOTAL LIABILITAS" value={data.totalLiabilitas} bold />

              <h3 className="font-bold text-sm uppercase tracking-wider mt-6">ASET NETO</h3>
              {data.asetNetoItems.filter(a => a.saldo !== 0).map(a => (
                <Row key={a.akun_id} label={a.nama} value={a.saldo} indent />
              ))}
              {data.asetNetoItems.filter(a => a.saldo !== 0).length === 0 && (
                <p className="text-xs text-muted-foreground pl-4 italic">Belum ada saldo akun aset neto — lakukan tutup buku untuk memindahkan surplus ke ekuitas.</p>
              )}
              <Divider />
              <Row label="Saldo Aset Neto (dari Akun Ekuitas)" value={data.totalAsetNetoSaldo} indent />
              {data.surplusBerjalan !== 0 && (
                <Row label="Surplus (Defisit) Periode Berjalan — Tidak Terikat" value={data.surplusBerjalan} indent />
              )}
              {data.surplusTerbatasBerjalan !== 0 && (
                <Row label="Surplus (Defisit) Periode Berjalan — Terikat" value={data.surplusTerbatasBerjalan} indent />
              )}
              <DoubleDivider />
              <Row label="TOTAL ASET NETO" value={data.totalAsetNeto} bold />
              <Row label="TOTAL LIABILITAS & ASET NETO" value={data.totalLiabilitas + data.totalAsetNeto} bold />

              {Math.abs(data.selisih) > 1 && (
                <Alert variant="destructive" className="mt-4">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Perhatian: neraca tidak seimbang (selisih: {formatRupiah(Math.round(Math.abs(data.selisih)))}).
                    Periksa pemetaan <code>pos_isak35</code> pada akun rekening atau lakukan koreksi jurnal.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      <TandaTanganLaporan />
      </Card>
    </div>
  );
}
