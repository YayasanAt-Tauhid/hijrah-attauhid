-- Normalize legacy SPP balances into ordinary monthly SPP charges.
--
-- The legacy migration initially grouped several source months into synthetic
-- one-time payment types such as "SALDO SPP LAMA SD". The source snapshot
-- retains the exact original month for every component, so we can safely
-- restore those balances as ordinary monthly SPP charges without changing the
-- total receivable or creating/reversing any accounting journal.
--
-- Accounting rule:
--   * old aggregate rows are cancelled WITHOUT journal reversal;
--   * each replacement monthly row points to the same posted receivable journal;
--   * the sum of replacement rows must equal the old aggregate amount;
--   * no payment row is created or changed by this migration.

create table if not exists migration.legacy_spp_monthly_normalization_20260928 (
  source_key text primary key
    references migration.legacy_tagihan_snapshot(source_key),
  old_tagihan_id uuid not null
    references public.tagihan(id),
  new_tagihan_id uuid not null unique
    references public.tagihan(id),
  siswa_id uuid not null
    references public.siswa(id),
  old_jenis_id uuid not null
    references public.jenis_pembayaran(id),
  new_jenis_id uuid not null
    references public.jenis_pembayaran(id),
  period_month date not null,
  source_remaining numeric not null,
  applied_at timestamptz not null default now()
);

alter table migration.legacy_spp_monthly_normalization_20260928
  enable row level security;

revoke all on table migration.legacy_spp_monthly_normalization_20260928
  from anon, authenticated;

-- Keep the SPP tariff guard strict for ordinary charges. Historical migrated
-- charges are the sole exception because their contractual amount and source
-- period come from the frozen legacy snapshot, not from today's tariff table.
-- A non-null legacy_source_key is accepted only when it exactly matches the
-- student, month and remaining amount in the migration snapshot.
create or replace function public.guard_tagihan_spp_tarif()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_jenis record;
  v_siswa record;
  v_tarif numeric;
  v_bruto numeric;
begin
  select nama, tipe, departemen_id into v_jenis
  from public.jenis_pembayaran where id = new.jenis_id;

  if not found
     or v_jenis.tipe is distinct from 'bulanan'
     or lower(btrim(v_jenis.nama)) !~ '^spp([[:space:]-]|$)'
  then
    return new;
  end if;

  if new.legacy_source_key is not null then
    perform 1
    from migration.legacy_tagihan_snapshot l
    where l.source_key = new.legacy_source_key
      and l.siswa_id = new.siswa_id
      and extract(month from l.period_month)::int is not distinct from new.bulan
      and abs(l.remaining::numeric - new.nominal::numeric) < 0.01;

    if not found then
      raise exception
        'Tagihan SPP legacy tidak cocok dengan snapshot sumber %',
        new.legacy_source_key;
    end if;

    if new.status is distinct from 'belum_bayar'
       or new.jurnal_piutang_id is null
    then
      raise exception
        'Tagihan SPP legacy harus berupa piutang terbuka dengan jurnal asal';
    end if;

    return new;
  end if;

  select nama, departemen_id, angkatan_id into v_siswa
  from public.siswa where id = new.siswa_id;

  if not found then
    raise exception 'Siswa tagihan SPP tidak ditemukan';
  end if;

  if v_jenis.departemen_id is distinct from v_siswa.departemen_id then
    raise exception 'Jenis SPP tidak sesuai lembaga siswa %', v_siswa.nama;
  end if;

  v_tarif := public.get_tarif_siswa(
    new.jenis_id, new.siswa_id, new.kelas_id,
    new.tahun_ajaran_id, v_siswa.angkatan_id
  );

  if v_tarif is null or v_tarif <= 0 then
    raise exception
      'Tarif SPP belum dikonfigurasi untuk %. Tetapkan tarif terlebih dahulu.',
      v_siswa.nama;
  end if;

  v_bruto := coalesce(new.nominal_bruto, new.nominal);
  if round(v_bruto, 2) is distinct from round(v_tarif, 2) then
    raise exception
      'Nominal bruto SPP % tidak sesuai tarif efektif % untuk %',
      v_bruto, v_tarif, v_siswa.nama;
  end if;

  return new;
end;
$function$;

