alter table public.siswa_detail
  add column if not exists spmb_metode_pendaftaran text,
  add column if not exists spmb_metode_diubah_oleh uuid references auth.users(id) on delete set null,
  add column if not exists spmb_metode_diubah_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'siswa_detail_spmb_metode_pendaftaran_check'
      and conrelid = 'public.siswa_detail'::regclass
  ) then
    alter table public.siswa_detail
      add constraint siswa_detail_spmb_metode_pendaftaran_check
      check (spmb_metode_pendaftaran is null or spmb_metode_pendaftaran in ('online', 'offline'));
  end if;
end
$$;

update public.siswa_detail
set spmb_metode_pendaftaran = case
  when spmb_sumber_pendaftaran = 'admin' then 'offline'
  when spmb_sumber_pendaftaran = 'publik' then 'online'
  else null
end
where spmb_gelombang_id is not null
  and spmb_metode_pendaftaran is null;

comment on column public.siswa_detail.spmb_metode_pendaftaran is
  'Metode operasional SPMB: online atau offline. Dapat dikoreksi Admin/TU tanpa mengubah jejak teknis spmb_sumber_pendaftaran.';
comment on column public.siswa_detail.spmb_metode_diubah_oleh is
  'Akun terakhir yang mengoreksi metode pendaftaran SPMB.';
comment on column public.siswa_detail.spmb_metode_diubah_at is
  'Waktu terakhir metode pendaftaran SPMB dikoreksi.';
