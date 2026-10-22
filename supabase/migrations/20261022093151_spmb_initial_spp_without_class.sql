-- SPP awal tanpa kelas tetap memakai periode layanan, tahun akademik,
-- snapshot asrama, keringanan dan jurnal yang sama dengan generator reguler.
-- Tidak membuat atau mengubah tagihan siswa yang sudah ada.
DO $preflight$
BEGIN
  IF (SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.oid=
      'public.generate_tagihan_batch(uuid,uuid,integer,uuid,jsonb,uuid)'::regprocedure)
      IS DISTINCT FROM 'b4c6f6899443170ca7396cce46365e4e'
     OR (SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.oid=
      'public.guard_spmb_spp_activation()'::regprocedure) IS DISTINCT FROM '5af7a56bedb919c76c48c7be29bac911'
     OR (SELECT md5(pg_get_functiondef('public.guard_tagihan_spp_tarif()'::regprocedure))) IS DISTINCT FROM '86ae434266e86b9d000134ae37556e11' THEN
    RAISE EXCEPTION 'Definisi generator/guard berubah sejak audit; periksa ulang sebelum migrasi';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.generate_tagihan_batch(p_jenis_id uuid, p_tahun_ajaran_id uuid, p_bulan integer, p_departemen_id uuid, p_siswa_list jsonb, p_created_by uuid)
 RETURNS TABLE(generated integer, skipped integer, scheduled integer, errors text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_jenis record;
  v_piutang_akun_id uuid;
  v_potongan_akun_id uuid;
  v_potongan_global_id uuid;
  v_tahun_sekarang integer := extract(year from now() AT TIME ZONE 'Asia/Jakarta');
  v_tanggal date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_row record;
  v_bruto numeric;
  v_diskon numeric;
  v_netto numeric;
  v_siswa_diskon_id uuid;
  v_jurnal_id uuid;
  v_nomor text;
  v_generated integer := 0;
  v_skipped integer := 0;
  v_scheduled integer := 0;
  v_errors text[] := '{}';
  v_bulan_label text;
  v_dept_id uuid;
  v_angkatan_id uuid;
  v_tahun_masuk integer;
  v_jatuh_tempo date;
  v_belum_jatuh_tempo boolean;
  v_status text;
  v_urutan integer;
  v_nama_siswa text;
  v_akademik_id uuid;
  v_akademik_mulai date;
  v_akademik_count integer;
  v_is_pangkal boolean;
  v_is_spp boolean;
  v_spp_snapshot record;
  v_pendapatan_efektif uuid;
  v_pengakuan date;
BEGIN
  SELECT id, nama, tipe, departemen_id, nominal, akun_pendapatan_id, tahun_masuk_dari, tahun_masuk_sampai,
         hari_jatuh_tempo, akun_potongan_id
  INTO v_jenis
  FROM jenis_pembayaran WHERE id = p_jenis_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jenis pembayaran tidak ditemukan';
  END IF;

  IF v_jenis.akun_pendapatan_id IS NULL THEN
    RAISE EXCEPTION 'Akun pendapatan belum diset untuk jenis "%"', v_jenis.nama;
  END IF;

  SELECT akun_id INTO v_piutang_akun_id
  FROM pengaturan_akun WHERE kode_setting = 'piutang_siswa';

  IF v_piutang_akun_id IS NULL THEN
    RAISE EXCEPTION 'Akun piutang siswa belum dikonfigurasi di Pengaturan Akun';
  END IF;

  SELECT akun_id INTO v_potongan_global_id
  FROM pengaturan_akun WHERE kode_setting = 'AKUN_POTONGAN_PENDAPATAN';

  v_potongan_akun_id := COALESCE(v_jenis.akun_potongan_id, v_potongan_global_id);

  v_is_pangkal := upper(btrim(v_jenis.nama)) ~ '^UANG PANGKAL (TK|SD|SMP|SMA|MTA)$';

  v_is_spp := v_jenis.tipe = 'bulanan' AND lower(btrim(v_jenis.nama)) ~ '^spp([[:space:]-]|$)';

  v_bulan_label := CASE WHEN p_bulan IS NOT NULL THEN '-B' || p_bulan ELSE '' END;

  -- Jatuh tempo hanya bergantung pada periode + bulan + jenis, jadi cukup
  -- dihitung sekali untuk seluruh batch (satu panggilan = satu bulan).
  v_jatuh_tempo := hitung_jatuh_tempo_tagihan(
    p_tahun_ajaran_id, p_bulan, v_jenis.hari_jatuh_tempo
  );
  -- Periode tanpa tanggal_mulai -> jatuh tempo tak bisa dihitung. Jangan
  -- diperlakukan sebagai "belum jatuh tempo" (tagihan bisa menggantung selamanya
  -- tanpa pernah jadi piutang); pakai perilaku lama = langsung diakui.
  v_belum_jatuh_tempo := v_jatuh_tempo IS NOT NULL AND v_jatuh_tempo > v_tanggal;
  v_status := CASE WHEN v_belum_jatuh_tempo THEN 'terjadwal' ELSE 'belum_bayar' END;

  FOR v_row IN SELECT * FROM jsonb_to_recordset(p_siswa_list) AS x(siswa_id uuid, kelas_id uuid, tahun_akademik_id uuid)
  LOOP
    BEGIN
      IF EXISTS (
        SELECT 1 FROM tagihan
        WHERE siswa_id = v_row.siswa_id
          AND jenis_id = p_jenis_id
          AND tahun_ajaran_id = p_tahun_ajaran_id
          AND (bulan IS NOT DISTINCT FROM p_bulan)
      ) THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      v_akademik_id := NULL;
      IF v_is_pangkal THEN
        IF p_bulan IS NOT NULL THEN
          RAISE EXCEPTION 'Uang pangkal harus menggunakan tagihan sekali bayar';
        END IF;
        v_akademik_id := v_row.tahun_akademik_id;
        IF v_akademik_id IS NULL THEN
          -- Kompatibilitas caller lama: hanya pilih bila tepat satu TA
          -- dimulai dalam Tahun Buku target, tidak memakai TA aktif.
          SELECT count(*), (array_agg(ta.id))[1]
          INTO v_akademik_count, v_akademik_id
          FROM public.tahun_ajaran ta JOIN public.tahun_buku tb
            ON ta.tanggal_mulai BETWEEN tb.tanggal_mulai AND tb.tanggal_selesai
          WHERE tb.id = p_tahun_ajaran_id;
          IF v_akademik_count <> 1 THEN
            RAISE EXCEPTION 'Pilih tahun ajaran akademik uang pangkal secara eksplisit';
          END IF;
        END IF;
        SELECT ta.tanggal_mulai INTO v_akademik_mulai
        FROM public.tahun_ajaran ta JOIN public.tahun_buku tb
          ON ta.tanggal_mulai BETWEEN tb.tanggal_mulai AND tb.tanggal_selesai
        WHERE ta.id = v_akademik_id AND tb.id = p_tahun_ajaran_id;
        IF v_akademik_mulai IS NULL THEN
          RAISE EXCEPTION 'Tahun Buku uang pangkal harus memuat awal tahun ajaran target';
        END IF;
        v_jatuh_tempo := v_akademik_mulai;
      ELSE
        v_jatuh_tempo := hitung_jatuh_tempo_tagihan(
          p_tahun_ajaran_id, p_bulan, v_jenis.hari_jatuh_tempo
        );
      END IF;
      v_pengakuan := CASE WHEN v_is_spp THEN public.hitung_pengakuan_spp(p_tahun_ajaran_id,p_bulan)
                           ELSE v_jatuh_tempo END;
      IF v_is_spp AND v_pengakuan IS NULL THEN
        RAISE EXCEPTION 'Periode layanan SPP tidak dapat ditentukan';
      END IF;
      IF v_is_spp THEN
        v_akademik_id := v_row.tahun_akademik_id;
        IF v_akademik_id IS NOT NULL THEN
          IF NOT EXISTS (SELECT 1 FROM public.tahun_ajaran ta
            WHERE ta.id=v_akademik_id AND v_pengakuan BETWEEN ta.tanggal_mulai AND ta.tanggal_selesai) THEN
            RAISE EXCEPTION 'Periode layanan SPP tidak sesuai tahun ajaran akademik';
          END IF;
        ELSE
          SELECT count(*), (array_agg(ta.id))[1] INTO v_akademik_count,v_akademik_id
          FROM public.tahun_ajaran ta WHERE v_pengakuan BETWEEN ta.tanggal_mulai AND ta.tanggal_selesai;
          IF v_akademik_count <> 1 THEN v_akademik_id := NULL; END IF;
        END IF;
      END IF;
      v_belum_jatuh_tempo := v_pengakuan IS NOT NULL AND v_pengakuan > v_tanggal;
      v_status := CASE WHEN v_belum_jatuh_tempo THEN 'terjadwal' ELSE 'belum_bayar' END;

      -- Dipakai untuk tier "angkatan" di get_tarif_siswa (override nominal
      -- per angkatan di tarif_tagihan) -- fix bug lama yang selalu kirim NULL.
      SELECT angkatan_id, nama INTO v_angkatan_id, v_nama_siswa FROM siswa WHERE id = v_row.siswa_id;

      -- Scoping tahun masuk: kalau jenis ini punya batas tahun_masuk_dari
      -- dan/atau tahun_masuk_sampai, siswa yang tahun masuknya di luar
      -- rentang (atau tidak bisa ditentukan sama sekali) di-skip.
      IF v_jenis.tahun_masuk_dari IS NOT NULL OR v_jenis.tahun_masuk_sampai IS NOT NULL THEN
        v_tahun_masuk := get_siswa_tahun_masuk(v_row.siswa_id);
        IF v_tahun_masuk IS NULL
           OR (v_jenis.tahun_masuk_dari IS NOT NULL AND v_tahun_masuk < v_jenis.tahun_masuk_dari)
           OR (v_jenis.tahun_masuk_sampai IS NOT NULL AND v_tahun_masuk > v_jenis.tahun_masuk_sampai)
        THEN
          v_skipped := v_skipped + 1;
          CONTINUE;
        END IF;
      END IF;

      -- SPP wajib memakai tarif efektif yang sudah ditetapkan. Master SPP
      -- tidak boleh menjadi sumber nominal agar perbedaan tarif antar siswa
      -- tidak menimbulkan tagihan salah atau "default" yang tak disengaja.
      IF v_jenis.tipe = 'bulanan'
         AND lower(btrim(v_jenis.nama)) ~ '^spp([[:space:]-]|$)'
      THEN
        v_bruto := COALESCE(
          public.nominal_spp_periode(p_jenis_id,v_row.siswa_id,v_pengakuan),
          get_tarif_siswa(
            p_jenis_id, v_row.siswa_id, v_row.kelas_id,
            p_tahun_ajaran_id, v_angkatan_id
          )
        );

        IF v_bruto IS NULL OR v_bruto <= 0 THEN
          v_errors := v_errors || (
            'Tarif SPP belum dikonfigurasi untuk ' ||
            COALESCE(v_nama_siswa, v_row.siswa_id::text) ||
            '. Tetapkan tarif siswa/kelas/angkatan terlebih dahulu.'
          );
          v_skipped := v_skipped + 1;
          CONTINUE;
        END IF;
      ELSE
        v_bruto := COALESCE(
          get_tarif_siswa(
            p_jenis_id, v_row.siswa_id, v_row.kelas_id,
            p_tahun_ajaran_id, v_angkatan_id
          ),
          v_jenis.nominal,
          0
        );

        IF v_bruto <= 0 THEN
          CONTINUE;
        END IF;
      END IF;

      -- Potongan/keringanan yang berlaku untuk siswa+jenis+bulan ini.
      SELECT d.nominal_diskon, d.siswa_diskon_id
      INTO v_diskon, v_siswa_diskon_id
      FROM hitung_diskon_tagihan(
        v_row.siswa_id, p_jenis_id, p_tahun_ajaran_id, p_bulan, v_bruto
      ) d;

      v_diskon := COALESCE(v_diskon, 0);
      v_netto  := v_bruto - v_diskon;

      IF v_diskon > 0 AND v_potongan_akun_id IS NULL THEN
        v_errors := v_errors ||
          ('Siswa ' || v_row.siswa_id || ': akun potongan/keringanan belum dikonfigurasi');
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      -- Tentukan departemen per-siswa: parameter eksplisit > kelas siswa > data siswa
      v_dept_id := p_departemen_id;
      IF v_dept_id IS NULL AND v_row.kelas_id IS NOT NULL THEN
        SELECT departemen_id INTO v_dept_id FROM kelas WHERE id = v_row.kelas_id;
      END IF;
      IF v_dept_id IS NULL THEN
        SELECT departemen_id INTO v_dept_id FROM siswa WHERE id = v_row.siswa_id;
      END IF;

      v_pendapatan_efektif := v_jenis.akun_pendapatan_id;
      IF v_is_spp THEN
        SELECT * INTO v_spp_snapshot FROM public.snapshot_spp_periode(p_jenis_id,v_row.siswa_id,v_jatuh_tempo);
        v_pendapatan_efektif := v_spp_snapshot.akun_id;
      END IF;

      -- SPP menunggu awal bulan layanan; jatuh tempo tetap tanggal 10.
      IF v_belum_jatuh_tempo THEN
        v_jurnal_id := NULL;
      ELSE
        v_nomor := generate_nomor_jurnal('JPI', v_tahun_sekarang);

        -- Pendapatan diakui BRUTO; potongan berdiri sebagai kontra-pendapatan.
        INSERT INTO jurnal (nomor, tanggal, keterangan, departemen_id, total_debit, total_kredit, status)
        VALUES (
          v_nomor, v_tanggal,
          'Piutang ' || v_jenis.nama || v_bulan_label || ' - ' || COALESCE(v_nama_siswa, v_row.siswa_id::text),
          v_dept_id, v_bruto, v_bruto, 'posted'
        )
        RETURNING id INTO v_jurnal_id;

        v_urutan := 0;

        -- Beasiswa 100% -> netto 0: baris piutang nol tidak perlu dicatat.
        IF v_netto > 0 THEN
          v_urutan := v_urutan + 1;
          INSERT INTO jurnal_detail (jurnal_id, akun_id, keterangan, debit, kredit, urutan)
          VALUES (v_jurnal_id, v_piutang_akun_id, 'Piutang ' || v_jenis.nama, v_netto, 0, v_urutan);
        END IF;

        IF v_diskon > 0 THEN
          v_urutan := v_urutan + 1;
          INSERT INTO jurnal_detail (jurnal_id, akun_id, keterangan, debit, kredit, urutan)
          VALUES (v_jurnal_id, v_potongan_akun_id, 'Keringanan ' || v_jenis.nama, v_diskon, 0, v_urutan);
        END IF;

        v_urutan := v_urutan + 1;
        INSERT INTO jurnal_detail (jurnal_id, akun_id, keterangan, debit, kredit, urutan)
        VALUES (v_jurnal_id, v_pendapatan_efektif, 'Pendapatan ' || v_jenis.nama, 0, v_bruto, v_urutan);
      END IF;

      INSERT INTO tagihan (siswa_id, jenis_id, tahun_ajaran_id, kelas_id, bulan, nominal,
                           nominal_bruto, nominal_diskon, siswa_diskon_id,
                           status, jatuh_tempo, jurnal_piutang_id, created_by, tahun_akademik_id, tanggal_pengakuan, pengakuan_spp_selesai)
      VALUES (v_row.siswa_id, p_jenis_id, p_tahun_ajaran_id, v_row.kelas_id, p_bulan, v_netto,
              v_bruto, v_diskon, v_siswa_diskon_id,
              v_status, v_jatuh_tempo, v_jurnal_id, p_created_by, v_akademik_id,
              CASE WHEN v_is_spp THEN v_pengakuan END, v_is_spp AND NOT v_belum_jatuh_tempo)
      ON CONFLICT (siswa_id, jenis_id, tahun_ajaran_id, (COALESCE(bulan, 0))) DO NOTHING;

      IF FOUND THEN
        v_generated := v_generated + 1;
        IF v_belum_jatuh_tempo THEN
          v_scheduled := v_scheduled + 1;
        END IF;
      ELSE
        -- Baris tagihan kalah balapan dengan proses lain: buang jurnal yang
        -- terlanjur dibuat (kalau memang ada) supaya tidak jadi jurnal yatim.
        IF v_jurnal_id IS NOT NULL THEN
          DELETE FROM jurnal_detail WHERE jurnal_id = v_jurnal_id;
          DELETE FROM jurnal WHERE id = v_jurnal_id;
        END IF;
        v_skipped := v_skipped + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || (('Siswa ' || v_row.siswa_id || ': ' || SQLERRM));
    END;
  END LOOP;

  RETURN QUERY SELECT v_generated, v_skipped, v_scheduled, v_errors;
END;
$function$

;

-- Guard ini tidak mengaktifkan siswa atau rencana SPP otomatis.
-- Pengecualian penempatan hanya untuk penerimaan SPMB lulus yang eksplisit TA-nya.
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
     OR lower(btrim(jp.nama)) !~ '^spp([[:space:]-]|$)' THEN RETURN NEW; END IF;
  recognition_date:=COALESCE(NEW.tanggal_pengakuan,NEW.jatuh_tempo,
    public.hitung_pengakuan_spp(NEW.tahun_ajaran_id,NEW.bulan));
  SELECT sd.tahun_ajaran_id,
    COALESCE(sd.spmb_departemen_tujuan_id,s.departemen_id) AS target_dept,
    COALESCE(sd.spmb_siswa_internal,false) AS internal_student,
    sd.spmb_tanggal_aktivasi,s.status,sd.spmb_status_kelulusan,sd.spmb_status_pendaftaran
  INTO candidate
  FROM public.siswa_detail sd
  JOIN public.siswa s ON s.id=sd.siswa_id
  JOIN public.tahun_ajaran ta ON ta.id=sd.tahun_ajaran_id
  WHERE sd.siswa_id=NEW.siswa_id AND sd.spmb_gelombang_id IS NOT NULL
    AND jp.departemen_id=COALESCE(sd.spmb_departemen_tujuan_id,s.departemen_id)
    AND recognition_date BETWEEN ta.tanggal_mulai AND ta.tanggal_selesai
  ORDER BY sd.spmb_registered_at DESC NULLS LAST LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.tahun_akademik_id=candidate.tahun_ajaran_id
     AND candidate.spmb_status_kelulusan='lulus'
     AND (CASE WHEN candidate.internal_student
       THEN candidate.spmb_status_pendaftaran IN ('diterima','aktif','selesai') AND candidate.status='aktif'
       ELSE candidate.status IN ('diterima','aktif') END)
     AND (NEW.kelas_id IS NULL OR EXISTS (
       SELECT 1 FROM public.kelas_siswa ks JOIN public.kelas k ON k.id=ks.kelas_id
       WHERE ks.siswa_id=NEW.siswa_id AND ks.kelas_id=NEW.kelas_id
         AND ks.tahun_ajaran_id=candidate.tahun_ajaran_id AND ks.aktif
         AND k.departemen_id=candidate.target_dept AND COALESCE(k.aktif,true)
     )) THEN RETURN NEW;
  END IF;

  IF candidate.status IS DISTINCT FROM 'aktif'
    OR (candidate.internal_student AND candidate.spmb_tanggal_aktivasi IS NULL)
    OR NOT EXISTS (
      SELECT 1 FROM public.kelas_siswa ks JOIN public.kelas k ON k.id=ks.kelas_id
      WHERE ks.siswa_id=NEW.siswa_id AND ks.aktif AND ks.kelas_id=NEW.kelas_id
        AND ks.tahun_ajaran_id=candidate.tahun_ajaran_id
        AND k.departemen_id=candidate.target_dept AND COALESCE(k.aktif,true)
    ) THEN
    RAISE EXCEPTION 'SPP awal tanpa kelas memerlukan SPMB lulus/diterima dan tahun ajaran tujuan yang sesuai';
  END IF;
  RETURN NEW;
END;
$function$;

-- SECURITY INVOKER: hak akses tabel mengikuti RLS petugas; generator atomik
-- yang telah ada tetap memeriksa admin/keuangan dengan auth.uid().
CREATE OR REPLACE FUNCTION public.terbitkan_spp_awal_spmb(
  p_siswa_id uuid, p_tahun_akademik_id uuid, p_jenis_id uuid,
  p_bulan_mulai date, p_nominal numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_jp public.jenis_pembayaran;
  v_detail record;
  v_book_id uuid;
  v_count integer;
  v_existing public.tagihan;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL OR NOT (public.has_role(v_uid,'admin') OR public.has_role(v_uid,'keuangan')) THEN
    RAISE EXCEPTION 'Anda tidak memiliki akses untuk menerbitkan SPP awal';
  END IF;
  IF p_siswa_id IS NULL OR p_tahun_akademik_id IS NULL OR p_jenis_id IS NULL
     OR p_bulan_mulai IS NULL OR p_bulan_mulai<>date_trunc('month',p_bulan_mulai)::date
     OR p_nominal IS NULL OR p_nominal<=0 OR p_nominal::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'Siswa, tahun ajaran, bulan layanan dan nominal SPP harus valid';
  END IF;
  SELECT * INTO v_jp FROM public.jenis_pembayaran WHERE id=p_jenis_id AND aktif;
  IF NOT FOUND OR v_jp.tipe<>'bulanan' OR lower(btrim(v_jp.nama)) !~ '^spp([[:space:]-]|$)'
     OR v_jp.departemen_id IS NULL THEN
    RAISE EXCEPTION 'Pilih jenis SPP aktif pada jenjang tujuan';
  END IF;
  SELECT sd.*,s.status AS status_siswa,ta.tanggal_mulai,ta.tanggal_selesai
  INTO v_detail
  FROM public.siswa_detail sd JOIN public.siswa s ON s.id=sd.siswa_id
  JOIN public.tahun_ajaran ta ON ta.id=sd.tahun_ajaran_id
  WHERE sd.siswa_id=p_siswa_id AND sd.tahun_ajaran_id=p_tahun_akademik_id
    AND sd.spmb_gelombang_id IS NOT NULL
    AND COALESCE(sd.spmb_departemen_tujuan_id,s.departemen_id)=v_jp.departemen_id
  ORDER BY sd.spmb_registered_at DESC NULLS LAST LIMIT 1;
  IF NOT FOUND OR v_detail.spmb_status_kelulusan IS DISTINCT FROM 'lulus' THEN
    RAISE EXCEPTION 'Siswa belum lulus SPMB pada tahun ajaran dan jenjang tujuan';
  END IF;
  IF NOT COALESCE(CASE WHEN v_detail.spmb_siswa_internal THEN
      v_detail.spmb_status_pendaftaran IN ('diterima','aktif','selesai') AND v_detail.status_siswa='aktif'
    ELSE v_detail.status_siswa IN ('diterima','aktif') END,false) THEN
    RAISE EXCEPTION 'Siswa belum diterima pada jenjang tujuan';
  END IF;
  IF p_bulan_mulai NOT BETWEEN v_detail.tanggal_mulai AND v_detail.tanggal_selesai THEN
    RAISE EXCEPTION 'Bulan SPP di luar tahun ajaran tujuan';
  END IF;
  SELECT count(*),(array_agg(tb.id))[1] INTO v_count,v_book_id FROM public.tahun_buku tb
  WHERE p_bulan_mulai BETWEEN tb.tanggal_mulai AND tb.tanggal_selesai AND NOT COALESCE(tb.ditutup,false);
  IF v_count<>1 THEN RAISE EXCEPTION 'Tahun Buku terbuka untuk bulan SPP harus tersedia tepat satu'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'spmb-spp-awal:'||p_siswa_id::text||':'||p_jenis_id::text||':'||p_bulan_mulai::text,0));
  SELECT * INTO v_existing FROM public.tagihan t WHERE t.siswa_id=p_siswa_id
    AND t.jenis_id=p_jenis_id AND t.tahun_ajaran_id=v_book_id
    AND t.bulan=extract(month FROM p_bulan_mulai)::integer;
  IF FOUND THEN
    IF v_existing.tahun_akademik_id IS NOT NULL AND v_existing.tahun_akademik_id<>p_tahun_akademik_id THEN
      RAISE EXCEPTION 'Tagihan sudah ada dengan tahun ajaran berbeda; periksa sebelum menerbitkan';
    END IF;
    IF v_existing.status IN ('dibatalkan','dihapusbuku') THEN
      RAISE EXCEPTION 'Tagihan periode ini pernah dibatalkan/dihapusbuku; periksa melalui koreksi tagihan';
    END IF;
    RETURN jsonb_build_object('success',true,'generated',0,'skipped',1,'tagihan_id',v_existing.id);
  END IF;
  IF EXISTS (SELECT 1 FROM public.spp_kategori_periode k
    WHERE k.siswa_id=p_siswa_id AND k.jenis_id=p_jenis_id AND k.periode=p_bulan_mulai
      AND k.nominal_bruto IS DISTINCT FROM p_nominal) THEN
    RAISE EXCEPTION 'Nominal SPP periode ini sudah ditetapkan pada kategori per bulan; periksa nominal sebelum menerbitkan';
  END IF;
  v_result := public.simpan_tarif_generate_dan_rencana_atomik(
    p_tarif_rows=>jsonb_build_array(jsonb_build_object(
      'jenis_id',p_jenis_id,'siswa_id',p_siswa_id,'kelas_id',NULL,'angkatan_id',NULL,
      'tahun_ajaran_id',v_book_id,'nominal',p_nominal,'keterangan','SPP awal SPMB per bulan')),
    p_tahun_akademik_id=>p_tahun_akademik_id,p_jenis_id=>p_jenis_id,
    p_generate_groups=>jsonb_build_array(jsonb_build_object('tahun_buku_id',v_book_id,
      'bulan_list',jsonb_build_array(extract(month FROM p_bulan_mulai)::integer))),
    p_departemen_id=>v_jp.departemen_id,p_siswa_id=>p_siswa_id,
    p_sampai_akhir_jenjang=>false
  );
  IF COALESCE((v_result->>'generated')::integer,0)<>1 THEN
    RAISE EXCEPTION 'SPP awal belum terbentuk; periksa tarif dan periode siswa';
  END IF;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.terbitkan_spp_awal_spmb(uuid,uuid,uuid,date,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.terbitkan_spp_awal_spmb(uuid,uuid,uuid,date,numeric) TO authenticated,service_role;

-- Siswa internal masih berada di jenjang asal. SPP tujuan memerlukan penerimaan SPMB yang cocok.
CREATE OR REPLACE FUNCTION public.guard_tagihan_spp_tarif()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_jenis record;
  v_siswa record;
  v_tarif numeric;
  v_bruto numeric;
  v_periode date;
begin
  select nama, tipe, departemen_id into v_jenis
  from public.jenis_pembayaran where id = new.jenis_id;

  if not found
     or v_jenis.tipe is distinct from 'bulanan'
     or lower(btrim(v_jenis.nama)) !~ '^spp([[:space:]-]|$)'
  then
    return new;
  end if;

  if new.legacy_source_key is not null then
    perform 1
    from migration.legacy_tagihan_snapshot l
    where l.source_key = new.legacy_source_key
      and l.siswa_id = new.siswa_id
      and extract(month from l.period_month)::int is not distinct from new.bulan
      and abs(l.remaining::numeric - new.nominal::numeric) < 0.01;

    if not found then
      raise exception
        'Tagihan SPP legacy tidak cocok dengan snapshot sumber %',
        new.legacy_source_key;
    end if;

    if new.status is distinct from 'belum_bayar'
       or new.jurnal_piutang_id is null
    then
      raise exception
        'Tagihan SPP legacy harus berupa piutang terbuka dengan jurnal asal';
    end if;

    return new;
  end if;

  select nama, departemen_id, angkatan_id into v_siswa
  from public.siswa where id = new.siswa_id;

  if not found then
    raise exception 'Siswa tagihan SPP tidak ditemukan';
  end if;

  if v_jenis.departemen_id is distinct from v_siswa.departemen_id and not exists (
    select 1 from public.siswa_detail sd
    join public.tahun_ajaran ta on ta.id=sd.tahun_ajaran_id
    join public.siswa s on s.id=sd.siswa_id
    where sd.siswa_id=new.siswa_id and sd.tahun_ajaran_id=new.tahun_akademik_id
      and sd.spmb_gelombang_id is not null and sd.spmb_siswa_internal
      and sd.spmb_status_kelulusan='lulus'
      and sd.spmb_status_pendaftaran in ('diterima','aktif','selesai') and s.status='aktif'
      and sd.spmb_departemen_tujuan_id=v_jenis.departemen_id
      and coalesce(new.tanggal_pengakuan,new.jatuh_tempo) between ta.tanggal_mulai and ta.tanggal_selesai
  ) then
    raise exception 'Jenis SPP tidak sesuai lembaga siswa %', v_siswa.nama;
  end if;

  v_periode := coalesce(new.tanggal_pengakuan,new.jatuh_tempo);
  v_tarif := coalesce(
    public.nominal_spp_periode(new.jenis_id,new.siswa_id,v_periode),
    public.get_tarif_siswa(
      new.jenis_id, new.siswa_id, new.kelas_id,
      new.tahun_ajaran_id, v_siswa.angkatan_id
    )
  );

  if v_tarif is null or v_tarif <= 0 then
    raise exception
      'Tarif SPP belum dikonfigurasi untuk %. Tetapkan tarif terlebih dahulu.',
      v_siswa.nama;
  end if;

  v_bruto := coalesce(new.nominal_bruto, new.nominal);
  if round(v_bruto, 2) is distinct from round(v_tarif, 2) then
    raise exception
      'Nominal bruto SPP % tidak sesuai tarif efektif % untuk %',
      v_bruto, v_tarif, v_siswa.nama;
  end if;

  return new;
end;
$function$

;
