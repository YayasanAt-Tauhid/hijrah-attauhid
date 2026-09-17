import { SpmbFieldVerification } from "@/components/akademik/SpmbFieldVerification";

type FieldVerificationProps = {
  fieldKey: string;
  label?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (fieldKey: string, checked: boolean) => void;
};

export function FieldVerification({
  fieldKey,
  label = "Sudah diperiksa",
  checked,
  disabled,
  onCheckedChange,
}: FieldVerificationProps) {
  return (
    <div className="mt-2">
      <SpmbFieldVerification
        fieldKey={fieldKey}
        label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}
