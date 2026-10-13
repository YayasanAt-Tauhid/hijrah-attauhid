-- New policy: every active sibling qualifies in a confirmed family with at
-- least two active students. Retain historical schemes/policies and snapshots.
INSERT INTO public.skema_diskon(nama,kategori,tipe,nilai_default,perlu_approval,aktif,keterangan)
SELECT 'Potongan Kakak-Adik','kakak_adik','nominal',50000,false,true,
       'Berlaku bagi semua anak dalam keluarga dengan minimal dua siswa aktif, termasuk anak pertama.'
WHERE NOT EXISTS (SELECT 1 FROM public.skema_diskon WHERE nama='Potongan Kakak-Adik');

INSERT INTO public.kebijakan_keringanan(
  kode,versi,nama,skema_diskon_id,jenis_id,kelas_regex,tipe,nilai,
  otomatis,perlu_pengajuan,berlaku_mulai,berlaku_selesai,aktif,keterangan
)
SELECT replace(old.kode,'kakak_2_','kakak_semua_'),1,
       'Potongan Kakak-Adik - Semua Saudara Aktif',general.id,old.jenis_id,
       old.kelas_regex,old.tipe,old.nilai,true,false,
       GREATEST(old.berlaku_mulai,DATE '2026-10-01'),old.berlaku_selesai,true,
       'Klarifikasi kebijakan 13 Oktober 2026: minimal dua saudara aktif; setiap anak berhak, tanpa batas urutan anak.'
FROM (
  SELECT DISTINCT ON (kk.jenis_id) kk.*
  FROM public.kebijakan_keringanan kk
  JOIN public.skema_diskon sk ON sk.id=kk.skema_diskon_id
  WHERE sk.nama='Potongan Anak ke-2' AND kk.aktif=true AND kk.otomatis=true
    AND (kk.berlaku_selesai IS NULL OR kk.berlaku_selesai>=DATE '2026-10-01')
    AND kk.kode LIKE 'kakak_2_%'
  ORDER BY kk.jenis_id,kk.berlaku_mulai DESC,kk.versi DESC
) old
JOIN public.skema_diskon general ON general.nama='Potongan Kakak-Adik'
WHERE NOT EXISTS (
  SELECT 1 FROM public.kebijakan_keringanan existing
  WHERE existing.kode=replace(old.kode,'kakak_2_','kakak_semua_') AND existing.versi=1
);

