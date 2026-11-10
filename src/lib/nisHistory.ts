import { supabase } from "@/integrations/supabase/client";

// Tabel riwayat NIS kini ada di types.ts (dibuat dari skema Rustbase lewat
// scripts/db-types), jadi klien tidak lagi butuh tipe lokal. Nama ekspor dipertahankan
// untuk pemakainya.
export const nisHistoryClient = supabase;
