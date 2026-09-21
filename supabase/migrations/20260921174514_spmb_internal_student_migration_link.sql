-- Separate current academic placement from SPMB target for internal students.
ALTER TABLE public.siswa_detail
  ADD COLUMN IF NOT EXISTS spmb_departemen_tujuan_id uuid REFERENCES public.departemen(id),
  ADD COLUMN IF NOT EXISTS spmb_angkatan_tujuan_id uuid REFERENCES public.angkatan(id),
  ADD COLUMN IF NOT EXISTS spmb_status_pendaftaran text,
  ADD COLUMN IF NOT EXISTS spmb_siswa_internal boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'siswa_detail_spmb_status_pendaftaran_check'
      AND conrelid = 'public.siswa_detail'::regclass
  ) THEN
    ALTER TABLE public.siswa_detail
      ADD CONSTRAINT siswa_detail_spmb_status_pendaftaran_check
      CHECK (spmb_status_pendaftaran IS NULL OR spmb_status_pendaftaran IN ('calon','diterima','aktif','selesai'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS siswa_detail_spmb_target_dept_idx
  ON public.siswa_detail (spmb_departemen_tujuan_id)
  WHERE spmb_departemen_tujuan_id IS NOT NULL;

COMMENT ON COLUMN public.siswa_detail.spmb_departemen_tujuan_id IS
  'Lembaga tujuan pendaftaran SPMB. Dipisahkan dari siswa.departemen_id agar siswa internal tetap berada di lembaga/kelas aktif saat ini.';
COMMENT ON COLUMN public.siswa_detail.spmb_angkatan_tujuan_id IS
  'Angkatan tujuan SPMB, terpisah dari angkatan akademik siswa yang sedang aktif.';
COMMENT ON COLUMN public.siswa_detail.spmb_status_pendaftaran IS
  'Status proses pendaftaran SPMB yang terpisah dari status akademik siswa.';
COMMENT ON COLUMN public.siswa_detail.spmb_siswa_internal IS
  'True jika pendaftaran SPMB sudah ditautkan ke siswa internal yang masih aktif pada jenjang asal.';

CREATE OR REPLACE FUNCTION public.spmb_seed_target_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.siswa;
BEGIN
  IF NEW.spmb_gelombang_id IS NULL AND NEW.pmb_payment_token IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO s FROM public.siswa WHERE id=NEW.siswa_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  NEW.spmb_departemen_tujuan_id:=COALESCE(NEW.spmb_departemen_tujuan_id,s.departemen_id);
  NEW.spmb_angkatan_tujuan_id:=COALESCE(NEW.spmb_angkatan_tujuan_id,s.angkatan_id);
  NEW.spmb_status_pendaftaran:=COALESCE(NEW.spmb_status_pendaftaran,
    CASE WHEN s.status IN ('calon','diterima','aktif') THEN s.status ELSE 'calon' END);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_spmb_seed_target_fields ON public.siswa_detail;
CREATE TRIGGER trg_spmb_seed_target_fields
BEFORE INSERT OR UPDATE OF spmb_gelombang_id,pmb_payment_token ON public.siswa_detail
FOR EACH ROW EXECUTE FUNCTION public.spmb_seed_target_fields();

UPDATE public.siswa_detail d
SET spmb_departemen_tujuan_id=COALESCE(d.spmb_departemen_tujuan_id,s.departemen_id),
    spmb_angkatan_tujuan_id=COALESCE(d.spmb_angkatan_tujuan_id,s.angkatan_id),
    spmb_status_pendaftaran=COALESCE(d.spmb_status_pendaftaran,
      CASE WHEN s.status IN ('calon','diterima','aktif') THEN s.status ELSE 'calon' END)
FROM public.siswa s
WHERE s.id=d.siswa_id AND (d.spmb_gelombang_id IS NOT NULL OR d.pmb_payment_token IS NOT NULL);

CREATE OR REPLACE FUNCTION public.guard_spmb_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE r jsonb;
BEGIN
 IF current_setting('app.spmb_migration_adopt',true)='1' THEN RETURN NEW; END IF;
 IF OLD.status IN ('calon','diterima') AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('diterima','aktif') THEN
   IF OLD.status='calon' AND NEW.status='aktif' THEN RAISE EXCEPTION 'Terima calon murid melalui SPMB sebelum mengaktifkan'; END IF;
   IF NEW.departemen_id IS DISTINCT FROM OLD.departemen_id OR NEW.angkatan_id IS DISTINCT FROM OLD.angkatan_id THEN RAISE EXCEPTION 'Simpan data akademik sebelum mengubah status SPMB'; END IF;
   r:=spmb_readiness(OLD.id);
   IF NOT (r->>'siap')::boolean THEN RAISE EXCEPTION 'SPMB belum lengkap: %',r->>'kekurangan'; END IF;
   IF NULLIF(trim(NEW.nis),'') IS NULL THEN RAISE EXCEPTION 'NIS wajib dibuat sebelum penerimaan/aktivasi'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.akademik_adopt_spmb_migration(
  p_siswa_id uuid,p_current jsonb,p_kelas jsonb,p_nik_dapodik text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  s public.siswa; d public.siswa_detail; current_dept uuid; current_cohort uuid;
  class_id uuid; academic_year_id uuid; current_nis text; current_nisn text;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'admin_tu')) THEN RAISE EXCEPTION 'Akses ditolak'; END IF;
  IF p_current IS NULL OR jsonb_typeof(p_current)<>'object' OR p_kelas IS NULL OR jsonb_typeof(p_kelas)<>'object' THEN RAISE EXCEPTION 'Data migrasi tidak valid'; END IF;
  SELECT * INTO s FROM public.siswa WHERE id=p_siswa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Siswa SPMB tidak ditemukan'; END IF;
  SELECT * INTO d FROM public.siswa_detail WHERE siswa_id=p_siswa_id FOR UPDATE;
  IF NOT FOUND OR (d.spmb_gelombang_id IS NULL AND d.pmb_payment_token IS NULL) THEN RAISE EXCEPTION 'Record ini bukan pendaftaran SPMB yang dapat ditautkan'; END IF;
  IF s.status<>'calon' AND NOT COALESCE(d.spmb_siswa_internal,false) THEN RAISE EXCEPTION 'Hanya calon SPMB yang dapat diadopsi sebagai siswa aktif saat migrasi'; END IF;

  current_dept:=NULLIF(p_current->>'departemen_id','')::uuid;
  current_cohort:=NULLIF(p_current->>'angkatan_id','')::uuid;
  class_id:=NULLIF(p_kelas->>'kelas_id','')::uuid;
  academic_year_id:=NULLIF(p_kelas->>'tahun_ajaran_id','')::uuid;
  current_nis:=NULLIF(trim(COALESCE(p_current->>'nis','')),'');
  current_nisn:=NULLIF(regexp_replace(COALESCE(p_current->>'nisn',''),'[^0-9]','','g'),'');
  IF current_dept IS NULL OR class_id IS NULL OR academic_year_id IS NULL THEN RAISE EXCEPTION 'Lembaga, kelas, dan tahun ajaran aktif wajib diisi untuk menautkan SPMB'; END IF;
  IF NOT public.can_manage_akademik_departemen(auth.uid(),current_dept) THEN RAISE EXCEPTION 'Akses lembaga asal ditolak'; END IF;
  IF current_nis IS NOT NULL AND length(current_nis)>13 THEN RAISE EXCEPTION 'NIS maksimal 13 karakter'; END IF;
  IF current_nisn IS NOT NULL AND length(current_nisn)<>10 THEN RAISE EXCEPTION 'NISN harus tepat 10 digit'; END IF;
  IF current_cohort IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.angkatan WHERE id=current_cohort AND departemen_id=current_dept) THEN RAISE EXCEPTION 'Angkatan aktif tidak sesuai lembaga asal'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.kelas WHERE id=class_id AND departemen_id=current_dept) THEN RAISE EXCEPTION 'Kelas aktif tidak sesuai lembaga asal'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tahun_ajaran WHERE id=academic_year_id) THEN RAISE EXCEPTION 'Tahun ajaran aktif tidak valid'; END IF;

  UPDATE public.siswa_detail SET
    spmb_departemen_tujuan_id=COALESCE(spmb_departemen_tujuan_id,s.departemen_id),
    spmb_angkatan_tujuan_id=COALESCE(spmb_angkatan_tujuan_id,s.angkatan_id),
    spmb_status_pendaftaran=COALESCE(spmb_status_pendaftaran,CASE WHEN s.status IN ('calon','diterima') THEN s.status ELSE 'calon' END),
    spmb_siswa_internal=true,
    nik_dapodik=COALESCE(NULLIF(trim(p_nik_dapodik),''),nik_dapodik)
  WHERE siswa_id=p_siswa_id;

  PERFORM set_config('app.spmb_migration_adopt','1',true);
  UPDATE public.siswa SET
    nis=COALESCE(current_nis,nis),nisn=COALESCE(current_nisn,nisn),
    departemen_id=current_dept,angkatan_id=current_cohort,status='aktif'
  WHERE id=p_siswa_id;

  UPDATE public.kelas_siswa SET aktif=false WHERE siswa_id=p_siswa_id AND aktif;
  INSERT INTO public.kelas_siswa(siswa_id,kelas_id,tahun_ajaran_id,aktif)
  VALUES(p_siswa_id,class_id,academic_year_id,true)
  ON CONFLICT(siswa_id,kelas_id,tahun_ajaran_id) DO UPDATE SET aktif=true;

  RETURN jsonb_build_object('id',p_siswa_id,'spmb_ditautkan',true,'departemen_aktif_id',current_dept,
    'kelas_aktif_id',class_id,'tahun_ajaran_aktif_id',academic_year_id,
    'spmb_departemen_tujuan_id',COALESCE(d.spmb_departemen_tujuan_id,s.departemen_id),
    'spmb_angkatan_tujuan_id',COALESCE(d.spmb_angkatan_tujuan_id,s.angkatan_id));
