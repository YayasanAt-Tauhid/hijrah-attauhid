import { DialogAjukan } from "@/components/keuangan/DialogAjukanKeringanan";
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
import { filterFamilySuggestions } from "@/lib/familySuggestions";
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
import { Plus, AlertTriangle, Check, X, Users, RefreshCw } from "lucide-react";
import { formatRupiah } from "@/hooks/useKeuangan";
import {
  useSiswaDiskonList,
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

function formatPeriode(mulai: string, selesai: string): string {
  const f = (t: string) =>
    new Date(t).toLocaleDateString("id-ID", { month: "short", year: "numeric" });
  return `${f(mulai)} – ${f(selesai)}`;
}

function nilaiTampil(row: SiswaDiskonRow): string {
  const tipe = row.tipe_snapshot ?? row.skema_diskon?.tipe;
  const nilai = row.nilai_snapshot ?? row.nilai ?? row.skema_diskon?.nilai_default ?? 0;
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
            {r.kebijakan_snapshot?.versi != null && (
              <p className="text-xs text-muted-foreground">
                Kebijakan {String(r.kebijakan_snapshot.kode || "")} v{String(r.kebijakan_snapshot.versi)}
              </p>
            )}
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
  const { data: saran, isFetching, error, refetch } = useSaranKeluarga(aktif);
  const [pencarian, setPencarian] = useState("");
  const [halaman, setHalaman] = useState(1);
  const perHalaman = 10;
  const hasilPencarian = useMemo(
    () => filterFamilySuggestions(saran ?? [], pencarian),
    [saran, pencarian],
  );
  const jumlahHalaman = Math.max(1, Math.ceil(hasilPencarian.length / perHalaman));
  const halamanAktif = Math.min(halaman, jumlahHalaman);
  const awal = (halamanAktif - 1) * perHalaman;
  const saranHalaman = hasilPencarian.slice(awal, awal + perHalaman);
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
            Sistem memprioritaskan kecocokan <strong>No. KK</strong> dan
            <strong> NIK ayah &amp; ibu</strong>, lalu akun orang tua yang sama,
            dengan nama ayah/ibu sebagai fallback. Identitas mentah tidak ditampilkan
            pada daftar ini. Hasilnya tetap <strong>saran, bukan keputusan</strong> —
            periksa dulu sebelum dikonfirmasi. Setelah keluarga dikonfirmasi, potongan
            kakak/adik bulan berjalan mengikuti kebijakan aktif untuk
            <strong> semua anak, termasuk anak pertama</strong>, selama
            <strong> minimal 2 saudara masih aktif</strong> di yayasan.
            <strong> Keringanan yang sudah diinput beserta riwayatnya tetap tersimpan.</strong>{" "}
            Jika ada keringanan berstatus diajukan atau disetujui untuk jenis pembayaran
            dan periode yang sama, potongan kakak/adik otomatis tidak ditambahkan.
            Keringanan yang ditolak atau dibatalkan tidak menghalangi potongan baru.
          </AlertDescription>
        </Alert>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <Label htmlFor="cari-keluarga">Cari siswa dalam saran keluarga</Label>
            <Input
              id="cari-keluarga"
              value={pencarian}
              placeholder="Nama siswa atau NIS"
              onChange={(e) => {
                setPencarian(e.target.value);
                setHalaman(1);
              }}
            />
          </div>
          <Button
            onClick={() => {
              setHalaman(1);
              if (aktif) void refetch();
              else setAktif(true);
            }}
            disabled={isFetching}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            {aktif ? "Muat Ulang Saran" : "Cari Saran Kakak-Adik"}
          </Button>
        </div>

        {isFetching && <p className="text-sm text-muted-foreground">Mencari...</p>}
        {aktif && error && (
          <p role="alert" className="text-sm text-destructive">
            Gagal memuat saran keluarga. Klik Muat Ulang Saran untuk mencoba lagi.
          </p>
        )}

        {aktif && !isFetching && !error && hasilPencarian.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {pencarian.trim()
              ? "Tidak ada saran keluarga yang cocok dengan nama atau NIS tersebut."
              : "Tidak ada kandidat kakak-adik yang belum dikelompokkan."}
          </p>
        )}

        {aktif && !error && hasilPencarian.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              Menampilkan {awal + 1}–{Math.min(awal + perHalaman, hasilPencarian.length)}
              {" dari "}{hasilPencarian.length} saran
              {pencarian.trim() ? " yang cocok" : ""}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={halamanAktif === 1 || isFetching}
                onClick={() => setHalaman(halamanAktif - 1)}>
                Sebelumnya
              </Button>
              <span className="text-sm">Halaman {halamanAktif} / {jumlahHalaman}</span>
              <Button variant="outline" size="sm" disabled={halamanAktif === jumlahHalaman || isFetching}
                onClick={() => setHalaman(halamanAktif + 1)}>
                Berikutnya
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {(!error ? saranHalaman : []).map((g) => {
            const groupKey = `${g.sumber}:${g.kunci}`;
            const terpilih = pilihan[groupKey] ?? new Set<string>();
            const nama = namaKeluarga[groupKey] ?? "";
            return (
              <div key={groupKey} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline">
                    {g.sumber === "no_kk"
                      ? "No. KK sama"
                      : g.sumber === "nik_ortu"
                        ? "NIK ayah & ibu sama"
                        : g.sumber === "akun_ortu"
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
                        onCheckedChange={() => togglePilih(groupKey, s.siswa_id)}
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
                        setNamaKeluarga((p) => ({ ...p, [groupKey]: e.target.value }))
                      }
                      placeholder="Mis. Keluarga Bpk. Ahmad"
                    />
                  </div>
                  <Button
                    disabled={
                      terpilih.size < 2 || !nama.trim() || konfirmasiMut.isPending || isFetching
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