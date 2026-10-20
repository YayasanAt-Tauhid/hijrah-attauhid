-- Approval is a server API: actor IDs come only from verified authMiddleware.
-- No client can insert/approve requests, supply an actor, or execute private helpers.
CREATE SCHEMA IF NOT EXISTS deletion_private;
REVOKE ALL ON SCHEMA deletion_private FROM PUBLIC, anon, authenticated;
CREATE TABLE public.data_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_table text NOT NULL,
  target_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('delete','cancel_bill','correct_bill','cancel_payment')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 2000),
  payload jsonb NOT NULL DEFAULT '{}',
  snapshot jsonb NOT NULL,
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','changed','executed')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  execution_result jsonb
);
CREATE UNIQUE INDEX data_deletion_one_pending ON public.data_deletion_requests(target_table,target_id) WHERE status='pending';
CREATE INDEX data_deletion_requested_at ON public.data_deletion_requests(requested_by,requested_at DESC);
ALTER TABLE public.data_deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_deletion_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.data_deletion_requests TO authenticated;
GRANT ALL ON public.data_deletion_requests TO service_role;
CREATE POLICY deletion_request_read ON public.data_deletion_requests FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.users_profile p WHERE p.id=auth.uid() AND p.aktif IS TRUE
  AND (p.role='admin' OR requested_by=p.id)));

CREATE FUNCTION deletion_private.assert_admin(p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users_profile WHERE id=p_actor AND role='admin' AND aktif IS TRUE) THEN
    RAISE EXCEPTION 'Hanya admin utama yang boleh menjalankan tindakan ini';
  END IF;
END $$;

