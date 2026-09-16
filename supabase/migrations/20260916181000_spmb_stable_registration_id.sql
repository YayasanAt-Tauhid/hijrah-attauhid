-- Identitas pendaftaran harus berbeda dari siswa_id. Backfill aman tanpa mengubah status siswa.
alter table public.siswa_detail add column if not exists pendaftaran_id uuid;
update public.siswa_detail set pendaftaran_id=gen_random_uuid() where pendaftaran_id is null and (jenis_pendaftaran is not null or pmb_payment_token is not null or tahun_ajaran_id is not null);
create unique index if not exists idx_siswa_detail_pendaftaran_id on public.siswa_detail(pendaftaran_id) where pendaftaran_id is not null;
comment on column public.siswa_detail.pendaftaran_id is 'ID stabil riwayat pendaftaran SPMB; berbeda dari siswa_id dan digunakan kontrak API integrasi.';