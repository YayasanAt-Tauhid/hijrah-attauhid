-- One SPP master per school. Individual tuition is defined in tarif_tagihan.
insert into public.jenis_pembayaran
  (nama, nominal, keterangan, aktif, departemen_id, akun_pendapatan_id,
   tipe, akun_dimuka_id, perlu_dimuka, hari_jatuh_tempo, akun_potongan_id)
select 'SPP ' || d.kode, 0,
  'SPP per siswa; tarif ditetapkan per siswa. Jadwal migrasi aplikasi lama.',
  true, d.id, pendapatan.id, 'bulanan', dimuka.id, true, 10, potongan.id
from public.departemen d
cross join lateral (select id from public.akun_rekening where kode='4101' limit 1) pendapatan
cross join lateral (select id from public.akun_rekening where kode='2111' limit 1) dimuka
cross join lateral (select id from public.akun_rekening where kode='4601' limit 1) potongan
where d.kode in ('TK','SMP','SMA','MTA')
  and not exists (
    select 1 from public.jenis_pembayaran j
    where j.departemen_id=d.id and j.aktif=true and j.tipe='bulanan'
      and lower(btrim(j.nama)) ~ '^spp([[:space:]-]|$)'
  )
on conflict do nothing;

update public.jenis_pembayaran
set hari_jatuh_tempo=10
where nama='SPP SD' and hari_jatuh_tempo is distinct from 10;

-- Daycare is a separate service, not another SPP master for TK.
insert into public.jenis_pembayaran
  (nama, nominal, keterangan, aktif, departemen_id, akun_pendapatan_id,
   tipe, akun_dimuka_id, perlu_dimuka, hari_jatuh_tempo, akun_potongan_id)
select 'DAYCARE TK', 0, 'Biaya daycare terpisah dari SPP TK.',
  true, d.id, pendapatan.id, 'bulanan', dimuka.id, true, 10, potongan.id
from public.departemen d
cross join lateral (select id from public.akun_rekening where kode='4106' limit 1) pendapatan
cross join lateral (select id from public.akun_rekening where kode='2111' limit 1) dimuka
cross join lateral (select id from public.akun_rekening where kode='4601' limit 1) potongan
where d.kode='TK'
  and not exists (
    select 1 from public.jenis_pembayaran j
    where j.departemen_id=d.id and j.nama='DAYCARE TK'
  );
