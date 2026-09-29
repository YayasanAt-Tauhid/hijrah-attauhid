import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface RupiahInputProps {
  /** Nilai mentah berupa string digit, mis. "150000" */
  value: string;
  onChange: (raw: string) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
}

/**
 * Input nominal Rupiah dengan pemisah ribuan otomatis (tampil "1.500.000",
 * tersimpan "1500000"). Hanya menerima digit — mencegah nilai negatif/desimal.
 */
export function RupiahInput({
  value,
  onChange,
  id,
  placeholder = "0",
  disabled = false,
  readOnly = false,
  className,
}: RupiahInputProps) {
  const formatted = value ? Number(value).toLocaleString("id-ID") : "";
  return (
    <div className={cn("relative", className)}>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
        Rp
      </span>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        className={cn("pl-9", readOnly && "bg-muted/40 cursor-default")}
        value={formatted}
        disabled={disabled}
        readOnly={readOnly}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 13);
          onChange(raw);
        }}
      />
    </div>
  );
}
