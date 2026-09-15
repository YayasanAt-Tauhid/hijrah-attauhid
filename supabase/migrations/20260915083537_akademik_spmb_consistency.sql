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
-- Invoker functions retain the existing table RLS. No grants to anon.
CREATE OR REPLACE FUNCTION public.spmb_readiness(p_siswa_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE
 s public.siswa; d public.siswa_detail; dep public.departemen;
 jenis uuid; nominal numeric; paid numeric; missing text[] := '{}'; has_class boolean;
BEGIN
 SELECT * INTO s FROM siswa WHERE id=p_siswa_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Siswa tidak ditemukan atau akses ditolak'; END IF;
 SELECT * INTO d FROM siswa_detail WHERE siswa_id=s.id;
 SELECT * INTO dep FROM departemen WHERE id=s.departemen_id;
 SELECT jenis_pembayaran_id INTO jenis FROM konfigurasi_pmb WHERE departemen_id=s.departemen_id;
 -- Match existing public checkout tariff resolution. Explicit period payments
 -- must match; legacy checkout has no period and is tied to this registration.
 SELECT COALESCE(get_tarif_siswa(jenis,s.id,NULL,NULL),j.nominal) INTO nominal
 FROM jenis_pembayaran j WHERE j.id=jenis;
 SELECT COALESCE(sum(p.jumlah),0) INTO paid FROM pembayaran p
 WHERE p.siswa_id=s.id AND p.jenis_id=jenis AND p.jurnal_id IS NOT NULL
   AND ((d.tahun_ajaran_id IS NOT NULL AND p.tahun_ajaran_id=d.tahun_ajaran_id)
     OR (p.tahun_ajaran_id IS NULL AND p.tanggal_bayar >= s.created_at::date));
 SELECT EXISTS(SELECT 1 FROM kelas_siswa ks JOIN kelas k ON k.id=ks.kelas_id
 WHERE ks.siswa_id=s.id AND ks.aktif AND ks.tahun_ajaran_id IS NOT NULL
 AND k.departemen_id=s.departemen_id) INTO has_class;
 IF NOT COALESCE(s.terverifikasi,false) THEN missing:=array_append(missing,'verifikasi data'); END IF;
 IF jenis IS NULL THEN missing:=array_append(missing,'konfigurasi pembayaran SPMB');
 ELSIF nominal IS NULL OR nominal<=0 THEN missing:=array_append(missing,'nominal pembayaran SPMB');
 ELSIF paid<nominal THEN missing:=array_append(missing,'pelunasan pembayaran SPMB'); END IF;
 IF s.departemen_id IS NULL THEN missing:=array_append(missing,'lembaga'); END IF;
 IF s.angkatan_id IS NULL OR NOT EXISTS(SELECT 1 FROM angkatan WHERE id=s.angkatan_id AND departemen_id=s.departemen_id) THEN missing:=array_append(missing,'angkatan sesuai lembaga'); END IF;
 IF NOT has_class THEN missing:=array_append(missing,'kelas dan tahun ajaran sesuai lembaga'); END IF;
 IF NULLIF(trim(dep.npsn),'') IS NULL THEN missing:=array_append(missing,'NPSN lembaga'); END IF;
 IF NULLIF(d.dokumen_kk_path,'') IS NULL THEN missing:=array_append(missing,'Kartu Keluarga'); END IF;
 IF NULLIF(d.dokumen_akta_path,'') IS NULL THEN missing:=array_append(missing,'Akta Kelahiran'); END IF;
 IF (upper(trim(dep.kode)) IN ('SMP','SMA','MTA') OR upper(dep.nama) ~ '(^|\s)(SMP|SMA|MTA)(\s|$)') AND d.status_asrama IS NULL THEN missing:=array_append(missing,'pilihan asrama'); END IF;
 RETURN jsonb_build_object('siap',cardinality(missing)=0,'kekurangan',to_jsonb(missing),'configured',jenis IS NOT NULL,'lunas',nominal>0 AND paid>=nominal,'nominal',nominal,'dibayar',paid,'punya_kelas',has_class);
END $$;
REVOKE ALL ON FUNCTION public.spmb_readiness(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.spmb_readiness(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.guard_spmb_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE r jsonb;
BEGIN
 IF OLD.status IN ('calon','diterima') AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('diterima','aktif') THEN
   IF OLD.status='calon' AND NEW.status='aktif' THEN RAISE EXCEPTION 'Terima calon murid melalui SPMB sebelum mengaktifkan'; END IF;
   IF NEW.departemen_id IS DISTINCT FROM OLD.departemen_id OR NEW.angkatan_id IS DISTINCT FROM OLD.angkatan_id THEN RAISE EXCEPTION 'Simpan data akademik sebelum mengubah status SPMB'; END IF;
   r:=spmb_readiness(OLD.id);
   IF NOT (r->>'siap')::boolean THEN RAISE EXCEPTION 'SPMB belum lengkap: %',r->>'kekurangan'; END IF;
   IF NULLIF(trim(NEW.nis),'') IS NULL THEN RAISE EXCEPTION 'NIS wajib dibuat sebelum penerimaan/aktivasi'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_spmb_transition() FROM PUBLIC,anon;
DROP TRIGGER IF EXISTS guard_spmb_transition ON public.siswa;
CREATE TRIGGER guard_spmb_transition BEFORE UPDATE OF status ON public.siswa FOR EACH ROW EXECUTE FUNCTION public.guard_spmb_transition();

CREATE OR REPLACE FUNCTION public.akademik_save_siswa(p_siswa jsonb,p_detail jsonb DEFAULT NULL,p_kelas jsonb DEFAULT NULL,p_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE sid uuid:=p_id; cols text; vals text; assignments text; old_status text; dept uuid; class_id uuid; ta uuid; k text;
BEGIN
 IF auth.uid() IS NULL OR NOT has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Akses ditolak'; END IF;
 IF jsonb_typeof(p_siswa)<>'object' OR (p_detail IS NOT NULL AND jsonb_typeof(p_detail)<>'object') THEN RAISE EXCEPTION 'Data tidak valid'; END IF;
 IF p_id IS NOT NULL THEN
   SELECT status INTO old_status FROM siswa WHERE id=p_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Siswa tidak ditemukan'; END IF;
   IF old_status IN ('calon','diterima') AND COALESCE(p_siswa->>'status',old_status)<>old_status THEN RAISE EXCEPTION 'Ubah status calon murid melalui halaman SPMB'; END IF;
 END IF;
 FOR k IN SELECT jsonb_object_keys(p_siswa) LOOP
   IF k NOT IN ('nama','nis','jenis_kelamin','tempat_lahir','tanggal_lahir','agama','alamat','telepon','email','foto_url','status','angkatan_id','departemen_id') THEN RAISE EXCEPTION 'Kolom siswa tidak diizinkan: %',k; END IF;
 END LOOP;
 dept:=NULLIF(p_siswa->>'departemen_id','')::uuid;
 IF dept IS NULL THEN RAISE EXCEPTION 'Lembaga wajib dipilih'; END IF;
 IF NULLIF(p_siswa->>'angkatan_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM angkatan WHERE id=(p_siswa->>'angkatan_id')::uuid AND departemen_id=dept) THEN RAISE EXCEPTION 'Angkatan tidak sesuai lembaga'; END IF;
 IF p_kelas IS NOT NULL THEN
   class_id:=NULLIF(p_kelas->>'kelas_id','')::uuid; ta:=NULLIF(p_kelas->>'tahun_ajaran_id','')::uuid;
   IF class_id IS NULL OR ta IS NULL THEN RAISE EXCEPTION 'Kelas dan tahun ajaran wajib diisi bersama'; END IF;
   IF NOT EXISTS(SELECT 1 FROM kelas WHERE id=class_id AND departemen_id=dept) THEN RAISE EXCEPTION 'Kelas tidak sesuai lembaga'; END IF;
 ELSIF sid IS NOT NULL AND EXISTS(SELECT 1 FROM kelas_siswa ks JOIN kelas c ON c.id=ks.kelas_id WHERE ks.siswa_id=sid AND ks.aktif AND c.departemen_id<>dept) THEN
   RAISE EXCEPTION 'Pilih kelas yang sesuai sebelum mengubah lembaga';
 END IF;
 SELECT string_agg(format('%I',key),','),string_agg(format('r.%I',key),','),string_agg(format('%I=r.%I',key,key),',') INTO cols,vals,assignments FROM jsonb_object_keys(p_siswa) key;
 IF sid IS NULL THEN
   EXECUTE format('INSERT INTO public.siswa (%s) SELECT %s FROM jsonb_populate_record(NULL::public.siswa,$1) r RETURNING id',cols,vals) INTO sid USING p_siswa;
 ELSE
   EXECUTE format('UPDATE public.siswa s SET %s FROM jsonb_populate_record(NULL::public.siswa,$1) r WHERE s.id=$2',assignments) USING p_siswa,sid;
 END IF;
 IF p_detail IS NOT NULL AND p_detail<>'{}'::jsonb THEN
   FOR k IN SELECT jsonb_object_keys(p_detail) LOOP
     IF k LIKE 'dokumen_%_path' AND NULLIF(p_detail->>k,'') IS NOT NULL AND (p_detail->>k) !~ '^(kk|akta|rapor|ijazah)/[0-9a-f-]+\.(pdf|jpg|jpeg|png)$' THEN RAISE EXCEPTION 'Path dokumen tidak valid'; END IF;
     IF k IN ('id','siswa_id','pmb_payment_token','document_session_id') OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='siswa_detail' AND column_name=k) THEN RAISE EXCEPTION 'Kolom detail tidak diizinkan: %',k; END IF;
   END LOOP;
   SELECT string_agg(format('%I',key),','),string_agg(format('r.%I',key),','),string_agg(format('%I=r.%I',key,key),',') INTO cols,vals,assignments FROM jsonb_object_keys(p_detail) key;
   IF (SELECT count(*) FROM siswa_detail WHERE siswa_id=sid)>1 THEN RAISE EXCEPTION 'Ada detail siswa ganda; periksa data sebelum menyimpan'; END IF;
   IF EXISTS(SELECT 1 FROM siswa_detail WHERE siswa_id=sid) THEN
     EXECUTE format('UPDATE public.siswa_detail d SET %s FROM jsonb_populate_record(NULL::public.siswa_detail,$1) r WHERE d.siswa_id=$2',assignments) USING p_detail,sid;
   ELSE
     EXECUTE format('INSERT INTO public.siswa_detail (siswa_id,%s) SELECT $2,%s FROM jsonb_populate_record(NULL::public.siswa_detail,$1) r',cols,vals) USING p_detail,sid;
   END IF;
 END IF;
 IF p_kelas IS NOT NULL THEN
   UPDATE kelas_siswa SET aktif=false WHERE siswa_id=sid AND aktif;
   INSERT INTO kelas_siswa(siswa_id,kelas_id,tahun_ajaran_id,aktif) VALUES(sid,class_id,ta,true)
   ON CONFLICT(siswa_id,kelas_id,tahun_ajaran_id) DO UPDATE SET aktif=true;
 END IF;
 RETURN jsonb_build_object('id',sid);
END $$;
REVOKE ALL ON FUNCTION public.akademik_save_siswa(jsonb,jsonb,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.akademik_save_siswa(jsonb,jsonb,jsonb,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.akademik_mutasi(p_ids uuid[],p_action text,p_kelas_id uuid DEFAULT NULL,p_tahun_ajaran_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE s public.siswa; target uuid; processed integer:=0;
BEGIN
 IF auth.uid() IS NULL OR NOT has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Akses ditolak'; END IF;
 IF COALESCE(cardinality(p_ids),0)=0 OR p_action NOT IN ('kelas','tinggal','alumni','pindah') THEN RAISE EXCEPTION 'Pilih siswa dan aksi yang valid'; END IF;
 FOR s IN SELECT * FROM siswa WHERE id=ANY(p_ids) ORDER BY id FOR UPDATE LOOP
   IF s.status<>'aktif' THEN RAISE EXCEPTION 'Hanya siswa aktif yang dapat dimutasi'; END IF;
   IF p_action IN ('kelas','tinggal') THEN
     IF p_tahun_ajaran_id IS NULL THEN RAISE EXCEPTION 'Tahun ajaran wajib dipilih'; END IF;
     target:=p_kelas_id;
     IF p_action='tinggal' THEN
       SELECT kelas_id INTO STRICT target FROM kelas_siswa WHERE siswa_id=s.id AND aktif;
     END IF;
     IF target IS NULL OR NOT EXISTS(SELECT 1 FROM kelas WHERE id=target AND departemen_id=s.departemen_id) THEN RAISE EXCEPTION 'Kelas tujuan harus sesuai lembaga siswa'; END IF;
     UPDATE kelas_siswa SET aktif=false WHERE siswa_id=s.id AND aktif;
     INSERT INTO kelas_siswa(siswa_id,kelas_id,tahun_ajaran_id,aktif) VALUES(s.id,target,p_tahun_ajaran_id,true)
     ON CONFLICT(siswa_id,kelas_id,tahun_ajaran_id) DO UPDATE SET aktif=true;
   ELSE
     UPDATE siswa SET status=p_action WHERE id=s.id;
     UPDATE kelas_siswa SET aktif=false WHERE siswa_id=s.id AND aktif;
   END IF;
   processed:=processed+1;
 END LOOP;
 IF processed<>(SELECT count(DISTINCT x) FROM unnest(p_ids) x) THEN RAISE EXCEPTION 'Sebagian siswa tidak ditemukan'; END IF;
 RETURN processed;
END $$;
REVOKE ALL ON FUNCTION public.akademik_mutasi(uuid[],text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.akademik_mutasi(uuid[],text,uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.spmb_readiness_list(p_ids uuid[])
RETURNS TABLE(siswa_id uuid,readiness jsonb) LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT s.id, public.spmb_readiness(s.id) FROM public.siswa s WHERE s.id=ANY(p_ids)
$$;
REVOKE ALL ON FUNCTION public.spmb_readiness_list(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.spmb_readiness_list(uuid[]) TO authenticated;