CREATE FUNCTION deletion_private.authorize(p_actor uuid,p_table text,p_row jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_role text; v_dept uuid;
BEGIN
  -- Every identifier used by dynamic SQL is checked before interpolation.
  IF p_table NOT IN ('siswa','kelas','tingkat','angkatan','jadwal','kalender_akademik',
    'mata_pelajaran','semester','kompetensi_dasar','pegawai',
    'tagihan','pembayaran','jurnal','pengeluaran','transaksi_kas_kecil','penyisihan_piutang',
    'skema_diskon','siswa_diskon','jenis_pembayaran','jenis_pengeluaran','tahun_ajaran',
    'tahun_buku','akun_rekening','pengaturan_akun','program_dana') THEN
    RAISE EXCEPTION 'Jenis data tidak mendukung penghapusan';
  END IF;
  SELECT role INTO v_role FROM public.users_profile WHERE id=p_actor AND aktif IS TRUE;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Akun tidak aktif atau tidak ditemukan'; END IF;
  IF v_role='admin' THEN RETURN v_role; END IF;
  IF p_table IN ('siswa','kelas','tingkat','angkatan','jadwal','kalender_akademik') THEN
    v_dept := NULLIF(p_row->>'departemen_id','')::uuid;
    IF p_table='jadwal' THEN
      SELECT departemen_id INTO v_dept FROM public.kelas WHERE id=NULLIF(p_row->>'kelas_id','')::uuid;
    END IF;
    IF v_role='admin_tu' AND public.can_manage_akademik_departemen(p_actor,v_dept) THEN RETURN v_role; END IF;
    -- Kepala sekolah has SELECT-only access to student records.
    IF v_role='kepala_sekolah' AND p_table<>'siswa'
      AND public.can_manage_akademik_departemen(p_actor,v_dept) THEN RETURN v_role; END IF;
  ELSIF p_table IN ('mata_pelajaran','semester','kompetensi_dasar') THEN
    -- Existing kepala_sekolah shared-reference access becomes request-only.
    IF v_role='kepala_sekolah' OR (p_table='kompetensi_dasar' AND v_role='guru') THEN RETURN v_role; END IF;
  ELSIF p_table='tahun_ajaran' AND v_role='kepala_sekolah' THEN
    RETURN v_role;
  ELSIF p_table<>'pegawai' AND v_role='keuangan' THEN
    RETURN v_role;
  END IF;
  RAISE EXCEPTION 'Data di luar kewenangan akun';
END $$;

CREATE FUNCTION deletion_private.snapshot(p_table text,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row jsonb; v_related jsonb; v_context jsonb;
BEGIN
  -- authorize validates the table name even when a record does not exist.
  IF p_table NOT IN ('siswa','kelas','tingkat','angkatan','jadwal','kalender_akademik',
    'mata_pelajaran','semester','kompetensi_dasar','pegawai',
    'tagihan','pembayaran','jurnal','pengeluaran','transaksi_kas_kecil','penyisihan_piutang',
    'skema_diskon','siswa_diskon','jenis_pembayaran','jenis_pengeluaran','tahun_ajaran',
    'tahun_buku','akun_rekening','pengaturan_akun','program_dana') THEN
    RAISE EXCEPTION 'Jenis data tidak mendukung penghapusan';
  END IF;
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 FOR UPDATE',p_table) INTO v_row USING p_id;
  IF v_row IS NULL THEN RAISE EXCEPTION 'Data tidak ditemukan atau sudah diproses'; END IF;
  IF p_table='siswa' THEN
    PERFORM 1 FROM public.siswa_detail WHERE siswa_id=p_id FOR UPDATE;
    SELECT jsonb_build_object('detail',(SELECT to_jsonb(d) FROM public.siswa_detail d WHERE siswa_id=p_id),
      'tagihan',(SELECT count(*) FROM public.tagihan WHERE siswa_id=p_id),
      'pembayaran',(SELECT count(*) FROM public.pembayaran WHERE siswa_id=p_id))
    INTO v_related;
  ELSIF p_table='jurnal' THEN
    PERFORM 1 FROM public.jurnal_detail WHERE jurnal_id=p_id FOR UPDATE;
    SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id),'[]') INTO v_related FROM public.jurnal_detail d WHERE jurnal_id=p_id;
  ELSIF p_table='pembayaran' THEN
    PERFORM 1 FROM public.tagihan WHERE pembayaran_id=p_id FOR UPDATE;
    PERFORM 1 FROM public.pendapatan_dimuka WHERE pembayaran_id=p_id FOR UPDATE;
    PERFORM 1 FROM public.payment_receipt_items WHERE payment_id=p_id FOR UPDATE;
    SELECT jsonb_build_object(
      'bills',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM public.tagihan t WHERE pembayaran_id=p_id),
      'deferred',(SELECT coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('journal',
        CASE WHEN d.jurnal_pengakuan_id IS NOT NULL THEN deletion_private.snapshot('jurnal',d.jurnal_pengakuan_id) END) ORDER BY d.id),'[]')
        FROM public.pendapatan_dimuka d WHERE pembayaran_id=p_id),
      'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id),'[]') FROM public.payment_receipt_items i WHERE payment_id=p_id)
    ) INTO v_related;
  END IF;
  IF NULLIF(v_row->>'jurnal_id','') IS NOT NULL THEN
    v_related:=jsonb_build_object('links',v_related,'journal',
      deletion_private.snapshot('jurnal',(v_row->>'jurnal_id')::uuid));
  ELSIF p_table='tagihan' AND NULLIF(v_row->>'jurnal_piutang_id','') IS NOT NULL THEN
    v_related:=jsonb_build_object('journal',deletion_private.snapshot('jurnal',(v_row->>'jurnal_piutang_id')::uuid));
  END IF;
  SELECT jsonb_build_object(
    'student_name',(SELECT nama FROM public.siswa WHERE id=NULLIF(v_row->>'siswa_id','')::uuid),
    'student_nis',(SELECT nis FROM public.siswa WHERE id=NULLIF(v_row->>'siswa_id','')::uuid),
    'payment_type',CASE WHEN p_table IN ('tagihan','pembayaran','siswa_diskon') THEN
      (SELECT nama FROM public.jenis_pembayaran WHERE id=NULLIF(v_row->>'jenis_id','')::uuid) END,
    'department',(SELECT nama FROM public.departemen WHERE id=coalesce(NULLIF(v_row->>'departemen_id','')::uuid,
      (SELECT departemen_id FROM public.siswa WHERE id=NULLIF(v_row->>'siswa_id','')::uuid),
      (SELECT departemen_id FROM public.kelas WHERE id=NULLIF(v_row->>'kelas_id','')::uuid))),
    'class',(SELECT nama FROM public.kelas WHERE id=NULLIF(v_row->>'kelas_id','')::uuid),
    'subject',(SELECT nama FROM public.mata_pelajaran WHERE id=NULLIF(v_row->>'mapel_id','')::uuid),
    'employee',(SELECT nama FROM public.pegawai WHERE id=NULLIF(v_row->>'pegawai_id','')::uuid),
    'financial_year',CASE WHEN p_table IN ('tagihan','pembayaran') THEN
      (SELECT nama FROM public.tahun_buku WHERE id=NULLIF(v_row->>'tahun_ajaran_id','')::uuid) END)
  INTO v_context;
  RETURN jsonb_build_object('record',v_row,'related',v_related,'context',v_context);
