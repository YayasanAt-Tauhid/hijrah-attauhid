-- Pengunduran diri pendaftar SPMB (calon/diterima, termasuk yang sudah lulus).
--
-- Sebelumnya tidak ada jalur untuk pendaftar yang mundur: "Pindah keluar" hanya
-- menerima murid berstatus aktif, sehingga pendaftar yang mundur tetap tampil
-- sebagai calon/diterima, tautan pembayarannya tetap hidup, dan tagihannya
-- tetap berjalan.
--
-- Prinsip:
--  * Atomik: semua perubahan berhasil bersama atau dibatalkan bersama. Bila
--    pembatalan tagihan ditolak (mis. periode sudah tutup buku), tidak ada
--    perubahan parsial.
--  * NIS yang sudah terbit tetap tercatat pada siswa dan riwayat NIS, sehingga
--    tidak pernah dipakai ulang.
--  * Tidak ada refund otomatis. Pembayaran yang sudah masuk hanya dijumlahkan
--    dan pendaftar ditandai "perlu tindak lanjut keuangan"; pengembalian dana
--    (bila ada) dicatat manual oleh keuangan.
--  * Pendaftar internal (murid aktif lembaga asal) hanya ditandai pada
--    pendaftarannya. Status siswa, kelas, rencana tagihan, dan tagihan lembaga
--    asal tidak disentuh agar murid tidak kehilangan kelas/SPP di sekolah asal.
--
-- Tidak diterapkan otomatis ke produksi: terapkan manual setelah konfirmasi.

ALTER TABLE public.siswa_detail
  ADD COLUMN IF NOT EXISTS spmb_mundur_at timestamptz,
  ADD COLUMN IF NOT EXISTS spmb_mundur_tanggal_efektif date,
  ADD COLUMN IF NOT EXISTS spmb_mundur_alasan text,
  ADD COLUMN IF NOT EXISTS spmb_mundur_oleh uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS spmb_mundur_status_sebelumnya text,
  ADD COLUMN IF NOT EXISTS spmb_mundur_total_dibayar numeric(15,2),
  ADD COLUMN IF NOT EXISTS spmb_mundur_perlu_keuangan boolean NOT NULL DEFAULT false;

ALTER TABLE public.siswa_detail
  DROP CONSTRAINT IF EXISTS siswa_detail_spmb_status_pendaftaran_check;
ALTER TABLE public.siswa_detail
  ADD CONSTRAINT siswa_detail_spmb_status_pendaftaran_check
  CHECK (spmb_status_pendaftaran IS NULL
    OR spmb_status_pendaftaran IN ('calon','diterima','aktif','selesai','mengundurkan_diri'));

