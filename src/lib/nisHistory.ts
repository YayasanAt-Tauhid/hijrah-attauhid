import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";

// The generated snapshot predates the NIS-history table. Keep its verified
// schema local until the full database snapshot is regenerated.
type NisHistoryDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Database["public"]["Tables"] & {
      siswa_tahun_masuk_departemen: {
        Row: {
          id: string
          siswa_id: string
          departemen_id: string
          tahun_masuk: number
          nis: string | null
          sumber: string
          keterangan: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          siswa_id: string
          departemen_id: string
          tahun_masuk: number
          nis?: string | null
          sumber?: string
          keterangan?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          siswa_id?: string
          departemen_id?: string
          tahun_masuk?: number
          nis?: string | null
          sumber?: string
          keterangan?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "siswa_tahun_masuk_departemen_departemen_id_fkey"
            columns: ["departemen_id"]
            isOneToOne: false
            referencedRelation: "departemen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "siswa_tahun_masuk_departemen_siswa_id_fkey"
            columns: ["siswa_id"]
            isOneToOne: false
            referencedRelation: "siswa"
            referencedColumns: ["id"]
          },
        ]
      }
    };
  };
};
export const nisHistoryClient = supabase as unknown as SupabaseClient<NisHistoryDatabase>;
