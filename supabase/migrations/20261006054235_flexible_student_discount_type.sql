-- Allow each student discount application to choose percent or nominal
-- independently from the master scheme type, while preserving the approved
-- type/value as immutable historical snapshots. Existing rows are not changed.

CREATE OR REPLACE FUNCTION public.snapshot_siswa_diskon()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_skema public.skema_diskon;
  v_policy public.kebijakan_keringanan;
  v_nilai numeric;
  v_tipe text;
BEGIN
  SELECT * INTO v_skema
  FROM public.skema_diskon
  WHERE id = NEW.skema_diskon_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Skema keringanan tidak ditemukan';
  END IF;

  IF NEW.kebijakan_keringanan_id IS NOT NULL THEN
    SELECT * INTO v_policy
    FROM public.kebijakan_keringanan
    WHERE id = NEW.kebijakan_keringanan_id
      AND aktif = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Kebijakan keringanan tidak ditemukan atau tidak aktif';
    END IF;

    IF v_policy.skema_diskon_id IS DISTINCT FROM NEW.skema_diskon_id
       OR v_policy.jenis_id IS DISTINCT FROM NEW.jenis_id THEN
      RAISE EXCEPTION 'Kebijakan keringanan tidak sesuai skema/jenis tagihan';
    END IF;

    IF NEW.periode_mulai < v_policy.berlaku_mulai
       OR (
         v_policy.berlaku_selesai IS NOT NULL
         AND NEW.periode_selesai > v_policy.berlaku_selesai
       ) THEN
      RAISE EXCEPTION 'Periode pengajuan melewati masa berlaku kebijakan';
    END IF;

    v_tipe := COALESCE(NEW.tipe_snapshot, v_policy.tipe);
    v_nilai := COALESCE(NEW.nilai, v_policy.nilai);

    NEW.kebijakan_snapshot := jsonb_build_object(
      'sumber', 'kebijakan',
      'id', v_policy.id,
      'kode', v_policy.kode,
      'versi', v_policy.versi,
      'nama', v_policy.nama,
      'tipe', v_tipe,
      'tipe_kebijakan', v_policy.tipe,
      'nilai_kebijakan', v_policy.nilai,
      'tipe_diberikan', v_tipe,
      'nilai_diberikan', v_nilai,
      'berlaku_mulai', v_policy.berlaku_mulai,
      'berlaku_selesai', v_policy.berlaku_selesai,
      'kelas_regex', v_policy.kelas_regex
    );
  ELSE
    v_tipe := COALESCE(NEW.tipe_snapshot, v_skema.tipe);
    v_nilai := COALESCE(NEW.nilai, v_skema.nilai_default);
    NEW.kebijakan_snapshot := jsonb_build_object(
      'sumber', 'manual',
      'skema', v_skema.nama,
      'tipe', v_tipe,
      'tipe_skema', v_skema.tipe,
      'tipe_diberikan', v_tipe,
      'nilai_diberikan', v_nilai
    );
  END IF;

  IF v_tipe NOT IN ('persen','nominal') THEN
    RAISE EXCEPTION 'Tipe keringanan harus persen atau nominal';
  END IF;
  IF v_nilai IS NULL OR v_nilai < 0 THEN
    RAISE EXCEPTION 'Nilai keringanan tidak valid';
  END IF;
  IF v_tipe = 'persen' AND v_nilai > 100 THEN
    RAISE EXCEPTION 'Persentase keringanan tidak boleh lebih dari 100%%';
  END IF;

  -- Materialize the actual value. Existing accounting RPCs therefore never
  -- depend on a future change to skema_diskon.nilai_default.
  NEW.nilai := v_nilai;
  NEW.tipe_snapshot := v_tipe;
  NEW.nilai_snapshot := v_nilai;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_snapshot_siswa_diskon ON public.siswa_diskon;
CREATE TRIGGER trg_snapshot_siswa_diskon
  BEFORE INSERT OR UPDATE OF skema_diskon_id, jenis_id, kebijakan_keringanan_id, nilai,
    tipe_snapshot, periode_mulai, periode_selesai
  ON public.siswa_diskon
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_siswa_diskon();

CREATE OR REPLACE FUNCTION public.cegah_mutasi_diskon_disetujui()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status = 'disetujui' AND (
    NEW.skema_diskon_id IS DISTINCT FROM OLD.skema_diskon_id
    OR NEW.jenis_id IS DISTINCT FROM OLD.jenis_id
    OR NEW.kebijakan_keringanan_id IS DISTINCT FROM OLD.kebijakan_keringanan_id
    OR NEW.nilai IS DISTINCT FROM OLD.nilai
    OR NEW.tipe_snapshot IS DISTINCT FROM OLD.tipe_snapshot
    OR NEW.nilai_snapshot IS DISTINCT FROM OLD.nilai_snapshot
    OR NEW.kebijakan_snapshot IS DISTINCT FROM OLD.kebijakan_snapshot
    OR NEW.periode_mulai IS DISTINCT FROM OLD.periode_mulai
    OR NEW.periode_selesai IS DISTINCT FROM OLD.periode_selesai
  ) THEN
    RAISE EXCEPTION
      'Keringanan yang sudah disetujui tidak boleh diubah. Batalkan lalu buat pengajuan baru agar histori tetap utuh.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_cegah_mutasi_diskon_disetujui ON public.siswa_diskon;
