-- Dedicated one-time fee types for legacy July 2026 balances.
do $$
declare v record;
begin
  for v in
    select d.id dept_id,d.kode,m.fee,m.label,m.account_code
    from public.departemen d
    cross join (values
      ('buku','BUKU DINIYAH','4304'),
      ('daftar_ulang','UANG DAFTAR ULANG','4302'),
      ('seragam','UANG SERAGAM OLAHRAGA','4301')
    ) m(fee,label,account_code)
    where (m.fee<>'seragam' or d.kode='SD')
      and exists(
        select 1 from migration.legacy_tagihan_snapshot l
        join public.siswa s on s.id=l.siswa_id and s.departemen_id=d.id
        where l.snapshot_date=date '2026-09-27'
          and l.period_month=date '2026-07-01'
          and l.disposition in ('hold_historical','hold_current')
          and l.gross=l.remaining and l.discount=0
          and upper(l.source_name) like '%'||d.kode||'%'
          and ((m.fee='buku' and l.source_name ilike '%BUKU DINIYAH%')
            or (m.fee='daftar_ulang' and l.source_name ilike 'UANG DAFTAR ULANG KELAS %')
            or (m.fee='seragam' and l.source_name ilike 'UANG SERAGAM OLAHRAGA %'))
      )
  loop
    if exists(select 1 from public.jenis_pembayaran
      where departemen_id=v.dept_id and nama=v.label||' '||v.kode) then
      raise exception 'Fee type already exists: % %',v.label,v.kode;
    end if;
    insert into public.jenis_pembayaran
      (nama,nominal,keterangan,aktif,departemen_id,akun_pendapatan_id,tipe,perlu_dimuka)
    select v.label||' '||v.kode,null,
      'Tagihan satu kali untuk migrasi saldo lama; nominal ditetapkan per siswa.',
      true,v.dept_id,a.id,'sekali',false
    from public.akun_rekening a
    where a.kode=v.account_code and a.aktif and a.jenis='pendapatan';
    if not found then raise exception 'Revenue account unavailable: %',v.account_code; end if;
  end loop;
end $$;