-- SK 050/SKep/YAAB/09/2026, lampiran halaman 3-4, khusus TA 2027/2028.
-- Tarif bruto dan keringanan alumni disimpan terpisah. Migrasi tidak menerbitkan tagihan.
CREATE SCHEMA spmb_finance_private;
REVOKE ALL ON SCHEMA spmb_finance_private FROM PUBLIC;
GRANT USAGE ON SCHEMA spmb_finance_private TO authenticated,service_role;

CREATE TABLE public.spmb_tarif_uang_pangkal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tahun_mulai date NOT NULL,
  departemen_kode text NOT NULL CHECK (departemen_kode IN ('TK','SD','SMP','SMA','MTA')),
  program text NOT NULL CHECK (program IN ('umum','asrama','non_asrama','smp','sma')),
  nominal_bruto numeric(15,2) NOT NULL CHECK (nominal_bruto>0),
  alumni_neto_asrama numeric(15,2),
  alumni_neto_non_asrama numeric(15,2),
  sumber_sk text NOT NULL,
  UNIQUE(tahun_mulai,departemen_kode,program),
  CHECK (alumni_neto_asrama IS NULL OR alumni_neto_asrama BETWEEN 0 AND nominal_bruto),
  CHECK (alumni_neto_non_asrama IS NULL OR alumni_neto_non_asrama BETWEEN 0 AND nominal_bruto)
);
ALTER TABLE public.spmb_tarif_uang_pangkal ENABLE ROW LEVEL SECURITY;
CREATE POLICY spmb_tarif_pangkal_staff_read ON public.spmb_tarif_uang_pangkal
FOR SELECT TO authenticated USING (public.has_role((select auth.uid()),'admin') OR public.has_role((select auth.uid()),'keuangan'));
REVOKE ALL ON public.spmb_tarif_uang_pangkal FROM anon,authenticated;
GRANT SELECT ON public.spmb_tarif_uang_pangkal TO authenticated;
GRANT ALL ON public.spmb_tarif_uang_pangkal TO service_role;
INSERT INTO public.spmb_tarif_uang_pangkal
(tahun_mulai,departemen_kode,program,nominal_bruto,alumni_neto_asrama,alumni_neto_non_asrama,sumber_sk)
VALUES
('2027-07-01','TK','umum',4200000,NULL,NULL,'050/SKep/YAAB/09/2026'),
('2027-07-01','SD','umum',9400000,NULL,NULL,'050/SKep/YAAB/09/2026'),
('2027-07-01','SMP','asrama',13100000,NULL,NULL,'050/SKep/YAAB/09/2026'),
('2027-07-01','SMP','non_asrama',10100000,NULL,NULL,'050/SKep/YAAB/09/2026'),
('2027-07-01','SMA','asrama',13100000,5500000,8500000,'050/SKep/YAAB/09/2026'),
('2027-07-01','SMA','non_asrama',10100000,5500000,5500000,'050/SKep/YAAB/09/2026'),
('2027-07-01','MTA','smp',10000000,NULL,NULL,'050/SKep/YAAB/09/2026'),
('2027-07-01','MTA','sma',10000000,4250000,5250000,'050/SKep/YAAB/09/2026');

INSERT INTO public.skema_diskon(nama,kategori,tipe,nilai_default,perlu_approval,aktif,keterangan)
SELECT 'Keringanan Alumni','keringanan','nominal',0,true,true,'Pengajuan alumni sesuai SK biaya pendidikan; nilai nominal mengikuti program dan riwayat asrama, bukan nilai default skema.'
WHERE NOT EXISTS (SELECT 1 FROM public.skema_diskon WHERE lower(btrim(nama))='keringanan alumni');

CREATE TABLE public.spmb_uang_pangkal_verifikasi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  siswa_detail_id uuid NOT NULL UNIQUE REFERENCES public.siswa_detail(id) ON DELETE RESTRICT,
  siswa_id uuid NOT NULL REFERENCES public.siswa(id) ON DELETE RESTRICT,
  tahun_akademik_id uuid NOT NULL REFERENCES public.tahun_ajaran(id) ON DELETE RESTRICT,
  tarif_id uuid NOT NULL REFERENCES public.spmb_tarif_uang_pangkal(id) ON DELETE RESTRICT,
  tagihan_id uuid NOT NULL UNIQUE REFERENCES public.tagihan(id) ON DELETE RESTRICT,
  siswa_diskon_id uuid REFERENCES public.siswa_diskon(id) ON DELETE RESTRICT,
  nominal_bruto numeric(15,2) NOT NULL CHECK (nominal_bruto>0),
  keringanan_diajukan numeric(15,2) NOT NULL DEFAULT 0 CHECK (keringanan_diajukan>=0),
  alumni_asrama text NOT NULL CHECK (alumni_asrama IN ('none','asrama','non_asrama')),
  fase_mta text CHECK (fase_mta IN ('smp','sma')),
  catatan text,
  snapshot jsonb NOT NULL,
  diverifikasi_oleh uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  diverifikasi_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.spmb_uang_pangkal_verifikasi ENABLE ROW LEVEL SECURITY;
