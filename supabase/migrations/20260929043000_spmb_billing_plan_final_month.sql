-- Persist the selected final SPP month (Apr/May/Jun) for plans that run
-- until the end of a student's level. Academic promotion/repeat workflows
-- may recalculate the graduation year; this trigger keeps the chosen month.

ALTER TABLE public.rencana_tagihan_siswa
  ADD COLUMN IF NOT EXISTS bulan_terakhir smallint NOT NULL DEFAULT 6;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'rencana_tagihan_bulan_terakhir_check'
      AND conrelid = 'public.rencana_tagihan_siswa'::regclass
  ) THEN
    ALTER TABLE public.rencana_tagihan_siswa
      ADD CONSTRAINT rencana_tagihan_bulan_terakhir_check
      CHECK (bulan_terakhir IN (4, 5, 6));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.jaga_bulan_akhir_rencana_tagihan()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_year integer;
BEGIN
  IF NEW.sampai_akhir_jenjang = true
     AND NEW.selesai IS NOT NULL
     AND NEW.bulan_terakhir IS NOT NULL THEN
    IF NEW.bulan_terakhir NOT IN (4, 5, 6) THEN
      RAISE EXCEPTION 'Bulan terakhir SPP harus April, Mei, atau Juni';
    END IF;

    v_year := extract(year from NEW.selesai)::integer;
    NEW.selesai := (
      make_date(v_year, NEW.bulan_terakhir, 1)
      + interval '1 month - 1 day'
    )::date;

    IF NEW.mulai IS NOT NULL AND NEW.selesai < NEW.mulai THEN
      RAISE EXCEPTION 'Akhir rencana tidak boleh sebelum periode mulai';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_jaga_bulan_akhir_rencana_tagihan
  ON public.rencana_tagihan_siswa;

CREATE TRIGGER trg_jaga_bulan_akhir_rencana_tagihan
BEFORE INSERT OR UPDATE OF selesai, bulan_terakhir, sampai_akhir_jenjang
ON public.rencana_tagihan_siswa
FOR EACH ROW
EXECUTE FUNCTION public.jaga_bulan_akhir_rencana_tagihan();

COMMENT ON COLUMN public.rencana_tagihan_siswa.bulan_terakhir IS
  'Bulan terakhir SPP pada tahun kelulusan untuk rencana sampai akhir jenjang: 4=April, 5=Mei, 6=Juni.';