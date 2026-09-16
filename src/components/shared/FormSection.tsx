import { ReactNode } from "react";

interface FormSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function FormSection({ title, description, children, className }: FormSectionProps) {
  return (
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
  );
}