-- Closed-book guard remains strict for ordinary charges. A migrated legacy
-- receivable is not a new economic event: it is only a more granular
-- representation of an already-posted receivable. Allow that representation
-- in a closed source year only when the legacy key exactly matches the frozen
-- snapshot.
create or replace function public.guard_tagihan_insert_tahun_buku_locked()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_nama text;
begin
  if new.legacy_source_key is not null then
    perform 1
    from migration.legacy_tagihan_snapshot l
    where l.source_key = new.legacy_source_key
      and l.siswa_id = new.siswa_id
      and extract(month from l.period_month)::int is not distinct from new.bulan
      and abs(l.remaining::numeric - new.nominal::numeric) < 0.01;

    if not found then
      raise exception
        'Tagihan legacy tidak cocok dengan snapshot sumber %',
        new.legacy_source_key
        using errcode = '55000';
    end if;

    return new;
  end if;

  if new.tahun_ajaran_id is not null
     and public.is_tahun_buku_pendidikan_locked(new.tahun_ajaran_id)
  then
    select nama into v_nama
    from public.tahun_buku
    where id = new.tahun_ajaran_id;

    raise exception
      'Tagihan baru tidak dapat dibuat: Tahun Buku "%" sudah ditutup untuk Unit Pendidikan',
      coalesce(v_nama, new.tahun_ajaran_id::text)
      using errcode = '55000';
  end if;

  return new;
end;
$function$;

create temp table tmp_legacy_spp_monthly_normalization
on commit drop
as
select
  l.source_key,
  l.period_month,
  l.remaining::numeric as source_remaining,
  t.id as old_tagihan_id,
  gen_random_uuid() as new_tagihan_id,
  t.siswa_id,
  t.jenis_id as old_jenis_id,
  std.id as new_jenis_id,
  tb.id as new_tahun_ajaran_id,
  extract(month from l.period_month)::int as new_bulan,
  t.kelas_id,
  t.jurnal_piutang_id,
  t.created_at,
  t.created_by
from public.tagihan t
join public.jenis_pembayaran old_jp
  on old_jp.id = t.jenis_id
join public.departemen d
  on d.id = old_jp.departemen_id
join migration.legacy_tagihan_snapshot l
  on l.target_tagihan_id = t.id
left join public.jenis_pembayaran std
  on std.departemen_id = old_jp.departemen_id
 and upper(std.nama) = upper('SPP ' || d.kode)
 and std.tipe = 'bulanan'
left join public.tahun_buku tb
  on l.period_month between tb.tanggal_mulai and tb.tanggal_selesai
where t.status = 'belum_bayar'
  and upper(old_jp.nama) like 'SALDO SPP%';

do $$
declare
  v_rows integer;
  v_source_total numeric;
  v_old_total numeric;
begin
  select count(*), coalesce(sum(source_remaining), 0)
    into v_rows, v_source_total
  from tmp_legacy_spp_monthly_normalization;

  if v_rows = 0 then
    raise exception 'Normalisasi SPP dibatalkan: tidak ada kandidat tagihan legacy terbuka';
  end if;

  if exists (
    select 1
    from tmp_legacy_spp_monthly_normalization
    where period_month is null
       or new_jenis_id is null
       or new_tahun_ajaran_id is null
       or new_bulan is null
  ) then
    raise exception 'Normalisasi SPP dibatalkan: ada sumber yang tidak dapat dipetakan ke jenis/periode normal';
  end if;

  if exists (
    select 1
    from tmp_legacy_spp_monthly_normalization
    group by siswa_id, new_jenis_id, new_tahun_ajaran_id, new_bulan
    having count(*) > 1
  ) then
    raise exception 'Normalisasi SPP dibatalkan: kandidat menghasilkan duplikasi bulan internal';
  end if;

  if exists (
    select 1
    from tmp_legacy_spp_monthly_normalization x
    join public.tagihan t2
      on t2.siswa_id = x.siswa_id
     and t2.jenis_id = x.new_jenis_id
     and t2.tahun_ajaran_id = x.new_tahun_ajaran_id
     and t2.bulan = x.new_bulan
     and t2.status not in ('dibatalkan', 'dihapusbuku')
  ) then
    raise exception 'Normalisasi SPP dibatalkan: ada tagihan normal yang sudah memakai bulan target';
  end if;

  if exists (
    select 1
    from tmp_legacy_spp_monthly_normalization x
    join public.pembayaran p
      on p.siswa_id = x.siswa_id
     and p.jenis_id = x.new_jenis_id
     and p.tahun_ajaran_id = x.new_tahun_ajaran_id
     and p.bulan = x.new_bulan
  ) then
    raise exception 'Normalisasi SPP dibatalkan: ada pembayaran normal yang sudah memakai bulan target';
  end if;

  if exists (
    select 1
    from (
      select old_tagihan_id, sum(source_remaining)::numeric as source_total
      from tmp_legacy_spp_monthly_normalization
      group by old_tagihan_id
    ) x
    join public.tagihan t on t.id = x.old_tagihan_id
    where abs(x.source_total - t.nominal::numeric) >= 0.01
  ) then
    raise exception 'Normalisasi SPP dibatalkan: total sumber per tagihan tidak sama dengan saldo terbuka';
  end if;

  if exists (
    select 1
    from tmp_legacy_spp_monthly_normalization x
    join public.tagihan t on t.id = x.old_tagihan_id
    where t.pembayaran_id is not null
  ) then
    raise exception 'Normalisasi SPP dibatalkan: ada saldo agregat yang sudah tertaut pembayaran';
  end if;

  select coalesce(sum(t.nominal), 0)
    into v_old_total
  from public.tagihan t
  where t.id in (
    select distinct old_tagihan_id
    from tmp_legacy_spp_monthly_normalization
  );

  if abs(v_source_total - v_old_total) >= 0.01 then
    raise exception
      'Normalisasi SPP dibatalkan: total kandidat (%) berbeda dari total saldo agregat (%)',
      v_source_total, v_old_total;
  end if;
