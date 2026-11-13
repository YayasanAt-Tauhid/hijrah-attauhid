-- Migrasi 03: pencabut potongan saudara untuk SEMUA status tagihan + log + jenis koreksi per lembaga.
-- Bergantung pada migrasi 01 dan 02. Rollback: pulihkan asli/akademik_akhiri_siswa_v02.sql (versi migrasi 02),
-- DROP FUNCTION cabut_potongan_saudara, posting_koreksi_potongan; DROP TABLE log_potongan_saudara;
-- jenis "Koreksi Potongan Saudara %" boleh dinonaktifkan (aktif=false) bila sudah dipakai.

CREATE TABLE IF NOT EXISTS public.log_potongan_saudara (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dibuat_at           timestamptz NOT NULL DEFAULT now(),
  siswa_diskon_id     uuid,
  siswa_id            uuid NOT NULL,
  tagihan_id          uuid,
  bulan               date,
  aksi                text NOT NULL CHECK (aksi IN ('cabut_terjadwal','cabut_belum_bayar','cabut_sebagian','koreksi_lunas','tandai_admin')),
  status_tagihan      text,
  nominal_diskon_lama numeric,
  nominal_lama        numeric,
  nominal_baru        numeric,
  jurnal_id           uuid,
  tagihan_koreksi_id  uuid,
  alasan              text,
  dibuat_oleh         uuid
);
CREATE INDEX IF NOT EXISTS idx_log_potongan_saudara_siswa ON public.log_potongan_saudara (siswa_id, dibuat_at DESC);
ALTER TABLE public.log_potongan_saudara ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.log_potongan_saudara FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.log_potongan_saudara TO service_role;

-- Validasi per bulan untuk pengajuan BARU tetap; pemangkasan internal dikecualikan lewat penanda sesi.
CREATE OR REPLACE FUNCTION public.validasi_diskon_kakak_adik()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $f$
DECLARE
  v_kategori text;
  v_keluarga_id uuid;
  v_status text;
  v_mulai date;
  v_akhir date;
  v_bulan date;
BEGIN
  -- pemangkasan baris yang SUDAH disetujui (pangkas_diskon_siswa) tidak divalidasi ulang
  IF current_setting('app.pangkas_diskon', true) = '1' THEN RETURN NEW; END IF;
  -- hanya baris yang berlaku yang divalidasi; pembatalan/penolakan selalu boleh
  IF NEW.status NOT IN ('diajukan','disetujui') THEN RETURN NEW; END IF;

  SELECT kategori INTO v_kategori FROM public.skema_diskon WHERE id = NEW.skema_diskon_id;
  IF v_kategori IS DISTINCT FROM 'kakak_adik' THEN RETURN NEW; END IF;

  SELECT keluarga_id, status, tanggal_mulai_aktif, tanggal_akhir_aktif
  INTO v_keluarga_id, v_status, v_mulai, v_akhir
  FROM public.siswa WHERE id = NEW.siswa_id;

  IF v_keluarga_id IS NULL THEN
    RAISE EXCEPTION 'Potongan kakak-adik membutuhkan siswa aktif yang sudah dikelompokkan ke keluarga';
  END IF;

  v_bulan := date_trunc('month', NEW.periode_mulai::timestamp)::date;

  IF NOT public.siswa_aktif_di_bulan(v_status, v_mulai, v_akhir, v_bulan) THEN
    RAISE EXCEPTION 'Potongan kakak-adik membutuhkan siswa yang aktif pada bulan awal periode';
  END IF;

  IF public.jumlah_saudara_aktif(v_keluarga_id, v_bulan) < 2 THEN
    RAISE EXCEPTION 'Potongan kakak-adik hanya berlaku bila minimal 2 bersaudara masih aktif di yayasan';
  END IF;

  RETURN NEW;
END;
$f$;

