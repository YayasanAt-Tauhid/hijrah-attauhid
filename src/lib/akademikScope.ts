import { supabase } from "@/integrations/supabase/client";
import type { UserRole } from "@/contexts/AuthContext";

export async function getAkademikManagedDepartemenIds(role: UserRole | null): Promise<string[] | null> {
  if (role !== "admin_tu") return null;

  const { data, error } = await (supabase as any).rpc("akademik_managed_departemen_ids");
  if (error) throw error;

  return [...new Set(
    (data || [])
      .map((row: any) => row.departemen_id)
      .filter(Boolean),
  )] as string[];
}
