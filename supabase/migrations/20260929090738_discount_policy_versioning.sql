-- Versioned discount/relief policy framework.
-- A policy change creates a NEW version; old versions remain immutable history.
-- Student discounts snapshot the effective type/value so later policy changes
-- never recalculate historical bills.

CREATE TABLE IF NOT EXISTS public.kebijakan_keringanan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kode text NOT NULL,
  versi integer NOT NULL,
  nama text NOT NULL,
  skema_diskon_id uuid NOT NULL REFERENCES public.skema_diskon(id) ON DELETE RESTRICT,
  jenis_id uuid NOT NULL REFERENCES public.jenis_pembayaran(id) ON DELETE RESTRICT,
  kelas_regex text,
  tipe text NOT NULL,
  nilai numeric(15,2) NOT NULL,
  otomatis boolean NOT NULL DEFAULT false,
  perlu_pengajuan boolean NOT NULL DEFAULT true,
  berlaku_mulai date NOT NULL,
  berlaku_selesai date,
  aktif boolean NOT NULL DEFAULT true,
  keterangan text,
  dibuat_oleh uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kebijakan_keringanan_kode_versi_key UNIQUE (kode, versi),
  CONSTRAINT kebijakan_keringanan_tipe_check CHECK (tipe IN ('persen','nominal')),
  CONSTRAINT kebijakan_keringanan_nilai_check CHECK (
    nilai >= 0 AND (tipe <> 'persen' OR nilai <= 100)
  ),
  CONSTRAINT kebijakan_keringanan_periode_check CHECK (
    berlaku_selesai IS NULL OR berlaku_selesai >= berlaku_mulai
  )
);

COMMENT ON TABLE public.kebijakan_keringanan IS
  'Versi kebijakan keringanan yayasan. Jangan edit versi lama untuk perubahan kebijakan; buat versi baru dengan tanggal efektif baru.';
COMMENT ON COLUMN public.kebijakan_keringanan.kelas_regex IS
  'Opsional. Regex nama kelas untuk kebijakan khusus tingkat, misalnya ^MTA 4$ atau ^TK B.';
COMMENT ON COLUMN public.kebijakan_keringanan.otomatis IS
  'Menandai kebijakan yang boleh diproses otomatis oleh job sistem bila syarat penerima sudah terverifikasi.';

CREATE INDEX IF NOT EXISTS idx_kebijakan_keringanan_lookup
  ON public.kebijakan_keringanan(skema_diskon_id, jenis_id, berlaku_mulai, berlaku_selesai)
  WHERE aktif = true;

ALTER TABLE public.kebijakan_keringanan ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.kebijakan_keringanan FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.kebijakan_keringanan TO service_role;

ALTER TABLE public.siswa_diskon
  ADD COLUMN IF NOT EXISTS kebijakan_keringanan_id uuid
    REFERENCES public.kebijakan_keringanan(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tipe_snapshot text,
  ADD COLUMN IF NOT EXISTS nilai_snapshot numeric(15,2),
  ADD COLUMN IF NOT EXISTS kebijakan_snapshot jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'siswa_diskon_tipe_snapshot_check'
      AND conrelid = 'public.siswa_diskon'::regclass
  ) THEN
    ALTER TABLE public.siswa_diskon
      ADD CONSTRAINT siswa_diskon_tipe_snapshot_check
      CHECK (tipe_snapshot IS NULL OR tipe_snapshot IN ('persen','nominal'));
  END IF;
END $$;

UPDATE public.siswa_diskon sd
SET tipe_snapshot = COALESCE(sd.tipe_snapshot, sk.tipe),
    nilai_snapshot = COALESCE(sd.nilai_snapshot, sd.nilai, sk.nilai_default),
    kebijakan_snapshot = COALESCE(
      sd.kebijakan_snapshot,
      jsonb_build_object(
        'sumber', 'legacy',
        'skema', sk.nama,
        'tipe', sk.tipe,
        'nilai', COALESCE(sd.nilai, sk.nilai_default),
        'dicatat_pada_migrasi', current_date
      )
    )
FROM public.skema_diskon sk
WHERE sk.id = sd.skema_diskon_id
  AND (
    sd.tipe_snapshot IS NULL
    OR sd.nilai_snapshot IS NULL
    OR sd.kebijakan_snapshot IS NULL
  );

CREATE OR REPLACE FUNCTION public.snapshot_siswa_diskon()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_skema public.skema_diskon;
  v_policy public.kebijakan_keringanan;
  v_nilai numeric;
  v_tipe text;