CREATE OR REPLACE FUNCTION public.pangkas_diskon_siswa(
  p_siswa_diskon_id uuid, p_akhir_aktif date, p_alasan text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $f$
DECLARE
  r public.siswa_diskon;
  v_end date;
  v_new uuid;
BEGIN
  SELECT * INTO r FROM public.siswa_diskon WHERE id = p_siswa_diskon_id FOR UPDATE;
  IF NOT FOUND OR r.status NOT IN ('diajukan','disetujui') THEN RETURN NULL; END IF;

  -- potongan berlaku sampai akhir bulan hari terakhir aktif
  v_end := (date_trunc('month', p_akhir_aktif::timestamp) + interval '1 month - 1 day')::date;
  IF r.periode_selesai <= v_end THEN RETURN NULL; END IF;

  UPDATE public.siswa_diskon
  SET status = 'dibatalkan',
      catatan = concat_ws(E'\n', NULLIF(catatan,''), p_alasan)
  WHERE id = r.id;

  IF r.periode_mulai > v_end THEN RETURN NULL; END IF;  -- seluruh periode gugur

  PERFORM set_config('app.pangkas_diskon','1',true);
  INSERT INTO public.siswa_diskon(
    siswa_id, skema_diskon_id, jenis_id, kebijakan_keringanan_id,
    periode_mulai, periode_selesai, nilai, status, catatan, dokumen_url,
    diajukan_oleh, diputuskan_oleh, diputuskan_at, diterapkan_at,
    tipe_snapshot, nilai_snapshot
  ) VALUES (
    r.siswa_id, r.skema_diskon_id, r.jenis_id, r.kebijakan_keringanan_id,
    r.periode_mulai, v_end, r.nilai, r.status,
    concat_ws(E'\n', NULLIF(r.catatan,''), p_alasan || ' (periode dipangkas dari baris ' || r.id::text || ')'),
    r.dokumen_url, r.diajukan_oleh, r.diputuskan_oleh, r.diputuskan_at, r.diterapkan_at,
    r.tipe_snapshot, r.nilai_snapshot
  )
  RETURNING id INTO v_new;
  PERFORM set_config('app.pangkas_diskon','',true);

  UPDATE public.tagihan t
  SET siswa_diskon_id = v_new
  WHERE t.siswa_diskon_id = r.id
    AND COALESCE(t.jatuh_tempo, public.hitung_bulan_periode_tagihan(t.tahun_ajaran_id, t.bulan)) <= v_end;

  RETURN v_new;
END;
$f$;

-- Satu jenis koreksi per lembaga; akun disalin dari SPP lembaga yang sama. WAJIB ditinjau bendahara.
INSERT INTO public.jenis_pembayaran(nama, nominal, keterangan, aktif, departemen_id, akun_pendapatan_id, tipe, perlu_dimuka, akun_potongan_id)
SELECT 'Koreksi Potongan Saudara ' || btrim(regexp_replace(j.nama, '^\s*SPP[\s-]*', '', 'i')),
       NULL,
       'Selisih potongan kakak-adik yang dicabut pada tagihan yang sudah lunas. Akun disalin dari SPP lembaga yang sama; perlu ditinjau bendahara.',
       true, j.departemen_id, j.akun_pendapatan_id, 'sekali', false, j.akun_potongan_id
FROM public.jenis_pembayaran j
WHERE j.aktif AND j.tipe = 'bulanan' AND lower(btrim(j.nama)) ~ '^spp([[:space:]-]|$)'
  AND NOT EXISTS (
    SELECT 1 FROM public.jenis_pembayaran k
    WHERE k.departemen_id IS NOT DISTINCT FROM j.departemen_id AND k.nama LIKE 'Koreksi Potongan Saudara%'
  );

-- Jurnal koreksi: Piutang bertambah (Dr), Koreksi keringanan (Cr); pola sama dengan terapkan_diskon_siswa saat potongan dicabut.
CREATE OR REPLACE FUNCTION public.posting_koreksi_potongan(
  p_referensi text, p_keterangan text, p_siswa_id uuid, p_kelas_id uuid,
  p_jumlah numeric, p_akun_piutang uuid, p_akun_potongan uuid, p_pegawai_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $f$
DECLARE
  v_dept uuid; v_nomor text; v_id uuid;
BEGIN
  IF p_kelas_id IS NOT NULL THEN SELECT departemen_id INTO v_dept FROM public.kelas WHERE id = p_kelas_id; END IF;
  IF v_dept IS NULL THEN SELECT departemen_id INTO v_dept FROM public.siswa WHERE id = p_siswa_id; END IF;
  v_nomor := public.generate_nomor_jurnal('JKD', extract(year from current_date)::integer);
  INSERT INTO public.jurnal (nomor, tanggal, keterangan, referensi, departemen_id, total_debit, total_kredit, status, dibuat_oleh)
  VALUES (v_nomor, current_date, p_keterangan, p_referensi, v_dept, p_jumlah, p_jumlah, 'posted', p_pegawai_id)
  RETURNING id INTO v_id;
  INSERT INTO public.jurnal_detail (jurnal_id, akun_id, keterangan, debit, kredit, urutan) VALUES
    (v_id, p_akun_piutang,  'Piutang (potongan saudara dicabut)', p_jumlah, 0, 1),
    (v_id, p_akun_potongan, 'Koreksi keringanan saudara',          0, p_jumlah, 2);
  RETURN v_id;
END;
$f$;

CREATE OR REPLACE FUNCTION public.cabut_potongan_saudara(
  p_siswa_diskon_id uuid, p_dari_bulan date, p_alasan text, p_user_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $f$
DECLARE
  v_sd record;
  v_potongan_akun uuid; v_piutang_akun uuid; v_pegawai_id uuid; v_jenis_koreksi uuid;
  v_awal date := date_trunc('month', p_dari_bulan::timestamp)::date;
  v_row record; v_bruto numeric; v_diskon numeric; v_bln date; v_jurnal_id uuid; v_koreksi_id uuid;
  c_terjadwal int := 0; c_belum int := 0; c_sebagian int := 0; c_koreksi int := 0; c_tandai int := 0;
  v_aksi text;
  v_galat text;
BEGIN
  SELECT sd.*, jp.nama AS jenis_nama, jp.akun_potongan_id, jp.departemen_id AS jenis_dept, sk.kategori
  INTO v_sd
  FROM public.siswa_diskon sd
  JOIN public.jenis_pembayaran jp ON jp.id = sd.jenis_id
  JOIN public.skema_diskon sk ON sk.id = sd.skema_diskon_id
  WHERE sd.id = p_siswa_diskon_id
  FOR UPDATE OF sd;

  IF NOT FOUND THEN RAISE EXCEPTION 'Data diskon siswa tidak ditemukan'; END IF;
  IF v_sd.kategori <> 'kakak_adik' THEN
    RAISE EXCEPTION 'cabut_potongan_saudara hanya untuk potongan kakak-adik';
  END IF;
  IF v_sd.status NOT IN ('diajukan','disetujui') THEN
    RETURN jsonb_build_object('noop', true, 'alasan', 'baris potongan tidak berlaku (status ' || v_sd.status || ')');
  END IF;

  v_potongan_akun := COALESCE(v_sd.akun_potongan_id,
    (SELECT akun_id FROM public.pengaturan_akun WHERE kode_setting = 'AKUN_POTONGAN_PENDAPATAN'));
  SELECT akun_id INTO v_piutang_akun FROM public.pengaturan_akun WHERE kode_setting = 'piutang_siswa';
  IF v_potongan_akun IS NULL OR v_piutang_akun IS NULL THEN
    RAISE EXCEPTION 'Akun potongan/piutang siswa belum dikonfigurasi di Pengaturan Akun';
  END IF;
  IF p_user_id IS NOT NULL THEN
    SELECT pegawai_id INTO v_pegawai_id FROM public.users_profile WHERE id = p_user_id;
  END IF;

  SELECT k.id INTO v_jenis_koreksi
  FROM public.jenis_pembayaran k
  WHERE k.aktif AND k.nama LIKE 'Koreksi Potongan Saudara%' AND k.departemen_id IS NOT DISTINCT FROM v_sd.jenis_dept
  ORDER BY k.nama LIMIT 1;

  FOR v_row IN
    SELECT t.id, t.status, t.nominal, t.nominal_bruto, t.nominal_diskon, t.bulan, t.kelas_id, t.siswa_id,
           t.jurnal_piutang_id, t.tahun_ajaran_id,
           COALESCE(t.jatuh_tempo, public.hitung_bulan_periode_tagihan(t.tahun_ajaran_id, t.bulan)) AS jt
    FROM public.tagihan t
    WHERE t.siswa_diskon_id = v_sd.id
      AND COALESCE(t.nominal_diskon, 0) > 0
      AND COALESCE(t.jatuh_tempo, public.hitung_bulan_periode_tagihan(t.tahun_ajaran_id, t.bulan)) >= v_awal
    ORDER BY 11, t.id
    FOR UPDATE OF t
  LOOP
    v_diskon := v_row.nominal_diskon;
    v_bruto  := COALESCE(v_row.nominal_bruto, v_row.nominal + v_row.nominal_diskon);
    v_bln    := date_trunc('month', v_row.jt::timestamp)::date;
    v_jurnal_id := NULL; v_koreksi_id := NULL; v_galat := NULL;

    IF v_row.status = 'terjadwal' THEN
      UPDATE public.tagihan SET nominal = v_bruto, nominal_bruto = v_bruto, nominal_diskon = 0, siswa_diskon_id = NULL
      WHERE id = v_row.id;
      v_aksi := 'cabut_terjadwal'; c_terjadwal := c_terjadwal + 1;

    ELSIF v_row.status IN ('belum_bayar','sebagian') THEN
      IF v_row.jurnal_piutang_id IS NOT NULL THEN
        v_jurnal_id := public.posting_koreksi_potongan(
          'DISKON:' || v_sd.id::text || ':' || v_row.id::text,
          'Cabut keringanan saudara ' || v_sd.jenis_nama
            || CASE WHEN v_row.bulan IS NOT NULL THEN '-B' || v_row.bulan ELSE '' END
            || ' - siswa ' || v_row.siswa_id,
          v_row.siswa_id, v_row.kelas_id, v_diskon, v_piutang_akun, v_potongan_akun, v_pegawai_id);
      END IF;
      UPDATE public.tagihan SET nominal = v_bruto, nominal_bruto = v_bruto, nominal_diskon = 0, siswa_diskon_id = NULL
      WHERE id = v_row.id;
      IF v_row.status = 'sebagian' THEN v_aksi := 'cabut_sebagian'; c_sebagian := c_sebagian + 1;
      ELSE v_aksi := 'cabut_belum_bayar'; c_belum := c_belum + 1; END IF;

    ELSIF v_row.status = 'lunas' THEN
      IF v_jenis_koreksi IS NULL THEN
        v_aksi := 'tandai_admin'; c_tandai := c_tandai + 1;
      ELSIF EXISTS (
        SELECT 1 FROM public.tagihan x
        WHERE x.siswa_id = v_row.siswa_id AND x.jenis_id = v_jenis_koreksi
          AND x.tahun_ajaran_id = v_row.tahun_ajaran_id AND COALESCE(x.bulan,0) = COALESCE(v_row.bulan,0)
      ) THEN
        CONTINUE;  -- koreksi bulan ini sudah pernah dibuat
      ELSE
        BEGIN
          v_jurnal_id := public.posting_koreksi_potongan(
            'KOREKSI-SAUDARA:' || v_sd.id::text || ':' || v_row.id::text,
            'Koreksi potongan saudara ' || v_sd.jenis_nama
              || CASE WHEN v_row.bulan IS NOT NULL THEN '-B' || v_row.bulan ELSE '' END
              || ' (tagihan lunas) - siswa ' || v_row.siswa_id,
            v_row.siswa_id, v_row.kelas_id, v_diskon, v_piutang_akun, v_potongan_akun, v_pegawai_id);
          INSERT INTO public.tagihan (siswa_id, jenis_id, tahun_ajaran_id, kelas_id, bulan, nominal, nominal_bruto,
                                      nominal_diskon, status, jatuh_tempo, jurnal_piutang_id, label_tampil)
          VALUES (v_row.siswa_id, v_jenis_koreksi, v_row.tahun_ajaran_id, v_row.kelas_id, v_row.bulan, v_diskon, v_diskon,
                  0, 'belum_bayar', current_date, v_jurnal_id,
                  'Koreksi potongan saudara ' || to_char(v_bln, 'YYYY-MM'))
          RETURNING id INTO v_koreksi_id;
          v_aksi := 'koreksi_lunas'; c_koreksi := c_koreksi + 1;
        EXCEPTION WHEN OTHERS THEN
          -- mis. tahun buku sudah ditutup: jangan gagalkan proses utama; tandai untuk admin
          v_jurnal_id := NULL; v_koreksi_id := NULL; v_galat := SQLERRM;
          v_aksi := 'tandai_admin'; c_tandai := c_tandai + 1;
        END;
      END IF;

    ELSE
      CONTINUE;  -- dibatalkan dan status lain tidak disentuh
    END IF;

    INSERT INTO public.log_potongan_saudara (siswa_diskon_id, siswa_id, tagihan_id, bulan, aksi, status_tagihan,
        nominal_diskon_lama, nominal_lama, nominal_baru, jurnal_id, tagihan_koreksi_id, alasan, dibuat_oleh)
    VALUES (v_sd.id, v_row.siswa_id, v_row.id, v_bln, v_aksi, v_row.status,
        v_diskon, v_row.nominal,
        CASE WHEN v_aksi IN ('koreksi_lunas','tandai_admin') THEN v_row.nominal ELSE v_bruto END,
        v_jurnal_id, v_koreksi_id,
        CASE WHEN v_aksi = 'tandai_admin' AND v_galat IS NOT NULL
             THEN 'Tagihan koreksi gagal dibuat otomatis (' || v_galat || '); selisih ' || v_diskon::text || ' perlu ditagih manual. ' || COALESCE(p_alasan,'')
             WHEN v_aksi = 'tandai_admin'
             THEN 'Tagihan lunas: jenis Koreksi Potongan Saudara belum ada/aktif untuk lembaga ini; selisih ' || v_diskon::text || ' perlu ditagih manual. ' || COALESCE(p_alasan,'')
             ELSE p_alasan END,
        p_user_id);
  END LOOP;

  -- baris potongan dipangkas: batalkan lama, buat baris awalan untuk bulan yang masih sah
  PERFORM public.pangkas_diskon_siswa(v_sd.id, v_awal - 1, p_alasan);

  RETURN jsonb_build_object('terjadwal', c_terjadwal, 'belum_bayar', c_belum, 'sebagian', c_sebagian,
                            'koreksi_lunas', c_koreksi, 'ditandai_admin', c_tandai);
END;
$f$;

REVOKE ALL ON FUNCTION public.posting_koreksi_potongan(text,text,uuid,uuid,numeric,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cabut_potongan_saudara(uuid,date,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.posting_koreksi_potongan(text,text,uuid,uuid,numeric,uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cabut_potongan_saudara(uuid,date,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.akademik_akhiri_siswa(p_ids uuid[], p_status text, p_tanggal_efektif date, p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s public.siswa;
  v_processed integer := 0;
  v_tagihan record;
  v_keluarga_id uuid;
  v_aktif_keluarga integer;
  v_diskon record;
  v_bulan date;
  v_invalid date;
  v_alasan text;
BEGIN
  IF p_status NOT IN ('pindah','alumni') THEN
    RAISE EXCEPTION 'Status akhir tidak valid';
  END IF;
  IF p_tanggal_efektif IS NULL THEN
    RAISE EXCEPTION 'Tanggal efektif wajib diisi';
  END IF;
  IF p_user_id IS NULL OR NOT (
    public.has_role(p_user_id,'admin') OR public.has_role(p_user_id,'admin_tu')
  ) THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;
  IF COALESCE(cardinality(p_ids),0)=0 THEN
    RAISE EXCEPTION 'Pilih siswa terlebih dahulu';
  END IF;

  FOR s IN
    SELECT * FROM public.siswa
    WHERE id = ANY(p_ids)
    ORDER BY id
    FOR UPDATE
  LOOP
    IF s.status <> 'aktif' THEN
      RAISE EXCEPTION 'Hanya siswa aktif yang dapat diubah statusnya';
    END IF;

    v_keluarga_id := s.keluarga_id;
    v_alasan := CASE WHEN p_status='pindah'
      THEN 'Siswa pindah keluar efektif ' || p_tanggal_efektif::text
      ELSE 'Siswa menjadi alumni efektif ' || p_tanggal_efektif::text
    END;

    FOR v_tagihan IN
      SELECT t.id
      FROM public.tagihan t
      WHERE t.siswa_id = s.id
        AND t.status IN ('terjadwal','belum_bayar')
        AND COALESCE(
              t.jatuh_tempo,
              public.hitung_bulan_periode_tagihan(t.tahun_ajaran_id,t.bulan)
            ) >= p_tanggal_efektif
      ORDER BY t.jatuh_tempo NULLS LAST, t.id
    LOOP
      PERFORM public.batalkan_tagihan_atomik(
        v_tagihan.id, 'batal', v_alasan, current_date, p_user_id, NULL
      );
    END LOOP;

    UPDATE public.rencana_tagihan_siswa
    SET aktif = false,
        updated_at = now(),
        dinonaktifkan_at = now(),
        dinonaktifkan_oleh = p_user_id,
        dinonaktifkan_alasan = v_alasan
    WHERE siswa_id = s.id
      AND aktif = true;

    FOR v_diskon IN
      SELECT sd.id
      FROM public.siswa_diskon sd
      WHERE sd.siswa_id = s.id
        AND sd.status IN ('diajukan','disetujui')
        AND sd.periode_selesai >= p_tanggal_efektif
    LOOP
      PERFORM public.pangkas_diskon_siswa(
        v_diskon.id,
        p_tanggal_efektif - 1,
        'Otomatis diakhiri karena ' || p_status || ' efektif ' || p_tanggal_efektif::text
      );
    END LOOP;

    UPDATE public.siswa SET status = p_status, tanggal_akhir_aktif = p_tanggal_efektif - 1 WHERE id = s.id;
    UPDATE public.kelas_siswa SET aktif = false WHERE siswa_id = s.id AND aktif;

    IF v_keluarga_id IS NOT NULL THEN
      -- bulan pertama saat siswa ini sudah tidak aktif (bulan sesudah hari terakhir aktifnya)
      v_bulan := (date_trunc('month', (p_tanggal_efektif - 1)::timestamp) + interval '1 month')::date;

      FOR v_diskon IN
        SELECT sd.id, sd.siswa_id, sd.jenis_id,
               greatest(date_trunc('month', sd.periode_mulai::timestamp)::date, v_bulan) AS dari_bulan,
               sd.periode_selesai
        FROM public.siswa_diskon sd
        JOIN public.skema_diskon sk ON sk.id = sd.skema_diskon_id
        JOIN public.siswa sx ON sx.id = sd.siswa_id
        WHERE sx.keluarga_id = v_keluarga_id
          AND sx.id <> s.id
          AND sk.kategori = 'kakak_adik'
          AND sd.status IN ('diajukan','disetujui')
          AND sd.periode_selesai >= v_bulan
      LOOP
        -- bulan pertama saat saudara aktif < 2, atau anak pemilik potongan sendiri tidak aktif
        SELECT min(m)::date INTO v_invalid
        FROM generate_series(v_diskon.dari_bulan::timestamp, v_diskon.periode_selesai::timestamp, interval '1 month') AS m
        WHERE public.jumlah_saudara_aktif(v_keluarga_id, m::date) < 2
           OR NOT EXISTS (
                SELECT 1 FROM public.siswa z
                WHERE z.id = v_diskon.siswa_id
                  AND public.siswa_aktif_di_bulan(z.status, z.tanggal_mulai_aktif, z.tanggal_akhir_aktif, m::date)
              );

        IF v_invalid IS NOT NULL THEN
          PERFORM public.cabut_potongan_saudara(
            v_diskon.id,
            v_invalid,
            'Otomatis diakhiri: saudara aktif di yayasan kurang dari 2 sejak ' || to_char(v_invalid,'YYYY-MM-DD'),
            p_user_id
          );
        END IF;
      END LOOP;
    END IF;

    v_processed := v_processed + 1;
  END LOOP;

  IF v_processed <> (SELECT count(DISTINCT x) FROM unnest(p_ids) x) THEN
    RAISE EXCEPTION 'Sebagian siswa tidak ditemukan';
  END IF;

  RETURN v_processed;
END;
$function$;
