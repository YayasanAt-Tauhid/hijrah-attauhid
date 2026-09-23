-- Link a public SPMB submission to an existing active student instead of
-- creating a duplicate siswa row when NISN/NIK already belongs to that student.
-- Also give SPMB its own registration timestamp so internal students keep their
-- original siswa.created_at and current academic placement.

ALTER TABLE public.siswa_detail
  ADD COLUMN IF NOT EXISTS spmb_registered_at timestamptz;

COMMENT ON COLUMN public.siswa_detail.spmb_registered_at IS
  'Waktu pendaftaran SPMB untuk record saat ini. Terpisah dari siswa.created_at agar pendaftaran siswa internal memakai waktu pendaftaran yang benar.';

UPDATE public.siswa_detail d
SET spmb_registered_at = s.created_at
FROM public.siswa s
WHERE s.id = d.siswa_id
  AND d.spmb_registered_at IS NULL
  AND (d.spmb_gelombang_id IS NOT NULL OR d.pmb_payment_token IS NOT NULL);

CREATE INDEX IF NOT EXISTS siswa_detail_spmb_registered_at_idx
  ON public.siswa_detail (spmb_registered_at DESC)
  WHERE spmb_gelombang_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_spmb_public_registration_policy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  s public.siswa;
  dep public.departemen;
  current_wave public.spmb_gelombang;
  target_year uuid;
  target_dept uuid;
  target_cohort uuid;
  registration_cohort uuid;
  normalized_nik text;
  normalized_nisn text;
  normalized_nik_ayah text;
  normalized_nik_ibu text;
  current_at timestamptz := clock_timestamp();
