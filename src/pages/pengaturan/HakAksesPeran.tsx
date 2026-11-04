import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import Unauthorized from "@/pages/Unauthorized";
import { listRolePermissions, updateRolePermissions } from "@/server/rolePermissions";
import {
  CONFIGURABLE_ROLES,
  DATA_ACCESS_KEY,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  ROLE_LABELS,
  normalizePermissions,
  type ConfigurableRole,
} from "@/lib/permissions";

type Draft = Record<ConfigurableRole, Set<string>>;

const VISIBLE_PERMISSIONS = PERMISSIONS.filter((p) => p.key !== "keuangan.akses_data");
const GROUPS = [...new Set(VISIBLE_PERMISSIONS.map((p) => p.group))];

function toDraft(roles: Record<string, string[]>): Draft {
  return Object.fromEntries(CONFIGURABLE_ROLES.map((role) => [role, new Set(roles[role] ?? [])])) as Draft;
}
const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
/** Bandingkan tanpa izin teknis yang diisi otomatis. */
const visibleOnly = (set: Set<string>) => new Set([...set].filter((k) => k !== DATA_ACCESS_KEY));

const labelOf = (key: string) => PERMISSIONS.find((p) => p.key === key)?.label ?? key;

export default function HakAksesPeran() {
  const { role } = useAuth();
  if (role !== "admin") return <Unauthorized />;
  return <HakAksesPeranContent />;
}

function HakAksesPeranContent() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["role_permissions"], queryFn: () => listRolePermissions() });
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (query.data) setDraft(toDraft(query.data.roles));
  }, [query.data]);

  const saved = useMemo(() => (query.data ? toDraft(query.data.roles) : null), [query.data]);
  const changedRoles = useMemo(
    () => (draft && saved ? CONFIGURABLE_ROLES.filter((r) => !sameSet(visibleOnly(draft[r]), visibleOnly(saved[r]))) : []),
    [draft, saved],
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      for (const target of changedRoles) {
        await updateRolePermissions({ data: { role: target, permissions: [...draft[target]].filter((k) => k !== DATA_ACCESS_KEY) } });
      }
    },
    onSuccess: async () => {
      toast.success("Hak akses disimpan", { description: "Berlaku saat pengguna memuat ulang halaman atau login ulang." });
      await queryClient.invalidateQueries({ queryKey: ["role_permissions"] });
    },
    onError: (error: unknown) => {
      toast.error("Gagal menyimpan hak akses", { description: error instanceof Error ? error.message : "Terjadi kesalahan teknis" });
    },
  });

  const toggle = (target: ConfigurableRole, key: string, checked: boolean) => {
    setDraft((current) => {
      if (!current) return current;
      const next = new Set(current[target]);
      if (checked) next.add(key); else next.delete(key);
      return { ...current, [target]: next };
    });
  };
  const resetToDefault = (target: ConfigurableRole) => {
    setDraft((current) => (current ? { ...current, [target]: new Set(normalizePermissions(target, DEFAULT_ROLE_PERMISSIONS[target])) } : current));
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">Hak Akses Peran</h1>
        <p className="text-sm text-muted-foreground">Tentukan fitur Keuangan yang boleh dipakai tiap peran. Admin selalu memiliki semua izin.</p>
      </div>

      <Alert>
        <AlertDescription>
          Bendahara dan Sekretaris yang punya izin apa pun otomatis mendapat akses data keuangan di database. Pembatasan per fitur berlaku di menu, halaman, dan server.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Matriks izin</CardTitle>
          <CardDescription>Centang untuk memberi izin. Tombol Bawaan mengembalikan satu peran ke pengaturan awal.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {query.isLoading || !draft ? (
            query.error ? <p role="alert" className="text-sm text-destructive">{query.error.message}</p> : <Skeleton className="h-64 w-full" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 pr-4 font-medium">Fitur</th>
                    {CONFIGURABLE_ROLES.map((r) => (
                      <th key={r} className="px-3 py-2 text-center font-medium">
                        <div>{ROLE_LABELS[r]}</div>
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" aria-label={`Bawaan ${ROLE_LABELS[r]}`} onClick={() => resetToDefault(r)}>
                          Bawaan
                        </Button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {GROUPS.map((group) => (
                    <GroupRows key={group} group={group} draft={draft} onToggle={toggle} changedRoles={changedRoles} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center justify-end gap-3">
            {changedRoles.length > 0 && (
              <span className="text-xs text-muted-foreground">Berubah: {changedRoles.map((r) => ROLE_LABELS[r]).join(", ")}</span>
            )}
            <Button disabled={changedRoles.length === 0 || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Menyimpan..." : "Simpan perubahan"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {query.data && query.data.log.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Riwayat perubahan</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {query.data.log.map((entry, index) => (
                <li key={`${entry.changed_at}-${index}`} className="rounded-md border p-2">
                  <div className="font-medium">{ROLE_LABELS[entry.role as ConfigurableRole] ?? entry.role} · {new Date(entry.changed_at).toLocaleString("id-ID")}</div>
                  {entry.granted.length > 0 && <div className="text-xs text-emerald-700">Ditambah: {entry.granted.map(labelOf).join(", ")}</div>}
                  {entry.revoked.length > 0 && <div className="text-xs text-red-700">Dicabut: {entry.revoked.map(labelOf).join(", ")}</div>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function GroupRows({
  group, draft, onToggle, changedRoles,
}: {
  group: string;
  draft: Draft;
  onToggle: (role: ConfigurableRole, key: string, checked: boolean) => void;
  changedRoles: readonly ConfigurableRole[];
}) {
  return (
    <>
      <tr><td colSpan={CONFIGURABLE_ROLES.length + 1} className="bg-muted/40 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</td></tr>
      {VISIBLE_PERMISSIONS.filter((p) => p.group === group).map((permission) => (
        <tr key={permission.key} className="border-b last:border-0">
          <td className="py-2 pr-4 align-top">
            <div className="font-medium">{permission.label}</div>
            <div className="text-xs text-muted-foreground">{permission.description}</div>
          </td>
          {CONFIGURABLE_ROLES.map((r) => (
            <td key={r} className={`px-3 py-2 text-center align-middle ${changedRoles.includes(r) ? "bg-amber-50/60" : ""}`}>
              <Checkbox
                aria-label={`${permission.label} untuk ${ROLE_LABELS[r]}`}
                checked={draft[r].has(permission.key)}
                onCheckedChange={(value) => onToggle(r, permission.key, value === true)}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
