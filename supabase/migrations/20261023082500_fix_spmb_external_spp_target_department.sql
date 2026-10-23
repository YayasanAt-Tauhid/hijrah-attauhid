-- Fix SPP awal calon eksternal lintas-lembaga (contoh SD existing -> SPMB SMP).
-- Persyaratan tetap ketat: SPMB valid/lulus/diterima; jenjang tujuan dan
-- tahun akademik + tanggal pengakuan layanan harus cocok. Tidak mengubah data
-- siswa, kelas, tagihan, tarif, akrual atau kewenangan pengguna.
DO $guard_patch$
DECLARE
  v_def text;
  v_old text := $old$if v_jenis.departemen_id is distinct from v_siswa.departemen_id and not exists (
    select 1 from public.siswa_detail sd
    join public.tahun_ajaran ta on ta.id=sd.tahun_ajaran_id
    join public.siswa s on s.id=sd.siswa_id
    where sd.siswa_id=new.siswa_id and sd.tahun_ajaran_id=new.tahun_akademik_id
      and sd.spmb_gelombang_id is not null and sd.spmb_siswa_internal
      and sd.spmb_status_kelulusan='lulus'
      and sd.spmb_status_pendaftaran in ('diterima','aktif','selesai') and s.status='aktif'
      and sd.spmb_departemen_tujuan_id=v_jenis.departemen_id
      and coalesce(new.tanggal_pengakuan,new.jatuh_tempo) between ta.tanggal_mulai and ta.tanggal_selesai
  ) then$old$;
  v_new text := $new$if v_jenis.departemen_id is distinct from v_siswa.departemen_id and not exists (
    select 1 from public.siswa_detail sd
    join public.tahun_ajaran ta on ta.id=sd.tahun_ajaran_id
    join public.siswa s on s.id=sd.siswa_id
    where sd.siswa_id=new.siswa_id and sd.tahun_ajaran_id=new.tahun_akademik_id
      and sd.spmb_gelombang_id is not null
      and sd.spmb_status_kelulusan='lulus'
      and sd.spmb_departemen_tujuan_id=v_jenis.departemen_id
      and coalesce(new.tanggal_pengakuan,new.jatuh_tempo) between ta.tanggal_mulai and ta.tanggal_selesai
      and (
        (coalesce(sd.spmb_siswa_internal,false)
          and sd.spmb_status_pendaftaran in ('diterima','aktif','selesai')
          and s.status='aktif')
        or
        (not coalesce(sd.spmb_siswa_internal,false)
          and sd.spmb_status_pendaftaran in ('diterima','aktif')
          and s.status in ('diterima','aktif'))
      )
  ) then$new$;
BEGIN
  v_def := pg_get_functiondef('public.guard_tagihan_spp_tarif()'::regprocedure);
  -- Sudah terpasang di production lewat migration terkontrol: jangan ulangi.
  IF md5(v_def) = '37698f5e69cbaca228a938ab93cffc12' THEN
    RETURN;
  END IF;
  IF md5(v_def) IS DISTINCT FROM '9f8a2e42746ead92480cfb1ebf1e7fb6' THEN
    RAISE EXCEPTION 'Definisi guard_tagihan_spp_tarif berubah; review ulang';
  END IF;
  IF length(v_def)-length(replace(v_def,v_old,'')) <> length(v_old) THEN
    RAISE EXCEPTION 'Blok guard SPP tidak cocok tepat sekali';
  END IF;
  EXECUTE replace(v_def,v_old,v_new);
END
$guard_patch$;