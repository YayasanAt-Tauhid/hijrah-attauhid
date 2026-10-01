-- Akun auth baru tidak boleh otomatis dianggap sebagai siswa.
--
-- Sebelumnya setiap user baru (termasuk orang tua yang keliru masuk lewat
-- /login lalu memakai Google OAuth) mendapat users_profile.role='siswa'.
-- Role aplikasi harus ditentukan oleh alur yang memang berwenang:
--   - adminCreateUser -> role staff/siswa eksplisit
--   - portalOrtuSignUp / portalOrtuCompleteGoogleSignup -> role 'ortu'
-- User OAuth yang belum diklasifikasikan tetap memiliki profile, tetapi role
-- NULL sehingga tidak memperoleh hak akses role apa pun.
--
-- Tidak mengubah akun lama secara massal karena role='siswa' yang sudah ada
-- dapat merupakan akun siswa yang sah.

ALTER TABLE public.users_profile
  ALTER COLUMN role DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.users_profile (id, email, role)
  VALUES (NEW.id, NEW.email, NULL);
  RETURN NEW;
END;
$function$;

-- Trigger function hanya dijalankan oleh trigger auth.users; jangan dapat
-- dipanggil langsung melalui Data API.
REVOKE ALL ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated;
