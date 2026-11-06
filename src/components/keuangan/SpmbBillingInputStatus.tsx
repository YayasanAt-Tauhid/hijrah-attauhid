
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRupiah } from "@/hooks/useKeuangan";
import { canReissueBill } from "@/lib/reissueCancelledBill";
import type { SpmbInputStatus, SpmbInputTagihan } from "@/lib/spmbBillingStatus";

const monthLabel = (periode: string | null) => periode
  ? new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "Asia/Jakarta" }).format(new Date(periode + "T00:00:00Z"))
  : null;

type Props = { value?: SpmbInputStatus; showPeriod?: boolean; onReissue?: (bill: SpmbInputTagihan) => void };

export function SpmbBillingInputStatus({ value, showPeriod = false, onReissue }: Props) {
  if (!value) return <Badge variant="outline">Status belum tersedia</Badge>;
  const created = value.status === "sudah_diinput";
  const review = value.status === "perlu_diperiksa";
  const firstPeriod = value.tagihan[0]?.periode;
  const period = monthLabel(firstPeriod ?? null);
  const reissuable = review && onReissue ? (value.dibatalkan_tagihan ?? []).filter(canReissueBill) : [];
  return <div className="space-y-1">
    <Badge variant={created ? "default" : "secondary"} className={created ? "border-emerald-300 bg-emerald-100 text-emerald-800" : review ? "border-amber-300 bg-amber-50 text-amber-800" : ""}>
      {created ? "Sudah diinput" : review ? "Perlu diperiksa" : "Belum diinput"}
    </Badge>
    {created && <p className="text-xs font-medium">{formatRupiah(value.nominal)}</p>}
    {created && showPeriod && period && <p className="text-xs text-muted-foreground">{period}{value.tagihan.length > 1 ? " · " + value.tagihan.length + " tagihan" : ""}</p>}
    {value.dibatalkan > 0 && <p className="text-xs text-amber-700">{value.dibatalkan} tagihan dibatalkan/dihapusbuku</p>}
    {reissuable.map((bill) => <Button key={bill.id} type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onReissue!(bill)}>
      Terbitkan ulang{monthLabel(bill.periode) ? " " + monthLabel(bill.periode) : ""}
    </Button>)}
  </div>;
}
