-- Finance review by original service year. Existing years may already be
-- represented in the target opening ledger; no journal is created here.
create or replace view migration.legacy_opening_year_review
with (security_invoker = true)
as
select l.snapshot_date,
       l.siswa_id,
       extract(year from l.period_month)::integer as source_year,
       count(*)::integer as source_bill_count,
       sum(l.gross) as source_gross,
       sum(l.discount) as source_discount,
       sum(l.gross-l.discount-l.remaining) as paid_in_legacy_estimate,
       sum(l.remaining) as proposed_opening_balance,
       array_agg(distinct l.source_name order by l.source_name) as source_fee_names
from migration.legacy_tagihan_snapshot l
where l.disposition='hold_historical'
  and l.remaining>0 and l.gross>=l.discount+l.remaining
group by l.snapshot_date,l.siswa_id,extract(year from l.period_month)::integer;

revoke all on migration.legacy_opening_year_review from public,anon,authenticated;
