import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { RupiahInput } from "@/components/shared/RupiahInput";
import { Plus, History, Info } from "lucide-react";
import { formatRupiah, useAllJenisPembayaran } from "@/hooks/useKeuangan";
import {
  useSkemaDiskon,
  useKebijakanKeringanan,
  useBuatVersiKebijakanKeringanan,
  type KebijakanKeringanan,
} from "@/hooks/useDiskon";

const SCOPE_OPTIONS = [
  { value: "__all__", label: "Semua kelas", regex: null },
  { value: "mta_reguler", label: "MTA 2, 3, 5, 6", regex: "^MTA (2|3|5|6)$" },
  { value: "mta4", label: "MTA 4 saja", regex: "^MTA 4$" },
  { value: "tka", label: "TK A", regex: "^TK A" },
  { value: "tkb", label: "TK B", regex: "^TK B" },
] as const;

function scopeFromRegex(regex?: string | null) {
  return SCOPE_OPTIONS.find((x) => x.regex === (regex || null))?.value || "__all__";
}

function slug(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function formatTanggal(value?: string | null) {
  if (!value) return "seterusnya";
  const d = new Date(value + "T00:00:00");
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

export default function TabKebijakanKeringanan() {
  const { data: policies, isLoading } = useKebijakanKeringanan();
  const { data: skemaList } = useSkemaDiskon(true);
  const { data: jenisList } = useAllJenisPembayaran();
  const createMut = useBuatVersiKebijakanKeringanan();

  const [open, setOpen] = useState(false);
  const [base, setBase] = useState<KebijakanKeringanan | null>(null);
  const [nama, setNama] = useState("");
  const [kode, setKode] = useState("");
  const [skemaId, setSkemaId] = useState("");
  const [jenisId, setJenisId] = useState("");
  const [scope, setScope] = useState("__all__");
  const [nilai, setNilai] = useState("0");
  const [mulai, setMulai] = useState("");
  const [selesai, setSelesai] = useState("");
  const [otomatis, setOtomatis] = useState(false);
  const [perluPengajuan, setPerluPengajuan] = useState(true);
  const [keterangan, setKeterangan] = useState("");

  const skema = skemaList?.find((x) => x.id === skemaId);
  const jenis = (jenisList as any[] | undefined)?.find((x) => x.id === jenisId);
  const scopeDef = SCOPE_OPTIONS.find((x) => x.value === scope) || SCOPE_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    setNama(base?.nama ?? "");
    setKode(base?.kode ?? "");
    setSkemaId(base?.skema_diskon_id ?? "");
    setJenisId(base?.jenis_id ?? "");
    setScope(scopeFromRegex(base?.kelas_regex));
    setNilai(String(base?.nilai ?? 0));
    setMulai("");
    setSelesai("");
    setOtomatis(base?.otomatis ?? false);
    setPerluPengajuan(base?.perlu_pengajuan ?? true);
    setKeterangan(base?.keterangan ?? "");
  }, [open, base]);

  const nilaiNum = Number(nilai || 0);
  const kodeOtomatis = useMemo(() => {
    if (kode.trim()) return kode.trim();
    return slug(
      [skema?.nama || "kebijakan", jenis?.nama || "tagihan", scopeDef.value]
        .filter(Boolean)
        .join("_")
    );
  }, [kode, skema?.nama, jenis?.nama, scopeDef.value]);

  const errors: string[] = [];
  if (!nama.trim()) errors.push("Nama kebijakan wajib diisi");
  if (!skemaId) errors.push("Skema keringanan wajib dipilih");
  if (!jenisId) errors.push("Jenis pembayaran wajib dipilih");
  if (!mulai) errors.push("Tanggal mulai versi wajib diisi");
  if (!Number.isFinite(nilaiNum) || nilaiNum < 0) errors.push("Nilai kebijakan tidak valid");
  if (skema?.tipe === "persen" && nilaiNum > 100) errors.push("Persentase maksimal 100%");
  if (selesai && mulai && selesai < mulai) errors.push("Tanggal selesai lebih awal dari tanggal mulai");

  const latestByCode = useMemo(() => {
    const map = new Map<string, KebijakanKeringanan>();
    for (const p of policies ?? []) {
      const current = map.get(p.kode);
      if (!current || Number(p.versi) > Number(current.versi)) map.set(p.kode, p);
    }
    return map;
  }, [policies]);

  function save() {
    if (errors.length > 0 || !skema) return;
    createMut.mutate(
      {
        kode: kodeOtomatis,
        nama: nama.trim(),
        skema_diskon_id: skemaId,
        jenis_id: jenisId,
        kelas_regex: scopeDef.regex,
        tipe: skema.tipe,
        nilai: nilaiNum,
        otomatis,
        perlu_pengajuan: perluPengajuan,
        berlaku_mulai: mulai,
        berlaku_selesai: selesai || null,
        keterangan: keterangan.trim() || null,
      },
      {
        onSuccess: () => {
          setOpen(false);
          setBase(null);
        },
      }
    );
  }

  const columns: DataTableColumn<Record<string, unknown>>[] = [
    {
      key: "nama",
      label: "Kebijakan",
      render: (_v, row) => {
        const p = row as unknown as KebijakanKeringanan;
        const latest = latestByCode.get(p.kode)?.id === p.id;
        return (
          <div>
            <p className="font-medium">{p.nama}</p>
            <p className="text-xs text-muted-foreground">
              {p.kode} · v{p.versi}{latest ? " · versi terbaru" : ""}
            </p>
          </div>
        );
      },
    },
    {
      key: "skema_diskon",
      label: "Skema / Tagihan",
      render: (_v, row) => {
        const p = row as unknown as KebijakanKeringanan;
        return (
          <div>
            <p>{p.skema_diskon?.nama || "—"}</p>
            <p className="text-xs text-muted-foreground">{p.jenis_pembayaran?.nama || "—"}</p>
          </div>
        );
      },
    },
    {
      key: "nilai",
      label: "Nilai",
      render: (_v, row) => {
        const p = row as unknown as KebijakanKeringanan;
        return p.tipe === "persen" ? `${Number(p.nilai)}%` : formatRupiah(Number(p.nilai));
      },
    },
    {
      key: "kelas_regex",
      label: "Sasaran Kelas",
      render: (_v, row) => {
        const p = row as unknown as KebijakanKeringanan;
        return SCOPE_OPTIONS.find((x) => x.regex === (p.kelas_regex || null))?.label || p.kelas_regex || "Semua kelas";
      },
    },
    {
      key: "berlaku_mulai",
      label: "Berlaku",
      render: (_v, row) => {
        const p = row as unknown as KebijakanKeringanan;
        return (
          <span className="text-sm">
            {formatTanggal(p.berlaku_mulai)} – {formatTanggal(p.berlaku_selesai)}
          </span>
        );
      },
    },
    {
      key: "otomatis",
      label: "Mode",
      render: (_v, row) => {
        const p = row as unknown as KebijakanKeringanan;
        return (
          <div className="flex flex-wrap gap-1">
            <Badge variant={p.otomatis ? "default" : "outline"}>
              {p.otomatis ? "Otomatis" : "Manual"}
            </Badge>
            {!p.perlu_pengajuan && <Badge variant="secondary">Tanpa pengajuan formal</Badge>}
          </div>
        );
      },
    },
    {
      key: "id",
      label: "Aksi",
      render: (_v, row) => {
        const p = row as unknown as KebijakanKeringanan;
        const latest = latestByCode.get(p.kode)?.id === p.id;
        if (!latest) return <span className="text-xs text-muted-foreground">Riwayat</span>;
        return (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setBase(p);
              setOpen(true);
            }}
          >
            <History className="h-3.5 w-3.5 mr-1" />
            Versi Baru
          </Button>
        );
      },
    },
  ];

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Perubahan kebijakan tidak mengedit versi lama. Gunakan <strong>Versi Baru</strong>
            dengan tanggal efektif baru. Keringanan siswa menyimpan snapshot nilai yang dipakai,
            sehingga histori tagihan lama tidak ikut berubah.
          </AlertDescription>
        </Alert>

        <DataTable
          columns={columns}
          data={(policies ?? []) as unknown as Record<string, unknown>[]}
          loading={isLoading}
          searchPlaceholder="Cari kebijakan..."
          emptyMessage="Belum ada kebijakan keringanan"
          actions={
            <Button
              onClick={() => {
                setBase(null);
                setOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Kebijakan Baru
            </Button>
          }
        />

        <Dialog
          open={open}
          onOpenChange={(value) => {
            setOpen(value);
            if (!value) setBase(null);
          }}
        >
          <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{base ? "Buat Versi Kebijakan Baru" : "Kebijakan Keringanan Baru"}</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <Label>Nama Kebijakan</Label>
                <Input value={nama} onChange={(e) => setNama(e.target.value)} />
              </div>

              <div>
                <Label>Kode Kebijakan</Label>
                <Input
                  value={kode}
                  disabled={!!base}
                  onChange={(e) => setKode(e.target.value.toLowerCase().replace(/[^a-z0-9_:-]/g, "_"))}
                  placeholder={kodeOtomatis || "dibuat otomatis"}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {base ? "Kode tetap sama agar riwayat versinya tersambung." : `Jika kosong: ${kodeOtomatis || "dibuat otomatis"}`}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Skema Keringanan</Label>
                  <Select value={skemaId} onValueChange={setSkemaId} disabled={!!base}>
                    <SelectTrigger><SelectValue placeholder="Pilih skema" /></SelectTrigger>
                    <SelectContent>
                      {(skemaList ?? []).map((x) => (
                        <SelectItem key={x.id} value={x.id}>{x.nama}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Jenis Pembayaran</Label>
                  <Select value={jenisId} onValueChange={setJenisId} disabled={!!base}>
                    <SelectTrigger><SelectValue placeholder="Pilih tagihan" /></SelectTrigger>
                    <SelectContent>
                      {((jenisList as any[] | undefined) ?? []).map((x: any) => (
                        <SelectItem key={x.id} value={x.id}>{x.nama}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label>Sasaran Kelas</Label>
                <Select value={scope} onValueChange={setScope} disabled={!!base}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SCOPE_OPTIONS.map((x) => (
                      <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {skema && (
                <div>
                  <Label>Nilai Kebijakan {skema.tipe === "persen" ? "(%)" : "(Rp)"}</Label>
                  {skema.tipe === "persen" ? (
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={nilai}
                      onChange={(e) => setNilai(e.target.value)}
                    />
                  ) : (
                    <RupiahInput value={nilai} onChange={setNilai} />
                  )}
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Mulai Berlaku</Label>
                  <Input type="date" value={mulai} onChange={(e) => setMulai(e.target.value)} />
                </div>
                <div>
                  <Label>Selesai (opsional)</Label>
                  <Input type="date" value={selesai} onChange={(e) => setSelesai(e.target.value)} />
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label>Diproses otomatis</Label>
                  <p className="text-xs text-muted-foreground">
                    Hanya aktif bila sistem punya deteksi penerima yang aman.
                  </p>
                </div>
                <Switch checked={otomatis} onCheckedChange={setOtomatis} />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label>Perlu pengajuan</Label>
                  <p className="text-xs text-muted-foreground">
                    Cocok untuk kurang mampu/keringanan khusus yang harus diputuskan per siswa.
                  </p>
                </div>
                <Switch checked={perluPengajuan} onCheckedChange={setPerluPengajuan} />
              </div>

              <div>
                <Label>Keterangan</Label>
                <Textarea value={keterangan} onChange={(e) => setKeterangan(e.target.value)} rows={3} />
              </div>

              {errors.length > 0 && (
                <Alert variant="destructive">
                  <AlertDescription>
                    <ul className="list-disc pl-4">
                      {errors.map((x) => <li key={x}>{x}</li>)}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
              <Button onClick={save} disabled={errors.length > 0 || createMut.isPending}>
                Simpan Versi
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}