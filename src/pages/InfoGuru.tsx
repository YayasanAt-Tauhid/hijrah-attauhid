import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Mail, Phone, MapPin } from "lucide-react";

export default function InfoGuru() {
  const [deptId, setDeptId] = useState("all");
  const [search, setSearch] = useState("");

  const { data: depts = [] } = useQuery({
    queryKey: ["dept-infoguru"],
    queryFn: async () => {
      const { data } = await supabase.from("departemen").select("id, nama, kode").eq("aktif", true).order("nama");
      return data || [];
    },
  });

  const { data: guru = [], isLoading } = useQuery({
    queryKey: ["infoguru", deptId, search],
    queryFn: async () => {
      let q = supabase
        .from("pegawai")
        .select("*, departemen:departemen_id(nama, kode)")
        .eq("status", "aktif")
        .order("nama");
      if (deptId !== "all") q = q.eq("departemen_id", deptId);
      if (search) q = q.ilike("nama", `%${search}%`);
      const { data } = await q;
      return data || [];
    },
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-emerald-800">InfoGuru</h1>
          <p className="text-emerald-600/80 mt-1">Direktori Guru & Tenaga Kependidikan</p>
        </div>

        <div className="flex gap-3 justify-center flex-wrap mb-8">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Cari nama guru..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={deptId} onValueChange={setDeptId}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Semua Lembaga" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Lembaga</SelectItem>
              {depts.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.kode || d.nama}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
          </div>
        ) : guru.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Tidak ada data guru yang ditemukan
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {guru.map((g) => (
              <Card key={g.id} className="hover:shadow-lg transition-shadow overflow-hidden">
                <CardContent className="p-5">
                  <div className="flex items-start gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 font-bold text-lg">
                      {g.nama?.charAt(0)?.toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-foreground truncate">{g.nama}</h3>
                      <p className="text-sm text-muted-foreground">{g.jabatan || "Guru"}</p>
                      {g.nip && <p className="text-xs text-muted-foreground">NIP: {g.nip}</p>}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {g.departemen && (
                          <Badge variant="secondary" className="text-xs">
                            {g.departemen.kode || g.departemen.nama}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                        {g.email && (
                          <div className="flex items-center gap-1.5">
                            <Mail className="h-3 w-3" /> {g.email}
                          </div>
                        )}
                        {g.telepon && (
                          <div className="flex items-center gap-1.5">
                            <Phone className="h-3 w-3" /> {g.telepon}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground mt-8">
          © {new Date().getFullYear()} Hijrah At-Tauhid — InfoGuru
        </p>
      </div>
    </div>
  );
}
