import { History } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatRupiah } from "@/hooks/useKeuangan";
import { useAkrualLog } from "@/hooks/useAkrualLog";
import { formatAkrualWaktu, hasAkrualGalat, type AkrualLogRow } from "@/lib/akrualLog";

function GalatCell({ row }: { row: AkrualLogRow }) {
  if (!hasAkrualGalat(row)) return <span className="text-muted-foreground">Tanpa galat</span>;
  return <div className="space-y-1">
    {row.gagal_total
      ? <Badge variant="destructive">Gagal total</Badge>
      : <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">{row.jumlah_galat} galat</Badge>}
    {row.galat.length > 0 && <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">Lihat rincian</summary>
      <ul className="mt-1 max-h-48 list-disc space-y-0.5 overflow-y-auto pl-4">
        {row.galat.map((pesan, i) => <li key={i}>{pesan}</li>)}
      </ul>
      {row.galat_terpotong && <p className="mt-1 text-muted-foreground">Menampilkan {row.galat.length} dari {row.jumlah_galat} galat.</p>}
    </details>}
  </div>;
}

export function RiwayatAkrualHarian({ limit = 14 }: { limit?: number }) {
  const { data, isLoading, error } = useAkrualLog(limit);
  return <Card>
    <CardHeader className="pb-3">
      <CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4" />Riwayat Akrual Harian</CardTitle>
      <CardDescription>
        Hasil proses otomatis setiap pukul 07.05 WIB: piutang yang diposting, pendapatan yang diakui, dan galat per tagihan.
        Tagihan yang bergalat belum dijurnal.
      </CardDescription>
    </CardHeader>
    <CardContent>
      {isLoading ? <p className="text-sm text-muted-foreground">Memuat riwayat…</p>
        : error ? <p className="text-sm text-destructive">Riwayat akrual belum dapat dimuat.</p>
        : !data?.length ? <p className="text-sm text-muted-foreground">Belum ada riwayat. Pencatatan baru aktif; eksekusi terjadwal berikutnya akan muncul di sini.</p>
        : <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Waktu (WIB)</th><th className="py-2 pr-3 font-medium">Piutang diposting</th>
              <th className="py-2 pr-3 font-medium">Pendapatan diakui</th><th className="py-2 font-medium">Galat</th>
            </tr></thead>
            <tbody>{data.map((row) => <tr key={row.id} className="border-b align-top last:border-0">
              <td className="py-2 pr-3 whitespace-nowrap">{formatAkrualWaktu(row.dijalankan_at)}</td>
              <td className="py-2 pr-3"><div>{row.piutang_diposting} tagihan</div><div className="text-xs text-muted-foreground">{formatRupiah(row.piutang_nominal)}</div></td>
              <td className="py-2 pr-3"><div>{row.pendapatan_diakui} item</div><div className="text-xs text-muted-foreground">{formatRupiah(row.pendapatan_nominal)}</div></td>
              <td className="py-2"><GalatCell row={row} /></td>
            </tr>)}</tbody>
          </table>
        </div>}
    </CardContent>
  </Card>;
}
