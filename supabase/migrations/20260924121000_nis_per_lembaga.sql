-- NIS per lembaga: YY-KK-NNN
-- TK=01, SD=02, SMP=03, SMA=04, MTA/MTQ=05.
-- siswa.id tetap identitas permanen; siswa.nis menyimpan NIS lembaga aktif,
-- sedangkan riwayat NIS per lembaga disimpan pada siswa_tahun_masuk_departemen.

ALTER TABLE public.siswa_tahun_masuk_departemen
  ADD COLUMN IF NOT EXISTS nis text;

COMMENT ON COLUMN public.siswa_tahun_masuk_departemen.nis IS
  'NIS siswa pada lembaga ini. Format baru YY-KK-NNN; data lama boleh tetap memakai format legacy.';

-- Simpan NIS aktif lama sebagai histori tanpa mengubah NIS siswa yang sudah ada.
UPDATE public.siswa_tahun_masuk_departemen h
SET nis = s.nis,
    updated_at = now()
FROM public.siswa s
WHERE h.siswa_id = s.id
  AND h.departemen_id = s.departemen_id
  AND h.nis IS NULL
  AND NULLIF(BTRIM(s.nis),'') IS NOT NULL;

INSERT INTO public.siswa_tahun_masuk_departemen(
  siswa_id, departemen_id, tahun_masuk, sumber, keterangan, nis
)
SELECT
  s.id,
  s.departemen_id,
  COALESCE(
    (
      SELECT EXTRACT(YEAR FROM ta.tanggal_mulai)::integer
      FROM public.kelas_siswa ks
      JOIN public.kelas k ON k.id = ks.kelas_id
      JOIN public.tahun_ajaran ta ON ta.id = ks.tahun_ajaran_id
      WHERE ks.siswa_id = s.id
        AND k.departemen_id = s.departemen_id
        AND ta.tanggal_mulai IS NOT NULL
      ORDER BY ta.tanggal_mulai ASC
      LIMIT 1
    ),
    (
      SELECT ((regexp_match(a.nama, '([0-9]{4})'))[1])::integer
      FROM public.angkatan a
      WHERE a.id = s.angkatan_id
        AND a.departemen_id = s.departemen_id
      LIMIT 1
    ),
    EXTRACT(YEAR FROM s.created_at)::integer
  ),
  'legacy',
  'Backfill NIS aktif sebelum penerapan format YY-KK-NNN',
  s.nis
FROM public.siswa s
WHERE s.departemen_id IS NOT NULL
  AND NULLIF(BTRIM(s.nis),'') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.siswa_tahun_masuk_departemen h
    WHERE h.siswa_id = s.id
      AND h.departemen_id = s.departemen_id
  )
ON CONFLICT (siswa_id, departemen_id) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS uq_siswa_tahun_masuk_departemen_nis
  ON public.siswa_tahun_masuk_departemen(nis)
  WHERE nis IS NOT NULL;

