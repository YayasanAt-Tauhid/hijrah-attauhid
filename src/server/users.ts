/**
 * Server function: adminCreateUser
 * Migrasi dari supabase/functions/admin-create-user.
 * Membuat akun login baru + mengatur profilnya. Hanya admin.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, requireContext, requireRole } from "./auth";
import { createAdminClient } from "./supabase";

const ALLOWED_ROLES = [
  "admin",
  "kepala_sekolah",
  "guru",
  "keuangan",
  "sekretaris_yayasan",
  "kasir",
  "pustakawan",
  "siswa",
];

export interface CreateUserInput {
  email: string;
  password: string;
  role: string;
  departemen_id?: string | null;
  pegawai_id?: string | null;
  aktif?: boolean;
}

export const adminCreateUser = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: CreateUserInput) => d)
  .handler(
    async ({ data, context }): Promise<{ success: true; id: string; email: string }> => {
      const admin = createAdminClient();
      await requireRole(admin, requireContext(context).userId, ["admin"]);

      const email = (data.email || "").trim().toLowerCase();
      const password = data.password || "";
      const role = data.role;

      if (!email) throw new Error("Email wajib diisi");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new Error("Format email tidak valid");
      if (!password || password.length < 8)
        throw new Error("Password minimal 8 karakter");
      if (!role || !ALLOWED_ROLES.includes(role))
        throw new Error("Role tidak valid");

      // Buat auth user (email langsung terkonfirmasi agar bisa login)
      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
      if (createErr || !created?.user) {
        throw new Error(
          "Gagal membuat akun: " + (createErr?.message || "unknown")
        );
      }

      const newId = created.user.id;

      // Baris users_profile biasanya sudah dibuat trigger handle_new_user
      // dengan role NULL (belum diklasifikasikan). Upsert di sini menetapkan
      // role resmi yang dipilih admin sekaligus berjaga bila trigger tidak
      // jalan -- update pada baris yang belum ada tidak menghasilkan
      // error di Supabase JS (0 rows affected), jadi bisa lolos tanpa profil
      // sama sekali kalau hanya pakai .update().
      const { error: updErr } = await admin
        .from("users_profile")
        .upsert({
          id: newId,
          email,
          role,
          departemen_id: data.departemen_id || null,
          pegawai_id: data.pegawai_id || null,
          aktif: data.aktif ?? true,
        });

      if (updErr) {
        // Rollback: hapus auth user agar tidak ada akun setengah-jadi
        await admin.auth.admin.deleteUser(newId);
        throw new Error("Gagal mengatur profil: " + updErr.message);
      }

      return { success: true, id: newId, email };
    }
  );
