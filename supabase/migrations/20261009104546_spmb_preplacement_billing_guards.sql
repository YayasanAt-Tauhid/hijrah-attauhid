-- Penerimaan tanpa kelas tidak boleh melonggarkan aktivasi akademik.
-- Guard berlaku pada perubahan status dan tagihan SPP baru; histori tidak diubah.
CREATE OR REPLACE FUNCTION public.guard_spmb_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE r jsonb;
BEGIN
 IF current_setting('app.spmb_migration_adopt', true) = '1' THEN
   RETURN NEW;
 END IF;

 IF OLD.status IN ('calon','diterima') AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('diterima','aktif') THEN
   IF OLD.status='calon' AND NEW.status='aktif' THEN RAISE EXCEPTION 'Terima calon murid melalui SPMB sebelum mengaktifkan'; END IF;
   IF NEW.departemen_id IS DISTINCT FROM OLD.departemen_id OR NEW.angkatan_id IS DISTINCT FROM OLD.angkatan_id THEN RAISE EXCEPTION 'Simpan data akademik sebelum mengubah status SPMB'; END IF;
   r:=spmb_readiness(OLD.id);
   IF NOT (r->>'siap')::boolean THEN RAISE EXCEPTION 'SPMB belum lengkap: %',r->>'kekurangan'; END IF;
   IF NEW.status='aktif' AND NOT EXISTS (
     SELECT 1 FROM public.siswa_detail sd
     JOIN public.kelas_siswa ks ON ks.siswa_id=sd.siswa_id
     JOIN public.kelas k ON k.id=ks.kelas_id
     WHERE sd.siswa_id=NEW.id AND ks.aktif
       AND ks.tahun_ajaran_id=sd.tahun_ajaran_id
       AND k.departemen_id=COALESCE(sd.spmb_departemen_tujuan_id,NEW.departemen_id)
       AND COALESCE(k.aktif,true)
   ) THEN
     RAISE EXCEPTION 'Tempatkan murid di kelas dan tahun ajaran tujuan sebelum aktivasi akademik';
   END IF;
   IF NULLIF(trim(NEW.nis),'') IS NULL THEN RAISE EXCEPTION 'NIS wajib dibuat sebelum penerimaan/aktivasi'; END IF;
 END IF;
 RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.guard_spmb_transition() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.guard_spmb_transition() TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.guard_spmb_spp_activation()
RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE
  jp public.jenis_pembayaran;
  candidate record;
  recognition_date date;
BEGIN
  SELECT * INTO jp FROM public.jenis_pembayaran WHERE id=NEW.jenis_id;
  IF jp.tipe IS DISTINCT FROM 'bulanan'
     OR lower(btrim(jp.nama)) !~ '^spp([[:space:]-]|$)' THEN
    RETURN NEW;
  END IF;
  recognition_date:=COALESCE(NEW.tanggal_pengakuan,NEW.jatuh_tempo,
    public.hitung_pengakuan_spp(NEW.tahun_ajaran_id,NEW.bulan));
  SELECT sd.tahun_ajaran_id,
    COALESCE(sd.spmb_departemen_tujuan_id,s.departemen_id) AS target_dept,
    COALESCE(sd.spmb_siswa_internal,false) AS internal_student,
    sd.spmb_tanggal_aktivasi,s.status
  INTO candidate
  FROM public.siswa_detail sd
  JOIN public.siswa s ON s.id=sd.siswa_id
  JOIN public.tahun_ajaran ta ON ta.id=sd.tahun_ajaran_id
  WHERE sd.siswa_id=NEW.siswa_id AND sd.spmb_gelombang_id IS NOT NULL
    AND jp.departemen_id=COALESCE(sd.spmb_departemen_tujuan_id,s.departemen_id)
    AND recognition_date BETWEEN ta.tanggal_mulai AND ta.tanggal_selesai
  ORDER BY sd.spmb_registered_at DESC NULLS LAST
  LIMIT 1;
  IF FOUND AND (
    candidate.status IS DISTINCT FROM 'aktif'
    OR (candidate.internal_student AND candidate.spmb_tanggal_aktivasi IS NULL)
    OR NOT EXISTS (
      SELECT 1 FROM public.kelas_siswa ks
      JOIN public.kelas k ON k.id=ks.kelas_id
      WHERE ks.siswa_id=NEW.siswa_id AND ks.aktif
        AND ks.kelas_id=NEW.kelas_id
        AND ks.tahun_ajaran_id=candidate.tahun_ajaran_id
        AND k.departemen_id=candidate.target_dept
        AND COALESCE(k.aktif,true)
    )
  ) THEN
    RAISE EXCEPTION 'SPP SPMB memerlukan aktivasi akademik dan kelas pada tahun ajaran tujuan';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_spmb_spp_activation() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_spmb_spp_activation() TO service_role;
