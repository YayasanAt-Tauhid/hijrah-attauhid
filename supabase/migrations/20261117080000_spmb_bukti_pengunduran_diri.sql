-- Bukti pengunduran diri dari orang tua pada SPMB.
--
-- Sebelumnya pengunduran diri hanya mencatat tanggal efektif dan alasan. Kini
-- staf wajib mengunggah bukti dari orang tua (surat/foto/PDF) sebagai dasar
-- administrasi. File disimpan di bucket privat 'pmb-dokumen' (PDF/JPG/PNG,
-- maks 10 MB) dengan path mundur/<uuid>.<ekstensi>; yang disimpan di database
-- hanya path-nya.
--
-- Pendekatan: overload RPC `spmb_withdraw_registration` dengan parameter
-- tambahan p_bukti_path. Overload memvalidasi bukti lebih dulu, memanggil RPC
-- 4-argumen yang sudah ada (seluruh aturan tagihan/kelas/diskon tidak diubah),
-- lalu menyimpan path bukti. Semuanya dalam satu panggilan RPC = satu transaksi,
-- sehingga pengunduran diri tidak pernah tersimpan tanpa bukti.
--
-- Pendaftar yang sudah mundur sebelum migrasi ini tetap tanpa bukti (kolom NULL).
-- Tidak diterapkan otomatis ke produksi: terapkan manual setelah konfirmasi.

ALTER TABLE public.siswa_detail
  ADD COLUMN IF NOT EXISTS spmb_mundur_bukti_path text;

COMMENT ON COLUMN public.siswa_detail.spmb_mundur_bukti_path
  IS 'Path privat Storage (bucket pmb-dokumen) untuk bukti pengunduran diri dari orang tua';

CREATE OR REPLACE FUNCTION public.spmb_withdraw_registration(
  p_siswa_id uuid,
  p_alasan text,
  p_tanggal_efektif date,
  p_actor_id uuid,
  p_bukti_path text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_bukti text;
  v_result jsonb;
BEGIN
  v_bukti := btrim(COALESCE(p_bukti_path,''));
  IF v_bukti !~* '^mundur/[0-9a-f-]{36}\.(pdf|jpg|jpeg|png)$' THEN
    RAISE EXCEPTION 'Bukti pengunduran diri dari orang tua wajib diunggah';
  END IF;

  -- Otorisasi peran, status, tagihan, kelas, dan diskon tetap dikerjakan RPC lama.
  v_result := public.spmb_withdraw_registration(p_siswa_id, p_alasan, p_tanggal_efektif, p_actor_id);

  -- Pendaftaran yang sama dengan yang diproses RPC lama (terbaru per siswa).
  UPDATE public.siswa_detail
  SET spmb_mundur_bukti_path = v_bukti
  WHERE id = (
    SELECT id
    FROM public.siswa_detail
    WHERE siswa_id = p_siswa_id AND spmb_gelombang_id IS NOT NULL
    ORDER BY spmb_registered_at DESC NULLS LAST
    LIMIT 1
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.spmb_withdraw_registration(uuid,text,date,uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.spmb_withdraw_registration(uuid,text,date,uuid,text)
  TO service_role;