END $$;
REVOKE ALL ON FUNCTION public.akademik_adopt_spmb_migration(uuid,jsonb,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.akademik_adopt_spmb_migration(uuid,jsonb,jsonb,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.spmb_set_registration_status(p_siswa_id uuid,p_status text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.siswa_detail;
BEGIN
 SELECT * INTO d FROM public.siswa_detail WHERE siswa_id=p_siswa_id FOR UPDATE;
 IF NOT FOUND OR NOT COALESCE(d.spmb_siswa_internal,false) THEN RAISE EXCEPTION 'Pendaftaran internal tidak ditemukan'; END IF;
 IF p_status NOT IN ('calon','diterima','selesai') THEN RAISE EXCEPTION 'Status pendaftaran SPMB tidak valid'; END IF;
 IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR (public.has_role(auth.uid(),'admin_tu') AND public.can_manage_akademik_departemen(auth.uid(),d.spmb_departemen_tujuan_id))) THEN RAISE EXCEPTION 'Akses ditolak'; END IF;
 IF p_status='diterima' AND NOT COALESCE((public.spmb_readiness(p_siswa_id)->>'siap')::boolean,false) THEN RAISE EXCEPTION 'SPMB belum lengkap untuk diterima'; END IF;
 UPDATE public.siswa_detail SET spmb_status_pendaftaran=p_status WHERE siswa_id=p_siswa_id;
 RETURN p_status;
END $$;
REVOKE ALL ON FUNCTION public.spmb_set_registration_status(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.spmb_set_registration_status(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.spmb_readiness(p_siswa_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public AS $$
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
   finance:=public.spmb_finance_status(s.id,jenis,s.created_at);
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
 RETURN jsonb_build_object('siap',cardinality(missing)=0,'kekurangan',to_jsonb(missing),'configured',jenis IS NOT NULL,
   'lunas',promo_free OR COALESCE(nominal>0 AND paid>=nominal,false),'gratis_pendaftaran',promo_free AND COALESCE(paid,0)=0,
   'tanggal_pembayaran',paid_date,'nominal',nominal,'dibayar',COALESCE(paid,0),'punya_kelas',has_class,
   'siswa_internal',internal_student,'departemen_tujuan_id',target_dept,'angkatan_tujuan_id',target_cohort);
END $$;

DROP POLICY IF EXISTS admin_tu_spmb_target_siswa_select ON public.siswa;
CREATE POLICY admin_tu_spmb_target_siswa_select ON public.siswa FOR SELECT TO authenticated
USING(public.has_role(auth.uid(),'admin_tu') AND EXISTS(
 SELECT 1 FROM public.siswa_detail d WHERE d.siswa_id=siswa.id AND d.spmb_departemen_tujuan_id IS NOT NULL
 AND public.can_manage_akademik_departemen(auth.uid(),d.spmb_departemen_tujuan_id)));

DROP POLICY IF EXISTS admin_tu_spmb_target_detail_select ON public.siswa_detail;
CREATE POLICY admin_tu_spmb_target_detail_select ON public.siswa_detail FOR SELECT TO authenticated
USING(public.has_role(auth.uid(),'admin_tu') AND spmb_departemen_tujuan_id IS NOT NULL
 AND public.can_manage_akademik_departemen(auth.uid(),spmb_departemen_tujuan_id));
