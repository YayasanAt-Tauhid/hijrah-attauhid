/**
 * Tab "Skema Diskon" di Referensi Keuangan.
 *
 * Master jenis potongan (beasiswa, kakak-adik, keringanan, bantuan). Nilainya
 * di sini adalah DEFAULT — besaran per siswa bisa dioverride saat pengajuan di
 * halaman Siswa Penerima Keringanan.
 */
import { useEffect, useState } from "react";
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
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { RupiahInput } from "@/components/shared/RupiahInput";
import { Plus, Pencil, Trash2, AlertTriangle } from "lucide-react";
import { formatRupiah } from "@/hooks/useKeuangan";
import {
  useSkemaDiskon,
  useCreateSkemaDiskon,
  useUpdateSkemaDiskon,
  useDeleteSkemaDiskon,
  LABEL_KATEGORI,
  type KategoriDiskon,
  type SkemaDiskon,
} from "@/hooks/useDiskon";

const KATEGORI_OPTIONS: KategoriDiskon[] = [
  "beasiswa",
  "keringanan",
  "kakak_adik",
  "bantuan",
  "promo",
  "lainnya",
];

export default function TabSkemaDiskon() {
  const { data: list, isLoading } = useSkemaDiskon();
  const createMut = useCreateSkemaDiskon();
  const updateMut = useUpdateSkemaDiskon();
  const deleteMut = useDeleteSkemaDiskon();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<SkemaDiskon | null>(null);
  const [hapusId, setHapusId] = useState<string | null>(null);

  const [nama, setNama] = useState("");
  const [kategori, setKategori] = useState<KategoriDiskon>("keringanan");
  const [tipe, setTipe] = useState<"persen" | "nominal">("nominal");
  const [nilai, setNilai] = useState("0");
  const [perluApproval, setPerluApproval] = useState(true);
  const [aktif, setAktif] = useState(true);
  const [keterangan, setKeterangan] = useState("");

  useEffect(() => {
    if (!dialogOpen) return;
    setNama(editItem?.nama ?? "");
    setKategori(editItem?.kategori ?? "keringanan");
    setTipe(editItem?.tipe ?? "nominal");
    setNilai(String(editItem?.nilai_default ?? 0));
    setPerluApproval(editItem?.perlu_approval ?? true);
    setAktif(editItem?.aktif ?? true);
    setKeterangan(editItem?.keterangan ?? "");
  }, [dialogOpen, editItem]);

  const nilaiNum = Number(nilai || 0);
  const kekurangan: string[] = [];
  if (!nama.trim()) kekurangan.push("Nama skema wajib diisi");
  if (tipe === "persen" && nilaiNum > 100)
    kekurangan.push("Persentase tidak boleh lebih dari 100%");
  if (nilaiNum < 0) kekurangan.push("Nilai tidak boleh negatif");

  function simpan() {
    if (kekurangan.length > 0) return;
    const values = {
      nama: nama.trim(),
      kategori,
      tipe,
      nilai_default: nilaiNum,
      perlu_approval: perluApproval,
      aktif,
      keterangan: keterangan.trim() || null,
    };
    if (editItem) {
      updateMut.mutate({ id: editItem.id, ...values }, { onSuccess: tutup });
    } else {
      createMut.mutate(values, { onSuccess: tutup });
    }
  }

  function tutup() {
    setDialogOpen(false);
    setEditItem(null);
  }

  const columns: DataTableColumn<Record<string, unknown>>[] = [
    { key: "nama", label: "Nama Skema", sortable: true },
    {
      key: "kategori",
      label: "Kategori",
      sortable: true,
      render: (v) => (
        <Badge variant="outline">{LABEL_KATEGORI[v as KategoriDiskon] ?? String(v)}</Badge>
      ),
    },
    {
      key: "nilai_default",
      label: "Nilai Default",
      sortable: true,
      render: (v, row) =>
        Number(v) === 0 ? (
          <span className="text-muted-foreground italic">belum ditentukan</span>
        ) : row.tipe === "persen" ? (
          `${Number(v)}%`
        ) : (
          formatRupiah(Number(v))
        ),
    },
    {
      key: "aktif",
      label: "Status",
      render: (v) => (
        <Badge variant={v ? "default" : "secondary"}>{v ? "Aktif" : "Nonaktif"}</Badge>
      ),
    },
    {
      key: "id",
      label: "Aksi",
      render: (_v, row) => (
        <div className="flex gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => {
              setEditItem(row as unknown as SkemaDiskon);
              setDialogOpen(true);
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setHapusId(String(row.id))}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  const adaNilaiKosong = (list ?? []).some((s) => s.aktif && s.nilai_default === 0);

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        {adaNilaiKosong && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Ada skema aktif yang nilai defaultnya masih 0. Skema itu tetap bisa
              dipakai — besaran keringanannya diisi manual saat pengajuan per
              siswa — tapi lebih praktis kalau nilai bakunya ditetapkan di sini.
            </AlertDescription>
          </Alert>
        )}

        <DataTable
          columns={columns}
          data={(list ?? []) as unknown as Record<string, unknown>[]}
          loading={isLoading}
          searchPlaceholder="Cari skema diskon..."
          emptyMessage="Belum ada skema diskon"
          actions={
            <Button
              onClick={() => {
                setEditItem(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Tambah Skema
            </Button>
          }
        />

        <Dialog open={dialogOpen} onOpenChange={(o) => (o ? setDialogOpen(o) : tutup())}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editItem ? "Edit" : "Tambah"} Skema Diskon</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <Label htmlFor="nama-skema">Nama Skema</Label>
                <Input
                  id="nama-skema"
                  value={nama}
                  onChange={(e) => setNama(e.target.value)}
                  placeholder="Mis. Beasiswa Tahfidz"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Kategori</Label>
                  <Select
                    value={kategori}
                    onValueChange={(v) => setKategori(v as KategoriDiskon)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {KATEGORI_OPTIONS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {LABEL_KATEGORI[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Tipe Potongan</Label>
                  <Select
                    value={tipe}
                    onValueChange={(v) => setTipe(v as "persen" | "nominal")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nominal">Nominal (Rp)</SelectItem>
                      <SelectItem value="persen">Persen (%)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="nilai-skema">Nilai Default</Label>
                {tipe === "persen" ? (
                  <Input
                    id="nilai-skema"
                    type="number"
                    min={0}
                    max={100}
                    value={nilai}
                    onChange={(e) => setNilai(e.target.value)}
                  />
                ) : (
                  <RupiahInput id="nilai-skema" value={nilai} onChange={setNilai} />
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  Boleh 0 kalau besarannya selalu ditentukan per siswa.
                </p>
              </div>

              {kategori === "kakak_adik" && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Potongan kakak-adik hanya bisa diberikan kepada siswa yang
                    sudah dikelompokkan ke sebuah keluarga berisi{" "}
                    <strong>minimal 2 bersaudara</strong>. Pengelompokannya
                    dilakukan di halaman Siswa Penerima Keringanan.
                  </AlertDescription>
                </Alert>
              )}

              <div>
                <Label htmlFor="ket-skema">Keterangan</Label>
                <Textarea
                  id="ket-skema"
                  value={keterangan}
                  onChange={(e) => setKeterangan(e.target.value)}
                  rows={2}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="approval-skema" className="cursor-pointer">
                  Perlu persetujuan sekretaris yayasan
                </Label>
                <Switch
                  id="approval-skema"
                  checked={perluApproval}
                  onCheckedChange={setPerluApproval}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="aktif-skema" className="cursor-pointer">
                  Aktif
                </Label>
                <Switch id="aktif-skema" checked={aktif} onCheckedChange={setAktif} />
              </div>

              {kekurangan.length > 0 && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <p className="font-medium mb-1">Checklist kekurangan:</p>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {kekurangan.map((k) => (
                        <li key={k}>{k}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={tutup}>
                Batal
              </Button>
              <Button
                onClick={simpan}
                disabled={
                  kekurangan.length > 0 || createMut.isPending || updateMut.isPending
                }
              >
                Simpan
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <ConfirmDialog
          open={!!hapusId}
          onOpenChange={(o) => !o && setHapusId(null)}
          title="Hapus skema diskon?"
          description="Skema yang sudah pernah dipakai tidak bisa dihapus — nonaktifkan saja supaya riwayatnya tetap utuh."
          variant="destructive"
          loading={deleteMut.isPending}
          onConfirm={() => {
            if (hapusId) deleteMut.mutate(hapusId, { onSettled: () => setHapusId(null) });
          }}
        />
      </CardContent>
    </Card>
  );
}
