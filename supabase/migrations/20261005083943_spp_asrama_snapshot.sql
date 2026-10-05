-- Target produksi: cmvzcpeiuompqgdvflky. Belum dijalankan.
-- Satu master SPP per lembaga tetap berlaku. Kategori dan akun dibekukan per tagihan.
-- Tidak mengubah status siswa, nominal, pembayaran, atau jurnal historis.

ALTER TABLE public.tagihan
  ADD COLUMN spp_kategori text CHECK (spp_kategori IN ('asrama','non_asrama','umum','belum_terverifikasi')),
  ADD COLUMN spp_akun_pendapatan_id uuid REFERENCES public.akun_rekening(id);
ALTER TABLE public.pembayaran
  ADD COLUMN spp_kategori text CHECK (spp_kategori IN ('asrama','non_asrama','umum','belum_terverifikasi'));

COMMENT ON COLUMN public.tagihan.spp_kategori IS
  'Snapshot kategori layanan SPP. NULL berarti histori sebelum pemisahan; jangan gunakan status siswa sekarang untuk mengklasifikasi histori.';
COMMENT ON COLUMN public.tagihan.spp_akun_pendapatan_id IS
  'Akun pendapatan SPP saat tagihan dibuat; histori tanpa snapshot tetap menggunakan akun master hingga rekonsiliasi disetujui.';
COMMENT ON COLUMN public.pembayaran.spp_kategori IS
  'Disalin dari tagihan ketika pembayaran dibuat, tidak dihitung ulang dari data siswa.';

CREATE OR REPLACE FUNCTION public.snapshot_spp_siswa(p_jenis_id uuid, p_siswa_id uuid)
RETURNS TABLE(kategori text, akun_id uuid)
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_jenis public.jenis_pembayaran;
  v_dept text;
  v_status text;
  v_count integer;
BEGIN
  SELECT * INTO STRICT v_jenis FROM public.jenis_pembayaran WHERE id=p_jenis_id;
  IF v_jenis.tipe IS DISTINCT FROM 'bulanan'
     OR lower(btrim(v_jenis.nama)) !~ '^spp([[:space:]-]|$)' THEN
    RETURN QUERY SELECT NULL::text, NULL::uuid;
    RETURN;
  END IF;
  SELECT kode INTO v_dept FROM public.departemen WHERE id=v_jenis.departemen_id;
  kategori := 'umum';
  akun_id := v_jenis.akun_pendapatan_id;
  IF v_dept IN ('SMP','SMA','MTA') THEN
    -- Lock data sumber hingga transaksi generate selesai agar jurnal dan
    -- snapshot tagihan tidak mengambil status yang berbeda saat ada edit siswa.
    SELECT status_asrama INTO v_status FROM public.siswa_detail
    WHERE siswa_id=p_siswa_id FOR SHARE;
    kategori := CASE WHEN v_status IN ('asrama','non_asrama') THEN v_status
                     ELSE 'belum_terverifikasi' END;
    IF kategori IN ('asrama','non_asrama') THEN
      SELECT count(*), (array_agg(a.id))[1] INTO v_count, akun_id
      FROM public.akun_rekening a
      WHERE a.kode=CASE WHEN kategori='asrama' THEN '4102' ELSE '4103' END
        AND a.aktif AND a.jenis='pendapatan';
      IF v_count <> 1 THEN
        RAISE EXCEPTION 'Akun pendapatan SPP % harus tersedia tepat satu dan aktif',kategori;
      END IF;
    END IF;
  END IF;
  IF akun_id IS NULL THEN RAISE EXCEPTION 'Akun pendapatan SPP belum dikonfigurasi'; END IF;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.akun_pendapatan_tagihan(p_tagihan_id uuid)
RETURNS uuid
LANGUAGE sql STABLE
SET search_path = ''
AS $function$
  SELECT COALESCE(t.spp_akun_pendapatan_id,jp.akun_pendapatan_id)
  FROM public.tagihan t JOIN public.jenis_pembayaran jp ON jp.id=t.jenis_id
  WHERE t.id=p_tagihan_id
$function$;

CREATE OR REPLACE FUNCTION public.guard_snapshot_spp_tagihan()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE v_snapshot record;
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT * INTO v_snapshot FROM public.snapshot_spp_siswa(NEW.jenis_id,NEW.siswa_id);
    NEW.spp_kategori := v_snapshot.kategori;
    NEW.spp_akun_pendapatan_id := v_snapshot.akun_id;
  ELSE
    IF OLD.spp_kategori IS NOT NULL AND
       (NEW.siswa_id IS DISTINCT FROM OLD.siswa_id OR NEW.jenis_id IS DISTINCT FROM OLD.jenis_id) THEN
      RAISE EXCEPTION 'Identitas tagihan dengan snapshot SPP tidak dapat diubah';
    END IF;
    IF (NEW.spp_kategori IS DISTINCT FROM OLD.spp_kategori OR
        NEW.spp_akun_pendapatan_id IS DISTINCT FROM OLD.spp_akun_pendapatan_id) THEN
      -- Pengisian histori hanya melalui SQL rekonsiliasi yang ditinjau,
      -- bukan dari browser, kasir, atau perubahan status siswa otomatis.
      IF current_user <> 'postgres' OR OLD.spp_kategori IS NOT NULL OR
         OLD.spp_akun_pendapatan_id IS NOT NULL THEN
        RAISE EXCEPTION 'Snapshot SPP tersimpan tidak dapat diubah; gunakan rekonsiliasi yang disetujui';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_snapshot_spp_tagihan
