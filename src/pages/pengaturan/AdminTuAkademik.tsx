import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import Unauthorized from "@/pages/Unauthorized";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

type UserRow = {
  id: string;
  email: string | null;
  role: string | null;
  aktif: boolean | null;
  departemen_id: string | null;
};

type Dept = {
  id: string;
  kode: string | null;
  nama: string;
};

export default function AdminTuAkademik() {
  const { role } = useAuth();
  if (role !== "admin") return <Unauthorized />;
  return <AdminTuManager />;
}

function AdminTuManager() {
  const qc = useQueryClient();
  const [userId, setUserId] = useState("");
  const [departemenId, setDepartemenId] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ["admin_tu_candidates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users_profile")
        .select("id,email,role,aktif,departemen_id")
        .order("email");
      if (error) throw error;
      return (data || []) as UserRow[];
    },
  });

  const { data: departemen = [], isLoading: deptLoading } = useQuery({
    queryKey: ["admin_tu_departemen"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("departemen")
        .select("id,kode,nama")
        .eq("aktif", true)
        .eq("kategori", "unit_pendidikan")
        .order("kode");
      if (error) throw error;
      return (data || []) as Dept[];
    },
  });

  const candidates = useMemo(
    () => users.filter((user) => user.role !== "admin" && user.role !== "ortu"),
    [users],
  );
  const current = useMemo(
    () => users.filter((user) => user.role === "admin_tu"),
    [users],
  );

  const assign = async () => {
    if (!userId || !departemenId) {
      toast.error("Pilih akun dan lembaga terlebih dahulu");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("users_profile")
        .update({ role: "admin_tu", departemen_id: departemenId, aktif: true })
        .eq("id", userId);
      if (error) throw error;
      toast.success("Akses Admin TU berhasil disimpan");
      setUserId("");
      setDepartemenId("");
      await qc.invalidateQueries({ queryKey: ["admin_tu_candidates"] });
    } catch (error: any) {
      toast.error(error?.message || "Gagal menyimpan akses Admin TU");
    } finally {
      setSaving(false);
    }
  };

  const deptName = (id: string | null) => {
    const d = departemen.find((item) => item.id === id);
    return d ? (d.kode ? `${d.kode} - ${d.nama}` : d.nama) : "Belum dipasangkan";
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Admin TU Akademik</h1>
        <p className="text-sm text-muted-foreground">
          Pasangkan satu akun ke satu lembaga. Admin TU hanya dapat membuka modul Akademik dan data pada lembaga tersebut.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-5 w-5" />
            Tetapkan Admin TU
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div className="space-y-1.5">
            <Label>Akun</Label>
            <Select value={userId} onValueChange={(value) => {
              setUserId(value);
              const selected = users.find((user) => user.id === value);
              setDepartemenId(selected?.role === "admin_tu" && selected.departemen_id ? selected.departemen_id : "");
            }}>
              <SelectTrigger><SelectValue placeholder={usersLoading ? "Memuat..." : "Pilih akun"} /></SelectTrigger>
              <SelectContent>
                {candidates.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.email || user.id} · {user.role || "tanpa role"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Lembaga</Label>
            <Select value={departemenId} onValueChange={setDepartemenId}>
              <SelectTrigger><SelectValue placeholder={deptLoading ? "Memuat..." : "Pilih TK/SD/SMP/SMA/MTA"} /></SelectTrigger>
              <SelectContent>
                {departemen.map((dept) => (
                  <SelectItem key={dept.id} value={dept.id}>
                    {dept.kode ? `${dept.kode} - ${dept.nama}` : dept.nama}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={assign} disabled={saving || !userId || !departemenId}>
            {saving ? "Menyimpan..." : "Simpan Akses"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Admin TU Aktif</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {current.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada akun dengan role Admin TU.</p>
          ) : current.map((user) => (
            <div key={user.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">{user.email || user.id}</p>
                <p className="text-sm text-muted-foreground">{deptName(user.departemen_id)}</p>
              </div>
              <Badge variant={user.aktif === false ? "secondary" : "default"}>
                {user.aktif === false ? "Nonaktif" : "Aktif"}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Akun Admin TU wajib memiliki tepat satu lembaga. Pengaman database akan menolak role Admin TU tanpa lembaga atau akses data dari lembaga lain.
      </p>
    </div>
  );
}