CREATE OR REPLACE FUNCTION public.nis_kode_lembaga(p_departemen_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kode text;
  v_nama text;
BEGIN
  SELECT upper(BTRIM(COALESCE(kode,''))), upper(BTRIM(COALESCE(nama,'')))
  INTO v_kode, v_nama
  FROM public.departemen
  WHERE id = p_departemen_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lembaga tidak ditemukan';
  END IF;

  IF v_kode = 'TK' OR v_nama ~ '(^|[[:space:]])TK([[:space:]]|$)' THEN RETURN '01'; END IF;
  IF v_kode = 'SD' OR v_nama ~ '(^|[[:space:]])SD([[:space:]]|$)' THEN RETURN '02'; END IF;
  IF v_kode = 'SMP' OR v_nama ~ '(^|[[:space:]])SMP([[:space:]]|$)' THEN RETURN '03'; END IF;
  IF v_kode = 'SMA' OR v_nama ~ '(^|[[:space:]])SMA([[:space:]]|$)' THEN RETURN '04'; END IF;
  IF v_kode IN ('MTA','MTQ')
     OR v_nama ~ '(^|[[:space:]])(MTA|MTQ)([[:space:]]|$)' THEN RETURN '05'; END IF;

  RAISE EXCEPTION 'Kode lembaga belum didukung untuk NIS otomatis: %', COALESCE(NULLIF(v_kode,''), v_nama);
END
$$;

REVOKE ALL ON FUNCTION public.nis_kode_lembaga(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.nis_get_or_create_for_department(
  p_siswa_id uuid,
  p_departemen_id uuid,
  p_angkatan_id uuid,
  p_sumber text DEFAULT 'otomatis',
  p_keterangan text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing text;
  v_tahun integer;
  v_year4 text;
  v_year2 text;
  v_kode text;
  v_prefix text;
  v_next integer;
  v_nis text;
BEGIN
  IF p_siswa_id IS NULL OR p_departemen_id IS NULL OR p_angkatan_id IS NULL THEN
    RAISE EXCEPTION 'Siswa, lembaga, dan angkatan wajib diisi untuk membuat NIS';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.siswa WHERE id = p_siswa_id) THEN
    RAISE EXCEPTION 'Siswa tidak ditemukan';
  END IF;

  SELECT h.nis, h.tahun_masuk
  INTO v_existing, v_tahun
  FROM public.siswa_tahun_masuk_departemen h
  WHERE h.siswa_id = p_siswa_id
    AND h.departemen_id = p_departemen_id
  FOR UPDATE;

  -- Satu siswa mempertahankan NIS yang sama bila kembali ke lembaga yang sama.
  IF NULLIF(BTRIM(v_existing),'') IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  IF v_tahun IS NULL THEN
    SELECT (regexp_match(a.nama, '([0-9]{4})'))[1]
    INTO v_year4
    FROM public.angkatan a
    WHERE a.id = p_angkatan_id
      AND a.departemen_id = p_departemen_id
      AND COALESCE(a.aktif,true);

    IF v_year4 IS NULL THEN
      RAISE EXCEPTION 'Angkatan tidak sesuai lembaga atau nama angkatan tidak memuat tahun 4 digit';
    END IF;
    v_tahun := v_year4::integer;
  END IF;

  IF v_tahun < 1900 OR v_tahun > 2200 THEN
    RAISE EXCEPTION 'Tahun masuk tidak valid';
  END IF;

  v_year2 := right(v_tahun::text, 2);
  v_kode := public.nis_kode_lembaga(p_departemen_id);
  v_prefix := v_year2 || '-' || v_kode || '-';

  -- Urutan unik per kombinasi tahun masuk + lembaga.
  PERFORM pg_advisory_xact_lock(hashtext('nis:' || v_prefix));

  -- Cek ulang setelah memperoleh lock untuk menjaga idempotensi pada request bersamaan.
  SELECT h.nis
  INTO v_existing
  FROM public.siswa_tahun_masuk_departemen h
  WHERE h.siswa_id = p_siswa_id
    AND h.departemen_id = p_departemen_id;

  IF NULLIF(BTRIM(v_existing),'') IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT COALESCE(MAX(right(h.nis,3)::integer), 0) + 1
  INTO v_next
  FROM public.siswa_tahun_masuk_departemen h
  WHERE h.nis ~ ('^' || v_year2 || '-' || v_kode || '-[0-9]{3}$');

  IF v_next > 999 THEN
    RAISE EXCEPTION 'Nomor urut NIS % untuk tahun % sudah penuh (maksimal 999)', v_kode, v_tahun;
  END IF;

  v_nis := v_prefix || lpad(v_next::text, 3, '0');

  INSERT INTO public.siswa_tahun_masuk_departemen(
    siswa_id, departemen_id, tahun_masuk, sumber, keterangan, nis
  )
  VALUES(
    p_siswa_id,
    p_departemen_id,
    v_tahun,
    COALESCE(NULLIF(BTRIM(p_sumber),''),'otomatis'),
    p_keterangan,
    v_nis
  )
  ON CONFLICT (siswa_id, departemen_id)
  DO UPDATE SET
    nis = COALESCE(public.siswa_tahun_masuk_departemen.nis, EXCLUDED.nis),
    updated_at = now()
  RETURNING nis INTO v_nis;

  RETURN v_nis;
END
$$;

REVOKE ALL ON FUNCTION public.nis_get_or_create_for_department(uuid,uuid,uuid,text,text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.akademik_generate_nis_current(
  p_siswa_id uuid,
  p_departemen_id uuid,
  p_angkatan_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_departemen uuid;
  v_nis text;
BEGIN
  SELECT departemen_id
  INTO v_current_departemen
  FROM public.siswa
  WHERE id = p_siswa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Siswa tidak ditemukan';
  END IF;

  IF v_current_departemen IS DISTINCT FROM p_departemen_id THEN
    RAISE EXCEPTION 'Lembaga siswa saat ini tidak sesuai dengan lembaga pembuatan NIS';
  END IF;

  v_nis := public.nis_get_or_create_for_department(
    p_siswa_id,
    p_departemen_id,
    p_angkatan_id,
    'generator_aplikasi',
    'NIS dibuat otomatis oleh aplikasi'
  );

  UPDATE public.siswa
  SET nis = v_nis
  WHERE id = p_siswa_id;

  RETURN v_nis;
END
$$;

REVOKE ALL ON FUNCTION public.akademik_generate_nis_current(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.akademik_generate_nis_current(uuid,uuid,uuid)
  TO service_role;

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

  new_nis := public.nis_get_or_create_for_department(
    p_siswa_id,
    target_dept,
    target_cohort,
    'spmb_internal',
    'Aktivasi SPMB internal ke jenjang tujuan'
  );

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

CREATE OR REPLACE FUNCTION public.akademik_mutasi_antar_lembaga(
  p_siswa_id uuid,
  p_departemen_tujuan_id uuid,
  p_angkatan_tujuan_id uuid,
  p_kelas_tujuan_id uuid,
  p_tahun_ajaran_id uuid,
  p_alasan text,
  p_status_asrama text DEFAULT NULL
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
  target_dept public.departemen;
  target_cohort public.angkatan;
  target_class public.kelas;
  target_year public.tahun_ajaran;
  old_class_id uuid;
  old_year_id uuid;
  active_class_count integer;
  old_nis text;
  old_asrama text;
  new_asrama text;
  target_code text;
  npsn_digits text;
  npsn4 text;
  year4 text;
  year2 text;
  last_char text;
  rombel_code integer;
  next_seq integer;
  new_nis text;
  entry_year integer;
  clean_reason text := NULLIF(BTRIM(COALESCE(p_alasan,'')), '');
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Anda harus masuk terlebih dahulu';
  END IF;
  IF p_siswa_id IS NULL OR p_departemen_tujuan_id IS NULL
     OR p_angkatan_tujuan_id IS NULL OR p_kelas_tujuan_id IS NULL
     OR p_tahun_ajaran_id IS NULL THEN
    RAISE EXCEPTION 'Siswa, lembaga, angkatan, kelas, dan tahun ajaran tujuan wajib dipilih';
  END IF;
  IF clean_reason IS NULL OR length(clean_reason) < 5 THEN
    RAISE EXCEPTION 'Alasan perpindahan wajib diisi minimal 5 karakter';
  END IF;

  SELECT * INTO s FROM public.siswa WHERE id=p_siswa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Siswa tidak ditemukan'; END IF;
  IF s.status <> 'aktif' THEN
    RAISE EXCEPTION 'Hanya siswa aktif yang dapat dipindahkan antar lembaga';
  END IF;

  IF NOT (
    public.has_role(uid,'admin')
    OR (
      public.has_role(uid,'admin_tu')
      AND public.can_manage_akademik_departemen(uid,s.departemen_id)
    )
  ) THEN
    RAISE EXCEPTION 'Akses lembaga asal ditolak';
  END IF;

  IF s.departemen_id IS NULL THEN
    RAISE EXCEPTION 'Lembaga asal siswa belum terisi';
  END IF;
  IF s.departemen_id = p_departemen_tujuan_id THEN
    RAISE EXCEPTION 'Lembaga tujuan harus berbeda dari lembaga siswa saat ini';
  END IF;

  SELECT * INTO target_dept
  FROM public.departemen
  WHERE id=p_departemen_tujuan_id
    AND COALESCE(aktif,true)
    AND kategori='unit_pendidikan';
  IF NOT FOUND THEN RAISE EXCEPTION 'Lembaga tujuan tidak valid atau tidak aktif'; END IF;

  SELECT * INTO target_cohort
  FROM public.angkatan
  WHERE id=p_angkatan_tujuan_id
    AND departemen_id=p_departemen_tujuan_id
    AND COALESCE(aktif,true);
  IF NOT FOUND THEN RAISE EXCEPTION 'Angkatan tujuan tidak sesuai lembaga tujuan'; END IF;

  SELECT * INTO target_class
  FROM public.kelas
  WHERE id=p_kelas_tujuan_id
    AND departemen_id=p_departemen_tujuan_id
    AND COALESCE(aktif,true);
  IF NOT FOUND THEN RAISE EXCEPTION 'Kelas tujuan tidak sesuai lembaga tujuan'; END IF;

  SELECT * INTO target_year
  FROM public.tahun_ajaran
  WHERE id=p_tahun_ajaran_id
    AND COALESCE(aktif,true)
    AND NOT COALESCE(ditutup,false);
  IF NOT FOUND THEN RAISE EXCEPTION 'Tahun ajaran tujuan tidak aktif atau sudah ditutup'; END IF;
  IF target_year.tanggal_mulai IS NOT NULL AND current_date < target_year.tanggal_mulai THEN
    RAISE EXCEPTION 'Mutasi baru dapat dilakukan mulai %', to_char(target_year.tanggal_mulai,'DD-MM-YYYY');
  END IF;
  IF target_year.tanggal_selesai IS NOT NULL AND current_date > target_year.tanggal_selesai THEN
    RAISE EXCEPTION 'Tahun ajaran tujuan sudah berakhir';
  END IF;

  SELECT count(*) INTO active_class_count
  FROM public.kelas_siswa
  WHERE siswa_id=p_siswa_id AND aktif;
  IF active_class_count <> 1 THEN
    RAISE EXCEPTION 'Siswa harus memiliki tepat satu kelas aktif sebelum mutasi antar lembaga';
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

  SELECT * INTO d FROM public.siswa_detail WHERE siswa_id=p_siswa_id FOR UPDATE;
  IF FOUND THEN old_asrama := d.status_asrama; END IF;

  target_code := upper(trim(COALESCE(target_dept.kode,'')));
  IF target_code IN ('SMP','SMA','MTA') THEN
    IF d.id IS NULL THEN
      RAISE EXCEPTION 'Data detail siswa harus tersedia sebelum mutasi ke SMP/SMA/MTA';
    END IF;
    IF COALESCE(p_status_asrama,'') NOT IN ('asrama','non_asrama') THEN
      RAISE EXCEPTION 'Pilih status Asrama atau Non Asrama untuk lembaga tujuan';
    END IF;
    -- Siswa yang sudah aktif di yayasan adalah murid lama/internal, sehingga
    -- pengecualian Non Asrama untuk MTA tetap dapat dipilih secara eksplisit.
    new_asrama := p_status_asrama;
  ELSE
    new_asrama := NULL;
  END IF;

  new_nis := public.nis_get_or_create_for_department(
    p_siswa_id,
    p_departemen_tujuan_id,
    p_angkatan_tujuan_id,
    'mutasi_internal',
    clean_reason
  );

  old_nis := s.nis;

  UPDATE public.kelas_siswa
  SET aktif=false
  WHERE siswa_id=p_siswa_id AND aktif;

  INSERT INTO public.kelas_siswa(siswa_id,kelas_id,tahun_ajaran_id,aktif)
  VALUES(p_siswa_id,p_kelas_tujuan_id,p_tahun_ajaran_id,true)
  ON CONFLICT(siswa_id,kelas_id,tahun_ajaran_id)
  DO UPDATE SET aktif=true;

  UPDATE public.siswa
  SET departemen_id=p_departemen_tujuan_id,
      angkatan_id=p_angkatan_tujuan_id,
      nis=new_nis,
      status='aktif'
  WHERE id=p_siswa_id;

  IF d.id IS NOT NULL THEN
    UPDATE public.siswa_detail
    SET status_asrama=new_asrama
    WHERE siswa_id=p_siswa_id;
  END IF;

  entry_year := COALESCE(
    extract(year from target_year.tanggal_mulai)::integer,
    year4::integer
  );

  INSERT INTO public.siswa_tahun_masuk_departemen(
    siswa_id,departemen_id,tahun_masuk,sumber,keterangan
  )
  VALUES(
    p_siswa_id,p_departemen_tujuan_id,entry_year,'mutasi_internal',clean_reason
  )
  ON CONFLICT(siswa_id,departemen_id) DO NOTHING;

  INSERT INTO public.siswa_mutasi_departemen_audit(
    siswa_id,
    departemen_asal_id,departemen_tujuan_id,
    angkatan_asal_id,angkatan_tujuan_id,
    kelas_asal_id,kelas_tujuan_id,
    tahun_ajaran_asal_id,tahun_ajaran_tujuan_id,
    nis_lama,nis_baru,
    status_asrama_lama,status_asrama_baru,
    alasan,changed_by
  ) VALUES (
    p_siswa_id,
    s.departemen_id,p_departemen_tujuan_id,
    s.angkatan_id,p_angkatan_tujuan_id,
    old_class_id,p_kelas_tujuan_id,
    old_year_id,p_tahun_ajaran_id,
    old_nis,new_nis,
    old_asrama,new_asrama,
    clean_reason,uid
  );

  RETURN jsonb_build_object(
    'siswa_id',p_siswa_id,
    'departemen_asal_id',s.departemen_id,
    'departemen_tujuan_id',p_departemen_tujuan_id,
    'kelas_asal_id',old_class_id,
    'kelas_tujuan_id',p_kelas_tujuan_id,
    'tahun_ajaran_tujuan_id',p_tahun_ajaran_id,
    'nis_lama',old_nis,
    'nis_baru',new_nis,
    'status_asrama',new_asrama,
    'alasan',clean_reason
  );
END
$$;

REVOKE ALL ON FUNCTION public.spmb_activate_internal_student(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.spmb_activate_internal_student(uuid,uuid,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.akademik_mutasi_antar_lembaga(uuid,uuid,uuid,uuid,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.akademik_mutasi_antar_lembaga(uuid,uuid,uuid,uuid,uuid,text,text) TO authenticated;

COMMENT ON FUNCTION public.nis_get_or_create_for_department(uuid,uuid,uuid,text,text) IS
  'Generator idempotent NIS per lembaga dengan format YY-KK-NNN dan urutan per tahun+lembaga.';
