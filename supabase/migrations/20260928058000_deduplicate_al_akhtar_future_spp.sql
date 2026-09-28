-- Deduplicate Al Akhtar's identical Jan-Jun 2027 legacy SPP source pairs.
-- One schedule is created per month and both identical source rows link to it.
do $$
declare
  v_siswa constant uuid := '2afb7733-3c39-4674-b6a7-0aaa4fd3bc32'::uuid;
  v_jenis uuid;
  v_book uuid;
  v_ta uuid;
  v_kelas uuid;
  v_count integer;
  v_periods integer;
  v_bad integer;
  v_inserted integer;
  v_linked integer;
begin
  select count(*),count(distinct period_month)
  into v_count,v_periods
  from migration.legacy_tagihan_snapshot
  where snapshot_date=date '2026-09-27'
    and siswa_id=v_siswa
    and target_tagihan_id is null
    and disposition='hold_source_duplicate'
    and period_month between date '2027-01-01' and date '2027-06-01'
    and gross=450000 and discount=0 and remaining=450000;

  if v_count<>12 or v_periods<>6 then
    raise exception 'Duplicate source shape changed: rows %, periods %',v_count,v_periods;
  end if;

  select count(*) into v_bad
  from (
    select period_month,count(*) as n,count(distinct source_name) as names,
           count(distinct gross) as grosses,count(distinct remaining) as remains
    from migration.legacy_tagihan_snapshot
    where snapshot_date=date '2026-09-27'
      and siswa_id=v_siswa and disposition='hold_source_duplicate'
      and target_tagihan_id is null
    group by period_month
    having count(*)<>2 or count(distinct source_name)<>1
       or count(distinct gross)<>1 or count(distinct remaining)<>1
  ) x;
  if v_bad<>0 then raise exception 'Duplicate source pairs are not identical'; end if;

  select jp.id into strict v_jenis
  from public.jenis_pembayaran jp
  join public.departemen d on d.id=jp.departemen_id
  where d.kode='SMP' and jp.nama='SPP SMP' and jp.aktif;

  select id into strict v_book
  from public.tahun_buku where nama='Tahun 2027' and not ditutup;

  select id into strict v_ta
  from public.tahun_ajaran
  where date '2027-01-01' between tanggal_mulai and tanggal_selesai;

  select kelas_id into strict v_kelas
  from public.kelas_siswa
  where siswa_id=v_siswa and tahun_ajaran_id=v_ta and aktif;

  insert into public.tarif_tagihan
    (jenis_id,siswa_id,tahun_ajaran_id,nominal,keterangan,aktif)
  select v_jenis,v_siswa,v_book,450000,
    'Tarif SPP SMP 2027 dilanjutkan dari jadwal legacy seragam Rp450.000; sumber duplikat dideduplikasi per bulan.',
    true
  where not exists (
    select 1 from public.tarif_tagihan
    where jenis_id=v_jenis and siswa_id=v_siswa
      and tahun_ajaran_id=v_book and aktif
  );

  with periods as (
    select distinct period_month
    from migration.legacy_tagihan_snapshot
    where snapshot_date=date '2026-09-27'
      and siswa_id=v_siswa
      and disposition='hold_source_duplicate'
      and target_tagihan_id is null
  ), ins as (
    insert into public.tagihan
      (siswa_id,jenis_id,tahun_ajaran_id,kelas_id,bulan,nominal,status,
       jatuh_tempo,nominal_bruto,nominal_diskon)
    select v_siswa,v_jenis,v_book,v_kelas,
           extract(month from period_month)::int,
           450000,'terjadwal',
           make_date(2027,extract(month from period_month)::int,10),
           450000,0
    from periods
    on conflict do nothing
    returning id
  )
  select count(*) into v_inserted from ins;

  if v_inserted<>6 then
    raise exception 'Inserted schedules %, expected 6',v_inserted;
  end if;

  update migration.legacy_tagihan_snapshot l
  set target_tagihan_id=t.id,
      disposition='linked_deduplicated_schedule',
      imported_at=now()
  from public.tagihan t
  where l.snapshot_date=date '2026-09-27'
    and l.siswa_id=v_siswa
    and l.target_tagihan_id is null
    and l.disposition='hold_source_duplicate'
    and t.siswa_id=v_siswa
    and t.jenis_id=v_jenis
    and t.tahun_ajaran_id=v_book
    and t.bulan=extract(month from l.period_month)::int
    and t.status='terjadwal'
    and t.nominal=450000
    and t.jurnal_piutang_id is null;

  get diagnostics v_linked=row_count;
  if v_linked<>12 then
    raise exception 'Linked duplicate sources %, expected 12',v_linked;
  end if;
end $$;