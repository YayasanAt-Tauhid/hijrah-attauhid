/**
 * Auth untuk server functions.
 *
 * `authMiddleware` menjalankan dua sisi:
 *   - client: mengambil access_token dari sesi Supabase di browser dan
 *     melampirkannya sebagai header `Authorization` pada request server function.
 *   - server: membaca header itu, memverifikasi token, dan menaruh `userId`
 *     ke dalam context handler.
 *
 * `requireRole` dipanggil di dalam handler untuk membatasi akses per-peran,
 * meniru cek `users_profile.role` pada edge function lama.
 */
import { createMiddleware } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { isConfigurableRole, type PermissionKey } from "@/lib/permissions";

/** Error dengan penanda agar pesan otentikasi konsisten. */
export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized: sesi tidak valid, silakan login ulang") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden: akses ditolak") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export const authMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return next(
      session?.access_token
        ? { headers: { Authorization: `Bearer ${session.access_token}` } }
        : undefined
    );
  })
  .server(async ({ next }) => {
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const { getUserFromToken } = await import("./supabase");

    const raw =
      getRequestHeader("authorization") ?? getRequestHeader("Authorization");
    const token = raw?.replace(/^Bearer\s+/i, "").trim();
    if (!token) throw new UnauthorizedError();

    const user = await getUserFromToken(token);
    if (!user) throw new UnauthorizedError();

    return next({ context: { userId: user.id, userEmail: user.email ?? null } });
  });

export interface AuthContext {
  userId: string;
  userEmail: string | null;
}

/**
 * Handler server function selalu menerima context ini via `authMiddleware`
 * (dijamin ada, atau middleware sudah melempar UnauthorizedError lebih dulu).
 * TanStack Start tidak berhasil menginferensi tipe context hasil komposisi
 * middleware di `.handler()` — parameter di sini bertipe `unknown` (bukan
 * `AuthContext | undefined`) supaya tidak bergantung pada inferensi itu;
 * `requireContext` cukup memastikan runtime-nya (harusnya tidak pernah throw
 * dalam praktik) lalu menyempitkan ke tipe yang benar.
 */
export function requireContext(context: unknown): AuthContext {
  const ctx = context as AuthContext | undefined;
  if (!ctx) throw new UnauthorizedError();
  return ctx;
}

/**
 * Pastikan user punya salah satu peran yang diizinkan.
 * Melempar ForbiddenError bila tidak. Mengembalikan role user.
 */
export async function requireRole(
  admin: SupabaseClient<Database>,
  userId: string,
  roles: string[]
): Promise<string> {
  const { data: profile } = await admin
    .from("users_profile")
    .select("role")
    .eq("id", userId)
    .single();

  if (!profile || !roles.includes(profile.role)) {
    throw new ForbiddenError();
  }
  return profile.role;
}

interface PermissionLookup {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        in(column: string, values: readonly string[]): {
          limit(count: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
        };
      };
    };
  };
}

export interface PermissionCheck {
  role: string | null;
  allowed: boolean;
}

/**
 * Versi tanpa lempar galat dari requirePermission, untuk fungsi yang melayani
 * staf dan non-staf sekaligus. `permission` boleh beberapa kunci (cukup salah satu).
 */
export async function checkPermission(
  admin: SupabaseClient<Database>,
  userId: string,
  permission: PermissionKey | readonly PermissionKey[],
  options: { extraRoles?: string[] } = {},
): Promise<PermissionCheck> {
  const { data: profile } = await admin
    .from("users_profile")
    .select("role, aktif")
    .eq("id", userId)
    .single();

  if (!profile || profile.aktif === false) return { role: profile?.role ?? null, allowed: false };
  if (profile.role === "admin") return { role: profile.role, allowed: true };
  if (options.extraRoles?.includes(profile.role)) return { role: profile.role, allowed: true };

  if (isConfigurableRole(profile.role)) {
    const keys = Array.isArray(permission) ? permission : [permission];
    const { data: granted, error } = await (admin as unknown as PermissionLookup)
      .from("role_permissions")
      .select("permission")
      .eq("role", profile.role)
      .in("permission", keys)
      .limit(1);
    if (!error && granted && granted.length > 0) return { role: profile.role, allowed: true };
  }
  return { role: profile.role, allowed: false };
}

/**
 * Otorisasi berbasis izin (diatur admin di Hak Akses Peran) untuk modul Keuangan.
 * Admin selalu lolos; peran lain (keuangan/kasir/bendahara/sekretaris_yayasan)
 * hanya bila izinnya ada. `extraRoles` untuk peran di luar sistem izin yang
 * memang boleh (mis. admin_tu pada monitoring SPMB). Akun nonaktif ditolak.
 * Mengembalikan role user, seperti requireRole.
 */
export async function requirePermission(
  admin: SupabaseClient<Database>,
  userId: string,
  permission: PermissionKey | readonly PermissionKey[],
  options: { extraRoles?: string[] } = {},
): Promise<string> {
  const result = await checkPermission(admin, userId, permission, options);
  if (!result.allowed || !result.role) throw new ForbiddenError();
  return result.role;
}


export interface AcademicAccessProfile {
  role: string;
  departemen_id: string | null;
}

/**
 * Otorisasi akademik yang sadar lembaga.
 * Admin dapat lintas lembaga; kepala_sekolah hanya lembaga sendiri; admin_tu mengikuti scope lembaganya.
 */
export async function requireAcademicDepartment(
  admin: SupabaseClient<Database>,
  userId: string,
  departemenId: string | null | undefined,
  roles: string[] = ["admin", "kepala_sekolah", "admin_tu"],
): Promise<AcademicAccessProfile> {
  const { data: profile } = await admin
    .from("users_profile")
    .select("role, departemen_id, aktif")
    .eq("id", userId)
    .single();

  if (!profile || profile.aktif === false || !roles.includes(profile.role)) {
    throw new ForbiddenError();
  }
  if (profile.role === "kepala_sekolah" || profile.role === "admin_tu") {
    const roleLabel =
      profile.role === "kepala_sekolah" ? "Kepala Sekolah" : "Admin TU";
    if (!departemenId) {
      throw new ForbiddenError("Forbidden: lembaga di luar kewenangan " + roleLabel);
    }
    const { data: allowed, error: accessError } = await admin.rpc(
      "can_manage_akademik_departemen",
      { _user_id: userId, _departemen_id: departemenId },
    );
    if (accessError || !allowed) {
      throw new ForbiddenError("Forbidden: lembaga di luar kewenangan " + roleLabel);
    }
  }
  return { role: profile.role, departemen_id: profile.departemen_id };
}
