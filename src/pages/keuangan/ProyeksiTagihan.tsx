import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExportButton, type ExportColumn } from "@/components/shared/ExportButton";
import { formatRupiah, namaBulan, useLembaga } from "@/hooks/useKeuangan";
import { useRingkasanTagihanPeriode } from "@/hooks/useProyeksiTagihan";
import { ringkasTahun, susunMatriks } from "@/lib/proyeksiTagihan";

type Tampilan = "bulanan" | "tahunan";

const BULAN = Array.from({ length: 12 }, (_, i) => i + 1);
const nilaiAtauStrip = (v: number) => (v > 0 ? formatRupiah(v) : "–");

function Kartu({ id, judul, children }: { id: string; judul: string; children: React.ReactNode }) {
  return (
    <div data-testid={id} className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{judul}</p>
      <div className="mt-1 space-y-0.5">{children}</div>
    </div>
  );
}

export default function ProyeksiTagihan() {
  const tahunIni = new Date().getFullYear();
  const [tahun, setTahun] = useState(tahunIni);
  const [lembagaId, setLembagaId] = useState("semua");
  const [tampilan, setTampilan] = useState<Tampilan>("bulanan");

  const { data: lembagaData } = useLembaga();
  const daftarLembaga = (lembagaData ?? []) as { id: string; kode: string; nama: string }[];
  const { data, isLoading, isError, error } = useRingkasanTagihanPeriode({
    tahun,
    departemenId: lembagaId === "semua" ? undefined : lembagaId,
  });

  const matriks = useMemo(() => susunMatriks(data ?? []), [data]);
  const ringkas = useMemo(() => ringkasTahun(matriks), [matriks]);
  const adaData = (data?.length ?? 0) > 0;
  const kodeLembaga = lembagaId === "semua" ? "semua" : (daftarLembaga.find((l) => l.id === lembagaId)?.kode ?? "lembaga");

  const exportBulanan = useMemo(() => {
    const kolom: ExportColumn[] = [
      { key: "kode", label: "Lembaga" },
      ...BULAN.map((b) => ({ key: `b${b}`, label: namaBulan(b) })),
      { key: "total", label: "Total" },
    ];
    const baris = [
      ...matriks.lembaga.map((l) => ({
        kode: l.kode,
        ...Object.fromEntries(BULAN.map((b) => [`b${b}`, l.perBulan[b - 1]])),
        total: l.neto,
      })),
      { kode: "Total", ...Object.fromEntries(BULAN.map((b) => [`b${b}`, matriks.netoPerBulan[b - 1]])), total: matriks.total.neto },
    ];
    return { kolom, baris };
  }, [matriks]);

  const exportTahunan = useMemo(() => {
    const kolom: ExportColumn[] = [
      { key: "kode", label: "Lembaga" },
      { key: "tagihan", label: "Tagihan" },
      { key: "bruto", label: "Bruto" },
      { key: "potongan", label: "Potongan" },
      { key: "neto", label: "Neto" },
      { key: "terbayar", label: "Terbayar" },
      { key: "sisa", label: "Sisa" },
    ];
    const ke = (kode: string, t: { jumlahTagihan: number; bruto: number; potongan: number; neto: number; terbayar: number; sisa: number }) => ({
      kode, tagihan: t.jumlahTagihan, bruto: t.bruto, potongan: t.potongan, neto: t.neto, terbayar: t.terbayar, sisa: t.sisa,
    });
    return { kolom, baris: [...matriks.lembaga.map((l) => ke(l.kode, l)), ke("Total", matriks.total)] };
  }, [matriks]);

  const ekspor = tampilan === "bulanan" ? exportBulanan : exportTahunan;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Proyeksi Tagihan SPP</h1>
          <p className="text-xs text-muted-foreground">
            Perkiraan tagihan SPP per lembaga dan bulan dari tagihan yang sudah terjadwal
          </p>
        </div>
        <ExportButton
          data={adaData ? ekspor.baris : []}
          columns={ekspor.kolom}
          filename={`proyeksi-tagihan-spp-${tahun}-${kodeLembaga}-${tampilan}`}
          sheetName="Proyeksi Tagihan"
        />
      </div>

      <div className="flex flex-wrap items-end gap-3 border-b border-border pb-3">
        <div className="space-y-1">
          <Label className="text-xs">Tahun</Label>
          <Select value={String(tahun)} onValueChange={(v) => setTahun(Number(v))}>
            <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[tahunIni - 1, tahunIni, tahunIni + 1, tahunIni + 2].map((t) => (
                <SelectItem key={t} value={String(t)}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Lembaga</Label>
          <Select value={lembagaId} onValueChange={setLembagaId}>
            <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="semua">Semua lembaga</SelectItem>
              {daftarLembaga.map((l) => <SelectItem key={l.id} value={l.id}>{l.kode} — {l.nama}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tampilan</Label>
          <div className="flex gap-1">
            <Button size="sm" className="h-8 text-xs" variant={tampilan === "bulanan" ? "default" : "outline"} aria-pressed={tampilan === "bulanan"} onClick={() => setTampilan("bulanan")}>Bulanan</Button>
            <Button size="sm" className="h-8 text-xs" variant={tampilan === "tahunan" ? "default" : "outline"} aria-pressed={tampilan === "tahunan"} onClick={() => setTampilan("tahunan")}>Tahunan</Button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-48" />
        </div>
      ) : isError ? (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">Gagal memuat proyeksi tagihan</p>
          <p className="text-xs text-muted-foreground">{error instanceof Error ? error.message : "Terjadi kesalahan"}</p>
        </div>
      ) : !adaData ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Belum ada tagihan SPP untuk tahun {tahun}{lembagaId === "semua" ? "" : ` di ${kodeLembaga}`}.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Kartu id="kartu-total-neto" judul={`Total Neto Setahun (${tahun})`}>
              <p className="text-lg font-semibold">{formatRupiah(ringkas.totalNeto)}</p>
            </Kartu>
            <Kartu id="kartu-rata-rata" judul="Rata-rata per Bulan">
              <p className="text-lg font-semibold">{formatRupiah(Math.round(ringkas.rataPerBulan))}</p>
            </Kartu>
            <Kartu id="kartu-bulan-tertinggi" judul="Bulan Tertinggi">
              {ringkas.bulanTertinggi ? (
                <>
                  <p className="text-lg font-semibold">{namaBulan(ringkas.bulanTertinggi.bulan)}</p>
                  <p className="text-xs text-muted-foreground">{formatRupiah(ringkas.bulanTertinggi.nilai)}</p>
                </>
              ) : (
                <p className="text-lg font-semibold">–</p>
              )}
            </Kartu>
          </div>

          <p className="text-xs text-muted-foreground">
            Neto = tagihan SPP terjadwal setelah potongan, belum tentu sudah dibayar. Tagihan yang dibatalkan tidak dihitung.
          </p>

          {tampilan === "bulanan" ? (
            <Table containerClassName="rounded-lg border border-border">
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Lembaga</TableHead>
                  {BULAN.map((b) => <TableHead key={b} className="whitespace-nowrap text-right">{namaBulan(b)}</TableHead>)}
                  <TableHead className="whitespace-nowrap text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matriks.lembaga.map((l) => (
                  <TableRow key={l.departemen_id}>
                    <TableCell className="font-medium">{l.kode}</TableCell>
                    {l.perBulan.map((v, i) => <TableCell key={i} className="whitespace-nowrap text-right tabular-nums">{nilaiAtauStrip(v)}</TableCell>)}
                    <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatRupiah(l.neto)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  {matriks.netoPerBulan.map((v, i) => <TableCell key={i} className="whitespace-nowrap text-right font-semibold tabular-nums">{nilaiAtauStrip(v)}</TableCell>)}
                  <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatRupiah(matriks.total.neto)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          ) : (
            <Table containerClassName="rounded-lg border border-border">
              <TableHeader>
                <TableRow>
                  <TableHead>Lembaga</TableHead>
                  <TableHead className="text-right">Tagihan</TableHead>
                  <TableHead className="text-right">Bruto</TableHead>
                  <TableHead className="text-right">Potongan</TableHead>
                  <TableHead className="text-right">Neto</TableHead>
                  <TableHead className="text-right">Terbayar</TableHead>
                  <TableHead className="text-right">Sisa</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matriks.lembaga.map((l) => (
                  <TableRow key={l.departemen_id}>
                    <TableCell className="font-medium">{l.kode}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.jumlahTagihan.toLocaleString("id-ID")}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(l.bruto)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(l.potongan)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatRupiah(l.neto)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(l.terbayar)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(l.sisa)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{matriks.total.jumlahTagihan.toLocaleString("id-ID")}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatRupiah(matriks.total.bruto)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatRupiah(matriks.total.potongan)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatRupiah(matriks.total.neto)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatRupiah(matriks.total.terbayar)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatRupiah(matriks.total.sisa)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </>
      )}
    </div>
  );
}
