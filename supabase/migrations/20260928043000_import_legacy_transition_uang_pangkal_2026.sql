-- Import the verified July 2026 MTA-to-SMA transition uang pangkal remainder.
create or replace function migration.import_legacy_transition_uang_pangkal_2026(
  p_snapshot_date date,
  p_expected_count integer,
  p_expected_net numeric,
  p_expected_gross numeric,
  p_expected_paid numeric
) returns jsonb
language plpgsql
set search_path to 'pg_catalog','public','migration'
as $fn$
declare
  v_row record;
  v_count integer;
  v_net numeric;
  v_gross numeric;
  v_paid numeric;
  v_piutang uuid;
  v_jurnal uuid;
  v_tagihan uuid;
  v_nomor text;
  v_date date := (now() at time zone 'Asia/Jakarta')::date;
  v_imported integer := 0;
begin
  if p_snapshot_date is distinct from date '2026-09-27'
     or p_expected_count<=0 or p_expected_net<=0
     or p_expected_gross<=p_expected_net or p_expected_paid<=0
     or p_expected_gross-p_expected_paid<>p_expected_net then
    raise exception 'Import boundaries invalid';
  end if;

  perform pg_advisory_xact_lock(hashtext('migration.import_legacy_transition_uang_pangkal_2026'));

  select akun_id into strict v_piutang
  from public.pengaturan_akun
  where kode_setting='piutang_siswa';

  with mapped as (
    select l.source_key,l.siswa_id,l.period_month,l.remaining,l.gross,l.discount,
           l.gross-l.discount-l.remaining as paid,
           d.id dept_id,j.id jenis_id,j.akun_pendapatan_id,
           tb.id book_id,ks.kelas_id
    from migration.legacy_tagihan_snapshot l
    join public.siswa s on s.id=l.siswa_id and s.status='aktif'
    join public.departemen d on d.id=s.departemen_id and d.kode='SMA'
    join public.jenis_pembayaran j on j.departemen_id=d.id
      and j.nama='UANG PANGKAL SMA'
      and j.aktif and j.tipe='sekali'
      and j.akun_pendapatan_id=(select id from public.akun_rekening where kode='4307' and aktif)
    join public.tahun_buku tb
      on l.period_month between tb.tanggal_mulai and tb.tanggal_selesai and not tb.ditutup
    join public.tahun_ajaran ta
      on l.period_month between ta.tanggal_mulai and ta.tanggal_selesai
    join public.kelas_siswa ks
      on ks.siswa_id=l.siswa_id and ks.tahun_ajaran_id=ta.id and ks.aktif
    join public.kelas k on k.id=ks.kelas_id and k.departemen_id=d.id
    where l.snapshot_date=p_snapshot_date
      and l.period_month=date '2026-07-01'
      and l.disposition='hold_historical'
      and l.target_tagihan_id is null
      and l.source_name ilike 'UP SISWA MTA%KE MTA TINGKAT SMA ASRAMA TH.2026-2027%'
      and l.discount=0
      and l.gross>l.remaining
      and l.remaining>0
      and not exists (
        select 1 from public.tagihan t
        where t.siswa_id=l.siswa_id
          and t.jenis_id=j.id
          and t.tahun_ajaran_id=tb.id
      )
  )
  select count(*),coalesce(sum(remaining),0),coalesce(sum(gross),0),coalesce(sum(paid),0)
  into v_count,v_net,v_gross,v_paid
  from mapped;

  if (v_count,v_net,v_gross,v_paid) is distinct from
     (p_expected_count,p_expected_net,p_expected_gross,p_expected_paid) then
    raise exception 'Candidate totals changed: count %, net %, gross %, paid %',
      v_count,v_net,v_gross,v_paid;
  end if;

  for v_row in
    select l.source_key,l.siswa_id,l.period_month,l.remaining,l.gross,l.discount,
           l.gross-l.discount-l.remaining as paid,
           d.id dept_id,j.id jenis_id,j.akun_pendapatan_id,
           tb.id book_id,ks.kelas_id
    from migration.legacy_tagihan_snapshot l
    join public.siswa s on s.id=l.siswa_id and s.status='aktif'
    join public.departemen d on d.id=s.departemen_id and d.kode='SMA'
    join public.jenis_pembayaran j on j.departemen_id=d.id
      and j.nama='UANG PANGKAL SMA'
      and j.aktif and j.tipe='sekali'
      and j.akun_pendapatan_id=(select id from public.akun_rekening where kode='4307' and aktif)
    join public.tahun_buku tb
      on l.period_month between tb.tanggal_mulai and tb.tanggal_selesai and not tb.ditutup
    join public.tahun_ajaran ta
      on l.period_month between ta.tanggal_mulai and ta.tanggal_selesai
    join public.kelas_siswa ks
      on ks.siswa_id=l.siswa_id and ks.tahun_ajaran_id=ta.id and ks.aktif
    join public.kelas k on k.id=ks.kelas_id and k.departemen_id=d.id
    where l.snapshot_date=p_snapshot_date
      and l.period_month=date '2026-07-01'
      and l.disposition='hold_historical'
      and l.target_tagihan_id is null
      and l.source_name ilike 'UP SISWA MTA%KE MTA TINGKAT SMA ASRAMA TH.2026-2027%'
      and l.discount=0
      and l.gross>l.remaining
      and l.remaining>0
      and not exists (
        select 1 from public.tagihan t
        where t.siswa_id=l.siswa_id
          and t.jenis_id=j.id
          and t.tahun_ajaran_id=tb.id
      )
    order by l.source_key
    for update of l
  loop
    v_nomor:=public.generate_nomor_jurnal('JPI',extract(year from v_date)::integer);

    insert into public.jurnal
      (nomor,tanggal,keterangan,referensi,departemen_id,total_debit,total_kredit,status)
    values(
      v_nomor,v_date,
      'Piutang uang pangkal transisi lama '||v_row.period_month||' siswa '||v_row.siswa_id,
      'MIGR-LEGACY-FEE-'||v_row.source_key,
      v_row.dept_id,v_row.remaining,v_row.remaining,'posted'
    )
    returning id into v_jurnal;

    insert into public.jurnal_detail
      (jurnal_id,akun_id,keterangan,debit,kredit,urutan)
    values
      (v_jurnal,v_piutang,'Sisa piutang uang pangkal transisi',v_row.remaining,0,1),
      (v_jurnal,v_row.akun_pendapatan_id,'Sisa pendapatan uang pangkal',0,v_row.remaining,2);

    insert into public.tagihan
      (siswa_id,jenis_id,tahun_ajaran_id,kelas_id,bulan,nominal,status,
       jatuh_tempo,nominal_bruto,nominal_diskon,jurnal_piutang_id)
    values(
      v_row.siswa_id,v_row.jenis_id,v_row.book_id,v_row.kelas_id,
      null,v_row.remaining,'belum_bayar',date '2026-07-10',
      v_row.remaining,0,v_jurnal
    )
    returning id into v_tagihan;

    update migration.legacy_tagihan_snapshot
    set target_tagihan_id=v_tagihan,
        disposition='imported_transition_uang_pangkal_2026',
        imported_at=now()
    where source_key=v_row.source_key
      and target_tagihan_id is null
      and disposition='hold_historical';

    if not found then
      raise exception 'Snapshot link failed: %',v_row.source_key;
    end if;

    v_imported:=v_imported+1;
  end loop;

  if v_imported<>p_expected_count then
    raise exception 'Imported % but expected %',v_imported,p_expected_count;
  end if;

  return jsonb_build_object(
    'count',v_imported,'net',v_net,'gross',v_gross,'paid',v_paid,'journal_date',v_date
  );
end;
$fn$;

revoke all on function migration.import_legacy_transition_uang_pangkal_2026(date,integer,numeric,numeric,numeric)
from public,anon,authenticated;
