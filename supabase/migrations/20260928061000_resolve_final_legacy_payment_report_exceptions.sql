-- Resolve five stale legacy snapshot rows that disappeared from the final
-- 27 Sep re-extraction/payment reconciliation. They must not be billed again.
do $$
declare
  v_count integer;
  v_total numeric;
begin
  select count(*),sum(remaining)
  into v_count,v_total
  from migration.legacy_tagihan_snapshot
  where snapshot_date=date '2026-09-27'
    and target_tagihan_id is null
    and disposition='hold_payment_report'
    and (
      (siswa_id='9b123d5e-3813-4469-86ca-79387716a1bf'::uuid
       and period_month in (date '2026-07-01',date '2026-08-01',date '2026-09-01'))
      or
      (siswa_id='7cd6f717-65ad-4d47-b4ed-358b0a87d046'::uuid
       and period_month=date '2026-09-01')
      or
      (siswa_id='3ab85cc6-fce0-46ec-a5fe-51647a7f095b'::uuid
       and period_month=date '2026-10-01')
    );

  if v_count<>5 or v_total<>2850000 then
    raise exception 'Payment-report exception set changed: count %, total %',v_count,v_total;
  end if;

  update migration.legacy_tagihan_snapshot
  set disposition='resolved_final_snapshot_cleared',
      imported_at=now()
  where snapshot_date=date '2026-09-27'
    and target_tagihan_id is null
    and disposition='hold_payment_report'
    and (
      (siswa_id='9b123d5e-3813-4469-86ca-79387716a1bf'::uuid
       and period_month in (date '2026-07-01',date '2026-08-01',date '2026-09-01'))
      or
      (siswa_id='7cd6f717-65ad-4d47-b4ed-358b0a87d046'::uuid
       and period_month=date '2026-09-01')
      or
      (siswa_id='3ab85cc6-fce0-46ec-a5fe-51647a7f095b'::uuid
       and period_month=date '2026-10-01')
    );
end $$;