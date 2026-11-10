import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { StatsCard } from "@/components/shared/StatsCard";
import { useAngkatan, useDepartemen, useKelas } from "@/hooks/useAkademikData";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllPages } from "@/lib/fetchAll";
import { useQuery } from "@tanstack/react-query";
import { GraduationCap, Users } from "lucide-react";

export default function DataAlumni() {
  const [angkatanId, setAngkatanId] = useState("");
  const [departemenId, setDepartemenId] = useState("");
  const [kelasId, setKelasId] = useState("");

  const { data: angkatanList } = useAngkatan();
  const { data: departemenList } = useDepartemen();
  const { data: kelasList } = useKelas();

  // Filter angkatan by selected departemen
  const filteredAngkatan = departemenId
    ? angkatanList?.filter((a: any) => a.departemen_id === departemenId)
    : angkatanList;

  // Filter kelas by selected departemen
  const filteredKelas = departemenId
    ? kelasList?.filter((k: any) => k.departemen?.id === departemenId)
    : kelasList;

  const { data: alumniData, isLoading } = useQuery({
    queryKey: ["alumni", angkatanId, departemenId, kelasId],
    queryFn: async () => {
      // If kelasId is selected, we need to join kelas_siswa
      if (kelasId) {
        const q = supabase.from("kelas_siswa")
          .select(`
            siswa:siswa_id(
              id, nis, nama, jenis_kelamin, tempat_lahir, tanggal_lahir,
              angkatan:angkatan_id(nama), status, telepon, email, alamat,
              departemen_id
            ),
            kelas:kelas_id(id, nama, departemen:departemen_id(id, nama))
          `)
          .eq("kelas_id", kelasId);

        const { data } = await q;
        return (data || [])
          .filter((r: any) => r.siswa && ["lulus", "alumni"].includes(r.siswa.status))
          .map((r: any) => ({
            ...r.siswa,
            angkatan_nama: r.siswa.angkatan?.nama || "-",
            kelas_nama: r.kelas?.nama || "-",
          }));
      }

      const data = await fetchAllPages<any>((from, to) => {
        let q = supabase.from("siswa")
          .select("id, nis, nama, jenis_kelamin, tempat_lahir, tanggal_lahir, angkatan:angkatan_id(nama), status, telepon, email, alamat, departemen_id")
          .in("status", ["lulus", "alumni"])
          .order("nama").order("id")
          .range(from, to);
        if (angkatanId) q = q.eq("angkatan_id", angkatanId);
        if (departemenId) q = q.eq("departemen_id", departemenId);
        return q;
      });
      return data.map((s: any) => ({ ...s, angkatan_nama: s.angkatan?.nama || "-", kelas_nama: "-" }));
    },
  });

  const columns: DataTableColumn<any>[] = [
    { key: "nis", label: "NIS", sortable: true },
    { key: "nama", label: "Nama", sortable: true },
    { key: "jenis_kelamin", label: "L/P", render: (v) => v === "L" ? "L" : v === "P" ? "P" : "-" },
    { key: "angkatan_nama", label: "Angkatan", sortable: true },
    { key: "tempat_lahir", label: "Tempat Lahir" },
    { key: "telepon", label: "Telepon", render: (v) => String(v || "-") },
    { key: "email", label: "Email", render: (v) => String(v || "-") },
  ];

  const totalAlumni = alumniData?.length || 0;
  const alumniL = alumniData?.filter((a: any) => a.jenis_kelamin === "L").length || 0;
  const alumniP = alumniData?.filter((a: any) => a.jenis_kelamin === "P").length || 0;

  const handleDepartemenChange = (v: string) => {
    setDepartemenId(v === "__all__" ? "" : v);
    setAngkatanId("");
    setKelasId("");
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Data Alumni</h1>
        <p className="text-sm text-muted-foreground">Data siswa yang telah lulus</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatsCard title="Total Alumni" value={totalAlumni} icon={GraduationCap} color="primary" />
        <StatsCard title="Laki-laki" value={alumniL} icon={Users} color="info" />
        <StatsCard title="Perempuan" value={alumniP} icon={Users} color="success" />
      </div>

      <div className="flex flex-wrap gap-3">
        <div>
          <Label>Jenjang</Label>
          <Select value={departemenId || "__all__"} onValueChange={handleDepartemenChange}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Semua Jenjang" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Semua Jenjang</SelectItem>
              {departemenList?.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.nama}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Angkatan</Label>
          <Select value={angkatanId || "__all__"} onValueChange={(v) => setAngkatanId(v === "__all__" ? "" : v)}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Semua" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Semua</SelectItem>
              {filteredAngkatan?.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.nama}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Kelas</Label>
          <Select value={kelasId || "__all__"} onValueChange={(v) => setKelasId(v === "__all__" ? "" : v)}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Semua Kelas" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Semua Kelas</SelectItem>
              {filteredKelas?.map((k: any) => <SelectItem key={k.id} value={k.id}>{k.nama}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable columns={columns} data={alumniData || []} loading={isLoading} searchable exportable exportFilename="data-alumni" searchPlaceholder="Cari alumni..." />
    </div>
  );
}
