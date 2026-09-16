import { ReactNode, useEffect, useState } from "react";

interface FormSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

const SPMB_PROMO_START_AT = Date.parse("2026-09-20T17:00:00.000Z");
const SPMB_PROMO_END_AT = Date.parse("2026-10-23T17:00:00.000Z");

function formatCountdown(target: number, now: number) {
  const totalSeconds = Math.max(0, Math.floor((target - now) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${days} hari ${String(hours).padStart(2, "0")} jam ${String(minutes).padStart(2, "0")} menit ${String(seconds).padStart(2, "0")} detik`;
}

function SpmbPromoBanner() {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (now >= SPMB_PROMO_END_AT) return null;

  const promoActive = now >= SPMB_PROMO_START_AT;
  const target = promoActive ? SPMB_PROMO_END_AT : SPMB_PROMO_START_AT;

  return (
    <div className="overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-yellow-50 to-emerald-50 shadow-sm">
      <div className="space-y-3 px-4 py-5 text-center sm:px-6">
        <div>
          <p className="text-lg font-bold text-emerald-900">🎉 Gratis Biaya Pendaftaran Gelombang Pertama</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-700">
            Daftarkan calon murid pada periode <strong>21 September–23 Oktober 2026</strong> dan dapatkan <strong>gratis biaya pendaftaran</strong>.
          </p>
        </div>

        <div className="mx-auto max-w-xl rounded-xl border border-amber-200/80 bg-white/80 px-4 py-3 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {promoActive ? "Promo berakhir dalam" : "Gelombang Pertama dimulai dalam"}
          </p>
          <p className="mt-1 font-mono text-sm font-bold tabular-nums text-emerald-800 sm:text-base">
            ⏳ {formatCountdown(target, now)}
          </p>
        </div>

        <p className="text-xs text-slate-600">
          📅 Periode Gelombang Pertama: <strong>21 September–23 Oktober 2026</strong>
        </p>
      </div>
    </div>
  );
}

export function FormSection({ title, description, children, className }: FormSectionProps) {
  const pathname = typeof window !== "undefined" ? window.location.pathname : "";
  const showSpmbPromo = (pathname === "/spmb" || pathname === "/pmb") && title === "Data Diri Murid";

  return (
    <>
      {showSpmbPromo && <SpmbPromoBanner />}
      <section
        className={`overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm transition-shadow duration-200 hover:shadow-md ${className || ""}`}
      >
        <div className="border-b border-emerald-100 bg-gradient-to-r from-emerald-50/90 via-teal-50/50 to-white px-4 py-4 sm:px-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white shadow-sm">
              <span aria-hidden="true">✓</span>
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold tracking-tight text-slate-800">{title}</h3>
              {description && <p className="mt-0.5 text-sm leading-relaxed text-slate-500">{description}</p>}
            </div>
          </div>
        </div>
        <div className="space-y-4 px-4 py-5 sm:px-5 sm:py-6">{children}</div>
      </section>
    </>
  );
}
