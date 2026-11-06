import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportButton } from "@/components/shared/ExportButton";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatRupiah } from "@/hooks/useKeuangan";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { susunNeracaAkuntansi, type AkunNeraca } from "@/lib/neracaAkuntansi";

export default function TabNeracaAkuntansi({ departemenId }: { departemenId?: string }) {
  const [tanggal, setTanggal] = useState<Date>(new Date());
  const [showZero, setShowZero] = useState(false);
  const tanggalStr = format(tanggal, "yyyy-MM-dd");

  const { data: akunList } = useQuery({
    queryKey: ["akun_rekening_all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("akun_rekening")
        .select("id, kode, nama, jenis, pos_isak35, saldo_normal, saldo_awal")
        .eq("aktif", true)
        .order("kode");
      if (error) throw error;
      return data;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["neraca_akuntansi", tanggalStr, departemenId],
    enabled: !!akunList,
    queryFn: async () => {
      // Fetch semua jurnal_detail dengan pagination (hindari limit 1000 baris)
      let allDetails: any[] = [];
      let from = 0;
      const batchSize = 1000; // PostgREST max_rows = 1000 — minta lebih tetap dipotong 1000
      while (true) {
        let q = supabase
          .from("jurnal_detail")
          .select("debit, kredit, akun_id, jurnal:jurnal_id!inner(tanggal, status, departemen_id)")
          .eq("jurnal.status", "posted")
          .lte("jurnal.tanggal", tanggalStr);
        if (departemenId) q = q.eq("jurnal.departemen_id", departemenId);
        // Urutan stabil wajib agar paginasi range tidak duplikat/bolong antar halaman
        const { data: details, error } = await q.order("id").range(from, from + batchSize - 1);
        if (error) throw error;
        if (!details || details.length === 0) break;
        allDetails = allDetails.concat(details);
        if (details.length < batchSize) break;
        from += batchSize;
      }

      const mutasiMap = new Map<string, { debit: number; kredit: number }>();
      allDetails.forEach((row: any) => {
        const id = row.akun_id;
        if (!id) return;
        if (!mutasiMap.has(id)) mutasiMap.set(id, { debit: 0, kredit: 0 });
        const m = mutasiMap.get(id)!;
        m.debit += Number(row.debit || 0);
        m.kredit += Number(row.kredit || 0);
      });

      return susunNeracaAkuntansi(akunList ?? [], mutasiMap);
    },
  });

  const items = data?.items || [];
  const surplusDefisit = data?.surplusDefisit || 0;

  const filterSaldo = (list: AkunNeraca[]) =>
    showZero ? list : list.filter((a) => Math.abs(a.saldo) >= 1);

  const aset = filterSaldo(items.filter((a) => a.kelompok === "aset"));
  const kewajiban = filterSaldo(items.filter((a) => a.kelompok === "kewajiban"));
  const asetNeto = filterSaldo(items.filter((a) => a.kelompok === "aset_neto"));

  const totalAset = items.filter((a) => a.kelompok === "aset").reduce((s, a) => s + a.saldo, 0);
  const totalKewajiban = items.filter((a) => a.kelompok === "kewajiban").reduce((s, a) => s + a.saldo, 0);
  const totalAsetNetoAkun = items.filter((a) => a.kelompok === "aset_neto").reduce((s, a) => s + a.saldo, 0);
  // Sesuai ISAK 35: Total Aset Neto = saldo akun aset neto + surplus/defisit berjalan
  const totalAsetNeto = totalAsetNetoAkun + surplusDefisit;
  const totalKA = totalKewajiban + totalAsetNeto;
  const seimbang = Math.abs(totalAset - totalKA) < 1;

  const exportData = [
    ...items,
    ...(Math.abs(surplusDefisit) >= 1
      ? [{ kode: "", nama: "Surplus (Defisit) Berjalan", kelompok: "aset_neto", saldo: surplusDefisit }]
      : []),
  ];

  return (
    <div className="space-y-4 pt-4">
      <div className="flex flex-wrap gap-3 items-end justify-between">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <Label>Per Tanggal</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("w-[200px] justify-start text-left font-normal", !tanggal && "text-muted-foreground")}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {format(tanggal, "dd MMMM yyyy", { locale: idLocale })}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={tanggal} onSelect={(d) => d && setTanggal(d)} initialFocus className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex items-center gap-2 pb-1">
            <Switch id="show-zero" checked={showZero} onCheckedChange={setShowZero} />
            <Label htmlFor="show-zero" className="text-sm cursor-pointer">Tampilkan saldo nol</Label>
          </div>
        </div>
        <ExportButton
          data={exportData as any}
          filename={`neraca-${tanggalStr}`}
          columns={[
            { key: "kode", label: "Kode" },
            { key: "nama", label: "Nama Akun" },
            { key: "kelompok", label: "Kelompok ISAK 35" },
            { key: "saldo", label: "Saldo" },
          ]}
        />
      </div>

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center mb-4">
                <h2 className="text-lg font-bold">NERACA</h2>
                <p className="text-sm text-muted-foreground">Per Tanggal: {format(tanggal, "dd MMMM yyyy", { locale: idLocale })}</p>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                {/* Kiri: ASET */}
                <div>
                  <h3 className="font-semibold mb-2">ASET</h3>
                  {aset.map((a) => (
                    <div key={a.kode} className="flex justify-between py-1 pl-4 text-sm">
                      <span>{a.kode} {a.nama}</span>
                      <span className="font-medium">{formatRupiah(a.saldo)}</span>
                    </div>
                  ))}
                  {aset.length === 0 && <p className="text-sm text-muted-foreground pl-4">Tidak ada data</p>}
                  <div className="border-t mt-2 pt-2 flex justify-between font-bold">
                    <span>Total Aset</span><span>{formatRupiah(totalAset)}</span>
                  </div>
                  <div className="border-t-2 border-double mt-4 pt-2 flex justify-between font-bold text-base">
                    <span>TOTAL ASET</span><span>{formatRupiah(totalAset)}</span>
                  </div>
                </div>

                {/* Kanan: LIABILITAS + ASET NETO (ISAK 35) */}
                <div>
                  <h3 className="font-semibold mb-2">LIABILITAS</h3>
                  {kewajiban.map((a) => (
                    <div key={a.kode} className="flex justify-between py-1 pl-4 text-sm">
                      <span>{a.kode} {a.nama}</span>
                      <span className="font-medium">{formatRupiah(a.saldo)}</span>
                    </div>
                  ))}
                  {kewajiban.length === 0 && <p className="text-sm text-muted-foreground pl-4">Tidak ada data</p>}
                  <div className="border-t mt-2 pt-2 flex justify-between font-bold">
                    <span>Total Liabilitas</span><span>{formatRupiah(totalKewajiban)}</span>
                  </div>

                  <h3 className="font-semibold mb-2 mt-4">ASET NETO</h3>
                  {asetNeto.map((a) => (
                    <div key={a.kode} className="flex justify-between py-1 pl-4 text-sm">
                      <span>{a.kode} {a.nama}</span>
                      <span className="font-medium">{formatRupiah(a.saldo)}</span>
                    </div>
                  ))}
                  {Math.abs(surplusDefisit) >= 1 && (
                    <div className="flex justify-between py-1 pl-4 text-sm italic">
                      <span>Surplus (Defisit) Berjalan</span>
                      <span className={cn("font-medium", surplusDefisit < 0 && "text-destructive")}>
                        {formatRupiah(surplusDefisit)}
                      </span>
                    </div>
                  )}
                  {asetNeto.length === 0 && Math.abs(surplusDefisit) < 1 && (
                    <p className="text-sm text-muted-foreground pl-4">Tidak ada data</p>
                  )}
                  <div className="border-t mt-2 pt-2 flex justify-between font-bold">
                    <span>Total Aset Neto</span><span>{formatRupiah(totalAsetNeto)}</span>
                  </div>

                  <div className="border-t-2 border-double mt-4 pt-2 flex justify-between font-bold text-base">
                    <span>TOTAL LIABILITAS + ASET NETO</span><span>{formatRupiah(totalKA)}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-center">
            {seimbang ? (
              <Badge variant="default" className="bg-success text-success-foreground text-sm px-4 py-1">
                ✓ Neraca Seimbang
              </Badge>
            ) : (
              <Badge variant="destructive" className="text-sm px-4 py-1">
                ⚠ Neraca Tidak Seimbang (selisih: {formatRupiah(Math.abs(totalAset - totalKA))})
              </Badge>
            )}
          </div>
        </>
      )}
    </div>
  );
}
