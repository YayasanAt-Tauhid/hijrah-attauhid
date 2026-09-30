-- Bulk SPP plans reuse the existing atomic billing and phase-aware planning functions.
CREATE OR REPLACE FUNCTION public.simpan_tarif_generate_rencana_massal_atomik(
 p_tarif_rows jsonb,
 p_tahun_akademik_id uuid,
 p_jenis_id uuid,
 p_generate_groups jsonb,
 p_rencana_rows jsonb,
 p_rencana_mulai date,
 p_bulan_terakhir integer DEFAULT 6
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public
AS $function$
DECLARE
 v_uid uuid := auth.uid();
 v_jenis record;
 v_ta record;
 v_row record;
 v_cohort record;
 v_groups jsonb;
 v_tarifs jsonb;
 v_plans jsonb := '[]'::jsonb;
 v_plan jsonb;
 v_result jsonb;
 v_class uuid;
 v_nominal numeric;
 v_end date;
 v_count integer;
 v_inserted integer := 0;
 v_generated integer := 0;
 v_skipped integer := 0;
 v_scheduled integer := 0;
BEGIN
 IF v_uid IS NULL OR NOT (public.has_role(v_uid,'admin') OR public.has_role(v_uid,'keuangan')) THEN
  RAISE EXCEPTION 'Anda tidak memiliki akses untuk membuat rencana tagihan massal';
 END IF;
 IF p_rencana_rows IS NULL OR jsonb_typeof(p_rencana_rows)<>'array' THEN
  RAISE EXCEPTION 'Daftar rencana siswa tidak valid';
 END IF;
 v_count := jsonb_array_length(p_rencana_rows);
 IF v_count<1 OR v_count>500 THEN RAISE EXCEPTION 'Pilih 1 sampai 500 siswa per batch'; END IF;
 IF p_bulan_terakhir IS NULL OR p_bulan_terakhir NOT IN (4,5,6) THEN
  RAISE EXCEPTION 'Bulan terakhir SPP harus April, Mei, atau Juni';
 END IF;
 IF p_tarif_rows IS NULL OR jsonb_typeof(p_tarif_rows)<>'array'
 OR p_generate_groups IS NULL OR jsonb_typeof(p_generate_groups)<>'array'
 OR jsonb_array_length(p_generate_groups)=0 THEN
  RAISE EXCEPTION 'Format tarif atau periode tagihan tidak valid';
 END IF;
 SELECT * INTO v_jenis FROM public.jenis_pembayaran WHERE id=p_jenis_id AND aktif;
 IF NOT FOUND OR v_jenis.tipe<>'bulanan' OR lower(btrim(v_jenis.nama)) !~ '^spp([[:space:]-]|$)' THEN
  RAISE EXCEPTION 'Rencana massal sampai akhir jenjang hanya berlaku untuk SPP';
 END IF;
 SELECT * INTO STRICT v_ta FROM public.tahun_ajaran WHERE id=p_tahun_akademik_id;
 IF p_rencana_mulai IS NULL OR p_rencana_mulai<>date_trunc('month',p_rencana_mulai)::date
 OR p_rencana_mulai NOT BETWEEN v_ta.tanggal_mulai AND v_ta.tanggal_selesai THEN
  RAISE EXCEPTION 'Bulan mulai harus berada dalam Tahun Ajaran terpilih';
 END IF;
 IF EXISTS (
  SELECT 1 FROM jsonb_to_recordset(p_rencana_rows) x(siswa_id uuid,nominal numeric)
  WHERE x.siswa_id IS NULL OR x.nominal IS NULL OR x.nominal<=0
 ) OR (SELECT count(DISTINCT x.siswa_id) FROM jsonb_to_recordset(p_rencana_rows) x(siswa_id uuid))<>v_count THEN
  RAISE EXCEPTION 'Siswa duplikat atau nominal SPP tidak valid';
 END IF;
 IF EXISTS (
  SELECT 1 FROM jsonb_to_recordset(p_tarif_rows) t(siswa_id uuid,jenis_id uuid,nominal numeric)
  LEFT JOIN jsonb_to_recordset(p_rencana_rows) r(siswa_id uuid,nominal numeric) ON r.siswa_id=t.siswa_id
  WHERE r.siswa_id IS NULL OR t.jenis_id IS DISTINCT FROM p_jenis_id OR t.nominal IS DISTINCT FROM r.nominal
 ) THEN RAISE EXCEPTION 'Tarif tidak sesuai daftar siswa dan nominal rencana'; END IF;

 -- Lock students in a consistent order so concurrent batches cannot create duplicate plans.
 FOR v_row IN
  SELECT * FROM jsonb_to_recordset(p_rencana_rows) x(siswa_id uuid,nominal numeric) ORDER BY siswa_id
 LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(v_row.siswa_id::text||':'||p_jenis_id::text,0));
  PERFORM 1 FROM public.siswa
  WHERE id=v_row.siswa_id AND status='aktif'
   AND (v_jenis.departemen_id IS NULL OR departemen_id=v_jenis.departemen_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Siswa tidak aktif atau lembaganya tidak sesuai: %',v_row.siswa_id; END IF;
  SELECT ks.kelas_id INTO v_class FROM public.kelas_siswa ks
  WHERE ks.siswa_id=v_row.siswa_id AND ks.tahun_ajaran_id=p_tahun_akademik_id AND ks.aktif
  ORDER BY ks.id LIMIT 1;
  IF v_class IS NULL THEN RAISE EXCEPTION 'Kelas aktif pada Tahun Ajaran terpilih belum tersedia: %',v_row.siswa_id; END IF;
  v_end := public.hitung_akhir_jenjang_siswa(v_row.siswa_id,p_tahun_akademik_id,v_class);
  v_end := (make_date(extract(year FROM v_end)::int,p_bulan_terakhir,1)+interval '1 month - 1 day')::date;
  IF v_end IS NULL OR v_end<p_rencana_mulai THEN
   RAISE EXCEPTION 'Bulan mulai melewati akhir jenjang siswa: %',v_row.siswa_id;
  END IF;
  v_plan := public.aktifkan_rencana_tagihan_sampai_akhir_jenjang(
   v_row.siswa_id,p_jenis_id,v_row.nominal,p_rencana_mulai,p_tahun_akademik_id,v_class);
  UPDATE public.rencana_tagihan_siswa SET bulan_terakhir=p_bulan_terakhir,selesai=v_end
  WHERE id=(v_plan->>'rencana_id')::uuid RETURNING selesai INTO v_end;
  v_plans := v_plans || jsonb_build_array(v_plan || jsonb_build_object(
   'siswa_id',v_row.siswa_id,'nominal',v_row.nominal,'kelas_id',v_class,'selesai',v_end));
 END LOOP;

 -- One billing call per graduation cohort; first-year months are clipped at graduation.
 FOR v_cohort IN
  SELECT selesai,array_agg(siswa_id ORDER BY siswa_id) ids
  FROM jsonb_to_recordset(v_plans) x(siswa_id uuid,selesai date) GROUP BY selesai
 LOOP
  SELECT coalesce(jsonb_agg(jsonb_build_object('tahun_buku_id',g.tahun_buku_id,'bulan_list',q.months)),'[]'::jsonb)
  INTO v_groups
  FROM jsonb_to_recordset(p_generate_groups) g(tahun_buku_id uuid,bulan_list jsonb)
  JOIN public.tahun_buku tb ON tb.id=g.tahun_buku_id
  CROSS JOIN LATERAL (
   SELECT jsonb_agg((m.value#>>'{}')::int) months
   FROM jsonb_array_elements(g.bulan_list) m(value)
   WHERE make_date(extract(year FROM tb.tanggal_mulai)::int,(m.value#>>'{}')::int,1)
    BETWEEN p_rencana_mulai AND v_cohort.selesai
    AND make_date(extract(year FROM tb.tanggal_mulai)::int,(m.value#>>'{}')::int,1)
     BETWEEN v_ta.tanggal_mulai AND v_ta.tanggal_selesai
  ) q WHERE q.months IS NOT NULL;
  IF jsonb_array_length(v_groups)=0 THEN RAISE EXCEPTION 'Tidak ada bulan tagihan yang sesuai periode rencana'; END IF;
  SELECT coalesce(jsonb_agg(value),'[]'::jsonb) INTO v_tarifs FROM jsonb_array_elements(p_tarif_rows)
  WHERE (value->>'siswa_id')::uuid=ANY(v_cohort.ids);
  v_result := public.simpan_tarif_dan_generate_atomik(
   v_tarifs,p_tahun_akademik_id,p_jenis_id,v_groups,NULL,v_cohort.ids);
  v_inserted := v_inserted+coalesce((v_result->>'tarif_inserted')::int,0);
  v_generated := v_generated+coalesce((v_result->>'generated')::int,0);
  v_skipped := v_skipped+coalesce((v_result->>'skipped')::int,0);
  v_scheduled := v_scheduled+coalesce((v_result->>'scheduled')::int,0);
  FOR v_row IN
   SELECT * FROM jsonb_to_recordset(v_plans) x(siswa_id uuid,nominal numeric,kelas_id uuid)
   WHERE siswa_id=ANY(v_cohort.ids)
  LOOP
   IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_groups) g(tahun_buku_id uuid)
    WHERE public.get_tarif_siswa(p_jenis_id,v_row.siswa_id,v_row.kelas_id,g.tahun_buku_id,
     (SELECT angkatan_id FROM public.siswa WHERE id=v_row.siswa_id)) IS DISTINCT FROM v_row.nominal
   ) THEN RAISE EXCEPTION 'Nominal rencana berbeda dengan tarif efektif siswa %. Edit tarif lama terlebih dahulu.',v_row.siswa_id; END IF;
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('success',true,'tarif_inserted',v_inserted,'generated',v_generated,
  'skipped',v_skipped,'scheduled',v_scheduled,'sampai_akhir_jenjang',true,
  'rencana_count',v_count,'rencana_massal',v_plans,'bulan_terakhir',p_bulan_terakhir);
END;
$function$;
REVOKE ALL ON FUNCTION public.simpan_tarif_generate_rencana_massal_atomik(jsonb,uuid,uuid,jsonb,jsonb,date,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.simpan_tarif_generate_rencana_massal_atomik(jsonb,uuid,uuid,jsonb,jsonb,date,integer) TO authenticated;
