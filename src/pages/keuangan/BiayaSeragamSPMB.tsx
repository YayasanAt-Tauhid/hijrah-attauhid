import { useMemo, useState, type ReactNode } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { ExportButton } from "@/components/shared/ExportButton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDepartemen, useTahunAjaran } from "@/hooks/useAkademikData";
import { useHargaSeragamVendor } from "@/hooks/useHargaSeragamVendor";
import { useSeragamUangPangkal, useSiswaSeragamList, useSpmbGelombang } from "@/hooks/useSiswaSeragam";
import { buildSeragamSiswaRows } from "@/lib/seragamSiswa";
import {
  pesanBelumIkut, siswaBelumLengkap, susunBerkasBelumLengkap, susunBerkasInternal, susunBerkasVendor, unduhBerkasXlsx,
  type KonteksEkspor,
} from "@/lib/seragamVendorEkspor";
import {
  catatanMasalah, labelJenisKelamin, PESANAN_EXPORT_COLUMNS, pesananExportRows, REKAP_EXPORT_COLUMNS, rekapExportRows,
  rekapVendor, susunPesanan, type PesananRow,
} from "@/lib/seragamVendorPesanan";
import BiayaSeragamHargaTab from "./BiayaSeragamHargaTab";
import { useAuth } from "@/contexts/AuthContext";
import { hargaSeragamBacaSaja } from "@/lib/aksesHalaman";

const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
const selectClass = "h-10 min-w-[180px] rounded-md border border-input bg-background px-3 text-sm";

