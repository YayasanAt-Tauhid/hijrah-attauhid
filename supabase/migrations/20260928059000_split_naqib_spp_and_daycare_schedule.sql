-- Split Naqib Maraja Rahman's future legacy schedule into SPP TK and DAYCARE TK.
-- Both series are uniform Oct 2026-Jun 2027 and remain schedules only (no journals).
do $$
declare
  v_siswa constant uuid := 'c7694128-5225-4100-a633-5349e894c734'::uuid;
  v_spp uuid;
  v_daycare uuid;
  v_count integer;
begin
  select count(*) into v_count
  from migration.legacy_tagihan_snapshot
  where snapshot_date=date '2026-09-27'
    and siswa_id=v_siswa
    and target_tagihan_id is null
    and disposition='hold_tariff_variation'
    and period_month between date '2026-10-01' and date '2027-06-01';

  if v_count<>18 then
    raise exception 'Naqib source row count changed: %',v_count;
  end if;

  if (select count(distinct remaining)
      from migration.legacy_tagihan_snapshot
      where snapshot_date=date '2026-09-27'
        and siswa_id=v_siswa
        and disposition='hold_tariff_variation'
        and upper(source_name) like '%DAYCARE%')<>1
     or
     (select min(remaining)
      from migration.legacy_tagihan_snapshot
      where snapshot_date=date '2026-09-27'
        and siswa_id=v_siswa
        and disposition='hold_tariff_variation'
        and upper(source_name) like '%DAYCARE%')<>650000 then
    raise exception 'Naqib DAYCARE amount changed';
  end if;

  if (select count(distinct remaining)
      from migration.legacy_tagihan_snapshot
      where snapshot_date=date '2026-09-27'
        and siswa_id=v_siswa
        and disposition='hold_tariff_variation'
        and upper(source_name) not like '%DAYCARE%')<>1
     or
     (select min(remaining)
      from migration.legacy_tagihan_snapshot
      where snapshot_date=date '2026-09-27'
        and siswa_id=v_siswa
        and disposition='hold_tariff_variation'
        and upper(source_name) not like '%DAYCARE%')<>350000 then
    raise exception 'Naqib SPP amount changed';
  end if;

  select id into strict v_spp
  from public.jenis_pembayaran
  where nama='SPP TK' and aktif;

  select id into strict v_daycare
  from public.jenis_pembayaran
  where nama='DAYCARE TK' and aktif;

  insert into public.tarif_tagihan
    (jenis_id,siswa_id,tahun_ajaran_id,nominal,keterangan,aktif)
  select x.jenis_id,v_siswa,tb.id,x.nominal,
         'Tarif individual dipulihkan dari jadwal legacy seragam Okt 2026-Jun 2027.',
         true
  from (values
    (v_spp,350000::numeric),
    (v_daycare,650000::numeric)
  ) x(jenis_id,nominal)
  cross join public.tahun_buku tb
  where tb.nama in ('Tahun 2026','Tahun 2027')
    and not exists (
      select 1
      from public.tarif_tagihan tt
      where tt.jenis_id=x.jenis_id
        and tt.siswa_id=v_siswa
        and tt.tahun_ajaran_id=tb.id
        and tt.aktif
    );
end $$;

update migration.legacy_tagihan_snapshot
set disposition='candidate_scheduled'
where snapshot_date=date '2026-09-27'
  and siswa_id='c7694128-5225-4100-a633-5349e894c734'::uuid
  and target_tagihan_id is null
  and disposition='hold_tariff_variation';

select migration.import_legacy_spp_scheduled(date '2026-09-27',18);