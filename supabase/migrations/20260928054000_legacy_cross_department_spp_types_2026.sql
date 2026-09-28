-- Aggregate collection type for historical 2026 SPP that belongs to a
-- student's previous institution. The tagihan stays visible under the student's
-- current institution; its JPI is posted to the original institution.
do $$
declare
  v record;
  v_revenue uuid;
begin
  select id into strict v_revenue
  from public.akun_rekening
  where kode='4101' and aktif and jenis='pendapatan';

  for v in
    with source as (
      select l.siswa_id,s.departemen_id,d.kode as current_dept,
        case
          when upper(l.source_name) like '%MTA%' then 'MTA'
          when upper(l.source_name) like '%SMAITA%' then 'SMA'
          when upper(l.source_name) like '%SMPITA%' then 'SMP'
          when upper(l.source_name) like '%SDITA%' then 'SD'
          when upper(l.source_name) like '%TKITA%' then 'TK'
          else null
        end as source_dept
      from migration.legacy_tagihan_snapshot l
      join public.siswa s on s.id=l.siswa_id and s.status='aktif'
      join public.departemen d on d.id=s.departemen_id
      where l.snapshot_date=date '2026-09-27'
        and l.target_tagihan_id is null
        and l.disposition='hold_historical'
        and l.period_month between date '2026-01-01' and date '2026-06-01'
        and upper(l.source_name) like '%SPP%'
    )
    select distinct d.id as dept_id,d.kode
    from source x
    join public.departemen d on d.id=x.departemen_id
    where x.source_dept is not null
      and x.source_dept<>x.current_dept
  loop
    if not exists (
      select 1 from public.jenis_pembayaran j
      where j.departemen_id=v.dept_id
        and j.nama='SALDO SPP LEMBAGA SEBELUMNYA 2026 '||v.kode
    ) then
      insert into public.jenis_pembayaran
        (nama,nominal,keterangan,aktif,departemen_id,akun_pendapatan_id,tipe,perlu_dimuka)
      values
        ('SALDO SPP LEMBAGA SEBELUMNYA 2026 '||v.kode,null,
         'Khusus migrasi SPP Jan-Jun 2026 dari lembaga sebelumnya. JPI mempertahankan departemen asal; pembayaran piutang mengikuti departemen JPI.',
         true,v.dept_id,v_revenue,'sekali',false);
    end if;
  end loop;
end $$;