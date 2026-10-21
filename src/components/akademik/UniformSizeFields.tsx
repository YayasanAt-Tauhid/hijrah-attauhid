import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { uniformOptions, type UniformSize } from "@/lib/ukuranSeragam";

const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50";

export function UniformSizeFields({ department, gender, value, onChange, disabled = false }: {
  department: string;
  gender: string;
  value: UniformSize[];
  onChange: (value: UniformSize[]) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const options = uniformOptions(department, gender);
  const available = Object.keys(options).length > 0;
  const update = (index: number, next: UniformSize) => onChange(value.map((item, i) => i === index ? next : item));

  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">Empat stel dapat memiliki ukuran berbeda. Isi sesuai kebutuhan; stel yang belum diperlukan boleh dikosongkan. Pilihan mengikuti lembaga tujuan SPMB (jika ada) dan jenis kelamin siswa.</p>
    <p className="text-sm font-medium">Lembaga: {department || "Belum dipilih"} · {gender === "L" ? "Putra" : gender === "P" ? "Putri" : "Jenis kelamin belum dipilih"}</p>
    {!available && <p role="status" className="rounded-lg border bg-muted/40 p-3 text-sm">{!department || !gender ? "Pilih lembaga dan jenis kelamin terlebih dahulu." : department === "TK" ? "Data jenis dan ukuran seragam TK belum tersedia." : "Data jenis dan ukuran seragam untuk lembaga dan jenis kelamin ini belum tersedia."}</p>}
    <div className="grid gap-4 md:grid-cols-2">
      {value.map((item, index) => {
        const sizes = options[item.jenis] || [];
        return <div key={index} className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold">Stel {index + 1}</h3>
            <Button type="button" size="sm" variant="ghost" disabled={disabled || (!item.jenis && !item.ukuran)} aria-label={"Kosongkan stel " + (index + 1)} onClick={() => update(index, { jenis: "", ukuran: "" })}>Kosongkan</Button>
          </div>
          <div className="space-y-1">
            <Label htmlFor={id + "-jenis-" + index}>Jenis seragam stel {index + 1}</Label>
            <select id={id + "-jenis-" + index} className={selectClass} value={item.jenis} disabled={disabled || !available} onChange={(event) => {
              const jenis = event.target.value;
              const choices = options[jenis] || [];
              update(index, { jenis, ukuran: choices.length === 1 ? choices[0] : "" });
            }}>
              <option value="">Pilih jenis seragam</option>
              {item.jenis && !options[item.jenis] && <option value={item.jenis}>{item.jenis} (pilih ulang)</option>}
              {Object.keys(options).map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={id + "-ukuran-" + index}>Ukuran stel {index + 1}</Label>
            <select id={id + "-ukuran-" + index} className={selectClass} value={item.ukuran} disabled={disabled || !available || !options[item.jenis]} onChange={(event) => update(index, { ...item, ukuran: event.target.value })}>
              <option value="">Pilih ukuran</option>
              {item.ukuran && !sizes.includes(item.ukuran) && <option value={item.ukuran}>{item.ukuran} (pilih ulang)</option>}
              {sizes.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </div>
        </div>;
      })}
    </div>
  </div>;
}
