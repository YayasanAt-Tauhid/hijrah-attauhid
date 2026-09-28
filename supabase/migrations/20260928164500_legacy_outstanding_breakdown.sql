-- Read-only breakdown of legacy outstanding charges for finance UI.
-- Keeps accounting/tagihan structure untouched while exposing the original
-- legacy categories for reconciliation by cashier staff.

create or replace function public.get_legacy_outstanding_breakdown(p_siswa_id uuid)
returns table (
  kode_lama text,
  nama_lama text,
  nominal numeric,
  breakdown_total numeric,
  current_total numeric,
  exact_match boolean
)
language sql
stable
security definer
set search_path = public, migration, pg_temp
as $$
with latest_snapshot as (
  select max(snapshot_date) as snapshot_date
  from migration.legacy_tagihan_snapshot
),
src as (
  select
    case
      when l.source_name ilike 'SPP LAMA SISWA/I SDITA%' then 'BY002'
      when l.source_name ilike 'UANG DAFTAR ULANG KELAS SDITA 2025-2026%' then 'BY009'
      when l.source_name ilike 'SPP SMPITA NON ASRAMA TAHUN AJARAN 2023-2027%' then 'BY765'
      when l.source_name ilike 'UANG PANGKAL SMP NON ASRAMA TH. 2025-2027%' then 'BY955'
      else null
    end as kode_lama,
    regexp_replace(
      l.source_name,
      '[[:space:]]*\([[:space:]]*[^()]*[0-9]{4}[[:space:]]*\)[[:space:]]*$',
      '',
      'i'
    ) as nama_lama,
    l.remaining::numeric as remaining,
    l.target_tagihan_id,
    t.nominal::numeric as current_target_nominal
  from migration.legacy_tagihan_snapshot l
  join latest_snapshot ls on ls.snapshot_date = l.snapshot_date
  join public.tagihan t on t.id = l.target_tagihan_id
  where l.siswa_id = p_siswa_id
    and l.category in ('tertunggak', 'berjalan')
    and t.status = 'belum_bayar'
),
targets as (
  select distinct target_tagihan_id, current_target_nominal
  from src
),
totals as (
  select
    coalesce((select sum(remaining) from src), 0::numeric) as breakdown_total,
    coalesce((select sum(current_target_nominal) from targets), 0::numeric) as current_total
),
grouped as (
  select
    max(kode_lama) as kode_lama,
    nama_lama,
    sum(remaining)::numeric as nominal
  from src
  group by nama_lama
)
select
  g.kode_lama,
  g.nama_lama,
  g.nominal,
  t.breakdown_total,
  t.current_total,
  abs(t.breakdown_total - t.current_total) < 0.01::numeric as exact_match
from grouped g
cross join totals t
order by
  case g.kode_lama
    when 'BY002' then 1
    when 'BY009' then 2
    when 'BY765' then 3
    when 'BY955' then 4
    else 100
  end,
  g.nama_lama;
$$;

revoke all on function public.get_legacy_outstanding_breakdown(uuid) from public;
revoke all on function public.get_legacy_outstanding_breakdown(uuid) from anon;
revoke all on function public.get_legacy_outstanding_breakdown(uuid) from authenticated;
grant execute on function public.get_legacy_outstanding_breakdown(uuid) to service_role;
