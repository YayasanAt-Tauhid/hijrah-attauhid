-- Resolve Afifah Nahda Syafa's legacy identity exception.
-- A dedicated retry extraction matched her alternate legacy identity and class 5D
-- to the same Hijrah student. The public student identity is not modified here.
do $$
declare
  v_siswa constant uuid := '97123dd9-e739-4a9e-9241-b1833c1e0858'::uuid;
  v_count integer;
  v_tarif_count integer;
  v_dept text;
  v_kelas text;
begin
  select d.kode,k.nama into strict v_dept,v_kelas
  from public.siswa s
  join public.departemen d on d.id=s.departemen_id
  join public.tahun_ajaran ta on ta.aktif
  join public.kelas_siswa ks on ks.siswa_id=s.id
    and ks.tahun_ajaran_id=ta.id and ks.aktif
  join public.kelas k on k.id=ks.kelas_id
  where s.id=v_siswa and s.status='aktif';

  if v_dept<>'SD' or v_kelas<>'5D' then
    raise exception 'Afifah placement changed: % %',v_dept,v_kelas;
  end if;

  select count(*) into v_count
  from migration.legacy_tagihan_snapshot
  where snapshot_date=date '2026-09-27'
    and siswa_id=v_siswa
    and target_tagihan_id is null
    and disposition='hold_identity_mismatch'
    and period_month between date '2026-10-01' and date '2027-06-01'
    and gross=400000 and discount=0 and remaining=400000;

  if v_count<>9 then
    raise exception 'Afifah source rows changed: %',v_count;
  end if;

  select count(*) into v_tarif_count
  from public.tarif_tagihan tt
  join public.jenis_pembayaran jp on jp.id=tt.jenis_id and jp.nama='SPP SD'
  join public.tahun_buku tb on tb.id=tt.tahun_ajaran_id
  where tt.siswa_id=v_siswa and tt.aktif
    and tb.nama in ('Tahun 2026','Tahun 2027')
    and tt.nominal=400000;

  if v_tarif_count<>2 then
    raise exception 'Afifah tariff verification failed: %',v_tarif_count;
  end if;
end $$;

update migration.legacy_tagihan_snapshot
set disposition='candidate_scheduled'
where snapshot_date=date '2026-09-27'
  and siswa_id='97123dd9-e739-4a9e-9241-b1833c1e0858'::uuid
  and target_tagihan_id is null
  and disposition='hold_identity_mismatch';

select migration.import_legacy_spp_scheduled(date '2026-09-27',9);