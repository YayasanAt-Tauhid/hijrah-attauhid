-- Dedicated aggregate type for 2026 historical SPP exceptions whose
-- source institution still matches the student's current institution.
do $$
declare
  v record;
  v_revenue uuid;
begin
  select id into strict v_revenue
  from public.akun_rekening
  where kode='4101' and aktif and jenis='pendapatan';

  for v in
    select distinct d.id as dept_id,d.kode
    from migration.legacy_tagihan_snapshot l
    join public.siswa s on s.id=l.siswa_id and s.status='aktif'
    join public.departemen d on d.id=s.departemen_id
    where l.snapshot_date=date '2026-09-27'
      and l.target_tagihan_id is null
      and l.disposition='hold_historical'
      and l.period_month between date '2026-01-01' and date '2026-06-01'
      and upper(l.source_name) like '%SPP%'
      and (
        (d.kode='MTA' and upper(l.source_name) like '%MTA%') or
        (d.kode='SMA' and upper(l.source_name) like '%SMAITA%') or
        (d.kode='SMP' and upper(l.source_name) like '%SMPITA%') or
        (d.kode='SD' and upper(l.source_name) like '%SDITA%') or
        (d.kode='TK' and upper(l.source_name) like '%TKITA%')
      )
  loop
    if not exists (
      select 1 from public.jenis_pembayaran j
      where j.departemen_id=v.dept_id
        and j.nama='SALDO SPP HISTORIS 2026 '||v.kode
    ) then
      insert into public.jenis_pembayaran
        (nama,nominal,keterangan,aktif,departemen_id,akun_pendapatan_id,tipe,perlu_dimuka)
      values
        ('SALDO SPP HISTORIS 2026 '||v.kode,null,
         'Khusus migrasi saldo SPP Jan-Jun 2026 yang tidak dapat direkonstruksi sebagai tagihan bulanan normal. Jangan dibuat manual.',
         true,v.dept_id,v_revenue,'sekali',false);
    end if;
  end loop;
end $$;