function Filter({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  const id = `biaya-seragam-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} className={selectClass} value={value} onChange={(event) => onChange(event.target.value)}>{children}</select>
    </div>
  );
}

export default function BiayaSeragamSPMB() {
  const { role } = useAuth();
  const { data: tahunList = [] } = useTahunAjaran();
  const { data: departemenList = [] } = useDepartemen();
  const { data: gelombangList = [] } = useSpmbGelombang();
  const { data: siswaList = [], isLoading: siswaLoading } = useSiswaSeragamList();
  const { allowed, isLoading: pangkalLoading, error: pangkalError, byStudent } = useSeragamUangPangkal();

  const [tahunPilihan, setTahunPilihan] = useState("");
  const [lembagaId, setLembagaId] = useState("");
  const [gelombangId, setGelombangId] = useState("");
  const [tab, setTab] = useState("pesanan");
  // Daftar tahun ajaran diurutkan terbaru lebih dulu; itu bawaan filter.
  const tahunAjaranId = tahunPilihan || tahunList[0]?.id || "";

  const { data: harga = [], isLoading: hargaLoading, error: hargaError } = useHargaSeragamVendor(tahunAjaranId);

  const rows = useMemo(
    () => buildSeragamSiswaRows(siswaList, departemenList, allowed ? byStudent : undefined),
    [siswaList, departemenList, allowed, byStudent],
  );
  const pesanan = useMemo(
    () => susunPesanan(rows, harga, { tahunAjaranId, lembagaId: lembagaId || undefined, gelombangId: gelombangId || undefined }),
    [rows, harga, tahunAjaranId, lembagaId, gelombangId],
  );
  // Hitungan hanya bermakna setelah data uang pangkal selesai dimuat; sebelum itu semuanya tampak "0" dan menyesatkan.
  const pangkalSiap = allowed && !pangkalLoading && !pangkalError;
  const rekap = useMemo(() => rekapVendor(pesanan.layak), [pesanan.layak]);

  const lembagaOptions = useMemo(
    () => departemenList.map((d: { id: string; nama: string; kode?: string | null }) => ({ id: d.id, label: d.kode || d.nama })),
    [departemenList],
  );

  // Dibentuk saat tombol ditekan agar tanggal cetak selalu hari itu.
  const bangunKonteks = (): KonteksEkspor => ({
    tahunAjaran: tahunList.find((x: { id: string; nama: string }) => x.id === tahunAjaranId)?.nama ?? "-",
    lembaga: lembagaOptions.find((l) => l.id === lembagaId)?.label ?? "Semua lembaga",
    gelombang: gelombangList.find((g: { id: string; nama: string }) => g.id === gelombangId)?.nama ?? "Semua gelombang",
    tanggalCetak: new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }),
  });
  const eksporVendor = () => {
    const berkas = susunBerkasVendor(pesanan.layak, bangunKonteks());
    unduhBerkasXlsx(berkas);
    const peringatan = pesanBelumIkut(berkas.belumIkut);
    if (peringatan) toast.warning(peringatan);
    else toast.success("Berkas untuk vendor diunduh.");
  };
  const eksporInternal = () => {
    unduhBerkasXlsx(susunBerkasInternal(pesanan, bangunKonteks()));
    toast.success("Berkas internal diunduh.");
  };
  const eksporBelumLengkap = () => {
    const jumlah = siswaBelumLengkap(pesanan.layak).length;
    if (jumlah === 0) {
      toast.success("Semua siswa yang sudah membayar minimal 25% stelnya sudah lengkap.");
      return;
    }
    unduhBerkasXlsx(susunBerkasBelumLengkap(pesanan.layak, bangunKonteks()));
    toast.success(`Daftar ${jumlah} siswa yang belum lengkap diunduh.`);
  };

  const columns: DataTableColumn<PesananRow>[] = [
    { key: "nama", label: "Nama", sortable: true },
    { key: "nis", label: "NIS" },
    { key: "lembaga", label: "Lembaga", sortable: true },
    { key: "jenisKelaminKode", label: "Jenis kelamin", render: (value) => labelJenisKelamin(String(value)) },
    {
      key: "stel", label: "Stel dan harga",
      render: (_value, row) => (
        <ul className="space-y-0.5">
          {row.stel.map((s) => (
            <li key={s.slot} className="text-sm">
              {s.namaVendor ?? s.nama} ({s.ukuran || "-"}){s.harga !== null ? ` — ${rupiah(s.harga)}` : ""}
            </li>
          ))}
        </ul>
      ),
    },
    { key: "total", label: "Total", sortable: true, render: (value) => rupiah(Number(value)) },
    {
      key: "masalah", label: "Catatan",
      render: (_value, row) => (row.masalah ? <span className="text-sm text-destructive">{catatanMasalah(row)}</span> : null),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Biaya Seragam SPMB</h1>
        <p className="text-sm text-muted-foreground">
          Harga seragam dari vendor per tahun ajaran dan daftar siswa SPMB yang boleh dipesan (uang pangkal terbayar minimal 25%).
          Daftar dihitung saat halaman dibuka, bukan pemesanan yang dikunci.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Filter label="Tahun ajaran" value={tahunAjaranId} onChange={setTahunPilihan}>
          {tahunList.map((t: { id: string; nama: string }) => <option key={t.id} value={t.id}>{t.nama}</option>)}
        </Filter>
        <Filter label="Lembaga" value={lembagaId} onChange={setLembagaId}>
          <option value="">Semua lembaga</option>
          {lembagaOptions.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </Filter>
        <Filter label="Gelombang" value={gelombangId} onChange={setGelombangId}>
          <option value="">Semua gelombang</option>
          {gelombangList.map((g: { id: string; nama: string }) => <option key={g.id} value={g.id}>{g.nama}</option>)}
        </Filter>
        {pangkalSiap && (
          <div className="ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={pesanan.layak.length === 0}>
                  <Download className="mr-2 h-4 w-4" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={eksporVendor}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Berkas untuk vendor (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={eksporInternal}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Berkas internal yayasan (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={eksporBelumLengkap}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Daftar belum lengkap (internal)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {!allowed && (
        <p role="alert" className="text-sm text-destructive">Anda tidak memiliki izin melihat data uang pangkal SPMB.</p>
      )}
      {allowed && pangkalError && (
        <p role="alert" className="text-sm text-destructive">Data uang pangkal belum dapat dimuat. Coba muat ulang halaman.</p>
      )}
      {hargaError && <p role="alert" className="text-sm text-destructive">Harga vendor belum dapat dimuat: {hargaError instanceof Error ? hargaError.message : "kesalahan tidak dikenal"}.</p>}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="harga">Harga</TabsTrigger>
          <TabsTrigger value="pesanan">Daftar Pesanan</TabsTrigger>
          <TabsTrigger value="rekap">Rekap Vendor</TabsTrigger>
        </TabsList>

        <TabsContent value="harga" className="mt-4">
          <BiayaSeragamHargaTab
            tahunAjaranId={tahunAjaranId}
            tahunList={tahunList}
            departemenList={departemenList}
            harga={harga}
            lembagaId={lembagaId || undefined}
            loading={hargaLoading}
            error={Boolean(hargaError)}
            bacaSaja={hargaSeragamBacaSaja(role)}
          />
        </TabsContent>

        <TabsContent value="pesanan" className="mt-4 space-y-4">
          {allowed && !pangkalError && (
            <>
              {pangkalSiap ? (
                <section aria-label="Ringkasan pesanan" className="flex flex-wrap gap-6 text-sm">
                  <p>{`Layak dipesan: ${pesanan.layak.length}`}</p>
                  <p>{`Belum memenuhi 25%: ${pesanan.belumMemenuhi}`}</p>
                  <p>{`Perlu dilengkapi: ${pesanan.denganMasalah}`}</p>
                </section>
              ) : (
                <p className="text-sm text-muted-foreground">Ringkasan belum tersedia.</p>
              )}
              {pangkalLoading && <p className="text-sm text-muted-foreground">Memuat data uang pangkal...</p>}
              <DataTable
                columns={columns}
                data={pesanan.layak}
                searchable={false}
                pageSize={25}
                loading={siswaLoading || pangkalLoading}
                emptyMessage="Belum ada siswa yang layak dipesan untuk filter ini"
                actions={pangkalSiap ? <ExportButton
                  data={pesananExportRows(pesanan.layak)}
                  columns={PESANAN_EXPORT_COLUMNS}
                  filename="pesanan-seragam-spmb"
                  sheetName="Daftar Pesanan"
                  extraSheets={[{ name: "Rekap Vendor", columns: REKAP_EXPORT_COLUMNS, data: rekapExportRows(rekap) }]}
                /> : undefined}
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="rekap" className="mt-4 space-y-4">
          {allowed && !pangkalSiap && <p className="text-sm text-muted-foreground">Ringkasan belum tersedia.</p>}
          {pangkalSiap && (
            <>
              <p className="text-sm font-medium">{`Total pembayaran vendor: ${rupiah(rekap.totalBayar)}`}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-2 pr-4">Lembaga</th><th className="pr-4">Stel</th><th className="pr-4">Jenis kelamin</th><th className="pr-4">Ukuran</th>
                      <th className="pr-4 text-right">Jumlah</th><th className="pr-4 text-right">Harga satuan</th><th className="text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rekap.baris.map((b) => (
                      <tr key={`${b.lembagaId}|${b.namaStel}|${b.jenisKelaminKode}|${b.ukuran}|${b.hargaSatuan}`} className="border-b">
                        <td className="py-2 pr-4">{b.lembaga}</td><td className="pr-4">{b.namaStel}</td>
                        <td className="pr-4">{labelJenisKelamin(b.jenisKelaminKode)}</td><td className="pr-4">{b.ukuran}</td>
                        <td className="pr-4 text-right">{b.jumlah}</td><td className="pr-4 text-right">{rupiah(b.hargaSatuan)}</td><td className="text-right">{rupiah(b.subtotal)}</td>
                      </tr>
                    ))}
                    {rekap.baris.length === 0 && (
                      <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">Belum ada stel berharga untuk dipesan</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {rekap.tanpaHarga.length > 0 && (
                <div className="space-y-2">
                  <h2 className="text-sm font-semibold text-destructive">Harga belum ada</h2>
                  <p className="text-sm text-muted-foreground">Stel berikut belum bisa ditagihkan ke vendor. Tambahkan harganya di tab Harga.</p>
                  <table className="w-full text-sm">
                    <tbody>
                      {rekap.tanpaHarga.map((b) => (
                        <tr key={`${b.lembagaId}|${b.namaStel}|${b.jenisKelaminKode}|${b.ukuran}`} className="border-b">
                          <td className="py-2 pr-4">{b.lembaga}</td><td className="pr-4">{b.namaStel}</td>
                          <td className="pr-4">{labelJenisKelamin(b.jenisKelaminKode)}</td>
                          <td className="pr-4">{b.ukuran}</td><td className="text-right">{b.jumlah} stel</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
