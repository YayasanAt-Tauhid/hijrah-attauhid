-- Run only on a disposable/QA database. All fixtures are rolled back.
BEGIN;
INSERT INTO public.tahun_ajaran(nama,tanggal_mulai,tanggal_selesai)
SELECT 'Tahun Ajaran 2027/2028','2027-07-01','2028-06-30'
WHERE NOT EXISTS(SELECT 1 FROM public.tahun_ajaran WHERE nama='Tahun Ajaran 2027/2028');
INSERT INTO public.angkatan(nama,departemen_id,aktif)
SELECT '2027',d.id,true FROM public.departemen d WHERE d.kode IN ('TK','SD','SMP','SMA','MTA')
AND NOT EXISTS(SELECT 1 FROM public.angkatan a WHERE a.departemen_id=d.id AND a.nama='2027' AND a.aktif);
CREATE TEMP TABLE transfer_document_guard_fixture (LIKE public.siswa_detail);
CREATE TRIGGER fixture_guard BEFORE INSERT ON transfer_document_guard_fixture
FOR EACH ROW EXECUTE FUNCTION public.guard_spmb_public_registration_policy();
CREATE TEMP TABLE transfer_document_guard_results (code text, without_documents boolean, with_documents boolean);
DO $test$
DECLARE
  candidate public.siswa_detail;
  base public.siswa_detail;
  target public.departemen;
  accepted boolean;
  needs_documents boolean;
  fixture_student uuid;
BEGIN
  INSERT INTO public.siswa(nama,jenis_kelamin,status,alamat,telepon,nisn)
    VALUES ('Uji Kebijakan Dokumen Pindahan','L','calon','Alamat Uji','081234567890','9999999988')
    RETURNING id INTO fixture_student;
  SELECT * INTO base FROM public.siswa_detail LIMIT 1;
  base.id := gen_random_uuid();
  base.siswa_id := fixture_student;
  base.nik := '9999999999999988';
  FOR target IN SELECT * FROM public.departemen WHERE kode IN ('TK','SD','SMP','SMA','MTA') LOOP
    candidate := base;
    candidate.pmb_payment_token := gen_random_uuid();
    candidate.kategori := 'MURID PINDAHAN';
    candidate.jenis_pendaftaran := 'pindahan';
    candidate.status_asrama := 'asrama';
    candidate.spmb_departemen_tujuan_id := target.id;
    SELECT id INTO candidate.spmb_angkatan_tujuan_id FROM public.angkatan
      WHERE departemen_id=target.id AND nama='2027' AND aktif LIMIT 1;
    SELECT id INTO candidate.tahun_ajaran_id FROM public.tahun_ajaran WHERE nama='Tahun Ajaran 2027/2028' LIMIT 1;
    candidate.nama_ayah := 'Ayah Uji'; candidate.nama_ibu := 'Ibu Uji';
    candidate.nik_ayah := '9999999999999991'; candidate.nik_ibu := '9999999999999992';
    candidate.tempat_lahir_ayah := 'Uji'; candidate.tempat_lahir_ibu := 'Uji';
    candidate.tanggal_lahir_ayah := '1980-01-01'; candidate.tanggal_lahir_ibu := '1980-01-01';
    candidate.pendidikan_ayah := 'SMA'; candidate.pendidikan_ibu := 'SMA';
    candidate.pekerjaan_ayah := 'LAINNYA'; candidate.pekerjaan_ibu := 'LAINNYA';
    candidate.penghasilan_ayah := 1000000; candidate.penghasilan_ibu := 1000000;
    candidate.telepon_ayah := '081234567890'; candidate.telepon_ibu := '081234567890';
    candidate.alamat_ayah := 'Alamat Uji'; candidate.alamat_ibu := 'Alamat Uji';
    candidate.dokumen_rapor_path := NULL; candidate.dokumen_ijazah_path := NULL;
    needs_documents := target.kode IN ('SMP','SMA','MTA');
    accepted := false;
    BEGIN
      INSERT INTO transfer_document_guard_fixture SELECT candidate.*;
      accepted := true;
    EXCEPTION WHEN OTHERS THEN
      IF NOT needs_documents OR SQLERRM NOT LIKE 'Rapor dan Ijazah/SKHUN wajib%' THEN RAISE; END IF;
    END;
    IF accepted = needs_documents THEN RAISE EXCEPTION 'Wrong missing document policy for %',target.kode; END IF;
    INSERT INTO transfer_document_guard_results VALUES (target.kode,accepted,false);
    candidate.dokumen_rapor_path := 'rapor/00000000-0000-4000-8000-000000000001.pdf';
    candidate.dokumen_ijazah_path := 'ijazah/00000000-0000-4000-8000-000000000001.pdf';
    INSERT INTO transfer_document_guard_fixture SELECT candidate.*;
    UPDATE transfer_document_guard_results SET with_documents=true WHERE code=target.kode;
  END LOOP;
END
$test$;
SELECT jsonb_agg(to_jsonb(r) ORDER BY code) AS results FROM transfer_document_guard_results r;
ROLLBACK;