import { useState, useEffect } from "react";
import { useAuth, UserRole } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { adminCreateUser } from "@/server/users";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { Pencil, Info, UserPlus } from "lucide-react";
import Unauthorized from "@/pages/Unauthorized";

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "admin_tu", label: "Admin TU" },
  { value: "kepala_sekolah", label: "Kepala Sekolah" },
  { value: "guru", label: "Guru" },
  { value: "keuangan", label: "Keuangan" },
  { value: "sekretaris_yayasan", label: "Sekretaris Yayasan" },
  { value: "kasir", label: "Kasir" },
  { value: "pustakawan", label: "Pustakawan" },
  { value: "siswa", label: "Siswa" },
];

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-red-500/15 text-red-700 border-red-200",
  admin_tu: "bg-amber-500/15 text-amber-700 border-amber-200",
  kepala_sekolah: "bg-purple-500/15 text-purple-700 border-purple-200",
  keuangan: "bg-blue-500/15 text-blue-700 border-blue-200",
  sekretaris_yayasan: "bg-indigo-500/15 text-indigo-700 border-indigo-200",
  kasir: "bg-orange-500/15 text-orange-700 border-orange-200",
  guru: "bg-green-500/15 text-green-700 border-green-200",
  pustakawan: "bg-cyan-500/15 text-cyan-700 border-cyan-200",
  siswa: "bg-gray-500/15 text-gray-700 border-gray-200",
};

type UserRow = Record<string, unknown> & {
  id: string;
  email: string | null;
  role: string | null;
  aktif: boolean | null;
  created_at: string | null;
  pegawai_id: string | null;
  departemen_id: string | null;
  pegawai_nama: string | null;
  dept_kode: string | null;
};

interface DepartemenOption { id: string; kode: string | null; nama: string; }
interface PegawaiOption { id: string; nama: string; }

export default function ManajemenPengguna() {
  const { role } = useAuth();
  if (role !== "admin") return <Unauthorized />;
  return <UserManager />;
}

