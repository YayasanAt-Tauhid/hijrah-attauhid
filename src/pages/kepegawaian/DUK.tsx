import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useLembaga } from "@/hooks/useKeuangan";
import { useState } from "react";
import { format, differenceInYears } from "date-fns";
import { id as idLocale } from "date-fns/locale";

export default function DUK() {
  const [filterLembaga, setFilterLembaga] = useState("all");
  const { data: lembagaList } = useLembaga();

  const { data, isLoading } = useQuery({
    queryKey: ["duk_list", filterLembaga],
    queryFn: async () => {
      let q = supabase
        .from("pegawai")
        .select("id, nama, nip, jabatan, golongan_terakhir, tanggal_masuk, tanggal_lahir, tanggal_pensiun, status, departemen:departemen_id(nama, kode)")
        .eq("status", "aktif")
        .order("golongan_terakhir", { ascending: false, nullsFirst: false });

      if (filterLembaga === "yayasan") q = q.is("departemen_id", null);
      else if (filterLembaga !== "all") q = q.eq("departemen_id", filterLembaga);

      const { data, error } = await q;
      if (error) throw error;

      // Sort: golongan desc, then masa kerja desc
      return (data || []).map((p, idx: number) => ({
        ...p,
        urutan: idx + 1,
        masa_kerja: p.tanggal_masuk ? differenceInYears(new Date(), new Date(p.tanggal_masuk)) : null,
        dept_kode: p.departemen?.kode || null,
      }));
    },
  });

  const columns: DataTableColumn<any>[] = [
    { key: "urutan", label: "No" },
    { key: "nama", label: "Nama", sortable: true },
    { key: "nip", label: "NIP", render: v => (v as string) || "-" },
    { key: "golongan_terakhir", label: "Golongan", sortable: true, render: v => v ? <Badge variant="outline">{v as string}</Badge> : "-" },
    { key: "jabatan", label: "Jabatan", render: v => (v as string) || "-" },
    { key: "dept_kode", label: "Lembaga", render: v => (v as string) || "Yayasan" },
    { key: "tanggal_masuk", label: "TMT Masuk", render: v => v ? format(new Date(v as string), "dd MMM yyyy", { locale: idLocale }) : "-" },
    { key: "masa_kerja", label: "Masa Kerja", render: v => v !== null ? `${v} tahun` : "-" },
    { key: "tanggal_pensiun", label: "Pensiun", render: v => v ? format(new Date(v as string), "dd MMM yyyy", { locale: idLocale }) : "-" },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Daftar Urut Kepangkatan (DUK)</h1>
        <p className="text-sm text-muted-foreground">Daftar pegawai aktif diurutkan berdasarkan golongan dan masa kerja</p>
      </div>

      <div className="flex gap-3 items-end">
        <div>
          <Label>Lembaga</Label>
          <Select value={filterLembaga} onValueChange={setFilterLembaga}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Lembaga</SelectItem>
              <SelectItem value="yayasan">Yayasan</SelectItem>
              {lembagaList?.map((l) => (
                <SelectItem key={l.id} value={l.id}>{l.kode} — {l.nama}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={data || []}
            loading={isLoading}
            searchable
            searchPlaceholder="Cari nama atau NIP..."
            exportable
            exportFilename="duk-pegawai"
            pageSize={50}
          />
        </CardContent>
      </Card>
    </div>
  );
}
