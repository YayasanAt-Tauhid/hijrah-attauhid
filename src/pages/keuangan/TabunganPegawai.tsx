import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { useTabunganPegawai, useTransaksiTabunganPegawaiList, useTransaksiTabunganPegawai, formatRupiah } from "@/hooks/useKeuangan";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Search, PiggyBank } from "lucide-react";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";

export default function TabunganPegawai() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPegawai, setSelectedPegawai] = useState<any>(null);

  const [jenis, setJenis] = useState<"setor" | "ambil">("setor");
  const [jumlah, setJumlah] = useState("");
  const [tanggal, setTanggal] = useState(format(new Date(), "yyyy-MM-dd"));
  const [keterangan, setKeterangan] = useState("");

  const { data: tabungan } = useTabunganPegawai(selectedPegawai?.id);
  const { data: transaksiList, isLoading } = useTransaksiTabunganPegawaiList(selectedPegawai?.id);
  const transaksiMut = useTransaksiTabunganPegawai();

  const { data: searchResults } = useQuery({
    queryKey: ["search_pegawai_tab", searchTerm],
    enabled: searchTerm.length >= 2,
    queryFn: async () => {
      const { data } = await supabase
        .from("pegawai")
        .select("id, nip, nama, jabatan, departemen:departemen_id(nama)")
        .or(`nama.ilike.%${searchTerm}%,nip.ilike.%${searchTerm}%`)
        .eq("status", "aktif")
        .limit(10);
      return data || [];
    },
  });

  const handleSubmit = async () => {
    if (!selectedPegawai || !jumlah) return;
    await transaksiMut.mutateAsync({
      pegawai_id: selectedPegawai.id,
      jenis,
      jumlah: Number(jumlah),
      tanggal,
      keterangan: keterangan || undefined,
    });
    setJumlah("");
    setKeterangan("");
  };

  const saldo = Number(tabungan?.saldo || 0);

  const columns: DataTableColumn<any>[] = [
    { key: "tanggal", label: "Tanggal", render: (v) => v ? format(new Date(v as string), "dd MMM yyyy", { locale: idLocale }) : "-" },
    {
      key: "jenis", label: "Jenis",
      render: (v) => (
        <span className={v === "setor" ? "text-success font-medium" : "text-destructive font-medium"}>
          {v === "setor" ? "Setor" : "Ambil"}
        </span>
      ),
    },
    { key: "jumlah", label: "Jumlah", render: (v) => formatRupiah(Number(v)) },
    { key: "saldo_sesudah", label: "Saldo", render: (v) => formatRupiah(Number(v)) },
    { key: "keterangan", label: "Keterangan", render: (v) => (v as string) || "-" },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Tabungan Pegawai</h1>
        <p className="text-sm text-muted-foreground">Kelola tabungan pegawai</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Cari pegawai (NIP atau nama)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
            {searchResults && searchResults.length > 0 && searchTerm.length >= 2 && (
              <div className="absolute z-50 mt-1 w-full bg-popover border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {searchResults.map((p) => (
                  <button
                    key={p.id}
                    className="w-full text-left px-4 py-2.5 hover:bg-accent flex items-center gap-3"
                    onClick={() => { setSelectedPegawai(p); setSearchTerm(""); }}
                  >
                    <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold">{p.nama?.[0]}</div>
                    <div>
                      <p className="text-sm font-medium">{p.nama}</p>
                      <p className="text-xs text-muted-foreground">NIP: {p.nip || "-"} • {p.jabatan || "-"}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {selectedPegawai && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold text-primary">{selectedPegawai.nama?.[0]}</div>
                <div>
                  <h3 className="font-semibold">{selectedPegawai.nama}</h3>
                  <p className="text-xs text-muted-foreground">NIP: {selectedPegawai.nip || "-"} • {selectedPegawai.jabatan || "-"}</p>
                </div>
              </div>
              <div className="rounded-lg bg-primary/5 p-4 text-center">
                <PiggyBank className="h-8 w-8 mx-auto text-primary mb-1" />
                <p className="text-xs text-muted-foreground">Saldo Tabungan</p>
                <p className="text-2xl font-bold text-primary">{formatRupiah(saldo)}</p>
              </div>

              <div className="space-y-3 pt-2">
                <div>
                  <Label>Jenis Transaksi</Label>
                  <Select value={jenis} onValueChange={(v) => setJenis(v as "setor" | "ambil")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="setor">Setor</SelectItem>
                      <SelectItem value="ambil">Ambil</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Jumlah (Rp)</Label>
                  <Input type="number" value={jumlah} onChange={(e) => setJumlah(e.target.value)} placeholder="0" />
                </div>
                <div>
                  <Label>Tanggal</Label>
                  <Input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
                </div>
                <div>
                  <Label>Keterangan</Label>
                  <Textarea value={keterangan} onChange={(e) => setKeterangan(e.target.value)} placeholder="Opsional" rows={2} />
                </div>
                <Button onClick={handleSubmit} disabled={!jumlah || transaksiMut.isPending} className="w-full">
                  {transaksiMut.isPending ? "Memproses..." : jenis === "setor" ? "Setor" : "Ambil"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Riwayat Transaksi</CardTitle></CardHeader>
            <CardContent>
              <DataTable
                columns={columns}
                data={transaksiList || []}
                loading={isLoading}
                searchable={false}
                pageSize={15}
                emptyMessage="Belum ada transaksi tabungan"
              />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
