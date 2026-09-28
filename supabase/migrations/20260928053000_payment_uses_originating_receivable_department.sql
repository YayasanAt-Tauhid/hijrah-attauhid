-- When paying an already-posted receivable, keep the payment journal in the
-- same department as the originating JPI. This matters for students who moved
-- institutions after an older receivable was formed.
CREATE OR REPLACE FUNCTION public.proses_pembayaran_atomik(
  p_siswa_id uuid,
  p_jenis_id uuid,
  p_bulan integer,
  p_jumlah numeric,
  p_tanggal_bayar date,
  p_keterangan text,
  p_departemen_id uuid,
  p_tahun_ajaran_id uuid,
  p_is_bayar_dimuka boolean,
  p_tagihan_id uuid,
  p_kas_akun_id uuid,
  p_kredit_akun_id uuid,
  p_kredit_label text,
  p_prefix_jurnal text,
  p_petugas_id uuid,
  p_jenis_nama text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pembayaran_id   uuid;
  v_jurnal_id       uuid;
  v_nomor_jurnal    text;
  v_tahun           int := EXTRACT(YEAR FROM p_tanggal_bayar)::int;
  v_pegawai_id      uuid;
  v_periode_bayar   uuid;
  v_tahun_target    uuid;
  v_departemen_efektif uuid := p_departemen_id;
  v_departemen_asal uuid;
BEGIN
  SELECT pegawai_id INTO v_pegawai_id
  FROM public.users_profile
  WHERE id = p_petugas_id;

  IF v_pegawai_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.pegawai WHERE id = v_pegawai_id) THEN
    v_pegawai_id := NULL;
  END IF;

  -- An explicitly selected receivable should be cleared in the same department
  -- where its receivable journal was posted, even if the student has since moved.
  IF p_tagihan_id IS NOT NULL THEN
    SELECT j.departemen_id
    INTO v_departemen_asal
    FROM public.tagihan t
    LEFT JOIN public.jurnal j ON j.id=t.jurnal_piutang_id
    WHERE t.id=p_tagihan_id;

    IF v_departemen_asal IS NOT NULL THEN
      v_departemen_efektif := v_departemen_asal;
    END IF;
  END IF;

  INSERT INTO public.pembayaran (
    siswa_id, jenis_id, tahun_ajaran_id, bulan,
    jumlah, tanggal_bayar, petugas_id, keterangan
  )
  VALUES (
    p_siswa_id, p_jenis_id, p_tahun_ajaran_id, p_bulan,
    p_jumlah, p_tanggal_bayar, v_pegawai_id, p_keterangan
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
    UPDATE public.tagihan
    SET status = 'lunas', pembayaran_id = v_pembayaran_id
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
    'pembayaran_id', v_pembayaran_id,
    'jurnal_id',     v_jurnal_id,
    'nomor_jurnal',  v_nomor_jurnal
  );
END;
$function$;