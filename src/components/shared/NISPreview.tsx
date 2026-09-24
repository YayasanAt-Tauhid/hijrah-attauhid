import { parseNISComponents } from "@/utils/nisGenerator";

interface NISPreviewProps {
  kodeLembaga: string;
  namaAngkatan: string;
  estimasiUrut: number;
}

export function NISPreview({ kodeLembaga, namaAngkatan, estimasiUrut }: NISPreviewProps) {
  if (!kodeLembaga || !namaAngkatan) return null;

  const c = parseNISComponents(kodeLembaga, namaAngkatan, estimasiUrut);
  if (c.kodeLembaga === "--" || c.tahun2 === "--") return null;

  const segments = [
    { value: c.tahun2, label: "Tahun Masuk", color: "bg-primary/10 text-primary border-primary/30" },
    { value: c.kodeLembaga, label: "Lembaga", color: "bg-accent/50 text-accent-foreground border-accent/30" },
    { value: c.nomorUrut, label: "Urut", color: "bg-secondary text-secondary-foreground border-secondary/50" },
  ];

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Preview NIS (estimasi)</p>
      <div className="flex items-center gap-1">
        {segments.map((seg, index) => (
          <div key={seg.label} className="flex items-center gap-1">
            {index > 0 && <span className="text-muted-foreground">-</span>}
            <div className="flex flex-col items-center gap-1">
              <span className={`px-2 py-1 rounded border text-sm font-mono font-bold ${seg.color}`}>
                {seg.value}
              </span>
              <span className="text-[10px] text-muted-foreground">{seg.label}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        NIS: <span className="font-mono font-semibold text-foreground">{c.tahun2}-{c.kodeLembaga}-{c.nomorUrut}</span>
      </p>
    </div>
  );
}
