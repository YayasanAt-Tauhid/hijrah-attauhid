-- One-time legacy uang pangkal fee per institution; source cash journals use 4307.
do $$
declare v record;
begin
  for v in select id,kode from public.departemen
    where kode in ('TK','SD','SMP','SMA','MTA')
  loop
    if exists(select 1 from public.jenis_pembayaran
      where departemen_id=v.id and nama='UANG PANGKAL '||v.kode) then
      raise exception 'Uang pangkal type already exists: %',v.kode;
    end if;
    insert into public.jenis_pembayaran
      (nama,nominal,keterangan,aktif,departemen_id,akun_pendapatan_id,tipe,perlu_dimuka)
    select 'UANG PANGKAL '||v.kode,null,
      'Tagihan satu kali untuk migrasi saldo lama; nominal ditetapkan per siswa.',
      true,v.id,a.id,'sekali',false
    from public.akun_rekening a
    where a.kode='4307' and a.aktif and a.jenis='pendapatan';
    if not found then raise exception 'Revenue account 4307 unavailable'; end if;
  end loop;
end $$;