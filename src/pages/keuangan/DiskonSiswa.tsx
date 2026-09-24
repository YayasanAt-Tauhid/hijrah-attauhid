/**
 * Halaman "Siswa Penerima Keringanan" — /keuangan/diskon-siswa
 *
 * Tiga bagian sesuai alur kerjanya:
 *   1. Daftar & pengajuan  — staf keuangan mengajukan keringanan per siswa
 *   2. Persetujuan         — sekretaris yayasan menyetujui/menolak
 *   3. Kelompok keluarga   — prasyarat potongan kakak-adik
 *
 * Halaman ini sengaja TIDAK berada di bawah guard rute `_finance`: sekretaris
 * yayasan perlu masuk ke sini untuk menyetujui, tapi tidak perlu (dan tidak
 * boleh) melihat jurnal, buku besar, dan laporan keuangan lainnya.
 */
import { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import Unauthorized from "@/pages/Unauthorized";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { SiswaCombobox, type SiswaRingkas } from "@/components/shared/SiswaCombobox";
import { RupiahInput } from "@/components/shared/RupiahInput";
import { Plus, AlertTriangle, Check, X, Users, RefreshCw } from "lucide-react";
import { formatRupiah, useAllJenisPembayaran } from "@/hooks/useKeuangan";
import {
  useSkemaDiskon,
  useSiswaDiskonList,
  useAjukanDiskon,
  usePutuskanDiskon,
  useTerapkanDiskon,
  useSaranKeluarga,
  useKonfirmasiKeluarga,
  LABEL_KATEGORI,
  LABEL_STATUS,
  type KategoriDiskon,
  type StatusDiskon,
  type SiswaDiskonRow,
} from "@/hooks/useDiskon";

const ROLE_PENGAJU = ["admin", "keuangan"];
const ROLE_PENYETUJU = ["admin", "sekretaris_yayasan"];

const WARNA_STATUS: Record<StatusDiskon, string> = {
  diajukan: "bg-amber-500/15 text-amber-700 border-amber-200",
  disetujui: "bg-green-500/15 text-green-700 border-green-200",
  ditolak: "bg-red-500/15 text-red-700 border-red-200",
  dibatalkan: "bg-gray-500/15 text-gray-700 border-gray-200",
};

/** "2026-07" (input type=month) -> "2026-07-01". DB menormalkan sisanya. */
function bulanKeTanggal(bulan: string): string {
  return bulan ? `${bulan}-01` : "";
}

function formatPeriode(mulai: string, selesai: string): string {
  const f = (t: string) =>
    new Date(t).toLocaleDateString("id-ID", { month: "short", year: "numeric" });
  return `${f(mulai)} – ${f(selesai)}`;
}

function nilaiTampil(row: SiswaDiskonRow): string {
  const tipe = row.skema_diskon?.tipe;
  const nilai = row.nilai ?? row.skema_diskon?.nilai_default ?? 0;
  if (Number(nilai) === 0) return "belum ditentukan";
  return tipe === "persen"
    ? `${nilai}% / tagihan`
    : `${formatRupiah(Number(nilai))} / tagihan`;
}

export default function DiskonSiswa() {
  const { role } = useAuth();
  const bolehAjukan = !!role && ROLE_PENGAJU.includes(role);
  const bolehSetujui = !!role && ROLE_PENYETUJU.includes(role);

  if (!bolehAjukan && !bolehSetujui) return <Unauthorized />;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Siswa Penerima Keringanan</h1>
        <p className="text-sm text-muted-foreground">
          Beasiswa, potongan kakak-adik, keringanan kurang mampu, dan bantuan yayasan
        </p>
      </div>

      <Tabs defaultValue={bolehAjukan ? "daftar" : "persetujuan"}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="daftar">Daftar Keringanan</TabsTrigger>
          {bolehSetujui && <TabsTrigger value="persetujuan">Persetujuan</TabsTrigger>}
          {bolehAjukan && <TabsTrigger value="keluarga">Kelompok Keluarga</TabsTrigger>}
        </TabsList>

        <TabsContent value="daftar">
          <TabDaftar bolehAjukan={bolehAjukan} />
        </TabsContent>

        {bolehSetujui && (
          <TabsContent value="persetujuan">
            <TabPersetujuan />
          </TabsContent>
        )}

        {bolehAjukan && (
          <TabsContent value="keluarga">
            <TabKeluarga />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function TabDaftar({ bolehAjukan }: { bolehAjukan: boolean }) {
  const [filterStatus, setFilterStatus] = useState<StatusDiskon | "semua">("semua");
  const [filterKategori, setFilterKategori] = useState<KategoriDiskon | "semua">("semua");
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: list, isLoading } = useSiswaDiskonList(
    filterStatus === "semua" ? undefined : { status: filterStatus }
  );
  const terapkanMut = useTerapkanDiskon();

  const dataFiltered = useMemo(() => {
    if (!list) return [];
    if (filterKategori === "semua") return list;
    return list.filter((r) => r.skema_diskon?.kategori === filterKategori);
  }, [list, filterKategori]);

  const columns: DataTableColumn<Record<string, unknown>>[] = [
    {
      key: "siswa",
      label: "Siswa",
      render: (_v, row) => {
        const r = row as unknown as SiswaDiskonRow;
        return (
          <div>
            <p className="font-medium">{r.siswa?.nama ?? "—"}</p>
            <p className="text-xs text-muted-foreground">{r.siswa?.nis ?? "tanpa NIS"}</p>
          </div>
        );
      },
    },
    {
      key: "skema_diskon",
      label: "Skema Keringanan",
      render: (_v, row) => {
        const r = row as unknown as SiswaDiskonRow;
        return (
          <div>
            <p>{r.skema_diskon?.nama ?? "—"}</p>
            <Badge variant="outline" className="mt-1">
              {LABEL_KATEGORI[r.skema_diskon?.kategori as KategoriDiskon] ?? "—"}
            </Badge>
          </div>
        );
      },
    },
    {
      key: "jenis_pembayaran",
      label: "Jenis Pembayaran",
      render: (_v, row) =>
        (row as unknown as SiswaDiskonRow).jenis_pembayaran?.nama ?? "—",
    },
    {
      key: "periode_mulai",
      label: "Berlaku",
      sortable: true,
      render: (_v, row) => {
        const r = row as unknown as SiswaDiskonRow;
        return formatPeriode(r.periode_mulai, r.periode_selesai);
      },
    },
    {
      key: "nilai",
      label: "Potongan",
      render: (_v, row) => nilaiTampil(row as unknown as SiswaDiskonRow),
    },
    {
      key: "status",
      label: "Status Pengajuan",
      sortable: true,
      render: (v, row) => {
        const r = row as unknown as SiswaDiskonRow;
        return (
          <div>
            <Badge variant="outline" className={WARNA_STATUS[v as StatusDiskon]}>
              {LABEL_STATUS[v as StatusDiskon] ?? String(v)}
            </Badge>
            {r.status === "ditolak" && r.alasan_penolakan && (
              <p className="text-xs text-muted-foreground mt-1 max-w-[240px]">
                {r.alasan_penolakan}
              </p>
            )}
            {filterStatus === "semua" && r.riwayat_count > 0 && (
              <p className="text-xs text-muted-foreground mt-1 max-w-[240px]">
                {r.riwayat_count} pengajuan sebelumnya tersimpan sebagai riwayat
              </p>
            )}
          </div>
        );
      },
    },
    {
      key: "id",
      label: "Tindakan",
      render: (_v, row) => {
        const r = row as unknown as SiswaDiskonRow;
        if (r.status !== "disetujui") {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        return (
          <Button
            size="sm"
            variant="outline"
            disabled={terapkanMut.isPending}
            onClick={() => terapkanMut.mutate(r.id)}
            title="Hitung ulang & terapkan potongan ini ke tagihan yang ada"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Terapkan ulang
          </Button>
        );
      },
    },
  ];

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="w-48">
            <Label>Status Pengajuan</Label>
            <Select
              value={filterStatus}
              onValueChange={(v) => setFilterStatus(v as StatusDiskon | "semua")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="semua">Semua status</SelectItem>
                {(Object.keys(LABEL_STATUS) as StatusDiskon[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {LABEL_STATUS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-48">
            <Label>Kategori Keringanan</Label>
            <Select
              value={filterKategori}
              onValueChange={(v) => setFilterKategori(v as KategoriDiskon | "semua")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="semua">Semua kategori</SelectItem>
                {(Object.keys(LABEL_KATEGORI) as KategoriDiskon[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {LABEL_KATEGORI[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {filterStatus === "semua" && (
          <p className="text-xs text-muted-foreground">
            Menampilkan pengajuan terkini untuk setiap siswa, jenis pembayaran, dan periode.
            Pengajuan lama tetap tersimpan sebagai riwayat dan dapat dilihat lewat filter status.
          </p>
        )}

        <DataTable
          columns={columns}
          data={dataFiltered as unknown as Record<string, unknown>[]}
          loading={isLoading}
          searchPlaceholder="Cari siswa..."
          emptyMessage="Belum ada keringanan yang diberikan"
          actions={
            bolehAjukan ? (
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Ajukan Keringanan
              </Button>
            ) : undefined
          }
        />

        <DialogAjukan open={dialogOpen} onOpenChange={setDialogOpen} />
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function DialogAjukan({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { data: skemaList } = useSkemaDiskon(true);
  const { data: jenisList } = useAllJenisPembayaran();
  const ajukanMut = useAjukanDiskon();

  const [siswa, setSiswa] = useState<SiswaRingkas | null>(null);
  const [skemaId, setSkemaId] = useState("");
  const [jenisId, setJenisId] = useState("");
  const [bulanMulai, setBulanMulai] = useState("");
  const [bulanSelesai, setBulanSelesai] = useState("");
  const [pakaiDefault, setPakaiDefault] = useState(true);
  const [nilai, setNilai] = useState("0");
  const [catatan, setCatatan] = useState("");
  const [dokumenUrl, setDokumenUrl] = useState("");

  const skema = skemaList?.find((s) => s.id === skemaId);

  function reset() {
    setSiswa(null);
    setSkemaId("");
    setJenisId("");
    setBulanMulai("");
    setBulanSelesai("");
    setPakaiDefault(true);
    setNilai("0");
    setCatatan("");
    setDokumenUrl("");
  }

  const kekurangan: string[] = [];
  if (!siswa) kekurangan.push("Siswa belum dipilih");
  if (!skemaId) kekurangan.push("Skema keringanan belum dipilih");
  if (!jenisId) kekurangan.push("Jenis pembayaran belum dipilih");
  if (!bulanMulai) kekurangan.push("Bulan mulai belum diisi");
  if (!bulanSelesai) kekurangan.push("Bulan selesai belum diisi");
  if (bulanMulai && bulanSelesai && bulanSelesai < bulanMulai)
    kekurangan.push("Bulan selesai lebih awal dari bulan mulai");
  if (!pakaiDefault) {
    const n = Number(nilai || 0);
    if (n <= 0) kekurangan.push("Nilai potongan harus lebih dari 0");
    if (skema?.tipe === "persen" && n > 100)
      kekurangan.push("Persentase tidak boleh lebih dari 100%");
  } else if ((skema?.nilai_default ?? 0) <= 0) {
    kekurangan.push(
      "Skema ini belum punya nilai default — isi nominalnya di sini, atau tetapkan dulu di Referensi Keuangan → Skema Diskon"
    );
  }

  function simpan() {
    if (kekurangan.length > 0 || !siswa) return;
    ajukanMut.mutate(
      {
        siswa_id: siswa.id,
        skema_diskon_id: skemaId,
        jenis_id: jenisId,
        periode_mulai: bulanKeTanggal(bulanMulai),
        periode_selesai: bulanKeTanggal(bulanSelesai),
        nilai: pakaiDefault ? null : Number(nilai || 0),
        catatan: catatan.trim() || null,
        dokumen_url: dokumenUrl.trim() || null,
      },
      {
        onSuccess: () => {
          reset();
          onOpenChange(false);
        },
      }
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ajukan Keringanan</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Siswa</Label>
            <SiswaCombobox value={siswa} onChange={setSiswa} />
          </div>

          <div>
            <Label>Skema Keringanan</Label>
            <Select value={skemaId} onValueChange={setSkemaId}>
              <SelectTrigger>
                <SelectValue placeholder="Pilih skema..." />
              </SelectTrigger>
              <SelectContent>
                {(skemaList ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.nama} · {LABEL_KATEGORI[s.kategori]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {skema?.kategori === "kakak_adik" && (
            <Alert>
              <Users className="h-4 w-4" />
              <AlertDescription>
                Potongan kakak-adik hanya diterima kalau siswa ini sudah
                dikelompokkan ke keluarga yang berisi{" "}
                <strong>minimal 2 bersaudara</strong>. Kalau belum, atur dulu di
                tab <strong>Kelompok Keluarga</strong> — kalau tidak, pengajuan
                ini akan ditolak sistem.
              </AlertDescription>
            </Alert>
          )}

          <div>
            <Label>Jenis Pembayaran</Label>
            <Select value={jenisId} onValueChange={setJenisId}>
              <SelectTrigger>
                <SelectValue placeholder="Pilih jenis pembayaran..." />
              </SelectTrigger>
              <SelectContent>
                {(jenisList ?? []).map((j: { id: string; nama: string }) => (
                  <SelectItem key={j.id} value={j.id}>
                    {j.nama}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Satu siswa hanya boleh punya satu keringanan aktif per jenis
              pembayaran dalam periode yang sama.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="bulan-mulai">Mulai Bulan</Label>
              <Input
                id="bulan-mulai"
                type="month"
                value={bulanMulai}
                onChange={(e) => setBulanMulai(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="bulan-selesai">Sampai Bulan</Label>
              <Input
                id="bulan-selesai"
                type="month"
                value={bulanSelesai}
                onChange={(e) => setBulanSelesai(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            Mis. Jul 2026 – Jun 2027 untuk dua semester, atau Jul – Des 2026
            untuk satu semester saja.
          </p>

          {skema && (
            <>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="pakai-default"
                  checked={pakaiDefault}
                  onCheckedChange={(c) => setPakaiDefault(c === true)}
                />
                <Label htmlFor="pakai-default" className="cursor-pointer font-normal">
                  Pakai nilai default skema
                  {skema.nilai_default > 0 && (
                    <>
                      {" "}
                      (
                      {skema.tipe === "persen"
                        ? `${skema.nilai_default}%`
                        : formatRupiah(skema.nilai_default)}
                      )
                    </>
                  )}
                </Label>
              </div>

              {!pakaiDefault && (
                <div>
                  <Label htmlFor="nilai-diskon">
                    Nilai Potongan {skema.tipe === "persen" ? "(%)" : "(Rp)"}
                  </Label>
                  {skema.tipe === "persen" ? (
                    <Input
                      id="nilai-diskon"
                      type="number"
                      min={0}
                      max={100}
                      value={nilai}
                      onChange={(e) => setNilai(e.target.value)}
                    />
                  ) : (
                    <RupiahInput id="nilai-diskon" value={nilai} onChange={setNilai} />
                  )}
                </div>
              )}
            </>
          )}

          <div>
            <Label htmlFor="catatan-diskon">Catatan</Label>
            <Textarea
              id="catatan-diskon"
              rows={2}
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              placeholder="Alasan pemberian keringanan"
            />
          </div>

          <div>
            <Label htmlFor="dokumen-diskon">Tautan Dokumen Pendukung</Label>
            <Input
              id="dokumen-diskon"
              value={dokumenUrl}
              onChange={(e) => setDokumenUrl(e.target.value)}
              placeholder="Mis. tautan SKTM atau surat keputusan"
            />
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            onClick={simpan}
            disabled={kekurangan.length > 0 || ajukanMut.isPending}
          >
            Ajukan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function TabPersetujuan() {
  const { data: list, isLoading } = useSiswaDiskonList({ status: "diajukan" });
  const putuskanMut = usePutuskanDiskon();
  const [tolakItem, setTolakItem] = useState<SiswaDiskonRow | null>(null);
  const [alasan, setAlasan] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Menunggu Persetujuan</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Menyetujui berarti potongan langsung dikenakan ke tagihan siswa —
            tagihan yang belum jatuh tempo disesuaikan angkanya, yang piutangnya
            sudah dibukukan dikoreksi lewat jurnal baru. Tagihan yang sudah
            lunas atau dibayar sebagian tidak ikut diubah.
          </AlertDescription>
        </Alert>

        {isLoading && <p className="text-sm text-muted-foreground">Memuat...</p>}

        {!isLoading && (list ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Tidak ada pengajuan yang menunggu persetujuan.
          </p>
        )}

        <div className="space-y-3">
          {(list ?? []).map((r) => (
            <div
              key={r.id}
              className="border rounded-lg p-4 flex flex-wrap gap-4 items-start justify-between"
            >
              <div className="space-y-1">
                <p className="font-medium">
                  {r.siswa?.nama}{" "}
                  <span className="text-muted-foreground font-normal">
                    ({r.siswa?.nis ?? "tanpa NIS"})
                  </span>
                </p>
                <p className="text-sm">
                  {r.skema_diskon?.nama} · {r.jenis_pembayaran?.nama} ·{" "}
                  <strong>{nilaiTampil(r)}</strong>
                </p>
                <p className="text-sm text-muted-foreground">
                  Berlaku {formatPeriode(r.periode_mulai, r.periode_selesai)}
                </p>
                {r.catatan && <p className="text-sm italic">"{r.catatan}"</p>}
                {r.dokumen_url && (
                  <a
                    href={r.dokumen_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-sm text-primary underline"
                  >
                    Lihat dokumen pendukung
                  </a>
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={putuskanMut.isPending}
                  onClick={() =>
                    putuskanMut.mutate({ siswa_diskon_id: r.id, setujui: true })
                  }
                >
                  <Check className="h-4 w-4 mr-1" />
                  Setujui
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={putuskanMut.isPending}
                  onClick={() => {
                    setTolakItem(r);
                    setAlasan("");
                  }}
                >
                  <X className="h-4 w-4 mr-1" />
                  Tolak
                </Button>
              </div>
            </div>
          ))}
        </div>

        <Dialog open={!!tolakItem} onOpenChange={(o) => !o && setTolakItem(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Tolak Pengajuan</DialogTitle>
            </DialogHeader>
            <div>
              <Label htmlFor="alasan-tolak">Alasan penolakan</Label>
              <Textarea
                id="alasan-tolak"
                rows={3}
                value={alasan}
                onChange={(e) => setAlasan(e.target.value)}
                placeholder="Dijelaskan supaya pengaju tahu apa yang perlu diperbaiki"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTolakItem(null)}>
                Batal
              </Button>
              <Button
                variant="destructive"
                disabled={!alasan.trim() || putuskanMut.isPending}
                onClick={() => {
                  if (!tolakItem) return;
                  putuskanMut.mutate(
                    { siswa_diskon_id: tolakItem.id, setujui: false, alasan },
                    { onSuccess: () => setTolakItem(null) }
                  );
                }}
              >
                Tolak Pengajuan
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function TabKeluarga() {
  const [aktif, setAktif] = useState(false);
  const { data: saran, isLoading } = useSaranKeluarga(aktif);
  const konfirmasiMut = useKonfirmasiKeluarga();
  const [pilihan, setPilihan] = useState<Record<string, Set<string>>>({});
  const [namaKeluarga, setNamaKeluarga] = useState<Record<string, string>>({});

  function togglePilih(kunci: string, siswaId: string) {
    setPilihan((prev) => {
      const set = new Set(prev[kunci] ?? []);
      if (set.has(siswaId)) set.delete(siswaId);
      else set.add(siswaId);
      return { ...prev, [kunci]: set };
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Kelompok Keluarga (Kakak-Adik)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Users className="h-4 w-4" />
          <AlertDescription>
            Sistem tidak menyimpan NIK/No. KK, jadi kakak-adik dideteksi dari
            akun orang tua yang sama atau kecocokan nama ayah &amp; ibu. Hasilnya{" "}
            <strong>saran, bukan keputusan</strong> — periksa dulu sebelum
            dikonfirmasi, karena salah mengelompokkan berarti memberi potongan ke
            anak yang keliru. Potongan kakak-adik baru bisa diajukan setelah
            keluarganya berisi minimal 2 siswa.
          </AlertDescription>
        </Alert>

        <Button onClick={() => setAktif(true)} disabled={isLoading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          {aktif ? "Muat Ulang Saran" : "Cari Saran Kakak-Adik"}
        </Button>

        {isLoading && <p className="text-sm text-muted-foreground">Mencari...</p>}

        {aktif && !isLoading && (saran ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Tidak ada kandidat kakak-adik yang belum dikelompokkan.
          </p>
        )}

        <div className="space-y-3">
          {(saran ?? []).map((g) => {
            const terpilih = pilihan[g.kunci] ?? new Set<string>();
            const nama = namaKeluarga[g.kunci] ?? "";
            return (
              <div key={g.kunci} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline">
                    {g.sumber === "akun_ortu"
                      ? "Satu akun orang tua"
                      : "Nama ayah & ibu cocok"}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {g.jumlah_siswa} siswa · keyakinan {g.skor}%
                  </span>
                </div>

                <div className="space-y-1">
                  {g.siswa.map((s) => (
                    <label
                      key={s.siswa_id}
                      className="flex items-center gap-2 cursor-pointer text-sm"
                    >
                      <Checkbox
                        checked={terpilih.has(s.siswa_id)}
                        onCheckedChange={() => togglePilih(g.kunci, s.siswa_id)}
                      />
                      <span>
                        {s.nama}{" "}
                        <span className="text-muted-foreground">
                          ({s.nis ?? "tanpa NIS"}
                          {s.tanggal_lahir
                            ? ` · lahir ${new Date(s.tanggal_lahir).toLocaleDateString("id-ID")}`
                            : ""}
                          )
                        </span>
                      </span>
                    </label>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2 items-end">
                  <div className="flex-1 min-w-[220px]">
                    <Label>Nama keluarga</Label>
                    <Input
                      value={nama}
                      onChange={(e) =>
                        setNamaKeluarga((p) => ({ ...p, [g.kunci]: e.target.value }))
                      }
                      placeholder="Mis. Keluarga Bpk. Ahmad"
                    />
                  </div>
                  <Button
                    disabled={
                      terpilih.size < 2 || !nama.trim() || konfirmasiMut.isPending
                    }
                    onClick={() =>
                      konfirmasiMut.mutate({
                        nama: nama.trim(),
                        siswa_ids: Array.from(terpilih),
                      })
                    }
                  >
                    Konfirmasi sebagai satu keluarga
                  </Button>
                </div>

                {terpilih.size > 0 && terpilih.size < 2 && (
                  <p className="text-xs text-destructive">
                    Pilih minimal 2 siswa — potongan kakak-adik memang hanya
                    berlaku untuk yang bersaudara.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
