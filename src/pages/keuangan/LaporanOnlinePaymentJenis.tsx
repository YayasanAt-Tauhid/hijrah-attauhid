import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { Banknote, CheckCircle2, Receipt, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatsCard } from "@/components/shared/StatsCard";
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { ExportButton } from "@/components/shared/ExportButton";

const formatRupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(n);

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  bank_transfer: "Transfer Bank (Virtual Account)",
  credit_card: "Kartu Kredit",
  gopay: "GoPay",
  shopeepay: "ShopeePay",
  qris: "QRIS",
  echannel: "Mandiri Bill",
  cstore: "Minimarket",
};

const NAMA_BULAN = ["", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const PAGE = 1000;

type Row = {
  id: string;
  order_id: string;
  paid_at: string | null;
  payment_type: string | null;
  siswa: string;
  nis: string;
  lembaga: string;
  jenis: string;
  nama_item: string;
  periode: string;
  jumlah: number;
};

type KasirRow = {
  id: string;
  tanggal_bayar: string | null;
  nomor_jurnal: string;
  nis: string;
  siswa: string;
  lembaga: string;
  jenis: string;
  periode: string;
  jumlah: number;
};

type ItemRaw = {
  id: string;
  bulan: number | null;
  nama_item: string;
  jumlah: number;
  transaksi: {
    id: string;
    order_id: string;
    paid_at: string | null;
    payment_type: string | null;
    biaya_admin: number | null;
  };
  siswa: { nama: string; nis: string | null } | null;
  jenis: { nama: string } | null;
  departemen: { nama: string } | null;
};

type PembayaranRaw = {
  id: string;
  jumlah: number | null;
  tanggal_bayar: string | null;
  bulan: number | null;
  departemen_id: string | null;
  siswa: { nama: string; nis: string | null } | null;
  jenis: { nama: string } | null;
  jurnal: { nomor: string | null } | null;
};

export default function LaporanOnlinePaymentJenis() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [lembagaId, setLembagaId] = useState("all");

  const { data: lembagaList } = useQuery({
    queryKey: ["laporan_midtrans_lembaga"],
    queryFn: async () => {
      const { data, error } = await supabase.from("departemen").select("id, nama").order("nama");
      if (error) throw error;
      return data || [];
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["laporan_midtrans_jenis", dateFrom, dateTo, lembagaId],
    queryFn: async () => {
      const rows: Row[] = [];
      let adminFee = 0;
      const seenTx = new Set<string>();

      for (let from = 0; ; from += PAGE) {
        let q = supabase
          .from("transaksi_midtrans_item")
          .select(
            "id, bulan, nama_item, jumlah, departemen_id, " +
              "transaksi:transaksi_id!inner(id, order_id, status, paid_at, payment_type, biaya_admin), " +
              "siswa:siswa_id(nama, nis), jenis:jenis_id(nama), departemen:departemen_id(nama)",
          )
          .eq("transaksi.status", "paid")
          .order("created_at", { ascending: true })
          .range(from, from + PAGE - 1);

        if (dateFrom) q = q.gte("transaksi.paid_at", `${dateFrom}T00:00:00+07:00`);
        if (dateTo) q = q.lte("transaksi.paid_at", `${dateTo}T23:59:59+07:00`);
        if (lembagaId !== "all") q = q.eq("departemen_id", lembagaId);

        const { data: page, error } = await q;
        if (error) throw error;
        const batch = (page || []) as unknown as ItemRaw[];

        for (const it of batch) {
          const tx = it.transaksi;
          if (!seenTx.has(tx.id)) {
            seenTx.add(tx.id);
            adminFee += Number(tx.biaya_admin || 0);
          }
          rows.push({
            id: it.id,
            order_id: tx.order_id,
            paid_at: tx.paid_at,
            payment_type: tx.payment_type,
            siswa: it.siswa?.nama || "-",
            nis: it.siswa?.nis || "-",
            lembaga: it.departemen?.nama || "-",
            jenis: it.jenis?.nama || it.nama_item || "-",
            nama_item: it.nama_item,
            periode: it.bulan ? NAMA_BULAN[it.bulan] || String(it.bulan) : "-",
            jumlah: Number(it.jumlah),
          });
        }
        if (batch.length < PAGE) break;
      }

      rows.sort((a, b) => (a.paid_at || "").localeCompare(b.paid_at || ""));
      return { rows, adminFee, txCount: seenTx.size };
    },
  });

  const rows = useMemo(() => data?.rows ?? [], [data]);

  const { data: kasirTransfer, isLoading: kasirLoading } = useQuery({
    queryKey: ["laporan_transfer_kasir", dateFrom, dateTo, lembagaId],
    queryFn: async () => {
      const { data: setting, error: settingErr } = await supabase
        .from("pengaturan_akun")
        .select("akun_id")
        .eq("kode_setting", "kas_bank_transfer")
        .maybeSingle();
      if (settingErr) throw settingErr;
      if (!setting?.akun_id) return { configured: false, rows: [] as KasirRow[] };

      const out: KasirRow[] = [];
      for (let from = 0; ; from += PAGE) {
        let q = supabase
          .from("pembayaran")
          .select(
            "id, jumlah, tanggal_bayar, bulan, departemen_id, siswa:siswa_id(nama, nis), jenis:jenis_id(nama), " +
              "jurnal:jurnal_id!inner(nomor, jurnal_detail!inner(akun_id, debit))",
          )
          .eq("jurnal.jurnal_detail.akun_id", setting.akun_id)
          .gt("jurnal.jurnal_detail.debit", 0)
          .order("tanggal_bayar", { ascending: true })
          .range(from, from + PAGE - 1);

        if (dateFrom) q = q.gte("tanggal_bayar", dateFrom);
        if (dateTo) q = q.lte("tanggal_bayar", dateTo);
        if (lembagaId !== "all") q = q.eq("departemen_id", lembagaId);

        const { data: page, error } = await q;
        if (error) throw error;
        const batch = (page || []) as unknown as PembayaranRaw[];
        for (const p of batch) {
          out.push({
            id: p.id,
            tanggal_bayar: p.tanggal_bayar,
            nomor_jurnal: p.jurnal?.nomor || "-",
            nis: p.siswa?.nis || "-",
            siswa: p.siswa?.nama || "-",
            lembaga: (lembagaList || []).find((l) => l.id === p.departemen_id)?.nama || "-",
            jenis: p.jenis?.nama || "-",
            periode: p.bulan ? NAMA_BULAN[p.bulan] || String(p.bulan) : "-",
            jumlah: Number(p.jumlah || 0),
          });
        }
        if (batch.length < PAGE) break;
      }
      return { configured: true, rows: out };
    },
  });

  const kasirRows = useMemo(() => kasirTransfer?.rows ?? [], [kasirTransfer]);
  const kasirTotal = kasirRows.reduce((s, r) => s + r.jumlah, 0);

  const kasirColumns: DataTableColumn<KasirRow>[] = [
    {
      key: "tanggal_bayar", label: "Tgl Bayar", sortable: true,
      render: (v) => (v ? format(new Date(`${v as string}T00:00:00`), "dd MMM yyyy", { locale: idLocale }) : "-"),
    },
    { key: "nomor_jurnal", label: "No. Jurnal", render: (v) => <span className="font-mono text-xs">{v as string}</span> },
    { key: "siswa", label: "Siswa", sortable: true },
    { key: "lembaga", label: "Lembaga", sortable: true },
    { key: "jenis", label: "Jenis", sortable: true },
    { key: "periode", label: "Bulan" },
    {
      key: "jumlah", label: "Jumlah", sortable: true,
      render: (v) => <span className="font-semibold">{formatRupiah(Number(v))}</span>,
    },
  ];

  const ringkasan = useMemo(() => {
    const map = new Map<string, { jenis: string; lembaga: string; jumlahItem: number; total: number }>();
    for (const r of rows) {
      const key = `${r.lembaga}||${r.jenis}`;
      const cur = map.get(key) ?? { jenis: r.jenis, lembaga: r.lembaga, jumlahItem: 0, total: 0 };
      cur.jumlahItem += 1;
      cur.total += r.jumlah;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => a.lembaga.localeCompare(b.lembaga) || a.jenis.localeCompare(b.jenis));
  }, [rows]);

  const perMetode = useMemo(() => {
    const map = new Map<string, { metode: string; jumlahItem: number; total: number }>();
    for (const r of rows) {
      const metode = r.payment_type ? PAYMENT_TYPE_LABELS[r.payment_type] || r.payment_type : "Tidak diketahui";
      const cur = map.get(metode) ?? { metode, jumlahItem: 0, total: 0 };
      cur.jumlahItem += 1;
      cur.total += r.jumlah;
      map.set(metode, cur);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [rows]);

  const grandTotal = ringkasan.reduce((s, r) => s + r.total, 0);

  const columns: DataTableColumn<Row>[] = [
    {
      key: "paid_at", label: "Tgl Bayar", sortable: true,
      render: (v) => (v ? format(new Date(v as string), "dd MMM yyyy HH:mm", { locale: idLocale }) : "-"),
    },
    { key: "order_id", label: "Order ID", render: (v) => <span className="font-mono text-xs">{v as string}</span> },
    { key: "siswa", label: "Siswa", sortable: true },
    { key: "lembaga", label: "Lembaga", sortable: true },
    { key: "jenis", label: "Jenis", sortable: true },
    { key: "periode", label: "Bulan" },
    {
      key: "jumlah", label: "Jumlah", sortable: true,
      render: (v) => <span className="font-semibold">{formatRupiah(Number(v))}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex gap-3 items-end flex-wrap">
        <div>
          <Label className="text-xs">Dibayar dari</Label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label className="text-xs">Sampai</Label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label className="text-xs">Lembaga</Label>
          <Select value={lembagaId} onValueChange={setLembagaId}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Lembaga</SelectItem>
              {(lembagaList || []).map((l) => (
                <SelectItem key={l.id} value={l.id}>{l.nama}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatsCard title="Total Pembayaran Online (Lunas)" value={formatRupiah(grandTotal)} icon={Wallet} color="success" />
        <StatsCard title="Jumlah Transaksi / Item" value={`${data?.txCount ?? 0} / ${rows.length}`} icon={Receipt} />
        <StatsCard title="Biaya Admin Midtrans (di luar tagihan)" value={formatRupiah(data?.adminFee ?? 0)} icon={Banknote} />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" /> Rekap per Jenis Pembayaran
          </CardTitle>
          <ExportButton
            data={ringkasan as unknown as Record<string, unknown>[]}
            filename="rekap-online-payment-per-jenis"
            sheetName="Rekap"
            columns={[
              { key: "lembaga", label: "Lembaga" },
              { key: "jenis", label: "Jenis Pembayaran" },
              { key: "jumlahItem", label: "Jumlah Item" },
              { key: "total", label: "Total" },
            ]}
          />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lembaga</TableHead>
                <TableHead>Jenis Pembayaran</TableHead>
                <TableHead className="text-right">Item</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ringkasan.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    {isLoading ? "Memuat..." : "Belum ada pembayaran online lunas pada filter ini"}
                  </TableCell>
                </TableRow>
              )}
              {ringkasan.map((r) => (
                <TableRow key={`${r.lembaga}-${r.jenis}`}>
                  <TableCell>{r.lembaga}</TableCell>
                  <TableCell>{r.jenis}</TableCell>
                  <TableCell className="text-right">{r.jumlahItem}</TableCell>
                  <TableCell className="text-right font-medium">{formatRupiah(r.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            {ringkasan.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2} className="font-bold">Total</TableCell>
                  <TableCell className="text-right font-bold">{rows.length}</TableCell>
                  <TableCell className="text-right font-bold">{formatRupiah(grandTotal)}</TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Rekap per Metode Pembayaran</CardTitle>
          <ExportButton
            data={perMetode as unknown as Record<string, unknown>[]}
            filename="rekap-online-payment-per-metode"
            sheetName="Per Metode"
            columns={[
              { key: "metode", label: "Metode" },
              { key: "jumlahItem", label: "Jumlah Item" },
              { key: "total", label: "Total" },
            ]}
          />
        </CardHeader>
        <CardContent className="space-y-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metode</TableHead>
                <TableHead className="text-right">Item</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {perMetode.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    {isLoading ? "Memuat..." : "Belum ada data"}
                  </TableCell>
                </TableRow>
              )}
              {perMetode.map((m) => (
                <TableRow key={m.metode}>
                  <TableCell>{m.metode}</TableCell>
                  <TableCell className="text-right">{m.jumlahItem}</TableCell>
                  <TableCell className="text-right font-medium">{formatRupiah(m.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            Tabel ini hanya mencakup pembayaran online via Midtrans. Transfer yang diterima kasir ada di bagian
            "Transfer via Kasir" di bawah.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between gap-2">
            <span>Transfer via Kasir</span>
            {kasirTransfer?.configured && (
              <span className="text-sm font-semibold">{formatRupiah(kasirTotal)} ({kasirRows.length} pembayaran)</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {kasirTransfer && !kasirTransfer.configured ? (
            <p className="text-sm text-muted-foreground">
              Akun Bank Transfer Kasir belum diatur. Isi di Referensi Keuangan → Pengaturan Akun
              ("Akun Bank Transfer Kasir"). Pembayaran transfer di kasir dicatat sejak akun ini diatur;
              pembayaran sebelumnya masuk Kas Tunai dan tidak bisa dipisahkan.
            </p>
          ) : (
            <DataTable
              columns={kasirColumns}
              data={kasirRows}
              loading={kasirLoading}
              searchable
              exportable
              exportFilename="laporan-transfer-kasir"
              exportSheetName="Transfer Kasir"
              exportColumns={[
                { key: "tanggal_bayar", label: "Tanggal Bayar" },
                { key: "nomor_jurnal", label: "No. Jurnal" },
                { key: "nis", label: "NIS" },
                { key: "siswa", label: "Siswa" },
                { key: "lembaga", label: "Lembaga" },
                { key: "jenis", label: "Jenis" },
                { key: "periode", label: "Bulan" },
                { key: "jumlah", label: "Jumlah" },
              ]}
              pageSize={20}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rincian per Siswa</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={rows}
            loading={isLoading}
            searchable
            exportable
            exportFilename="laporan-online-payment-rincian"
            exportSheetName="Rincian"
            exportColumns={[
              { key: "paid_at", label: "Tanggal Bayar" },
              { key: "order_id", label: "Order ID" },
              { key: "nis", label: "NIS" },
              { key: "siswa", label: "Siswa" },
              { key: "lembaga", label: "Lembaga" },
              { key: "jenis", label: "Jenis" },
              { key: "nama_item", label: "Item" },
              { key: "periode", label: "Bulan" },
              { key: "payment_type", label: "Metode" },
              { key: "jumlah", label: "Jumlah" },
            ]}
            pageSize={20}
          />
        </CardContent>
      </Card>
    </div>
  );
}