-- Existing SPP bills are valid candidates even without a recurring plan.
-- Family confirmation is scoped; the daily scheduler retains its old RPC.
CREATE OR REPLACE FUNCTION public.sinkronkan_diskon_kakak_adik_keluarga(p_keluarga_id uuid, p_tanggal date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mulai date := date_trunc('month',p_tanggal)::date;
  v_selesai date := (date_trunc('month',p_tanggal)+interval '1 month - 1 day')::date;
  v_row record;
  v_skema_id uuid;
  v_policy public.kebijakan_keringanan;
  v_diskon_id uuid;
  v_created integer := 0;
  v_skipped integer := 0;
  v_applied integer := 0;
  v_policy_skipped integer := 0;
  v_result jsonb;
  v_errors text[] := '{}';
BEGIN
  FOR v_row IN
    WITH anggota AS (
      SELECT
        s.id AS siswa_id,
        s.keluarga_id,
        count(*) OVER (PARTITION BY s.keluarga_id) AS jumlah
      FROM public.siswa s
      WHERE s.status='aktif' AND s.keluarga_id IS NOT NULL
        AND (p_keluarga_id IS NULL OR s.keluarga_id=p_keluarga_id)
    )
    SELECT a.siswa_id,a.keluarga_id,r.jenis_id
    FROM anggota a
    JOIN (
      SELECT r.siswa_id,r.jenis_id
      FROM public.rencana_tagihan_siswa r
      JOIN public.jenis_pembayaran j ON j.id=r.jenis_id
      WHERE r.aktif=true AND j.aktif=true AND j.tipe='bulanan'
        AND j.nama ILIKE 'SPP%'
        AND v_mulai BETWEEN date_trunc('month',r.mulai)::date
                        AND date_trunc('month',r.selesai)::date
      UNION
      SELECT t.siswa_id,t.jenis_id
      FROM public.tagihan t
      JOIN public.jenis_pembayaran j ON j.id=t.jenis_id
      WHERE j.aktif=true AND j.tipe='bulanan' AND j.nama ILIKE 'SPP%'
        AND t.status IN ('terjadwal','belum_bayar')
        AND COALESCE(t.jatuh_tempo,
              public.hitung_bulan_periode_tagihan(t.tahun_ajaran_id,t.bulan))
            BETWEEN v_mulai AND v_selesai
    ) r ON r.siswa_id=a.siswa_id
    WHERE a.jumlah>=2
    ORDER BY a.keluarga_id,a.siswa_id,r.jenis_id
  LOOP
    BEGIN
    -- Serialize cron and family confirmation for the same child/month/type.
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'sibling-discount:' || v_row.siswa_id::text || ':' ||
      v_row.jenis_id::text || ':' || v_mulai::text, 0));

    IF EXISTS (
      SELECT 1
      FROM public.siswa_diskon sd
      WHERE sd.siswa_id=v_row.siswa_id
        AND sd.jenis_id=v_row.jenis_id
        AND sd.status IN ('diajukan','disetujui')
        AND daterange(sd.periode_mulai,sd.periode_selesai,'[]')
            && daterange(v_mulai,v_selesai,'[]')
    ) THEN
      v_skipped := v_skipped+1;
      CONTINUE;
    END IF;

    -- Preserve reductions already present on bills, including imported ones
    -- without a corresponding siswa_diskon record.
    IF EXISTS (
      SELECT 1 FROM public.tagihan t
      WHERE t.siswa_id=v_row.siswa_id AND t.jenis_id=v_row.jenis_id
        AND COALESCE(t.jatuh_tempo,
              public.hitung_bulan_periode_tagihan(t.tahun_ajaran_id,t.bulan))
            BETWEEN v_mulai AND v_selesai
        AND COALESCE(t.nominal_diskon,0)>0
    ) THEN
      v_skipped := v_skipped+1;
      CONTINUE;
    END IF;

    SELECT sk.id INTO v_skema_id
    FROM public.skema_diskon sk
    WHERE sk.aktif=true
      AND sk.kategori='kakak_adik'
      AND sk.nama='Potongan Kakak-Adik'
    LIMIT 1;

    IF v_skema_id IS NULL THEN
      v_policy_skipped := v_policy_skipped+1;
      CONTINUE;
    END IF;

    SELECT kk.* INTO v_policy
    FROM public.kebijakan_keringanan kk
    WHERE kk.aktif=true
      AND kk.skema_diskon_id=v_skema_id
      AND kk.jenis_id=v_row.jenis_id
      AND kk.berlaku_mulai<=p_tanggal
      AND (kk.berlaku_selesai IS NULL OR kk.berlaku_selesai>=p_tanggal)
      AND kk.otomatis=true
    ORDER BY kk.berlaku_mulai DESC,kk.versi DESC
    LIMIT 1;

    IF v_policy.id IS NULL THEN
      v_policy_skipped := v_policy_skipped+1;
      CONTINUE;
    END IF;

    INSERT INTO public.siswa_diskon(
      siswa_id,skema_diskon_id,jenis_id,kebijakan_keringanan_id,
      periode_mulai,periode_selesai,nilai,
      status,catatan,diputuskan_at,diterapkan_at
    )
    VALUES(
      v_row.siswa_id,v_skema_id,v_row.jenis_id,v_policy.id,
      v_mulai,v_selesai,v_policy.nilai,
      'disetujui',
      'Potongan kakak/adik otomatis mengikuti kebijakan '
        || v_policy.kode || ' v' || v_policy.versi::text
        || '; tidak ditumpuk dengan potongan lain.',
      now(),NULL
    )
    RETURNING id INTO v_diskon_id;

    IF EXISTS (
      SELECT 1 FROM public.tagihan t
      WHERE t.siswa_id=v_row.siswa_id
        AND t.jenis_id=v_row.jenis_id
        AND t.status IN ('terjadwal','belum_bayar')
        AND COALESCE(t.jatuh_tempo,
              public.hitung_bulan_periode_tagihan(t.tahun_ajaran_id,t.bulan))
            BETWEEN v_mulai AND v_selesai
    ) THEN
      v_result := public.terapkan_diskon_siswa(v_diskon_id,NULL);
      IF jsonb_array_length(COALESCE(v_result->'errors','[]'::jsonb))>0 THEN
        RAISE EXCEPTION '%',v_result->'errors';
      END IF;
      IF COALESCE((v_result->>'terjadwal_diubah')::integer,0)
           + COALESCE((v_result->>'dikoreksi_jurnal')::integer,0)>0 THEN
        v_applied := v_applied+1;
      END IF;
    END IF;
    v_created := v_created+1;
    EXCEPTION WHEN OTHERS THEN
      -- Roll back this child's discount/journal together; allow other children
      -- to proceed and surface the failure instead of reporting false success.
      v_errors := v_errors || (v_row.siswa_id::text || ': ' || SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'periode_mulai',v_mulai,
    'periode_selesai',v_selesai,
    'dibuat',v_created,
    'dilewati_karena_diskon_lain',v_skipped,
    'diterapkan_ke_tagihan_existing',v_applied,
    'dilewati_kebijakan',v_policy_skipped,
    'errors',to_jsonb(v_errors)
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.sinkronkan_diskon_kakak_adik_keluarga(uuid,date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sinkronkan_diskon_kakak_adik_keluarga(uuid,date)
  TO service_role;

CREATE OR REPLACE FUNCTION public.sinkronkan_diskon_kakak_adik_bulanan(
  p_tanggal date DEFAULT CURRENT_DATE
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT public.sinkronkan_diskon_kakak_adik_keluarga(NULL,p_tanggal);
$function$;
REVOKE ALL ON FUNCTION public.sinkronkan_diskon_kakak_adik_bulanan(date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sinkronkan_diskon_kakak_adik_bulanan(date)
  TO service_role;

-- Correction journals must not reuse the initial receivable reference.
CREATE OR REPLACE FUNCTION public.terapkan_diskon_siswa(p_siswa_diskon_id uuid, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sd            record;
  v_potongan_akun uuid;
  v_potongan_glob uuid;
  v_piutang_akun  uuid;
  v_pegawai_id    uuid;
  v_tahun         integer := extract(year from current_date)::integer;
  v_row           record;
  v_bruto         numeric;
  v_diskon        numeric;
  v_selisih       numeric;
  v_netto         numeric;
  v_jurnal_id     uuid;
  v_nomor         text;
  v_dept_id       uuid;
  v_terjadwal     integer := 0;
  v_dikoreksi     integer := 0;
  v_dilewati      integer := 0;
  v_total         numeric := 0;
  v_errors        text[] := '{}';
BEGIN
  SELECT sd.*, jp.nama AS jenis_nama, jp.akun_potongan_id
  INTO v_sd
  FROM siswa_diskon sd
  JOIN jenis_pembayaran jp ON jp.id = sd.jenis_id
  WHERE sd.id = p_siswa_diskon_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Data diskon siswa tidak ditemukan';
  END IF;

  IF v_sd.status <> 'disetujui' THEN
    RAISE EXCEPTION 'Diskon belum disetujui (status: %)', v_sd.status;
  END IF;

  SELECT akun_id INTO v_potongan_glob
  FROM pengaturan_akun WHERE kode_setting = 'AKUN_POTONGAN_PENDAPATAN';

  v_potongan_akun := COALESCE(v_sd.akun_potongan_id, v_potongan_glob);

  IF v_potongan_akun IS NULL THEN
    RAISE EXCEPTION 'Akun potongan/keringanan belum dikonfigurasi di Pengaturan Akun';
  END IF;

  SELECT akun_id INTO v_piutang_akun
  FROM pengaturan_akun WHERE kode_setting = 'piutang_siswa';

  IF v_piutang_akun IS NULL THEN
    RAISE EXCEPTION 'Akun piutang siswa belum dikonfigurasi di Pengaturan Akun';
  END IF;

  IF p_user_id IS NOT NULL THEN
    SELECT pegawai_id INTO v_pegawai_id FROM users_profile WHERE id = p_user_id;
  END IF;

  FOR v_row IN
    SELECT t.id, t.status, t.nominal, t.nominal_bruto, t.nominal_diskon,
           t.bulan, t.kelas_id, t.siswa_id, t.jurnal_piutang_id
    FROM tagihan t
    WHERE t.siswa_id = v_sd.siswa_id
      AND t.jenis_id = v_sd.jenis_id
      AND COALESCE(
            t.jatuh_tempo,
            hitung_bulan_periode_tagihan(t.tahun_ajaran_id, t.bulan)
          ) BETWEEN v_sd.periode_mulai AND v_sd.periode_selesai
    ORDER BY t.jatuh_tempo NULLS LAST, t.id
    FOR UPDATE OF t
  LOOP
    BEGIN
      v_bruto := COALESCE(v_row.nominal_bruto, v_row.nominal);

      -- Dihitung langsung dari snapshot baris siswa_diskon INI (bukan lewat
      -- hitung_diskon_tagihan): pencocokan periode sudah dikerjakan di WHERE
      -- loop, dan kalau baris ini baru saja disetujui, memanggil pencari
      -- "diskon yang berlaku" justru berisiko memilih baris lain.
      SELECT CASE
               WHEN COALESCE(v_sd.tipe_snapshot, sk.tipe) = 'persen'
                 THEN round(v_bruto * LEAST(GREATEST(COALESCE(v_sd.nilai_snapshot, v_sd.nilai, sk.nilai_default, 0), 0), 100) / 100, 2)
               ELSE round(GREATEST(COALESCE(v_sd.nilai_snapshot, v_sd.nilai, sk.nilai_default, 0), 0), 2)
             END
      INTO v_diskon
      FROM skema_diskon sk WHERE sk.id = v_sd.skema_diskon_id;

      v_diskon := LEAST(COALESCE(v_diskon, 0), v_bruto);
      v_netto  := v_bruto - v_diskon;
      v_selisih := v_diskon - COALESCE(v_row.nominal_diskon, 0);

      IF v_selisih = 0 THEN
        CONTINUE;                        -- sudah sesuai, tidak perlu disentuh
      END IF;

      IF v_row.status = 'terjadwal' THEN
        -- Belum ada jurnal apa pun: cukup ubah angkanya.
        UPDATE tagihan
        SET nominal         = v_netto,
            nominal_bruto   = v_bruto,
            nominal_diskon  = v_diskon,
            siswa_diskon_id = v_sd.id
        WHERE id = v_row.id AND status = 'terjadwal';

        IF FOUND THEN
          v_terjadwal := v_terjadwal + 1;
          v_total := v_total + v_selisih;
        END IF;

      ELSIF v_row.status = 'belum_bayar' AND v_row.jurnal_piutang_id IS NOT NULL THEN
        -- Piutang sudah diakui sebesar bruto: koreksi lewat jurnal baru.
        v_dept_id := NULL;
        IF v_row.kelas_id IS NOT NULL THEN
          SELECT departemen_id INTO v_dept_id FROM kelas WHERE id = v_row.kelas_id;
        END IF;
        IF v_dept_id IS NULL THEN
          SELECT departemen_id INTO v_dept_id FROM siswa WHERE id = v_row.siswa_id;
        END IF;

        v_nomor := generate_nomor_jurnal('JKD', v_tahun);

        INSERT INTO jurnal (nomor, tanggal, keterangan, referensi, departemen_id,
                            total_debit, total_kredit, status, dibuat_oleh)
        VALUES (
          v_nomor, current_date,
          'Keringanan ' || v_sd.jenis_nama
            || CASE WHEN v_row.bulan IS NOT NULL THEN '-B' || v_row.bulan ELSE '' END
            || ' - siswa ' || v_row.siswa_id,
          'DISKON:' || v_sd.id::text || ':' || v_row.id::text, v_dept_id,
          abs(v_selisih), abs(v_selisih), 'posted', v_pegawai_id
        )
        RETURNING id INTO v_jurnal_id;

        IF v_selisih > 0 THEN
          -- Potongan bertambah: piutang berkurang.
          INSERT INTO jurnal_detail (jurnal_id, akun_id, keterangan, debit, kredit, urutan)
          VALUES
            (v_jurnal_id, v_potongan_akun, 'Keringanan ' || v_sd.jenis_nama, v_selisih, 0, 1),
            (v_jurnal_id, v_piutang_akun,  'Piutang ' || v_sd.jenis_nama,    0, v_selisih, 2);
        ELSE
          -- Potongan berkurang/dicabut: piutang kembali bertambah.
          INSERT INTO jurnal_detail (jurnal_id, akun_id, keterangan, debit, kredit, urutan)
          VALUES
            (v_jurnal_id, v_piutang_akun,  'Piutang ' || v_sd.jenis_nama,    -v_selisih, 0, 1),
            (v_jurnal_id, v_potongan_akun, 'Koreksi keringanan ' || v_sd.jenis_nama, 0, -v_selisih, 2);
        END IF;

        UPDATE tagihan
        SET nominal         = v_netto,
            nominal_bruto   = v_bruto,
            nominal_diskon  = v_diskon,
            siswa_diskon_id = v_sd.id
        WHERE id = v_row.id AND status = 'belum_bayar';

        IF NOT FOUND THEN
          -- Kalah balapan (mis. baru saja dibayar): buang jurnal koreksinya.
          DELETE FROM jurnal_detail WHERE jurnal_id = v_jurnal_id;
          DELETE FROM jurnal WHERE id = v_jurnal_id;
          v_dilewati := v_dilewati + 1;
          CONTINUE;
        END IF;

        v_dikoreksi := v_dikoreksi + 1;
        v_total := v_total + v_selisih;

      ELSE
        v_dilewati := v_dilewati + 1;
        v_errors := v_errors ||
          ('Tagihan ' || v_row.id || ' berstatus "' || v_row.status ||
           '" -- keringanan tidak diterapkan otomatis, perlu penanganan manual');
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || ('Tagihan ' || v_row.id || ': ' || SQLERRM);
    END;
  END LOOP;

  UPDATE siswa_diskon SET diterapkan_at = now() WHERE id = v_sd.id;

  RETURN jsonb_build_object(
    'siswa_diskon_id',   v_sd.id,
    'terjadwal_diubah',  v_terjadwal,
    'dikoreksi_jurnal',  v_dikoreksi,
    'dilewati',          v_dilewati,
    'total_potongan',    v_total,
    'errors',            to_jsonb(v_errors)
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.terapkan_diskon_siswa(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.terapkan_diskon_siswa(uuid,uuid) TO service_role;
