-- Guard historical approvals that have not been reflected on an invoice.
DO $preflight$
BEGIN
  IF md5(pg_get_functiondef('spmb_finance_private.verify_pangkal(uuid,uuid,text,text,numeric,text,text,boolean)'::regprocedure))<>'67c1ba6c0ce871547814b9a94bf94294' THEN
    RAISE EXCEPTION 'Unexpected verify_pangkal definition; review concurrent changes before migrating';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION spmb_finance_private.verify_pangkal(
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
    -- A previous approval may not have reached any invoice. Do not silently
    -- generate/adopt a full-gross bill while claiming that approval is applied.
    IF v_discount.status='disetujui' AND (NOT v_existing_bill
      OR COALESCE(v_bill.nominal_diskon,0) IS DISTINCT FROM v_amount
      OR v_bill.nominal IS DISTINCT FROM p_nominal_bruto-v_amount) THEN
      RAISE EXCEPTION 'Keringanan alumni sudah disetujui tetapi belum sesuai tagihan; periksa melalui penerapan/koreksi keringanan';
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
