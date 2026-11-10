import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useDepartemen } from "@/hooks/useAkademikData";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Building2, User } from "lucide-react";

interface OrgNode {
  id: string;
  nama: string;
  jabatan: string;
  foto_url?: string;
  nip?: string;
  children: OrgNode[];
}

const JABATAN_ORDER = [
  "Kepala Yayasan", "Ketua Yayasan",
  "Kepala Sekolah",
  "Wakil Kepala Sekolah", "Wakasek",
  "Koordinator", "Ka. Unit",
  "Guru", "Staff", "Tenaga Kependidikan",
];

function getJabatanPriority(jabatan: string): number {
  const lower = jabatan.toLowerCase();
  for (let i = 0; i < JABATAN_ORDER.length; i++) {
    if (lower.includes(JABATAN_ORDER[i].toLowerCase())) return i;
  }
  return JABATAN_ORDER.length;
}

function OrgCard({ node, level = 0 }: { node: OrgNode; level?: number }) {
  const initials = node.nama.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="flex flex-col items-center">
      <Card className={`w-48 hover:shadow-md transition-shadow ${level === 0 ? "border-primary border-2" : ""}`}>
        <CardContent className="p-3 text-center">
          <Avatar className="h-12 w-12 mx-auto mb-2">
            {node.foto_url && <AvatarImage src={node.foto_url} />}
            <AvatarFallback className="bg-primary/10 text-primary text-sm">{initials}</AvatarFallback>
          </Avatar>
          <p className="font-semibold text-sm leading-tight">{node.nama}</p>
          <p className="text-xs text-muted-foreground mt-1">{node.jabatan}</p>
          {node.nip && <p className="text-xs text-muted-foreground">NIP: {node.nip}</p>}
        </CardContent>
      </Card>
      {node.children.length > 0 && (
        <>
          <div className="w-px h-6 bg-border" />
          <div className="relative">
            {node.children.length > 1 && (
              <div className="absolute top-0 left-1/2 -translate-x-1/2 h-px bg-border" style={{
                width: `${(node.children.length - 1) * 224}px`,
              }} />
            )}
            <div className="flex gap-8">
              {node.children.map((child) => (
                <div key={child.id} className="flex flex-col items-center">
                  <div className="w-px h-6 bg-border" />
                  <OrgCard node={child} level={level + 1} />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function StrukturOrganisasi() {
  const [deptId, setDeptId] = useState("__all__");
  const { data: depts } = useDepartemen();

  const { data: pegawaiList, isLoading } = useQuery({
    queryKey: ["pegawai_struktur", deptId],
    queryFn: async () => {
      let q = supabase.from("pegawai").select("id, nama, jabatan, nip, foto_url, departemen_id").eq("status", "aktif").order("nama");
      if (deptId !== "__all__") q = q.eq("departemen_id", deptId);
      const { data } = await q;
      return data || [];
    },
  });

  const tree = useMemo(() => {
    if (!pegawaiList?.length) return null;
    const sorted = [...pegawaiList].sort((a, b) => getJabatanPriority(a.jabatan || "Staff") - getJabatanPriority(b.jabatan || "Staff"));

    // Build hierarchy: top = lowest priority number
    const leaders = sorted.filter(p => getJabatanPriority(p.jabatan || "Staff") <= 1);
    const midLevel = sorted.filter(p => { const pr = getJabatanPriority(p.jabatan || "Staff"); return pr > 1 && pr <= 4; });
    const staff = sorted.filter(p => getJabatanPriority(p.jabatan || "Staff") > 4);

    const toNode = (p: any): OrgNode => ({
      id: p.id, nama: p.nama, jabatan: p.jabatan || "Staff", foto_url: p.foto_url, nip: p.nip, children: [],
    });

    if (leaders.length === 0) {
      // Flat display
      return { id: "root", nama: "Organisasi", jabatan: "Yayasan", children: sorted.slice(0, 20).map(toNode) } as OrgNode;
    }

    const root = toNode(leaders[0]);
    if (midLevel.length > 0) {
      root.children = midLevel.slice(0, 8).map(m => {
        const node = toNode(m);
        // Group staff by departemen
        node.children = staff.filter(s => s.departemen_id === m.departemen_id).slice(0, 5).map(toNode);
        return node;
      });
      // Add remaining staff without departemen match
      const assignedIds = new Set(root.children.flatMap(c => c.children.map(cc => cc.id)));
      const unassigned = staff.filter(s => !assignedIds.has(s.id)).slice(0, 10);
      if (unassigned.length > 0) {
        root.children.push({ id: "lainnya", nama: "Lainnya", jabatan: "Staff", children: unassigned.map(toNode) });
      }
    } else {
      root.children = staff.slice(0, 15).map(toNode);
    }

    // Add other leaders
    if (leaders.length > 1) {
      return { id: "yayasan", nama: "Yayasan", jabatan: "Organisasi", children: leaders.map(l => {
        const node = toNode(l);
        if (l === leaders[0]) node.children = root.children;
        return node;
      })} as OrgNode;
    }

    return root;
  }, [pegawaiList]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Struktur Organisasi</h1>
        <p className="text-sm text-muted-foreground">Visualisasi hierarki jabatan pegawai</p>
      </div>

      <div className="flex gap-3 items-end">
        <div><Label>Lembaga</Label>
          <Select value={deptId} onValueChange={setDeptId}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Semua" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Semua Lembaga</SelectItem>
              {depts?.map((d) => <SelectItem key={d.id} value={d.id}>{d.kode || d.nama}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? <Skeleton className="h-96" /> : tree ? (
        <Card>
          <CardContent className="pt-6 overflow-x-auto">
            <div className="flex justify-center min-w-max py-4">
              <OrgCard node={tree} />
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <Building2 className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
          <p>Tidak ada data pegawai aktif.</p>
        </CardContent></Card>
      )}
    </div>
  );
}
