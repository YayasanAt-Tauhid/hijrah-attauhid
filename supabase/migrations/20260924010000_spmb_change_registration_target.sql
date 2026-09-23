-- Koreksi lembaga/jenjang tujuan SPMB sebelum siswa diaktifkan.
-- Pendaftaran tetap memakai siswa_id/pendaftaran_id yang sama; histori perubahan
-- dan koreksi akuntansi promo dicatat, bukan membuat pendaftaran baru.

CREATE TABLE IF NOT EXISTS public.spmb_tujuan_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  siswa_id uuid NOT NULL REFERENCES public.siswa(id) ON DELETE CASCADE,
  pendaftaran_id uuid,
  departemen_asal_id uuid REFERENCES public.departemen(id),
  departemen_tujuan_id uuid REFERENCES public.departemen(id),
  angkatan_asal_id uuid REFERENCES public.angkatan(id),
  angkatan_tujuan_id uuid REFERENCES public.angkatan(id),
  siswa_internal boolean NOT NULL DEFAULT false,
  status_sebelum text,
  milestones_sebelum jsonb NOT NULL DEFAULT '{}'::jsonb,
  nis_sebelum text,
  alasan text NOT NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS spmb_tujuan_audit_siswa_idx
  ON public.spmb_tujuan_audit (siswa_id, changed_at DESC);

ALTER TABLE public.spmb_tujuan_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spmb_tujuan_audit_select ON public.spmb_tujuan_audit;
CREATE POLICY spmb_tujuan_audit_select
ON public.spmb_tujuan_audit
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'admin')
  OR (
    public.has_role(auth.uid(),'admin_tu')
    AND (
      public.can_manage_akademik_departemen(auth.uid(), departemen_asal_id)
      OR public.can_manage_akademik_departemen(auth.uid(), departemen_tujuan_id)
    )
  )
);

REVOKE ALL ON TABLE public.spmb_tujuan_audit FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.spmb_tujuan_audit FROM authenticated;
GRANT SELECT ON TABLE public.spmb_tujuan_audit TO authenticated;