CREATE POLICY spmb_pangkal_verifikasi_staff_read ON public.spmb_uang_pangkal_verifikasi
FOR SELECT TO authenticated USING (public.has_role((select auth.uid()),'admin') OR public.has_role((select auth.uid()),'keuangan'));
REVOKE ALL ON public.spmb_uang_pangkal_verifikasi FROM anon,authenticated;
GRANT SELECT ON public.spmb_uang_pangkal_verifikasi TO authenticated;
GRANT ALL ON public.spmb_uang_pangkal_verifikasi TO service_role;

-- Privileged implementation is in a non-exposed schema. Both entry points
-- enforce staff roles, independent of the invoker or supplied student ID.
CREATE FUNCTION spmb_finance_private.preview_pangkal(
  p_siswa_id uuid,p_tahun_akademik_id uuid,p_alumni_asrama text,p_fase_mta text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
  v_sd record;
  v_policy public.spmb_tarif_uang_pangkal;
  v_bill public.tagihan;
  v_audit public.spmb_uang_pangkal_verifikasi;
  v_jenis_id uuid;
  v_count integer;
  v_book_id uuid;
  v_program text;
  v_neto numeric;
  v_discount numeric:=0;
  v_skema_id uuid;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'keuangan')) THEN
    RAISE EXCEPTION 'Anda tidak memiliki akses untuk mengelola uang pangkal SPMB';
  END IF;
  IF p_siswa_id IS NULL OR p_tahun_akademik_id IS NULL OR p_alumni_asrama IS NULL
    OR p_alumni_asrama NOT IN ('none','asrama','non_asrama') THEN
    RAISE EXCEPTION 'Siswa, tahun ajaran dan pilihan alumni harus valid';
  END IF;
  SELECT sd.*,s.nama,s.status AS status_siswa,ta.tanggal_mulai,ta.tanggal_selesai,ta.nama AS tahun_nama,
    d.id AS target_dept,d.kode AS target_kode
  INTO v_sd FROM public.siswa_detail sd JOIN public.siswa s ON s.id=sd.siswa_id
  JOIN public.tahun_ajaran ta ON ta.id=sd.tahun_ajaran_id
  JOIN public.departemen d ON d.id=COALESCE(sd.spmb_departemen_tujuan_id,s.departemen_id)
  WHERE sd.siswa_id=p_siswa_id AND sd.tahun_ajaran_id=p_tahun_akademik_id AND sd.spmb_gelombang_id IS NOT NULL
  ORDER BY sd.spmb_registered_at DESC NULLS LAST,sd.id LIMIT 1;
  IF NOT FOUND OR v_sd.spmb_status_kelulusan IS DISTINCT FROM 'lulus' THEN
    RAISE EXCEPTION 'Siswa belum lulus SPMB pada tahun ajaran tujuan';
  END IF;
  IF NOT COALESCE(CASE WHEN v_sd.spmb_siswa_internal THEN
      v_sd.spmb_status_pendaftaran IN ('diterima','aktif','selesai') AND v_sd.status_siswa='aktif'
    ELSE v_sd.status_siswa IN ('diterima','aktif') END,false) THEN
    RAISE EXCEPTION 'Siswa harus diterima sebelum uang pangkal diterbitkan';
  END IF;
  IF v_sd.target_kode='MTA' THEN
    IF p_fase_mta IS NULL OR p_fase_mta NOT IN ('smp','sma') THEN
      RAISE EXCEPTION 'Pilih fase masuk MTA setara SMP atau SMA';
    END IF;
    IF v_sd.status_asrama IS DISTINCT FROM 'asrama' THEN RAISE EXCEPTION 'MTA wajib berstatus asrama'; END IF;
    v_program:=p_fase_mta;
  ELSIF v_sd.target_kode IN ('SMP','SMA') THEN
    IF v_sd.status_asrama IS NULL OR v_sd.status_asrama NOT IN ('asrama','non_asrama') THEN
      RAISE EXCEPTION 'Lengkapi status asrama tujuan sebelum menghitung uang pangkal';
    END IF;
    v_program:=v_sd.status_asrama;
  ELSE v_program:='umum';
  END IF;
  IF v_sd.target_kode<>'MTA' AND p_fase_mta IS NOT NULL THEN RAISE EXCEPTION 'Fase hanya berlaku untuk MTA'; END IF;
  SELECT * INTO v_policy FROM public.spmb_tarif_uang_pangkal
    WHERE tahun_mulai=v_sd.tanggal_mulai AND departemen_kode=v_sd.target_kode AND program=v_program;
  IF NOT FOUND OR v_sd.tanggal_selesai<>'2028-06-30'::date THEN
    RAISE EXCEPTION 'Tarif SK uang pangkal untuk tahun ajaran/program ini belum tersedia';
  END IF;
  IF p_alumni_asrama<>'none' THEN
    v_neto:=CASE WHEN p_alumni_asrama='asrama' THEN v_policy.alumni_neto_asrama ELSE v_policy.alumni_neto_non_asrama END;
    IF v_neto IS NULL THEN RAISE EXCEPTION 'Keringanan alumni SMP/MTA setara SMP tidak berlaku pada tujuan ini'; END IF;
    v_discount:=v_policy.nominal_bruto-v_neto;
    SELECT count(*),(array_agg(id))[1] INTO v_count,v_skema_id FROM public.skema_diskon
    WHERE aktif AND lower(btrim(nama))='keringanan alumni' AND tipe='nominal';
    IF v_count<>1 THEN RAISE EXCEPTION 'Skema Keringanan Alumni aktif harus tersedia tepat satu'; END IF;
  END IF;
  SELECT count(*),(array_agg(jp.id))[1] INTO v_count,v_jenis_id FROM public.jenis_pembayaran jp
  WHERE jp.departemen_id=v_sd.target_dept AND jp.aktif AND jp.tipe='sekali'
    AND upper(btrim(jp.nama))='UANG PANGKAL '||v_sd.target_kode;
  IF v_count<>1 THEN RAISE EXCEPTION 'Jenis uang pangkal aktif untuk jenjang tujuan harus tersedia tepat satu'; END IF;
  SELECT count(*),(array_agg(tb.id))[1] INTO v_count,v_book_id FROM public.tahun_buku tb
    WHERE v_sd.tanggal_mulai BETWEEN tb.tanggal_mulai AND tb.tanggal_selesai AND NOT COALESCE(tb.ditutup,false);
  IF v_count<>1 THEN RAISE EXCEPTION 'Tahun Buku terbuka untuk awal tahun ajaran belum tersedia tepat satu'; END IF;
  SELECT * INTO v_bill FROM public.tagihan WHERE siswa_id=p_siswa_id AND jenis_id=v_jenis_id
    AND tahun_ajaran_id=v_book_id AND bulan IS NULL;
  IF v_bill.id IS NOT NULL AND v_bill.tahun_akademik_id IS NOT NULL AND v_bill.tahun_akademik_id<>p_tahun_akademik_id THEN
    RAISE EXCEPTION 'Tagihan yang sudah ada memakai tahun ajaran berbeda; periksa melalui koreksi';
  END IF;
  SELECT * INTO v_audit FROM public.spmb_uang_pangkal_verifikasi WHERE siswa_detail_id=v_sd.id;
  v_result:=jsonb_build_object(
    'siswa_id',p_siswa_id,'nama',v_sd.nama,'siswa_detail_id',v_sd.id,'tahun_akademik_id',p_tahun_akademik_id,
    'tahun_nama',v_sd.tahun_nama,'tanggal_mulai',v_sd.tanggal_mulai,'departemen_id',v_sd.target_dept,
    'departemen_kode',v_sd.target_kode,'status_asrama',v_sd.status_asrama,'program',v_program,
    'alumni_asrama',p_alumni_asrama,'fase_mta',p_fase_mta,'jenis_id',v_jenis_id,'tahun_buku_id',v_book_id,
    'tarif_id',v_policy.id,'sumber_sk',v_policy.sumber_sk,'bruto_acuan',v_policy.nominal_bruto,
    'keringanan_alumni',v_discount,'neto_setelah_disetujui',v_policy.nominal_bruto-v_discount,'skema_diskon_id',v_skema_id,
    'tagihan',CASE WHEN v_bill.id IS NULL THEN NULL ELSE jsonb_build_object('id',v_bill.id,'status',v_bill.status,
      'nominal_bruto',COALESCE(v_bill.nominal_bruto,v_bill.nominal),'nominal',v_bill.nominal,'nominal_diskon',v_bill.nominal_diskon,
      'total_bayar',(SELECT COALESCE(sum(jumlah),0) FROM public.pembayaran WHERE tagihan_id=v_bill.id)) END,
    'verifikasi',CASE WHEN v_audit.id IS NULL THEN NULL ELSE jsonb_build_object('id',v_audit.id,
      'diverifikasi_at',v_audit.diverifikasi_at,'nominal_bruto',v_audit.nominal_bruto,'siswa_diskon_id',v_audit.siswa_diskon_id,
      'alumni_asrama',v_audit.alumni_asrama,'fase_mta',v_audit.fase_mta,'keringanan_diajukan',v_audit.keringanan_diajukan) END
  );
  RETURN v_result||jsonb_build_object('preview_hash',md5(v_result::text));
