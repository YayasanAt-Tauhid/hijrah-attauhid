-- Reconcile Jian Herdian's future SPP after promotion to SMA.
-- Final legacy identity already shows class 10 PUTRA; the source fee label still says SMP.
do $$
declare
  v_siswa constant uuid := '30e19634-0b7b-4f2d-9fa6-e6a70a08e92e'::uuid;
  v_jenis uuid;
  v_count integer;
  v_dept text;
  v_kelas text;
begin
  select d.kode,k.nama
  into strict v_dept,v_kelas
  from public.siswa s
  join public.departemen d on d.id=s.departemen_id
  join public.tahun_ajaran ta on ta.aktif
  join public.kelas_siswa ks on ks.siswa_id=s.id
    and ks.tahun_ajaran_id=ta.id and ks.aktif
  join public.kelas k on k.id=ks.kelas_id
  where s.id=v_siswa and s.status='aktif';

  if v_dept<>'SMA' or v_kelas<>'10A' then
    raise exception 'Jian current placement changed: % %',v_dept,v_kelas;
  end if;

  select count(*) into v_count
  from migration.legacy_tagihan_snapshot
  where snapshot_date=date '2026-09-27'
    and siswa_id=v_siswa
    and target_tagihan_id is null
    and disposition='hold_department'
    and period_month between date '2026-10-01' and date '2027-06-01'
    and gross=1300000 and discount=0 and remaining=1300000;

  if v_count<>9 then
    raise exception 'Jian future rows changed: %',v_count;
  end if;

  select id into strict v_jenis
  from public.jenis_pembayaran
  where nama='SPP SMA' and aktif;

  insert into public.tarif_tagihan
    (jenis_id,siswa_id,tahun_ajaran_id,nominal,keterangan,aktif)
  select v_jenis,v_siswa,tb.id,1300000,
    'Tarif SPP SMA asrama hasil rekonsiliasi: legacy identity sudah kelas 10 PUTRA; label sumber SPP SMP tertinggal setelah kenaikan jenjang.',
    true
  from public.tahun_buku tb
  where tb.nama in ('Tahun 2026','Tahun 2027')
    and not exists (
      select 1 from public.tarif_tagihan tt
      where tt.jenis_id=v_jenis and tt.siswa_id=v_siswa
        and tt.tahun_ajaran_id=tb.id and tt.aktif
    );
end $$;

update migration.legacy_tagihan_snapshot
set disposition='candidate_scheduled'
where snapshot_date=date '2026-09-27'
  and siswa_id='30e19634-0b7b-4f2d-9fa6-e6a70a08e92e'::uuid
  and target_tagihan_id is null
  and disposition='hold_department';

select migration.import_legacy_spp_scheduled(date '2026-09-27',9);