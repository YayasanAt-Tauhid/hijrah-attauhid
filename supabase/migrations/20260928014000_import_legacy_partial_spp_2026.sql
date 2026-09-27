-- Import only partial SPP with exact tariff and prior cash receipts.
CREATE OR REPLACE FUNCTION migration.import_legacy_partial_spp_2026(p_snapshot_date date, p_expected_count integer, p_expected_net numeric, p_expected_gross numeric, p_expected_paid numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'migration'
AS $function$
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
  if p_expected_count <= 0 or p_expected_net <= 0
     or p_expected_gross <= p_expected_net or p_expected_paid <= 0 then
    raise exception 'Expected totals invalid';
  end if;
  perform pg_advisory_xact_lock(hashtext('migration.import_legacy_partial_spp_2026'));
  select akun_id into strict v_piutang from public.pengaturan_akun
    where kode_setting='piutang_siswa';
  if v_piutang is null then raise exception 'Receivable account missing'; end if;

  with mapped as (
    select l.source_key,l.siswa_id,l.period_month,l.remaining,l.gross,l.discount,
           d.id as dept_id,j.id as jenis_id,j.akun_pendapatan_id,
           tb.id as book_id,ks.kelas_id,
           public.get_tarif_siswa(j.id,l.siswa_id,ks.kelas_id,tb.id,s.angkatan_id) as tarif
    from migration.legacy_tagihan_snapshot l
    join public.siswa s on s.id=l.siswa_id and s.status='aktif'
    join public.departemen d on d.id=s.departemen_id
    join public.jenis_pembayaran j on j.departemen_id=d.id and j.aktif
      and j.nama='SPP '||d.kode
    join public.tahun_buku tb on l.period_month between tb.tanggal_mulai and tb.tanggal_selesai
      and not tb.ditutup
    join public.tahun_ajaran ta on l.period_month between ta.tanggal_mulai and ta.tanggal_selesai
    join public.kelas_siswa ks on ks.siswa_id=l.siswa_id and ks.tahun_ajaran_id=ta.id and ks.aktif
    where l.snapshot_date=p_snapshot_date
      and l.disposition in ('hold_historical','hold_current')
      and l.target_tagihan_id is null
      and extract(year from l.period_month)=2026
      and upper(l.source_name) like '%SPP%'
      and not exists (
        select 1 from public.tagihan t
        where t.siswa_id=l.siswa_id and t.jenis_id=j.id
          and t.tahun_ajaran_id=tb.id
          and t.bulan=extract(month from l.period_month)::integer
      )
  ), candidate as (
    select * from mapped
    where gross=tarif and gross-discount>remaining
      and gross>0 and remaining>0 and discount>=0
  )
  select count(*),coalesce(sum(remaining),0),coalesce(sum(gross),0),
         coalesce(sum(gross-discount-remaining),0)
  into v_count,v_net,v_gross,v_paid from candidate;

  if (v_count,v_net,v_gross,v_paid) is distinct from
     (p_expected_count,p_expected_net,p_expected_gross,p_expected_paid) then
    raise exception 'Candidate totals changed: count %, net %, gross %, paid %',
      v_count,v_net,v_gross,v_paid;
  end if;

  -- A second scan uses identical filters and locks each snapshot row.
  for v_row in
    select l.source_key,l.siswa_id,l.period_month,l.remaining,l.gross,l.discount,
           d.id as dept_id,j.id as jenis_id,j.akun_pendapatan_id,
           tb.id as book_id,ks.kelas_id
    from migration.legacy_tagihan_snapshot l
    join public.siswa s on s.id=l.siswa_id and s.status='aktif'
    join public.departemen d on d.id=s.departemen_id
    join public.jenis_pembayaran j on j.departemen_id=d.id and j.aktif
      and j.nama='SPP '||d.kode
    join public.tahun_buku tb on l.period_month between tb.tanggal_mulai and tb.tanggal_selesai
      and not tb.ditutup
    join public.tahun_ajaran ta on l.period_month between ta.tanggal_mulai and ta.tanggal_selesai
    join public.kelas_siswa ks on ks.siswa_id=l.siswa_id and ks.tahun_ajaran_id=ta.id and ks.aktif
    where l.snapshot_date=p_snapshot_date
      and l.disposition in ('hold_historical','hold_current')
      and l.target_tagihan_id is null
      and extract(year from l.period_month)=2026
      and upper(l.source_name) like '%SPP%'
      and l.gross=public.get_tarif_siswa(j.id,l.siswa_id,ks.kelas_id,tb.id,s.angkatan_id)
      and l.gross-l.discount>l.remaining
      and l.gross>0 and l.remaining>0 and l.discount>=0
      and not exists (
        select 1 from public.tagihan t
        where t.siswa_id=l.siswa_id and t.jenis_id=j.id
          and t.tahun_ajaran_id=tb.id
          and t.bulan=extract(month from l.period_month)::integer
      )
    order by l.source_key
    for update of l
  loop
    if v_row.akun_pendapatan_id is null then
      raise exception 'Accounting account missing for source %',v_row.source_key;
    end if;
    v_nomor := public.generate_nomor_jurnal('JPI',extract(year from v_date)::integer);
    insert into public.jurnal
      (nomor,tanggal,keterangan,referensi,departemen_id,total_debit,total_kredit,status)
    values
      (v_nomor,v_date,'Piutang SPP migrasi periode '||v_row.period_month||' siswa '||v_row.siswa_id,
       'MIGR-LEGACY-SPP-'||v_row.source_key,v_row.dept_id,
       v_row.remaining,v_row.remaining,'posted')
    returning id into v_jurnal;

    insert into public.jurnal_detail
      (jurnal_id,akun_id,keterangan,debit,kredit,urutan)
    values
      (v_jurnal,v_piutang,'Piutang SPP lama',v_row.remaining,0,1),
      (v_jurnal,v_row.akun_pendapatan_id,'Pendapatan SPP',0,v_row.remaining,2);
    insert into public.tagihan
      (siswa_id,jenis_id,tahun_ajaran_id,kelas_id,bulan,nominal,status,
       jatuh_tempo,nominal_bruto,nominal_diskon,jurnal_piutang_id,
       legacy_source_key,legacy_original_gross,legacy_original_discount,legacy_paid_amount)
    values
      (v_row.siswa_id,v_row.jenis_id,v_row.book_id,v_row.kelas_id,
       extract(month from v_row.period_month)::integer,v_row.remaining,'belum_bayar',
       make_date(extract(year from v_row.period_month)::integer,
                 extract(month from v_row.period_month)::integer,10),
       v_row.remaining,0,v_jurnal,
       v_row.source_key,v_row.gross,v_row.discount,
       v_row.gross-v_row.discount-v_row.remaining)
    returning id into v_tagihan;

    update migration.legacy_tagihan_snapshot
    set target_tagihan_id=v_tagihan,disposition='imported_partial_opening_2026'
    where source_key=v_row.source_key and target_tagihan_id is null
      and disposition in ('hold_historical','hold_current');
    if not found then raise exception 'Snapshot link failed for %',v_row.source_key; end if;
    v_imported := v_imported+1;
  end loop;

  if v_imported<>p_expected_count then
    raise exception 'Imported % but expected %',v_imported,p_expected_count;
  end if;
  return jsonb_build_object('count',v_imported,'net',v_net,
    'gross',v_gross,'paid',v_paid,'journal_date',v_date);
end;
$function$;

revoke all on function migration.import_legacy_partial_spp_2026(date,integer,numeric,numeric,numeric) from public, anon, authenticated;