function UserManager() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [departemenList, setDepartemenList] = useState<DepartemenOption[]>([]);
  const [pegawaiList, setPegawaiList] = useState<PegawaiOption[]>([]);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [tambahOpen, setTambahOpen] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string>("all");

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [{ data: u, error: uErr }, { data: d, error: dErr }, { data: p, error: pErr }] = await Promise.all([
        supabase.from("users_profile").select("id, email, role, aktif, created_at, pegawai_id, departemen_id, pegawai:pegawai_id(nama), departemen:departemen_id(kode, nama)").order("created_at", { ascending: false }),
        supabase.from("departemen").select("id, kode, nama").eq("aktif", true).order("kode"),
        supabase.from("pegawai").select("id, nama").order("nama"),
      ]);

      if (uErr || dErr || pErr) {
        toast.error("Gagal memuat data pengguna: " + (uErr || dErr || pErr)?.message);
        return;
      }

      // Flatten joined data for DataTable compatibility
      const rows: UserRow[] = (u || []).map((row: any) => ({
        ...row,
        pegawai_nama: row.pegawai?.nama || null,
        dept_kode: row.departemen?.kode || null,
      }));

      setUsers(rows);
      setDepartemenList(d || []);
      setPegawaiList(p || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const filtered = roleFilter === "all" ? users : users.filter((u) => u.role === roleFilter);

  const columns: DataTableColumn<UserRow>[] = [
    { key: "email", label: "Email", sortable: true },
    {
      key: "role", label: "Role", sortable: true,
      render: (_val: unknown, row: UserRow) => {
        const r = row.role || "siswa";
        const label = ROLE_OPTIONS.find((o) => o.value === r)?.label || r;
        return <Badge variant="outline" className={ROLE_COLORS[r] || ""}>{label}</Badge>;
      },
    },
    {
      key: "dept_kode", label: "Lembaga",
      render: (_val: unknown, row: UserRow) => row.dept_kode || <span className="text-muted-foreground">—</span>,
    },
    {
      key: "pegawai_nama", label: "Pegawai",
      render: (_val: unknown, row: UserRow) => row.pegawai_nama || <span className="text-muted-foreground">—</span>,
    },
    {
      key: "aktif", label: "Status",
      render: (_val: unknown, row: UserRow) => (
        <Badge variant={row.aktif ? "default" : "secondary"}>{row.aktif ? "Aktif" : "Nonaktif"}</Badge>
      ),
    },
    {
      key: "_aksi", label: "Aksi",
      render: (_val: unknown, row: UserRow) => (
        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setEditing(row); }}>
          <Pencil className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Manajemen Pengguna</h1>
          <p className="text-sm text-muted-foreground">Kelola profil dan hak akses pengguna</p>
        </div>
        <Button onClick={() => setTambahOpen(true)}>
          <UserPlus className="h-4 w-4 mr-2" />
          Tambah Pengguna
        </Button>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Buat akun login baru lewat tombol <strong>Tambah Pengguna</strong>. Atau lewat{" "}
          <a href="https://supabase.com/dashboard/project/oquzygbekjpbmafuqiot/auth/users" target="_blank" rel="noopener noreferrer" className="font-medium underline">
            Supabase Dashboard → Authentication → Invite User
          </a>.
        </AlertDescription>
      </Alert>

      <DataTable
        columns={columns}
        data={filtered}
        loading={loading}
        searchable
        searchPlaceholder="Cari email..."
        actions={
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Filter Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Role</SelectItem>
              {ROLE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {editing && (
        <DialogEditUser
          open={!!editing}
          onOpenChange={(o) => { if (!o) setEditing(null); }}
          user={editing}
          departemenList={departemenList}
          pegawaiList={pegawaiList}
          onSaved={() => { setEditing(null); fetchAll(); }}
        />
      )}

      <DialogTambahUser
        open={tambahOpen}
        onOpenChange={setTambahOpen}
        departemenList={departemenList}
        pegawaiList={pegawaiList}
        onSaved={() => { setTambahOpen(false); fetchAll(); }}
      />
    </div>
  );
}

function DialogTambahUser({ open, onOpenChange, departemenList, pegawaiList, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  departemenList: DepartemenOption[];
  pegawaiList: PegawaiOption[];
  onSaved: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userRole, setUserRole] = useState<string>("siswa");
  const [deptId, setDeptId] = useState("__none");
  const [pegId, setPegId] = useState("__none");
  const [saving, setSaving] = useState(false);

  // Reset form tiap kali dibuka
  useEffect(() => {
    if (open) {
      setEmail(""); setPassword(""); setUserRole("siswa");
      setDeptId("__none"); setPegId("__none");
    }
  }, [open]);

  const handleSave = async () => {
    if (!email.trim()) { toast.error("Email wajib diisi"); return; }
    if (password.length < 8) { toast.error("Password minimal 8 karakter"); return; }
    setSaving(true);
    try {
      await adminCreateUser({
        data: {
          email: email.trim().toLowerCase(),
          password,
          role: userRole,
          departemen_id: deptId === "__none" ? null : deptId,
          pegawai_id: pegId === "__none" ? null : pegId,
          aktif: true,
        },
      });
      toast.success("Akun berhasil dibuat");
      onSaved();
    } catch (e: any) {
      toast.error("Gagal membuat akun: " + (e?.message || "unknown"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah Pengguna</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@contoh.com" />
          </div>
          <div className="space-y-1.5">
            <Label>Password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            <p className="text-xs text-muted-foreground">Minimal 8 karakter. Sampaikan ke pengguna untuk diganti setelah login.</p>
            <p className="text-xs text-muted-foreground">Untuk Admin TU, buat akun terlebih dahulu lalu tetapkan lembaganya melalui Pengaturan → Admin TU Akademik.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={userRole} onValueChange={setUserRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.filter((o) => o.value !== "admin_tu").map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Lembaga / Unit Kerja</Label>
            <p className="text-xs text-muted-foreground">Kosongkan jika lintas lembaga (yayasan)</p>
            <Select value={deptId} onValueChange={setDeptId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— Tidak ada —</SelectItem>
                {departemenList.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.kode ? `${d.kode} - ${d.nama}` : d.nama}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Pegawai</Label>
            <Select value={pegId} onValueChange={setPegId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— Tidak ada —</SelectItem>
                {pegawaiList.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.nama}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Batal</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Menyimpan..." : "Buat Akun"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogEditUser({ open, onOpenChange, user, departemenList, pegawaiList, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  user: UserRow;
  departemenList: DepartemenOption[];
  pegawaiList: PegawaiOption[];
  onSaved: () => void;
}) {
  const [userRole, setUserRole] = useState(user.role || "siswa");
  const [deptId, setDeptId] = useState(user.departemen_id || "__none");
  const [pegId, setPegId] = useState(user.pegawai_id || "__none");
  const [aktif, setAktif] = useState(user.aktif ?? true);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase.from("users_profile").update({
      role: userRole,
      departemen_id: deptId === "__none" ? null : deptId,
      pegawai_id: pegId === "__none" ? null : pegId,
      aktif,
    }).eq("id", user.id);

    setSaving(false);
    if (error) { toast.error("Gagal menyimpan: " + error.message); return; }
    toast.success("Profil pengguna diperbarui");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Pengguna</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input value={user.email || ""} disabled />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={userRole} onValueChange={setUserRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Lembaga / Unit Kerja</Label>
            <p className="text-xs text-muted-foreground">Kosongkan jika lintas lembaga (yayasan)</p>
            <Select value={deptId} onValueChange={setDeptId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— Tidak ada —</SelectItem>
                {departemenList.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.kode ? `${d.kode} - ${d.nama}` : d.nama}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Pegawai</Label>
            <Select value={pegId} onValueChange={setPegId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— Tidak ada —</SelectItem>
                {pegawaiList.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.nama}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={aktif} onCheckedChange={setAktif} />
            <Label>Aktif</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Menyimpan..." : "Simpan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