BEGIN
  SELECT * INTO v_skema
  FROM public.skema_diskon
  WHERE id = NEW.skema_diskon_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Skema keringanan tidak ditemukan';
  END IF;

  IF NEW.kebijakan_keringanan_id IS NOT NULL THEN
    SELECT * INTO v_policy
    FROM public.kebijakan_keringanan
    WHERE id = NEW.kebijakan_keringanan_id
      AND aktif = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Kebijakan keringanan tidak ditemukan atau tidak aktif';
    END IF;

    IF v_policy.skema_diskon_id IS DISTINCT FROM NEW.skema_diskon_id
       OR v_policy.jenis_id IS DISTINCT FROM NEW.jenis_id THEN
      RAISE EXCEPTION 'Kebijakan keringanan tidak sesuai skema/jenis tagihan';
    END IF;

    IF NEW.periode_mulai < v_policy.berlaku_mulai
       OR (
         v_policy.berlaku_selesai IS NOT NULL
         AND NEW.periode_selesai > v_policy.berlaku_selesai
       ) THEN
      RAISE EXCEPTION 'Periode pengajuan melewati masa berlaku kebijakan';
    END IF;

    v_tipe := v_policy.tipe;
    v_nilai := COALESCE(NEW.nilai, v_policy.nilai);

    NEW.kebijakan_snapshot := jsonb_build_object(
      'sumber', 'kebijakan',
      'id', v_policy.id,
      'kode', v_policy.kode,
      'versi', v_policy.versi,
      'nama', v_policy.nama,
      'tipe', v_policy.tipe,
      'nilai_kebijakan', v_policy.nilai,
      'nilai_diberikan', v_nilai,
      'berlaku_mulai', v_policy.berlaku_mulai,
      'berlaku_selesai', v_policy.berlaku_selesai,
      'kelas_regex', v_policy.kelas_regex
    );
  ELSE
    v_tipe := v_skema.tipe;
    v_nilai := COALESCE(NEW.nilai, v_skema.nilai_default);
    NEW.kebijakan_snapshot := jsonb_build_object(
      'sumber', 'manual',
      'skema', v_skema.nama,
      'tipe', v_tipe,
      'nilai_diberikan', v_nilai
    );
  END IF;

  IF v_nilai IS NULL OR v_nilai < 0 THEN
    RAISE EXCEPTION 'Nilai keringanan tidak valid';
  END IF;
  IF v_tipe = 'persen' AND v_nilai > 100 THEN
    RAISE EXCEPTION 'Persentase keringanan tidak boleh lebih dari 100%%';
  END IF;

  -- Materialize the actual value. Existing accounting RPCs therefore never
  -- depend on a future change to skema_diskon.nilai_default.
  NEW.nilai := v_nilai;
  NEW.tipe_snapshot := v_tipe;
  NEW.nilai_snapshot := v_nilai;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_snapshot_siswa_diskon ON public.siswa_diskon;
CREATE TRIGGER trg_snapshot_siswa_diskon
  BEFORE INSERT OR UPDATE OF skema_diskon_id, jenis_id, kebijakan_keringanan_id, nilai,
    periode_mulai, periode_selesai
  ON public.siswa_diskon
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_siswa_diskon();

CREATE OR REPLACE FUNCTION public.cegah_mutasi_diskon_disetujui()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status = 'disetujui' AND (
    NEW.skema_diskon_id IS DISTINCT FROM OLD.skema_diskon_id
    OR NEW.jenis_id IS DISTINCT FROM OLD.jenis_id
    OR NEW.kebijakan_keringanan_id IS DISTINCT FROM OLD.kebijakan_keringanan_id
    OR NEW.nilai IS DISTINCT FROM OLD.nilai
    OR NEW.periode_mulai IS DISTINCT FROM OLD.periode_mulai
    OR NEW.periode_selesai IS DISTINCT FROM OLD.periode_selesai
  ) THEN
    RAISE EXCEPTION
      'Keringanan yang sudah disetujui tidak boleh diubah. Batalkan lalu buat pengajuan baru agar histori tetap utuh.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_cegah_mutasi_diskon_disetujui ON public.siswa_diskon;
CREATE TRIGGER trg_cegah_mutasi_diskon_disetujui
  BEFORE UPDATE OF skema_diskon_id, jenis_id, kebijakan_keringanan_id, nilai,
    periode_mulai, periode_selesai
  ON public.siswa_diskon
  FOR EACH ROW EXECUTE FUNCTION public.cegah_mutasi_diskon_disetujui();