END $$;

CREATE FUNCTION deletion_private.reverse_journal(p_journal uuid,p_actor uuid,p_reason text,p_date date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.jurnal; v_id uuid; v_number text;
BEGIN
  SELECT * INTO j FROM public.jurnal WHERE id=p_journal FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Jurnal asal tidak ditemukan'; END IF;
  IF j.status='draft' THEN
    RAISE EXCEPTION 'Transaksi memiliki jurnal draf; periksa dan koreksi draf terlebih dahulu';
  END IF;
  IF j.status IS DISTINCT FROM 'posted' THEN RAISE EXCEPTION 'Status jurnal asal tidak dapat dibatalkan'; END IF;
  IF EXISTS (SELECT 1 FROM public.jurnal WHERE jurnal_asal_id=j.id AND tipe='pembalik') THEN
    RAISE EXCEPTION 'Jurnal ini sudah pernah dibalik; periksa koreksi sebelumnya';
  END IF;
  SELECT public.generate_nomor_jurnal('JU',extract(year FROM p_date)::integer) INTO v_number;
  INSERT INTO public.jurnal(nomor,tanggal,keterangan,referensi,departemen_id,program_dana_id,
    total_debit,total_kredit,status,tipe,jurnal_asal_id,dibuat_oleh)
  VALUES(v_number,p_date,'PEMBATALAN: '||p_reason,j.nomor,j.departemen_id,j.program_dana_id,
    j.total_kredit,j.total_debit,'posted','pembalik',j.id,(SELECT pegawai_id FROM public.users_profile WHERE id=p_actor)) RETURNING id INTO v_id;
  INSERT INTO public.jurnal_detail(jurnal_id,akun_id,debit,kredit,keterangan,urutan)
  SELECT v_id,akun_id,kredit,debit,'[BALIK] '||coalesce(keterangan,''),urutan
  FROM public.jurnal_detail WHERE jurnal_id=j.id;
  RETURN v_id;
END $$;

CREATE FUNCTION deletion_private.execute_action(p_actor uuid,p_table text,p_id uuid,p_action text,p_reason text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_snapshot jsonb; v_row jsonb; v_result jsonb := '{}'; v_date date;
  v_reverse uuid; v_count integer; v_draft boolean; v_dept uuid; v_unit text;
BEGIN
  v_snapshot := deletion_private.snapshot(p_table,p_id); v_row:=v_snapshot->'record';
  PERFORM deletion_private.authorize(p_actor,p_table,v_row);
  v_draft := p_table='jurnal' AND v_row->>'status'='draft' AND (v_row->>'dibuat_oleh')::uuid=(SELECT pegawai_id FROM public.users_profile WHERE id=p_actor);
  IF NOT coalesce(v_draft,false) THEN PERFORM deletion_private.assert_admin(p_actor); END IF;
  v_date := coalesce(NULLIF(p_payload->>'tanggal','')::date,(now() AT TIME ZONE 'Asia/Jakarta')::date);
  IF p_table IN ('tagihan','pembayaran','jurnal','pengeluaran','transaksi_kas_kecil','penyisihan_piutang') THEN
    IF EXISTS(SELECT 1 FROM public.tahun_buku WHERE ditutup IS TRUE AND v_date BETWEEN tanggal_mulai AND tanggal_selesai) THEN
      RAISE EXCEPTION 'Tanggal tindakan berada pada periode yang sudah ditutup buku';
    END IF;
    v_dept:=NULLIF(v_row->>'departemen_id','')::uuid;
    IF v_dept IS NULL AND NULLIF(v_row->>'siswa_id','') IS NOT NULL THEN
      SELECT departemen_id INTO v_dept FROM public.siswa WHERE id=(v_row->>'siswa_id')::uuid;
    END IF;
    SELECT CASE WHEN kategori IN ('unit_usaha','unit_dana_terikat','unit_yayasan') THEN 'unit_usaha_dana' ELSE 'unit_pendidikan' END
      INTO v_unit FROM public.departemen WHERE id=v_dept;
    v_unit:=coalesce(v_unit,'unit_pendidikan');
    IF EXISTS(SELECT 1 FROM public.log_tutup_buku l JOIN public.tahun_buku b ON b.id=l.tahun_ajaran_id
      WHERE l.unit=v_unit AND (v_date BETWEEN b.tanggal_mulai AND b.tanggal_selesai
        OR coalesce(NULLIF(v_row->>'tanggal',''),NULLIF(v_row->>'tanggal_bayar',''))::date BETWEEN b.tanggal_mulai AND b.tanggal_selesai)) THEN
      RAISE EXCEPTION 'Periode transaksi sudah ditutup buku untuk unit ini';
    END IF;
    IF NULLIF(v_row->>'tanggal','') IS NOT NULL AND EXISTS(SELECT 1 FROM public.tahun_buku
      WHERE ditutup IS TRUE AND (v_row->>'tanggal')::date BETWEEN tanggal_mulai AND tanggal_selesai) THEN
      RAISE EXCEPTION 'Transaksi asal berada pada periode yang sudah ditutup buku';
    END IF;
  END IF;
  IF p_action IN ('cancel_bill','correct_bill') AND p_table='tagihan' THEN
    SELECT public.batalkan_tagihan_atomik(p_id,
      CASE WHEN p_action='cancel_bill' THEN 'batal' ELSE 'koreksi_nominal' END,
      p_reason,v_date,p_actor,NULLIF(p_payload->>'nominal_baru','')::numeric) INTO v_result;
  ELSIF p_action='cancel_payment' AND p_table='pembayaran' THEN
    SELECT public.batalkan_pembayaran_dengan_kuitansi_atomik(p_id,p_reason,v_date,p_actor) INTO v_result;
  ELSIF p_action='delete' AND p_table NOT IN ('tagihan','pembayaran') THEN
    IF p_table='jurnal' AND v_row->>'status' IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Jurnal yang sudah diposting harus dikoreksi melalui jurnal pembalik';
    END IF;
    IF p_table='siswa_diskon' AND v_row->>'status' IN ('disetujui','dibatalkan') THEN
      RAISE EXCEPTION 'Riwayat keringanan yang sudah diproses tidak boleh dihapus';
    END IF;
    IF p_table='siswa' AND (EXISTS(SELECT 1 FROM public.tagihan WHERE siswa_id=p_id)
      OR EXISTS(SELECT 1 FROM public.pembayaran WHERE siswa_id=p_id)) THEN
      RAISE EXCEPTION 'Siswa memiliki riwayat keuangan; gunakan status nonaktif agar histori tetap utuh';
    END IF;
    IF p_table='tahun_ajaran' AND EXISTS(SELECT 1 FROM public.kelas_siswa WHERE tahun_ajaran_id=p_id) THEN
      RAISE EXCEPTION 'Tahun ajaran sudah memiliki data kelas siswa dan tidak boleh dihapus';
    END IF;
    IF p_table='kelas' AND EXISTS(SELECT 1 FROM public.kelas_siswa WHERE kelas_id=p_id) THEN
      RAISE EXCEPTION 'Kelas sudah memiliki siswa; pindahkan siswa dan pertahankan riwayat kelas';
    END IF;
    IF p_table='tingkat' AND EXISTS(SELECT 1 FROM public.kelas WHERE tingkat_id=p_id) THEN
      RAISE EXCEPTION 'Tingkat sudah digunakan oleh kelas';
    END IF;
    IF p_table='angkatan' AND EXISTS(SELECT 1 FROM public.siswa WHERE angkatan_id=p_id) THEN
      RAISE EXCEPTION 'Angkatan sudah digunakan oleh siswa';
    END IF;
    IF p_table='siswa' AND EXISTS(SELECT 1 FROM public.kelas_siswa WHERE siswa_id=p_id) THEN
      RAISE EXCEPTION 'Siswa memiliki riwayat kelas; gunakan status nonaktif agar histori tetap utuh';
    END IF;
    IF p_table='tahun_buku' AND (v_row->>'ditutup')::boolean IS TRUE THEN
      RAISE EXCEPTION 'Tahun buku yang sudah ditutup tidak boleh dihapus';
    END IF;
    IF p_table IN ('pengeluaran','transaksi_kas_kecil','penyisihan_piutang') AND NULLIF(v_row->>'jurnal_id','') IS NOT NULL THEN
      v_reverse:=deletion_private.reverse_journal((v_row->>'jurnal_id')::uuid,p_actor,p_reason,v_date);
      v_result:=jsonb_build_object('jurnal_pembalik_id',v_reverse);
    END IF;
    BEGIN
      EXECUTE format('DELETE FROM public.%I WHERE id=$1',p_table) USING p_id;
      GET DIAGNOSTICS v_count=ROW_COUNT;
      IF v_count<>1 THEN RAISE EXCEPTION 'Data tidak berhasil dihapus'; END IF;
      v_result:=v_result||jsonb_build_object('action','deleted');
    EXCEPTION WHEN foreign_key_violation THEN
      IF p_table<>'jenis_pembayaran' THEN RAISE; END IF;
      UPDATE public.jenis_pembayaran SET aktif=false WHERE id=p_id;
      v_result:=jsonb_build_object('action','deactivated');
    END;
  ELSE
    RAISE EXCEPTION 'Tindakan tidak cocok dengan jenis data';
  END IF;
  IF (p_action='delete' AND p_table IN ('jurnal','pengeluaran','transaksi_kas_kecil','penyisihan_piutang',
      'skema_diskon','siswa_diskon','jenis_pembayaran','jenis_pengeluaran','tahun_buku','akun_rekening','pengaturan_akun','program_dana'))
      OR p_action='cancel_payment' THEN
    INSERT INTO public.audit_keuangan(tabel_sumber,record_id,aksi,data_lama,data_baru,keterangan,departemen_id,dibuat_oleh,nama_pengguna)
    VALUES(p_table,p_id::text,CASE WHEN v_result->>'action'='deactivated' THEN 'UPDATE' ELSE 'DELETE' END,
      v_row,v_result||jsonb_build_object('alasan',p_reason),
      'Tindakan penghapusan/pembatalan: '||p_reason,v_dept,p_actor,
      (SELECT email FROM public.users_profile WHERE id=p_actor));
  END IF;
  RETURN coalesce(v_result,'{}');
END $$;

CREATE FUNCTION public.process_data_deletion(p_actor uuid,p_table text,p_id uuid,p_reason text,
  p_action text DEFAULT 'delete',p_payload jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_snapshot jsonb; v_role text; v_id uuid; v_result jsonb; v_draft boolean;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 5 AND 2000 THEN
    RAISE EXCEPTION 'Alasan wajib diisi, minimal 5 dan maksimal 2000 karakter';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('delete','cancel_bill','correct_bill','cancel_payment') OR
    (p_action='delete' AND p_table IN ('tagihan','pembayaran')) OR
    (p_action IN ('cancel_bill','correct_bill') AND p_table<>'tagihan') OR
    (p_action='cancel_payment' AND p_table<>'pembayaran') THEN RAISE EXCEPTION 'Tindakan tidak valid'; END IF;
  IF p_action='correct_bill' AND (
    coalesce(p_payload->>'nominal_baru','') !~ '^[0-9]+(\.[0-9]{1,2})?$'
    OR coalesce((p_payload->>'nominal_baru')::numeric,0)<=0
    OR (p_payload->>'nominal_baru')::numeric>9999999999999.99) THEN
    RAISE EXCEPTION 'Nominal baru harus lebih dari 0';
  END IF;
  v_snapshot:=deletion_private.snapshot(p_table,p_id);
  v_role:=deletion_private.authorize(p_actor,p_table,v_snapshot->'record');
  IF p_table='tagihan' AND v_snapshot->'record'->>'status' NOT IN ('belum_bayar','terjadwal') THEN
    RAISE EXCEPTION 'Tagihan sudah dibayar atau dibatalkan; periksa kembali';
  END IF;
  v_draft:=p_table='jurnal' AND v_snapshot->'record'->>'status'='draft'
    AND (v_snapshot->'record'->>'dibuat_oleh')::uuid=(SELECT pegawai_id FROM public.users_profile WHERE id=p_actor);
  IF v_role='admin' OR coalesce(v_draft,false) THEN
    v_result:=deletion_private.execute_action(p_actor,p_table,p_id,p_action,btrim(p_reason),p_payload);
    INSERT INTO public.data_deletion_requests(target_table,target_id,action,reason,payload,snapshot,requested_by,
      status,reviewed_by,reviewed_at,review_note,execution_result)
    VALUES(p_table,p_id,p_action,btrim(p_reason),p_payload,v_snapshot,p_actor,'executed',p_actor,now(),
      CASE WHEN v_role='admin' THEN 'Tindakan langsung admin' ELSE 'Draf milik pembuat' END,v_result) RETURNING id INTO v_id;
    RETURN jsonb_build_object('pending',false,'request_id',v_id,'result',v_result);
  END IF;
  BEGIN
    INSERT INTO public.data_deletion_requests(target_table,target_id,action,reason,payload,snapshot,requested_by)
    VALUES(p_table,p_id,p_action,btrim(p_reason),p_payload,v_snapshot,p_actor) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Data ini sudah memiliki pengajuan yang menunggu persetujuan admin';
  END;
  RETURN jsonb_build_object('pending',true,'request_id',v_id);
END $$;

-- One Worker subrequest for up to 100 independent bill requests.
CREATE FUNCTION public.queue_bill_deletion_batch(p_actor uuid,p_ids uuid[],p_reason text,p_date date)
RETURNS TABLE(tagihan_id uuid,berhasil boolean,error_message text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid;
BEGIN
  IF coalesce(cardinality(p_ids),0) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Pilih 1 sampai 100 tagihan'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.users_profile WHERE id=p_actor AND aktif IS TRUE AND role='keuangan') THEN
    RAISE EXCEPTION 'Pengajuan massal hanya untuk petugas keuangan aktif';
  END IF;
  FOR v_id IN SELECT DISTINCT unnest(p_ids) LOOP
    BEGIN
      PERFORM public.process_data_deletion(p_actor,'tagihan',v_id,p_reason,'cancel_bill',jsonb_build_object('tanggal',p_date));
      tagihan_id:=v_id;berhasil:=true;error_message:=NULL;RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      tagihan_id:=v_id;berhasil:=false;error_message:=SQLERRM;RETURN NEXT;
    END;
  END LOOP;
END $$;

CREATE FUNCTION public.review_data_deletion(p_actor uuid,p_request uuid,p_approve boolean,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.data_deletion_requests; v_snapshot jsonb; v_result jsonb;
BEGIN
  PERFORM deletion_private.assert_admin(p_actor);
  IF p_approve IS NULL THEN RAISE EXCEPTION 'Keputusan wajib diisi'; END IF;
  IF p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 5 AND 2000 THEN
    RAISE EXCEPTION 'Catatan keputusan wajib diisi, minimal 5 dan maksimal 2000 karakter';
  END IF;
  SELECT * INTO r FROM public.data_deletion_requests WHERE id=p_request FOR UPDATE;
  IF NOT FOUND OR r.status<>'pending' THEN RAISE EXCEPTION 'Pengajuan tidak ditemukan atau sudah diputuskan'; END IF;
  IF NOT p_approve THEN
    UPDATE public.data_deletion_requests SET status='rejected',reviewed_by=p_actor,reviewed_at=now(),review_note=btrim(p_note) WHERE id=r.id;
    RETURN jsonb_build_object('status','rejected');
  END IF;
  -- Lock the target before comparing and executing; no lost-update window.
  BEGIN
    v_snapshot:=deletion_private.snapshot(r.target_table,r.target_id);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'Data tidak ditemukan atau sudah diproses' THEN RAISE; END IF;
    v_snapshot:=NULL;
  END;
  IF v_snapshot IS DISTINCT FROM r.snapshot THEN
    UPDATE public.data_deletion_requests SET status='changed',reviewed_by=p_actor,reviewed_at=now(),
      review_note='Data berubah sejak pengajuan. '||btrim(p_note) WHERE id=r.id;
    RETURN jsonb_build_object('status','changed');
  END IF;
  -- Permission changes after submission also invalidate execution.
  PERFORM deletion_private.authorize(r.requested_by,r.target_table,v_snapshot->'record');
  v_result:=deletion_private.execute_action(p_actor,r.target_table,r.target_id,r.action,r.reason,r.payload);
  UPDATE public.data_deletion_requests SET status='approved',reviewed_by=p_actor,reviewed_at=now(),
    review_note=btrim(p_note),execution_result=v_result WHERE id=r.id;
  RETURN jsonb_build_object('status','approved','result',v_result);
END $$;

-- Direct REST deletion cannot bypass approval. Trusted service operations still
-- support maintenance, compensation, and the verified server functions above.
CREATE FUNCTION deletion_private.guard_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_role text;
BEGIN
  IF TG_TABLE_NAME='jurnal' THEN
    IF OLD.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Jurnal yang sudah diposting harus dikoreksi melalui jurnal pembalik';
    END IF;
  END IF;
  IF auth.uid() IS NOT NULL AND coalesce(auth.role(),'')<>'service_role' THEN
    SELECT role INTO v_role FROM public.users_profile WHERE id=auth.uid() AND aktif IS TRUE;
    IF v_role IS DISTINCT FROM 'admin' THEN
      IF TG_TABLE_NAME='jurnal' THEN
        IF OLD.status='draft' AND OLD.dibuat_oleh=(SELECT pegawai_id FROM public.users_profile WHERE id=auth.uid()) AND v_role='keuangan' THEN RETURN OLD; END IF;
      END IF;
      RAISE EXCEPTION 'Penghapusan memerlukan persetujuan admin; gunakan Ajukan Penghapusan';
    END IF;
  END IF;
  RETURN OLD;
END $$;

DO $guards$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['siswa','kelas','tingkat','angkatan','jadwal','kalender_akademik',
    'mata_pelajaran','semester','kompetensi_dasar','pegawai','tagihan','pembayaran','jurnal',
    'pengeluaran','transaksi_kas_kecil','penyisihan_piutang','skema_diskon','siswa_diskon',
    'jenis_pembayaran','jenis_pengeluaran','tahun_ajaran','tahun_buku','akun_rekening','pengaturan_akun','program_dana']
  LOOP
    EXECUTE format('REVOKE TRUNCATE ON TABLE public.%I FROM anon,authenticated',t);
    EXECUTE format('CREATE TRIGGER require_deletion_approval BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION deletion_private.guard_delete()',t);
  END LOOP;
END $guards$;

-- Existing service RPCs must reject non-admin actors, including older deployed
-- server code. Keep their accounting implementations and signatures intact.
DO $rpc_guards$
DECLARE sig text; def text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.batalkan_tagihan_atomik(uuid,text,text,date,uuid,numeric)',
    'public.batalkan_tagihan_batch(uuid[],text,date,uuid)',
    'public.batalkan_pembayaran_atomik(uuid,text,date,uuid)',
    'public.batalkan_pembayaran_dengan_kuitansi_atomik(uuid,text,date,uuid)']
  LOOP
    SELECT pg_get_functiondef(sig::regprocedure) INTO def;
    IF def !~ E'\nBEGIN\n' THEN RAISE EXCEPTION 'Bentuk fungsi tidak dikenal: %',sig; END IF;
    def:=regexp_replace(def,E'\nBEGIN\n',E'\nBEGIN\n  PERFORM deletion_private.assert_admin(p_user_id);\n');
    EXECUTE def;
  END LOOP;
END $rpc_guards$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA deletion_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.process_data_deletion(uuid,text,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.review_data_deletion(uuid,uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_data_deletion(uuid,text,uuid,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_data_deletion(uuid,uuid,boolean,text) TO service_role;

REVOKE ALL ON FUNCTION public.queue_bill_deletion_batch(uuid,uuid[],text,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_bill_deletion_batch(uuid,uuid[],text,date) TO service_role;

CREATE FUNCTION deletion_private.guard_bill_cancellation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.status='dibatalkan' AND OLD.status IS DISTINCT FROM NEW.status
    AND auth.uid() IS NOT NULL AND coalesce(auth.role(),'')<>'service_role' THEN
    IF NOT EXISTS(SELECT 1 FROM public.users_profile WHERE id=auth.uid() AND aktif IS TRUE AND role='admin') THEN
      RAISE EXCEPTION 'Pembatalan tagihan memerlukan persetujuan admin';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION deletion_private.guard_bill_cancellation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER require_bill_cancellation_approval BEFORE UPDATE OF status ON public.tagihan
FOR EACH ROW EXECUTE FUNCTION deletion_private.guard_bill_cancellation();

CREATE TRIGGER require_student_detail_deletion_approval BEFORE DELETE ON public.siswa_detail
FOR EACH ROW EXECUTE FUNCTION deletion_private.guard_delete();
