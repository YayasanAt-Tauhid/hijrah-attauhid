/**
 * Server functions untuk self-service akun Portal Orang Tua:
 *  - portalOrtuSignUp: daftar akun orang tua baru (email+password) +
 *    verifikasi & hubungkan anak sekaligus.
 *  - portalOrtuTambahAnak: orang tua yang sudah login menghubungkan anak
 *    tambahan ke akunnya sendiri.
 *  - portalOrtuCompleteGoogleSignup: melengkapi akun yang baru dibuat lewat
 *    Google OAuth (role NULL untuk akun baru; legacy bisa masih 'siswa')
 *    agar menjadi role 'ortu' + terhubung ke anaknya.
 *
 * Verifikasi identitas anak memakai kombinasi NIS + nama + tanggal lahir
 * (bukan NIS+nama saja) karena NIS & nama relatif mudah diketahui pihak lain
 * (tercetak di rapor/kartu pelajar); tanggal lahir menambah lapisan agar
 * tidak sembarang orang bisa mengklaim siswa yang bukan anaknya. Pesan galat
 * dibuat generik (tidak menyebut field mana yang salah) untuk mengurangi
 * risiko enumerasi data siswa.
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { authMiddleware, requireContext, requireRole } from "./auth";
import { createAdminClient } from "./supabase";

const HUBUNGAN_OPTIONS = ["ayah", "ibu", "wali"];
const GAGAL_VERIFIKASI =
  "Data siswa tidak ditemukan. Periksa kembali NIS, nama lengkap, dan tanggal lahir anak.";

interface SiswaBrief {
  id: string;
  nama: string;
  nis: string | null;
}

async function cariSiswaTervalidasi(
  admin: SupabaseClient<Database>,
  input: { nis: string; nama: string; tanggal_lahir: string }
): Promise<SiswaBrief> {
  const nis = (input.nis || "").trim();
  const nama = (input.nama || "").trim();
  const tanggal_lahir = (input.tanggal_lahir || "").trim();
  if (!nis || !nama || !tanggal_lahir) {
    throw new Error("NIS, nama lengkap, dan tanggal lahir anak wajib diisi");
  }

  const { data } = await admin
    .from("siswa")
    .select("id, nama, nis")
    .eq("nis", nis)
    .eq("tanggal_lahir", tanggal_lahir)
    .maybeSingle();

  if (!data || data.nama.trim().toLowerCase() !== nama.toLowerCase()) {
    throw new Error(GAGAL_VERIFIKASI);
  }
  return data;
}

function normalisasiHubungan(v: string | undefined): string {
  return HUBUNGAN_OPTIONS.includes(v || "") ? (v as string) : "wali";
}

// ─── Daftar akun orang tua baru (public) ───
export interface PortalOrtuSignUpInput {
  email: string;
  password: string;
  hubungan: string;
  nis: string;
  nama_siswa: string;
  tanggal_lahir_siswa: string;
}

export const portalOrtuSignUp = createServerFn({ method: "POST" })
  .inputValidator((d: PortalOrtuSignUpInput) => d)
  .handler(async ({ data }): Promise<{ success: true }> => {
    const admin = createAdminClient();
    const email = (data.email || "").trim().toLowerCase();
    const password = data.password || "";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Format email tidak valid");
    }
    if (!password || password.length < 8) {
      throw new Error("Password minimal 8 karakter");
    }

    const siswa = await cariSiswaTervalidasi(admin, {
      nis: data.nis,
      nama: data.nama_siswa,
      tanggal_lahir: data.tanggal_lahir_siswa,
    });

    const { data: existing } = await admin
      .from("users_profile")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (existing) {
      throw new Error("Email sudah terdaftar. Silakan gunakan halaman login.");
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr || !created?.user) {
      throw new Error("Gagal membuat akun: " + (createErr?.message || "unknown"));
    }
    const newId = created.user.id;

    const { error: profileErr } = await admin
      .from("users_profile")
      .upsert({ id: newId, email, role: "ortu", aktif: true });
    if (profileErr) {
      await admin.auth.admin.deleteUser(newId);
      throw new Error("Gagal mengatur profil: " + profileErr.message);
    }

    const { error: linkErr } = await admin.from("ortu_siswa").insert({
      user_id: newId,
      siswa_id: siswa.id,
      hubungan: normalisasiHubungan(data.hubungan),
    });
    if (linkErr) {
      await admin.auth.admin.deleteUser(newId);
      throw new Error("Gagal menghubungkan data anak: " + linkErr.message);
    }

    return { success: true };
  });

// ─── Orang tua (sudah login) menambahkan anak lain ke akunnya ───
export interface PortalOrtuTambahAnakInput {
  nis: string;
  nama_siswa: string;
  tanggal_lahir_siswa: string;
  hubungan: string;
}

export const portalOrtuTambahAnak = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: PortalOrtuTambahAnakInput) => d)
  .handler(async ({ data, context }): Promise<{ success: true; nama: string }> => {
    const admin = createAdminClient();
    const userId = requireContext(context).userId;
    await requireRole(admin, userId, ["ortu"]);

    const siswa = await cariSiswaTervalidasi(admin, {
      nis: data.nis,
      nama: data.nama_siswa,
      tanggal_lahir: data.tanggal_lahir_siswa,
    });

    const { data: existingLink } = await admin
      .from("ortu_siswa")
      .select("id")
      .eq("user_id", userId)
      .eq("siswa_id", siswa.id)
      .maybeSingle();
    if (existingLink) {
      throw new Error("Anak ini sudah terhubung ke akun Anda");
    }

    const { error } = await admin.from("ortu_siswa").insert({
      user_id: userId,
      siswa_id: siswa.id,
      hubungan: normalisasiHubungan(data.hubungan),
    });
    if (error) throw new Error("Gagal menghubungkan: " + error.message);

    return { success: true, nama: siswa.nama };
  });

// ─── Lengkapi akun Google baru/belum terklasifikasi jadi akun orang tua ───
export interface PortalOrtuCompleteGoogleSignupInput {
  nis: string;
  nama_siswa: string;
  tanggal_lahir_siswa: string;
  hubungan: string;
}

// Jendela waktu sejak akun auth dibuat yang masih dianggap "baru saja
// signup lewat Google" -- proteksi agar akun lama (mis. siswa yang sudah
// lama punya login dengan role 'siswa') tidak bisa "naik" jadi ortu hanya
// dengan menebak NIS+nama+tanggal lahir siswa lain.
const JENDELA_SIGNUP_BARU_MS = 10 * 60 * 1000;

export const portalOrtuCompleteGoogleSignup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: PortalOrtuCompleteGoogleSignupInput) => d)
  .handler(async ({ data, context }): Promise<{ success: true; nama: string }> => {
    const admin = createAdminClient();
    const userId = requireContext(context).userId;

    const { data: profile } = await admin
      .from("users_profile")
      .select("role")
      .eq("id", userId)
      .single();
    if (profile?.role === "ortu") {
      throw new Error("Akun ini sudah terdaftar sebagai akun orang tua");
    }
    if (profile?.role && profile.role !== "siswa") {
      throw new Error(
        "Akun Google ini sudah terhubung ke akun staff lain dan tidak bisa dijadikan akun orang tua"
      );
    }

    const { data: authUser } = await admin.auth.admin.getUserById(userId);
    const createdAt = authUser?.user?.created_at ? new Date(authUser.user.created_at).getTime() : 0;
    if (!createdAt || Date.now() - createdAt > JENDELA_SIGNUP_BARU_MS) {
      throw new Error(
        "Akun ini bukan pendaftaran orang tua baru. Hubungi admin sekolah bila ini keliru."
      );
    }

    const siswa = await cariSiswaTervalidasi(admin, {
      nis: data.nis,
      nama: data.nama_siswa,
      tanggal_lahir: data.tanggal_lahir_siswa,
    });

    const { error: profileErr } = await admin
      .from("users_profile")
      .update({ role: "ortu" })
      .eq("id", userId);
    if (profileErr) throw new Error("Gagal mengatur profil: " + profileErr.message);

    const { error: linkErr } = await admin.from("ortu_siswa").insert({
      user_id: userId,
      siswa_id: siswa.id,
      hubungan: normalisasiHubungan(data.hubungan),
    });
    if (linkErr) throw new Error("Gagal menghubungkan data anak: " + linkErr.message);

    return { success: true, nama: siswa.nama };
  });
