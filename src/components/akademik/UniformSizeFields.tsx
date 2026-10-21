import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UNIFORM_SIZES, type UniformSize } from "@/lib/ukuranSeragam";

const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50";

export function UniformSizeFields({ department, gender, value, onChange, disabled = false }: {
  department: string;
  gender: string;
  value: UniformSize[];
  onChange: (value: UniformSize[]) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const available = ["SD", "SMP", "SMA", "MTA"].includes(department) && ["L", "P"].includes(gender);
  const update = (index: number, next: UniformSize) => onChange(value.map((item, i) => i === index ? next : item));

  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">Empat jenis seragam mengikuti lembaga tujuan SPMB (jika ada) dan jenis kelamin siswa. Nama jenis seragam bisa diedit untuk siswa ini. Pilih ukuran masing-masing, lalu klik Simpan Perubahan. Ukuran boleh dilengkapi nanti.</p>
    <p className="text-sm font-medium">Lembaga: {department || "Belum dipilih"} · {gender === "L" ? "Ikhwan" : gender === "P" ? "Akhwat" : "Jenis kelamin belum dipilih"}</p>
    {!available && <p role="status" className="rounded-lg border bg-muted/40 p-3 text-sm">{!department || !gender ? "Pilih lembaga dan jenis kelamin terlebih dahulu." : department === "TK" ? "Data jenis dan ukuran seragam TK belum tersedia." : "Data jenis dan ukuran seragam untuk lembaga ini belum tersedia."}</p>}
    {department === "MTA" && <p className="text-sm text-muted-foreground">Nama empat jenis seragam MTA belum ditetapkan. Data tersimpan tetap ditampilkan; nama bisa diisi sesuai kebutuhan.</p>}
    <div className="grid gap-4 md:grid-cols-2">
      {value.map((item, index) => <div key={index} className="min-w-0 space-y-3 rounded-lg border p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Stel {index + 1}</h3>
          <Button type="button" size="sm" variant="ghost" disabled={disabled || !item.ukuran} aria-label={"Kosongkan ukuran stel " + (index + 1)} onClick={() => update(index, { ...item, ukuran: "" })}>Kosongkan ukuran</Button>
        </div>
        <div className="space-y-1">
          <Label htmlFor={id + "-jenis-" + index}>Nama jenis seragam stel {index + 1}</Label>
          <Input id={id + "-jenis-" + index} value={item.jenis} maxLength={80} disabled={disabled || !available} placeholder="Nama jenis seragam" onChange={(event) => update(index, { ...item, jenis: event.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id + "-ukuran-" + index}>Ukuran stel {index + 1}</Label>
          <select id={id + "-ukuran-" + index} className={selectClass} value={item.ukuran} disabled={disabled || !available} onChange={(event) => update(index, { ...item, ukuran: event.target.value })}>
            <option value="">Belum diisi</option>
            {item.ukuran && !UNIFORM_SIZES.includes(item.ukuran) && <option value={item.ukuran}>{item.ukuran} (data tersimpan)</option>}
            {UNIFORM_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </div>
      </div>)}
    </div>
  </div>;
}
