import { DEFAULT_ROLE_PERMISSIONS, isConfigurableRole, type PermissionKey } from "@/lib/permissions";

/**
 * Tiruan keputusan requirePermission untuk pengujian: admin, peran tambahan, atau
 * izin bawaan (isian awal migrasi). Dipakai agar tes membuktikan isian awal
 * mempertahankan perilaku lama tanpa membuka tabel izin.
 */
export function defaultAllows(
  role: string | null | undefined,
  permission: PermissionKey | readonly PermissionKey[],
  extraRoles: readonly string[] = [],
): boolean {
  if (!role) return false;
  if (role === "admin" || extraRoles.includes(role)) return true;
  if (!isConfigurableRole(role)) return false;
  const keys = Array.isArray(permission) ? permission : [permission];
  return keys.some((key) => DEFAULT_ROLE_PERMISSIONS[role].includes(key));
}
