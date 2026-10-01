import { cn } from "@/lib/utils";
import { YAYASAN_LOGO_URL } from "@/lib/branding";

interface BrandLogoProps {
  className?: string;
}

export function BrandLogo({ className }: BrandLogoProps) {
  return (
    <img
      src={YAYASAN_LOGO_URL}
      alt="Logo Hijrah At-Tauhid"
      className={cn("object-contain", className)}
    />
  );
}
