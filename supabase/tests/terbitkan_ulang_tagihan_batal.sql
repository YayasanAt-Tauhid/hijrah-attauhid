-- Tes integrasi: terbitkan ulang tagihan SPMB yang dibatalkan karena pindah asrama -> non asrama.
-- JANGAN jalankan di produksi. Dirancang untuk clone dengan fixture Qa139 (SD -> SMP, 2027/2028).
-- Seluruh data uji di-ROLLBACK. Hasil dibaca dari tabel temp `hasil` di akhir.
BEGIN;
CREATE TEMP TABLE hasil(nama text, ok boolean, detail text) ON COMMIT DROP;

DO $test$
DECLARE
  v_admin uuid := 'c65713ee-137f-431a-b383-391b7e7608d5';
  v_src uuid := '13900000-0000-4000-8000-000000000102';      -- sumber klon: Qa139 Internal (SD -> SMP)
  v_siswa uuid := gen_random_uuid();       -- siswa uji A: dibatalkan lalu diterbitkan ulang
  v_siswa_fresh uuid := gen_random_uuid(); -- siswa uji B: pembanding penerbitan baru tanpa pembatalan
  v_siswa_c uuid := gen_random_uuid();     -- siswa uji C: seperti produksi, uang pangkal tanpa baris verifikasi
  v_detail_c uuid; v_pg_c uuid; v_res_c jsonb;
  v_ta uuid; v_jenis_spp uuid; v_jenis_pangkal uuid;
  v_detail uuid; v_prev jsonb; v_res jsonb; v_msg text;
  v_spp uuid; v_pangkal uuid; v_t public.tagihan; v_f public.tagihan;
  v_hash_spp text; v_hash_pangkal text; v_n integer;
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

  SELECT id INTO v_ta FROM public.tahun_ajaran WHERE tanggal_mulai='2027-07-01' LIMIT 1;
  SELECT jp.id INTO v_jenis_spp FROM public.jenis_pembayaran jp JOIN public.departemen d ON d.id=jp.departemen_id
    WHERE d.kode='SMP' AND jp.aktif AND jp.tipe='bulanan' AND jp.nama='SPP SMP';
  SELECT jp.id INTO v_jenis_pangkal FROM public.jenis_pembayaran jp JOIN public.departemen d ON d.id=jp.departemen_id
    WHERE d.kode='SMP' AND jp.aktif AND jp.tipe='sekali' AND upper(jp.nama)='UANG PANGKAL SMP';
  -- Klon siswa + detail SPMB (kolom unik dikosongkan). Fixture Qa139 sudah punya uang pangkal lunas, jadi tidak dipakai langsung.
  INSERT INTO public.siswa SELECT r.* FROM public.siswa s CROSS JOIN LATERAL jsonb_populate_record(NULL::public.siswa,
    to_jsonb(s) || jsonb_build_object('id', v_siswa, 'nis', NULL, 'nisn', NULL, 'id_santri_pihak3', NULL, 'nama', 'Uji TerbitUlang A')) r WHERE s.id=v_src;
  INSERT INTO public.siswa SELECT r.* FROM public.siswa s CROSS JOIN LATERAL jsonb_populate_record(NULL::public.siswa,
    to_jsonb(s) || jsonb_build_object('id', v_siswa_fresh, 'nis', NULL, 'nisn', NULL, 'id_santri_pihak3', NULL, 'nama', 'Uji TerbitUlang B')) r WHERE s.id=v_src;
  INSERT INTO public.siswa_detail SELECT r.* FROM public.siswa_detail sd CROSS JOIN LATERAL jsonb_populate_record(NULL::public.siswa_detail,
    to_jsonb(sd) || jsonb_build_object('id', gen_random_uuid(), 'siswa_id', v_siswa, 'pendaftaran_id', NULL, 'pmb_payment_token', NULL,
      'document_session_id', NULL, 'nik', NULL, 'nik_dapodik', NULL)) r WHERE sd.siswa_id=v_src AND sd.tahun_ajaran_id=v_ta AND sd.spmb_gelombang_id IS NOT NULL LIMIT 1;
  INSERT INTO public.siswa_detail SELECT r.* FROM public.siswa_detail sd CROSS JOIN LATERAL jsonb_populate_record(NULL::public.siswa_detail,
    to_jsonb(sd) || jsonb_build_object('id', gen_random_uuid(), 'siswa_id', v_siswa_fresh, 'pendaftaran_id', NULL, 'pmb_payment_token', NULL,
      'document_session_id', NULL, 'nik', NULL, 'nik_dapodik', NULL)) r WHERE sd.siswa_id=v_src AND sd.tahun_ajaran_id=v_ta AND sd.spmb_gelombang_id IS NOT NULL LIMIT 1;
  SELECT id INTO v_detail FROM public.siswa_detail WHERE siswa_id=v_siswa AND tahun_ajaran_id=v_ta AND spmb_gelombang_id IS NOT NULL LIMIT 1;
  INSERT INTO hasil VALUES('fixture lengkap', v_ta IS NOT NULL AND v_jenis_spp IS NOT NULL AND v_jenis_pangkal IS NOT NULL AND v_detail IS NOT NULL,
    format('ta=%s spp=%s pangkal=%s detail=%s', v_ta, v_jenis_spp, v_jenis_pangkal, v_detail));

  -- 1) Terbitkan awal sebagai ASRAMA (meniru kondisi Nadhif sebelum pindah)
  UPDATE public.siswa_detail SET status_asrama='asrama' WHERE id=v_detail;
  PERFORM public.terbitkan_spp_awal_spmb(v_siswa, v_ta, v_jenis_spp, '2027-07-01', 1350000);
  v_prev := public.preview_uang_pangkal_spmb(v_siswa, v_ta, 'none', NULL);
  PERFORM public.verifikasi_uang_pangkal_spmb(v_siswa, v_ta, 'none', NULL, (v_prev->>'bruto_acuan')::numeric, NULL, v_prev->>'preview_hash', true);
  SELECT id INTO v_spp FROM public.tagihan WHERE siswa_id=v_siswa AND jenis_id=v_jenis_spp AND bulan=7;
  SELECT id INTO v_pangkal FROM public.tagihan WHERE siswa_id=v_siswa AND jenis_id=v_jenis_pangkal AND bulan IS NULL;
  INSERT INTO hasil VALUES('tagihan asrama terbit', v_spp IS NOT NULL AND v_pangkal IS NOT NULL, format('spp=%s pangkal=%s bruto=%s', v_spp, v_pangkal, v_prev->>'bruto_acuan'));

  -- 2) Batalkan keduanya (alasan sama dengan kasus produksi)
  PERFORM public.batalkan_tagihan_atomik(v_spp, 'batal', 'pindah ke non asrama', v_today, v_admin);
  PERFORM public.batalkan_tagihan_atomik(v_pangkal, 'batal', 'pindah ke non asrama', v_today, v_admin);
  SELECT count(*) INTO v_n FROM public.tagihan WHERE id IN (v_spp, v_pangkal) AND status='dibatalkan';
  INSERT INTO hasil VALUES('keduanya dibatalkan', v_n=2, v_n::text);

  -- 3) Pindah program, lalu bukti akar masalah: alur lama menolak
  UPDATE public.siswa_detail SET status_asrama='non_asrama' WHERE id=v_detail;
  BEGIN
    PERFORM public.terbitkan_spp_awal_spmb(v_siswa, v_ta, v_jenis_spp, '2027-07-01', 500000);
    INSERT INTO hasil VALUES('alur lama SPP menolak (akar masalah)', false, 'tidak menolak');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO hasil VALUES('alur lama SPP menolak (akar masalah)', SQLERRM LIKE '%pernah dibatalkan%', SQLERRM);
  END;
  v_prev := public.preview_uang_pangkal_spmb(v_siswa, v_ta, 'none', NULL);
  BEGIN
    PERFORM public.verifikasi_uang_pangkal_spmb(v_siswa, v_ta, 'none', NULL, (v_prev->>'bruto_acuan')::numeric, NULL, v_prev->>'preview_hash', true);
    INSERT INTO hasil VALUES('alur lama pangkal menolak (akar masalah)', false, 'tidak menolak');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO hasil VALUES('alur lama pangkal menolak (akar masalah)', SQLERRM LIKE '%pernah dibatalkan%' OR SQLERRM LIKE '%sudah diverifikasi%', SQLERRM);
  END;

  -- 4) Fungsi baru: dry-run
  v_res := public.terbitkan_ulang_tagihan_batal(v_spp, 500000, 'pindah asrama ke non asrama', false);
  v_hash_spp := v_res->>'preview_hash';
  INSERT INTO hasil VALUES('dry-run SPP tidak menulis', (SELECT status FROM public.tagihan WHERE id=v_spp)='dibatalkan' AND (v_res->>'applied')::boolean=false,
    format('kategori_baru=%s bruto_baru=%s', v_res->>'kategori_baru', v_res->>'nominal_bruto_baru'));
  v_res := public.terbitkan_ulang_tagihan_batal(v_pangkal, NULL, 'pindah asrama ke non asrama', false);
  v_hash_pangkal := v_res->>'preview_hash';
  INSERT INTO hasil VALUES('dry-run pangkal tidak menulis', (SELECT status FROM public.tagihan WHERE id=v_pangkal)='dibatalkan' AND (v_res->>'nominal_bruto_baru')::numeric=10100000,
    format('bruto_baru=%s', v_res->>'nominal_bruto_baru'));

  -- 5) Guard
  BEGIN PERFORM public.terbitkan_ulang_tagihan_batal(v_spp, 500000, 'pendek', false);
    INSERT INTO hasil VALUES('alasan pendek ditolak', false, 'lolos');
  EXCEPTION WHEN OTHERS THEN INSERT INTO hasil VALUES('alasan pendek ditolak', SQLERRM LIKE '%Alasan%', SQLERRM); END;
  BEGIN PERFORM public.terbitkan_ulang_tagihan_batal(v_spp, 500000, 'pindah asrama ke non asrama', true, 'hash-basi');
    INSERT INTO hasil VALUES('hash basi ditolak', false, 'lolos');
  EXCEPTION WHEN OTHERS THEN INSERT INTO hasil VALUES('hash basi ditolak', SQLERRM LIKE '%berubah sejak pratinjau%', SQLERRM); END;
  BEGIN PERFORM public.terbitkan_ulang_tagihan_batal(v_spp, 0, 'pindah asrama ke non asrama', false);
    INSERT INTO hasil VALUES('nominal SPP nol ditolak', false, 'lolos');
  EXCEPTION WHEN OTHERS THEN INSERT INTO hasil VALUES('nominal SPP nol ditolak', true, SQLERRM); END;

  -- 6) Terapkan SPP
  v_res := public.terbitkan_ulang_tagihan_batal(v_spp, 500000, 'pindah asrama ke non asrama', true, v_hash_spp);
  SELECT * INTO v_t FROM public.tagihan WHERE id=v_spp;
  INSERT INTO hasil VALUES('SPP: status & jurnal', v_t.status='terjadwal' AND v_t.jurnal_piutang_id IS NULL AND v_t.jurnal_pembalik_id IS NULL
    AND v_t.dibatalkan_at IS NULL AND v_t.dibatalkan_alasan IS NULL AND v_t.pengakuan_spp_selesai=false,
    format('status=%s jp=%s pb=%s', v_t.status, v_t.jurnal_piutang_id, v_t.jurnal_pembalik_id));
  INSERT INTO hasil VALUES('SPP: nominal & kategori', v_t.nominal=500000 AND v_t.nominal_bruto=500000 AND v_t.spp_kategori='non_asrama'
    AND v_t.spp_akun_pendapatan_id=(SELECT id FROM public.akun_rekening WHERE kode='4103' AND jenis='pendapatan' AND aktif),
    format('nominal=%s kat=%s', v_t.nominal, v_t.spp_kategori));
  SELECT count(*) INTO v_n FROM public.tarif_tagihan WHERE jenis_id=v_jenis_spp AND siswa_id=v_siswa AND aktif;
  INSERT INTO hasil VALUES('SPP: tepat satu tarif aktif = baru', v_n=1 AND (SELECT nominal FROM public.tarif_tagihan WHERE jenis_id=v_jenis_spp AND siswa_id=v_siswa AND aktif)=500000, v_n::text);
  INSERT INTO hasil VALUES('SPP: tarif lama nonaktif beralasan', EXISTS(SELECT 1 FROM public.tarif_tagihan WHERE jenis_id=v_jenis_spp AND siswa_id=v_siswa AND NOT aktif AND nominal=1350000 AND dinonaktifkan_alasan LIKE 'Diterbitkan ulang%'), '');
  INSERT INTO hasil VALUES('SPP: audit kategori & plan periode', EXISTS(SELECT 1 FROM public.spp_kategori_periode_audit WHERE siswa_id=v_siswa AND jenis_id=v_jenis_spp AND kategori='non_asrama')
    AND EXISTS(SELECT 1 FROM public.spp_kategori_periode WHERE siswa_id=v_siswa AND jenis_id=v_jenis_spp AND periode='2027-07-01' AND kategori='non_asrama' AND nominal_bruto=500000), '');
  INSERT INTO hasil VALUES('SPP: riwayat menyimpan kondisi lama', EXISTS(SELECT 1 FROM public.tagihan_riwayat_terbit_ulang r WHERE r.tagihan_id=v_spp
    AND r.snapshot_tagihan_lama->>'status'='dibatalkan' AND (r.snapshot_tagihan_lama->>'nominal')::numeric=1350000 AND r.nominal_bruto_lama=1350000 AND r.nominal_bruto_baru=500000), '');
  INSERT INTO hasil VALUES('SPP: audit_keuangan tercatat', EXISTS(SELECT 1 FROM public.audit_keuangan WHERE tabel_sumber='tagihan' AND record_id=v_spp::text AND keterangan LIKE 'Penerbitan ulang%'), '');
  BEGIN PERFORM public.terbitkan_ulang_tagihan_batal(v_spp, 500000, 'pindah asrama ke non asrama', false);
    INSERT INTO hasil VALUES('SPP: terbit ulang kedua ditolak', false, 'lolos');
  EXCEPTION WHEN OTHERS THEN INSERT INTO hasil VALUES('SPP: terbit ulang kedua ditolak', SQLERRM LIKE '%berstatus dibatalkan%', SQLERRM); END;

  -- 7) Terapkan uang pangkal
  v_res := public.terbitkan_ulang_tagihan_batal(v_pangkal, NULL, 'pindah asrama ke non asrama', true, v_hash_pangkal);
  SELECT * INTO v_t FROM public.tagihan WHERE id=v_pangkal;
  INSERT INTO hasil VALUES('pangkal: status & nominal', v_t.status='terjadwal' AND v_t.nominal=10100000 AND v_t.nominal_bruto=10100000 AND v_t.nominal_diskon=0
    AND v_t.jurnal_piutang_id IS NULL AND v_t.jurnal_pembalik_id IS NULL AND v_t.dibatalkan_at IS NULL, format('status=%s nominal=%s', v_t.status, v_t.nominal));
  INSERT INTO hasil VALUES('pangkal: verifikasi program non_asrama', EXISTS(SELECT 1 FROM public.spmb_uang_pangkal_verifikasi v WHERE v.tagihan_id=v_pangkal
    AND v.nominal_bruto=10100000 AND v.snapshot->>'program'='non_asrama'), '');
  SELECT count(*) INTO v_n FROM public.tarif_tagihan WHERE jenis_id=v_jenis_pangkal AND siswa_id=v_siswa AND aktif;
  INSERT INTO hasil VALUES('pangkal: tepat satu tarif aktif = baru', v_n=1 AND (SELECT nominal FROM public.tarif_tagihan WHERE jenis_id=v_jenis_pangkal AND siswa_id=v_siswa AND aktif)=10100000, v_n::text);
  INSERT INTO hasil VALUES('pangkal: riwayat menyimpan kondisi lama', EXISTS(SELECT 1 FROM public.tagihan_riwayat_terbit_ulang r WHERE r.tagihan_id=v_pangkal
    AND r.nominal_bruto_lama=13100000 AND r.snapshot_verifikasi_lama IS NOT NULL AND r.snapshot_verifikasi_lama->'snapshot'->>'program'='asrama'), '');

  -- 8) Setara dengan penerbitan baru (siswa pembanding, tanpa pembatalan)
  UPDATE public.siswa_detail SET status_asrama='non_asrama' WHERE siswa_id=v_siswa_fresh AND tahun_ajaran_id=v_ta AND spmb_gelombang_id IS NOT NULL;
  PERFORM public.terbitkan_spp_awal_spmb(v_siswa_fresh, v_ta, v_jenis_spp, '2027-07-01', 500000);
  SELECT * INTO v_f FROM public.tagihan WHERE siswa_id=v_siswa_fresh AND jenis_id=v_jenis_spp AND bulan=7;
  SELECT * INTO v_t FROM public.tagihan WHERE id=v_spp;
  INSERT INTO hasil VALUES('SPP: setara dengan baris baru hasil generate',
    v_t.status=v_f.status AND v_t.jatuh_tempo=v_f.jatuh_tempo AND v_t.tanggal_pengakuan IS NOT DISTINCT FROM v_f.tanggal_pengakuan
    AND v_t.pengakuan_spp_selesai=v_f.pengakuan_spp_selesai AND v_t.spp_kategori=v_f.spp_kategori AND v_t.spp_akun_pendapatan_id=v_f.spp_akun_pendapatan_id
    AND v_t.nominal=v_f.nominal AND v_t.nominal_bruto=v_f.nominal_bruto AND v_t.nominal_diskon=v_f.nominal_diskon
    AND v_t.tahun_akademik_id=v_f.tahun_akademik_id AND v_t.tahun_ajaran_id=v_f.tahun_ajaran_id AND v_t.jurnal_piutang_id IS NOT DISTINCT FROM v_f.jurnal_piutang_id,
    format('reissue=%s/%s/%s fresh=%s/%s/%s', v_t.status, v_t.jatuh_tempo, v_t.nominal, v_f.status, v_f.jatuh_tempo, v_f.nominal));

  -- 9) Riwayat immutable
  BEGIN UPDATE public.tagihan_riwayat_terbit_ulang SET alasan='diubah-sembarangan-123';
    INSERT INTO hasil VALUES('riwayat tidak bisa diubah', false, 'lolos');
  EXCEPTION WHEN OTHERS THEN INSERT INTO hasil VALUES('riwayat tidak bisa diubah', true, SQLERRM); END;
  BEGIN DELETE FROM public.tagihan_riwayat_terbit_ulang;
    INSERT INTO hasil VALUES('riwayat tidak bisa dihapus', false, 'lolos');
  EXCEPTION WHEN OTHERS THEN INSERT INTO hasil VALUES('riwayat tidak bisa dihapus', true, SQLERRM); END;

  -- 10) Akses non-staf ditolak
  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  BEGIN PERFORM public.terbitkan_ulang_tagihan_batal(v_spp, 500000, 'pindah asrama ke non asrama', false);
    INSERT INTO hasil VALUES('non-staf ditolak', false, 'lolos');
  EXCEPTION WHEN OTHERS THEN INSERT INTO hasil VALUES('non-staf ditolak', SQLERRM LIKE '%tidak memiliki akses%', SQLERRM); END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

  -- 11) Kasus mirip produksi: uang pangkal TANPA baris verifikasi (data sebelum fitur verifikasi)
  INSERT INTO public.siswa SELECT r.* FROM public.siswa s CROSS JOIN LATERAL jsonb_populate_record(NULL::public.siswa,
    to_jsonb(s) || jsonb_build_object('id', v_siswa_c, 'nis', NULL, 'nisn', NULL, 'id_santri_pihak3', NULL, 'nama', 'Uji TerbitUlang C')) r WHERE s.id=v_src;
  INSERT INTO public.siswa_detail SELECT r.* FROM public.siswa_detail sd CROSS JOIN LATERAL jsonb_populate_record(NULL::public.siswa_detail,
    to_jsonb(sd) || jsonb_build_object('id', gen_random_uuid(), 'siswa_id', v_siswa_c, 'pendaftaran_id', NULL, 'pmb_payment_token', NULL,
      'document_session_id', NULL, 'nik', NULL, 'nik_dapodik', NULL)) r WHERE sd.siswa_id=v_src AND sd.tahun_ajaran_id=v_ta AND sd.spmb_gelombang_id IS NOT NULL LIMIT 1;
  SELECT id INTO v_detail_c FROM public.siswa_detail WHERE siswa_id=v_siswa_c AND tahun_ajaran_id=v_ta AND spmb_gelombang_id IS NOT NULL LIMIT 1;
  UPDATE public.siswa_detail SET status_asrama='asrama' WHERE id=v_detail_c;
  v_prev := public.preview_uang_pangkal_spmb(v_siswa_c, v_ta, 'none', NULL);
  PERFORM public.verifikasi_uang_pangkal_spmb(v_siswa_c, v_ta, 'none', NULL, (v_prev->>'bruto_acuan')::numeric, NULL, v_prev->>'preview_hash', true);
  DELETE FROM public.spmb_uang_pangkal_verifikasi WHERE siswa_id=v_siswa_c;
  SELECT id INTO v_pg_c FROM public.tagihan WHERE siswa_id=v_siswa_c AND jenis_id=v_jenis_pangkal AND bulan IS NULL;
  PERFORM public.batalkan_tagihan_atomik(v_pg_c, 'batal', 'pindah ke non asrama', v_today, v_admin);
  UPDATE public.siswa_detail SET status_asrama='non_asrama' WHERE id=v_detail_c;
  v_res_c := public.terbitkan_ulang_tagihan_batal(v_pg_c, NULL, 'pindah asrama ke non asrama', false);
  v_res_c := public.terbitkan_ulang_tagihan_batal(v_pg_c, NULL, 'pindah asrama ke non asrama', true, v_res_c->>'preview_hash');
  SELECT * INTO v_t FROM public.tagihan WHERE id=v_pg_c;
  INSERT INTO hasil VALUES('pangkal tanpa verifikasi lama: berhasil', v_t.status='terjadwal' AND v_t.nominal=10100000
    AND EXISTS(SELECT 1 FROM public.spmb_uang_pangkal_verifikasi v WHERE v.tagihan_id=v_pg_c AND v.snapshot->>'program'='non_asrama')
    AND EXISTS(SELECT 1 FROM public.tagihan_riwayat_terbit_ulang r WHERE r.tagihan_id=v_pg_c AND r.snapshot_verifikasi_lama IS NULL AND r.nominal_bruto_lama=13100000),
    format('status=%s nominal=%s', v_t.status, v_t.nominal));
END
$test$;

SELECT nama, CASE WHEN ok THEN 'LULUS' ELSE 'GAGAL' END AS hasil, detail FROM hasil;
ROLLBACK;
