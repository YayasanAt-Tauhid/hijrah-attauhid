import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface PortalHeroProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Teks kecil di atas judul, mis. salam pembuka. */
  eyebrow?: ReactNode;
  /** Ikon dekoratif di kanan. */
  icon?: LucideIcon;
  /** Elemen di kiri judul, mis. avatar. */
  leading?: ReactNode;
  className?: string;
}

// Pita hijau berjudul yang dipakai seragam di halaman portal orang tua.
export function PortalHero({
  title,
  subtitle,
  eyebrow,
  icon: Icon,
  leading,
  className,
}: PortalHeroProps) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-3xl bg-emerald-700 px-5 py-6 text-white shadow-sm",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-9 -top-11 h-36 w-36 rounded-full bg-white/10"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-16 right-14 h-28 w-28 rounded-full bg-white/[0.06]"
      />
      <div className="relative flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          {leading}
          <div className="min-w-0">
            {eyebrow && (
              <p className="text-sm leading-snug text-emerald-50/90">{eyebrow}</p>
            )}
            <h1 className="break-words text-[26px] font-extrabold leading-tight tracking-tight">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-2 text-sm leading-snug text-emerald-50/90">{subtitle}</p>
            )}
          </div>
        </div>
        {Icon && (
          <span
            aria-hidden="true"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15"
          >
            <Icon className="h-6 w-6" />
          </span>
        )}
      </div>
    </section>
  );
}
