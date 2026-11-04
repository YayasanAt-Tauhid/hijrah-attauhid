/**
 * Hak Akses Peran: admin mengatur izin modul Keuangan per peran dari UI.
 * Perubahan lewat RPC `set_role_permissions` (atomik + audit); peran admin
 * dicek di server function dan sekali lagi di database.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, requireContext, requireRole } from "./auth";
import { createAdminClient } from "./supabase";
import { CONFIGURABLE_ROLES, isConfigurableRole, normalizePermissions } from "@/lib/permissions";

interface QueryResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}
interface Query<T> extends PromiseLike<QueryResult<T>> {
  select(columns: string): Query<T>;
  in(column: string, values: readonly string[]): Query<T>;
  order(column: string, options?: { ascending: boolean }): Query<T>;
  limit(count: number): Query<T>;
}
interface LooseAdmin {
  from(table: string): Query<Record<string, unknown>>;
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
}

export interface RolePermissionLogEntry {
  role: string;
  granted: string[];
  revoked: string[];
  changed_at: string;
}

export interface RolePermissionsResult {
  roles: Record<string, string[]>;
  log: RolePermissionLogEntry[];
}

export const listRolePermissions = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<RolePermissionsResult> => {
    const adminClient = createAdminClient();
    await requireRole(adminClient, requireContext(context).userId, ["admin"]);
    const admin = adminClient as unknown as LooseAdmin;

    const { data: rows, error } = await admin.from("role_permissions").select("role, permission").in("role", CONFIGURABLE_ROLES);
    if (error) throw new Error(error.message);
    const roles: Record<string, string[]> = Object.fromEntries(CONFIGURABLE_ROLES.map((role) => [role, [] as string[]]));
    for (const row of rows || []) {
      const role = String(row.role);
      if (isConfigurableRole(role)) roles[role].push(String(row.permission));
    }

    const { data: log, error: logError } = await admin
      .from("role_permission_log").select("role, granted, revoked, changed_at").order("changed_at", { ascending: false }).limit(20);
    if (logError) throw new Error(logError.message);
    return { roles, log: (log || []) as unknown as RolePermissionLogEntry[] };
  });

export const updateRolePermissions = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: { role: string; permissions: string[] }) => d)
  .handler(async ({ data, context }): Promise<{ success: true; granted: string[]; revoked: string[] }> => {
    const adminClient = createAdminClient();
    const { userId } = requireContext(context);
    await requireRole(adminClient, userId, ["admin"]);

    if (!isConfigurableRole(data.role)) throw new Error("Peran ini tidak dapat diatur");
    const permissions = normalizePermissions(data.role, Array.isArray(data.permissions) ? data.permissions : []);

    const admin = adminClient as unknown as LooseAdmin;
    const { data: result, error } = await admin.rpc("set_role_permissions", {
      p_role: data.role,
      p_permissions: permissions,
      p_actor_id: userId,
    });
    if (error) throw new Error(error.message);
    const summary = (result || {}) as { granted?: string[]; revoked?: string[] };
    return { success: true, granted: summary.granted ?? [], revoked: summary.revoked ?? [] };
  });
