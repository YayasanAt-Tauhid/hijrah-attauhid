-- Mutasi antar lembaga internal yayasan.
-- Dipakai setelah siswa sudah aktif pada satu lembaga dan kemudian berpindah
-- ke lembaga lain (contoh SMA -> MTA). Riwayat SPMB lama tidak ditimpa.

CREATE TABLE IF NOT EXISTS public.siswa_mutasi_departemen_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  siswa_id uuid NOT NULL REFERENCES public.siswa(id) ON DELETE CASCADE,
  departemen_asal_id uuid NOT NULL REFERENCES public.departemen(id),
  departemen_tujuan_id uuid NOT NULL REFERENCES public.departemen(id),
  angkatan_asal_id uuid REFERENCES public.angkatan(id),
  angkatan_tujuan_id uuid NOT NULL REFERENCES public.angkatan(id),
  kelas_asal_id uuid NOT NULL REFERENCES public.kelas(id),
  kelas_tujuan_id uuid NOT NULL REFERENCES public.kelas(id),
  tahun_ajaran_asal_id uuid REFERENCES public.tahun_ajaran(id),
  tahun_ajaran_tujuan_id uuid NOT NULL REFERENCES public.tahun_ajaran(id),
  nis_lama text,
  nis_baru text NOT NULL,
  status_asrama_lama text,
  status_asrama_baru text,
  alasan text NOT NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS siswa_mutasi_departemen_audit_siswa_idx
  ON public.siswa_mutasi_departemen_audit (siswa_id, changed_at DESC);

ALTER TABLE public.siswa_mutasi_departemen_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS siswa_mutasi_departemen_audit_select ON public.siswa_mutasi_departemen_audit;
CREATE POLICY siswa_mutasi_departemen_audit_select
ON public.siswa_mutasi_departemen_audit
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR (
    public.has_role(auth.uid(), 'admin_tu')
    AND (
      public.can_manage_akademik_departemen(auth.uid(), departemen_asal_id)
      OR public.can_manage_akademik_departemen(auth.uid(), departemen_tujuan_id)
    )
  )
);

REVOKE ALL ON TABLE public.siswa_mutasi_departemen_audit FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.siswa_mutasi_departemen_audit FROM authenticated;
GRANT SELECT ON TABLE public.siswa_mutasi_departemen_audit TO authenticated;

