import { useState } from "react";
import { fetchAllPages } from "@/lib/fetchAll";
import { SPP_CATEGORY_LABELS, sppCategory, sppCategoryLabel, sppReceiptGroups } from "@/lib/sppCategory";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { Skeleton } from "@/components/ui/skeleton";
import { useKelas } from "@/hooks/useAkademikData";
import { useJenisPembayaran, useLembaga, formatRupiah, namaBulan, BULAN_NAMES, BULAN_ORDER_AKADEMIK } from "@/hooks/useKeuangan";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { Building2, CheckCircle, GraduationCap, FileBarChart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useSearchParams, useNavigate } from "@/lib/router-compat";


const now = new Date();

export default function LaporanKeuangan() {
  const [tab, setTab] = useState("penerimaan");
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [filterLembagaId, setFilterLembagaId] = useState(searchParams.get("lembaga") || "");
  const { data: lembagaList } = useLembaga();
  const deptId = filterLembagaId && filterLembagaId !== "all" ? filterLembagaId : undefined;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <GraduationCap className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Laporan Unit Pendidikan</h1>
            <p className="text-sm text-muted-foreground">Penerimaan SPP, pengeluaran, rekap siswa, dan laporan ISAK 35</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate("/keuangan/isak35")}>
          <FileBarChart className="h-4 w-4" />
          Laporan ISAK 35 Lengkap
        </Button>
      </div>

      {/* Filter Lembaga Global */}
      <div className="flex items-center gap-3 flex-wrap p-3 bg-muted/40 rounded-lg border">
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <Label className="text-sm font-medium">Filter Lembaga:</Label>
        <Select value={filterLembagaId} onValueChange={setFilterLembagaId}>
          <SelectTrigger className="w-56 bg-background"><SelectValue placeholder="Semua Lembaga" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Lembaga (Konsolidasi)</SelectItem>
            {lembagaList?.map((l: any) => (
              <SelectItem key={l.id} value={l.id}>{l.kode} — {l.nama}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filterLembagaId && filterLembagaId !== "all" && (
          <Button variant="ghost" size="sm" onClick={() => setFilterLembagaId("")}>Reset Filter</Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="penerimaan">Penerimaan SPP</TabsTrigger>
          <TabsTrigger value="pengeluaran">Pengeluaran</TabsTrigger>
          <TabsTrigger value="rekap-spp">Rekap SPP Bulanan</TabsTrigger>
          <TabsTrigger value="ringkasan-kas">Ringkasan Kas</TabsTrigger>
        </TabsList>

        <TabsContent value="penerimaan"><TabPenerimaan departemenId={deptId} /></TabsContent>
        <TabsContent value="pengeluaran"><TabPengeluaran departemenId={deptId} /></TabsContent>
        <TabsContent value="rekap-spp"><TabRekapSPP departemenId={deptId} /></TabsContent>
        <TabsContent value="ringkasan-kas"><TabNeraca departemenId={deptId} /></TabsContent>
      </Tabs>
    </div>
  );
}

function TabPenerimaan({ departemenId }: { departemenId?: string }) {
  const [bulan, setBulan] = useState(now.getMonth() + 1);
  const [tahun, setTahun] = useState(now.getFullYear());
  const [filterTA, setFilterTA] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  // Fetch tahun ajaran list
  const { data: tahunAjaranList } = useQuery({
    queryKey: ["tahun_ajaran_list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tahun_ajaran").select("id, nama").order("nama", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["laporan_penerimaan_spp_unit", bulan, tahun, departemenId, filterTA],
    queryFn: async () => {
      const start = `${tahun}-${String(bulan).padStart(2, "0")}-01`;
      const endM = bulan === 12 ? 1 : bulan + 1;
      const endY = bulan === 12 ? tahun + 1 : tahun;
      const end = `${endY}-${String(endM).padStart(2, "0")}-01`;
      const rows = await fetchAllPages((from, to) => {
        let q = supabase
        .from("pembayaran")
        .select("*, siswa:siswa_id(nama, nis), jenis_pembayaran:jenis_id!inner(nama, akun_pendapatan_id, departemen_id, departemen:departemen_id(nama, kode)), departemen:departemen_id(nama, kode), jurnal:jurnal_id(id, nomor), tahun_ajaran:tahun_ajaran_id(id, nama)")
        .gte("tanggal_bayar", start)
        .lt("tanggal_bayar", end)
        .order("tanggal_bayar", { ascending: false }).order("id");
      if (departemenId) q = q.eq("jenis_pembayaran.departemen_id", departemenId);
      if (filterTA && filterTA !== "all") q = q.eq("tahun_ajaran_id", filterTA);
        return q.range(from, to);
      });
      // Impor lama dapat tidak mengisi unit pada pembayaran. Unit master
      // SPP adalah sumber kategori dan tetap dapat difilter di server.
      return rows.map(row => ({ ...row, departemen: row.jenis_pembayaran?.departemen || row.departemen }));
    },
  });

  // Fetch pendapatan_dimuka to cross-reference
  const pembayaranIds = data?.map((r: any) => r.id).filter(Boolean) || [];
  const { data: dimukaList } = useQuery({
    queryKey: ["dimuka_by_pembayaran", pembayaranIds],
    enabled: pembayaranIds.length > 0,
    queryFn: async () => {
      const refs: { pembayaran_id: string; status: string }[] = [];
      for (let offset = 0; offset < pembayaranIds.length; offset += 200) {
        const { data, error } = await supabase.from("pendapatan_dimuka").select("pembayaran_id, status")
          .in("pembayaran_id", pembayaranIds.slice(offset, offset + 200));
        if (error) throw error;
        refs.push(...(data || []));
      }
      return refs;
    },
  });

  const dimukaSet = new Set(dimukaList?.map((d: any) => d.pembayaran_id) || []);

  const isDimuka = (row: any) => {
    if (dimukaSet.has(row.id)) return true;
    if (row.keterangan && (row.keterangan as string).includes("[DIMUKA]")) return true;
    return false;
  };

  const sppItems = (data || []).filter((row) => {
    const category = sppCategory(row.spp_kategori, row.jenis_pembayaran?.nama, row.departemen?.kode);
    return category && (categoryFilter === "all" || category === categoryFilter);
  }).map((row) => ({ ...row,
    siswa_nama: row.siswa?.nama || "—", jenis: row.jenis_pembayaran?.nama || "—",
    tahun_ajaran_label: row.tahun_ajaran?.nama || "—", lembaga: row.departemen?.kode || "—",
    status_dimuka: isDimuka(row) ? "Di Muka" : "Reguler",
    kategori_spp_label: sppCategoryLabel(sppCategory(row.spp_kategori, row.jenis_pembayaran?.nama, row.departemen?.kode)) }));
  const summary = sppReceiptGroups(sppItems);
  const unverifiedTotal = summary.filter(group => group.kategori === "belum_terverifikasi").reduce((sum, group) => sum + group.jumlah, 0);
  const regulerItems = sppItems.filter((r) => !isDimuka(r));
  const dimukaItems = sppItems.filter((r) => isDimuka(r));
  const totalReguler = regulerItems.reduce((s, r) => s + Number(r.jumlah || 0), 0);
  const totalDimuka = dimukaItems.reduce((s, r) => s + Number(r.jumlah || 0), 0);
  const total = totalReguler + totalDimuka;

  const columns: DataTableColumn<any>[] = [
    { key: "tanggal_bayar", label: "Tanggal", render: (v) => v ? format(new Date(v as string), "dd MMM yyyy", { locale: idLocale }) : "-" },
    { key: "siswa_nama", label: "Siswa", render: (_, r) => (r as any).siswa?.nama || "-" },
    { key: "jenis", label: "Jenis Bayar", render: (_, r) => (r as any).jenis_pembayaran?.nama || "-" },
    { key: "tahun_ajaran", label: "TA", render: (_, r) => (r as any).tahun_ajaran?.nama || "-" },
    { key: "lembaga", label: "Lembaga", render: (_, r) => (r as any).departemen?.kode || "-" },
    { key: "kategori_spp_label", label: "Kategori SPP" },
    { key: "jumlah", label: "Jumlah", render: (v) => formatRupiah(Number(v)) },
    {
      key: "status_dimuka", label: "Status",
      render: (_, r) => isDimuka(r as any)
        ? <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30">Di Muka</Badge>
        : <Badge variant="outline" className="bg-success/15 text-success border-success/30">Reguler</Badge>,
    },
    {
      key: "jurnal", label: "Jurnal",
      render: (_, r) => {
        const j = (r as any).jurnal;
        if (j?.nomor) {
          return (
            <Badge
              className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30 cursor-pointer hover:bg-emerald-500/20"
              variant="outline"
            >
              <CheckCircle className="h-3 w-3 mr-1" />
              {j.nomor}
            </Badge>
          );
        }
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">Manual</Badge>;
      },
    },
  ];

  return (
    <div className="space-y-4 pt-4">
      <div className="flex gap-3 items-end flex-wrap">
        <div>
          <Label>Bulan</Label>
          <Select value={String(bulan)} onValueChange={(v) => setBulan(Number(v))}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>{BULAN_ORDER_AKADEMIK.map((m) => <SelectItem key={m} value={String(m)}>{namaBulan(m)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Tahun</Label>
          <Input type="number" className="w-24" value={tahun} onChange={(e) => setTahun(Number(e.target.value))} />
        </div>
        <div>
          <Label>Tahun Ajaran</Label>
          <Select value={filterTA} onValueChange={setFilterTA}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Semua TA" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Tahun Ajaran</SelectItem>
              {tahunAjaranList?.map((ta: any) => (
                <SelectItem key={ta.id} value={ta.id}>{ta.nama}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label>Kategori SPP</Label>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua kategori</SelectItem>
              {Object.entries(SPP_CATEGORY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <p className="text-sm text-muted-foreground">Kategori mengikuti tagihan saat transaksi, termasuk cicilan dan pembayaran di muka.</p>
      </div>
      {!isLoading && unverifiedTotal > 0 && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">SPP {formatRupiah(unverifiedTotal)} belum terverifikasi kategorinya. Nilai ini tetap masuk total dan ditampilkan terpisah.</p>}
      <Card>
        <CardHeader><CardTitle>Rekap penerimaan SPP per lembaga dan kategori</CardTitle></CardHeader>
        <CardContent>
          <DataTable columns={[
            { key: "lembaga", label: "Lembaga" },
            { key: "label", label: "Kategori SPP" },
            { key: "transaksi", label: "Transaksi" },
            { key: "jumlah", label: "Penerimaan", render: value => formatRupiah(Number(value)) },
          ]} data={summary} loading={isLoading} searchable={false} exportable exportFilename="rekap-spp-asrama" exportColumns={[
            { key: "lembaga", label: "Lembaga" }, { key: "label", label: "Kategori SPP" },
            { key: "transaksi", label: "Transaksi" }, { key: "jumlah", label: "Penerimaan" },
          ]} />
          <p className="mt-3 text-sm text-muted-foreground">Rekap ini menunjukkan kas yang diterima. Pendapatan yang diakui mengikuti jurnal pada laporan akuntansi.</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <DataTable columns={columns} data={sppItems} loading={isLoading} exportable exportFilename="laporan-penerimaan-spp" pageSize={20} exportColumns={[
            { key: "tanggal_bayar", label: "Tanggal" },
            { key: "siswa_nama", label: "Siswa" },
            { key: "jenis", label: "Jenis Bayar" },
            { key: "tahun_ajaran_label", label: "TA" },
            { key: "lembaga", label: "Lembaga" },
            { key: "kategori_spp_label", label: "Kategori SPP" },
            { key: "jumlah", label: "Jumlah" },
            { key: "status_dimuka", label: "Status" },
          ]} />
          {!isLoading && (
            <div className="mt-4 space-y-1 text-right text-sm">
              <p>Penerimaan Reguler: <span className="font-semibold text-success">{formatRupiah(totalReguler)}</span></p>
              <p>Pembayaran Di Muka (Belum Diakui): <span className="font-semibold text-warning">{formatRupiah(totalDimuka)}</span></p>
              <p className="text-base font-bold border-t pt-2">Total: {formatRupiah(total)}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TabPengeluaran({ departemenId }: { departemenId?: string }) {
  const [bulan, setBulan] = useState(now.getMonth() + 1);
  const [tahun, setTahun] = useState(now.getFullYear());

  const { data, isLoading } = useQuery({
    queryKey: ["laporan_pengeluaran_detail", bulan, tahun, departemenId],
    queryFn: async () => {
      const start = `${tahun}-${String(bulan).padStart(2, "0")}-01`;
      const endM = bulan === 12 ? 1 : bulan + 1;
      const endY = bulan === 12 ? tahun + 1 : tahun;
      const end = `${endY}-${String(endM).padStart(2, "0")}-01`;
      let q = supabase
        .from("pengeluaran" as any)
        .select("*, jenis_pengeluaran:jenis_id(nama), departemen:departemen_id(nama, kode)")
        .gte("tanggal", start)
        .lt("tanggal", end)
        .order("tanggal", { ascending: false });
      if (departemenId) q = (q as any).eq("departemen_id", departemenId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const total = data?.reduce((s, r) => s + Number(r.jumlah || 0), 0) || 0;

  const columns: DataTableColumn<any>[] = [
    { key: "tanggal", label: "Tanggal", render: (v) => v ? format(new Date(v as string), "dd MMM yyyy", { locale: idLocale }) : "-" },
    { key: "jenis", label: "Jenis", render: (_, r) => r.jenis_pengeluaran?.nama || "-" },
    { key: "lembaga", label: "Lembaga", render: (_, r) => r.departemen?.kode || "-" },
    { key: "jumlah", label: "Jumlah", render: (v) => formatRupiah(Number(v)) },
    { key: "keterangan", label: "Keterangan", render: (v) => (v as string) || "-" },
  ];

  return (
    <div className="space-y-4 pt-4">
      <div className="flex gap-3 items-end">
        <div>
          <Label>Bulan</Label>
          <Select value={String(bulan)} onValueChange={(v) => setBulan(Number(v))}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>{BULAN_ORDER_AKADEMIK.map((m) => <SelectItem key={m} value={String(m)}>{namaBulan(m)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Tahun</Label>
          <Input type="number" className="w-24" value={tahun} onChange={(e) => setTahun(Number(e.target.value))} />
        </div>
      </div>
      <Card>
        <CardContent className="pt-6">
          <DataTable columns={columns} data={data || []} loading={isLoading} exportable exportFilename="laporan-pengeluaran" pageSize={20} />
          {!isLoading && <p className="text-right font-bold mt-4">Total: {formatRupiah(total)}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function TabRekapSPP({ departemenId }: { departemenId?: string }) {
  const [kelasId, setKelasId] = useState("");
  const [filterTA, setFilterTA] = useState("");
  const [filterJenis, setFilterJenis] = useState("");
  const { data: kelasList } = useKelas();
  const { data: jenisList } = useJenisPembayaran();
  const { data: tahunAjaranList } = useQuery({
    queryKey: ["tahun_ajaran_list_spp"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tahun_ajaran").select("id, nama").order("nama", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Filter kelas by departemen
  const filteredKelas = departemenId
    ? kelasList?.filter((k: any) => k.departemen_id === departemenId)
    : kelasList;

  // Filter jenis pembayaran: only bulanan (SPP-type), and by departemen
  const filteredJenis = jenisList?.filter((j: any) => {
    if (j.tipe !== "bulanan") return false;
    if (departemenId && j.departemen_id && j.departemen_id !== departemenId) return false;
    return true;
  });

  // Auto-select first jenis if not set
  const jenisId = filterJenis || filteredJenis?.[0]?.id || "";

  const { data, isLoading } = useQuery({
    queryKey: ["rekap_spp_kelas", kelasId, jenisId, filterTA, departemenId],
    enabled: !!kelasId && !!jenisId,
    queryFn: async () => {
      let kelasQuery = supabase
        .from("kelas_siswa")
        .select("siswa_id, siswa:siswa_id(nama, nis)")
        .eq("kelas_id", kelasId)
        .eq("aktif", true);
      if (filterTA) kelasQuery = kelasQuery.eq("tahun_ajaran_id", filterTA);

      const { data: siswaList } = await kelasQuery;
      if (!siswaList?.length) return [];

      const siswaIds = siswaList.map((s: any) => s.siswa_id);
      let payQuery = supabase
        .from("pembayaran")
        .select("siswa_id, bulan")
        .eq("jenis_id", jenisId)
        .in("siswa_id", siswaIds);
      if (filterTA) payQuery = payQuery.eq("tahun_ajaran_id", filterTA);
      if (departemenId) payQuery = payQuery.eq("departemen_id", departemenId);

      const { data: payments } = await payQuery;

      const paidMap = new Map<string, Set<number>>();
      payments?.forEach((p) => {
        if (!paidMap.has(p.siswa_id!)) paidMap.set(p.siswa_id!, new Set());
        paidMap.get(p.siswa_id!)!.add(p.bulan!);
      });

      return siswaList.map((ks: any) => {
        const paid = paidMap.get(ks.siswa_id) || new Set();
        const row: any = { nama: ks.siswa?.nama, nis: ks.siswa?.nis };
        for (let b = 1; b <= 12; b++) row[`b${b}`] = paid.has(b) ? "✓" : "✗";
        return row;
      });
    },
  });

  const sppColumns: DataTableColumn<any>[] = [
    { key: "nis", label: "NIS" },
    { key: "nama", label: "Nama" },
    ...BULAN_ORDER_AKADEMIK.map((m) => ({
      key: `b${m}`,
      label: BULAN_NAMES[m - 1].substring(0, 3),
      render: (v: unknown) => (
        <span className={v === "✓" ? "text-success font-bold" : "text-destructive font-bold"}>
          {v as string}
        </span>
      ),
    })),
  ];

  return (
    <div className="space-y-4 pt-4">
      <div className="flex gap-3 items-end flex-wrap">
        <div>
          <Label>Tahun Ajaran</Label>
          <Select value={filterTA} onValueChange={(v) => { setFilterTA(v); setKelasId(""); }}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Pilih TA" /></SelectTrigger>
            <SelectContent>
              {tahunAjaranList?.map((ta: any) => (
                <SelectItem key={ta.id} value={ta.id}>{ta.nama}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Jenis Pembayaran</Label>
          <Select value={jenisId} onValueChange={setFilterJenis}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Pilih jenis" /></SelectTrigger>
            <SelectContent>
              {filteredJenis?.map((j: any) => (
                <SelectItem key={j.id} value={j.id}>{j.nama}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Kelas</Label>
          <Select value={kelasId} onValueChange={setKelasId}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Pilih kelas" /></SelectTrigger>
            <SelectContent>
              {filteredKelas?.map((k: any) => <SelectItem key={k.id} value={k.id}>{k.nama}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      {kelasId && jenisId ? (
        <Card>
          <CardContent className="pt-6">
            <DataTable columns={sppColumns} data={data || []} loading={isLoading} exportable exportFilename="rekap-spp" pageSize={50} searchable={false} />
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-8">Pilih tahun ajaran, jenis pembayaran, dan kelas untuk melihat rekap SPP</p>
      )}
    </div>
  );
}

function TabNeraca({ departemenId }: { departemenId?: string }) {
  const [bulan, setBulan] = useState(now.getMonth() + 1);
  const [tahun, setTahun] = useState(now.getFullYear());

  const start = `${tahun}-${String(bulan).padStart(2, "0")}-01`;
  const endM = bulan === 12 ? 1 : bulan + 1;
  const endY = bulan === 12 ? tahun + 1 : tahun;
  const end = `${endY}-${String(endM).padStart(2, "0")}-01`;

  const { data: rawPenerimaan, isLoading: lP } = useQuery({
    queryKey: ["neraca_penerimaan_v4_spp_unit", bulan, tahun, departemenId],
    queryFn: async () => {
      const rows = await fetchAllPages((from, to) => {
        let q = supabase
        .from("pembayaran")
        .select("id, jumlah, spp_kategori, jenis_pembayaran:jenis_id!inner(nama, departemen_id, departemen:departemen_id(kode)), departemen:departemen_id(kode), keterangan")
        .gte("tanggal_bayar", start)
        .lt("tanggal_bayar", end).order("id");
      if (departemenId) q = q.eq("jenis_pembayaran.departemen_id", departemenId);
        return q.range(from, to);
      });
      return rows.map(row => ({ ...row, departemen: row.jenis_pembayaran?.departemen || row.departemen }));
    },
  });

  // Cross-reference dimuka
  const pembIds = rawPenerimaan?.map((r: any) => r.id).filter(Boolean) || [];
  const { data: dimukaRefs } = useQuery({
    queryKey: ["neraca_dimuka_refs", pembIds],
    enabled: pembIds.length > 0,
    queryFn: async () => {
      const refs = new Set<string>();
      for (let offset = 0; offset < pembIds.length; offset += 200) {
        const { data, error } = await supabase.from("pendapatan_dimuka").select("pembayaran_id")
          .in("pembayaran_id", pembIds.slice(offset, offset + 200));
        if (error) throw error;
        for (const row of data || []) refs.add(row.pembayaran_id);
      }
      return refs;
    },
  });

  const dimukaSetN = dimukaRefs || new Set<string>();
  const isDimukaN = (r: any) => dimukaSetN.has(r.id) || (r.keterangan && (r.keterangan as string).includes("[DIMUKA]"));

  const penerimaan = (() => {
    const grouped = new Map<string, number>();
    let totalDimuka = 0;
    rawPenerimaan?.forEach((r: any) => {
      if (isDimukaN(r)) {
        totalDimuka += Number(r.jumlah);
      } else {
        const category = sppCategory(r.spp_kategori, r.jenis_pembayaran?.nama, r.departemen?.kode);
        const key = category
          ? `${r.jenis_pembayaran?.nama} — ${sppCategoryLabel(category)}`
          : r.jenis_pembayaran?.nama || "Lainnya";
        grouped.set(key, (grouped.get(key) || 0) + Number(r.jumlah));
      }
    });
    const items = Array.from(grouped, ([nama, total]) => ({ nama, total }));
    return { items, totalDimuka };
  })();

  const { data: pengeluaran, isLoading: lE } = useQuery({
    queryKey: ["neraca_pengeluaran", bulan, tahun, departemenId],
    queryFn: async () => {
      let q = supabase
        .from("pengeluaran" as any)
        .select("jumlah, jenis_pengeluaran:jenis_id(nama)")
        .gte("tanggal", start)
        .lt("tanggal", end);
      if (departemenId) q = (q as any).eq("departemen_id", departemenId);
      const { data } = await q;
      const grouped = new Map<string, number>();
      (data as any[])?.forEach((r: any) => {
        const key = r.jenis_pengeluaran?.nama || "Lainnya";
        grouped.set(key, (grouped.get(key) || 0) + Number(r.jumlah));
      });
      return Array.from(grouped, ([nama, total]) => ({ nama, total }));
    },
  });

  const totalP = penerimaan.items.reduce((s, r) => s + r.total, 0);
  const totalDimuka = penerimaan.totalDimuka;
  const totalE = pengeluaran?.reduce((s, r) => s + r.total, 0) || 0;
  const saldo = totalP - totalE;
  const loading = lP || lE;

  return (
    <div className="space-y-4 pt-4">
      <div className="flex gap-3 items-end">
        <div>
          <Label>Bulan</Label>
          <Select value={String(bulan)} onValueChange={(v) => setBulan(Number(v))}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>{BULAN_ORDER_AKADEMIK.map((m) => <SelectItem key={m} value={String(m)}>{namaBulan(m)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Tahun</Label>
          <Input type="number" className="w-24" value={tahun} onChange={(e) => setTahun(Number(e.target.value))} />
        </div>
      </div>

      {loading ? <Skeleton className="h-48" /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-success">Penerimaan (Reguler)</CardTitle></CardHeader>
            <CardContent>
              {penerimaan.items.map((r) => (
                <div key={r.nama} className="flex justify-between py-1.5 border-b last:border-0">
                  <span>{r.nama}</span><span className="font-medium">{formatRupiah(r.total)}</span>
                </div>
              ))}
              <div className="flex justify-between pt-3 font-bold border-t mt-2">
                <span>Total Penerimaan Reguler</span><span className="text-success">{formatRupiah(totalP)}</span>
              </div>
              {totalDimuka > 0 && (
                <div className="flex justify-between pt-2 text-sm text-warning">
                  <span>Pembayaran Di Muka (Kewajiban)</span><span className="font-semibold">{formatRupiah(totalDimuka)}</span>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-destructive">Pengeluaran</CardTitle></CardHeader>
            <CardContent>
              {pengeluaran?.map((r) => (
                <div key={r.nama} className="flex justify-between py-1.5 border-b last:border-0">
                  <span>{r.nama}</span><span className="font-medium">{formatRupiah(r.total)}</span>
                </div>
              ))}
              <div className="flex justify-between pt-3 font-bold border-t mt-2">
                <span>Total Pengeluaran</span><span className="text-destructive">{formatRupiah(totalE)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          <div className="flex justify-between items-center text-lg">
            <span className="font-bold">Saldo Akhir (Reguler)</span>
            <span className={`font-bold text-xl ${saldo >= 0 ? "text-success" : "text-destructive"}`}>
              {formatRupiah(saldo)}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