END;
$function$;
REVOKE ALL ON FUNCTION spmb_finance_private.preview_pangkal(uuid,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION spmb_finance_private.preview_pangkal(uuid,uuid,text,text) TO authenticated,service_role;

CREATE FUNCTION public.preview_uang_pangkal_spmb(p_siswa_id uuid,p_tahun_akademik_id uuid,p_alumni_asrama text DEFAULT 'none',p_fase_mta text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$
  SELECT spmb_finance_private.preview_pangkal(p_siswa_id,p_tahun_akademik_id,p_alumni_asrama,p_fase_mta)
$function$;
REVOKE ALL ON FUNCTION public.preview_uang_pangkal_spmb(uuid,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.preview_uang_pangkal_spmb(uuid,uuid,text,text) TO authenticated,service_role;

CREATE FUNCTION spmb_finance_private.verify_pangkal(
  p_siswa_id uuid,p_tahun_akademik_id uuid,p_alumni_asrama text,p_fase_mta text,
  p_nominal_bruto numeric,p_catatan text,p_preview_hash text,p_confirmed boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
  q jsonb;
  v_detail_id uuid;
  v_audit public.spmb_uang_pangkal_verifikasi;
  v_bill public.tagihan;
  v_discount public.siswa_diskon;
  v_start date;
  v_end date;
  v_amount numeric;
  v_jenis_id uuid;
  v_book_id uuid;
  v_result jsonb;
  v_existing_bill boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'keuangan')) THEN
    RAISE EXCEPTION 'Anda tidak memiliki akses untuk mengelola uang pangkal SPMB';
  END IF;
  IF p_confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION 'Nominal dan data siswa harus diverifikasi terlebih dahulu'; END IF;
  IF p_nominal_bruto IS NULL OR p_nominal_bruto<=0 OR p_nominal_bruto::text IN ('NaN','Infinity','-Infinity')
    OR p_nominal_bruto<>round(p_nominal_bruto,2) THEN RAISE EXCEPTION 'Nominal bruto uang pangkal harus valid'; END IF;
  PERFORM 1 FROM public.siswa_detail WHERE siswa_id=p_siswa_id AND tahun_ajaran_id=p_tahun_akademik_id FOR UPDATE;
  q:=spmb_finance_private.preview_pangkal(p_siswa_id,p_tahun_akademik_id,p_alumni_asrama,p_fase_mta);
  v_detail_id:=(q->>'siswa_detail_id')::uuid;
  v_jenis_id:=(q->>'jenis_id')::uuid; v_book_id:=(q->>'tahun_buku_id')::uuid;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'spmb-once:'||p_siswa_id::text||':'||v_jenis_id::text||':'||p_tahun_akademik_id::text,0));
  SELECT * INTO v_audit FROM public.spmb_uang_pangkal_verifikasi WHERE siswa_detail_id=v_detail_id;
  IF FOUND THEN
    IF v_audit.nominal_bruto<>p_nominal_bruto OR v_audit.alumni_asrama<>p_alumni_asrama
      OR v_audit.fase_mta IS DISTINCT FROM p_fase_mta
      OR v_audit.tahun_akademik_id<>p_tahun_akademik_id OR v_audit.tarif_id<>(q->>'tarif_id')::uuid
      OR (v_audit.snapshot->>'departemen_id') IS DISTINCT FROM (q->>'departemen_id')
      OR (v_audit.snapshot->>'program') IS DISTINCT FROM (q->>'program') THEN
      RAISE EXCEPTION 'Uang pangkal sudah diverifikasi; perubahan harus melalui koreksi tagihan/keringanan';
    END IF;
    RETURN jsonb_build_object('success',true,'skipped',true,'tagihan_id',v_audit.tagihan_id,'siswa_diskon_id',v_audit.siswa_diskon_id);
  END IF;
  -- Re-read after lock: concurrent billing may have committed in the meantime.
  q:=spmb_finance_private.preview_pangkal(p_siswa_id,p_tahun_akademik_id,p_alumni_asrama,p_fase_mta);
  IF p_preview_hash IS DISTINCT FROM q->>'preview_hash' THEN
    RAISE EXCEPTION 'Data/tarif/tagihan berubah sejak pratinjau; muat ulang dan periksa kembali';
  END IF;
  IF p_nominal_bruto<>(q->>'bruto_acuan')::numeric AND length(btrim(COALESCE(p_catatan,'')))<10 THEN
    RAISE EXCEPTION 'Perubahan bruto dari SK memerlukan alasan minimal 10 karakter; potongan harus melalui keringanan';
  END IF;
  v_amount:=(q->>'keringanan_alumni')::numeric;
  IF v_amount>0 AND p_nominal_bruto<>(q->>'bruto_acuan')::numeric THEN
    RAISE EXCEPTION 'Bruto alumni harus mengikuti SK; selisih tarif dicatat melalui keringanan alumni';
  END IF;
  IF v_amount>p_nominal_bruto THEN RAISE EXCEPTION 'Keringanan alumni melebihi nominal bruto'; END IF;
  v_start:=date_trunc('month',(q->>'tanggal_mulai')::date)::date;
  v_end:=(v_start+interval '1 month'-interval '1 day')::date;
  SELECT * INTO v_bill FROM public.tagihan WHERE siswa_id=p_siswa_id AND jenis_id=v_jenis_id
    AND tahun_ajaran_id=v_book_id AND bulan IS NULL FOR UPDATE;
  v_existing_bill:=FOUND;
  IF v_existing_bill THEN
    IF v_bill.status IN ('dibatalkan','dihapusbuku') THEN RAISE EXCEPTION 'Tagihan pernah dibatalkan/dihapusbuku; periksa melalui koreksi'; END IF;
    IF COALESCE(v_bill.nominal_bruto,v_bill.nominal)<>p_nominal_bruto THEN
      RAISE EXCEPTION 'Tagihan sudah ada dengan bruto berbeda; gunakan koreksi, bukan menerbitkan ulang';
    END IF;
  END IF;
  IF v_amount>0 THEN
    SELECT * INTO v_discount FROM public.siswa_diskon WHERE siswa_id=p_siswa_id AND jenis_id=v_jenis_id
      AND status IN ('diajukan','disetujui') AND periode_mulai<=v_end AND periode_selesai>=v_start FOR UPDATE;
    IF FOUND AND (v_discount.skema_diskon_id<>(q->>'skema_diskon_id')::uuid OR
      COALESCE(v_discount.tipe_snapshot,'nominal')<>'nominal' OR COALESCE(v_discount.nilai_snapshot,v_discount.nilai)<>v_amount
      OR v_discount.periode_mulai<>v_start OR v_discount.periode_selesai<>v_end) THEN
      RAISE EXCEPTION 'Sudah ada pengajuan/keringanan lain pada periode ini; periksa sebelum menambah keringanan alumni';
    END IF;
    IF v_discount.id IS NULL AND v_existing_bill AND (v_bill.status NOT IN ('terjadwal','belum_bayar')
      OR EXISTS(SELECT 1 FROM public.pembayaran WHERE tagihan_id=v_bill.id)) THEN
      RAISE EXCEPTION 'Tagihan sudah memiliki pembayaran; keringanan perlu ditinjau melalui alur koreksi';
    END IF;
  END IF;
  IF NOT v_existing_bill THEN
    v_result:=public.simpan_tarif_generate_dan_rencana_atomik(
      p_tarif_rows=>jsonb_build_array(jsonb_build_object('jenis_id',v_jenis_id,'siswa_id',p_siswa_id,
        'kelas_id',NULL,'angkatan_id',NULL,'tahun_ajaran_id',v_book_id,'nominal',p_nominal_bruto,
        'keterangan','Bruto uang pangkal SPMB diverifikasi berdasarkan SK '||(q->>'sumber_sk'))),
      p_tahun_akademik_id=>p_tahun_akademik_id,p_jenis_id=>v_jenis_id,
      p_generate_groups=>jsonb_build_array(jsonb_build_object('tahun_buku_id',v_book_id,'bulan_list',jsonb_build_array(NULL))),
      p_departemen_id=>(q->>'departemen_id')::uuid,p_siswa_id=>p_siswa_id,p_sampai_akhir_jenjang=>false
    );
    SELECT * INTO STRICT v_bill FROM public.tagihan WHERE siswa_id=p_siswa_id AND jenis_id=v_jenis_id
      AND tahun_ajaran_id=v_book_id AND bulan IS NULL;
    IF COALESCE(v_bill.nominal_bruto,v_bill.nominal)<>p_nominal_bruto THEN RAISE EXCEPTION 'Bruto hasil penerbitan tidak sesuai verifikasi'; END IF;
  END IF;
  IF v_amount>0 AND v_discount.id IS NULL THEN
    INSERT INTO public.siswa_diskon(siswa_id,skema_diskon_id,jenis_id,periode_mulai,periode_selesai,
      nilai,status,catatan,diajukan_oleh,tipe_snapshot)
    VALUES(p_siswa_id,(q->>'skema_diskon_id')::uuid,v_jenis_id,v_start,v_end,v_amount,'diajukan',
      'Keringanan alumni uang pangkal berdasarkan SK '||(q->>'sumber_sk')||'. Asrama asal: '||p_alumni_asrama||
      '. Bruto '||p_nominal_bruto::text||'; potongan diajukan '||v_amount::text||'. Tagihan: '||v_bill.id::text||
      CASE WHEN nullif(btrim(p_catatan),'') IS NULL THEN '' ELSE '. '||btrim(p_catatan) END,
      auth.uid(),'nominal') RETURNING * INTO v_discount;
  END IF;
  INSERT INTO public.spmb_uang_pangkal_verifikasi(siswa_detail_id,siswa_id,tahun_akademik_id,tarif_id,tagihan_id,
    siswa_diskon_id,nominal_bruto,keringanan_diajukan,alumni_asrama,fase_mta,catatan,snapshot,diverifikasi_oleh)
  VALUES(v_detail_id,p_siswa_id,p_tahun_akademik_id,(q->>'tarif_id')::uuid,v_bill.id,v_discount.id,
    p_nominal_bruto,v_amount,p_alumni_asrama,p_fase_mta,nullif(btrim(p_catatan),''),q,auth.uid());
  RETURN jsonb_build_object('success',true,'skipped',false,'tagihan_sudah_ada',v_existing_bill,
    'tagihan_id',v_bill.id,'nominal_bruto',COALESCE(v_bill.nominal_bruto,v_bill.nominal),
    'nominal_tagihan',v_bill.nominal,'siswa_diskon_id',v_discount.id,'status_keringanan',v_discount.status);
END;
$function$;
REVOKE ALL ON FUNCTION spmb_finance_private.verify_pangkal(uuid,uuid,text,text,numeric,text,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION spmb_finance_private.verify_pangkal(uuid,uuid,text,text,numeric,text,text,boolean) TO authenticated,service_role;
CREATE FUNCTION public.verifikasi_uang_pangkal_spmb(
  p_siswa_id uuid,p_tahun_akademik_id uuid,p_alumni_asrama text,p_fase_mta text,
  p_nominal_bruto numeric,p_catatan text,p_preview_hash text,p_confirmed boolean
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$
  SELECT spmb_finance_private.verify_pangkal(p_siswa_id,p_tahun_akademik_id,p_alumni_asrama,p_fase_mta,
    p_nominal_bruto,p_catatan,p_preview_hash,p_confirmed)
$function$;
REVOKE ALL ON FUNCTION public.verifikasi_uang_pangkal_spmb(uuid,uuid,text,text,numeric,text,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.verifikasi_uang_pangkal_spmb(uuid,uuid,text,text,numeric,text,text,boolean) TO authenticated,service_role;
