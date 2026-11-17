import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { ChevronsUpDown, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { fetchBukuBesarSemuaRinci, useAkunRekening, useAkunRekeningSemua, useBukuBesar, useBukuBesarRingkasanSemua } from "@/hooks/useJurnal";
import { useDepartemenGroups } from "@/hooks/useISAK35";
import { formatRupiah, namaBulan } from "@/hooks/useKeuangan";
import {
  BULAN_KALENDER, buildBukuBesarRingkasanAoa, buildBukuBesarSemuaAoa, buildBukuBesarSingleAoa, bukuBesarFilename,
  filterRingkasan, hitungRingkasanPerAkun, hitungSaldoBerjalan, kelompokkanPerAkun, labelPeriode, parseTahunInput,
  periodeBukuBesar, totalRingkasan, type AkunBB, type MutasiBBSaldo,
} from "@/lib/bukuBesar";
import { downloadAoaCsv, downloadAoaXlsx, downloadSheetsXlsx } from "@/lib/jurnalExport";
import { getErrorMessage } from "@/lib/errorMessage";
import { format, parseISO } from "date-fns";
import { id as idLocale } from "date-fns/locale";

const currentYear = new Date().getFullYear();
const SEMUA_AKUN = "__semua__";

const tglPendek = (s: string) => format(parseISO(s), "d MMM yyyy", { locale: idLocale });

function MutasiTable({ saldoAwal, rows }: { saldoAwal: number; rows: MutasiBBSaldo[] }) {
  return (
    <div className="border rounded-md overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="p-2 text-left">Tanggal</th>
            <th className="p-2 text-left">No. Jurnal</th>
            <th className="p-2 text-left">Lembaga</th>
            <th className="p-2 text-left">Keterangan</th>
            <th className="p-2 text-right">Debit</th>
            <th className="p-2 text-right">Kredit</th>
            <th className="p-2 text-right">Saldo</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t bg-muted/30">
            <td className="p-2" colSpan={6}>Saldo Awal</td>
            <td className="p-2 text-right">{formatRupiah(Math.round(saldoAwal))}</td>
          </tr>
          {rows.map((r, i) => (
            <tr key={i} className="border-t">
              <td className="p-2 whitespace-nowrap">{tglPendek(r.tanggal)}</td>
              <td className="p-2 whitespace-nowrap">
                {r.nomor}{r.tipe !== "normal" ? <span className="ml-1 text-xs text-muted-foreground">({r.tipe})</span> : null}
              </td>
              <td className="p-2">{r.lembaga}</td>
              <td className="p-2">{r.keterangan}</td>
              <td className="p-2 text-right">{r.debit > 0 ? formatRupiah(r.debit) : "-"}</td>
              <td className="p-2 text-right">{r.kredit > 0 ? formatRupiah(r.kredit) : "-"}</td>
              <td className="p-2 text-right">{formatRupiah(Math.round(r.saldo))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Mutasi rinci satu akun, dimuat hanya saat baris akun dibuka (komponen ini baru di-mount
// ketika AccordionContent terbuka), memakai fungsi per akun yang sama dengan mode satu akun.
function MutasiAkunMalas(props: {
  akun: AkunBB;
  tglAwal: string;
  tglAkhir: string;
  departemenIds?: string[];
  includePenutup: boolean;
  excludeKoreksi: boolean;
}) {
  const { akun, tglAwal, tglAkhir, departemenIds, includePenutup, excludeKoreksi } = props;
  const { data, isLoading, isError, error } = useBukuBesar(akun.id, tglAwal, tglAkhir, departemenIds, includePenutup, excludeKoreksi);
  const rows = useMemo(
    () => (data ? hitungSaldoBerjalan(data.saldoAwal, data.mutasi, akun.saldo_normal) : []),
    [data, akun.saldo_normal],
  );
  if (isLoading) {
    return (
      <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Memuat mutasi akun...
      </p>
    );
  }
  if (isError) {
    return <p className="py-4 text-sm text-destructive">Gagal memuat mutasi akun: {getErrorMessage(error)}</p>;
  }
  if (!data) return null;
  return <MutasiTable saldoAwal={data.saldoAwal} rows={rows} />;
}

export default function BukuBesar() {
  const [akunId, setAkunId] = useState<string>("");
  const [akunOpen, setAkunOpen] = useState(false);
  const [bulanDari, setBulanDari] = useState(1);
  const [bulanSampai, setBulanSampai] = useState(12);
  const [tahunInput, setTahunInput] = useState(String(currentYear));
  const [filterUnit, setFilterUnit] = useState("semua");
  const [unitOpen, setUnitOpen] = useState(false);
  const [tampilkanPenutup, setTampilkanPenutup] = useState(false);
  const [sembunyikanKoreksi, setSembunyikanKoreksi] = useState(true);
  const [cari, setCari] = useState("");
  const [hanyaBermutasi, setHanyaBermutasi] = useState(false);
  const [mengekspor, setMengekspor] = useState(false);

  const modeSemua = akunId === SEMUA_AKUN;

  const { data: akunList } = useAkunRekening();
  const { data: akunSemua } = useAkunRekeningSemua(modeSemua);
  const { data: deptGroups } = useDepartemenGroups();

  const allDepts = [...(deptGroups?.pendidikanDepts ?? []), ...(deptGroups?.usahaDepts ?? [])];
  const departemenIds =
    filterUnit === "semua" ? undefined :
    filterUnit === "pendidikan" ? deptGroups?.pendidikanIds :
    filterUnit === "usaha" ? deptGroups?.usahaIds :
    allDepts.some(d => d.id === filterUnit) ? [filterUnit] :
    undefined;
  // Jangan jalankan query sebelum daftar unit termuat (kalau tidak, filter unit terbaca "semua unit").
  const unitSiap = filterUnit === "semua" || !!deptGroups;

  const labelUnit =
    filterUnit === "semua" ? "Semua Unit" :
    filterUnit === "pendidikan" ? "Gabungan Pendidikan" :
    filterUnit === "usaha" ? "Gabungan Usaha & Dana" :
    allDepts.find(d => d.id === filterUnit)?.nama ?? filterUnit;

  // Periode valid hanya bila tahun 4 digit dan Dari <= Sampai; selain itu query tidak dijalankan.
  const periode = periodeBukuBesar(parseTahunInput(tahunInput), bulanDari, bulanSampai);
  const tglAwal = periode.valid ? periode.tglAwal : undefined;
  const tglAkhir = periode.valid ? periode.tglAkhir : undefined;
  const periodeLabel = periode.valid ? labelPeriode(periode.tglAwal, periode.tglAkhir) : "";

  const selectedAkun = akunList?.find((a: any) => a.id === akunId);
  const {
    data, isLoading, isError, error,
  } = useBukuBesar(!modeSemua && unitSiap ? akunId || undefined : undefined, tglAwal, tglAkhir, departemenIds, tampilkanPenutup, sembunyikanKoreksi);
  const {
    data: dataSemua, isLoading: loadingSemua, isError: isErrorSemua, error: errorSemua,
  } = useBukuBesarRingkasanSemua({
    tglAwal, tglAkhir, departemenIds,
    includePenutup: tampilkanPenutup, excludeKoreksi: sembunyikanKoreksi,
    enabled: modeSemua && unitSiap,
  });

  const computedData = useMemo(() => {
    if (!data || !selectedAkun) return [];
    return hitungSaldoBerjalan(data.saldoAwal, data.mutasi, selectedAkun.saldo_normal);
  }, [data, selectedAkun]);

  const saldoAwal = data?.saldoAwal ?? 0;
  const totalDebit = computedData.reduce((s, r) => s + r.debit, 0);
  const totalKredit = computedData.reduce((s, r) => s + r.kredit, 0);
  const saldoAkhir = computedData.length > 0 ? computedData[computedData.length - 1].saldo : saldoAwal;

  const ringkasanSemua = useMemo(() => {
    if (!modeSemua || !akunSemua || !dataSemua) return [];
    return hitungRingkasanPerAkun(akunSemua, dataSemua.saldoAwal, dataSemua.ringkasan);
  }, [modeSemua, akunSemua, dataSemua]);
  const tampilSemua = useMemo(
    () => filterRingkasan(ringkasanSemua, { cari, hanyaBermutasi }),
    [ringkasanSemua, cari, hanyaBermutasi],
  );
  const totalSemua = totalRingkasan(tampilSemua);

  const exportSingle = (tipe: "xlsx" | "csv") => {
    if (!periode.valid || !selectedAkun) return;
    const aoa = buildBukuBesarSingleAoa({ akun: selectedAkun, unitLabel: labelUnit, periodeLabel, saldoAwal, rows: computedData });
    const nama = bukuBesarFilename({ kode: selectedAkun.kode, tglAwal: periode.tglAwal, tglAkhir: periode.tglAkhir });
    if (tipe === "xlsx") downloadAoaXlsx(aoa, nama, "Buku Besar");
    else downloadAoaCsv(aoa, nama);
  };

  // Mutasi rinci semua akun (puluhan ribu baris) hanya diambil di sini, saat tombol export diklik.
  const exportSemua = async (tipe: "xlsx" | "csv") => {
    if (!periode.valid || !akunSemua || mengekspor) return;
    setMengekspor(true);
    try {
      const rinci = await fetchBukuBesarSemuaRinci({
        tglAwal: periode.tglAwal, tglAkhir: periode.tglAkhir, departemenIds,
        includePenutup: tampilkanPenutup, excludeKoreksi: sembunyikanKoreksi,
      });
      const groups = kelompokkanPerAkun(akunSemua, rinci.saldoAwal, rinci.mutasi);
      const nama = bukuBesarFilename({ kode: null, tglAwal: periode.tglAwal, tglAkhir: periode.tglAkhir });
      const mutasiAoa = buildBukuBesarSemuaAoa({ unitLabel: labelUnit, periodeLabel, groups });
      if (tipe === "xlsx") {
        // Ringkasan dihitung dari data rinci yang sama supaya angka kedua sheet pasti konsisten.
        const ringkasanAoa = buildBukuBesarRingkasanAoa({
          unitLabel: labelUnit, periodeLabel,
          items: groups.map((g) => ({
            akun: g.akun, saldoAwal: g.saldoAwal, totalDebit: g.totalDebit, totalKredit: g.totalKredit,
            jumlah: g.rows.length, saldoAkhir: g.saldoAkhir,
          })),
        });
        downloadSheetsXlsx([{ name: "Ringkasan", aoa: ringkasanAoa }, { name: "Mutasi", aoa: mutasiAoa }], nama);
      } else {
        downloadAoaCsv(mutasiAoa, nama);
      }
    } catch (e) {
      toast.error(`Gagal export buku besar: ${getErrorMessage(e)}`);
    } finally {
      setMengekspor(false);
    }
  };

  const columns: DataTableColumn<any>[] = [
    { key: "tanggal", label: "Tanggal", render: (v) => v ? format(new Date(v as string), "d MMM yyyy", { locale: idLocale }) : "-" },
    { key: "nomor", label: "No. Jurnal", render: (v, row) => (
      <span>{v as string}{row.tipe !== "normal" ? <span className="ml-1 text-xs text-muted-foreground">({row.tipe})</span> : null}</span>
    ) },
    { key: "lembaga", label: "Lembaga" },
    { key: "keterangan", label: "Keterangan" },
    { key: "debit", label: "Debit", render: (v) => Number(v) > 0 ? formatRupiah(Number(v)) : "-" },
    { key: "kredit", label: "Kredit", render: (v) => Number(v) > 0 ? formatRupiah(Number(v)) : "-" },
    { key: "saldo", label: "Saldo", render: (v) => formatRupiah(Math.round(Number(v))) },
  ];

  const jenisLabel: Record<string, string> = { aset: "Aset", liabilitas: "Liabilitas", ekuitas: "Ekuitas", pendapatan: "Pendapatan", beban: "Beban" };

  const labelAkunTerpilih = modeSemua
    ? "Semua akun rekening"
    : selectedAkun ? `${selectedAkun.kode} - ${selectedAkun.nama}` : "Pilih akun...";

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Buku Besar</h1>
        <p className="text-sm text-muted-foreground">Mutasi per akun rekening dari jurnal yang sudah diposting, dengan saldo awal periode</p>
      </div>

      <div className="flex gap-3 items-end flex-wrap">
        <div className="min-w-[260px]">
          <Label>Akun Rekening</Label>
          <Popover open={akunOpen} onOpenChange={setAkunOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" aria-expanded={akunOpen} className="w-full justify-between font-normal">
                {akunId ? labelAkunTerpilih : "Pilih akun..."}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[320px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Cari kode atau nama akun..." />
                <CommandList>
                  <CommandEmpty>Akun tidak ditemukan.</CommandEmpty>
                  <CommandItem value="Semua akun rekening" onSelect={() => { setAkunId(SEMUA_AKUN); setAkunOpen(false); }}>
                    <Check className={cn("mr-2 h-4 w-4", modeSemua ? "opacity-100" : "opacity-0")} />
                    Semua akun rekening
                  </CommandItem>
                  {akunList?.map((a: any) => (
                    <CommandItem key={a.id} value={`${a.kode} ${a.nama}`} onSelect={() => { setAkunId(a.id); setAkunOpen(false); }}>
                      <Check className={cn("mr-2 h-4 w-4", akunId === a.id ? "opacity-100" : "opacity-0")} />
                      {a.kode} - {a.nama}
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        <div className="min-w-[240px]">
          <Label>Unit / Lembaga</Label>
          <Popover open={unitOpen} onOpenChange={setUnitOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" aria-expanded={unitOpen} className="w-full justify-between font-normal">
                {labelUnit}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Cari unit / lembaga..." />
                <CommandList>
                  <CommandEmpty>Unit tidak ditemukan.</CommandEmpty>
                  <CommandItem value="Semua Unit" onSelect={() => { setFilterUnit("semua"); setUnitOpen(false); }}>
                    <Check className={cn("mr-2 h-4 w-4", filterUnit === "semua" ? "opacity-100" : "opacity-0")} />
                    Semua Unit
                  </CommandItem>
                  <CommandItem value="Gabungan Pendidikan" onSelect={() => { setFilterUnit("pendidikan"); setUnitOpen(false); }}>
                    <Check className={cn("mr-2 h-4 w-4", filterUnit === "pendidikan" ? "opacity-100" : "opacity-0")} />
                    Gabungan Pendidikan
                  </CommandItem>
                  {deptGroups?.pendidikanDepts?.map(d => (
                    <CommandItem key={d.id} value={d.nama} onSelect={() => { setFilterUnit(d.id); setUnitOpen(false); }}>
                      <Check className={cn("mr-2 h-4 w-4", filterUnit === d.id ? "opacity-100" : "opacity-0")} />
                      {d.nama}
                    </CommandItem>
                  ))}
                  <CommandItem value="Gabungan Usaha Dana" onSelect={() => { setFilterUnit("usaha"); setUnitOpen(false); }}>
                    <Check className={cn("mr-2 h-4 w-4", filterUnit === "usaha" ? "opacity-100" : "opacity-0")} />
                    Gabungan Usaha & Dana
                  </CommandItem>
                  {deptGroups?.usahaDepts?.map(d => (
                    <CommandItem key={d.id} value={d.nama} onSelect={() => { setFilterUnit(d.id); setUnitOpen(false); }}>
                      <Check className={cn("mr-2 h-4 w-4", filterUnit === d.id ? "opacity-100" : "opacity-0")} />
                      {d.nama}
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        <div>
          <Label>Bulan Dari</Label>
          <Select value={String(bulanDari)} onValueChange={v => setBulanDari(Number(v))}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {BULAN_KALENDER.map((m) => <SelectItem key={m} value={String(m)}>{namaBulan(m)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Bulan Sampai</Label>
          <Select value={String(bulanSampai)} onValueChange={v => setBulanSampai(Number(v))}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {BULAN_KALENDER.map((m) => <SelectItem key={m} value={String(m)}>{namaBulan(m)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Tahun</Label>
          <Input
            type="text"
            inputMode="numeric"
            maxLength={4}
            className="w-24"
            value={tahunInput}
            aria-invalid={!periode.valid && periode.alasan === "tahun"}
            onChange={e => setTahunInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
          />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Checkbox id="penutup" checked={tampilkanPenutup} onCheckedChange={(v) => setTampilkanPenutup(v === true)} />
          <Label htmlFor="penutup" className="font-normal text-sm cursor-pointer">Tampilkan jurnal penutup</Label>
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Checkbox id="koreksi" checked={sembunyikanKoreksi} onCheckedChange={(v) => setSembunyikanKoreksi(v === true)} />
          <Label htmlFor="koreksi" className="font-normal text-sm cursor-pointer">Sembunyikan jurnal terkoreksi & pembalik</Label>
        </div>
      </div>

      {!periode.valid && periode.alasan === "urutan" && (
        <p className="text-sm text-destructive">Bulan Dari harus sebelum atau sama dengan Bulan Sampai (dalam tahun yang sama).</p>
      )}
      {!periode.valid && periode.alasan === "tahun" && (
        <p className="text-sm text-destructive">Isi Tahun dengan 4 digit (2000–2100).</p>
      )}
      {isError && !modeSemua && (
        <p className="text-sm text-destructive">Gagal memuat buku besar: {getErrorMessage(error)}</p>
      )}
      {isErrorSemua && modeSemua && (
        <p className="text-sm text-destructive">Gagal memuat ringkasan buku besar semua akun: {getErrorMessage(errorSemua)}</p>
      )}

      {selectedAkun && !modeSemua && (
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              <div><span className="text-muted-foreground">Kode:</span> <span className="font-semibold">{selectedAkun.kode}</span></div>
              <div><span className="text-muted-foreground">Nama:</span> <span className="font-semibold">{selectedAkun.nama}</span></div>
              <div><span className="text-muted-foreground">Jenis:</span> <span className="font-semibold">{jenisLabel[selectedAkun.jenis] || selectedAkun.jenis}</span></div>
              <div><span className="text-muted-foreground">Saldo Normal:</span> <span className="font-semibold">{selectedAkun.saldo_normal === "K" ? "Kredit" : "Debit"}</span></div>
              <div><span className="text-muted-foreground">Unit:</span> <span className="font-semibold">{labelUnit}</span></div>
            </div>
          </CardContent>
        </Card>
      )}

      {modeSemua && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">
                {loadingSemua
                  ? "Memuat ringkasan semua akun..."
                  : `${tampilSemua.length} dari ${ringkasanSemua.length} akun memiliki saldo awal atau mutasi pada periode ini`}
              </span>
              <div className="flex items-center gap-2">
                {mengekspor && (
                  <span className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Menyiapkan file (semua mutasi)...
                  </span>
                )}
                <ExportMenu
                  loading={loadingSemua || mengekspor}
                  disabled={!periode.valid || ringkasanSemua.length === 0}
                  onExcel={() => exportSemua("xlsx")}
                  onCsv={() => exportSemua("csv")}
                  onPrint={() => window.print()}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Input
                className="w-full max-w-xs"
                placeholder="Cari kode atau nama akun..."
                value={cari}
                onChange={(e) => setCari(e.target.value)}
              />
              <div className="flex items-center gap-2">
                <Checkbox id="hanya-mutasi" checked={hanyaBermutasi} onCheckedChange={(v) => setHanyaBermutasi(v === true)} />
                <Label htmlFor="hanya-mutasi" className="font-normal text-sm cursor-pointer">Hanya akun yang ada mutasi</Label>
              </div>
            </div>
            {!loadingSemua && periode.valid && ringkasanSemua.length === 0 && !isErrorSemua && (
              <p className="py-8 text-center text-muted-foreground">Tidak ada saldo awal atau mutasi pada periode dan unit ini.</p>
            )}
            {ringkasanSemua.length > 0 && tampilSemua.length === 0 && (
              <p className="py-8 text-center text-muted-foreground">Tidak ada akun yang cocok dengan pencarian.</p>
            )}
            {tampilSemua.length > 0 && (
              <div>
                <div className="hidden md:grid md:grid-cols-[minmax(0,1fr)_8.5rem_8.5rem_8.5rem_8.5rem_3.5rem] gap-x-4 border-b px-1 pb-2 pr-8 text-xs font-medium text-muted-foreground">
                  <span>Akun</span>
                  <span className="text-right">Saldo Awal</span>
                  <span className="text-right">Debit</span>
                  <span className="text-right">Kredit</span>
                  <span className="text-right">Saldo Akhir</span>
                  <span className="text-right">Trx</span>
                </div>
                <Accordion type="multiple" className="w-full">
                  {tampilSemua.map((r) => (
                    <AccordionItem key={r.akun.id} value={r.akun.id}>
                      <AccordionTrigger className="px-1 hover:no-underline">
                        <div className="grid w-full items-center gap-x-4 gap-y-1 pr-3 text-left text-sm md:grid-cols-[minmax(0,1fr)_8.5rem_8.5rem_8.5rem_8.5rem_3.5rem]">
                          <span className="font-medium">
                            {r.akun.kode} - {r.akun.nama}
                            {r.akun.aktif === false && <Badge variant="outline" className="ml-2">Nonaktif</Badge>}
                          </span>
                          <span className="tabular-nums md:text-right">
                            <span className="mr-1 text-xs text-muted-foreground md:hidden">Awal</span>{formatRupiah(Math.round(r.saldoAwal))}
                          </span>
                          <span className="tabular-nums md:text-right">
                            <span className="mr-1 text-xs text-muted-foreground md:hidden">Debit</span>{formatRupiah(Math.round(r.totalDebit))}
                          </span>
                          <span className="tabular-nums md:text-right">
                            <span className="mr-1 text-xs text-muted-foreground md:hidden">Kredit</span>{formatRupiah(Math.round(r.totalKredit))}
                          </span>
                          <span className="font-semibold tabular-nums md:text-right">
                            <span className="mr-1 text-xs font-normal text-muted-foreground md:hidden">Akhir</span>{formatRupiah(Math.round(r.saldoAkhir))}
                          </span>
                          <span className="tabular-nums text-muted-foreground md:text-right">
                            <span className="mr-1 text-xs md:hidden">Trx</span>{r.jumlah}
                          </span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        {periode.valid && (
                          <MutasiAkunMalas
                            akun={r.akun}
                            tglAwal={periode.tglAwal}
                            tglAkhir={periode.tglAkhir}
                            departemenIds={departemenIds}
                            includePenutup={tampilkanPenutup}
                            excludeKoreksi={sembunyikanKoreksi}
                          />
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            )}
            {tampilSemua.length > 0 && (
              <div className="p-3 bg-muted/50 rounded-md grid grid-cols-1 md:grid-cols-2 gap-2 text-right">
                <div>
                  <span className="text-sm text-muted-foreground mr-2">Total Debit ({tampilSemua.length} akun):</span>
                  <span className="font-bold">{formatRupiah(Math.round(totalSemua.totalDebit))}</span>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground mr-2">Total Kredit ({tampilSemua.length} akun):</span>
                  <span className="font-bold">{formatRupiah(Math.round(totalSemua.totalKredit))}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!akunId && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Pilih akun rekening untuk melihat buku besar
          </CardContent>
        </Card>
      )}
    </div>
  );
}
