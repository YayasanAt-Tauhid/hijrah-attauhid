import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type ReceiptPrintOrientation = "landscape" | "portrait";

interface ReceiptOrientationSelectProps {
  value: ReceiptPrintOrientation;
  onValueChange: (value: ReceiptPrintOrientation) => void;
  id?: string;
}

export function ReceiptOrientationSelect({
  value,
  onValueChange,
  id = "receipt-print-orientation",
}: ReceiptOrientationSelectProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Orientasi Cetak</Label>
      <Select value={value} onValueChange={(next) => onValueChange(next as ReceiptPrintOrientation)}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="landscape">Landscape — disarankan</SelectItem>
          <SelectItem value="portrait">Portrait</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Landscape disarankan untuk kertas continuous form 9,5 × 5,5 inci.
      </p>
    </div>
  );
}