-- Referensi tujuan lintas lembaga hanya dibuka untuk petugas yang memang
-- berwenang atas pendaftaran pada tujuan SAAT INI.
CREATE OR REPLACE FUNCTION public.spmb_target_change_reference(p_siswa_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  s public.siswa;
  d public.siswa_detail;
  current_target uuid;
  result jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Anda harus masuk terlebih dahulu'; END IF;

  SELECT * INTO s FROM public.siswa WHERE id=p_siswa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Siswa tidak ditemukan'; END IF;
  SELECT * INTO d FROM public.siswa_detail WHERE siswa_id=p_siswa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pendaftaran SPMB tidak ditemukan'; END IF;

  current_target := COALESCE(d.spmb_departemen_tujuan_id, s.departemen_id);
  IF NOT (
    public.has_role(uid,'admin')
    OR (
      public.has_role(uid,'admin_tu')
      AND public.can_manage_akademik_departemen(uid,current_target)
    )
  ) THEN
    RAISE EXCEPTION 'Akses perubahan tujuan SPMB ditolak';
  END IF;

  SELECT jsonb_build_object(
    'departemen', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',dep.id,'nama',dep.nama,'kode',dep.kode,'npsn',dep.npsn,'psb_dibuka',dep.psb_dibuka
      ) ORDER BY CASE upper(trim(COALESCE(dep.kode,'')))
          WHEN 'TK' THEN 1 WHEN 'SD' THEN 2 WHEN 'SMP' THEN 3
          WHEN 'SMA' THEN 4 WHEN 'MTA' THEN 5 ELSE 99 END, dep.nama)
      FROM public.departemen dep
      WHERE COALESCE(dep.aktif,true)
        AND dep.kategori='unit_pendidikan'
        AND upper(trim(COALESCE(dep.kode,''))) IN ('TK','SD','SMP','SMA','MTA')
    ), '[]'::jsonb),
    'angkatan', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',a.id,'nama',a.nama,'departemen_id',a.departemen_id
      ) ORDER BY a.nama DESC)
      FROM public.angkatan a
      WHERE COALESCE(a.aktif,true)
        AND EXISTS (
          SELECT 1 FROM public.departemen dep
          WHERE dep.id=a.departemen_id
            AND COALESCE(dep.aktif,true)
            AND dep.kategori='unit_pendidikan'
            AND upper(trim(COALESCE(dep.kode,''))) IN ('TK','SD','SMP','SMA','MTA')
        )
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION public.spmb_target_change_reference(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spmb_target_change_reference(uuid) TO authenticated;

-- Promo gratis 100% sudah dibukukan sebagai bruto + kontra-pendapatan.
-- Jika tujuan salah, jurnal lama dibalik dan tagihan lama DIBATALKAN; tidak
-- dihapus/ditimpa. Promo kemudian akan dibukukan ulang pada tujuan yang benar.
CREATE OR REPLACE FUNCTION public.spmb_retarget_cancel_promo(
  p_siswa_id uuid,
  p_old_jenis_id uuid,
  p_old_target_id uuid,
  p_alasan text,
  p_user_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  j public.jurnal;
  reversal_id uuid;
  nomor text;
  processed integer := 0;
BEGIN
  IF p_old_jenis_id IS NULL THEN RETURN 0; END IF;

  FOR r IN
    SELECT t.id, t.jurnal_piutang_id, t.jurnal_pembalik_id, t.siswa_diskon_id
    FROM public.tagihan t
    JOIN public.siswa_diskon sd ON sd.id=t.siswa_diskon_id
    JOIN public.skema_diskon sk ON sk.id=sd.skema_diskon_id
    WHERE t.siswa_id=p_siswa_id
      AND t.jenis_id=p_old_jenis_id
      AND t.status='lunas'
      AND COALESCE(t.nominal,0)=0
      AND t.pembayaran_id IS NULL
      AND sk.kategori='promo'
    FOR UPDATE OF t
  LOOP
    reversal_id := r.jurnal_pembalik_id;

    IF r.jurnal_piutang_id IS NOT NULL AND reversal_id IS NULL THEN
      SELECT * INTO j FROM public.jurnal WHERE id=r.jurnal_piutang_id FOR UPDATE;
      IF FOUND THEN
        IF j.status <> 'posted' THEN
          RAISE EXCEPTION 'Jurnal promo lama belum posted dan tidak aman untuk dikoreksi otomatis';
        END IF;
        SELECT public.generate_nomor_jurnal('JU', extract(year from current_date)::integer) INTO nomor;
        INSERT INTO public.jurnal(
          nomor,tanggal,keterangan,referensi,departemen_id,program_dana_id,
          total_debit,total_kredit,status,tipe,jurnal_asal_id
        ) VALUES (
          nomor,current_date,
          'KOREKSI TUJUAN SPMB: ' || COALESCE(j.keterangan,'Promo SPMB'),
          j.nomor,COALESCE(j.departemen_id,p_old_target_id),j.program_dana_id,
          j.total_debit,j.total_kredit,'posted','pembalik',j.id
        ) RETURNING id INTO reversal_id;

        INSERT INTO public.jurnal_detail(jurnal_id,akun_id,debit,kredit,keterangan,urutan)
        SELECT reversal_id,akun_id,kredit,debit,
               COALESCE('[BALIK TUJUAN SPMB] ' || keterangan,'[BALIK TUJUAN SPMB]'),urutan
        FROM public.jurnal_detail
        WHERE jurnal_id=j.id;
      END IF;
    END IF;

    UPDATE public.tagihan
    SET status='dibatalkan',
        dibatalkan_alasan=p_alasan,
        dibatalkan_at=now(),
        dibatalkan_oleh=p_user_id,
        jurnal_pembalik_id=reversal_id
    WHERE id=r.id;

    INSERT INTO public.audit_keuangan(
      tabel_sumber,record_id,aksi,data_lama,data_baru,keterangan,departemen_id,dibuat_oleh
    ) VALUES (
      'tagihan',r.id::text,'UPDATE',
      jsonb_build_object('status','lunas','nominal',0,'jurnal_piutang_id',r.jurnal_piutang_id),
      jsonb_build_object('status','dibatalkan','alasan',p_alasan,'jurnal_pembalik_id',reversal_id),
      'Koreksi tujuan SPMB: promo lama dibatalkan sebelum dipindahkan ke lembaga tujuan baru',
      p_old_target_id,p_user_id
    );

    processed := processed + 1;
  END LOOP;

  RETURN processed;
END
$$;

REVOKE ALL ON FUNCTION public.spmb_retarget_cancel_promo(uuid,uuid,uuid,text,uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.spmb_change_registration_target(
  p_siswa_id uuid,
  p_departemen_tujuan_id uuid,
  p_angkatan_tujuan_id uuid,
  p_status_asrama text,
  p_alasan text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  s public.siswa;
  d public.siswa_detail;
  target_dep public.departemen;
  target_cohort public.angkatan;
  old_target uuid;
  old_cohort uuid;
  internal_student boolean := false;
  old_jenis uuid;
  target_code text;
  target_needs_asrama boolean := false;
  new_asrama text;
  reason_text text := NULLIF(BTRIM(COALESCE(p_alasan,'')), '');
  had_milestones boolean := false;
  active_payment boolean := false;
  active_gateway boolean := false;
  promo_reversed integer := 0;
  promo_result jsonb;
  old_nis text;
  before_milestones jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Anda harus masuk terlebih dahulu'; END IF;
  IF p_siswa_id IS NULL OR p_departemen_tujuan_id IS NULL OR p_angkatan_tujuan_id IS NULL THEN
    RAISE EXCEPTION 'Siswa, lembaga tujuan, dan angkatan tujuan wajib dipilih';
  END IF;
  IF reason_text IS NULL OR length(reason_text) < 5 THEN
    RAISE EXCEPTION 'Alasan perubahan tujuan wajib diisi minimal 5 karakter';
  END IF;

  SELECT * INTO s FROM public.siswa WHERE id=p_siswa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Siswa tidak ditemukan'; END IF;
  SELECT * INTO d FROM public.siswa_detail WHERE siswa_id=p_siswa_id FOR UPDATE;
  IF NOT FOUND OR d.spmb_gelombang_id IS NULL THEN
    RAISE EXCEPTION 'Pendaftaran SPMB tidak ditemukan';
  END IF;

  old_target := COALESCE(d.spmb_departemen_tujuan_id,s.departemen_id);
  old_cohort := COALESCE(d.spmb_angkatan_tujuan_id,s.angkatan_id);
  internal_student := COALESCE(d.spmb_siswa_internal,false);
  old_nis := s.nis;

  IF NOT (
    public.has_role(uid,'admin')
    OR (
      public.has_role(uid,'admin_tu')
      AND public.can_manage_akademik_departemen(uid,old_target)
    )
  ) THEN
    RAISE EXCEPTION 'Akses perubahan tujuan SPMB ditolak';
  END IF;

  IF d.spmb_tanggal_aktivasi IS NOT NULL OR COALESCE(d.spmb_status_pendaftaran,'')='selesai' THEN
    RAISE EXCEPTION 'SPMB sudah selesai/diaktivasi. Gunakan Mutasi Antar Lembaga.';
  END IF;
  IF NOT internal_student AND s.status='aktif' THEN
    RAISE EXCEPTION 'Siswa sudah aktif pada lembaga lama. Gunakan Mutasi Antar Lembaga.';
  END IF;
  IF NOT internal_student AND COALESCE(s.status,'') NOT IN ('calon','diterima') THEN
    RAISE EXCEPTION 'Status siswa tidak dapat dikoreksi melalui alur SPMB';
  END IF;

  SELECT * INTO target_dep
  FROM public.departemen
  WHERE id=p_departemen_tujuan_id
    AND COALESCE(aktif,true)
    AND kategori='unit_pendidikan'
    AND upper(trim(COALESCE(kode,''))) IN ('TK','SD','SMP','SMA','MTA');
  IF NOT FOUND THEN RAISE EXCEPTION 'Lembaga tujuan tidak valid atau tidak aktif'; END IF;

  SELECT * INTO target_cohort
  FROM public.angkatan
  WHERE id=p_angkatan_tujuan_id
    AND departemen_id=p_departemen_tujuan_id
    AND COALESCE(aktif,true);
  IF NOT FOUND THEN RAISE EXCEPTION 'Angkatan tujuan tidak sesuai lembaga tujuan'; END IF;

  IF old_target IS NOT DISTINCT FROM p_departemen_tujuan_id
     AND old_cohort IS NOT DISTINCT FROM p_angkatan_tujuan_id THEN
    RAISE EXCEPTION 'Lembaga dan angkatan tujuan tidak berubah';
  END IF;

  target_code := upper(trim(COALESCE(target_dep.kode,'')));
  target_needs_asrama := target_code IN ('SMP','SMA','MTA')
    OR upper(COALESCE(target_dep.nama,'')) ~ '(^|\\s)(SMP|SMA|MTA)(\\s|$)';

  IF target_needs_asrama THEN
    IF target_code='MTA' AND NOT internal_student THEN
      new_asrama := 'asrama';
    ELSE
      IF COALESCE(p_status_asrama,'') NOT IN ('asrama','non_asrama') THEN
        RAISE EXCEPTION 'Pilih status Asrama atau Non Asrama untuk lembaga tujuan';
      END IF;
      new_asrama := p_status_asrama;
    END IF;
  ELSE
    new_asrama := NULL;
  END IF;

  -- Jika lembaga berubah, pembayaran uang riil/order gateway aktif tidak boleh
  -- dialihkan diam-diam ke jenis pembayaran lembaga lain.
  IF old_target IS DISTINCT FROM p_departemen_tujuan_id THEN
    SELECT jenis_pembayaran_id INTO old_jenis
    FROM public.konfigurasi_pmb
    WHERE departemen_id=old_target
    LIMIT 1;

    IF old_jenis IS NOT NULL THEN
      SELECT EXISTS(
        SELECT 1 FROM public.pembayaran p
        WHERE p.siswa_id=p_siswa_id
          AND p.jenis_id=old_jenis
          AND p.jurnal_id IS NOT NULL
          AND p.tanggal_bayar >= COALESCE(d.spmb_registered_at,s.created_at)::date
      ) INTO active_payment;

      SELECT EXISTS(
        SELECT 1
        FROM public.transaksi_midtrans_item i
        JOIN public.transaksi_midtrans tx ON tx.id=i.transaksi_id
        WHERE i.siswa_id=p_siswa_id
          AND i.jenis_id=old_jenis
          AND (
            tx.status='paid'
            OR (
              tx.status='pending'
              AND (tx.expired_at IS NULL OR tx.expired_at > now())
            )
          )
      ) INTO active_gateway;
    END IF;

    IF active_payment OR active_gateway THEN
      RAISE EXCEPTION 'Tujuan SPMB belum dapat diubah karena sudah ada pembayaran atau order pembayaran aktif. Selesaikan koreksi melalui bagian keuangan terlebih dahulu.';
    END IF;

    promo_reversed := public.spmb_retarget_cancel_promo(
      p_siswa_id,old_jenis,old_target,
      'Koreksi tujuan SPMB: ' || reason_text,uid
    );
  END IF;

  had_milestones := d.spmb_tanggal_tes IS NOT NULL
    OR d.spmb_tanggal_lulus IS NOT NULL
    OR d.spmb_tanggal_daftar_ulang IS NOT NULL
    OR d.spmb_status_kelulusan IS NOT NULL
    OR d.spmb_tanggal_keputusan IS NOT NULL
    OR COALESCE(d.spmb_status_pendaftaran,'calon') <> 'calon';

  before_milestones := jsonb_build_object(
    'status_pendaftaran',d.spmb_status_pendaftaran,
    'tanggal_tes',d.spmb_tanggal_tes,
    'status_kelulusan',d.spmb_status_kelulusan,
    'tanggal_lulus',d.spmb_tanggal_lulus,
    'tanggal_keputusan',d.spmb_tanggal_keputusan,
    'tanggal_daftar_ulang',d.spmb_tanggal_daftar_ulang,
    'kelas_tujuan_id',d.spmb_kelas_tujuan_id,
    'status_asrama',d.status_asrama
  );

  UPDATE public.siswa_detail
  SET spmb_departemen_tujuan_id=p_departemen_tujuan_id,
      spmb_angkatan_tujuan_id=p_angkatan_tujuan_id,
      spmb_kelas_tujuan_id=NULL,
      spmb_status_pendaftaran='calon',
      spmb_tanggal_tes=NULL,
      spmb_tanggal_lulus=NULL,
      spmb_tanggal_daftar_ulang=NULL,
      spmb_status_kelulusan=NULL,
      spmb_tanggal_keputusan=NULL,
      status_asrama=new_asrama
  WHERE siswa_id=p_siswa_id;

  IF internal_student THEN
    -- Siswa masih aktif pada lembaga asal; identitas akademiknya tidak disentuh.
    PERFORM public.spmb_invalidate_verification(
      p_siswa_id, ARRAY['departemen_id','angkatan_id','status_asrama']::text[]
    );
  ELSE
    -- Penempatan kelas/NIS lama hanya milik tujuan yang salah dan tidak boleh
    -- terbawa ke lembaga baru. Riwayat baris kelas tetap disimpan (aktif=false).
    UPDATE public.kelas_siswa ks
    SET aktif=false
    FROM public.kelas k
    WHERE ks.siswa_id=p_siswa_id
      AND ks.aktif
      AND k.id=ks.kelas_id
      AND k.departemen_id=old_target;

    UPDATE public.siswa
    SET departemen_id=p_departemen_tujuan_id,
        angkatan_id=p_angkatan_tujuan_id,
        status='calon',
        nis=NULL
    WHERE id=p_siswa_id;

    PERFORM public.spmb_invalidate_verification(
      p_siswa_id, ARRAY['departemen_id','angkatan_id','status_asrama']::text[]
    );
  END IF;

  INSERT INTO public.spmb_tujuan_audit(
    siswa_id,pendaftaran_id,
    departemen_asal_id,departemen_tujuan_id,
    angkatan_asal_id,angkatan_tujuan_id,
    siswa_internal,status_sebelum,milestones_sebelum,nis_sebelum,
    alasan,changed_by
  ) VALUES (
    p_siswa_id,d.pendaftaran_id,
    old_target,p_departemen_tujuan_id,
    old_cohort,p_angkatan_tujuan_id,
    internal_student,COALESCE(d.spmb_status_pendaftaran,s.status),
    before_milestones,old_nis,
    reason_text,uid
  );

  -- Bila pendaftaran berada pada gelombang gratis, bukukan ulang promo pada
  -- lembaga tujuan baru. Kegagalan konfigurasi target membatalkan seluruh
  -- transaksi perubahan tujuan, termasuk jurnal pembalik lama.
  IF old_target IS DISTINCT FROM p_departemen_tujuan_id THEN
    promo_result := public.spmb_apply_first_wave_promo(p_siswa_id);
  END IF;

  RETURN jsonb_build_object(
    'siswa_id',p_siswa_id,
    'pendaftaran_id',d.pendaftaran_id,
    'siswa_internal',internal_student,
    'departemen_asal_id',old_target,
    'departemen_tujuan_id',p_departemen_tujuan_id,
    'angkatan_asal_id',old_cohort,
    'angkatan_tujuan_id',p_angkatan_tujuan_id,
    'status_pendaftaran','calon',
    'status_asrama',new_asrama,
    'milestones_reset',had_milestones,
    'nis_lama_dikosongkan',(NOT internal_student AND old_nis IS NOT NULL),
    'promo_lama_dibatalkan',promo_reversed,
    'promo_baru',promo_result
  );
END
$$;

REVOKE ALL ON FUNCTION public.spmb_change_registration_target(uuid,uuid,uuid,text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spmb_change_registration_target(uuid,uuid,uuid,text,text)
  TO authenticated;

COMMENT ON FUNCTION public.spmb_change_registration_target(uuid,uuid,uuid,text,text) IS
  'Koreksi tujuan SPMB sebelum aktivasi. Reset milestone seleksi, pertahankan pendaftaran yang sama, dan koreksi promo secara atomik.';
