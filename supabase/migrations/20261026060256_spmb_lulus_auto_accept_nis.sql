-- Saat calon murid dinyatakan Lulus dari halaman SPMB, penerimaan dan
-- pembuatan NIS tujuan dilakukan atomik. Jika prasyarat penerimaan belum
-- lengkap, seluruh transaksi dibatalkan sehingga tidak ada status setengah jadi.

CREATE OR REPLACE FUNCTION public.spmb_mark_lulus_and_accept(p_siswa_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $function$
DECLARE
  d public.siswa_detail;
  s public.siswa;
  target_dept uuid;
  target_cohort uuid;
  internal_student boolean;
  marked_at timestamptz;
  readiness jsonb;
  target_nis text;
  registration_status text;
BEGIN
  SELECT * INTO d
  FROM public.siswa_detail
  WHERE siswa_id=p_siswa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Data SPMB tidak ditemukan';
  END IF;

  SELECT * INTO s
  FROM public.siswa
  WHERE id=p_siswa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Siswa tidak ditemukan';
  END IF;

  target_dept:=COALESCE(d.spmb_departemen_tujuan_id,s.departemen_id);
  target_cohort:=COALESCE(d.spmb_angkatan_tujuan_id,s.angkatan_id);
  internal_student:=COALESCE(d.spmb_siswa_internal,false);

  IF COALESCE(auth.role(),'') <> 'service_role'
     AND (
       auth.uid() IS NULL
       OR NOT (
         public.has_role(auth.uid(),'admin')
         OR (
           public.has_role(auth.uid(),'admin_tu')
           AND public.can_manage_akademik_departemen(auth.uid(),target_dept)
         )
       )
     )
  THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;

  IF d.spmb_tanggal_tes IS NULL THEN
    RAISE EXCEPTION 'Calon murid harus ditandai Sudah Tes terlebih dahulu';
  END IF;

  IF d.spmb_status_kelulusan='lulus' AND d.spmb_tanggal_lulus IS NOT NULL THEN
    marked_at:=d.spmb_tanggal_lulus;
  ELSE
    marked_at:=now();
    UPDATE public.siswa_detail
    SET spmb_status_kelulusan='lulus',
        spmb_tanggal_lulus=marked_at,
        spmb_tanggal_keputusan=marked_at
    WHERE siswa_id=p_siswa_id;
  END IF;

  -- spmb_readiness memang mensyaratkan status Lulus. Karena status tersebut
  -- sudah diubah di transaksi yang sama, pemeriksaan berikut menilai semua
  -- prasyarat lain (verifikasi, pembayaran, dokumen, tujuan, dan tahun ajaran).
  readiness:=public.spmb_readiness(p_siswa_id);
  IF NOT COALESCE((readiness->>'siap')::boolean,false) THEN
    RAISE EXCEPTION 'SPMB belum lengkap untuk otomatis diterima: %',
      COALESCE(readiness->>'kekurangan','[]');
  END IF;

  IF target_dept IS NULL OR target_cohort IS NULL THEN
    RAISE EXCEPTION 'Lembaga dan angkatan tujuan wajib diisi';
  END IF;

  -- Generator ini idempotent. Jika NIS tujuan sudah pernah dibuat, NIS yang
  -- sama dikembalikan dan tidak membuat nomor baru.
  target_nis:=public.akademik_generate_nis_spmb(
    p_siswa_id,
    target_dept,
    target_cohort,
    NULL
  );

  IF NULLIF(btrim(target_nis),'') IS NULL THEN
    RAISE EXCEPTION 'NIS tujuan gagal dibuat';
  END IF;

  IF internal_student THEN
    -- Siswa internal tetap aktif pada lembaga asal sampai aktivasi jenjang.
    -- Hanya status pendaftaran SPMB yang berubah menjadi diterima; NIS tujuan
    -- sudah tersimpan di riwayat per lembaga oleh generator di atas.
    IF COALESCE(d.spmb_status_pendaftaran,'calon') IN ('calon','diterima') THEN
      UPDATE public.siswa_detail
      SET spmb_status_pendaftaran='diterima'
      WHERE siswa_id=p_siswa_id;
    ELSIF d.spmb_status_pendaftaran NOT IN ('aktif','selesai') THEN
      RAISE EXCEPTION 'Status pendaftaran internal tidak dapat diterima otomatis';
    END IF;
  ELSE
    -- Calon eksternal sudah berada pada lembaga/angkatan tujuan sejak daftar.
    -- Guard penerimaan tetap aktif dan memastikan NIS serta readiness valid.
    IF s.departemen_id IS DISTINCT FROM target_dept
       OR s.angkatan_id IS DISTINCT FROM target_cohort THEN
      RAISE EXCEPTION 'Data lembaga/angkatan calon eksternal belum sinkron dengan tujuan SPMB';
    END IF;

    IF s.status='calon' THEN
      UPDATE public.siswa
      SET status='diterima'
      WHERE id=p_siswa_id;
    ELSIF s.status NOT IN ('diterima','aktif') THEN
      RAISE EXCEPTION 'Status akademik calon tidak dapat diterima otomatis: %',COALESCE(s.status,'-');
    END IF;
  END IF;

  SELECT COALESCE(
    sd.spmb_status_pendaftaran,
    CASE WHEN internal_student THEN 'diterima' ELSE s2.status END
  )
  INTO registration_status
  FROM public.siswa_detail sd
  JOIN public.siswa s2 ON s2.id=sd.siswa_id
  WHERE sd.siswa_id=p_siswa_id;

  RETURN jsonb_build_object(
    'marked_at',marked_at,
    'nis',target_nis,
    'status_pendaftaran',registration_status,
    'siswa_internal',internal_student,
    'diterima',true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.spmb_mark_lulus_and_accept(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.spmb_mark_lulus_and_accept(uuid)
  TO service_role;

COMMENT ON FUNCTION public.spmb_mark_lulus_and_accept(uuid)
  IS 'Atomik: tandai Lulus, validasi readiness, buat/ambil NIS tujuan, lalu terima calon SPMB tanpa memerlukan kelas.';
