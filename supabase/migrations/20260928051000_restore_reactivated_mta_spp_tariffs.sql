-- Restore per-student SPP tariffs for the five MTA students whose status was
-- normalized from legacy 'keluar' to active. The verified legacy snapshot has
-- exactly 12 equal monthly SPP rows from Jul 2026 through Jun 2027 per student.
do $$
declare
  v record;
  v_jenis uuid;
  v_months integer;
  v_distinct integer;
  v_tarif numeric;
begin
  select id into strict v_jenis
  from public.jenis_pembayaran
  where nama='SPP MTA' and aktif;

  for v in
    select a.siswa_id,s.nama
    from migration.legacy_status_normalization_audit a
    join public.siswa s on s.id=a.siswa_id and s.status='aktif'
    where a.evidence_snapshot_date=date '2026-09-27'
    order by s.nama
  loop
    select count(*),count(distinct l.remaining),min(l.remaining)
    into v_months,v_distinct,v_tarif
    from migration.legacy_tagihan_snapshot l
    where l.snapshot_date=date '2026-09-27'
      and l.siswa_id=v.siswa_id
      and l.period_month between date '2026-07-01' and date '2027-06-01'
      and upper(l.source_name) like '%SPP%';

    if v_months<>12 or v_distinct<>1 or v_tarif<=0 then
      raise exception 'Legacy SPP schedule is not uniform for %: months %, distinct %, tariff %',
        v.nama,v_months,v_distinct,v_tarif;
    end if;

    insert into public.tarif_tagihan
      (jenis_id,siswa_id,tahun_ajaran_id,nominal,keterangan,aktif)
    select v_jenis,v.siswa_id,tb.id,v_tarif,
      'Tarif SPP MTA dipulihkan dari 12 bulan jadwal legacy Jul 2026-Jun 2027 setelah normalisasi status migrasi.',
      true
    from public.tahun_buku tb
    where tb.nama in ('Tahun 2026','Tahun 2027')
      and not exists (
        select 1 from public.tarif_tagihan tt
        where tt.jenis_id=v_jenis
          and tt.siswa_id=v.siswa_id
          and tt.tahun_ajaran_id=tb.id
          and tt.aktif
      );
  end loop;
end $$;