CREATE OR REPLACE FUNCTION public.cegah_perubahan_tipe_skema_diskon()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.tipe IS DISTINCT FROM OLD.tipe
     AND EXISTS (
       SELECT 1 FROM public.siswa_diskon sd
       WHERE sd.skema_diskon_id = OLD.id
     ) THEN
    RAISE EXCEPTION
      'Tipe skema tidak boleh diubah setelah pernah dipakai. Buat skema baru agar histori keringanan tetap benar.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_cegah_perubahan_tipe_skema_diskon ON public.skema_diskon;
CREATE TRIGGER trg_cegah_perubahan_tipe_skema_diskon
  BEFORE UPDATE OF tipe ON public.skema_diskon
  FOR EACH ROW EXECUTE FUNCTION public.cegah_perubahan_tipe_skema_diskon();

CREATE OR REPLACE FUNCTION public.buat_versi_kebijakan_keringanan(
  p_kode text,
  p_nama text,
  p_skema_diskon_id uuid,
  p_jenis_id uuid,
  p_kelas_regex text,
  p_tipe text,
  p_nilai numeric,
  p_otomatis boolean,
  p_perlu_pengajuan boolean,
  p_berlaku_mulai date,
  p_berlaku_selesai date,
  p_keterangan text,
  p_user_id uuid
)
RETURNS public.kebijakan_keringanan
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_versi integer;
  v_mulai_terakhir date;
  v_skema_tipe text;
  v_row public.kebijakan_keringanan;
