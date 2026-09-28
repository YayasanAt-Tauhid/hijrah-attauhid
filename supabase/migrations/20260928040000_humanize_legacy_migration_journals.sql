-- Make legacy migration journals readable to finance users.
-- UUID/source keys remain in jurnal.referensi for auditability.

CREATE OR REPLACE FUNCTION migration.legacy_journal_keterangan(
  p_siswa_id uuid,
  p_kelas_id uuid,
  p_jenis_id uuid,
  p_period date
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'migration'
AS $function$
DECLARE
  v_nama text;
  v_kelas text;
  v_jenis text;
  v_bulan text;
  v_tahun integer;
BEGIN
  SELECT s.nama INTO v_nama
  FROM public.siswa s
  WHERE s.id = p_siswa_id;

  SELECT k.nama INTO v_kelas
  FROM public.kelas k
  WHERE k.id = p_kelas_id;

  SELECT jp.nama INTO v_jenis
  FROM public.jenis_pembayaran jp
  WHERE jp.id = p_jenis_id;

  v_bulan := CASE extract(month from p_period)::integer
    WHEN 1 THEN 'Januari'
    WHEN 2 THEN 'Februari'
    WHEN 3 THEN 'Maret'
    WHEN 4 THEN 'April'
    WHEN 5 THEN 'Mei'
    WHEN 6 THEN 'Juni'
    WHEN 7 THEN 'Juli'
    WHEN 8 THEN 'Agustus'
    WHEN 9 THEN 'September'
    WHEN 10 THEN 'Oktober'
    WHEN 11 THEN 'November'
    WHEN 12 THEN 'Desember'
    ELSE to_char(p_period, 'YYYY-MM')
  END;
  v_tahun := extract(year from p_period)::integer;

  RETURN 'Piutang ' || COALESCE(v_jenis, 'biaya siswa')
    || ' migrasi ' || v_bulan || ' ' || v_tahun
    || ' — ' || COALESCE(v_nama, 'Siswa')
    || ' — Kelas ' || COALESCE(v_kelas, '-');
END;
$function$;

CREATE OR REPLACE FUNCTION migration.sync_legacy_journal_keterangan_from_tagihan()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'migration'
AS $function$
DECLARE
  v_referensi text;
  v_period date;
BEGIN
  IF NEW.jurnal_piutang_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT j.referensi
  INTO v_referensi
  FROM public.jurnal j
  WHERE j.id = NEW.jurnal_piutang_id;

  IF v_referensi IS NULL OR v_referensi NOT LIKE 'MIGR-LEGACY-%' THEN
    RETURN NEW;
  END IF;

  v_period := COALESCE(
    date_trunc('month', NEW.jatuh_tempo)::date,
    current_date
  );

  UPDATE public.jurnal j
  SET keterangan = migration.legacy_journal_keterangan(
    NEW.siswa_id,
    NEW.kelas_id,
    NEW.jenis_id,
    v_period
  )
  WHERE j.id = NEW.jurnal_piutang_id;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_legacy_journal_keterangan ON public.tagihan;
CREATE TRIGGER trg_sync_legacy_journal_keterangan
AFTER INSERT OR UPDATE OF siswa_id, jenis_id, kelas_id, jatuh_tempo, jurnal_piutang_id
ON public.tagihan
FOR EACH ROW
EXECUTE FUNCTION migration.sync_legacy_journal_keterangan_from_tagihan();

-- Backfill journals already posted by the migration. Financial amounts,
-- journal status, and references are intentionally untouched.
UPDATE public.jurnal j
SET keterangan = migration.legacy_journal_keterangan(
  t.siswa_id,
  t.kelas_id,
  t.jenis_id,
  date_trunc('month', t.jatuh_tempo)::date
)
FROM public.tagihan t
WHERE t.jurnal_piutang_id = j.id
  AND j.referensi LIKE 'MIGR-LEGACY-%';