BEFORE INSERT OR UPDATE OF spp_kategori,spp_akun_pendapatan_id,siswa_id,jenis_id
ON public.tagihan FOR EACH ROW EXECUTE FUNCTION public.guard_snapshot_spp_tagihan();

CREATE OR REPLACE FUNCTION public.guard_snapshot_spp_pembayaran()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE v_kategori text; v_is_spp boolean;
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT jp.tipe='bulanan' AND lower(btrim(jp.nama)) ~ '^spp([[:space:]-]|$)'
    INTO v_is_spp FROM public.jenis_pembayaran jp WHERE jp.id=NEW.jenis_id;
    IF v_is_spp THEN
      SELECT t.spp_kategori INTO v_kategori FROM public.tagihan t
      WHERE t.id=NEW.tagihan_id AND t.siswa_id=NEW.siswa_id AND t.jenis_id=NEW.jenis_id;
      -- Tagihan histori tanpa snapshot tetap ditandai belum terverifikasi.
      -- Pembayaran tunggakan tidak boleh memakai status asrama terkini.
      NEW.spp_kategori := COALESCE(v_kategori,'belum_terverifikasi');
    ELSE
      NEW.spp_kategori := NULL;
    END IF;
  ELSE
    IF OLD.spp_kategori IS NOT NULL AND
       (NEW.siswa_id IS DISTINCT FROM OLD.siswa_id OR NEW.jenis_id IS DISTINCT FROM OLD.jenis_id
        OR NEW.tagihan_id IS DISTINCT FROM OLD.tagihan_id) THEN
      RAISE EXCEPTION 'Identitas pembayaran dengan snapshot SPP tidak dapat diubah';
    END IF;
    IF NEW.spp_kategori IS DISTINCT FROM OLD.spp_kategori THEN
      IF current_user <> 'postgres' OR OLD.spp_kategori IS NOT NULL THEN
        RAISE EXCEPTION 'Snapshot kategori pembayaran SPP tidak dapat diubah';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_snapshot_spp_pembayaran
BEFORE INSERT OR UPDATE OF spp_kategori,siswa_id,jenis_id,tagihan_id
ON public.pembayaran FOR EACH ROW EXECUTE FUNCTION public.guard_snapshot_spp_pembayaran();

