-- Import Abinaya Vidi Prasetya's verified Rp50.000 monthly Subsidi Silang
-- schedule for Oct 2026-Jun 2027. Legacy receipts consistently use account 4303.
do $$
declare
  v_siswa constant uuid := '5a15dcd5-1458-45ae-b28d-642155aa6ff1'::uuid;
  v_dept uuid;
  v_jenis uuid;
  v_revenue uuid;
  v_ta uuid;
  v_kelas uuid;
  v_count integer;
  v_inserted integer;
  v_linked integer;
begin
  select count(*) into v_count
  from migration.legacy_tagihan_snapshot
  where snapshot_date=date '2026-09-27'
    and siswa_id=v_siswa
    and target_tagihan_id is null
    and disposition='hold_other'
    and source_name ilike 'SUBSIDI SILANG TETAP%'
    and period_month between date '2026-10-01' and date '2027-06-01'
    and gross=50000 and discount=0 and remaining=50000;

  if v_count<>9 then
    raise exception 'Subsidi silang candidate changed: %',v_count;
  end if;

  select departemen_id into strict v_dept
  from public.siswa
  where id=v_siswa and status='aktif';

  if (select kode from public.departemen where id=v_dept)<>'SD' then
    raise exception 'Unexpected department';
  end if;

  select id into strict v_revenue
  from public.akun_rekening
  where kode='4303' and aktif and jenis='pendapatan';

  insert into public.jenis_pembayaran
    (nama,nominal,keterangan,aktif,departemen_id,akun_pendapatan_id,tipe,perlu_dimuka)
  select 'SUBSIDI SILANG SD',null,
    'Iuran subsidi silang tetap bulanan. Rekonsiliasi legacy menggunakan akun 4303 SUBSIDI SILANG.',
    true,v_dept,v_revenue,'bulanan',true
  where not exists (
    select 1 from public.jenis_pembayaran
    where departemen_id=v_dept and nama='SUBSIDI SILANG SD'
  );

  select id into strict v_jenis
  from public.jenis_pembayaran
  where departemen_id=v_dept and nama='SUBSIDI SILANG SD' and aktif;

  insert into public.tarif_tagihan
    (jenis_id,siswa_id,tahun_ajaran_id,nominal,keterangan,aktif)
  select v_jenis,v_siswa,tb.id,50000,
    'Tarif subsidi silang tetap dari jadwal legacy Okt 2026-Jun 2027.',
    true
  from public.tahun_buku tb
  where tb.nama in ('Tahun 2026','Tahun 2027')
    and not exists (
      select 1 from public.tarif_tagihan tt
      where tt.jenis_id=v_jenis and tt.siswa_id=v_siswa
        and tt.tahun_ajaran_id=tb.id and tt.aktif
    );

  select id into strict v_ta
  from public.tahun_ajaran
  where aktif;

  select kelas_id into strict v_kelas
  from public.kelas_siswa
  where siswa_id=v_siswa and tahun_ajaran_id=v_ta and aktif;

  with src as (
    select l.source_key,l.period_month,l.remaining
    from migration.legacy_tagihan_snapshot l
    where l.snapshot_date=date '2026-09-27'
      and l.siswa_id=v_siswa
      and l.target_tagihan_id is null
      and l.disposition='hold_other'
      and l.source_name ilike 'SUBSIDI SILANG TETAP%'
  ), ins as (
    insert into public.tagihan
      (siswa_id,jenis_id,tahun_ajaran_id,kelas_id,bulan,nominal,status,
       jatuh_tempo,nominal_bruto,nominal_diskon)
    select v_siswa,v_jenis,tb.id,v_kelas,
      extract(month from s.period_month)::int,s.remaining,'terjadwal',
      make_date(extract(year from s.period_month)::int,
                extract(month from s.period_month)::int,10),
      s.remaining,0
    from src s
    join public.tahun_buku tb
      on s.period_month between tb.tanggal_mulai and tb.tanggal_selesai
    on conflict do nothing
    returning id
  )
  select count(*) into v_inserted from ins;

  if v_inserted<>9 then
    raise exception 'Inserted subsidy schedules %, expected 9',v_inserted;
  end if;

  update migration.legacy_tagihan_snapshot l
  set target_tagihan_id=t.id,
      disposition='imported_subsidi_silang_schedule',
      imported_at=now()
  from public.tagihan t, public.tahun_buku tb
  where l.snapshot_date=date '2026-09-27'
    and l.siswa_id=v_siswa
    and l.target_tagihan_id is null
    and l.disposition='hold_other'
    and l.source_name ilike 'SUBSIDI SILANG TETAP%'
    and tb.id=t.tahun_ajaran_id
    and l.period_month between tb.tanggal_mulai and tb.tanggal_selesai
    and t.siswa_id=v_siswa
    and t.jenis_id=v_jenis
    and t.bulan=extract(month from l.period_month)::int
    and t.nominal=l.remaining
    and t.status='terjadwal'
    and t.jurnal_piutang_id is null;

  get diagnostics v_linked=row_count;
  if v_linked<>9 then
    raise exception 'Linked subsidy sources %, expected 9',v_linked;
  end if;
end $$;