end $$;

insert into public.tagihan (
  id, siswa_id, jenis_id, tahun_ajaran_id, kelas_id, bulan, nominal, status,
  jurnal_piutang_id, pembayaran_id, created_at, created_by, write_off_id,
  dibatalkan_alasan, dibatalkan_at, dibatalkan_oleh, jurnal_pembalik_id,
  jatuh_tempo, nominal_bruto, nominal_diskon, siswa_diskon_id,
  legacy_source_key, legacy_original_gross, legacy_original_discount,
  legacy_paid_amount
)
select
  x.new_tagihan_id, x.siswa_id, x.new_jenis_id, x.new_tahun_ajaran_id,
  x.kelas_id, x.new_bulan, x.source_remaining, 'belum_bayar',
  x.jurnal_piutang_id, null, x.created_at, x.created_by, null,
  null, null, null, null, x.period_month, null, 0, null,
  x.source_key, null, null, null
from tmp_legacy_spp_monthly_normalization x;

insert into migration.legacy_spp_monthly_normalization_20260928 (
  source_key, old_tagihan_id, new_tagihan_id, siswa_id, old_jenis_id,
  new_jenis_id, period_month, source_remaining
)
select
  source_key, old_tagihan_id, new_tagihan_id, siswa_id, old_jenis_id,
  new_jenis_id, period_month, source_remaining
from tmp_legacy_spp_monthly_normalization;

update migration.legacy_tagihan_snapshot l
set target_tagihan_id = x.new_tagihan_id
from tmp_legacy_spp_monthly_normalization x
where l.source_key = x.source_key;

-- Do not rewrite legacy_balance_split_source_20260928: that table is an
-- immutable audit of the preceding split migration. The normalization table
-- above records the new source -> monthly tagihan mapping separately.

update public.tagihan t
set
  status = 'dibatalkan',
  dibatalkan_alasan =
    'Normalisasi migrasi: saldo SPP agregat dipecah menjadi tagihan SPP bulanan sesuai periode sumber; tanpa perubahan total piutang/jurnal',
  dibatalkan_at = now()
where t.id in (
  select distinct old_tagihan_id
  from tmp_legacy_spp_monthly_normalization
);

-- Synthetic legacy SPP types are no longer user-facing payment types after all
-- of their open balances have been converted to ordinary monthly SPP charges.
update public.jenis_pembayaran jp
set aktif = false
where upper(jp.nama) like 'SALDO SPP%'
  and not exists (
    select 1
    from public.tagihan t
    where t.jenis_id = jp.id
      and t.status in ('belum_bayar', 'terjadwal')
  );

do $$
declare
  v_new_rows integer;
  v_new_total numeric;
  v_old_rows integer;
  v_open_old_rows integer;
begin
  select count(*), coalesce(sum(source_remaining), 0)
    into v_new_rows, v_new_total
  from migration.legacy_spp_monthly_normalization_20260928;

  select count(distinct old_tagihan_id)
    into v_old_rows
  from migration.legacy_spp_monthly_normalization_20260928;

  select count(*)
    into v_open_old_rows
  from public.tagihan
  where id in (
    select distinct old_tagihan_id
    from migration.legacy_spp_monthly_normalization_20260928
  )
    and status <> 'dibatalkan';

  if v_new_rows <= 0 or v_old_rows <= 0 or v_open_old_rows <> 0 then
    raise exception 'Verifikasi akhir normalisasi SPP gagal';
  end if;

  if exists (
    select 1
    from migration.legacy_spp_monthly_normalization_20260928 a
    join public.tagihan t on t.id = a.new_tagihan_id
    join public.jenis_pembayaran jp on jp.id = t.jenis_id
    where t.status <> 'belum_bayar'
       or jp.tipe <> 'bulanan'
       or t.bulan <> extract(month from a.period_month)::int
       or abs(t.nominal::numeric - a.source_remaining) >= 0.01
  ) then
    raise exception 'Verifikasi akhir normalisasi SPP gagal: detail tagihan baru tidak konsisten';
  end if;

  if exists (
    select 1
    from migration.legacy_tagihan_snapshot l
    join migration.legacy_spp_monthly_normalization_20260928 a
      on a.source_key = l.source_key
    where l.target_tagihan_id <> a.new_tagihan_id
  ) then
    raise exception 'Verifikasi akhir normalisasi SPP gagal: snapshot belum menunjuk tagihan baru';
  end if;
end $$;