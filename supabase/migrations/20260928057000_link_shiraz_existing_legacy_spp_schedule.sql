-- Link Shiraz's verified legacy PTK SPP schedule to the already-existing
-- Hijrah discounted schedule. No new tagihan and no journals are created.
do $$
declare
  v_matched integer;
  v_linked integer;
begin
  with src as (
    select l.source_key,l.siswa_id,l.period_month,l.remaining,
           extract(month from l.period_month)::integer as bulan
    from migration.legacy_tagihan_snapshot l
    where l.snapshot_date=date '2026-09-27'
      and l.siswa_id='3694d69d-edc8-441d-8ffe-f228cf318c46'::uuid
      and l.target_tagihan_id is null
      and l.disposition='hold_existing'
  ), matched as (
    select s.source_key,t.id as tagihan_id
    from src s
    join public.jenis_pembayaran jp on jp.nama='SPP SD' and jp.aktif
    join public.tahun_buku tb
      on s.period_month between tb.tanggal_mulai and tb.tanggal_selesai
    join public.tagihan t on t.siswa_id=s.siswa_id
      and t.jenis_id=jp.id
      and t.tahun_ajaran_id=tb.id
      and t.bulan=s.bulan
    where t.nominal=s.remaining
      and t.status='terjadwal'
      and t.jurnal_piutang_id is null
  )
  select count(*) into v_matched from matched;

  if v_matched<>9 then
    raise exception 'Shiraz existing schedule match changed: %',v_matched;
  end if;

  with src as (
    select l.source_key,l.siswa_id,l.period_month,l.remaining,
           extract(month from l.period_month)::integer as bulan
    from migration.legacy_tagihan_snapshot l
    where l.snapshot_date=date '2026-09-27'
      and l.siswa_id='3694d69d-edc8-441d-8ffe-f228cf318c46'::uuid
      and l.target_tagihan_id is null
      and l.disposition='hold_existing'
  ), matched as (
    select s.source_key,t.id as tagihan_id
    from src s
    join public.jenis_pembayaran jp on jp.nama='SPP SD' and jp.aktif
    join public.tahun_buku tb
      on s.period_month between tb.tanggal_mulai and tb.tanggal_selesai
    join public.tagihan t on t.siswa_id=s.siswa_id
      and t.jenis_id=jp.id
      and t.tahun_ajaran_id=tb.id
      and t.bulan=s.bulan
    where t.nominal=s.remaining
      and t.status='terjadwal'
      and t.jurnal_piutang_id is null
  )
  update migration.legacy_tagihan_snapshot l
  set target_tagihan_id=m.tagihan_id,
      disposition='linked_existing_schedule',
      imported_at=now()
  from matched m
  where l.source_key=m.source_key;

  get diagnostics v_linked=row_count;
  if v_linked<>9 then
    raise exception 'Shiraz linked rows %, expected 9',v_linked;
  end if;
end $$;