-- Perubahan akademik setelah SPMB benar-benar selesai tidak boleh membuka
-- kembali verifikasi historis SPMB. Ini penting untuk mutasi lanjutan SMA -> MTA.
CREATE OR REPLACE FUNCTION public.spmb_invalidate_verification(p_siswa_id uuid, p_fields text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  d public.siswa_detail;
  s public.siswa;
  was_verified boolean := false;
  reason_text text;
  cleaned_checklist jsonb;
  previous_internal text := COALESCE(current_setting('app.spmb_verification_internal', true), '');
BEGIN
  IF COALESCE(cardinality(p_fields),0) = 0 THEN RETURN; END IF;
  SELECT * INTO d FROM public.siswa_detail WHERE siswa_id = p_siswa_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  -- Pendaftaran yang sudah selesai adalah histori. Perubahan akademik sesudahnya
  -- (misalnya mutasi antar lembaga) tidak mengubah hasil verifikasi SPMB lama.
  IF COALESCE(d.spmb_status_pendaftaran, '') = 'selesai' THEN
    RETURN;
  END IF;

  SELECT * INTO s FROM public.siswa WHERE id = p_siswa_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  was_verified := d.spmb_verifikasi_status = 'terverifikasi' OR s.terverifikasi;
  reason_text := 'Data/dokumen SPMB yang telah diperiksa berubah: ' || array_to_string(p_fields, ', ');
  cleaned_checklist := COALESCE(d.spmb_verifikasi_fields, '{}'::jsonb) - p_fields;

  PERFORM set_config('app.spmb_verification_internal', '1', true);
  UPDATE public.siswa_detail
  SET spmb_verifikasi_fields = cleaned_checklist,
      spmb_verifikasi_status = CASE WHEN was_verified OR spmb_verifikasi_status = 'perlu_verifikasi_ulang' THEN 'perlu_verifikasi_ulang' ELSE spmb_verifikasi_status END,
      spmb_verifikasi_last_reason = CASE WHEN was_verified OR spmb_verifikasi_status = 'perlu_verifikasi_ulang' THEN reason_text ELSE spmb_verifikasi_last_reason END
  WHERE siswa_id = p_siswa_id;

  IF was_verified THEN
    UPDATE public.siswa SET terverifikasi = false WHERE id = p_siswa_id;
    INSERT INTO public.spmb_verifikasi_audit(siswa_id,status,data_version,checklist,actor_id,reason,changed_fields)
    VALUES (p_siswa_id,'perlu_verifikasi_ulang',d.spmb_verifikasi_version,cleaned_checklist,auth.uid(),reason_text,p_fields);
  END IF;
  PERFORM set_config('app.spmb_verification_internal', previous_internal, true);
END
$function$;

-- Referensi lintas lembaga untuk halaman Mutasi. RLS global Admin TU tetap ketat;
-- hanya RPC ini yang membuka master target yang memang diperlukan untuk mutasi.
CREATE OR REPLACE FUNCTION public.akademik_internal_transfer_reference()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'admin_tu')
  ) THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;

  SELECT jsonb_build_object(
    'departemen', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',d.id,'nama',d.nama,'kode',d.kode,'npsn',d.npsn
      ) ORDER BY d.nama)
      FROM public.departemen d
      WHERE COALESCE(d.aktif,true)
        AND d.kategori='unit_pendidikan'
    ), '[]'::jsonb),
    'angkatan', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',a.id,'nama',a.nama,'departemen_id',a.departemen_id
      ) ORDER BY a.nama DESC)
      FROM public.angkatan a
      WHERE COALESCE(a.aktif,true)
    ), '[]'::jsonb),
    'kelas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',k.id,'nama',k.nama,'departemen_id',k.departemen_id
      ) ORDER BY k.nama)
      FROM public.kelas k
      WHERE COALESCE(k.aktif,true)
    ), '[]'::jsonb),
    'tahun_ajaran', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',ta.id,'nama',ta.nama,'tanggal_mulai',ta.tanggal_mulai,
        'tanggal_selesai',ta.tanggal_selesai,'aktif',ta.aktif,'ditutup',ta.ditutup
      ) ORDER BY ta.tanggal_mulai DESC NULLS LAST, ta.nama DESC)
      FROM public.tahun_ajaran ta
      WHERE COALESCE(ta.aktif,true)
        AND NOT COALESCE(ta.ditutup,false)
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION public.akademik_internal_transfer_reference() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.akademik_internal_transfer_reference() TO authenticated;

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

  npsn_digits := regexp_replace(COALESCE(target_dept.npsn,''),'[^0-9]','','g');
  IF length(npsn_digits) < 4 THEN
    RAISE EXCEPTION 'NPSN lembaga tujuan belum valid';
  END IF;
  npsn4 := right(npsn_digits,4);

  SELECT (regexp_match(target_cohort.nama,'([0-9]{4})'))[1] INTO year4;
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
    hashtext(p_departemen_tujuan_id::text || ':' || p_angkatan_tujuan_id::text || ':' || p_kelas_tujuan_id::text)
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
    RAISE EXCEPTION 'NIS tujuan bentrok; coba ulangi mutasi';
  END IF;

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

REVOKE ALL ON FUNCTION public.akademik_mutasi_antar_lembaga(uuid,uuid,uuid,uuid,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.akademik_mutasi_antar_lembaga(uuid,uuid,uuid,uuid,uuid,text,text) TO authenticated;

COMMENT ON FUNCTION public.akademik_mutasi_antar_lembaga(uuid,uuid,uuid,uuid,uuid,text,text) IS
  'Mutasi atomik siswa aktif antar lembaga internal: pertahankan histori kelas/SPMB/tagihan, buat kelas+NIS baru, dan simpan audit perpindahan.';
