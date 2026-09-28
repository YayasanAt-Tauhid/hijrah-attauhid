-- Dedicated one-time type for collecting pre-2026 receivable opening balances.
-- Account 3101 is used as the opening-equity offset, not current-year revenue.
do $$
declare
  v record;
  v_equity uuid;
begin
  select id into strict v_equity
  from public.akun_rekening
  where kode='3101' and aktif and jenis='ekuitas';

  for v in
    select distinct d.id as dept_id,d.kode
    from migration.legacy_tagihan_snapshot l
    join public.siswa s on s.id=l.siswa_id and s.status='aktif'
    join public.departemen d on d.id=s.departemen_id
    where l.snapshot_date=date '2026-09-27'
      and l.target_tagihan_id is null
      and l.disposition='hold_historical'
      and l.remaining>0
      and l.period_month<date '2026-01-01'
  loop
    if not exists (
      select 1 from public.jenis_pembayaran j
      where j.departemen_id=v.dept_id
        and j.nama='SALDO PIUTANG LAMA '||v.kode
    ) then
      insert into public.jenis_pembayaran
        (nama,nominal,keterangan,aktif,departemen_id,akun_pendapatan_id,tipe,perlu_dimuka)
      values
        ('SALDO PIUTANG LAMA '||v.kode,null,
         'Khusus migrasi saldo piutang sebelum 2026. Jangan dibuat manual. Pembentukan saldo mengkredit Asset Netto (Modal), bukan pendapatan tahun berjalan.',
         true,v.dept_id,v_equity,'sekali',false);
    end if;
  end loop;
end $$;