BEGIN
  IF NEW.pmb_payment_token IS NULL THEN RETURN NEW; END IF;

  SELECT g.* INTO current_wave
  FROM public.spmb_gelombang g
  WHERE g.aktif
    AND current_at >= g.tanggal_mulai
    AND (g.tanggal_selesai IS NULL OR current_at < g.tanggal_selesai)
  ORDER BY g.urutan, g.tanggal_mulai
  LIMIT 1;
  IF current_wave.id IS NULL THEN
    RAISE EXCEPTION 'Pendaftaran SPMB sedang ditutup. Silakan lihat jadwal gelombang berikutnya';
  END IF;

  SELECT * INTO s FROM public.siswa WHERE id = NEW.siswa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Data calon murid tidak ditemukan'; END IF;

  target_dept := COALESCE(NEW.spmb_departemen_tujuan_id, s.departemen_id);
  SELECT * INTO dep FROM public.departemen WHERE id = target_dept;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lembaga tujuan calon murid tidak ditemukan'; END IF;

  SELECT id INTO target_year
  FROM public.tahun_ajaran
  WHERE nama = 'Tahun Ajaran 2027/2028'
  ORDER BY tanggal_mulai DESC NULLS LAST, id
  LIMIT 1;
  IF target_year IS NULL THEN RAISE EXCEPTION 'Konfigurasi Tahun Ajaran 2027-2028 belum tersedia'; END IF;

  SELECT id INTO target_cohort
  FROM public.angkatan
  WHERE departemen_id = target_dept
    AND nama = '2027'
    AND aktif = true
  ORDER BY id
  LIMIT 1;
  IF target_cohort IS NULL THEN RAISE EXCEPTION 'Konfigurasi Angkatan 2027 untuk lembaga yang dipilih belum tersedia'; END IF;

  registration_cohort := COALESCE(NEW.spmb_angkatan_tujuan_id, s.angkatan_id);
  IF NEW.tahun_ajaran_id IS DISTINCT FROM target_year THEN
    RAISE EXCEPTION 'Pendaftaran SPMB saat ini hanya untuk Tahun Ajaran 2027-2028';
  END IF;
  IF registration_cohort IS DISTINCT FROM target_cohort THEN
    RAISE EXCEPTION 'Angkatan tujuan calon murid harus Angkatan 2027 sesuai lembaga';
  END IF;

  IF COALESCE(NEW.kategori, '') NOT IN ('MURID BARU','MURID PINDAHAN') THEN
    RAISE EXCEPTION 'Kategori harus Murid Baru atau Siswa Pindahan';
  END IF;
  IF NEW.kategori = 'MURID PINDAHAN' THEN
    NEW.jenis_pendaftaran := 'pindahan';
  ELSE
    NEW.kategori := 'MURID BARU';
    NEW.jenis_pendaftaran := 'baru';
  END IF;

  normalized_nik := regexp_replace(COALESCE(NEW.nik, ''), '[^0-9]', '', 'g');
  IF length(normalized_nik) <> 16 THEN RAISE EXCEPTION 'NIK Calon Murid harus terdiri dari 16 digit'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.siswa_detail d
    WHERE d.siswa_id <> NEW.siswa_id
      AND length(regexp_replace(COALESCE(d.nik, ''), '[^0-9]', '', 'g')) = 16
      AND regexp_replace(d.nik, '[^0-9]', '', 'g') = normalized_nik
  ) THEN
    RAISE EXCEPTION 'NIK Calon Murid sudah terdaftar pada data siswa lain';
  END IF;
  NEW.nik := normalized_nik;

  IF NULLIF(trim(COALESCE(s.alamat,'')), '') IS NULL THEN RAISE EXCEPTION 'Alamat rumah wajib diisi'; END IF;
  IF NULLIF(trim(COALESCE(s.telepon,'')), '') IS NULL THEN RAISE EXCEPTION 'No. HP/WhatsApp yang bisa dihubungi wajib diisi'; END IF;

  IF upper(trim(COALESCE(dep.kode,''))) IN ('SMP','SMA','MTA')
     OR upper(COALESCE(dep.nama,'')) ~ '(^|\s)(SMP|SMA|MTA)(\s|$)' THEN
    normalized_nisn := regexp_replace(COALESCE(s.nisn,''), '[^0-9]', '', 'g');
    IF length(normalized_nisn) <> 10 THEN RAISE EXCEPTION 'NISN wajib diisi 10 digit untuk SMP, SMA, dan MTA'; END IF;
    UPDATE public.siswa SET nisn = normalized_nisn WHERE id = s.id;
  END IF;

  normalized_nik_ayah := regexp_replace(COALESCE(NEW.nik_ayah,''), '[^0-9]', '', 'g');
  normalized_nik_ibu := regexp_replace(COALESCE(NEW.nik_ibu,''), '[^0-9]', '', 'g');
  IF NULLIF(trim(COALESCE(NEW.nama_ayah,'')), '') IS NULL
     OR length(normalized_nik_ayah) <> 16
     OR NULLIF(trim(COALESCE(NEW.tempat_lahir_ayah,'')), '') IS NULL
     OR NEW.tanggal_lahir_ayah IS NULL
     OR NULLIF(trim(COALESCE(NEW.pendidikan_ayah,'')), '') IS NULL
     OR NULLIF(trim(COALESCE(NEW.pekerjaan_ayah,'')), '') IS NULL
     OR NEW.penghasilan_ayah IS NULL
     OR NULLIF(trim(COALESCE(NEW.telepon_ayah,'')), '') IS NULL
     OR NULLIF(trim(COALESCE(NEW.alamat_ayah,'')), '') IS NULL THEN
    RAISE EXCEPTION 'Data Ayah wajib diisi lengkap';
  END IF;
  IF NULLIF(trim(COALESCE(NEW.nama_ibu,'')), '') IS NULL
     OR length(normalized_nik_ibu) <> 16
     OR NULLIF(trim(COALESCE(NEW.tempat_lahir_ibu,'')), '') IS NULL
     OR NEW.tanggal_lahir_ibu IS NULL
     OR NULLIF(trim(COALESCE(NEW.pendidikan_ibu,'')), '') IS NULL
     OR NULLIF(trim(COALESCE(NEW.pekerjaan_ibu,'')), '') IS NULL
     OR NEW.penghasilan_ibu IS NULL
     OR NULLIF(trim(COALESCE(NEW.telepon_ibu,'')), '') IS NULL
     OR NULLIF(trim(COALESCE(NEW.alamat_ibu,'')), '') IS NULL THEN
    RAISE EXCEPTION 'Data Ibu wajib diisi lengkap';
  END IF;
  NEW.nik_ayah := normalized_nik_ayah;
  NEW.nik_ibu := normalized_nik_ibu;

  IF NEW.kategori = 'MURID PINDAHAN' THEN
    IF NULLIF(trim(COALESCE(NEW.dokumen_rapor_path,'')), '') IS NULL
       OR NULLIF(trim(COALESCE(NEW.dokumen_ijazah_path,'')), '') IS NULL THEN
      RAISE EXCEPTION 'Rapor dan Ijazah/SKHUN wajib untuk Siswa Pindahan';
    END IF;
  ELSE
    NEW.dokumen_rapor_path := NULL;
    NEW.dokumen_ijazah_path := NULL;
  END IF;

  IF upper(trim(COALESCE(dep.kode,''))) = 'MTA'
     OR upper(COALESCE(dep.nama,'')) ~ '(^|\s)MTA(\s|$)' THEN
    IF COALESCE(NEW.jenis_pendaftaran,'baru') <> 'alumni_internal' THEN NEW.status_asrama := 'asrama'; END IF;
  ELSIF upper(trim(COALESCE(dep.kode,''))) IN ('SMP','SMA')
     OR upper(COALESCE(dep.nama,'')) ~ '(^|\s)(SMP|SMA)(\s|$)' THEN
    IF COALESCE(NEW.status_asrama,'') NOT IN ('asrama','non_asrama') THEN
      RAISE EXCEPTION 'Pilihan Asrama / Non Asrama wajib dipilih';
    END IF;
  ELSE
    NEW.status_asrama := NULL;
  END IF;

  NEW.tinggi_badan_cm := NULL;
  NEW.berat_badan_kg := NULL;
  NEW.lingkar_kepala_cm := NULL;
  NEW.ukuran_baju := NULL;
  NEW.spmb_departemen_tujuan_id := target_dept;
  NEW.spmb_angkatan_tujuan_id := target_cohort;
  NEW.spmb_gelombang_id := current_wave.id;

  IF TG_OP = 'INSERT' THEN
    NEW.spmb_registered_at := COALESCE(NEW.spmb_registered_at, current_at);
    NEW.spmb_status_pendaftaran := COALESCE(NEW.spmb_status_pendaftaran, 'calon');
  ELSIF NEW.pmb_payment_token IS DISTINCT FROM OLD.pmb_payment_token THEN
    NEW.spmb_registered_at := current_at;
    NEW.spmb_status_pendaftaran := 'calon';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS guard_spmb_public_registration_policy ON public.siswa_detail;
