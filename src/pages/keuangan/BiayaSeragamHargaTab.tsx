import { useState } from "react";
import { Copy, Pencil, Plus } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useHargaSeragamVendor, useSalinHargaSeragam, useSimpanHargaSeragamVendor, useUbahAktifHarga,
} from "@/hooks/useHargaSeragamVendor";
import {
  cariBentrok, normalizeUkuranList, salinanHarga, validasiHarga, type HargaSeragamVendor, type JenisKelaminHarga,
} from "@/lib/seragamVendor";

type Opsi = { id: string; nama: string };
type Props = {
  tahunAjaranId: string;
  tahunList: Opsi[];
  departemenList: Array<Opsi & { kode?: string | null }>;
  harga: HargaSeragamVendor[];
  loading: boolean;
};
type Form = { id: string; aktif: boolean; departemen_id: string; jenis_kelamin: JenisKelaminHarga; nama_stel: string; ukuran: string; harga: string; catatan: string };

const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
const FORM_KOSONG: Form = { id: "", aktif: true, departemen_id: "", jenis_kelamin: "semua", nama_stel: "", ukuran: "", harga: "", catatan: "" };
const JENIS_LABEL: Record<JenisKelaminHarga, string> = { L: "Ikhwan", P: "Akhwat", semua: "Semua" };
const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

