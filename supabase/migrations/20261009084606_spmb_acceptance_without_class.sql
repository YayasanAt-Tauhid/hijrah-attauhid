-- Penerimaan SPMB tidak mensyaratkan penempatan kelas.
-- Tahun ajaran, kelulusan, dokumen, verifikasi dan biaya pendaftaran tetap diperiksa.
-- Nilai punya_kelas tetap dipertahankan bagi pemanggil lama,
-- tetapi bukan lagi syarat untuk status Diterima.

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
   WHERE ks.siswa_id=s.id AND ks.aktif AND ks.tahun_ajaran_id=d.tahun_ajaran_id AND k.departemen_id=target_dept AND COALESCE(k.aktif,true)) INTO has_class;
 END IF;

 IF NOT COALESCE(s.terverifikasi,false) THEN missing:=array_append(missing,'verifikasi data'); END IF;
 IF NOT promo_free THEN
   IF jenis IS NULL THEN missing:=array_append(missing,'konfigurasi pembayaran SPMB');
   ELSIF nominal IS NULL OR nominal<=0 THEN missing:=array_append(missing,'nominal pembayaran SPMB');
   ELSIF paid<nominal THEN missing:=array_append(missing,'pelunasan pembayaran SPMB'); END IF;
 END IF;
 IF target_dept IS NULL THEN missing:=array_append(missing,'lembaga tujuan'); END IF;
 IF target_cohort IS NULL OR NOT EXISTS(SELECT 1 FROM public.angkatan WHERE id=target_cohort AND departemen_id=target_dept) THEN missing:=array_append(missing,'angkatan tujuan sesuai lembaga'); END IF;
 -- Kelas adalah syarat AKTIVASI AKADEMIK, bukan penerimaan SPMB.
 IF d.tahun_ajaran_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.tahun_ajaran ta WHERE ta.id=d.tahun_ajaran_id) THEN missing:=array_append(missing,'tahun ajaran tujuan'); END IF;
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
