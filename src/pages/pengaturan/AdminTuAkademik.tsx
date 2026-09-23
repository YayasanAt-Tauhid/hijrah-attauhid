import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import Unauthorized from "@/pages/Unauthorized";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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

type ScopeRow = {
  user_id: string;
  departemen_id: string;
};

export default function AdminTuAkademik() {
  const { role } = useAuth();
  if (role !== "admin") return <Unauthorized />;
  return <AdminTuManager />;
}

function AdminTuManager() {
  const qc = useQueryClient();
  const [userId, setUserId] = useState("");
  const [departemenIds, setDepartemenIds] = useState<string[]>([]);
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

  const { data: scopes = [], isLoading: scopesLoading } = useQuery({
    queryKey: ["admin_tu_scopes"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("admin_tu_departemen_scope")
        .select("user_id,departemen_id");
      if (error) throw error;
      return (data || []) as ScopeRow[];
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
  const scopesByUser = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const scope of scopes) {
      if (!map[scope.user_id]) map[scope.user_id] = [];
      map[scope.user_id].push(scope.departemen_id);
    }
    return map;
  }, [scopes]);

  const scopeIdsForUser = (user: UserRow) => {
    const assigned = scopesByUser[user.id] || [];
    if (assigned.length > 0) return assigned;
    return user.departemen_id ? [user.departemen_id] : [];
  };

  const labelDept = (dept: Dept) => (dept.kode ? `${dept.kode} - ${dept.nama}` : dept.nama);

  const selectUser = (value: string) => {
    setUserId(value);
    const selected = users.find((user) => user.id === value);
    setDepartemenIds(selected?.role === "admin_tu" ? scopeIdsForUser(selected) : []);
  };

  const toggleDepartment = (id: string, checked: boolean) => {
    setDepartemenIds((currentIds) => (
      checked
        ? Array.from(new Set([...currentIds, id]))
        : currentIds.filter((item) => item !== id)
    ));
  };

  const allSelected = departemen.length > 0 && departemen.every((dept) => departemenIds.includes(dept.id));

  const assign = async () => {
    if (!userId || departemenIds.length === 0) {
      toast.error("Pilih akun dan minimal satu lembaga terlebih dahulu");
      return;
    }
    setSaving(true);
    try {
      const { error } = await (supabase as any).rpc("admin_set_admin_tu_scope", {
        p_user_id: userId,
        p_departemen_ids: departemenIds,
      });
      if (error) throw error;
      toast.success(departemenIds.length === departemen.length
        ? "Admin TU sekarang dapat mengakses semua lembaga"
        : "Cakupan lembaga Admin TU berhasil disimpan");
      setUserId("");
      setDepartemenIds([]);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin_tu_candidates"] }),
        qc.invalidateQueries({ queryKey: ["admin_tu_scopes"] }),
      ]);
    } catch (error: any) {
      toast.error(error?.message || "Gagal menyimpan akses Admin TU");
    } finally {
      setSaving(false);
    }
  };

  const scopeLabel = (user: UserRow) => {
    const ids = scopeIdsForUser(user);
    const activeScoped = departemen.filter((dept) => ids.includes(dept.id));
    if (activeScoped.length === 0) return "Belum dipasangkan";
    const labels = activeScoped.map(labelDept);
    const isAll = departemen.length > 0 && departemen.every((dept) => ids.includes(dept.id));
    return isAll ? `Semua lembaga · ${labels.join(", ")}` : labels.join(", ");
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Admin TU Akademik</h1>
        <p className="text-sm text-muted-foreground">
          Satu akun Admin TU dapat diberi akses ke satu, beberapa, atau semua lembaga pendidikan.
          Hak aksesnya tetap terbatas pada modul Akademik.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-5 w-5" />
            Tetapkan Admin TU
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[1fr_2fr_auto] md:items-end">
          <div className="space-y-1.5">
            <Label>Akun</Label>
            <Select value={userId} onValueChange={selectUser}>
              <SelectTrigger>
                <SelectValue placeholder={usersLoading || scopesLoading ? "Memuat..." : "Pilih akun"} />
              </SelectTrigger>
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
            <div className="flex items-center justify-between gap-3">
              <Label>Lembaga yang dapat dikelola</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={deptLoading || departemen.length === 0}
                onClick={() => setDepartemenIds(allSelected ? [] : departemen.map((dept) => dept.id))}
              >
                {allSelected ? "Kosongkan" : "Pilih Semua Lembaga"}
              </Button>
            </div>
            <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
              {deptLoading ? (
                <p className="text-sm text-muted-foreground">Memuat lembaga...</p>
              ) : departemen.length === 0 ? (
                <p className="text-sm text-muted-foreground">Belum ada unit pendidikan aktif.</p>
              ) : departemen.map((dept) => {
                const checked = departemenIds.includes(dept.id);
                return (
                  <label
                    key={dept.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) => toggleDepartment(dept.id, value === true)}
                    />
                    <span className="text-sm">{labelDept(dept)}</span>
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Pilih satu atau beberapa lembaga. Tombol Pilih Semua Lembaga memberi akses ke seluruh unit pendidikan aktif saat ini.
            </p>
          </div>

          <Button onClick={assign} disabled={saving || !userId || departemenIds.length === 0 || scopesLoading}>
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
              <div className="min-w-0">
                <p className="font-medium">{user.email || user.id}</p>
                <p className="text-sm text-muted-foreground">{scopeLabel(user)}</p>
              </div>
              <Badge variant={user.aktif === false ? "secondary" : "default"}>
                {user.aktif === false ? "Nonaktif" : "Aktif"}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Scope ini tidak mengubah Admin TU menjadi Administrator. Modul keuangan sensitif, pengaturan global,
        manajemen pengguna, dan administrasi yayasan tetap mengikuti pembatasan role yang sudah ada.
      </p>
    </div>
  );
}
