import { Checkbox } from "@/components/ui/checkbox";

interface SpmbFieldVerificationProps {
  fieldKey: string;
  checked: boolean;
  disabled?: boolean;
  label?: string;
  required?: boolean;
  onCheckedChange: (fieldKey: string, checked: boolean) => void;
}

export function SpmbFieldVerification({
  fieldKey,
  checked,
  disabled = false,
  required = false,
  label = "Sudah diperiksa",
  onCheckedChange,
}: SpmbFieldVerificationProps) {
  const id = `spmb-field-verification-${fieldKey}`;

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(fieldKey, value === true)}
      />
      <label htmlFor={id} className="cursor-pointer select-none">
        {label}{required && <span className="text-destructive"> *</span>}
      </label>
    </div>
  );
}
