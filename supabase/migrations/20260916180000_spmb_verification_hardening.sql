-- SPMB verification hardening.
-- Verification is based on saved data, explicit officer checklists, server-side
-- requirements, an immutable data version, and an audit trail. Verification is
-- deliberately independent from selection, payment, and student activation.

ALTER TABLE public.siswa_detail
  ADD COLUMN IF NOT EXISTS spmb_verifikasi_version text,
  ADD COLUMN IF NOT EXISTS spmb_verifikasi_status text NOT NULL DEFAULT 'belum_verifikasi',
  ADD COLUMN IF NOT EXISTS spmb_verifikasi_at timestamptz,
  ADD COLUMN IF NOT EXISTS spmb_verifikasi_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS spmb_verifikasi_last_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'siswa_detail_spmb_verifikasi_status_check'
      AND conrelid = 'public.siswa_detail'::regclass
  ) THEN
    ALTER TABLE public.siswa_detail
      ADD CONSTRAINT siswa_detail_spmb_verifikasi_status_check
      CHECK (spmb_verifikasi_status IN ('belum_verifikasi', 'terverifikasi', 'perlu_verifikasi_ulang'));
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.spmb_verifikasi_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  siswa_id uuid NOT NULL REFERENCES public.siswa(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('terverifikasi', 'perlu_verifikasi_ulang')),
  data_version text,
  checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text,
  changed_fields text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS spmb_verifikasi_audit_siswa_idx
  ON public.spmb_verifikasi_audit(siswa_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS spmb_verifikasi_audit_verified_once_idx
  ON public.spmb_verifikasi_audit(siswa_id, status, data_version)
  WHERE status = 'terverifikasi' AND data_version IS NOT NULL;

ALTER TABLE public.spmb_verifikasi_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spmb_verifikasi_audit_admin_read ON public.spmb_verifikasi_audit;
CREATE POLICY spmb_verifikasi_audit_admin_read
  ON public.spmb_verifikasi_audit FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
REVOKE ALL ON TABLE public.spmb_verifikasi_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.spmb_verifikasi_audit TO authenticated;

COMMENT ON COLUMN public.siswa_detail.spmb_verifikasi_status IS
  'belum_verifikasi, terverifikasi, atau perlu_verifikasi_ulang; tidak menentukan kelulusan/pembayaran/keaktifan';
COMMENT ON COLUMN public.siswa_detail.spmb_verifikasi_version IS
  'Fingerprint data tersimpan yang menjadi dasar checklist/verifikasi terakhir';
COMMENT ON TABLE public.spmb_verifikasi_audit IS
  'Riwayat verifikasi dan kebutuhan verifikasi ulang SPMB; tidak mengubah status seleksi, pembayaran, atau siswa';

-- Internal source of truth for the current verification version and requirements.
-- Required items intentionally mirror the active /spmb flow. Physical measurements,
-- uniform size, parent details, report card, and diploma are not blockers because
-- they are not required by the current registration stage.
CREATE OR REPLACE FUNCTION public.spmb_verification_payload(p_siswa_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.siswa;
  d public.siswa_detail;
  dep public.departemen;
  ang public.angkatan;
  ta public.tahun_ajaran;
  need_asrama boolean := false;
  snapshot jsonb;
  requirements jsonb;
  version_value text;
BEGIN
  SELECT * INTO s FROM public.siswa WHERE id = p_siswa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Siswa tidak ditemukan'; END IF;

  SELECT * INTO d FROM public.siswa_detail WHERE siswa_id = p_siswa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Data SPMB tidak ditemukan'; END IF;

  SELECT * INTO dep FROM public.departemen WHERE id = s.departemen_id;
  SELECT * INTO ang FROM public.angkatan WHERE id = s.angkatan_id;
  SELECT * INTO ta FROM public.tahun_ajaran WHERE id = d.tahun_ajaran_id;

  need_asrama := dep.id IS NOT NULL AND (
    upper(trim(COALESCE(dep.kode, ''))) IN ('SMP', 'SMA', 'MTA')
    OR upper(COALESCE(dep.nama, '')) ~ '(^|\s)(SMP|SMA|MTA)(\s|$)'
  );

  snapshot := jsonb_build_object(
    'nama', s.nama,
    'jenis_kelamin', s.jenis_kelamin,
    'tempat_lahir', s.tempat_lahir,
    'tanggal_lahir', s.tanggal_lahir,
    'departemen_id', s.departemen_id,
    'angkatan_id', s.angkatan_id,
    'tahun_ajaran_id', d.tahun_ajaran_id,
    'nik', d.nik,
    'no_kk', d.no_kk,
    'kategori', d.kategori,
    'status_asrama', CASE WHEN need_asrama THEN d.status_asrama ELSE NULL END,
    'anak_ke', d.anak_ke,
    'jumlah_bersaudara', d.jumlah_bersaudara,
    'jarak_rumah_km', d.jarak_rumah_km,
    'waktu_perjalanan_menit', d.waktu_perjalanan_menit,
    'transportasi', d.transportasi,
    'kemampuan_iqro', d.kemampuan_iqro,
    'membaca_latin', d.membaca_latin,
    'menulis_latin', d.menulis_latin,
    'hafalan_quran', d.hafalan_quran,
    'dokumen_kk_path', d.dokumen_kk_path,
    'dokumen_akta_path', d.dokumen_akta_path
  );
  version_value := md5(snapshot::text);

  requirements := jsonb_build_array(
    jsonb_build_object('key','nama','label','Nama lengkap calon murid','kind','field','required',true,
      'valid',COALESCE(char_length(trim(s.nama)) >= 2,false),'display_value',COALESCE(s.nama,'-')),
    jsonb_build_object('key','jenis_kelamin','label','Jenis kelamin','kind','field','required',true,
      'valid',COALESCE(s.jenis_kelamin IN ('L','P'),false),'display_value',CASE s.jenis_kelamin WHEN 'L' THEN 'Laki-laki' WHEN 'P' THEN 'Perempuan' ELSE '-' END),
    jsonb_build_object('key','tempat_lahir','label','Tempat lahir','kind','field','required',true,
      'valid',NULLIF(trim(COALESCE(s.tempat_lahir,'')),'') IS NOT NULL,'display_value',COALESCE(NULLIF(trim(s.tempat_lahir),''),'-')),
    jsonb_build_object('key','tanggal_lahir','label','Tanggal lahir','kind','field','required',true,
      'valid',s.tanggal_lahir IS NOT NULL,'display_value',COALESCE(to_char(s.tanggal_lahir,'DD-MM-YYYY'),'-')),
    jsonb_build_object('key','departemen_id','label','Lembaga tujuan','kind','field','required',true,
      'valid',dep.id IS NOT NULL,'display_value',COALESCE(dep.nama,'-')),
    jsonb_build_object('key','angkatan_id','label','Angkatan sesuai lembaga','kind','field','required',true,
      'valid',ang.id IS NOT NULL AND ang.departemen_id = s.departemen_id,'display_value',COALESCE(ang.nama,'-')),
    jsonb_build_object('key','tahun_ajaran_id','label','Periode Tahun Ajaran SPMB','kind','field','required',true,
      'valid',ta.id IS NOT NULL,'display_value',COALESCE(ta.nama,'-')),
    jsonb_build_object('key','nik','label','NIK Calon Murid (16 digit)','kind','field','required',true,
      'valid',COALESCE(d.nik ~ '^[0-9]{16}$',false),'display_value',COALESCE(d.nik,'-')),
    jsonb_build_object('key','no_kk','label','Nomor Kartu Keluarga','kind','field','required',true,
      'valid',NULLIF(trim(COALESCE(d.no_kk,'')),'') IS NOT NULL,'display_value',COALESCE(NULLIF(trim(d.no_kk),''),'-')),
    jsonb_build_object('key','kategori','label','Kategori pendaftaran','kind','field','required',true,
      'valid',COALESCE(d.kategori IN ('MURID BARU','MURID PINDAHAN'),false),'display_value',COALESCE(d.kategori,'-')),
    jsonb_build_object('key','anak_ke','label','Anak ke','kind','field','required',true,
      'valid',d.anak_ke IS NOT NULL AND d.anak_ke >= 0,'display_value',COALESCE(d.anak_ke::text,'-')),
    jsonb_build_object('key','jumlah_bersaudara','label','Jumlah bersaudara','kind','field','required',true,
      'valid',d.jumlah_bersaudara IS NOT NULL AND d.jumlah_bersaudara >= 0,'display_value',COALESCE(d.jumlah_bersaudara::text,'-')),
    jsonb_build_object('key','jarak_rumah_km','label','Jarak rumah ke sekolah','kind','field','required',true,
      'valid',d.jarak_rumah_km IS NOT NULL AND d.jarak_rumah_km >= 0,'display_value',CASE WHEN d.jarak_rumah_km IS NULL THEN '-' ELSE d.jarak_rumah_km::text || ' km' END),
    jsonb_build_object('key','waktu_perjalanan_menit','label','Waktu perjalanan','kind','field','required',true,
      'valid',d.waktu_perjalanan_menit IS NOT NULL AND d.waktu_perjalanan_menit >= 0,'display_value',CASE WHEN d.waktu_perjalanan_menit IS NULL THEN '-' ELSE d.waktu_perjalanan_menit::text || ' menit' END),
    jsonb_build_object('key','transportasi','label','Transportasi','kind','field','required',true,
      'valid',COALESCE(d.transportasi IN ('Mobil Pribadi','Sepeda Motor','Mobil/Bus Antar Jemput','Sepeda','Jalan Kaki','Lainnya'),false),'display_value',COALESCE(d.transportasi,'-')),
    jsonb_build_object('key','kemampuan_iqro','label','Kemampuan Iqro','kind','field','required',true,
      'valid',COALESCE(d.kemampuan_iqro IN ('0','1','2','3','4','5','6','7'),false),'display_value',COALESCE(d.kemampuan_iqro,'-')),
    jsonb_build_object('key','membaca_latin','label','Kemampuan membaca Latin','kind','field','required',true,
      'valid',COALESCE(d.membaca_latin IN ('BAIK','CUKUP','KURANG'),false),'display_value',COALESCE(d.membaca_latin,'-')),
    jsonb_build_object('key','menulis_latin','label','Kemampuan menulis Latin','kind','field','required',true,
      'valid',COALESCE(d.menulis_latin IN ('BAIK','CUKUP','KURANG'),false),'display_value',COALESCE(d.menulis_latin,'-')),
    jsonb_build_object('key','hafalan_quran','label','Hafalan Qur''an','kind','field','required',true,
      'valid',COALESCE(d.hafalan_quran IN ('0','1','2','3'),false),'display_value',COALESCE(d.hafalan_quran,'-')),
    jsonb_build_object('key','dokumen_kk_path','label','Kartu Keluarga','kind','document','required',true,
      'valid',COALESCE(d.dokumen_kk_path ~* '^kk/[0-9a-f-]+\.(pdf|jpg|jpeg|png)$',false),'path',d.dokumen_kk_path,'display_value',CASE WHEN d.dokumen_kk_path IS NULL THEN 'Belum diunggah' ELSE 'Dokumen tersedia' END),
    jsonb_build_object('key','dokumen_akta_path','label','Akta Kelahiran','kind','document','required',true,
      'valid',COALESCE(d.dokumen_akta_path ~* '^akta/[0-9a-f-]+\.(pdf|jpg|jpeg|png)$',false),'path',d.dokumen_akta_path,'display_value',CASE WHEN d.dokumen_akta_path IS NULL THEN 'Belum diunggah' ELSE 'Dokumen tersedia' END)
  );

  IF need_asrama THEN
    requirements := requirements || jsonb_build_array(
      jsonb_build_object('key','status_asrama','label','Asrama / Non Asrama','kind','field','required',true,
        'valid',COALESCE(d.status_asrama IN ('asrama','non_asrama'),false),
        'display_value',CASE d.status_asrama WHEN 'asrama' THEN 'Asrama' WHEN 'non_asrama' THEN 'Non Asrama' ELSE '-' END)
    );
  END IF;

  -- Optional documents are visible to the officer but never block verification.
  requirements := requirements || jsonb_build_array(
    jsonb_build_object('key','dokumen_rapor_path','label','Rapor','kind','document','required',false,
      'valid',d.dokumen_rapor_path IS NULL OR d.dokumen_rapor_path ~* '^rapor/[0-9a-f-]+\.(pdf|jpg|jpeg|png)$',
      'path',d.dokumen_rapor_path,'display_value',CASE WHEN d.dokumen_rapor_path IS NULL THEN 'Opsional — belum diunggah' ELSE 'Dokumen tersedia' END),
    jsonb_build_object('key','dokumen_ijazah_path','label','Ijazah/SKHUN','kind','document','required',false,
      'valid',d.dokumen_ijazah_path IS NULL OR d.dokumen_ijazah_path ~* '^ijazah/[0-9a-f-]+\.(pdf|jpg|jpeg|png)$',
      'path',d.dokumen_ijazah_path,'display_value',CASE WHEN d.dokumen_ijazah_path IS NULL THEN 'Opsional — belum diunggah' ELSE 'Dokumen tersedia' END)
  );

  RETURN jsonb_build_object('version', version_value, 'requirements', requirements);
END
$$;
REVOKE ALL ON FUNCTION public.spmb_verification_payload(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.spmb_verification_state(p_siswa_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  s public.siswa;
  d public.siswa_detail;
  payload jsonb;
  requirements jsonb;
  current_version text;
  checklist jsonb;
  total_required integer := 0;
  checked_required integer := 0;
  invalid_required jsonb := '[]'::jsonb;
  unchecked_required jsonb := '[]'::jsonb;
  can_verify boolean := false;
  verifier_name text;
  history jsonb := '[]'::jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Anda harus masuk terlebih dahulu'; END IF;
  SELECT * INTO s FROM public.siswa WHERE id = p_siswa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Siswa tidak ditemukan'; END IF;
  SELECT * INTO d FROM public.siswa_detail WHERE siswa_id = p_siswa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Data SPMB tidak ditemukan'; END IF;

  can_verify := public.has_role(uid, 'admin');
  payload := public.spmb_verification_payload(p_siswa_id);
  requirements := payload->'requirements';
  current_version := payload->>'version';
  checklist := COALESCE(d.spmb_verifikasi_fields, '{}'::jsonb);

  SELECT
    count(*) FILTER (WHERE COALESCE((item->>'required')::boolean,false)),
    count(*) FILTER (WHERE COALESCE((item->>'required')::boolean,false) AND COALESCE((checklist->>(item->>'key'))::boolean,false)),
    COALESCE(jsonb_agg(item->>'label') FILTER (WHERE COALESCE((item->>'required')::boolean,false) AND NOT COALESCE((item->>'valid')::boolean,false)), '[]'::jsonb),
    COALESCE(jsonb_agg(item->>'label') FILTER (WHERE COALESCE((item->>'required')::boolean,false) AND NOT COALESCE((checklist->>(item->>'key'))::boolean,false)), '[]'::jsonb)
  INTO total_required, checked_required, invalid_required, unchecked_required
  FROM jsonb_array_elements(requirements) item;

  IF can_verify AND d.spmb_verifikasi_by IS NOT NULL THEN
    SELECT COALESCE(p.nama, up.email, 'Petugas') INTO verifier_name
    FROM public.users_profile up
    LEFT JOIN public.pegawai p ON p.id = up.pegawai_id
    WHERE up.id = d.spmb_verifikasi_by;
  END IF;

  IF can_verify THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'status', x.status, 'data_version', x.data_version, 'reason', x.reason,
      'changed_fields', to_jsonb(x.changed_fields), 'created_at', x.created_at, 'petugas', x.actor_name
    ) ORDER BY x.created_at DESC), '[]'::jsonb)
    INTO history
    FROM (
      SELECT a.status, a.data_version, a.reason, a.changed_fields, a.created_at,
             COALESCE(p.nama, up.email, 'Petugas') AS actor_name
      FROM public.spmb_verifikasi_audit a
      LEFT JOIN public.users_profile up ON up.id = a.actor_id
      LEFT JOIN public.pegawai p ON p.id = up.pegawai_id
      WHERE a.siswa_id = p_siswa_id
      ORDER BY a.created_at DESC
      LIMIT 20
    ) x;
  END IF;

  RETURN jsonb_build_object(
    'siswa_id', p_siswa_id,
    'student_status', s.status,
    'status', COALESCE(d.spmb_verifikasi_status, CASE WHEN s.terverifikasi THEN 'terverifikasi' ELSE 'belum_verifikasi' END),
    'legacy_verified', s.terverifikasi,
    'version', current_version,
    'verified_version', d.spmb_verifikasi_version,
    'verified_at', d.spmb_verifikasi_at,
    'verified_by', CASE WHEN can_verify THEN d.spmb_verifikasi_by ELSE NULL END,
    'verified_by_name', CASE WHEN can_verify THEN verifier_name ELSE NULL END,
    'last_reason', d.spmb_verifikasi_last_reason,
    'can_verify', can_verify,
    'requirements', requirements,
    'checklist', checklist,
    'required_total', total_required,
    'required_checked', checked_required,
    'invalid_required', invalid_required,
    'unchecked_required', unchecked_required,
    'data_current', d.spmb_verifikasi_version IS NULL OR d.spmb_verifikasi_version = current_version,
    'can_submit', can_verify AND s.status IN ('calon','diterima','aktif')
      AND total_required = checked_required AND jsonb_array_length(invalid_required) = 0,
    'history', history
  );
END
$$;
REVOKE ALL ON FUNCTION public.spmb_verification_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spmb_verification_state(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.spmb_set_field_verification(uuid, text, boolean);
CREATE OR REPLACE FUNCTION public.spmb_set_field_verification(p_siswa_id uuid, p_field text, p_checked boolean, p_version text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  d public.siswa_detail;
  payload jsonb;
  item jsonb;
  current_version text;
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid, 'admin') THEN RAISE EXCEPTION 'Akses verifikasi SPMB ditolak'; END IF;
  IF NULLIF(trim(COALESCE(p_field,'')),'') IS NULL THEN RAISE EXCEPTION 'Item pemeriksaan tidak valid'; END IF;
  SELECT * INTO d FROM public.siswa_detail WHERE siswa_id = p_siswa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Data SPMB tidak ditemukan'; END IF;

  payload := public.spmb_verification_payload(p_siswa_id);
  current_version := payload->>'version';
  IF NULLIF(p_version,'') IS NULL OR p_version <> current_version THEN
    RAISE EXCEPTION 'Data berubah. Muat ulang halaman dan periksa kembali perubahan tersebut';
  END IF;

  SELECT value INTO item FROM jsonb_array_elements(payload->'requirements') WHERE value->>'key' = p_field LIMIT 1;
  IF item IS NULL THEN RAISE EXCEPTION 'Item pemeriksaan tidak termasuk persyaratan SPMB saat ini'; END IF;
  IF NOT COALESCE((item->>'required')::boolean,false) THEN RAISE EXCEPTION 'Dokumen opsional tidak memerlukan checklist wajib'; END IF;

  UPDATE public.siswa_detail
  SET spmb_verifikasi_fields = jsonb_set(COALESCE(spmb_verifikasi_fields, '{}'::jsonb), ARRAY[p_field], to_jsonb(COALESCE(p_checked,false)), true)
  WHERE siswa_id = p_siswa_id;
  RETURN public.spmb_verification_state(p_siswa_id);
END
$$;
REVOKE ALL ON FUNCTION public.spmb_set_field_verification(uuid,text,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spmb_set_field_verification(uuid,text,boolean,text) TO authenticated;

DROP FUNCTION IF EXISTS public.spmb_mark_verified(uuid, text, jsonb);
CREATE OR REPLACE FUNCTION public.spmb_mark_verified(p_siswa_id uuid, p_version text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  s public.siswa;
  d public.siswa_detail;
  payload jsonb;
  current_version text;
  item jsonb;
  item_key text;
  item_label text;
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid, 'admin') THEN RAISE EXCEPTION 'Akses verifikasi SPMB ditolak'; END IF;
  SELECT * INTO s FROM public.siswa WHERE id = p_siswa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Siswa tidak ditemukan'; END IF;
  SELECT * INTO d FROM public.siswa_detail WHERE siswa_id = p_siswa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Data SPMB tidak ditemukan'; END IF;
  IF s.status NOT IN ('calon','diterima','aktif') THEN RAISE EXCEPTION 'Data SPMB tidak dapat diverifikasi pada status siswa saat ini'; END IF;

  payload := public.spmb_verification_payload(p_siswa_id);
  current_version := payload->>'version';
  IF NULLIF(p_version,'') IS NULL OR p_version <> current_version THEN
    RAISE EXCEPTION 'Data berubah sejak diperiksa. Muat ulang halaman dan lakukan pemeriksaan ulang';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(payload->'requirements') LOOP
    IF COALESCE((item->>'required')::boolean,false) THEN
      item_key := item->>'key'; item_label := item->>'label';
      IF NOT COALESCE((item->>'valid')::boolean,false) THEN RAISE EXCEPTION 'Data/dokumen wajib belum tersedia atau tidak valid: %', item_label; END IF;
      IF NOT COALESCE((d.spmb_verifikasi_fields->>item_key)::boolean,false) THEN RAISE EXCEPTION 'Checklist wajib belum lengkap: %', item_label; END IF;
    END IF;
  END LOOP;

  IF d.spmb_verifikasi_status = 'terverifikasi' AND d.spmb_verifikasi_version = current_version AND s.terverifikasi THEN
    RETURN public.spmb_verification_state(p_siswa_id);
  END IF;

  UPDATE public.siswa_detail
  SET spmb_verifikasi_version = current_version, spmb_verifikasi_status = 'terverifikasi',
      spmb_verifikasi_at = now(), spmb_verifikasi_by = uid, spmb_verifikasi_last_reason = NULL
  WHERE siswa_id = p_siswa_id;
  UPDATE public.siswa SET terverifikasi = true WHERE id = p_siswa_id;

  INSERT INTO public.spmb_verifikasi_audit(siswa_id,status,data_version,checklist,actor_id,reason,changed_fields)
  VALUES (p_siswa_id,'terverifikasi',current_version,COALESCE(d.spmb_verifikasi_fields,'{}'::jsonb),uid,
    'Petugas menyelesaikan pemeriksaan data dan dokumen wajib SPMB','{}'::text[])
  ON CONFLICT DO NOTHING;

  RETURN public.spmb_verification_state(p_siswa_id);
END
$$;
REVOKE ALL ON FUNCTION public.spmb_mark_verified(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spmb_mark_verified(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.spmb_invalidate_verification(p_siswa_id uuid, p_fields text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  d public.siswa_detail;
  s public.siswa;
  was_verified boolean := false;
  reason_text text;
  cleaned_checklist jsonb;
BEGIN
  IF COALESCE(cardinality(p_fields),0) = 0 THEN RETURN; END IF;
  SELECT * INTO d FROM public.siswa_detail WHERE siswa_id = p_siswa_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO s FROM public.siswa WHERE id = p_siswa_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  was_verified := d.spmb_verifikasi_status = 'terverifikasi' OR s.terverifikasi;
  reason_text := 'Data/dokumen SPMB yang telah diperiksa berubah: ' || array_to_string(p_fields, ', ');
  cleaned_checklist := COALESCE(d.spmb_verifikasi_fields, '{}'::jsonb) - p_fields;

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
END
$$;
REVOKE ALL ON FUNCTION public.spmb_invalidate_verification(uuid,text[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.spmb_invalidate_on_siswa_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE changed text[] := '{}'::text[];
BEGIN
  IF NEW.nama IS DISTINCT FROM OLD.nama THEN changed := array_append(changed,'nama'); END IF;
  IF NEW.jenis_kelamin IS DISTINCT FROM OLD.jenis_kelamin THEN changed := array_append(changed,'jenis_kelamin'); END IF;
  IF NEW.tempat_lahir IS DISTINCT FROM OLD.tempat_lahir THEN changed := array_append(changed,'tempat_lahir'); END IF;
  IF NEW.tanggal_lahir IS DISTINCT FROM OLD.tanggal_lahir THEN changed := array_append(changed,'tanggal_lahir'); END IF;
  IF NEW.departemen_id IS DISTINCT FROM OLD.departemen_id THEN changed := array_append(changed,'departemen_id'); END IF;
  IF NEW.angkatan_id IS DISTINCT FROM OLD.angkatan_id THEN changed := array_append(changed,'angkatan_id'); END IF;
  PERFORM public.spmb_invalidate_verification(NEW.id, changed);
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS spmb_invalidate_siswa_verification ON public.siswa;
CREATE TRIGGER spmb_invalidate_siswa_verification
AFTER UPDATE OF nama, jenis_kelamin, tempat_lahir, tanggal_lahir, departemen_id, angkatan_id
ON public.siswa FOR EACH ROW EXECUTE FUNCTION public.spmb_invalidate_on_siswa_change();

CREATE OR REPLACE FUNCTION public.spmb_invalidate_on_detail_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE changed text[] := '{}'::text[];
BEGIN
  IF NEW.tahun_ajaran_id IS DISTINCT FROM OLD.tahun_ajaran_id THEN changed := array_append(changed,'tahun_ajaran_id'); END IF;
  IF NEW.nik IS DISTINCT FROM OLD.nik THEN changed := array_append(changed,'nik'); END IF;
  IF NEW.no_kk IS DISTINCT FROM OLD.no_kk THEN changed := array_append(changed,'no_kk'); END IF;
  IF NEW.kategori IS DISTINCT FROM OLD.kategori THEN changed := array_append(changed,'kategori'); END IF;
  IF NEW.status_asrama IS DISTINCT FROM OLD.status_asrama THEN changed := array_append(changed,'status_asrama'); END IF;
  IF NEW.anak_ke IS DISTINCT FROM OLD.anak_ke THEN changed := array_append(changed,'anak_ke'); END IF;
  IF NEW.jumlah_bersaudara IS DISTINCT FROM OLD.jumlah_bersaudara THEN changed := array_append(changed,'jumlah_bersaudara'); END IF;
  IF NEW.jarak_rumah_km IS DISTINCT FROM OLD.jarak_rumah_km THEN changed := array_append(changed,'jarak_rumah_km'); END IF;
  IF NEW.waktu_perjalanan_menit IS DISTINCT FROM OLD.waktu_perjalanan_menit THEN changed := array_append(changed,'waktu_perjalanan_menit'); END IF;
  IF NEW.transportasi IS DISTINCT FROM OLD.transportasi THEN changed := array_append(changed,'transportasi'); END IF;
  IF NEW.kemampuan_iqro IS DISTINCT FROM OLD.kemampuan_iqro THEN changed := array_append(changed,'kemampuan_iqro'); END IF;
  IF NEW.membaca_latin IS DISTINCT FROM OLD.membaca_latin THEN changed := array_append(changed,'membaca_latin'); END IF;
  IF NEW.menulis_latin IS DISTINCT FROM OLD.menulis_latin THEN changed := array_append(changed,'menulis_latin'); END IF;
  IF NEW.hafalan_quran IS DISTINCT FROM OLD.hafalan_quran THEN changed := array_append(changed,'hafalan_quran'); END IF;
  IF NEW.dokumen_kk_path IS DISTINCT FROM OLD.dokumen_kk_path THEN changed := array_append(changed,'dokumen_kk_path'); END IF;
  IF NEW.dokumen_akta_path IS DISTINCT FROM OLD.dokumen_akta_path THEN changed := array_append(changed,'dokumen_akta_path'); END IF;
  PERFORM public.spmb_invalidate_verification(NEW.siswa_id, changed);
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS spmb_invalidate_detail_verification ON public.siswa_detail;
CREATE TRIGGER spmb_invalidate_detail_verification
AFTER UPDATE OF tahun_ajaran_id, nik, no_kk, kategori, status_asrama, anak_ke, jumlah_bersaudara,
  jarak_rumah_km, waktu_perjalanan_menit, transportasi, kemampuan_iqro, membaca_latin,
  menulis_latin, hafalan_quran, dokumen_kk_path, dokumen_akta_path
ON public.siswa_detail FOR EACH ROW EXECUTE FUNCTION public.spmb_invalidate_on_detail_change();

UPDATE public.siswa_detail d
SET spmb_verifikasi_status = CASE WHEN s.terverifikasi THEN 'terverifikasi' ELSE 'belum_verifikasi' END
FROM public.siswa s
WHERE s.id = d.siswa_id AND d.spmb_verifikasi_status = 'belum_verifikasi';

UPDATE public.siswa_detail d
SET spmb_verifikasi_version = (public.spmb_verification_payload(d.siswa_id)->>'version')
FROM public.siswa s
WHERE s.id = d.siswa_id AND s.terverifikasi AND d.spmb_verifikasi_version IS NULL;

CREATE OR REPLACE FUNCTION public.spmb_verification_state_list(p_ids uuid[])
RETURNS TABLE(siswa_id uuid, verification jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid,'admin') THEN RAISE EXCEPTION 'Akses ditolak'; END IF;
  RETURN QUERY SELECT s.id, public.spmb_verification_state(s.id)
  FROM public.siswa s WHERE s.id = ANY(COALESCE(p_ids,'{}'::uuid[]));
END
$$;
REVOKE ALL ON FUNCTION public.spmb_verification_state_list(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spmb_verification_state_list(uuid[]) TO authenticated;
