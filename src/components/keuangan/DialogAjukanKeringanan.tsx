import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SiswaCombobox, type SiswaRingkas } from "@/components/shared/SiswaCombobox";
import { RupiahInput } from "@/components/shared/RupiahInput";
import { AlertTriangle, Check, Users } from "lucide-react";
import { formatRupiah, useAllJenisPembayaran } from "@/hooks/useKeuangan";
import { useSkemaDiskon, useAjukanDiskon, useKebijakanKeringananAktif, useTagihanDiskonTarget, LABEL_KATEGORI } from "@/hooks/useDiskon";

/** "2026-07" (input type=month) -> "2026-07-01". DB menormalkan sisanya. */
function bulanKeTanggal(bulan: string): string {
  return bulan ? `${bulan}-01` : "";
}

function formatTanggal(tanggal: string): string {
  return new Date(`${tanggal}T00:00:00Z`).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function DialogAjukan({
  open,
  onOpenChange,
  siswaTetap,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  siswaTetap?: SiswaRingkas;
}) {
  const { data: skemaList } = useSkemaDiskon(true);
  const { data: semuaJenis } = useAllJenisPembayaran();
  const jenisList = semuaJenis?.filter((jenis) =>
    jenis.aktif !== false && (!siswaTetap || !jenis.departemen_id || jenis.departemen_id === siswaTetap.departemen_id)
  );
  const ajukanMut = useAjukanDiskon();

  const [siswaPilihan, setSiswa] = useState<SiswaRingkas | null>(null);
  const siswa = siswaTetap ?? siswaPilihan;
  const [skemaId, setSkemaId] = useState("");
  const [jenisId, setJenisId] = useState("");
  const [tagihanId, setTagihanId] = useState("");
  const [bulanMulai, setBulanMulai] = useState("");
  const [bulanSelesai, setBulanSelesai] = useState("");
  const [modeNilai, setModeNilai] = useState<"default" | "persen" | "nominal">("default");
  const [nilai, setNilai] = useState("0");
  const [catatan, setCatatan] = useState("");
  const [dokumenUrl, setDokumenUrl] = useState("");

  const skema = skemaList?.find((s) => s.id === skemaId);
  const jenisDipilih = jenisList?.find((j) => j.id === jenisId);
  const jenisSekali = jenisDipilih?.tipe === "sekali";
  const {
    data: tagihanTarget = [],
    isLoading: sedangMemuatTagihanTarget,
  } = useTagihanDiskonTarget({
    siswa_id: siswa?.id,
    jenis_id: jenisId || undefined,
    enabled: jenisSekali,
  });
  const tagihanDipilih = tagihanTarget.find((t) => t.id === tagihanId);
  const periodeMulaiAktif = jenisSekali
    ? tagihanDipilih?.periode_mulai ?? ""
    : bulanMulai
      ? bulanKeTanggal(bulanMulai)
      : "";
  const periodeSelesaiAktif = jenisSekali
    ? tagihanDipilih?.periode_selesai ?? ""
    : bulanSelesai
      ? bulanKeTanggal(bulanSelesai)
      : "";

  const {
    data: kebijakanAktif,
    isPending: kebijakanPending,
    isFetching: kebijakanFetching,
    error: kebijakanError,
    refetch: muatUlangKebijakan,
  } = useKebijakanKeringananAktif({
    konteks_spmb: !!siswaTetap,
    siswa_id: siswa?.id,
    skema_diskon_id: skemaId || undefined,
    jenis_id: jenisId || undefined,
    periode_mulai: periodeMulaiAktif || undefined,
    periode_selesai: periodeSelesaiAktif || undefined,
  });
  const nilaiBakuAktif = Number(kebijakanAktif?.nilai ?? skema?.nilai_default ?? 0);
  const tipeBakuAktif = kebijakanAktif?.tipe ?? skema?.tipe ?? "nominal";

  function reset() {
    setSiswa(null);
    setSkemaId("");
    setJenisId("");
    setTagihanId("");
    setBulanMulai("");
    setBulanSelesai("");
    setModeNilai("default");
    setNilai("0");
    setCatatan("");
    setDokumenUrl("");
  }

  const kekurangan: string[] = [];
  const perluKebijakan = !!(siswa && skemaId && jenisId && periodeMulaiAktif);
  if (perluKebijakan && (kebijakanPending || kebijakanFetching)) {
    kekurangan.push("Tunggu sampai kebijakan keringanan selesai dimuat");
  }
  if (perluKebijakan && kebijakanError) {
    kekurangan.push("Kebijakan keringanan gagal dimuat. Muat ulang sebelum mengajukan.");
  }
  if (!siswa) kekurangan.push("Siswa belum dipilih");
  if (!skemaId) kekurangan.push("Skema keringanan belum dipilih");
  if (!jenisId) kekurangan.push("Jenis pembayaran belum dipilih");
  if (jenisSekali) {
    if (!tagihanId) kekurangan.push("Tagihan tujuan belum dipilih");
  } else {
    if (!bulanMulai) kekurangan.push("Bulan mulai belum diisi");
    if (!bulanSelesai) kekurangan.push("Bulan selesai belum diisi");
    if (bulanMulai && bulanSelesai && bulanSelesai < bulanMulai)
      kekurangan.push("Bulan selesai lebih awal dari bulan mulai");
  }
  if (modeNilai !== "default") {
    const n = Number(nilai || 0);
    if (!Number.isFinite(n) || n <= 0) kekurangan.push("Nilai potongan harus lebih dari 0");
    if (modeNilai === "persen" && n > 100)
      kekurangan.push("Persentase tidak boleh lebih dari 100%");
  } else if (nilaiBakuAktif <= 0) {
    kekurangan.push(
      "Belum ada nilai kebijakan/default yang bisa dipakai — isi nilai potongannya secara manual"
    );
  }

  function simpan() {
    if (kekurangan.length > 0 || !siswa) return;
    ajukanMut.mutate(
      {
        siswa_id: siswa.id,
        skema_diskon_id: skemaId,
        jenis_id: jenisId,
        tagihan_id: jenisSekali ? tagihanId : null,
        kebijakan_keringanan_id: kebijakanAktif?.id ?? null,
        periode_mulai: periodeMulaiAktif,
        periode_selesai: periodeSelesaiAktif,
        tipe: modeNilai === "default" ? null : modeNilai,
        nilai: modeNilai === "default" ? null : Number(nilai || 0),
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
          <Alert>
            <AlertDescription>
              Pengajuan disimpan untuk persetujuan sekretaris yayasan. Potongan diterapkan setelah disetujui.
              Untuk biaya sekali bayar, terbitkan tagihan awal terlebih dahulu lalu pilih tagihan tujuannya.
            </AlertDescription>
          </Alert>
          {siswaTetap && (
            <p className="text-xs text-muted-foreground">
              Kebijakan berbasis kelas mengikuti kelas tujuan SPMB.
              Jika kelas tujuan belum ditentukan, kebijakan khusus kelas belum dipilih otomatis.
              Isi nilai manual sesuai keputusan yayasan bila diperlukan.
            </p>
          )}
          <div>
            <Label>Siswa</Label>
            <SiswaCombobox
              value={siswa}
              disabled={!!siswaTetap}
              onChange={(next) => {
                setSiswa(next);
                setTagihanId("");
              }}
            />
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
                Potongan kakak-adik hanya berlaku kalau siswa sudah dikelompokkan
                ke keluarga dengan <strong>minimal 2 saudara aktif</strong>. Sistem
                menerapkan nilai sesuai <strong>kebijakan aktif</strong> setelah keluarga dikonfirmasi.
                Pengajuan manual ini dipakai bila perlu koreksi/periode khusus.
                Potongan tidak dapat digabung dengan keringanan lain pada periode yang sama.
              </AlertDescription>
            </Alert>
          )}

          <div>
            <Label>Jenis Pembayaran</Label>
            <Select
              value={jenisId}
              onValueChange={(value) => {
                setJenisId(value);
                setTagihanId("");
                setBulanMulai("");
                setBulanSelesai("");
              }}
            >
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

          {kebijakanAktif && (
            <Alert>
              <Check className="h-4 w-4" />
              <AlertDescription>
                <strong>Kebijakan aktif:</strong> {kebijakanAktif.nama} · v{kebijakanAktif.versi} ·{" "}
                {kebijakanAktif.tipe === "persen"
                  ? `${Number(kebijakanAktif.nilai)}%`
                  : formatRupiah(Number(kebijakanAktif.nilai))}
                . Nilai ini menjadi dasar pengajuan dan disimpan sebagai snapshot.
              </AlertDescription>
            </Alert>
          )}

          {jenisSekali ? (
            <div className="space-y-2">
              <div>
                <Label>Tagihan Tujuan / Tahun Ajaran</Label>
                <Select
                  value={tagihanId}
                  onValueChange={setTagihanId}
                  disabled={!siswa || !jenisId || sedangMemuatTagihanTarget}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        sedangMemuatTagihanTarget
                          ? "Memuat tagihan..."
                          : "Pilih tagihan yang akan diberi potongan..."
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {tagihanTarget.map((target) => (
                      <SelectItem key={target.id} value={target.id}>
                        {target.tahun_akademik_nama ??
                          target.tahun_buku_nama ??
                          "Tagihan sekali"}{" "}
                        · {formatRupiah(target.nominal_bruto)} · jatuh tempo{" "}
                        {formatTanggal(target.jatuh_tempo)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {!sedangMemuatTagihanTarget &&
                siswa &&
                jenisId &&
                tagihanTarget.length === 0 && (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      Tidak ada tagihan aktif yang dapat diberi keringanan untuk
                      siswa dan jenis pembayaran ini. Tagihan yang sudah lunas atau
                      dibayar sebagian tidak ditawarkan sebagai target otomatis.
                    </AlertDescription>
                  </Alert>
                )}

              {tagihanDipilih && (
                <Alert>
                  <Check className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Tagihan terpilih:</strong>{" "}
                    {tagihanDipilih.tahun_akademik_nama ??
                      tagihanDipilih.tahun_buku_nama ??
                      formatTanggal(tagihanDipilih.jatuh_tempo)}
                    . Bruto {formatRupiah(tagihanDipilih.nominal_bruto)}, potongan
                    yang sudah tercatat {formatRupiah(tagihanDipilih.nominal_diskon)},
                    netto saat ini {formatRupiah(tagihanDipilih.nominal_netto)}.
                    Periode keringanan ditetapkan otomatis dari jatuh tempo{" "}
                    {formatTanggal(tagihanDipilih.jatuh_tempo)}.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          ) : (
            <>
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
            </>
          )}

          {skema && (
            <>
              <div>
                <Label>Cara Menentukan Potongan</Label>
                <Select
                  value={modeNilai}
                  onValueChange={(v) => {
                    setModeNilai(v as "default" | "persen" | "nominal");
                    setNilai("0");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">
                      {kebijakanAktif ? "Sesuai kebijakan aktif" : "Sesuai default skema"}
                      {nilaiBakuAktif > 0
                        ? ` · ${tipeBakuAktif === "persen" ? `${nilaiBakuAktif}%` : formatRupiah(nilaiBakuAktif)}`
                        : ""}
                    </SelectItem>
                    <SelectItem value="persen">Persentase (%)</SelectItem>
                    <SelectItem value="nominal">Nominal (Rp)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Pilihan manual hanya mengubah pengajuan siswa ini. Kebijakan aktif tetap
                  menjadi referensi dan nilai yang disetujui disimpan sebagai snapshot.
                </p>
              </div>

              {modeNilai !== "default" && (
                <div>
                  <Label htmlFor="nilai-diskon">
                    Nilai Potongan {modeNilai === "persen" ? "(%)" : "(Rp)"}
                  </Label>
                  {modeNilai === "persen" ? (
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

          {perluKebijakan && kebijakanError && (
            <Button variant="outline" onClick={() => void muatUlangKebijakan()} disabled={kebijakanFetching}>
              Muat Ulang Kebijakan
            </Button>
          )}
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
