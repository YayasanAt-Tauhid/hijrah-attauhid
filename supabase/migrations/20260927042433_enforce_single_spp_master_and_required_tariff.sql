CREATE OR REPLACE FUNCTION public.generate_tagihan_batch(
  p_jenis_id uuid,
  p_tahun_ajaran_id uuid,
  p_bulan integer,
  p_departemen_id uuid,
  p_siswa_list jsonb,
  p_created_by uuid
)
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
  v_tahun_sekarang integer := extract(year from now());
  v_tanggal date := current_date;
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

  FOR v_row IN SELECT * FROM jsonb_to_recordset(p_siswa_list) AS x(siswa_id uuid, kelas_id uuid)
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
        v_bruto := get_tarif_siswa(
          p_jenis_id, v_row.siswa_id, v_row.kelas_id,
          p_tahun_ajaran_id, v_angkatan_id
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

      -- Tagihan periode mendatang: jadwal saja, belum ada jurnal.
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
        VALUES (v_jurnal_id, v_jenis.akun_pendapatan_id, 'Pendapatan ' || v_jenis.nama, 0, v_bruto, v_urutan);
      END IF;

      INSERT INTO tagihan (siswa_id, jenis_id, tahun_ajaran_id, kelas_id, bulan, nominal,
                           nominal_bruto, nominal_diskon, siswa_diskon_id,
                           status, jatuh_tempo, jurnal_piutang_id, created_by)
      VALUES (v_row.siswa_id, p_jenis_id, p_tahun_ajaran_id, v_row.kelas_id, p_bulan, v_netto,
              v_bruto, v_diskon, v_siswa_diskon_id,
              v_status, v_jatuh_tempo, v_jurnal_id, p_created_by)
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
$function$;



-- Satu master SPP aktif per lembaga. Nominal master selalu 0; variasi nominal
-- hanya disimpan di tarif_tagihan.
CREATE UNIQUE INDEX IF NOT EXISTS uq_jenis_pembayaran_spp_aktif_per_departemen
ON public.jenis_pembayaran(departemen_id)
WHERE aktif = true
  AND tipe = 'bulanan'
  AND lower(btrim(nama)) ~ '^spp([[:space:]-]|$)';

CREATE OR REPLACE FUNCTION public.guard_master_spp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.aktif = true
     AND lower(btrim(NEW.nama)) ~ '^spp([[:space:]-]|$)'
  THEN
    IF NEW.tipe IS DISTINCT FROM 'bulanan' THEN
      RAISE EXCEPTION 'Jenis SPP harus bertipe bulanan';
    END IF;
    IF NEW.departemen_id IS NULL THEN
      RAISE EXCEPTION 'Jenis SPP wajib terikat ke satu lembaga';
    END IF;
    IF COALESCE(NEW.nominal, 0) <> 0 THEN
      RAISE EXCEPTION
        'Nominal master SPP harus 0. Tetapkan nominal melalui Pengaturan Tarif per siswa/kelas/angkatan.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_master_spp ON public.jenis_pembayaran;
CREATE TRIGGER trg_guard_master_spp
BEFORE INSERT OR UPDATE OF nama, tipe, nominal, aktif, departemen_id
ON public.jenis_pembayaran
FOR EACH ROW EXECUTE FUNCTION public.guard_master_spp();

CREATE OR REPLACE FUNCTION public.guard_tagihan_spp_tarif()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_jenis record;
  v_siswa record;
  v_tarif numeric;
  v_bruto numeric;
BEGIN
  SELECT nama, tipe, departemen_id INTO v_jenis
  FROM public.jenis_pembayaran WHERE id = NEW.jenis_id;

  IF NOT FOUND
     OR v_jenis.tipe IS DISTINCT FROM 'bulanan'
     OR lower(btrim(v_jenis.nama)) !~ '^spp([[:space:]-]|$)'
  THEN
    RETURN NEW;
  END IF;

  SELECT nama, departemen_id, angkatan_id INTO v_siswa
  FROM public.siswa WHERE id = NEW.siswa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Siswa tagihan SPP tidak ditemukan';
  END IF;

  IF v_jenis.departemen_id IS DISTINCT FROM v_siswa.departemen_id THEN
    RAISE EXCEPTION 'Jenis SPP tidak sesuai lembaga siswa %', v_siswa.nama;
  END IF;

  v_tarif := public.get_tarif_siswa(
    NEW.jenis_id, NEW.siswa_id, NEW.kelas_id,
    NEW.tahun_ajaran_id, v_siswa.angkatan_id
  );

  IF v_tarif IS NULL OR v_tarif <= 0 THEN
    RAISE EXCEPTION
      'Tarif SPP belum dikonfigurasi untuk %. Tetapkan tarif terlebih dahulu.',
      v_siswa.nama;
  END IF;

  v_bruto := COALESCE(NEW.nominal_bruto, NEW.nominal);
  IF round(v_bruto, 2) IS DISTINCT FROM round(v_tarif, 2) THEN
    RAISE EXCEPTION
      'Nominal bruto SPP % tidak sesuai tarif efektif % untuk %',
      v_bruto, v_tarif, v_siswa.nama;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_tagihan_spp_tarif ON public.tagihan;
CREATE TRIGGER trg_guard_tagihan_spp_tarif
BEFORE INSERT ON public.tagihan
FOR EACH ROW EXECUTE FUNCTION public.guard_tagihan_spp_tarif();

REVOKE ALL ON FUNCTION public.generate_tagihan_batch(uuid, uuid, integer, uuid, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_tagihan_batch(uuid, uuid, integer, uuid, jsonb, uuid)
  TO service_role;
