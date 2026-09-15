-- SPMB: pilihan Asrama / Non Asrama hanya berlaku untuk jenjang SMP, SMA, dan MTA.
-- Jenjang lain menyimpan NULL.

ALTER TABLE public.siswa_detail
  ADD COLUMN IF NOT EXISTS status_asrama text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'siswa_detail_status_asrama_check'
      AND conrelid = 'public.siswa_detail'::regclass
  ) THEN
    ALTER TABLE public.siswa_detail
      ADD CONSTRAINT siswa_detail_status_asrama_check
      CHECK (status_asrama IS NULL OR status_asrama IN ('asrama', 'non_asrama'));
  END IF;
END
$$;

COMMENT ON COLUMN public.siswa_detail.status_asrama IS
  'Pilihan SPMB untuk jenjang SMP/SMA/MTA: asrama atau non_asrama; NULL untuk jenjang lain';
