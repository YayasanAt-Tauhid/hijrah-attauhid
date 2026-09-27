-- Private reconciliation surface. No invoice or journal is created here.
-- Source amounts remain visible, while the proposed opening receivable is
-- only the unpaid remainder. Refresh the snapshot before cutover.
create or replace view migration.legacy_opening_review
with (security_invoker = true)
as
select l.snapshot_date,
       l.siswa_id,
       count(*)::integer as source_bill_count,
       sum(l.gross) as source_gross,
       sum(l.discount) as source_discount,
       sum(l.gross - l.discount - l.remaining) as paid_in_legacy_estimate,
       sum(l.remaining) as proposed_opening_balance,
       min(l.period_month) as earliest_source_month,
       jsonb_agg(jsonb_build_object(
         'source_key',l.source_key,
         'source_name',l.source_name,
         'period_month',l.period_month,
         'gross',l.gross,
         'discount',l.discount,
         'paid_estimate',l.gross-l.discount-l.remaining,
         'remaining',l.remaining
       ) order by l.period_month,l.source_name,l.source_ordinal) as source_lines
from migration.legacy_tagihan_snapshot l
where l.disposition='hold_historical'
  and l.remaining > 0
  and l.gross >= l.discount + l.remaining
group by l.snapshot_date,l.siswa_id;

revoke all on migration.legacy_opening_review from public, anon, authenticated;