CREATE TRIGGER trg_guard_spmb_spp_activation
BEFORE INSERT ON public.tagihan FOR EACH ROW
EXECUTE FUNCTION public.guard_spmb_spp_activation();

-- Fallback kelas harus mengikuti lembaga tujuan, termasuk SPMB internal.
CREATE OR REPLACE FUNCTION public.simpan_tarif_dan_generate_atomik(p_tarif_rows jsonb, p_tahun_akademik_id uuid, p_jenis_id uuid, p_generate_groups jsonb, p_departemen_id uuid DEFAULT NULL::uuid, p_siswa_ids uuid[] DEFAULT NULL::uuid[], p_siswa_id uuid DEFAULT NULL::uuid, p_kelas_id uuid DEFAULT NULL::uuid, p_angkatan_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_jenis record;
  v_siswa_list jsonb := '[]'::jsonb;
  v_explicit_ids uuid[] := ARRAY[]::uuid[];
  v_s record;
  v_group record;
  v_month_json jsonb;
  v_bulan integer;
  v_result record;
  v_generated integer := 0;
  v_skipped integer := 0;
  v_scheduled integer := 0;
  v_inserted integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sesi pengguna tidak ditemukan';
  END IF;

  IF NOT (public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'keuangan')) THEN
    RAISE EXCEPTION 'Anda tidak memiliki akses untuk membuat tarif/tagihan';
  END IF;

  IF p_tarif_rows IS NULL OR jsonb_typeof(p_tarif_rows) <> 'array' THEN
    RAISE EXCEPTION 'Format daftar tarif tidak valid';
  END IF;

  IF p_generate_groups IS NULL OR jsonb_typeof(p_generate_groups) <> 'array' OR jsonb_array_length(p_generate_groups) = 0 THEN
    RAISE EXCEPTION 'Periode/bulan generate tagihan belum dipilih';
  END IF;

  SELECT id, nama, tipe, departemen_id, tahun_masuk_dari, tahun_masuk_sampai
  INTO v_jenis
  FROM public.jenis_pembayaran
  WHERE id = p_jenis_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jenis pembayaran tidak ditemukan';
  END IF;

  IF p_departemen_id IS NOT NULL AND v_jenis.departemen_id IS NOT NULL
     AND p_departemen_id <> v_jenis.departemen_id THEN
    RAISE EXCEPTION 'Lembaga tagihan tidak sesuai jenis pembayaran';
  END IF;

  IF p_kelas_id IS NOT NULL AND v_jenis.departemen_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.kelas k
       WHERE k.id=p_kelas_id AND k.departemen_id=v_jenis.departemen_id AND COALESCE(k.aktif,true)
     ) THEN
    RAISE EXCEPTION 'Kelas tagihan tidak sesuai lembaga jenis pembayaran';
  END IF;

  IF p_siswa_ids IS NOT NULL AND cardinality(p_siswa_ids) > 0 THEN
    v_explicit_ids := p_siswa_ids;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('siswa_id', q.siswa_id, 'kelas_id', q.kelas_id)), '[]'::jsonb)
    INTO v_siswa_list
    FROM (
      SELECT sid AS siswa_id,
             (
               SELECT ks.kelas_id
               FROM public.kelas_siswa ks
               WHERE ks.siswa_id = sid
                 AND ks.tahun_ajaran_id = p_tahun_akademik_id
                 AND ks.aktif = true
                 AND (COALESCE(v_jenis.departemen_id,p_departemen_id) IS NULL OR EXISTS (
                   SELECT 1 FROM public.kelas target_k
                   WHERE target_k.id=ks.kelas_id
                     AND target_k.departemen_id=COALESCE(v_jenis.departemen_id,p_departemen_id)
                 ))
               LIMIT 1
             ) AS kelas_id
      FROM unnest(p_siswa_ids) sid
    ) q;
  ELSIF p_siswa_id IS NOT NULL THEN
    v_explicit_ids := ARRAY[p_siswa_id];
    SELECT jsonb_build_array(jsonb_build_object(
      'siswa_id', p_siswa_id,
      'kelas_id', COALESCE(
        p_kelas_id,
        (
          SELECT ks.kelas_id
          FROM public.kelas_siswa ks
          WHERE ks.siswa_id = p_siswa_id
            AND ks.tahun_ajaran_id = p_tahun_akademik_id
            AND ks.aktif = true
                 AND (COALESCE(v_jenis.departemen_id,p_departemen_id) IS NULL OR EXISTS (
                   SELECT 1 FROM public.kelas target_k
                   WHERE target_k.id=ks.kelas_id
                     AND target_k.departemen_id=COALESCE(v_jenis.departemen_id,p_departemen_id)
                 ))
          LIMIT 1
        )
      )
    )) INTO v_siswa_list;
  ELSIF p_kelas_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('siswa_id', ks.siswa_id, 'kelas_id', ks.kelas_id)), '[]'::jsonb)
    INTO v_siswa_list
    FROM public.kelas_siswa ks
    WHERE ks.kelas_id = p_kelas_id
      AND ks.tahun_ajaran_id = p_tahun_akademik_id
      AND ks.aktif = true;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object('siswa_id', q.siswa_id, 'kelas_id', q.kelas_id)), '[]'::jsonb)
    INTO v_siswa_list
    FROM (
      SELECT DISTINCT ON (ks.siswa_id) ks.siswa_id, ks.kelas_id
      FROM public.kelas_siswa ks
      JOIN public.kelas k ON k.id = ks.kelas_id
      JOIN public.siswa s ON s.id = ks.siswa_id
      WHERE ks.tahun_ajaran_id = p_tahun_akademik_id
        AND ks.aktif = true
                 AND (COALESCE(v_jenis.departemen_id,p_departemen_id) IS NULL OR EXISTS (
                   SELECT 1 FROM public.kelas target_k
                   WHERE target_k.id=ks.kelas_id
                     AND target_k.departemen_id=COALESCE(v_jenis.departemen_id,p_departemen_id)
                 ))
        AND (p_departemen_id IS NULL OR k.departemen_id = p_departemen_id)
        AND (p_angkatan_id IS NULL OR s.angkatan_id = p_angkatan_id)
      ORDER BY ks.siswa_id
    ) q;
  END IF;

  IF jsonb_array_length(v_siswa_list) = 0 THEN
    RAISE EXCEPTION 'Tidak ada siswa yang cocok dengan kriteria generate';
  END IF;

  IF cardinality(v_explicit_ids) > 0
     AND (v_jenis.tahun_masuk_dari IS NOT NULL OR v_jenis.tahun_masuk_sampai IS NOT NULL)
  THEN
    FOR v_s IN
      SELECT s.id, s.nama, s.nis, public.get_siswa_tahun_masuk(s.id) AS tahun_masuk
      FROM public.siswa s
      WHERE s.id = ANY(v_explicit_ids)
    LOOP
      IF v_s.tahun_masuk IS NULL THEN
        RAISE EXCEPTION 'Generate dibatalkan: tahun masuk % (%) ke jenjang saat ini belum dapat ditentukan',
          v_s.nama, COALESCE(v_s.nis, '-');
      END IF;

      IF (v_jenis.tahun_masuk_dari IS NOT NULL AND v_s.tahun_masuk < v_jenis.tahun_masuk_dari)
         OR (v_jenis.tahun_masuk_sampai IS NOT NULL AND v_s.tahun_masuk > v_jenis.tahun_masuk_sampai)
      THEN
        RAISE EXCEPTION 'Generate dibatalkan: % (%) tahun masuk %, sedangkan "%" berlaku untuk % sampai %',
          v_s.nama,
          COALESCE(v_s.nis, '-'),
          v_s.tahun_masuk,
          v_jenis.nama,
          COALESCE(v_jenis.tahun_masuk_dari::text, '...'),
          COALESCE(v_jenis.tahun_masuk_sampai::text, '...');
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.tarif_tagihan (
    jenis_id, siswa_id, kelas_id, angkatan_id, tahun_ajaran_id,
    nominal, keterangan
  )
  SELECT
    x.jenis_id, x.siswa_id, x.kelas_id, x.angkatan_id, x.tahun_ajaran_id,
    x.nominal, NULLIF(x.keterangan, '')
  FROM jsonb_to_recordset(p_tarif_rows) AS x(
    jenis_id uuid,
    siswa_id uuid,
    kelas_id uuid,
    angkatan_id uuid,
    tahun_ajaran_id uuid,
    nominal numeric,
    keterangan text
  )
  WHERE x.jenis_id = p_jenis_id;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted <> jsonb_array_length(p_tarif_rows) THEN
    RAISE EXCEPTION 'Sebagian tarif memiliki jenis pembayaran yang tidak sesuai';
  END IF;

  FOR v_group IN
    SELECT * FROM jsonb_to_recordset(p_generate_groups) AS g(tahun_buku_id uuid, bulan_list jsonb)
  LOOP
    IF v_group.tahun_buku_id IS NULL OR v_group.bulan_list IS NULL
       OR jsonb_typeof(v_group.bulan_list) <> 'array'
       OR jsonb_array_length(v_group.bulan_list) = 0
    THEN
      RAISE EXCEPTION 'Konfigurasi periode generate tidak lengkap';
    END IF;

    FOR v_month_json IN SELECT value FROM jsonb_array_elements(v_group.bulan_list)
    LOOP
      v_bulan := CASE
        WHEN v_month_json = 'null'::jsonb THEN NULL
        ELSE (v_month_json #>> '{}')::integer
      END;

      SELECT r.generated, r.skipped, r.scheduled, r.errors
      INTO v_result
      FROM public.generate_tagihan_batch(
        p_jenis_id,
        v_group.tahun_buku_id,
        v_bulan,
        p_departemen_id,
        (SELECT jsonb_agg(x || jsonb_build_object('tahun_akademik_id', p_tahun_akademik_id))
         FROM jsonb_array_elements(v_siswa_list) x),
        v_uid
      ) r;

      IF v_result.errors IS NOT NULL AND cardinality(v_result.errors) > 0 THEN
        RAISE EXCEPTION 'Generate tagihan gagal (bulan %): %', COALESCE(v_bulan::text, '-'), v_result.errors[1];
      END IF;

      v_generated := v_generated + COALESCE(v_result.generated, 0);
      v_skipped := v_skipped + COALESCE(v_result.skipped, 0);
      v_scheduled := v_scheduled + COALESCE(v_result.scheduled, 0);
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'tarif_inserted', v_inserted,
    'generated', v_generated,
    'skipped', v_skipped,
    'scheduled', v_scheduled
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.simpan_tarif_dan_generate_atomik(jsonb,uuid,uuid,jsonb,uuid,uuid[],uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.simpan_tarif_dan_generate_atomik(jsonb,uuid,uuid,jsonb,uuid,uuid[],uuid,uuid,uuid) TO authenticated,service_role;

-- Penerbitan ulang biaya awal adalah no-op, termasuk dua permintaan bersamaan.
CREATE OR REPLACE FUNCTION public.simpan_tarif_generate_dan_rencana_atomik(p_tarif_rows jsonb, p_tahun_akademik_id uuid, p_jenis_id uuid, p_generate_groups jsonb, p_departemen_id uuid DEFAULT NULL::uuid, p_siswa_ids uuid[] DEFAULT NULL::uuid[], p_siswa_id uuid DEFAULT NULL::uuid, p_kelas_id uuid DEFAULT NULL::uuid, p_angkatan_id uuid DEFAULT NULL::uuid, p_sampai_akhir_jenjang boolean DEFAULT false, p_rencana_mulai date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hasil jsonb;
  v_rencana jsonb := NULL;
  v_nominal numeric;
  v_requested_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'keuangan')
  ) THEN
    RAISE EXCEPTION 'Anda tidak memiliki akses untuk membuat tarif/tagihan';
  END IF;
  IF p_siswa_id IS NOT NULL AND p_siswa_ids IS NULL
     AND EXISTS(SELECT 1 FROM public.jenis_pembayaran WHERE id=p_jenis_id AND tipe='sekali')
     AND jsonb_typeof(p_generate_groups)='array'
     AND jsonb_array_length(p_generate_groups)>0 THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'spmb-once:'||p_siswa_id::text||':'||p_jenis_id::text||':'||COALESCE(p_tahun_akademik_id::text,''),0));
    SELECT count(*) INTO v_requested_count FROM jsonb_array_elements(p_generate_groups);
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_generate_groups) g
      WHERE NOT EXISTS (
        SELECT 1 FROM public.tagihan t WHERE t.siswa_id=p_siswa_id
          AND t.jenis_id=p_jenis_id AND t.bulan IS NULL
          AND t.tahun_ajaran_id=(g->>'tahun_buku_id')::uuid
      )
    ) THEN
      RETURN jsonb_build_object('success',true,'tarif_inserted',0,'generated',0,
        'skipped',v_requested_count,'scheduled',0,'sampai_akhir_jenjang',false,'rencana',NULL);
    END IF;
  END IF;
  v_hasil := public.simpan_tarif_dan_generate_atomik(
    p_tarif_rows,
    p_tahun_akademik_id,
    p_jenis_id,
    p_generate_groups,
    p_departemen_id,
    p_siswa_ids,
    p_siswa_id,
    p_kelas_id,
    p_angkatan_id
  );

  IF p_sampai_akhir_jenjang THEN
    IF p_siswa_id IS NULL OR p_siswa_ids IS NOT NULL THEN
      RAISE EXCEPTION 'Rencana sampai akhir jenjang hanya dapat diaktifkan untuk satu siswa';
    END IF;
    IF p_rencana_mulai IS NULL THEN
      RAISE EXCEPTION 'Bulan mulai rencana wajib ditentukan';
    END IF;

    SELECT (x->>'nominal')::numeric
    INTO v_nominal
    FROM jsonb_array_elements(p_tarif_rows) x
    WHERE (x->>'siswa_id')::uuid = p_siswa_id
    ORDER BY (x->>'tahun_ajaran_id') NULLS LAST
    LIMIT 1;

    IF v_nominal IS NULL THEN
      RAISE EXCEPTION 'Nominal tarif siswa untuk rencana tidak ditemukan';
    END IF;

    v_rencana := public.aktifkan_rencana_tagihan_sampai_akhir_jenjang(
      p_siswa_id,
      p_jenis_id,
      v_nominal,
      p_rencana_mulai,
      p_tahun_akademik_id,
      p_kelas_id
    );
  END IF;

  RETURN v_hasil || jsonb_build_object(
    'sampai_akhir_jenjang', p_sampai_akhir_jenjang,
    'rencana', v_rencana
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.simpan_tarif_generate_dan_rencana_atomik(jsonb,uuid,uuid,jsonb,uuid,uuid[],uuid,uuid,uuid,boolean,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.simpan_tarif_generate_dan_rencana_atomik(jsonb,uuid,uuid,jsonb,uuid,uuid[],uuid,uuid,uuid,boolean,date) TO authenticated,service_role;

-- Portal harus menampilkan tagihan siswa diterima dan memakai lembaga tagihan.
-- security_invoker tetap aktif: akses mengikuti RLS tabel sumber.
CREATE OR REPLACE VIEW public.v_tagihan_belum_bayar WITH (security_invoker=true) AS
SELECT t.siswa_id,s.nis,s.nama AS nama_siswa,s.jenis_kelamin,
 k.nama AS kelas_nama,d.id AS departemen_id,d.nama AS departemen_nama,d.kode AS departemen_kode,
 jp.id AS jenis_id,jp.nama AS jenis_nama,
 GREATEST(t.nominal-COALESCE(pay.total_bayar,0),0)::numeric(15,2) AS nominal,
 t.tahun_ajaran_id,
 COALESCE(ta.nama,'Tahun Ajaran '||EXTRACT(year FROM akademik.fallback_mulai)::integer::text||'/'||
   (EXTRACT(year FROM akademik.fallback_mulai)::integer+1)::text) AS tahun_ajaran_nama,
 COALESCE(t.bulan,0) AS bulan,t.status='lunas' AS sudah_bayar,t.pembayaran_id,p.tanggal_bayar,
 COALESCE(ta.tanggal_mulai,akademik.fallback_mulai) AS tahun_ajaran_mulai,
 t.id AS tagihan_id,t.status,t.jatuh_tempo,
 (t.status<>'lunas' AND t.jatuh_tempo IS NOT NULL AND t.jatuh_tempo<CURRENT_DATE) AS menunggak
FROM public.tagihan t
JOIN public.siswa s ON s.id=t.siswa_id
JOIN public.jenis_pembayaran jp ON jp.id=t.jenis_id
LEFT JOIN LATERAL (
 SELECT ks.kelas_id FROM public.kelas_siswa ks
 JOIN public.kelas kc ON kc.id=ks.kelas_id
 WHERE ks.siswa_id=t.siswa_id AND ks.aktif
   AND (t.tahun_akademik_id IS NULL OR ks.tahun_ajaran_id=t.tahun_akademik_id)
   AND (jp.departemen_id IS NULL OR kc.departemen_id=jp.departemen_id)
 ORDER BY ks.id LIMIT 1
) kelas_aktif ON t.kelas_id IS NULL
LEFT JOIN public.kelas k ON k.id=COALESCE(t.kelas_id,kelas_aktif.kelas_id)
 AND (jp.departemen_id IS NULL OR k.departemen_id=jp.departemen_id)
LEFT JOIN public.departemen d ON d.id=COALESCE(jp.departemen_id,k.departemen_id,s.departemen_id)
JOIN public.tahun_buku tb ON tb.id=t.tahun_ajaran_id
CROSS JOIN LATERAL (
 SELECT CASE WHEN COALESCE(t.bulan,0) BETWEEN 1 AND 6
 THEN make_date(EXTRACT(year FROM COALESCE(t.jatuh_tempo,tb.tanggal_mulai))::integer-1,7,1)
 ELSE make_date(EXTRACT(year FROM COALESCE(t.jatuh_tempo,tb.tanggal_mulai))::integer,7,1) END AS fallback_mulai
) akademik
LEFT JOIN LATERAL (
 SELECT ta0.id,ta0.nama,ta0.tanggal_mulai FROM public.tahun_ajaran ta0
 WHERE ta0.id=t.tahun_akademik_id OR (t.tahun_akademik_id IS NULL AND
   t.jatuh_tempo BETWEEN ta0.tanggal_mulai AND ta0.tanggal_selesai)
 ORDER BY (ta0.id=t.tahun_akademik_id) DESC,ta0.tanggal_mulai DESC LIMIT 1
) ta ON true
LEFT JOIN public.pembayaran p ON p.id=t.pembayaran_id
LEFT JOIN LATERAL (
 SELECT COALESCE(sum(px.jumlah),0) AS total_bayar FROM public.pembayaran px WHERE px.tagihan_id=t.id
) pay ON true
WHERE (s.status IN ('aktif','diterima') OR (s.status='calon' AND EXISTS (
 SELECT 1 FROM public.siswa_detail sd WHERE sd.siswa_id=s.id
 AND sd.spmb_status_kelulusan='lulus' AND sd.spmb_gelombang_id IS NOT NULL
)))
AND t.status IN ('terjadwal','belum_bayar','sebagian','lunas');

-- Pembayaran baru menyimpan lembaga jurnal/tagihan, bukan lembaga asal siswa internal.
CREATE OR REPLACE FUNCTION public.proses_pembayaran_atomik(p_siswa_id uuid, p_jenis_id uuid, p_bulan integer, p_jumlah numeric, p_tanggal_bayar date, p_keterangan text, p_departemen_id uuid, p_tahun_ajaran_id uuid, p_is_bayar_dimuka boolean, p_tagihan_id uuid, p_kas_akun_id uuid, p_kredit_akun_id uuid, p_kredit_label text, p_prefix_jurnal text, p_petugas_id uuid, p_jenis_nama text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pembayaran_id       uuid;
  v_jurnal_id           uuid;
  v_nomor_jurnal        text;
  v_tahun               int := EXTRACT(YEAR FROM p_tanggal_bayar)::int;
  v_pegawai_id          uuid;
  v_periode_bayar       uuid;
  v_tahun_target        uuid;
  v_departemen_efektif  uuid := p_departemen_id;
  v_departemen_asal     uuid;
  v_tagihan             public.tagihan;
  v_total_sebelum       numeric := 0;
  v_total_sesudah       numeric := 0;
  v_sisa_sesudah        numeric := 0;
  v_status_sesudah      text;
  v_is_spp boolean;
  v_is_uang_pangkal boolean;
  v_jenis public.jenis_pembayaran;
BEGIN
  IF p_jumlah IS NULL OR p_jumlah <= 0 THEN
    RAISE EXCEPTION 'Jumlah pembayaran harus lebih dari 0';
  END IF;

  IF p_tagihan_id IS NULL AND EXISTS (
    SELECT 1 FROM public.jenis_pembayaran jp WHERE jp.id = p_jenis_id
      AND upper(btrim(jp.nama)) ~ '^UANG PANGKAL (TK|SD|SMP|SMA|MTA)$'
  ) THEN
    RAISE EXCEPTION 'Buat dan pilih tagihan uang pangkal dengan tahun ajaran target terlebih dahulu';
  END IF;

  SELECT * INTO STRICT v_jenis FROM public.jenis_pembayaran WHERE id=p_jenis_id;
  v_departemen_efektif := COALESCE(v_jenis.departemen_id,p_departemen_id);
  v_is_spp := v_jenis.tipe='bulanan' AND lower(btrim(v_jenis.nama)) ~ '^spp([[:space:]-]|$)';
  v_is_uang_pangkal := upper(btrim(v_jenis.nama)) ~ '^UANG PANGKAL (TK|SD|SMP|SMA|MTA)$';
  IF v_is_spp AND p_tagihan_id IS NULL THEN
    RAISE EXCEPTION 'Buat dan pilih tagihan SPP dengan periode layanan terlebih dahulu';
  END IF;

  SELECT pegawai_id INTO v_pegawai_id
  FROM public.users_profile
  WHERE id = p_petugas_id;

  IF v_pegawai_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.pegawai WHERE id = v_pegawai_id) THEN
    v_pegawai_id := NULL;
  END IF;

  IF p_tagihan_id IS NOT NULL THEN
    SELECT * INTO v_tagihan
    FROM public.tagihan
    WHERE id = p_tagihan_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Tagihan tidak ditemukan';
    END IF;

    IF v_tagihan.siswa_id <> p_siswa_id
       OR v_tagihan.jenis_id <> p_jenis_id
       OR v_tagihan.bulan IS DISTINCT FROM p_bulan THEN
      RAISE EXCEPTION 'Tagihan tidak sesuai dengan siswa, jenis, atau periode pembayaran';
    END IF;

    IF v_tagihan.status NOT IN ('belum_bayar', 'sebagian', 'terjadwal') THEN
      RAISE EXCEPTION 'Tagihan sudah lunas atau tidak dapat dibayar';
    END IF;

    SELECT COALESCE(SUM(jumlah), 0)
    INTO v_total_sebelum
    FROM public.pembayaran
    WHERE tagihan_id = p_tagihan_id;

    IF v_total_sebelum >= v_tagihan.nominal THEN
      RAISE EXCEPTION 'Tagihan sudah lunas';
    END IF;

    IF p_jumlah > (v_tagihan.nominal - v_total_sebelum) THEN
      RAISE EXCEPTION 'Jumlah pembayaran melebihi sisa tagihan';
    END IF;

    -- SPP boleh dicicil sejak bulan layanan. Uang Pangkal boleh dicicil sejak
    -- masih terjadwal; selama belum jatuh tempo cicilan tetap merupakan uang muka.
    IF v_tagihan.status = 'terjadwal'
       AND NOT v_is_uang_pangkal
       AND NOT (v_is_spp AND COALESCE(public.tanggal_pengakuan_tagihan(v_tagihan.id) <= p_tanggal_bayar,false))
       AND p_jumlah < (v_tagihan.nominal - v_total_sebelum) THEN
      RAISE EXCEPTION 'Tagihan yang belum jatuh tempo harus dibayar penuh';
    END IF;

    SELECT j.departemen_id
    INTO v_departemen_asal
    FROM public.jurnal j
    WHERE j.id = v_tagihan.jurnal_piutang_id;

    IF v_departemen_asal IS NOT NULL THEN
      v_departemen_efektif := v_departemen_asal;
    END IF;
  END IF;

  -- Tagihan bulan berjalan diakui atomik saat dibayar, tanpa menunggu cron.
  IF v_is_spp AND v_tagihan.jurnal_piutang_id IS NULL AND NOT v_tagihan.pengakuan_spp_selesai
     AND public.tanggal_pengakuan_tagihan(v_tagihan.id) <= p_tanggal_bayar
     AND public.tanggal_pengakuan_tagihan(v_tagihan.id) <= (now() AT TIME ZONE 'Asia/Jakarta')::date THEN
    PERFORM public.posting_spp_tagihan_atomik(v_tagihan.id,NULL);
    SELECT * INTO v_tagihan FROM public.tagihan WHERE id=p_tagihan_id;
  END IF;

  -- SQL menentukan akun berdasarkan jurnal yang benar-benar sudah ada.
  IF v_is_spp THEN
    IF v_tagihan.jurnal_piutang_id IS NOT NULL OR v_tagihan.pengakuan_spp_selesai THEN
      p_is_bayar_dimuka := false;
      SELECT akun_id INTO p_kredit_akun_id FROM public.pengaturan_akun WHERE kode_setting='piutang_siswa';
      p_kredit_label := 'Piutang Siswa'; p_prefix_jurnal := 'JP';
    ELSE
      p_is_bayar_dimuka := true;
      SELECT COALESCE(v_jenis.akun_dimuka_id,pa.akun_id) INTO p_kredit_akun_id
      FROM (SELECT 1) x LEFT JOIN public.pengaturan_akun pa ON pa.kode_setting='AKUN_PENDAPATAN_DIMUKA';
      p_kredit_label := 'Pendapatan Diterima di Muka - '||v_jenis.nama; p_prefix_jurnal := 'JD';
    END IF;
    IF p_kredit_akun_id IS NULL THEN RAISE EXCEPTION 'Akun SPP belum dikonfigurasi'; END IF;
  END IF;

  INSERT INTO public.pembayaran (
    siswa_id, jenis_id, tahun_ajaran_id, bulan,
    jumlah, tanggal_bayar, petugas_id, keterangan, tagihan_id, departemen_id
  )
  VALUES (
    p_siswa_id, p_jenis_id, p_tahun_ajaran_id, p_bulan,
    p_jumlah, p_tanggal_bayar, v_pegawai_id, p_keterangan, p_tagihan_id, v_departemen_efektif
  )
  RETURNING id INTO v_pembayaran_id;

  v_nomor_jurnal := public.generate_nomor_jurnal(p_prefix_jurnal, v_tahun);

  INSERT INTO public.jurnal (
    nomor, tanggal, keterangan, referensi,
    total_debit, total_kredit, status,
    dibuat_oleh, departemen_id
  )
  VALUES (
    v_nomor_jurnal,
    p_tanggal_bayar,
    p_keterangan,
    v_pembayaran_id::text,
    p_jumlah,
    p_jumlah,
    'posted',
    v_pegawai_id,
    v_departemen_efektif
  )
  RETURNING id INTO v_jurnal_id;

  INSERT INTO public.jurnal_detail (jurnal_id, akun_id, keterangan, debit, kredit, urutan)
  VALUES (v_jurnal_id, p_kas_akun_id, 'Penerimaan ' || p_jenis_nama, p_jumlah, 0, 1);

  INSERT INTO public.jurnal_detail (jurnal_id, akun_id, keterangan, debit, kredit, urutan)
  VALUES (v_jurnal_id, p_kredit_akun_id, p_kredit_label, 0, p_jumlah, 2);

  UPDATE public.pembayaran
  SET jurnal_id = v_jurnal_id
  WHERE id = v_pembayaran_id;

  IF p_tagihan_id IS NOT NULL THEN
    v_total_sesudah := v_total_sebelum + p_jumlah;
    v_sisa_sesudah := GREATEST(v_tagihan.nominal - v_total_sesudah, 0);
    v_status_sesudah := CASE
      WHEN v_sisa_sesudah <= 0 THEN 'lunas'
      WHEN p_is_bayar_dimuka AND v_is_uang_pangkal AND v_tagihan.status = 'terjadwal' THEN 'terjadwal'
      ELSE 'sebagian'
    END;

    UPDATE public.tagihan
    SET status = v_status_sesudah,
        pembayaran_id = v_pembayaran_id
    WHERE id = p_tagihan_id;
  ELSE
    UPDATE public.tagihan
    SET status = 'lunas', pembayaran_id = v_pembayaran_id
    WHERE siswa_id        = p_siswa_id
      AND jenis_id        = p_jenis_id
      AND tahun_ajaran_id = p_tahun_ajaran_id
      AND (
        (p_bulan IS NULL AND bulan IS NULL) OR
        (bulan = p_bulan)
      )
      AND status IN ('belum_bayar', 'terjadwal');
  END IF;

  SELECT tahun_ajaran_id INTO v_tahun_target
  FROM public.tagihan
  WHERE id = p_tagihan_id;

  IF p_is_bayar_dimuka THEN
    SELECT id INTO v_periode_bayar
    FROM public.tahun_buku
    WHERE p_tanggal_bayar >= tanggal_mulai
      AND p_tanggal_bayar <= tanggal_selesai
    ORDER BY tanggal_mulai DESC
    LIMIT 1;

    INSERT INTO public.pendapatan_dimuka (
      pembayaran_id, siswa_id, jenis_id,
      tahun_ajaran_pembayaran_id, tahun_ajaran_target_id,
      bulan, jumlah, status, departemen_id
    )
    VALUES (
      v_pembayaran_id, p_siswa_id, p_jenis_id,
      COALESCE(v_periode_bayar, p_tahun_ajaran_id),
      COALESCE(v_tahun_target, p_tahun_ajaran_id),
      p_bulan, p_jumlah, 'pending', v_departemen_efektif
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'diterima_dimuka', p_is_bayar_dimuka,
    'pembayaran_id', v_pembayaran_id,
    'jurnal_id',     v_jurnal_id,
    'nomor_jurnal',  v_nomor_jurnal,
    'status_tagihan', COALESCE(v_status_sesudah, 'lunas'),
    'sisa_tagihan', COALESCE(v_sisa_sesudah, 0)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.proses_pembayaran_atomik(uuid,uuid,integer,numeric,date,text,uuid,uuid,boolean,uuid,uuid,uuid,text,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.proses_pembayaran_atomik(uuid,uuid,integer,numeric,date,text,uuid,uuid,boolean,uuid,uuid,uuid,text,text,uuid,text) TO service_role;
