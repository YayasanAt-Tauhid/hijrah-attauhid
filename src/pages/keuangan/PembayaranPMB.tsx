import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { PrintKuitansi } from "@/components/shared/PrintKuitansi";
import { supabase } from "@/integrations/supabase/client";
import { useLembaga, useJenisPembayaran, usePembayaranBySiswa, formatRupiah } from "@/hooks/useKeuangan";
import { cariSiswaPembayaran, prosesPembayaran } from "@/server/pembayaran";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Printer, Search } from "lucide-react";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { useAuth } from "@/contexts/AuthContext";
import Unauthorized from "@/pages/Unauthorized";

export default function PembayaranPMB() {
  const { role } = useAuth();
  if (!role || !["admin", "keuangan", "kasir"].includes(role)) {
    return <Unauthorized />;
  }
  return <PembayaranPMBContent />;
}

function PembayaranPMBContent() {
  const qc = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSiswa, setSelectedSiswa] = useState<any>(null);
  const [departemenId, setDepartemenId] = useState("");
  const [jenisId, setJenisId] = useState("");
  const [jumlah, setJumlah] = useState("");
  const [tanggalBayar, setTanggalBayar] = useState(format(new Date(), "yyyy-MM-dd"));
  const [keterangan, setKeterangan] = useState("");
  const [showKuitansi, setShowKuitansi] = useState(false);
  const [lastPayment, setLastPayment] = useState<{
    id: string;
    nomorJurnal?: string;
    jumlah: number;
    tanggalBayar: string;
    keterangan?: string;
    jenisNama: string;
    siswa: { nama: string; nis?: string | null; nisn?: string | null };
    lembagaNama: string;
    petugasNama?: string;
  } | null>(null);

  const { data: lembagaList } = useLembaga();
  const { data: jenisList = [] } = useJenisPembayaran(departemenId || undefined);
  const { data: riwayat, isLoading: loadRiwayat } = usePembayaranBySiswa(selectedSiswa?.id);

  const {
    data: spmbRegistration,
    isLoading: spmbRegistrationLoading,
    error: spmbRegistrationError,
  } = useQuery({
    queryKey: ["spmb_payment_registration_year", selectedSiswa?.id],
    enabled: !!selectedSiswa?.id,
    queryFn: async () => {
      const { data: detail, error: detailError } = await supabase
        .from("siswa_detail")
        .select("tahun_ajaran_id")
        .eq("siswa_id", selectedSiswa.id)
        .maybeSingle();
      if (detailError) throw detailError;
      if (!detail?.tahun_ajaran_id) return null;

      const { data: tahunAjaran, error: tahunError } = await supabase
        .from("tahun_ajaran")
        .select("id, nama")
        .eq("id", detail.tahun_ajaran_id)
        .maybeSingle();
      if (tahunError) throw tahunError;

      return {
        tahun_ajaran_id: detail.tahun_ajaran_id,
        tahun_ajaran_nama: tahunAjaran?.nama || null,
      };
    },
  });

  const {
    data: spmbReadiness,
    isLoading: spmbReadinessLoading,
  } = useQuery({
    queryKey: ["spmb_payment_readiness", selectedSiswa?.id],
    enabled: !!selectedSiswa?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("spmb_readiness", {
        p_siswa_id: selectedSiswa.id,
      });
      if (error) throw error;
      return data as {
        gratis_pendaftaran?: boolean;
        nominal?: number | null;
        dibayar?: number | null;
      } | null;
    },
  });
  const gratisPromo = spmbReadiness?.gratis_pendaftaran === true;

  const {
    data: paymentBookYear,
    isLoading: paymentBookYearLoading,
    error: paymentBookYearError,
  } = useQuery({
    queryKey: ["spmb_payment_book_year", tanggalBayar],
    enabled: !!tanggalBayar,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tahun_buku")
        .select("id, nama")
        .lte("tanggal_mulai", tanggalBayar)
        .gte("tanggal_selesai", tanggalBayar)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSiswa || !jenisId || !jumlah || !paymentBookYear?.id) {
        throw new Error("Data pembayaran atau tahun buku tanggal bayar belum lengkap");
      }
      return await prosesPembayaran({
        data: {
          siswa_id: selectedSiswa.id,
          jenis_id: jenisId,
          bulan: 0,
          jumlah: Number(jumlah),
          tanggal_bayar: tanggalBayar,
          keterangan: keterangan || "Pembayaran SPMB",
          departemen_id: departemenId || undefined,
          tahun_ajaran_id: paymentBookYear.id,
          is_bayar_dimuka: false,
        },
      });
    },
    onSuccess: async (result) => {
      await qc.invalidateQueries({ queryKey: ["pembayaran"] });
      await qc.invalidateQueries({ queryKey: ["rekap"] });
      const jenis = pmbJenisList.find((j: any) => j.id === jenisId) as any;
      const lembaga = lembagaList?.find((l: any) => l.id === departemenId) as any;
      if (selectedSiswa) {
        setLastPayment({
          id: result.pembayaran_id,
          nomorJurnal: result.nomor_jurnal,
          jumlah: result.jumlah,
          tanggalBayar,
          keterangan: keterangan || "Pembayaran SPMB",
          jenisNama: jenis?.nama || "Biaya Pendaftaran SPMB",
          siswa: { nama: selectedSiswa.nama, nis: selectedSiswa.nis ?? null, nisn: selectedSiswa.nisn ?? null },
          lembagaNama: lembaga?.nama || lembaga?.kode || "-",
          petugasNama: result.petugas_nama || undefined,
        });
        setShowKuitansi(true);
      }
      toast.success("Pembayaran dan jurnal " + result.nomor_jurnal + " berhasil dibuat");
      setJenisId("");
      setJumlah("");
      setKeterangan("");
    },
    onError: (e: any) => toast.error(e.message || "Gagal menyimpan pembayaran SPMB"),
  });

  const { data: pmbConfig } = useQuery({
    queryKey: ["konfigurasi_pmb", departemenId],
    enabled: !!departemenId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("konfigurasi_pmb")
        .select("jenis_pembayaran_id")
        .eq("departemen_id", departemenId)
        .maybeSingle();
      if (error) throw error;
      return data as { jenis_pembayaran_id: string } | null;
    },
  });

  const pmbJenisList = pmbConfig
    ? jenisList.filter((j: any) => j.id === pmbConfig.jenis_pembayaran_id)
    : [];

  const { data: searchResults } = useQuery({
    queryKey: ["search_calon", searchTerm, departemenId],
    enabled: searchTerm.trim().length >= 2 && !!departemenId,
    queryFn: async () => {
      const result = await cariSiswaPembayaran({
        data: {
          search: searchTerm,
          status: "calon",
          departemen_id: departemenId,
          limit: 10,
        },
      });
      return result.items;
    },
  });

  const handleSubmit = async () => {
    if (!selectedSiswa || !jenisId || !jumlah) return;
    if (gratisPromo) {
      toast.info("Calon murid ini mendapatkan gratis biaya pendaftaran. Tidak perlu input pembayaran.");
      return;
    }
    if (!pmbConfig || jenisId !== pmbConfig.jenis_pembayaran_id) {
      toast.error("Jenis pembayaran tidak sesuai konfigurasi SPMB lembaga ini");
      return;
    }
    await createMutation.mutateAsync();
  };

  const riwayatColumns: DataTableColumn<any>[] = [
    { key: "jenis", label: "Jenis", render: (_, r) => (r as any).jenis_pembayaran?.nama || "-" },
    { key: "jumlah", label: "Jumlah", render: (v) => formatRupiah(Number(v)) },
    { key: "tanggal_bayar", label: "Tanggal", render: (v) => v ? format(new Date(v as string), "dd MMM yyyy", { locale: idLocale }) : "-" },
    { key: "keterangan", label: "Keterangan", render: (v) => (v as string) || "-" },
    {
      key: "aksi",
      label: "Aksi",
      render: (_, r) => (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const lembaga = lembagaList?.find((l: any) => l.id === departemenId) as any;
            setLastPayment({
              id: r.id,
              jumlah: Number(r.jumlah || 0),
              tanggalBayar: r.tanggal_bayar,
              keterangan: r.keterangan || undefined,
              jenisNama: r.jenis_pembayaran?.nama || "Biaya Pendaftaran SPMB",
              siswa: { nama: selectedSiswa?.nama || "-", nis: selectedSiswa?.nis ?? null, nisn: selectedSiswa?.nisn ?? null },
              lembagaNama: lembaga?.nama || lembaga?.kode || "-",
            });
            setShowKuitansi(true);
          }}
        >
          <Printer className="mr-1.5 h-4 w-4" />
          Cetak Kuitansi
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Pembayaran Calon Murid (SPMB)</h1>
        <p className="text-sm text-muted-foreground">Input pembayaran pendaftaran SPMB untuk murid berstatus calon. Setiap transaksi dibuat bersama jurnal keuangan secara atomik.</p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="max-w-md">
            <Label>Pilih Lembaga</Label>
            <Select value={departemenId} onValueChange={(v) => { setDepartemenId(v); setSelectedSiswa(null); setJenisId(""); setJumlah(""); }}>
              <SelectTrigger><SelectValue placeholder="Pilih lembaga" /></SelectTrigger>
              <SelectContent>
                {lembagaList?.map((l: any) => <SelectItem key={l.id} value={l.id}>{l.kode} — {l.nama}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {departemenId && !pmbConfig && (
            <p className="text-sm text-destructive">Konfigurasi SPMB untuk lembaga ini belum dibuat. Atur terlebih dahulu di Akademik → Konfigurasi SPMB.</p>
          )}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Cari calon murid (nama)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
              disabled={!departemenId}
            />
            {searchResults && searchResults.length > 0 && searchTerm.length >= 2 && (
              <div className="absolute z-50 mt-1 w-full bg-popover border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {searchResults.map((s: any) => (
                  <button key={s.id} className="w-full text-left px-4 py-2.5 hover:bg-accent flex items-center gap-3" onClick={() => { setSelectedSiswa(s); setSearchTerm(""); }}>
                    <div className="h-8 w-8 rounded-full bg-accent/50 flex items-center justify-center text-xs font-bold">{s.nama?.[0]}</div>
                    <div>
                      <p className="text-sm font-medium">{s.nama}</p>
                      <p className="text-xs text-muted-foreground">Status: Calon</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {selectedSiswa && (
        <>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 rounded-full bg-accent/20 flex items-center justify-center text-lg font-bold text-accent">
                  {selectedSiswa.nama?.[0]}
                </div>
                <div>
                  <h3 className="font-semibold text-lg">{selectedSiswa.nama}</h3>
                  <p className="text-sm text-muted-foreground">Status: Calon Murid</p>
                  <p className="text-sm text-muted-foreground">
                    Tahun ajaran: {spmbRegistrationLoading
                      ? "Memuat..."
                      : spmbRegistration?.tahun_ajaran_nama || "Belum dikonfigurasi"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Input Pembayaran SPMB</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {gratisPromo && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                    <p className="font-semibold">Gratis biaya pendaftaran — Promo SPMB Gelombang Pertama</p>
                    <p className="mt-1">
                      Tarif bruto {formatRupiah(Number(spmbReadiness?.nominal || 0))} dipotong 100%, sehingga total yang harus dibayar Rp0.
                      Potongan dicatat otomatis ke pembukuan; tidak perlu membuat transaksi pembayaran.
                    </p>
                  </div>
                )}
                {spmbReadinessLoading && (
                  <p className="text-sm text-muted-foreground">Memeriksa status promo SPMB...</p>
                )}
                {spmbRegistrationError && (
                  <p className="text-sm text-destructive">Tahun ajaran pendaftaran gagal dimuat. Muat ulang halaman lalu coba kembali.</p>
                )}
                {paymentBookYearError && (
                  <p className="text-sm text-destructive">Tahun buku untuk tanggal bayar gagal dimuat. Muat ulang halaman lalu coba kembali.</p>
                )}
                {!spmbRegistrationLoading && !spmbRegistration?.tahun_ajaran_id && (
                  <p className="text-sm text-destructive">Tahun ajaran pendaftaran SPMB siswa ini belum dikonfigurasi.</p>
                )}
                {!paymentBookYearLoading && tanggalBayar && !paymentBookYear?.id && (
                  <p className="text-sm text-destructive">Tahun buku untuk tanggal bayar belum dikonfigurasi.</p>
                )}
                <div>
                  <Label>Jenis Pembayaran</Label>
                  <Select value={jenisId} onValueChange={(v) => {
                    setJenisId(v);
                    const j = pmbJenisList.find((x: any) => x.id === v) as any;
                    if (j?.nominal) setJumlah(String(j.nominal));
                  }} disabled={!pmbConfig || gratisPromo}>
                    <SelectTrigger><SelectValue placeholder={pmbConfig ? "Pilih jenis" : "Konfigurasi SPMB belum tersedia"} /></SelectTrigger>
                    <SelectContent>
                      {pmbJenisList.map((j: any) => (
                        <SelectItem key={j.id} value={j.id}>{j.nama} {j.nominal ? `(${formatRupiah(Number(j.nominal))})` : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Jumlah (Rp)</Label>
                  <Input type="number" value={jumlah} onChange={(e) => setJumlah(e.target.value)} placeholder="0" disabled={gratisPromo} />
                  <p className="text-xs text-muted-foreground mt-1">Nominal final divalidasi ulang dari tarif di server sebelum jurnal dibuat.</p>
                </div>
                <div>
                  <Label>Tanggal Bayar</Label>
                  <Input type="date" value={tanggalBayar} onChange={(e) => setTanggalBayar(e.target.value)} disabled={gratisPromo} />
                  <p className="text-xs text-muted-foreground mt-1">
                    Tahun buku: {paymentBookYearLoading ? "Memuat..." : paymentBookYear?.nama || "Belum dikonfigurasi"}
                  </p>
                </div>
                <div>
                  <Label>Keterangan</Label>
                  <Textarea value={keterangan} onChange={(e) => setKeterangan(e.target.value)} placeholder="Pembayaran SPMB" disabled={gratisPromo} />
                </div>
                <Button onClick={handleSubmit} disabled={gratisPromo || !jenisId || !jumlah || !spmbRegistration?.tahun_ajaran_id || !paymentBookYear?.id || createMutation.isPending} className="w-full">
                  {createMutation.isPending ? "Menyimpan..." : "Simpan Pembayaran & Jurnal"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Riwayat Pembayaran SPMB</CardTitle></CardHeader>
              <CardContent>
                <DataTable columns={riwayatColumns} data={(riwayat as any[]) || []} loading={loadRiwayat} searchable={false} pageSize={10} emptyMessage="Belum ada pembayaran" />
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {lastPayment && (
        <Dialog open={showKuitansi} onOpenChange={setShowKuitansi}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Kuitansi Pembayaran SPMB</DialogTitle>
            </DialogHeader>
            <div className="space-y-1 text-sm">
              <p>Calon murid: <span className="font-semibold">{lastPayment.siswa.nama}</span></p>
              <p>Jumlah: <span className="font-semibold">{formatRupiah(lastPayment.jumlah)}</span></p>
              {lastPayment.nomorJurnal && (
                <p>No. jurnal: <span className="font-mono text-xs">{lastPayment.nomorJurnal}</span></p>
              )}
            </div>
            <PrintKuitansi
              payment={{
                id: lastPayment.id,
                nomorJurnal: lastPayment.nomorJurnal,
                jumlah: lastPayment.jumlah,
                bulan: 0,
                tanggal_bayar: lastPayment.tanggalBayar,
                keterangan: lastPayment.keterangan,
                jenisNama: lastPayment.jenisNama,
                siswa: {
                  nama: lastPayment.siswa.nama,
                  nis: lastPayment.siswa.nis || undefined,
                  nisn: lastPayment.siswa.nisn || undefined,
                },
              }}
              kelasNama="Calon Murid"
              lembagaNama={lastPayment.lembagaNama}
              petugasNama={lastPayment.petugasNama}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowKuitansi(false)}>Tutup</Button>
              <Button onClick={() => window.print()}>
                <Printer className="mr-1.5 h-4 w-4" />
                Cetak Kuitansi
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