CREATE TRIGGER trg_cegah_mutasi_diskon_disetujui
  BEFORE UPDATE OF skema_diskon_id, jenis_id, kebijakan_keringanan_id, nilai,
    tipe_snapshot, nilai_snapshot, kebijakan_snapshot, periode_mulai, periode_selesai
  ON public.siswa_diskon
  FOR EACH ROW EXECUTE FUNCTION public.cegah_mutasi_diskon_disetujui();

CREATE OR REPLACE FUNCTION public.hitung_diskon_tagihan(
  p_siswa_id      uuid,
  p_jenis_id      uuid,
  p_periode_id    uuid,
  p_bulan         integer,
  p_nominal_bruto numeric
)
RETURNS TABLE(nominal_diskon numeric, siswa_diskon_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bulan_periode date;
  v_sd            record;
  v_nilai         numeric;
  v_diskon        numeric := 0;
BEGIN
  IF p_nominal_bruto IS NULL OR p_nominal_bruto <= 0 THEN
    RETURN QUERY SELECT 0::numeric, NULL::uuid;
    RETURN;
  END IF;

  v_bulan_periode := hitung_bulan_periode_tagihan(p_periode_id, p_bulan);
  IF v_bulan_periode IS NULL THEN
    RETURN QUERY SELECT 0::numeric, NULL::uuid;
    RETURN;
  END IF;

  SELECT sd.id,
         COALESCE(sd.nilai_snapshot, sd.nilai, sk.nilai_default, 0) AS nilai,
         COALESCE(sd.tipe_snapshot, sk.tipe) AS tipe
  INTO v_sd
  FROM siswa_diskon sd
  JOIN skema_diskon sk ON sk.id = sd.skema_diskon_id
  WHERE sd.siswa_id = p_siswa_id
    AND sd.jenis_id = p_jenis_id
    AND sd.status   = 'disetujui'
    AND sk.aktif
    AND v_bulan_periode BETWEEN sd.periode_mulai AND sd.periode_selesai
  ORDER BY sd.diputuskan_at DESC NULLS LAST, sd.diajukan_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 0::numeric, NULL::uuid;
    RETURN;
  END IF;

  v_nilai := COALESCE(v_sd.nilai, 0);

  IF v_sd.tipe = 'persen' THEN
    v_diskon := round(p_nominal_bruto * LEAST(GREATEST(v_nilai, 0), 100) / 100, 2);
  ELSE
    v_diskon := round(GREATEST(v_nilai, 0), 2);
  END IF;

  -- Potongan tidak boleh melebihi tarifnya sendiri (tagihan negatif = uang
  -- sekolah berutang ke siswa; bukan itu yang dimaksud keringanan).
  v_diskon := LEAST(v_diskon, p_nominal_bruto);

  RETURN QUERY SELECT v_diskon, v_sd.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.terapkan_diskon_siswa(
  p_siswa_diskon_id uuid,
  p_user_id uuid DEFAULT NULL
)
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
      AND hitung_bulan_periode_tagihan(t.tahun_ajaran_id, t.bulan)
            BETWEEN v_sd.periode_mulai AND v_sd.periode_selesai
    ORDER BY t.jatuh_tempo NULLS LAST, t.id
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
          v_row.id::text, v_dept_id,
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
$function$;

COMMENT ON FUNCTION public.hitung_diskon_tagihan(uuid, uuid, uuid, integer, numeric) IS
  'Menghitung potongan dari snapshot tipe/nilai siswa_diskon; fallback ke skema hanya untuk data legacy.';
COMMENT ON FUNCTION public.terapkan_diskon_siswa(uuid, uuid) IS
  'Menerapkan keringanan menggunakan snapshot tipe/nilai agar histori tidak berubah ketika master kebijakan berubah.';

-- Re-assert privileged RPC ACLs after CREATE OR REPLACE.
REVOKE ALL ON FUNCTION public.hitung_diskon_tagihan(uuid, uuid, uuid, integer, numeric)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.terapkan_diskon_siswa(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hitung_diskon_tagihan(uuid, uuid, uuid, integer, numeric)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.terapkan_diskon_siswa(uuid, uuid)
  TO service_role;
