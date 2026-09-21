ALTER TABLE public.siswa_detail
  ADD COLUMN IF NOT EXISTS spmb_kelas_tujuan_id uuid REFERENCES public.kelas(id),
  ADD COLUMN IF NOT EXISTS spmb_tanggal_aktivasi timestamptz;

COMMENT ON COLUMN public.siswa_detail.spmb_kelas_tujuan_id IS
  'Kelas tujuan final ketika siswa internal selesai SPMB dan berpindah jenjang.';
COMMENT ON COLUMN public.siswa_detail.spmb_tanggal_aktivasi IS
  'Waktu perpindahan akademik siswa internal ke lembaga/kelas tujuan SPMB diselesaikan.';

CREATE OR REPLACE FUNCTION public.spmb_activate_internal_student(
  p_siswa_id uuid,
  p_kelas_id uuid,
  p_tahun_ajaran_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  s public.siswa;
  d public.siswa_detail;
  target_dept uuid;
  target_cohort uuid;
  target_class public.kelas;
  target_year public.tahun_ajaran;
  target_dept_row public.departemen;
  target_cohort_row public.angkatan;
  old_class_id uuid;
  old_year_id uuid;
  active_class_count integer;
  npsn_digits text;
  npsn4 text;
  year4 text;
  year2 text;
  last_char text;
  rombel_code integer;
  next_seq integer;
  new_nis text;
  old_nis text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Anda harus masuk terlebih dahulu';
  END IF;

  SELECT * INTO s FROM public.siswa WHERE id=p_siswa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Siswa tidak ditemukan'; END IF;

  SELECT * INTO d FROM public.siswa_detail WHERE siswa_id=p_siswa_id FOR UPDATE;
  IF NOT FOUND OR NOT COALESCE(d.spmb_siswa_internal,false) THEN
    RAISE EXCEPTION 'Pendaftaran SPMB siswa internal tidak ditemukan';
  END IF;

  target_dept := d.spmb_departemen_tujuan_id;
  target_cohort := d.spmb_angkatan_tujuan_id;
  IF target_dept IS NULL OR target_cohort IS NULL THEN
    RAISE EXCEPTION 'Lembaga/angkatan tujuan SPMB belum lengkap';
  END IF;

  IF NOT (
    public.has_role(uid,'admin')
    OR (
      public.has_role(uid,'admin_tu')
      AND public.can_manage_akademik_departemen(uid,target_dept)
    )
  ) THEN
    RAISE EXCEPTION 'Akses aktivasi jenjang tujuan ditolak';
  END IF;

  IF s.status <> 'aktif' THEN
    RAISE EXCEPTION 'Siswa internal harus masih berstatus aktif pada lembaga asal';
  END IF;
  IF COALESCE(d.spmb_status_pendaftaran,'') <> 'diterima' THEN
    RAISE EXCEPTION 'Pendaftaran SPMB harus berstatus diterima terlebih dahulu';
  END IF;
  IF COALESCE(d.spmb_status_kelulusan,'') <> 'lulus' OR d.spmb_tanggal_lulus IS NULL THEN
    RAISE EXCEPTION 'Siswa harus dinyatakan lulus terlebih dahulu';
  END IF;
  IF d.spmb_tanggal_daftar_ulang IS NULL THEN
    RAISE EXCEPTION 'Daftar ulang harus diselesaikan terlebih dahulu';
  END IF;
  IF d.spmb_tanggal_aktivasi IS NOT NULL OR d.spmb_status_pendaftaran='selesai' THEN
    RAISE EXCEPTION 'Perpindahan ke jenjang tujuan sudah pernah diselesaikan';
  END IF;

  SELECT * INTO target_class FROM public.kelas WHERE id=p_kelas_id;
  IF NOT FOUND OR target_class.departemen_id IS DISTINCT FROM target_dept OR NOT COALESCE(target_class.aktif,true) THEN
    RAISE EXCEPTION 'Kelas tujuan tidak sesuai lembaga tujuan SPMB';
  END IF;

  SELECT * INTO target_year FROM public.tahun_ajaran WHERE id=p_tahun_ajaran_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tahun ajaran tujuan tidak ditemukan'; END IF;
  IF d.tahun_ajaran_id IS DISTINCT FROM p_tahun_ajaran_id THEN
    RAISE EXCEPTION 'Tahun ajaran aktivasi harus sama dengan periode SPMB';
  END IF;
  IF COALESCE(target_year.ditutup,false) THEN
    RAISE EXCEPTION 'Tahun ajaran tujuan sudah ditutup';
  END IF;
  IF target_year.tanggal_mulai IS NOT NULL AND current_date < target_year.tanggal_mulai THEN
    RAISE EXCEPTION 'Aktivasi ke jenjang tujuan baru dapat dilakukan mulai %',
      to_char(target_year.tanggal_mulai,'DD-MM-YYYY');
  END IF;

  SELECT * INTO target_dept_row FROM public.departemen WHERE id=target_dept;
  IF NOT FOUND OR NOT COALESCE(target_dept_row.aktif,true) THEN
    RAISE EXCEPTION 'Lembaga tujuan tidak aktif';
  END IF;

  SELECT * INTO target_cohort_row FROM public.angkatan
  WHERE id=target_cohort AND departemen_id=target_dept;
  IF NOT FOUND OR NOT COALESCE(target_cohort_row.aktif,true) THEN
    RAISE EXCEPTION 'Angkatan tujuan tidak valid atau tidak aktif';
  END IF;

  SELECT count(*) INTO active_class_count
  FROM public.kelas_siswa
  WHERE siswa_id=p_siswa_id AND aktif;
  IF active_class_count <> 1 THEN
    RAISE EXCEPTION 'Siswa harus memiliki tepat satu kelas aktif sebelum perpindahan jenjang';
  END IF;

  SELECT ks.kelas_id,ks.tahun_ajaran_id
  INTO old_class_id,old_year_id
  FROM public.kelas_siswa ks
  WHERE ks.siswa_id=p_siswa_id AND ks.aktif
  LIMIT 1
  FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1 FROM public.kelas k
    WHERE k.id=old_class_id AND k.departemen_id=s.departemen_id
  ) THEN
    RAISE EXCEPTION 'Kelas aktif saat ini tidak sesuai lembaga asal siswa';
  END IF;

  npsn_digits := regexp_replace(COALESCE(target_dept_row.npsn,''),'[^0-9]','','g');
  IF length(npsn_digits) < 4 THEN
    RAISE EXCEPTION 'NPSN lembaga tujuan belum valid';
  END IF;
  npsn4 := right(npsn_digits,4);

  SELECT (regexp_match(target_cohort_row.nama,'([0-9]{4})'))[1] INTO year4;
  IF year4 IS NULL THEN
    RAISE EXCEPTION 'Nama angkatan tujuan harus mengandung tahun 4 digit';
  END IF;
  year2 := right(year4,2);

  last_char := upper(right(trim(target_class.nama),1));
  IF last_char ~ '^[1-9]$' THEN
    rombel_code := last_char::integer;
  ELSIF last_char ~ '^[A-I]$' THEN
    rombel_code := ascii(last_char)-64;
  ELSE
    RAISE EXCEPTION 'Format nama kelas tujuan tidak valid untuk pembuatan NIS';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(target_dept::text || ':' || target_cohort::text || ':' || p_kelas_id::text)
  );

  SELECT COALESCE(max(substring(x.nis from 5 for 3)::integer),0)+1
  INTO next_seq
  FROM public.siswa x
  WHERE x.nis ~ ('^' || npsn4 || '[0-9]{3}' || rombel_code::text || year2 || '$');

  IF next_seq > 999 THEN
    RAISE EXCEPTION 'Nomor urut NIS untuk kelas tujuan sudah penuh';
  END IF;

  new_nis := npsn4 || lpad(next_seq::text,3,'0') || rombel_code::text || year2;
  IF EXISTS (SELECT 1 FROM public.siswa WHERE nis=new_nis AND id<>p_siswa_id) THEN
    RAISE EXCEPTION 'NIS tujuan bentrok; coba ulangi aktivasi';
  END IF;

  old_nis := s.nis;

  UPDATE public.kelas_siswa
  SET aktif=false
  WHERE siswa_id=p_siswa_id AND aktif;

  INSERT INTO public.kelas_siswa(siswa_id,kelas_id,tahun_ajaran_id,aktif)
  VALUES(p_siswa_id,p_kelas_id,p_tahun_ajaran_id,true)
  ON CONFLICT(siswa_id,kelas_id,tahun_ajaran_id)
  DO UPDATE SET aktif=true;

  UPDATE public.siswa
  SET departemen_id=target_dept,
      angkatan_id=target_cohort,
      nis=new_nis,
      status='aktif'
  WHERE id=p_siswa_id;

  UPDATE public.siswa_detail
  SET spmb_kelas_tujuan_id=p_kelas_id,
      spmb_tanggal_aktivasi=now(),
      spmb_status_pendaftaran='selesai'
  WHERE siswa_id=p_siswa_id;

  RETURN jsonb_build_object(
    'siswa_id',p_siswa_id,
    'status','aktif',
    'departemen_asal_id',s.departemen_id,
    'kelas_asal_id',old_class_id,
    'tahun_ajaran_asal_id',old_year_id,
    'departemen_tujuan_id',target_dept,
    'angkatan_tujuan_id',target_cohort,
    'kelas_tujuan_id',p_kelas_id,
    'tahun_ajaran_tujuan_id',p_tahun_ajaran_id,
    'nis_lama',old_nis,
    'nis_baru',new_nis,
    'spmb_status','selesai'
  );
END
$$;

REVOKE ALL ON FUNCTION public.spmb_activate_internal_student(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.spmb_activate_internal_student(uuid,uuid,uuid) TO authenticated;