CREATE OR REPLACE FUNCTION public.spmb_withdraw_registration(
  p_siswa_id uuid,
  p_alasan text,
  p_tanggal_efektif date,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  d public.siswa_detail;
  s public.siswa;
  v_alasan text;
  v_alasan_log text;
  v_status text;
  v_internal boolean;
  v_tagihan record;
  v_cancelled integer := 0;
  v_total numeric := 0;
  v_rincian jsonb := '[]'::jsonb;
BEGIN
  -- Otorisasi lembaga dilakukan server function; peran dicek ulang di sini.
  IF p_actor_id IS NULL OR NOT (
    public.has_role(p_actor_id,'admin') OR public.has_role(p_actor_id,'admin_tu')
  ) THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;

  v_alasan := btrim(COALESCE(p_alasan,''));
  IF length(v_alasan) < 5 THEN
    RAISE EXCEPTION 'Alasan pengunduran diri wajib diisi minimal 5 karakter';
  END IF;
  IF p_tanggal_efektif IS NULL THEN
    RAISE EXCEPTION 'Tanggal efektif wajib diisi';
  END IF;

  SELECT * INTO d
  FROM public.siswa_detail
  WHERE siswa_id = p_siswa_id AND spmb_gelombang_id IS NOT NULL
  ORDER BY spmb_registered_at DESC NULLS LAST
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pendaftaran SPMB tidak ditemukan';
  END IF;

  SELECT * INTO s FROM public.siswa WHERE id = p_siswa_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Siswa tidak ditemukan';
  END IF;

  v_internal := COALESCE(d.spmb_siswa_internal,false);
  v_status := COALESCE(d.spmb_status_pendaftaran, s.status);

  IF d.spmb_tanggal_aktivasi IS NOT NULL OR v_status IN ('aktif','selesai') THEN
    RAISE EXCEPTION 'Murid sudah aktif. Gunakan Mutasi Siswa → Pindah Keluar';
  END IF;
  IF v_status NOT IN ('calon','diterima') THEN
    RAISE EXCEPTION 'Pengunduran diri hanya untuk pendaftar berstatus calon atau diterima';
  END IF;

  v_alasan_log := 'Pendaftar mengundurkan diri efektif ' || p_tanggal_efektif::text || ': ' || v_alasan;

  IF COALESCE(d.spmb_siswa_internal,false) THEN
    -- Internal: siswa tetap aktif di lembaga asal; hanya pendaftaran ditandai.
    NULL;
  ELSE
    FOR v_tagihan IN
      SELECT t.id
      FROM public.tagihan t
      WHERE t.siswa_id = p_siswa_id
        AND t.status IN ('terjadwal','belum_bayar')
      ORDER BY t.jatuh_tempo NULLS LAST, t.id
    LOOP
      PERFORM public.batalkan_tagihan_atomik(
        v_tagihan.id, 'batal', v_alasan_log, current_date, p_actor_id, NULL
      );
      v_cancelled := v_cancelled + 1;
    END LOOP;

    UPDATE public.rencana_tagihan_siswa
    SET aktif = false,
        updated_at = now(),
        dinonaktifkan_at = now(),
        dinonaktifkan_oleh = p_actor_id,
        dinonaktifkan_alasan = v_alasan_log
    WHERE siswa_id = p_siswa_id
      AND aktif = true;

    -- Hanya status: trigger melarang mengubah periode/nilai keringanan yang sudah
    -- disetujui. Pendaftar belum pernah aktif, jadi seluruh keringanannya batal.
    UPDATE public.siswa_diskon
    SET status = 'dibatalkan',
        catatan = concat_ws(
          E'\n',
          NULLIF(catatan,''),
          'Otomatis dibatalkan karena pendaftar mengundurkan diri efektif ' || p_tanggal_efektif::text
        )
    WHERE siswa_id = p_siswa_id
      AND status IN ('diajukan','disetujui');

    UPDATE public.kelas_siswa SET aktif = false WHERE siswa_id = p_siswa_id AND aktif;
    -- NIS yang sudah terbit tetap tercatat pada siswa dan riwayat NIS.
    UPDATE public.siswa SET status = 'mengundurkan_diri' WHERE id = p_siswa_id;
  END IF;

  -- Pembatalan pembayaran menghapus barisnya, jadi semua baris pembayaran aktif.
  SELECT COALESCE(SUM(x.jumlah),0),
         COALESCE(jsonb_agg(jsonb_build_object('jenis',x.jenis,'jumlah',x.jumlah) ORDER BY x.jenis), '[]'::jsonb)
    INTO v_total, v_rincian
  FROM (
    SELECT j.nama AS jenis, SUM(p.jumlah) AS jumlah
    FROM public.pembayaran p
    JOIN public.jenis_pembayaran j ON j.id = p.jenis_id
    WHERE p.siswa_id = p_siswa_id
      -- Internal: SPP sekolah asal bukan bagian dari pengunduran diri ini.
      AND (NOT v_internal OR j.departemen_id = d.spmb_departemen_tujuan_id)
    GROUP BY j.nama
    HAVING SUM(p.jumlah) > 0
  ) x;

  UPDATE public.siswa_detail
  SET spmb_status_pendaftaran = 'mengundurkan_diri',
      spmb_mundur_at = now(),
      spmb_mundur_tanggal_efektif = p_tanggal_efektif,
      spmb_mundur_alasan = v_alasan,
      spmb_mundur_oleh = p_actor_id,
      spmb_mundur_status_sebelumnya = v_status,
      spmb_mundur_total_dibayar = v_total,
      spmb_mundur_perlu_keuangan = (v_total > 0 OR v_internal)
  WHERE id = d.id;

  RETURN jsonb_build_object(
    'tagihan_dibatalkan', v_cancelled,
    'total_dibayar', v_total,
    'rincian_dibayar', v_rincian,
    'perlu_tindak_lanjut_keuangan', (v_total > 0 OR v_internal),
    'siswa_internal', v_internal
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.spmb_withdraw_registration(uuid,text,date,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.spmb_withdraw_registration(uuid,text,date,uuid)
  TO service_role;