BEGIN
  IF p_user_id IS NULL OR NOT (
    public.has_role(p_user_id,'admin') OR public.has_role(p_user_id,'keuangan')
  ) THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;

  p_kode := lower(btrim(COALESCE(p_kode,'')));
  IF p_kode = '' OR p_kode !~ '^[a-z0-9][a-z0-9_:-]*$' THEN
    RAISE EXCEPTION 'Kode kebijakan hanya boleh huruf kecil, angka, garis bawah, titik dua, atau tanda hubung';
  END IF;
  IF btrim(COALESCE(p_nama,'')) = '' THEN
    RAISE EXCEPTION 'Nama kebijakan wajib diisi';
  END IF;
  IF p_berlaku_mulai IS NULL
     OR (p_berlaku_selesai IS NOT NULL AND p_berlaku_selesai < p_berlaku_mulai) THEN
    RAISE EXCEPTION 'Periode kebijakan tidak valid';
  END IF;
  IF p_nilai IS NULL OR p_nilai < 0 OR (p_tipe='persen' AND p_nilai > 100) THEN
    RAISE EXCEPTION 'Nilai kebijakan tidak valid';
  END IF;

  SELECT tipe INTO v_skema_tipe
  FROM public.skema_diskon
  WHERE id = p_skema_diskon_id AND aktif = true;

  IF v_skema_tipe IS NULL THEN
    RAISE EXCEPTION 'Skema keringanan tidak ditemukan atau tidak aktif';
  END IF;
  IF v_skema_tipe IS DISTINCT FROM p_tipe THEN
    RAISE EXCEPTION 'Tipe kebijakan harus sama dengan tipe skema keringanan (%)', v_skema_tipe;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.jenis_pembayaran
    WHERE id = p_jenis_id AND aktif = true
  ) THEN
    RAISE EXCEPTION 'Jenis pembayaran tidak ditemukan atau tidak aktif';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('kebijakan_keringanan:' || p_kode));

  SELECT COALESCE(max(versi),0), max(berlaku_mulai)
    INTO v_versi, v_mulai_terakhir
  FROM public.kebijakan_keringanan
  WHERE kode = p_kode;

  IF v_mulai_terakhir IS NOT NULL AND p_berlaku_mulai <= v_mulai_terakhir THEN
    RAISE EXCEPTION
      'Versi baru harus mulai setelah versi terakhir (%)', v_mulai_terakhir;
  END IF;

  UPDATE public.kebijakan_keringanan
  SET berlaku_selesai = p_berlaku_mulai - 1
  WHERE kode = p_kode
    AND aktif = true
    AND berlaku_mulai < p_berlaku_mulai
    AND (berlaku_selesai IS NULL OR berlaku_selesai >= p_berlaku_mulai);

  INSERT INTO public.kebijakan_keringanan(
    kode,versi,nama,skema_diskon_id,jenis_id,kelas_regex,
    tipe,nilai,otomatis,perlu_pengajuan,
    berlaku_mulai,berlaku_selesai,aktif,keterangan,dibuat_oleh
  )
  VALUES(
    p_kode,v_versi+1,btrim(p_nama),p_skema_diskon_id,p_jenis_id,
    NULLIF(btrim(COALESCE(p_kelas_regex,'')),''),
    p_tipe,p_nilai,COALESCE(p_otomatis,false),COALESCE(p_perlu_pengajuan,true),
    p_berlaku_mulai,p_berlaku_selesai,true,NULLIF(btrim(COALESCE(p_keterangan,'')),''),
    p_user_id
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.buat_versi_kebijakan_keringanan(
  text,text,uuid,uuid,text,text,numeric,boolean,boolean,date,date,text,uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.buat_versi_kebijakan_keringanan(
  text,text,uuid,uuid,text,text,numeric,boolean,boolean,date,date,text,uuid
) TO service_role;

-- Keringanan khusus is intentionally flexible: no fixed duration/value.
INSERT INTO public.skema_diskon(
  nama,kategori,tipe,nilai_default,perlu_approval,aktif,keterangan
)
SELECT
  'Keringanan Khusus','keringanan','nominal',0,true,true,
  'Keringanan fleksibel untuk prestasi, bantuan, atau keputusan khusus yayasan. Nilai dan masa berlaku ditentukan per pengajuan.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.skema_diskon WHERE nama='Keringanan Khusus'
);

-- Seed policy versions from the currently agreed rules. Special TK entry/repeat
-- relief and MTA-4 special relief are NOT seeded because their nominal has not
-- been fixed; they remain configurable/manual.
WITH cfg(
  kode,nama,skema_nama,dept_kode,jenis_nama,kelas_regex,tipe,nilai,otomatis,perlu_pengajuan,keterangan
) AS (
  VALUES
    ('ptk_spp_tk','PTK · SPP TK gratis','Potongan Anak PTK','TK','SPP TK',NULL,'persen',100::numeric,false,false,'Anak PTK: SPP TK A/TK B 100% gratis.'),
    ('ptk_spp_sd','PTK · SPP SD 50%','Potongan Anak PTK','SD','SPP SD',NULL,'persen',50::numeric,false,false,'Anak PTK: SPP SD 50%.'),
    ('ptk_spp_smp','PTK · SPP SMP 50%','Potongan Anak PTK','SMP','SPP SMP',NULL,'persen',50::numeric,false,false,'Anak PTK: SPP SMP 50%.'),
    ('ptk_spp_sma','PTK · SPP SMA 50%','Potongan Anak PTK','SMA','SPP SMA',NULL,'persen',50::numeric,false,false,'Anak PTK: SPP SMA 50%.'),
    ('ptk_spp_mta','PTK · SPP MTA 50%','Potongan Anak PTK','MTA','SPP MTA',NULL,'persen',50::numeric,false,false,'Anak PTK: SPP MTA 50%.'),
    ('ptk_du_sd','PTK · Daftar Ulang SD gratis','Potongan Anak PTK','SD','UANG DAFTAR ULANG SD',NULL,'persen',100::numeric,false,false,'Daftar ulang reguler Rp500.000 untuk anak PTK gratis 100%.'),
    ('ptk_du_smp','PTK · Daftar Ulang SMP gratis','Potongan Anak PTK','SMP','UANG DAFTAR ULANG SMP',NULL,'persen',100::numeric,false,false,'Daftar ulang reguler Rp500.000 untuk anak PTK gratis 100%.'),
    ('ptk_du_sma','PTK · Daftar Ulang SMA gratis','Potongan Anak PTK','SMA','UANG DAFTAR ULANG SMA',NULL,'persen',100::numeric,false,false,'Daftar ulang reguler Rp500.000 untuk anak PTK gratis 100%.'),
    ('ptk_du_mta_reguler','PTK · Daftar Ulang MTA reguler gratis','Potongan Anak PTK','MTA','UANG DAFTAR ULANG MTA','^MTA (2|3|5|6)$','persen',100::numeric,false,false,'Daftar ulang MTA reguler Rp500.000 gratis untuk anak PTK. MTA 4 memakai kebijakan khusus terpisah.'),
    ('kakak_2_spp_tk','Kakak-adik anak ke-2 · SPP TK','Potongan Anak ke-2','TK','SPP TK',NULL,'nominal',50000::numeric,true,false,'Potongan kakak/adik anak ke-2; nilai dapat berubah lewat versi kebijakan baru.'),
    ('kakak_2_spp_sd','Kakak-adik anak ke-2 · SPP SD','Potongan Anak ke-2','SD','SPP SD',NULL,'nominal',50000::numeric,true,false,'Potongan kakak/adik anak ke-2; nilai dapat berubah lewat versi kebijakan baru.'),
    ('kakak_2_spp_smp','Kakak-adik anak ke-2 · SPP SMP','Potongan Anak ke-2','SMP','SPP SMP',NULL,'nominal',50000::numeric,true,false,'Potongan kakak/adik anak ke-2; nilai dapat berubah lewat versi kebijakan baru.'),
    ('kakak_2_spp_sma','Kakak-adik anak ke-2 · SPP SMA','Potongan Anak ke-2','SMA','SPP SMA',NULL,'nominal',50000::numeric,true,false,'Potongan kakak/adik anak ke-2; nilai dapat berubah lewat versi kebijakan baru.'),
    ('kakak_2_spp_mta','Kakak-adik anak ke-2 · SPP MTA','Potongan Anak ke-2','MTA','SPP MTA',NULL,'nominal',50000::numeric,true,false,'Potongan kakak/adik anak ke-2; nilai dapat berubah lewat versi kebijakan baru.'),
    ('kakak_3_spp_tk','Kakak-adik anak ke-3+ · SPP TK','Potongan Anak ke-3 dst','TK','SPP TK',NULL,'nominal',50000::numeric,true,false,'Potongan kakak/adik anak ke-3 dan seterusnya; nilai dapat berubah lewat versi kebijakan baru.'),
    ('kakak_3_spp_sd','Kakak-adik anak ke-3+ · SPP SD','Potongan Anak ke-3 dst','SD','SPP SD',NULL,'nominal',50000::numeric,true,false,'Potongan kakak/adik anak ke-3 dan seterusnya; nilai dapat berubah lewat versi kebijakan baru.'),
    ('kakak_3_spp_smp','Kakak-adik anak ke-3+ · SPP SMP','Potongan Anak ke-3 dst','SMP','SPP SMP',NULL,'nominal',50000::numeric,true,false,'Potongan kakak/adik anak ke-3 dan seterusnya; nilai dapat berubah lewat versi kebijakan baru.'),
    ('kakak_3_spp_sma','Kakak-adik anak ke-3+ · SPP SMA','Potongan Anak ke-3 dst','SMA','SPP SMA',NULL,'nominal',50000::numeric,true,false,'Potongan kakak/adik anak ke-3 dan seterusnya; nilai dapat berubah lewat versi kebijakan baru.'),
    ('kakak_3_spp_mta','Kakak-adik anak ke-3+ · SPP MTA','Potongan Anak ke-3 dst','MTA','SPP MTA',NULL,'nominal',50000::numeric,true,false,'Potongan kakak/adik anak ke-3 dan seterusnya; nilai dapat berubah lewat versi kebijakan baru.')
)
INSERT INTO public.kebijakan_keringanan(
  kode,versi,nama,skema_diskon_id,jenis_id,kelas_regex,
  tipe,nilai,otomatis,perlu_pengajuan,berlaku_mulai,berlaku_selesai,
  aktif,keterangan
)
SELECT
  cfg.kode,1,cfg.nama,sk.id,jp.id,cfg.kelas_regex,
  cfg.tipe,cfg.nilai,cfg.otomatis,cfg.perlu_pengajuan,
  date '2026-07-01',NULL,true,cfg.keterangan
FROM cfg
JOIN public.skema_diskon sk ON sk.nama=cfg.skema_nama
JOIN public.departemen d ON upper(btrim(d.kode))=cfg.dept_kode
JOIN public.jenis_pembayaran jp
  ON jp.departemen_id=d.id AND upper(btrim(jp.nama))=upper(cfg.jenis_nama)
WHERE NOT EXISTS (
  SELECT 1 FROM public.kebijakan_keringanan kk
  WHERE kk.kode=cfg.kode
);

-- Kakak-adik now uses the versioned policy amount instead of a hard-coded Rp50k.
CREATE OR REPLACE FUNCTION public.sinkronkan_diskon_kakak_adik_bulanan(
  p_tanggal date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_mulai date := date_trunc('month',p_tanggal)::date;
  v_selesai date := (date_trunc('month',p_tanggal)+interval '1 month - 1 day')::date;
  v_row record;
  v_skema_id uuid;
  v_policy public.kebijakan_keringanan;
  v_diskon_id uuid;
  v_created integer := 0;
  v_skipped integer := 0;
  v_applied integer := 0;
BEGIN
  FOR v_row IN
    WITH anggota AS (
      SELECT
        s.id AS siswa_id,
        s.keluarga_id,
        s.tanggal_lahir,
        row_number() OVER (
          PARTITION BY s.keluarga_id
          ORDER BY s.tanggal_lahir ASC NULLS LAST,s.id
        ) AS urutan,
        count(*) OVER (PARTITION BY s.keluarga_id) AS jumlah,
        count(s.tanggal_lahir) OVER (PARTITION BY s.keluarga_id) AS jumlah_lahir
      FROM public.siswa s
      WHERE s.status='aktif' AND s.keluarga_id IS NOT NULL
    )
    SELECT a.siswa_id,a.keluarga_id,a.urutan,r.jenis_id
    FROM anggota a
    JOIN public.rencana_tagihan_siswa r
      ON r.siswa_id=a.siswa_id
     AND r.aktif=true
     AND v_mulai BETWEEN date_trunc('month',r.mulai)::date
                     AND date_trunc('month',r.selesai)::date
    WHERE a.jumlah>=2
      AND a.jumlah_lahir=a.jumlah
      AND a.urutan>=2
    ORDER BY a.keluarga_id,a.urutan,r.jenis_id
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.siswa_diskon sd
      WHERE sd.siswa_id=v_row.siswa_id
        AND sd.jenis_id=v_row.jenis_id
        AND sd.status IN ('diajukan','disetujui')
        AND daterange(sd.periode_mulai,sd.periode_selesai,'[]')
            && daterange(v_mulai,v_selesai,'[]')
    ) THEN
      v_skipped := v_skipped+1;
      CONTINUE;
    END IF;

    SELECT sk.id INTO v_skema_id
    FROM public.skema_diskon sk
    WHERE sk.aktif=true
      AND sk.kategori='kakak_adik'
      AND sk.nama=CASE WHEN v_row.urutan=2
                       THEN 'Potongan Anak ke-2'
                       ELSE 'Potongan Anak ke-3 dst' END
    LIMIT 1;

    IF v_skema_id IS NULL THEN
      v_skipped := v_skipped+1;
      CONTINUE;
    END IF;

    SELECT kk.* INTO v_policy
    FROM public.kebijakan_keringanan kk
    WHERE kk.aktif=true
      AND kk.skema_diskon_id=v_skema_id
      AND kk.jenis_id=v_row.jenis_id
      AND kk.berlaku_mulai<=p_tanggal
      AND (kk.berlaku_selesai IS NULL OR kk.berlaku_selesai>=p_tanggal)
      AND kk.otomatis=true
    ORDER BY kk.berlaku_mulai DESC,kk.versi DESC
    LIMIT 1;

    IF v_policy.id IS NULL THEN
      v_skipped := v_skipped+1;
      CONTINUE;
    END IF;

    INSERT INTO public.siswa_diskon(
      siswa_id,skema_diskon_id,jenis_id,kebijakan_keringanan_id,
      periode_mulai,periode_selesai,nilai,
      status,catatan,diputuskan_at,diterapkan_at
    )
    VALUES(
      v_row.siswa_id,v_skema_id,v_row.jenis_id,v_policy.id,
      v_mulai,v_selesai,v_policy.nilai,
      'disetujui',
      'Potongan kakak/adik otomatis mengikuti kebijakan '
        || v_policy.kode || ' v' || v_policy.versi::text
        || '; tidak ditumpuk dengan potongan lain.',
      now(),now()
    )
    RETURNING id INTO v_diskon_id;

    v_created := v_created+1;

    IF EXISTS (
      SELECT 1 FROM public.tagihan t
      WHERE t.siswa_id=v_row.siswa_id
        AND t.jenis_id=v_row.jenis_id
        AND t.status IN ('terjadwal','belum_bayar')
        AND public.hitung_bulan_periode_tagihan(t.tahun_ajaran_id,t.bulan)
            BETWEEN v_mulai AND v_selesai
    ) THEN
      PERFORM public.terapkan_diskon_siswa(v_diskon_id,NULL);
      v_applied := v_applied+1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'periode_mulai',v_mulai,
    'periode_selesai',v_selesai,
    'dibuat',v_created,
    'dilewati_karena_diskon_lain',v_skipped,
    'diterapkan_ke_tagihan_existing',v_applied
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.sinkronkan_diskon_kakak_adik_bulanan(date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sinkronkan_diskon_kakak_adik_bulanan(date)
  TO service_role;