export default function BiayaSeragamHargaTab({ tahunAjaranId, tahunList, departemenList, harga, loading }: Props) {
  const simpan = useSimpanHargaSeragamVendor();
  const ubahAktif = useUbahAktifHarga();
  const salin = useSalinHargaSeragam();
  const [form, setForm] = useState<Form | null>(null);
  const [galat, setGalat] = useState("");
  const [salinBuka, setSalinBuka] = useState(false);
  const [sumberTahun, setSumberTahun] = useState("");
  const [salinLembaga, setSalinLembaga] = useState("");
  const sumber = useHargaSeragamVendor(sumberTahun);

  const namaLembaga = (id: string) => {
    const d = departemenList.find((item) => item.id === id);
    return d?.kode || d?.nama || "-";
  };

  const baris = harga.map((h) => ({
    ...h,
    lembaga: namaLembaga(h.departemen_id),
    jenisLabel: JENIS_LABEL[h.jenis_kelamin],
    ukuranLabel: h.ukuran.length ? normalizeUkuranList(h.ukuran).join(", ") : "Semua ukuran",
  }));
  type Baris = (typeof baris)[number];

  function bukaForm(h?: HargaSeragamVendor) {
    setGalat("");
    setForm(h ? {
      id: h.id, aktif: h.aktif, departemen_id: h.departemen_id, jenis_kelamin: h.jenis_kelamin, nama_stel: h.nama_stel,
      ukuran: normalizeUkuranList(h.ukuran).join(", "), harga: String(h.harga), catatan: h.catatan ?? "",
    } : FORM_KOSONG);
  }

  async function kirim() {
    if (!form) return;
    if (!form.departemen_id) return setGalat("Pilih lembaga.");
    if (form.harga.trim() === "") return setGalat("Isi harga.");
    const input = {
      tahun_ajaran_id: tahunAjaranId,
      departemen_id: form.departemen_id,
      jenis_kelamin: form.jenis_kelamin,
      nama_stel: form.nama_stel.trim(),
      ukuran: normalizeUkuranList(form.ukuran.split(",")),
      harga: Number(form.harga),
      catatan: form.catatan.trim() || null,
      aktif: form.aktif,
    };
    const masalah = validasiHarga(input);
    if (masalah) return setGalat(masalah);
    const bentrok = cariBentrok({ ...input, id: form.id || undefined }, harga);
    if (bentrok) {
      return setGalat(`Bertabrakan dengan harga aktif "${bentrok.nama_stel}" (${bentrok.ukuran.length ? bentrok.ukuran.join(", ") : "semua ukuran"}). Nonaktifkan baris itu dulu atau ubah ukuran.`);
    }
    try {
      await simpan.mutateAsync({ id: form.id || undefined, ...input });
      setForm(null);
    } catch (error) {
      setGalat(error instanceof Error ? error.message : "Gagal menyimpan harga.");
    }
  }

  async function jalankanSalin() {
    setGalat("");
    if (!sumberTahun) return setGalat("Pilih tahun ajaran sumber.");
    if (!salinLembaga) return setGalat("Pilih lembaga.");
    const bahan = salinanHarga(sumber.data ?? [], { tahunAjaranId, departemenId: salinLembaga, existing: harga });
    if (bahan.length === 0) {
      return setGalat("Tidak ada yang bisa disalin: tahun ajaran ini sudah punya harga untuk lembaga tersebut, atau sumbernya kosong.");
    }
    try {
      await salin.mutateAsync(bahan);
      setSalinBuka(false);
    } catch (error) {
      setGalat(error instanceof Error ? error.message : "Gagal menyalin harga.");
    }
  }

  const columns: DataTableColumn<Baris>[] = [
    { key: "lembaga", label: "Lembaga" },
    { key: "jenisLabel", label: "Jenis kelamin" },
    { key: "nama_stel", label: "Nama stel" },
    { key: "ukuranLabel", label: "Ukuran" },
    { key: "harga", label: "Harga", render: (value) => rupiah(Number(value)) },
    { key: "aktif", label: "Status", render: (value) => (value ? "Aktif" : "Nonaktif") },
    {
      key: "id", label: "Aksi",
      render: (_value, row) => (
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" aria-label={`Ubah ${row.nama_stel}`} onClick={() => bukaForm(row)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            type="button" size="sm" variant="outline"
            aria-label={`${row.aktif ? "Nonaktifkan" : "Aktifkan"} ${row.nama_stel}`}
            onClick={() => ubahAktif.mutateAsync({ id: row.id, aktif: !row.aktif }).catch((error) => setGalat(error instanceof Error ? error.message : "Gagal mengubah status."))}
          >
            {row.aktif ? "Nonaktifkan" : "Aktifkan"}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => bukaForm()}><Plus className="mr-2 h-4 w-4" />Tambah harga</Button>
        <Button type="button" variant="outline" onClick={() => { setGalat(""); setSumberTahun(""); setSalinLembaga(""); setSalinBuka(true); }}>
          <Copy className="mr-2 h-4 w-4" />Salin dari tahun lain
        </Button>
      </div>
      {galat && !form && !salinBuka && <p role="alert" className="text-sm text-destructive">{galat}</p>}

      <DataTable
        columns={columns} data={baris} searchable={false} pageSize={25} loading={loading}
        emptyMessage="Belum ada harga untuk tahun ajaran ini"
      />

      <Dialog open={form !== null} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form?.id ? "Ubah harga seragam" : "Tambah harga seragam"}</DialogTitle></DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="harga-lembaga">Lembaga</Label>
                <select id="harga-lembaga" className={selectClass} value={form.departemen_id} onChange={(e) => setForm({ ...form, departemen_id: e.target.value })}>
                  <option value="">Pilih lembaga</option>
                  {departemenList.map((d) => <option key={d.id} value={d.id}>{d.kode || d.nama}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="harga-jk">Jenis kelamin</Label>
                <select id="harga-jk" className={selectClass} value={form.jenis_kelamin} onChange={(e) => setForm({ ...form, jenis_kelamin: e.target.value as JenisKelaminHarga })}>
                  <option value="semua">Semua</option>
                  <option value="L">Ikhwan</option>
                  <option value="P">Akhwat</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="harga-nama">Nama stel</Label>
                <Input id="harga-nama" value={form.nama_stel} onChange={(e) => setForm({ ...form, nama_stel: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="harga-ukuran">Ukuran (pisahkan dengan koma, kosong = semua)</Label>
                <Input id="harga-ukuran" value={form.ukuran} onChange={(e) => setForm({ ...form, ukuran: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="harga-rupiah">Harga (Rp)</Label>
                <Input id="harga-rupiah" inputMode="numeric" value={form.harga} onChange={(e) => setForm({ ...form, harga: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="harga-catatan">Catatan</Label>
                <Input id="harga-catatan" value={form.catatan} onChange={(e) => setForm({ ...form, catatan: e.target.value })} />
              </div>
              {galat && <p role="alert" className="text-sm text-destructive">{galat}</p>}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setForm(null)}>Batal</Button>
            <Button type="button" onClick={kirim} disabled={simpan.isPending}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={salinBuka} onOpenChange={setSalinBuka}>
        <DialogContent>
          <DialogHeader><DialogTitle>Salin harga dari tahun ajaran lain</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="salin-tahun">Salin dari tahun ajaran</Label>
              <select id="salin-tahun" className={selectClass} value={sumberTahun} onChange={(e) => setSumberTahun(e.target.value)}>
                <option value="">Pilih tahun ajaran</option>
                {tahunList.filter((t) => t.id !== tahunAjaranId).map((t) => <option key={t.id} value={t.id}>{t.nama}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="salin-lembaga">Lembaga</Label>
              <select id="salin-lembaga" className={selectClass} value={salinLembaga} onChange={(e) => setSalinLembaga(e.target.value)}>
                <option value="">Pilih lembaga</option>
                {departemenList.map((d) => <option key={d.id} value={d.id}>{d.kode || d.nama}</option>)}
              </select>
            </div>
            <p className="text-sm text-muted-foreground">Hanya baris aktif yang disalin, dan hanya bila tahun ajaran ini belum punya harga untuk lembaga tersebut.</p>
            {galat && <p role="alert" className="text-sm text-destructive">{galat}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSalinBuka(false)}>Batal</Button>
            <Button type="button" onClick={jalankanSalin} disabled={salin.isPending}>Salin</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
