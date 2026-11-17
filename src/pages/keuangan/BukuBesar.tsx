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
import { ChevronsUpDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { useAkunRekening, useAkunRekeningSemua, useBukuBesar, useBukuBesarSemua } from "@/hooks/useJurnal";
import { useDepartemenGroups } from "@/hooks/useISAK35";
import { formatRupiah, namaBulan } from "@/hooks/useKeuangan";
import {
  BULAN_KALENDER, buildBukuBesarSemuaAoa, buildBukuBesarSingleAoa, bukuBesarFilename, hitungSaldoBerjalan,
  kelompokkanPerAkun, labelPeriode, parseTahunInput, periodeBukuBesar, type MutasiBBSaldo,
} from "@/lib/bukuBesar";
import { downloadAoaCsv, downloadAoaXlsx } from "@/lib/jurnalExport";
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
  } = useBukuBesarSemua({
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

  const groupsSemua = useMemo(() => {
    if (!modeSemua || !akunSemua || !dataSemua) return [];
    return kelompokkanPerAkun(akunSemua, dataSemua.saldoAwal, dataSemua.mutasi);
  }, [modeSemua, akunSemua, dataSemua]);
  const totalDebitSemua = groupsSemua.reduce((s, g) => s + g.totalDebit, 0);
  const totalKreditSemua = groupsSemua.reduce((s, g) => s + g.totalKredit, 0);

  const exportSingle = (tipe: "xlsx" | "csv") => {
    if (!periode.valid || !selectedAkun) return;
    const aoa = buildBukuBesarSingleAoa({ akun: selectedAkun, unitLabel: labelUnit, periodeLabel, saldoAwal, rows: computedData });
    const nama = bukuBesarFilename({ kode: selectedAkun.kode, tglAwal: periode.tglAwal, tglAkhir: periode.tglAkhir });
    if (tipe === "xlsx") downloadAoaXlsx(aoa, nama, "Buku Besar");
    else downloadAoaCsv(aoa, nama);
  };

  const exportSemua = (tipe: "xlsx" | "csv") => {
    if (!periode.valid || groupsSemua.length === 0) return;
    const aoa = buildBukuBesarSemuaAoa({ unitLabel: labelUnit, periodeLabel, groups: groupsSemua });
    const nama = bukuBesarFilename({ kode: null, tglAwal: periode.tglAwal, tglAkhir: periode.tglAkhir });
    if (tipe === "xlsx") downloadAoaXlsx(aoa, nama, "Buku Besar");
    else downloadAoaCsv(aoa, nama);
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
        <p className="text-sm text-destructive">Gagal memuat buku besar semua akun: {getErrorMessage(errorSemua)}</p>
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
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div><span className="text-muted-foreground">Akun:</span> <span className="font-semibold">Semua akun rekening</span></div>
              <div><span className="text-muted-foreground">Unit:</span> <span className="font-semibold">{labelUnit}</span></div>
              <div><span className="text-muted-foreground">Periode:</span> <span className="font-semibold">{periodeLabel || "-"}</span></div>
            </div>
          </CardContent>
        </Card>
      )}

      {akunId && !modeSemua && (
        <Card>
          <CardContent className="pt-6">
            {periode.valid && (
              <div className="mb-3 p-3 bg-muted/50 rounded-md flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Saldo Awal per {tglPendek(periode.tglAwal)} ({labelUnit})
                </span>
                <span className="font-semibold">{formatRupiah(Math.round(saldoAwal))}</span>
              </div>
            )}
            <DataTable
              columns={columns}
              data={computedData}
              loading={isLoading}
              pageSize={50}
              actions={
                <ExportMenu
                  disabled={!periode.valid || (computedData.length === 0 && saldoAwal === 0)}
                  onExcel={() => exportSingle("xlsx")}
                  onCsv={() => exportSingle("csv")}
                  onPrint={() => window.print()}
                />
              }
            />
            {computedData.length > 0 && (
              <div className="mt-4 p-3 bg-muted/50 rounded-md grid grid-cols-1 md:grid-cols-3 gap-2 text-right">
                <div>
                  <span className="text-sm text-muted-foreground mr-2">Total Debit:</span>
                  <span className="font-bold">{formatRupiah(Math.round(totalDebit))}</span>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground mr-2">Total Kredit:</span>
                  <span className="font-bold">{formatRupiah(Math.round(totalKredit))}</span>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground mr-2">Saldo Akhir:</span>
                  <span className="text-lg font-bold">{formatRupiah(Math.round(saldoAkhir))}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {modeSemua && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">
                {loadingSemua ? "Memuat buku besar semua akun..." : `${groupsSemua.length} akun memiliki saldo awal atau mutasi pada periode ini`}
              </span>
              <ExportMenu
                loading={loadingSemua}
                disabled={!periode.valid || groupsSemua.length === 0}
                onExcel={() => exportSemua("xlsx")}
                onCsv={() => exportSemua("csv")}
                onPrint={() => window.print()}
              />
            </div>
            {!loadingSemua && periode.valid && groupsSemua.length === 0 && !isErrorSemua && (
              <p className="py-8 text-center text-muted-foreground">Tidak ada saldo awal atau mutasi pada periode dan unit ini.</p>
            )}
            {groupsSemua.length > 0 && (
              <Accordion type="multiple" className="w-full">
                {groupsSemua.map((g) => (
                  <AccordionItem key={g.akun.id} value={g.akun.id}>
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex w-full flex-wrap items-center justify-between gap-x-6 gap-y-1 pr-3 text-left text-sm">
                        <span className="font-medium">
                          {g.akun.kode} - {g.akun.nama}
                          {g.akun.aktif === false && <Badge variant="outline" className="ml-2">Nonaktif</Badge>}
                        </span>
                        <span className="flex flex-wrap gap-x-4 text-xs text-muted-foreground tabular-nums">
                          <span>Awal {formatRupiah(Math.round(g.saldoAwal))}</span>
                          <span>Debit {formatRupiah(Math.round(g.totalDebit))}</span>
                          <span>Kredit {formatRupiah(Math.round(g.totalKredit))}</span>
                          <span className="font-semibold text-foreground">Akhir {formatRupiah(Math.round(g.saldoAkhir))}</span>
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <MutasiTable saldoAwal={g.saldoAwal} rows={g.rows} />
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
            {groupsSemua.length > 0 && (
              <div className="p-3 bg-muted/50 rounded-md grid grid-cols-1 md:grid-cols-2 gap-2 text-right">
                <div>
                  <span className="text-sm text-muted-foreground mr-2">Total Debit (semua akun):</span>
                  <span className="font-bold">{formatRupiah(Math.round(totalDebitSemua))}</span>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground mr-2">Total Kredit (semua akun):</span>
                  <span className="font-bold">{formatRupiah(Math.round(totalKreditSemua))}</span>
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