REVOKE ALL ON FUNCTION public.snapshot_spp_siswa(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.akun_pendapatan_tagihan(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_snapshot_spp_tagihan() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_snapshot_spp_pembayaran() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_spp_siswa(uuid,uuid),
  public.akun_pendapatan_tagihan(uuid),public.guard_snapshot_spp_tagihan(),
  public.guard_snapshot_spp_pembayaran() TO service_role;

-- Definisi RPC di bawah disalin dari produksi 5 Oktober 2026.
-- Akun pendapatan mengikuti snapshot. Pembatalan SPP juga memulihkan piutang
-- saat layanan sudah diakui tetapi PD masih pending. Guard MD5 mencegah
-- menimpa perubahan sesi lain; hak akses RPC yang sudah ada dipertahankan.

DO $preflight$
DECLARE v_expected record; v_actual text;
BEGIN
  FOR v_expected IN SELECT * FROM (VALUES
    ('generate_tagihan_batch','5193365308cbc3e5b6fc27436b589d1e'),
    ('posting_spp_tagihan_atomik','e5e9a56ea10abe085c09fb7ab881cc1a'),
    ('akui_pendapatan_dimuka_atomik','725af960e94e891efbdd452cb5025549'),
    ('batalkan_pembayaran_atomik','f46f16bdf4f53f7ad054e7f1cf13e214'),
    ('batalkan_tagihan_atomik','cac7f726d0fd913b4dc5bef7204e8825')
  ) AS x(name,hash) LOOP
    SELECT md5(pg_get_functiondef(p.oid)) INTO v_actual FROM pg_proc p
    WHERE p.pronamespace='public'::regnamespace AND p.proname=v_expected.name;
    IF v_actual IS DISTINCT FROM v_expected.hash THEN
      RAISE EXCEPTION 'RPC % berubah sejak audit; hentikan dan periksa ulang',v_expected.name;
    END IF;
  END LOOP;
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

      v_pendapatan_efektif := v_jenis.akun_pendapatan_id;
      IF v_is_spp THEN
        SELECT * INTO v_spp_snapshot FROM public.snapshot_spp_siswa(p_jenis_id,v_row.siswa_id);
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
$function$;

CREATE OR REPLACE FUNCTION public.posting_spp_tagihan_atomik(p_tagihan_id uuid, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
 t public.tagihan; jp public.jenis_pembayaran;
 v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
 v_due date; v_paid numeric; v_net numeric; v_discount numeric; v_gross numeric;
 v_piutang uuid; v_potongan uuid; v_pegawai uuid; v_dept uuid;
 v_jurnal uuid; v_nomor text; v_nama text;
BEGIN
 SELECT * INTO t FROM public.tagihan WHERE id=p_tagihan_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Tagihan tidak ditemukan'; END IF;
 SELECT * INTO STRICT jp FROM public.jenis_pembayaran WHERE id=t.jenis_id;
 IF jp.tipe<>'bulanan' OR lower(btrim(jp.nama)) !~ '^spp([[:space:]-]|$)' THEN
  RAISE EXCEPTION 'Tagihan bukan SPP bulanan';
 END IF;
 IF t.status='dibatalkan' THEN RAISE EXCEPTION 'Tagihan sudah dibatalkan'; END IF;
 IF t.jurnal_piutang_id IS NOT NULL OR t.pengakuan_spp_selesai THEN
  RETURN jsonb_build_object('diposting',false,'jumlah',0,'jurnal_id',t.jurnal_piutang_id);
 END IF;
 v_due := public.tanggal_pengakuan_tagihan(t.id);
 IF v_due IS NULL OR v_due>v_today THEN
  RAISE EXCEPTION 'SPP belum dapat diakui sebelum awal bulan layanan (%)',v_due;
 END IF;
 -- Jangan membangun piutang/pendapatan di atas penerimaan historis tanpa bukti jurnal.
 IF EXISTS (
  SELECT 1 FROM public.pembayaran p
  LEFT JOIN public.pendapatan_dimuka pd ON pd.pembayaran_id=p.id
  WHERE p.tagihan_id=t.id AND
    (pd.id IS NULL OR pd.status <> 'pending' OR pd.jumlah<>p.jumlah
     OR pd.siswa_id<>p.siswa_id OR pd.jenis_id<>p.jenis_id OR NOT EXISTS (
     SELECT 1 FROM public.jurnal_detail jd JOIN public.jurnal j ON j.id=jd.jurnal_id
     JOIN public.akun_rekening a ON a.id=jd.akun_id
     WHERE jd.jurnal_id=p.jurnal_id AND j.status='posted' AND a.jenis='liabilitas'
       AND jd.kredit=p.jumlah AND jd.debit=0))
 ) THEN RAISE EXCEPTION 'Penerimaan SPP belum memiliki jurnal kewajiban yang valid'; END IF;
 SELECT COALESCE(sum(jumlah),0) INTO v_paid FROM public.pembayaran WHERE tagihan_id=t.id;
 IF v_paid>t.nominal THEN RAISE EXCEPTION 'Pembayaran SPP melebihi nominal tagihan'; END IF;
 v_net:=t.nominal-v_paid; v_discount:=COALESCE(t.nominal_diskon,0);
 v_gross:=v_net+v_discount;
 SELECT akun_id INTO v_piutang FROM public.pengaturan_akun WHERE kode_setting='piutang_siswa';
 SELECT COALESCE(jp.akun_potongan_id,pa.akun_id) INTO v_potongan
 FROM (SELECT 1) x LEFT JOIN public.pengaturan_akun pa ON pa.kode_setting='AKUN_POTONGAN_PENDAPATAN';
 IF v_net>0 AND v_piutang IS NULL THEN RAISE EXCEPTION 'Akun piutang belum dikonfigurasi'; END IF;
 IF v_discount>0 AND v_potongan IS NULL THEN RAISE EXCEPTION 'Akun potongan belum dikonfigurasi'; END IF;
 IF public.akun_pendapatan_tagihan(t.id) IS NULL THEN RAISE EXCEPTION 'Akun pendapatan belum dikonfigurasi'; END IF;
 SELECT nama,departemen_id INTO v_nama,v_dept FROM public.siswa WHERE id=t.siswa_id;
 IF t.kelas_id IS NOT NULL THEN
  v_dept:=COALESCE((SELECT departemen_id FROM public.kelas WHERE id=t.kelas_id),v_dept);
 END IF;
 IF p_user_id IS NOT NULL THEN
  SELECT pegawai_id INTO v_pegawai FROM public.users_profile WHERE id=p_user_id;
 END IF;
 IF v_gross>0 THEN
  v_nomor:=public.generate_nomor_jurnal('JPI',extract(year FROM v_today)::integer);
  INSERT INTO public.jurnal(nomor,tanggal,keterangan,referensi,departemen_id,total_debit,total_kredit,status,dibuat_oleh)
  VALUES(v_nomor,v_today,'Pengakuan awal bulan '||jp.nama||'-B'||t.bulan||' - '||COALESCE(v_nama,t.siswa_id::text),
    t.id::text,v_dept,v_gross,v_gross,'posted',v_pegawai) RETURNING id INTO v_jurnal;
  IF v_net>0 THEN
   INSERT INTO public.jurnal_detail(jurnal_id,akun_id,keterangan,debit,kredit,urutan)
   VALUES(v_jurnal,v_piutang,'Sisa piutang '||jp.nama,v_net,0,1);
  END IF;
  IF v_discount>0 THEN
   INSERT INTO public.jurnal_detail(jurnal_id,akun_id,keterangan,debit,kredit,urutan)
   VALUES(v_jurnal,v_potongan,'Potongan '||jp.nama,v_discount,0,2);
  END IF;
  INSERT INTO public.jurnal_detail(jurnal_id,akun_id,keterangan,debit,kredit,urutan)
  VALUES(v_jurnal,public.akun_pendapatan_tagihan(t.id),'Pendapatan '||jp.nama,0,v_gross,3);
 END IF;
 UPDATE public.tagihan SET jurnal_piutang_id=v_jurnal,pengakuan_spp_selesai=true,
  status=CASE WHEN v_paid>=nominal THEN 'lunas' WHEN v_paid>0 THEN 'sebagian' ELSE 'belum_bayar' END
 WHERE id=t.id;
 RETURN jsonb_build_object('diposting',v_jurnal IS NOT NULL,'jumlah',v_net,'jurnal_id',v_jurnal);
END;
$function$;

CREATE OR REPLACE FUNCTION public.akui_pendapatan_dimuka_atomik(p_dimuka_id uuid, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_pd public.pendapatan_dimuka;
  v_p public.pembayaran;
  v_t public.tagihan;
  v_jenis public.jenis_pembayaran;
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_due date;
  v_payment_id uuid;
  v_liability uuid;
  v_liability_count integer;
  v_potongan uuid;
  v_discount numeric := 0;
  v_gross numeric;
  v_is_uang_pangkal boolean := false;
  v_jurnal uuid;
  v_nomor text;
  v_pegawai uuid;
BEGIN
  -- Urutan lock sama dengan pembatalan: pembayaran dahulu, lalu pendapatan.
  SELECT pembayaran_id INTO v_payment_id FROM public.pendapatan_dimuka WHERE id = p_dimuka_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pendapatan diterima di muka tidak ditemukan'; END IF;
  SELECT * INTO v_p FROM public.pembayaran WHERE id = v_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pembayaran sudah dibatalkan'; END IF;
  SELECT * INTO v_pd FROM public.pendapatan_dimuka WHERE id = p_dimuka_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pendapatan diterima di muka sudah dibatalkan'; END IF;
  IF v_pd.status = 'diakui' AND v_pd.jurnal_pengakuan_id IS NOT NULL THEN
    RETURN jsonb_build_object('diakui', false, 'jurnal_id', v_pd.jurnal_pengakuan_id);
  END IF;
  IF v_pd.status <> 'pending' OR v_pd.jurnal_pengakuan_id IS NOT NULL THEN
    RAISE EXCEPTION 'Status pendapatan diterima di muka tidak dapat diakui';
  END IF;
  SELECT * INTO STRICT v_jenis FROM public.jenis_pembayaran WHERE id = v_pd.jenis_id;
  v_is_uang_pangkal := upper(btrim(v_jenis.nama)) ~ '^UANG PANGKAL (TK|SD|SMP|SMA|MTA)$';
  IF v_p.tagihan_id IS NOT NULL THEN
    SELECT * INTO v_t FROM public.tagihan WHERE id = v_p.tagihan_id;
  END IF;
  v_due := CASE WHEN v_t.id IS NOT NULL THEN public.tanggal_pengakuan_tagihan(v_t.id)
    WHEN v_jenis.tipe='bulanan' AND lower(btrim(v_jenis.nama)) ~ '^spp([[:space:]-]|$)'
    THEN public.hitung_pengakuan_spp(v_pd.tahun_ajaran_target_id,v_pd.bulan)
    ELSE public.hitung_jatuh_tempo_tagihan(v_pd.tahun_ajaran_target_id,v_pd.bulan,v_jenis.hari_jatuh_tempo) END;
  IF v_due IS NULL OR v_due > v_today THEN
    RAISE EXCEPTION 'Pendapatan belum dapat diakui sebelum %', COALESCE(v_due::text, 'tanggal pengakuan ditentukan');
  END IF;
  IF v_t.status = 'dibatalkan' THEN RAISE EXCEPTION 'Tagihan sudah dibatalkan'; END IF;
  IF COALESCE(public.akun_pendapatan_tagihan(v_p.tagihan_id),v_jenis.akun_pendapatan_id) IS NULL THEN RAISE EXCEPTION 'Akun pendapatan belum dikonfigurasi'; END IF;

  -- Gunakan akun kewajiban di jurnal penerimaan, bukan konfigurasi yang mungkin berubah.
  SELECT count(*), (array_agg(jd.akun_id))[1] INTO v_liability_count, v_liability
  FROM public.jurnal_detail jd
  JOIN public.akun_rekening a ON a.id = jd.akun_id
  JOIN public.jurnal j ON j.id = jd.jurnal_id
  WHERE jd.jurnal_id = v_p.jurnal_id AND j.status = 'posted'
    AND jd.kredit = v_pd.jumlah AND jd.debit = 0 AND a.jenis = 'liabilitas';
  IF v_liability_count <> 1 THEN
    RAISE EXCEPTION 'Jurnal penerimaan tidak memiliki akun kewajiban yang sesuai';
  END IF;

  IF v_t.id IS NOT NULL AND v_jenis.tipe='bulanan'
     AND lower(btrim(v_jenis.nama)) ~ '^spp([[:space:]-]|$)' THEN
    PERFORM public.posting_spp_tagihan_atomik(v_t.id,p_user_id);
  END IF;

  -- Untuk Uang Pangkal, diskon tidak ditempelkan pada salah satu cicilan.
  -- Diskon diakui satu kali pada posting jatuh tempo agar pembatalan cicilan
  -- setelah pengakuan tidak ikut membalik diskon seluruh tagihan.
  IF v_t.id IS NOT NULL AND v_t.jurnal_piutang_id IS NULL AND COALESCE(v_t.nominal_diskon, 0) > 0
     AND NOT (v_jenis.tipe='bulanan' AND lower(btrim(v_jenis.nama)) ~ '^spp([[:space:]-]|$)')
     AND NOT v_is_uang_pangkal THEN
    IF v_t.status <> 'lunas' OR v_pd.jumlah <> v_t.nominal OR
       (SELECT count(*) FROM public.pendapatan_dimuka pd
        JOIN public.pembayaran p ON p.id = pd.pembayaran_id WHERE p.tagihan_id = v_t.id) <> 1 THEN
      RAISE EXCEPTION 'Pengakuan tagihan diskon memerlukan pembayaran penuh tunggal';
    END IF;
    v_discount := v_t.nominal_diskon;
    SELECT COALESCE(v_jenis.akun_potongan_id, pa.akun_id) INTO v_potongan
      FROM (SELECT 1) x LEFT JOIN public.pengaturan_akun pa ON pa.kode_setting = 'AKUN_POTONGAN_PENDAPATAN';
    IF v_potongan IS NULL THEN RAISE EXCEPTION 'Akun potongan pendapatan belum dikonfigurasi'; END IF;
  END IF;
  v_gross := v_pd.jumlah + v_discount;
  IF p_user_id IS NOT NULL THEN
    SELECT pegawai_id INTO v_pegawai FROM public.users_profile WHERE id = p_user_id;
  END IF;
  v_nomor := public.generate_nomor_jurnal('PD', extract(year FROM v_today)::integer);
  INSERT INTO public.jurnal(nomor, tanggal, keterangan, referensi, departemen_id,
    total_debit, total_kredit, status, dibuat_oleh)
  VALUES (v_nomor, v_today, 'Pengakuan pendapatan ' || v_jenis.nama,
    v_pd.pembayaran_id::text, v_pd.departemen_id, v_gross, v_gross, 'posted', v_pegawai)
  RETURNING id INTO v_jurnal;
  INSERT INTO public.jurnal_detail(jurnal_id, akun_id, keterangan, debit, kredit, urutan)
  VALUES (v_jurnal, v_liability, 'Pengakuan Pendapatan Diterima di Muka', v_pd.jumlah, 0, 1);
  IF v_discount > 0 THEN
    INSERT INTO public.jurnal_detail(jurnal_id, akun_id, keterangan, debit, kredit, urutan)
    VALUES (v_jurnal, v_potongan, 'Potongan ' || v_jenis.nama, v_discount, 0, 2);
  END IF;
  INSERT INTO public.jurnal_detail(jurnal_id, akun_id, keterangan, debit, kredit, urutan)
  VALUES (v_jurnal, COALESCE(public.akun_pendapatan_tagihan(v_p.tagihan_id),v_jenis.akun_pendapatan_id), 'Pendapatan ' || v_jenis.nama, 0, v_gross, 3);
  UPDATE public.pendapatan_dimuka SET status = 'diakui', jurnal_pengakuan_id = v_jurnal,
    tanggal_pengakuan = v_today WHERE id = v_pd.id;
  RETURN jsonb_build_object('diakui', true, 'jurnal_id', v_jurnal, 'jumlah', v_pd.jumlah);
END;
$function$;

CREATE OR REPLACE FUNCTION public.batalkan_pembayaran_atomik(p_pembayaran_id uuid, p_alasan text, p_tanggal date, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pb                    public.pembayaran;
  v_jurnal                public.jurnal;
  v_dimuka                public.pendapatan_dimuka;
  v_nomor                 text;
  v_tahun                 integer;
  v_pembalik_id           uuid;
  v_pembalik_pengakuan_id uuid;
  v_tagihan               public.tagihan;
  v_total_sisa            numeric := 0;
  v_payment_sisa_id       uuid;
  v_status_baru           text;
  v_restore_piutang boolean := false;
  v_spp_piutang uuid;
  v_spp_pendapatan uuid;
  v_spp_jurnal uuid;
BEGIN
  SELECT * INTO v_pb FROM public.pembayaran WHERE id = p_pembayaran_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pembayaran tidak ditemukan'; END IF;

  v_tahun := EXTRACT(year FROM p_tanggal)::integer;

  SELECT * INTO v_dimuka
  FROM public.pendapatan_dimuka
  WHERE pembayaran_id = p_pembayaran_id
  LIMIT 1 FOR UPDATE;

  IF FOUND THEN
    IF v_dimuka.jurnal_pengakuan_id IS NOT NULL THEN
      SELECT * INTO v_jurnal FROM public.jurnal WHERE id = v_dimuka.jurnal_pengakuan_id;
      IF FOUND THEN
        SELECT public.generate_nomor_jurnal('JU', v_tahun) INTO v_nomor;
        INSERT INTO public.jurnal (
          nomor, tanggal, keterangan, referensi, departemen_id, program_dana_id,
          total_debit, total_kredit, status, tipe, jurnal_asal_id
        ) VALUES (
          v_nomor, p_tanggal, 'PEMBATALAN PENGAKUAN: ' || v_jurnal.keterangan, v_jurnal.nomor,
          v_jurnal.departemen_id, v_jurnal.program_dana_id,
          v_jurnal.total_debit, v_jurnal.total_kredit, 'posted', 'pembalik', v_jurnal.id
        ) RETURNING id INTO v_pembalik_pengakuan_id;

        INSERT INTO public.jurnal_detail (jurnal_id, akun_id, debit, kredit, keterangan, urutan)
        SELECT v_pembalik_pengakuan_id, akun_id, kredit, debit,
               COALESCE('[BALIK] ' || keterangan, '[BALIK]'), urutan
        FROM public.jurnal_detail
        WHERE jurnal_id = v_jurnal.id;
      END IF;
    END IF;
    DELETE FROM public.pendapatan_dimuka WHERE id = v_dimuka.id;
  END IF;

  IF v_pb.jurnal_id IS NOT NULL THEN
    SELECT * INTO v_jurnal FROM public.jurnal WHERE id = v_pb.jurnal_id;
    IF FOUND THEN
      SELECT public.generate_nomor_jurnal('JU', v_tahun) INTO v_nomor;
      INSERT INTO public.jurnal (
        nomor, tanggal, keterangan, referensi, departemen_id, program_dana_id,
        total_debit, total_kredit, status, tipe, jurnal_asal_id
      ) VALUES (
        v_nomor, p_tanggal, 'PEMBATALAN: ' || v_jurnal.keterangan, v_jurnal.nomor,
        v_jurnal.departemen_id, v_jurnal.program_dana_id,
        v_jurnal.total_debit, v_jurnal.total_kredit, 'posted', 'pembalik', v_jurnal.id
      ) RETURNING id INTO v_pembalik_id;

      INSERT INTO public.jurnal_detail (jurnal_id, akun_id, debit, kredit, keterangan, urutan)
      SELECT v_pembalik_id, akun_id, kredit, debit,
             COALESCE('[BALIK] ' || keterangan, '[BALIK]'), urutan
      FROM public.jurnal_detail
      WHERE jurnal_id = v_jurnal.id;
    END IF;
  END IF;

  IF v_pb.tagihan_id IS NOT NULL THEN
    SELECT * INTO v_tagihan
    FROM public.tagihan
    WHERE id = v_pb.tagihan_id
    FOR UPDATE;
  ELSE
    UPDATE public.tagihan
    SET status = CASE
          WHEN jatuh_tempo IS NOT NULL AND jatuh_tempo > CURRENT_DATE THEN 'terjadwal'
          ELSE 'belum_bayar'
        END,
        pembayaran_id = NULL
    WHERE pembayaran_id = p_pembayaran_id;
  END IF;

    -- Sisa piutang dapat sudah diakui meskipun PD masih pending. Pembatalan
    -- pada celah waktu tersebut tetap memulihkan piutang ke akun snapshot.
    v_restore_piutang := v_dimuka.id IS NOT NULL
      AND EXISTS(
        SELECT 1
        FROM public.tagihan t
        JOIN public.jenis_pembayaran jp ON jp.id=t.jenis_id
        WHERE t.id=v_pb.tagihan_id
          AND (
            (t.pengakuan_spp_selesai
              AND jp.tipe='bulanan'
              AND lower(btrim(jp.nama)) ~ '^spp([[:space:]-]|$)')
            OR
            (upper(btrim(jp.nama)) ~ '^UANG PANGKAL (TK|SD|SMP|SMA|MTA)$'
              AND public.tanggal_pengakuan_tagihan(t.id) <= p_tanggal
              AND v_dimuka.jurnal_pengakuan_id IS NOT NULL)
          )
      );

  IF v_restore_piutang THEN
    SELECT akun_id INTO v_spp_piutang FROM public.pengaturan_akun WHERE kode_setting='piutang_siswa';
    SELECT COALESCE(public.akun_pendapatan_tagihan(v_pb.tagihan_id),akun_pendapatan_id) INTO v_spp_pendapatan FROM public.jenis_pembayaran WHERE id=v_pb.jenis_id;
    IF v_spp_piutang IS NULL OR v_spp_pendapatan IS NULL THEN
      RAISE EXCEPTION 'Akun piutang/pendapatan belum dikonfigurasi';
    END IF;
    v_nomor:=public.generate_nomor_jurnal('JPI',v_tahun);
    INSERT INTO public.jurnal(nomor,tanggal,keterangan,referensi,departemen_id,total_debit,total_kredit,status)
    VALUES(v_nomor,p_tanggal,'Piutang atas pembatalan pembayaran yang telah diakui',v_pb.tagihan_id::text,
      COALESCE(v_dimuka.departemen_id,v_pb.departemen_id),v_pb.jumlah,v_pb.jumlah,'posted') RETURNING id INTO v_spp_jurnal;
    INSERT INTO public.jurnal_detail(jurnal_id,akun_id,debit,kredit,keterangan,urutan) VALUES
      (v_spp_jurnal,v_spp_piutang,v_pb.jumlah,0,'Piutang Siswa',1),
      (v_spp_jurnal,v_spp_pendapatan,0,v_pb.jumlah,'Pemulihan pendapatan periode layanan',2);
    UPDATE public.tagihan SET jurnal_piutang_id=COALESCE(jurnal_piutang_id,v_spp_jurnal)
    WHERE id=v_pb.tagihan_id;
  END IF;

  DELETE FROM public.pembayaran WHERE id = p_pembayaran_id;

  IF v_pb.tagihan_id IS NOT NULL AND v_tagihan.id IS NOT NULL THEN
    SELECT COALESCE(SUM(jumlah), 0)
    INTO v_total_sisa
    FROM public.pembayaran
    WHERE tagihan_id = v_pb.tagihan_id;

    SELECT id INTO v_payment_sisa_id
    FROM public.pembayaran
    WHERE tagihan_id = v_pb.tagihan_id
    ORDER BY tanggal_bayar DESC NULLS LAST, id DESC
    LIMIT 1;

    v_status_baru := CASE
      WHEN v_total_sisa >= v_tagihan.nominal THEN 'lunas'
      WHEN v_total_sisa > 0
        AND v_tagihan.jurnal_piutang_id IS NULL
        AND v_tagihan.jatuh_tempo IS NOT NULL
        AND v_tagihan.jatuh_tempo > CURRENT_DATE
        AND EXISTS (
          SELECT 1
          FROM public.jenis_pembayaran jp
          WHERE jp.id=v_tagihan.jenis_id
            AND upper(btrim(jp.nama)) ~ '^UANG PANGKAL (TK|SD|SMP|SMA|MTA)$'
        ) THEN 'terjadwal'
      WHEN v_total_sisa > 0 THEN 'sebagian'
      WHEN v_tagihan.jurnal_piutang_id IS NOT NULL OR v_tagihan.pengakuan_spp_selesai THEN 'belum_bayar'
      WHEN v_tagihan.jatuh_tempo IS NOT NULL AND v_tagihan.jatuh_tempo > CURRENT_DATE THEN 'terjadwal'
      ELSE 'belum_bayar'
    END;

    UPDATE public.tagihan
    SET status = v_status_baru,
        pembayaran_id = v_payment_sisa_id
    WHERE id = v_pb.tagihan_id;
  END IF;

  RETURN jsonb_build_object(
    'pembayaran_id', p_pembayaran_id,
    'jurnal_pembalik_id', v_pembalik_id,
    'jurnal_pembalik_pengakuan_id', v_pembalik_pengakuan_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.batalkan_tagihan_atomik(p_tagihan_id uuid, p_mode text, p_alasan text, p_tanggal date, p_user_id uuid, p_nominal_baru numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_t              public.tagihan;
  v_dept_id        uuid;
  v_unit_dept      text := 'unit_pendidikan';
  v_kategori       text;
  v_tb             record;
  v_log_count      integer;
  v_jurnal_asal    public.jurnal;
  v_pembalik_id    uuid;
  v_nomor          text;
  v_tahun          integer;
  v_jenis_nama     text;
  v_akun_pendapatan uuid;
  v_akun_piutang    uuid;
  v_jurnal_baru_id  uuid;
BEGIN
  IF p_mode NOT IN ('batal', 'koreksi_nominal') THEN
    RAISE EXCEPTION 'Mode tidak dikenal: %', p_mode;
  END IF;
  IF p_alasan IS NULL OR btrim(p_alasan) = '' THEN
    RAISE EXCEPTION 'Alasan wajib diisi.';
  END IF;

  SELECT * INTO v_t FROM public.tagihan WHERE id = p_tagihan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tagihan tidak ditemukan';
  END IF;
  IF v_t.status NOT IN ('belum_bayar', 'terjadwal') THEN
    RAISE EXCEPTION 'Hanya tagihan berstatus ''belum bayar'' atau ''terjadwal'' yang bisa dibatalkan/dikoreksi lewat menu ini. Tagihan yang sudah dibayar perlu proses refund.';
  END IF;

  SELECT jenis.nama, public.akun_pendapatan_tagihan(v_t.id), siswa.departemen_id
    INTO v_jenis_nama, v_akun_pendapatan, v_dept_id
    FROM public.jenis_pembayaran jenis
    LEFT JOIN public.siswa siswa ON siswa.id = v_t.siswa_id
   WHERE jenis.id = v_t.jenis_id;

  IF p_mode = 'koreksi_nominal' THEN
    IF p_nominal_baru IS NULL OR p_nominal_baru <= 0 THEN
      RAISE EXCEPTION 'Nominal baru harus lebih dari 0.';
    END IF;
    IF p_nominal_baru = v_t.nominal THEN
      RAISE EXCEPTION 'Nominal baru sama dengan nominal lama.';
    END IF;
  END IF;

  SELECT tb.id, tb.nama INTO v_tb
    FROM public.tahun_buku tb
   WHERE tb.tanggal_mulai <= p_tanggal AND tb.tanggal_selesai >= p_tanggal
   LIMIT 1;

  IF FOUND THEN
    IF v_dept_id IS NOT NULL THEN
      SELECT kategori INTO v_kategori FROM public.departemen WHERE id = v_dept_id;
      IF v_kategori IN ('unit_usaha', 'unit_dana_terikat', 'unit_yayasan') THEN
        v_unit_dept := 'unit_usaha_dana';
      END IF;
    END IF;

    SELECT count(*) INTO v_log_count
      FROM public.log_tutup_buku
     WHERE tahun_ajaran_id = v_tb.id AND unit = v_unit_dept;

    IF v_log_count > 0 THEN
      RAISE EXCEPTION 'Transaksi ditolak: periode "%" untuk % sudah ditutup buku.',
        v_tb.nama, (CASE WHEN v_unit_dept = 'unit_pendidikan' THEN 'Unit Pendidikan' ELSE 'Unit Usaha & Dana' END);
    END IF;
  END IF;

  IF v_t.jurnal_piutang_id IS NOT NULL THEN
    SELECT * INTO v_jurnal_asal FROM public.jurnal WHERE id = v_t.jurnal_piutang_id;
    IF FOUND THEN
      IF v_jurnal_asal.status <> 'posted' THEN
        RAISE EXCEPTION 'Jurnal piutang asal belum diposting; tidak bisa dibalik otomatis.';
      END IF;

      v_tahun := EXTRACT(year FROM p_tanggal)::integer;
      SELECT public.generate_nomor_jurnal('JU', v_tahun) INTO v_nomor;

      INSERT INTO public.jurnal (
        nomor, tanggal, keterangan, referensi, departemen_id, program_dana_id,
        total_debit, total_kredit, status, tipe, jurnal_asal_id
      ) VALUES (
        v_nomor, p_tanggal,
        CASE WHEN p_mode = 'batal' THEN 'KOREKSI/BATAL: ' ELSE 'KOREKSI: ' END || v_jurnal_asal.keterangan,
        v_jurnal_asal.nomor, v_jurnal_asal.departemen_id, v_jurnal_asal.program_dana_id,
        v_jurnal_asal.total_debit, v_jurnal_asal.total_kredit, 'posted', 'pembalik', v_jurnal_asal.id
      ) RETURNING id INTO v_pembalik_id;

      INSERT INTO public.jurnal_detail (jurnal_id, akun_id, debit, kredit, keterangan, urutan)
      SELECT v_pembalik_id, akun_id, kredit, debit,
             COALESCE('[BALIK] ' || keterangan, '[BALIK]'), urutan
        FROM public.jurnal_detail WHERE jurnal_id = v_jurnal_asal.id;
    END IF;
  END IF;

  IF p_mode = 'batal' THEN
    UPDATE public.tagihan
       SET status = 'dibatalkan',
           dibatalkan_alasan = p_alasan,
           dibatalkan_at = now(),
           dibatalkan_oleh = p_user_id,
           jurnal_pembalik_id = v_pembalik_id
     WHERE id = p_tagihan_id;

    INSERT INTO public.audit_keuangan (
      tabel_sumber, record_id, aksi, data_lama, data_baru, keterangan, departemen_id, dibuat_oleh
    ) VALUES (
      'tagihan', p_tagihan_id::text, 'UPDATE',
      jsonb_build_object('status', v_t.status, 'nominal', v_t.nominal, 'jurnal_piutang_id', v_t.jurnal_piutang_id),
      jsonb_build_object('status', 'dibatalkan', 'alasan', p_alasan, 'jurnal_pembalik_id', v_pembalik_id),
      'Pembatalan tagihan ' || COALESCE(v_jenis_nama, '') || ' ' || v_t.nominal::text || ' — ' || p_alasan,
      v_dept_id, p_user_id
    );

    RETURN jsonb_build_object('mode', 'batal', 'tagihan_id', p_tagihan_id, 'jurnal_pembalik_id', v_pembalik_id);
  END IF;

  IF v_pembalik_id IS NOT NULL THEN
    SELECT akun_id INTO v_akun_piutang
      FROM public.pengaturan_akun WHERE kode_setting = 'piutang_siswa' LIMIT 1;

    IF v_akun_piutang IS NOT NULL AND v_akun_pendapatan IS NOT NULL THEN
      v_tahun := EXTRACT(year FROM p_tanggal)::integer;
      SELECT public.generate_nomor_jurnal('JPI', v_tahun) INTO v_nomor;

      INSERT INTO public.jurnal (
        nomor, tanggal, keterangan, departemen_id, total_debit, total_kredit, status
      ) VALUES (
        v_nomor, p_tanggal,
        'Piutang ' || COALESCE(v_jenis_nama, '') || ' (koreksi) - siswa ' || v_t.siswa_id::text,
        v_dept_id, p_nominal_baru, p_nominal_baru, 'posted'
      ) RETURNING id INTO v_jurnal_baru_id;

      INSERT INTO public.jurnal_detail (jurnal_id, akun_id, debit, kredit, keterangan, urutan) VALUES
        (v_jurnal_baru_id, v_akun_piutang,    p_nominal_baru, 0,              'Piutang (koreksi nominal)',    1),
        (v_jurnal_baru_id, v_akun_pendapatan, 0,              p_nominal_baru, 'Pendapatan (koreksi nominal)', 2);
    END IF;
  END IF;

  UPDATE public.tagihan
     SET nominal = p_nominal_baru,
         jurnal_piutang_id = v_jurnal_baru_id
   WHERE id = p_tagihan_id;

  INSERT INTO public.audit_keuangan (
    tabel_sumber, record_id, aksi, data_lama, data_baru, keterangan, departemen_id, dibuat_oleh
  ) VALUES (
    'tagihan', p_tagihan_id::text, 'UPDATE',
    jsonb_build_object('nominal', v_t.nominal, 'jurnal_piutang_id', v_t.jurnal_piutang_id),
    jsonb_build_object('nominal', p_nominal_baru, 'jurnal_piutang_id', v_jurnal_baru_id, 'alasan', p_alasan),
    'Koreksi nominal tagihan ' || COALESCE(v_jenis_nama, '') || ': ' || v_t.nominal::text || ' -> ' || p_nominal_baru::text || ' — ' || p_alasan,
    v_dept_id, p_user_id
  );

  RETURN jsonb_build_object(
    'mode', 'koreksi_nominal', 'tagihan_id', p_tagihan_id,
    'jurnal_pembalik_id', v_pembalik_id, 'jurnal_baru_id', v_jurnal_baru_id,
    'warn_no_jurnal', (v_pembalik_id IS NOT NULL AND v_jurnal_baru_id IS NULL)
  );
EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$function$;
