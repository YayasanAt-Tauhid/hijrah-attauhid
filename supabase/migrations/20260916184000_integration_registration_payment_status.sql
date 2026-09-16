create or replace function public.integration_registration_payment_status(p_siswa_id uuid, p_departemen_id uuid, p_created_at timestamptz)
returns table(status text, tanggal_bayar date, jumlah numeric, jenis_pembayaran_id uuid, gratis_gelombang_pertama boolean)
language sql
security definer
set search_path = public
stable
as $$
  with cfg as (
    select k.jenis_pembayaran_id
    from public.konfigurasi_pmb k
    where k.departemen_id = p_departemen_id
    limit 1
  ), pay as (
    select p.tanggal_bayar, p.jumlah, p.jenis_id
    from public.pembayaran p, cfg
    where p.siswa_id = p_siswa_id and p.jenis_id = cfg.jenis_pembayaran_id
    order by p.tanggal_bayar desc nulls last
    limit 1
  ), bill as (
    select t.status, t.pembayaran_id, t.jenis_id
    from public.tagihan t, cfg
    where t.siswa_id = p_siswa_id and t.jenis_id = cfg.jenis_pembayaran_id
    order by t.created_at desc
    limit 1
  )
  select
    case
      when public.spmb_is_first_wave_free(p_created_at) then 'gratis_gelombang_pertama'
      when pay.tanggal_bayar is not null then 'dibayar'
      when bill.status is not null then coalesce(bill.status, 'belum_dibayar')
      else 'belum_tercatat'
    end,
    pay.tanggal_bayar,
    pay.jumlah,
    cfg.jenis_pembayaran_id,
    public.spmb_is_first_wave_free(p_created_at)
  from cfg
  left join pay on true
  left join bill on true;
$$;

revoke all on function public.integration_registration_payment_status(uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.integration_registration_payment_status(uuid,uuid,timestamptz) to service_role;
