-- Cutover operation: schedules only. This function is intentionally in a
-- non-exposed schema and requires an exact expected row count.
create or replace function migration.import_legacy_spp_scheduled(
  p_snapshot_date date,
  p_expected_count integer
) returns jsonb
language plpgsql security invoker
set search_path = pg_catalog, public, migration
as $fn$
declare
  v_pending integer;
  v_mapped integer;
  v_inserted integer;
  v_linked integer;
begin
  if p_expected_count <= 0 then
    raise exception 'Expected count must be positive';
  end if;

  select count(*) into v_pending
  from migration.legacy_tagihan_snapshot
  where snapshot_date=p_snapshot_date and disposition='candidate_scheduled';

  if v_pending <> p_expected_count then
    raise exception 'Candidate count changed: expected %, found %',
      p_expected_count, v_pending;
  end if;

  with mapped as (
    select l.source_key, l.siswa_id, j.id as jenis_id,
           tb.id as tahun_buku_id, ks.kelas_id,
           extract(month from l.period_month)::integer as bulan,
           make_date(extract(year from l.period_month)::integer,
                     extract(month from l.period_month)::integer,10) as jatuh_tempo,
           l.remaining, l.gross, l.discount
    from migration.legacy_tagihan_snapshot l
    join public.siswa s on s.id=l.siswa_id and s.status='aktif'
    join public.departemen d on d.id=s.departemen_id
    join public.jenis_pembayaran j on j.departemen_id=d.id and j.aktif
      and j.nama=case when upper(l.source_name) like '%DAYCARE%'
                      then 'DAYCARE TK' else 'SPP '||d.kode end
    join public.tahun_buku tb
      on extract(year from tb.tanggal_mulai)=extract(year from l.period_month)
    join public.tahun_ajaran ta
      on l.period_month between ta.tanggal_mulai and ta.tanggal_selesai
    join public.kelas_siswa ks
      on ks.siswa_id=l.siswa_id and ks.tahun_ajaran_id=ta.id and ks.aktif
    where l.snapshot_date=p_snapshot_date
      and l.disposition='candidate_scheduled'
  ), ins as (
    insert into public.tagihan
      (siswa_id, jenis_id, tahun_ajaran_id, kelas_id, bulan, nominal,
       status, jatuh_tempo, nominal_bruto, nominal_diskon)
    select siswa_id, jenis_id, tahun_buku_id, kelas_id, bulan, remaining,
           'terjadwal', jatuh_tempo, gross, discount
    from mapped
    on conflict do nothing
    returning id, siswa_id, jenis_id, tahun_ajaran_id, bulan
  ), linked as (
    update migration.legacy_tagihan_snapshot l
    set target_tagihan_id=i.id, disposition='imported_scheduled'
    from mapped m
    join ins i on i.siswa_id=m.siswa_id and i.jenis_id=m.jenis_id
      and i.tahun_ajaran_id=m.tahun_buku_id and i.bulan=m.bulan
    where l.source_key=m.source_key
    returning l.source_key
  )
  select (select count(*) from mapped),
         (select count(*) from ins),
         (select count(*) from linked)
  into v_mapped,v_inserted,v_linked;

  if v_mapped <> p_expected_count or v_inserted <> p_expected_count
     or v_linked <> p_expected_count then
    raise exception 'Import rolled back: expected %, mapped %, inserted %, linked %',
      p_expected_count,v_mapped,v_inserted,v_linked;
  end if;

  return jsonb_build_object('snapshot_date',p_snapshot_date,
    'scheduled',v_inserted,'journal_created',0);
end;
$fn$;

revoke all on function migration.import_legacy_spp_scheduled(date,integer)
from public,anon,authenticated;