CREATE TRIGGER guard_spmb_public_registration_policy
BEFORE INSERT OR UPDATE OF pmb_payment_token ON public.siswa_detail
FOR EACH ROW EXECUTE FUNCTION public.guard_spmb_public_registration_policy();

CREATE OR REPLACE FUNCTION public.spmb_apply_first_wave_promo(p_siswa_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  s public.siswa;
  d public.siswa_detail;
  v_jenis_id uuid;
  v_jenis_nama text;
  v_nominal_default numeric;
  v_bruto numeric;
  v_book public.tahun_buku;
  v_skema_id uuid;
  v_diskon_id uuid;
  v_tagihan public.tagihan;
  v_existing_tagihan_id uuid;
  v_errors text[];
  v_target_dept uuid;
  v_target_cohort uuid;
  v_registered_at timestamptz;
  v_internal boolean := false;
BEGIN
  SELECT * INTO s FROM public.siswa WHERE id = p_siswa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Calon murid SPMB tidak ditemukan'; END IF;

  SELECT * INTO d FROM public.siswa_detail WHERE siswa_id = s.id;
  v_internal := COALESCE(d.spmb_siswa_internal, false);
  v_target_dept := COALESCE(d.spmb_departemen_tujuan_id, s.departemen_id);
  v_target_cohort := COALESCE(d.spmb_angkatan_tujuan_id, s.angkatan_id);
  v_registered_at := COALESCE(d.spmb_registered_at, s.created_at, clock_timestamp());

  IF d.siswa_id IS NULL
     OR (s.status <> 'calon' AND NOT v_internal)
     OR COALESCE(d.kategori, '') NOT IN ('MURID BARU','MURID PINDAHAN')
     OR COALESCE(d.jenis_pendaftaran, 'baru') NOT IN ('baru','pindahan')
     OR NOT EXISTS (
       SELECT 1 FROM public.tahun_ajaran ta
       WHERE ta.id = d.tahun_ajaran_id
         AND ta.nama = 'Tahun Ajaran 2027/2028'
     )
  THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'bukan_spmb_target');
  END IF;

  IF NOT COALESCE(
    (SELECT g.gratis_pendaftaran FROM public.spmb_gelombang g WHERE g.id = d.spmb_gelombang_id LIMIT 1),
    public.spmb_is_first_wave_free(v_registered_at)
  ) THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'di_luar_periode_promo');
  END IF;

  SELECT kp.jenis_pembayaran_id, jp.nama, jp.nominal
  INTO v_jenis_id, v_jenis_nama, v_nominal_default
  FROM public.konfigurasi_pmb kp
  JOIN public.jenis_pembayaran jp ON jp.id = kp.jenis_pembayaran_id
  WHERE kp.departemen_id = v_target_dept
    AND jp.aktif = true
  LIMIT 1;
  IF v_jenis_id IS NULL THEN RAISE EXCEPTION 'Konfigurasi biaya pendaftaran SPMB belum tersedia untuk lembaga calon murid'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.pembayaran p
    WHERE p.siswa_id = s.id
      AND p.jenis_id = v_jenis_id
      AND p.jurnal_id IS NOT NULL
      AND p.tanggal_bayar >= v_registered_at::date
  ) THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'sudah_ada_pembayaran');
  END IF;

  SELECT * INTO v_book
  FROM public.tahun_buku tb
  WHERE v_registered_at::date BETWEEN tb.tanggal_mulai AND tb.tanggal_selesai
  ORDER BY tb.tanggal_mulai DESC, tb.id
  LIMIT 1;
  IF v_book.id IS NULL THEN RAISE EXCEPTION 'Tahun buku untuk tanggal pendaftaran SPMB belum dikonfigurasi'; END IF;
  IF COALESCE(v_book.ditutup, false) THEN RAISE EXCEPTION 'Tahun buku % sudah ditutup; promo SPMB tidak dapat dibukukan otomatis', v_book.nama; END IF;

  v_bruto := COALESCE(
    public.get_tarif_siswa(v_jenis_id, s.id, NULL, v_book.id, v_target_cohort),
    v_nominal_default,
    0
  );
  IF v_bruto <= 0 THEN RAISE EXCEPTION 'Tarif biaya pendaftaran SPMB belum dikonfigurasi untuk calon murid'; END IF;

  SELECT g.skema_diskon_id INTO v_skema_id
  FROM public.spmb_gelombang g
  JOIN public.skema_diskon sk ON sk.id = g.skema_diskon_id
  WHERE g.id = d.spmb_gelombang_id
    AND g.gratis_pendaftaran = true
    AND sk.aktif = true
  LIMIT 1;
  IF v_skema_id IS NULL THEN RAISE EXCEPTION 'Skema promo gratis untuk gelombang SPMB belum tersedia'; END IF;

  SELECT sd.id INTO v_diskon_id
  FROM public.siswa_diskon sd
  WHERE sd.siswa_id = s.id
    AND sd.jenis_id = v_jenis_id
    AND sd.skema_diskon_id = v_skema_id
    AND sd.status = 'disetujui'
  ORDER BY sd.diputuskan_at DESC NULLS LAST, sd.diajukan_at DESC
  LIMIT 1;

  IF v_diskon_id IS NULL THEN
    INSERT INTO public.siswa_diskon (
      siswa_id, skema_diskon_id, jenis_id,
      periode_mulai, periode_selesai, nilai,
      status, catatan, diajukan_at, diputuskan_at
    )
    VALUES (
      s.id, v_skema_id, v_jenis_id,
      v_book.tanggal_mulai, v_book.tanggal_selesai, 100,
      'disetujui',
      'Otomatis: Promo gratis biaya pendaftaran SPMB berdasarkan gelombang pendaftaran.',
      v_registered_at, v_registered_at
    )
    RETURNING id INTO v_diskon_id;
  END IF;

  SELECT t.id INTO v_existing_tagihan_id
  FROM public.tagihan t
  WHERE t.siswa_id = s.id
    AND t.jenis_id = v_jenis_id
    AND t.tahun_ajaran_id = v_book.id
    AND t.bulan IS NULL
  LIMIT 1;

  IF v_existing_tagihan_id IS NULL THEN
    SELECT g.errors INTO v_errors
    FROM public.generate_tagihan_batch(
      v_jenis_id,
      v_book.id,
      NULL,
      v_target_dept,
      jsonb_build_array(jsonb_build_object('siswa_id', s.id, 'kelas_id', NULL)),
      auth.uid()
    ) g;
    IF COALESCE(array_length(v_errors, 1), 0) > 0 THEN
      RAISE EXCEPTION 'Gagal membukukan promo SPMB: %', array_to_string(v_errors, '; ');
    END IF;
  ELSE
    PERFORM public.terapkan_diskon_siswa(v_diskon_id, auth.uid());
  END IF;

  SELECT * INTO v_tagihan
  FROM public.tagihan t
  WHERE t.siswa_id = s.id
    AND t.jenis_id = v_jenis_id
    AND t.tahun_ajaran_id = v_book.id
    AND t.bulan IS NULL
  LIMIT 1;
  IF v_tagihan.id IS NULL THEN RAISE EXCEPTION 'Tagihan promo SPMB gagal terbentuk'; END IF;

  IF COALESCE(v_tagihan.nominal, 0) = 0 THEN
    UPDATE public.tagihan
    SET status = 'lunas'
    WHERE id = v_tagihan.id
      AND status IN ('terjadwal', 'belum_bayar')
      AND pembayaran_id IS NULL;
  ELSE
    RAISE EXCEPTION 'Promo SPMB 100%% tidak menghasilkan tagihan netto Rp0';
  END IF;

  UPDATE public.siswa_diskon
  SET diterapkan_at = COALESCE(diterapkan_at, clock_timestamp())
  WHERE id = v_diskon_id;

  SELECT * INTO v_tagihan FROM public.tagihan WHERE id = v_tagihan.id;
  RETURN jsonb_build_object(
    'applied', true,
    'siswa_id', s.id,
    'jenis_id', v_jenis_id,
    'jenis_nama', v_jenis_nama,
    'tahun_buku_id', v_book.id,
    'tahun_buku_nama', v_book.nama,
    'tagihan_id', v_tagihan.id,
    'jurnal_id', v_tagihan.jurnal_piutang_id,
    'nominal_bruto', COALESCE(v_tagihan.nominal_bruto, v_bruto),
    'nominal_diskon', COALESCE(v_tagihan.nominal_diskon, v_bruto),
    'nominal_netto', v_tagihan.nominal,
    'status', v_tagihan.status,
    'siswa_diskon_id', v_diskon_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.spmb_apply_first_wave_promo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spmb_apply_first_wave_promo(uuid) TO service_role;

DROP TRIGGER IF EXISTS spmb_apply_first_wave_promo_after_detail ON public.siswa_detail;
CREATE TRIGGER spmb_apply_first_wave_promo_after_detail
AFTER INSERT OR UPDATE OF pmb_payment_token ON public.siswa_detail
FOR EACH ROW EXECUTE FUNCTION public.trg_spmb_apply_first_wave_promo();

CREATE OR REPLACE FUNCTION public.spmb_readiness(p_siswa_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path=public
AS $function$
DECLARE
 s public.siswa; d public.siswa_detail; dep public.departemen; target_dept uuid; target_cohort uuid;
 jenis uuid; nominal numeric; paid numeric; paid_date date; missing text[]:='{}'; has_class boolean;
 promo_free boolean; finance jsonb; internal_student boolean:=false;
BEGIN
 SELECT * INTO s FROM public.siswa WHERE id=p_siswa_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Siswa tidak ditemukan atau akses ditolak'; END IF;
 SELECT * INTO d FROM public.siswa_detail WHERE siswa_id=s.id;
 target_dept:=COALESCE(d.spmb_departemen_tujuan_id,s.departemen_id);
 target_cohort:=COALESCE(d.spmb_angkatan_tujuan_id,s.angkatan_id);
 internal_student:=COALESCE(d.spmb_siswa_internal,false);
 SELECT * INTO dep FROM public.departemen WHERE id=target_dept;
 SELECT jenis_pembayaran_id INTO jenis FROM public.konfigurasi_pmb WHERE departemen_id=target_dept;

 IF jenis IS NOT NULL THEN
   SELECT COALESCE(CASE WHEN internal_student THEN j.nominal ELSE public.get_tarif_siswa(jenis,s.id,NULL,NULL) END,j.nominal)
   INTO nominal FROM public.jenis_pembayaran j WHERE j.id=jenis;
   finance:=public.spmb_finance_status(s.id,jenis,COALESCE(d.spmb_registered_at,s.created_at));
   paid:=COALESCE((finance->>'dibayar')::numeric,0); paid_date:=(finance->>'tanggal_pembayaran')::date;
   promo_free:=COALESCE((finance->>'gratis_pendaftaran')::boolean,false);
 ELSE nominal:=NULL; paid:=0; paid_date:=NULL; promo_free:=false; END IF;

 IF internal_student THEN has_class:=true;
 ELSE SELECT EXISTS(SELECT 1 FROM public.kelas_siswa ks JOIN public.kelas k ON k.id=ks.kelas_id
   WHERE ks.siswa_id=s.id AND ks.aktif AND ks.tahun_ajaran_id IS NOT NULL AND k.departemen_id=target_dept) INTO has_class;
 END IF;

 IF NOT COALESCE(s.terverifikasi,false) THEN missing:=array_append(missing,'verifikasi data'); END IF;
 IF NOT promo_free THEN
   IF jenis IS NULL THEN missing:=array_append(missing,'konfigurasi pembayaran SPMB');
   ELSIF nominal IS NULL OR nominal<=0 THEN missing:=array_append(missing,'nominal pembayaran SPMB');
   ELSIF paid<nominal THEN missing:=array_append(missing,'pelunasan pembayaran SPMB'); END IF;
 END IF;
 IF target_dept IS NULL THEN missing:=array_append(missing,'lembaga tujuan'); END IF;
 IF target_cohort IS NULL OR NOT EXISTS(SELECT 1 FROM public.angkatan WHERE id=target_cohort AND departemen_id=target_dept) THEN missing:=array_append(missing,'angkatan tujuan sesuai lembaga'); END IF;
 IF NOT has_class THEN missing:=array_append(missing,'kelas dan tahun ajaran sesuai lembaga'); END IF;
 IF COALESCE(d.spmb_status_kelulusan,'')<>'lulus' THEN missing:=array_append(missing,'status kelulusan: Lulus'); END IF;
 IF dep.id IS NULL OR NULLIF(trim(dep.npsn),'') IS NULL THEN missing:=array_append(missing,'NPSN lembaga'); END IF;
 IF NULLIF(d.dokumen_kk_path,'') IS NULL THEN missing:=array_append(missing,'Kartu Keluarga'); END IF;
 IF NULLIF(d.dokumen_akta_path,'') IS NULL THEN missing:=array_append(missing,'Akta Kelahiran'); END IF;
 IF dep.id IS NOT NULL AND (upper(trim(COALESCE(dep.kode,''))) IN ('SMP','SMA','MTA') OR upper(COALESCE(dep.nama,'')) ~ '(^|\s)(SMP|SMA|MTA)(\s|$)') AND d.status_asrama IS NULL THEN missing:=array_append(missing,'pilihan asrama'); END IF;

 RETURN jsonb_build_object(
   'siap',cardinality(missing)=0,'kekurangan',to_jsonb(missing),'configured',jenis IS NOT NULL,
   'lunas',promo_free OR COALESCE(nominal>0 AND paid>=nominal,false),'gratis_pendaftaran',promo_free AND COALESCE(paid,0)=0,
   'tanggal_pembayaran',paid_date,'nominal',nominal,'dibayar',COALESCE(paid,0),'punya_kelas',has_class,
   'siswa_internal',internal_student,'departemen_tujuan_id',target_dept,'angkatan_tujuan_id',target_cohort
 );
END;
$function$;

REVOKE ALL ON FUNCTION public.spmb_readiness(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.spmb_readiness(uuid) TO authenticated,service_role;
