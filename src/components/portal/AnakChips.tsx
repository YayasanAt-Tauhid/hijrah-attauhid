import { cn } from "@/lib/utils";
import { inisialNama } from "@/lib/portalAnak";

export interface AnakPilihan {
  id: string;
  nama: string;
}

interface AnakChipsProps {
  anak: AnakPilihan[];
  selectedId: string;
  onSelect: (id: string) => void;
}

// Pemilih anak berupa chip. Hanya muncul bila ada lebih dari satu anak;
// untuk satu anak, pakai AnakInfo.
export function AnakChips({ anak, selectedId, onSelect }: AnakChipsProps) {
  if (anak.length < 2) return null;
  return (
    <div role="group" aria-label="Pilih anak" className="flex flex-wrap gap-2">
      {anak.map((item) => {
        const aktif = item.id === selectedId;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={aktif}
            onClick={() => onSelect(item.id)}
            title={item.nama}
            className={cn(
              "flex min-h-11 max-w-full items-center gap-2 rounded-full border py-0 pl-1.5 pr-3.5 text-sm font-bold transition-colors",
              aktif
                ? "border-emerald-700 bg-emerald-700 text-white"
                : "border-border bg-card text-foreground hover:bg-muted",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold",
                aktif ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-900",
              )}
            >
              {inisialNama(item.nama)}
            </span>
            <span className="max-w-[10rem] truncate">{item.nama}</span>
          </button>
        );
      })}
    </div>
  );
}

// Penanda anak saat akun hanya punya satu anak (tidak perlu memilih).
export function AnakInfo({ nama, nis }: { nama: string; nis?: string | null }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-sm">
      <span
        aria-hidden="true"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-700 text-[15px] font-bold text-white"
      >
        {inisialNama(nama)}
      </span>
      <div className="min-w-0">
        <p className="break-words text-base font-bold leading-snug">{nama}</p>
        <p className="text-xs text-muted-foreground">NIS {nis || "-"}</p>
      </div>
    </div>
  );
}
