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


export interface AcademicAccessProfile {
  role: string;
  departemen_id: string | null;
}

/**
 * Otorisasi akademik yang sadar lembaga.
 * Admin/kepala_sekolah dapat lintas lembaga; admin_tu hanya pada departemen profilnya.
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
  if (profile.role === "admin_tu") {
    if (!departemenId || !profile.departemen_id || profile.departemen_id !== departemenId) {
      throw new ForbiddenError("Forbidden: lembaga di luar kewenangan Admin TU");
    }
  }
  return { role: profile.role, departemen_id: profile.departemen_id };
}
