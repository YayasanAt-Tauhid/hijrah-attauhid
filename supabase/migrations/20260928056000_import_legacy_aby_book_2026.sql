-- Reconcile the final normal historical hold: Arza Zahir's ABY book balance.
-- Legacy accounting evidence consistently maps BUKU ABY receipts to account 4304.
do $$
declare
  v_siswa uuid;
  v_dept uuid;
  v_kelas uuid;
  v_jenis uuid;
  v_book uuid;
  v_piutang uuid;
  v_pendapatan uuid;
  v_jurnal uuid;
  v_tagihan uuid;
  v_nomor text;
  v_source_key text;
  v_count integer;
begin
  select count(*) into v_count
  from migration.legacy_tagihan_snapshot l
  join public.siswa s on s.id=l.siswa_id and s.status='aktif'
  join public.departemen d on d.id=s.departemen_id and d.kode='MTA'
  where l.snapshot_date=date '2026-09-27'
    and l.target_tagihan_id is null
    and l.disposition='hold_historical'
    and l.source_name ilike 'ABY%'
    and l.gross=130000 and l.discount=0 and l.remaining=130000;

  if v_count<>1 then
    raise exception 'ABY candidate count changed: %',v_count;
  end if;

  select id into strict v_pendapatan
  from public.akun_rekening
  where kode='4304' and aktif and jenis='pendapatan';

  select akun_id into strict v_piutang
  from public.pengaturan_akun
  where kode_setting='piutang_siswa';

  select l.siswa_id,s.departemen_id,ks.kelas_id,tb.id,l.source_key
  into v_siswa,v_dept,v_kelas,v_book,v_source_key
  from migration.legacy_tagihan_snapshot l
  join public.siswa s on s.id=l.siswa_id and s.status='aktif'
  join public.tahun_buku tb
    on l.period_month between tb.tanggal_mulai and tb.tanggal_selesai
    and not tb.ditutup
  join public.tahun_ajaran ta
    on l.period_month between ta.tanggal_mulai and ta.tanggal_selesai
  join public.kelas_siswa ks
    on ks.siswa_id=s.id and ks.tahun_ajaran_id=ta.id and ks.aktif
  where l.snapshot_date=date '2026-09-27'
    and l.target_tagihan_id is null
    and l.disposition='hold_historical'
    and l.source_name ilike 'ABY%'
    and l.gross=130000 and l.discount=0 and l.remaining=130000;

  insert into public.jenis_pembayaran
    (nama,nominal,keterangan,aktif,departemen_id,akun_pendapatan_id,tipe,perlu_dimuka)
  select 'BUKU ABY MTA',null,
    'Tagihan buku ABY MTA; dibuat dari rekonsiliasi saldo legacy dan memakai akun pendapatan uang buku.',
    true,v_dept,v_pendapatan,'sekali',false
  where not exists (
    select 1 from public.jenis_pembayaran
    where departemen_id=v_dept and nama='BUKU ABY MTA'
  );

  select id into strict v_jenis
  from public.jenis_pembayaran
  where departemen_id=v_dept and nama='BUKU ABY MTA' and aktif;

  if exists (
    select 1 from public.tagihan
    where siswa_id=v_siswa and jenis_id=v_jenis and tahun_ajaran_id=v_book
  ) then
    raise exception 'ABY target tagihan already exists';
  end if;

  v_nomor:=public.generate_nomor_jurnal('JPI',2026);

  insert into public.jurnal
    (nomor,tanggal,keterangan,referensi,departemen_id,total_debit,total_kredit,status)
  values
    (v_nomor,current_date,
     'Piutang BUKU ABY MTA migrasi Juli 2026',
     'MIGR-LEGACY-FEE-'||v_source_key,
     v_dept,130000,130000,'posted')
  returning id into v_jurnal;

  insert into public.jurnal_detail
    (jurnal_id,akun_id,keterangan,debit,kredit,urutan)
  values
    (v_jurnal,v_piutang,'Piutang Buku ABY MTA',130000,0,1),
    (v_jurnal,v_pendapatan,'Pendapatan Uang Buku ABY',0,130000,2);

  insert into public.tagihan
    (siswa_id,jenis_id,tahun_ajaran_id,kelas_id,bulan,nominal,status,
     jatuh_tempo,nominal_bruto,nominal_diskon,jurnal_piutang_id)
  values
    (v_siswa,v_jenis,v_book,v_kelas,null,130000,'belum_bayar',
     date '2026-07-10',130000,0,v_jurnal)
  returning id into v_tagihan;

  update migration.legacy_tagihan_snapshot
  set target_tagihan_id=v_tagihan,
      disposition='imported_aby_book_2026',
      imported_at=now()
  where source_key=v_source_key
    and target_tagihan_id is null
    and disposition='hold_historical';

  if not found then
    raise exception 'ABY snapshot link failed';
  end if;
end $$;