-- Run only against a disposable PostgreSQL fixture containing the migration.
do $$
begin
  if current_setting('test.spmb_monitor_fixture', true) is distinct from 'yes' then
    raise exception 'Only a disposable spmb_monitor_fixture may run this test';
  end if;
end $$;
begin;
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.spmb_payment_monitor_events'::regclass) then
    raise exception 'RLS not enabled';
  end if;
  if has_table_privilege('anon','public.spmb_payment_monitor_events','SELECT')
    or has_table_privilege('authenticated','public.spmb_payment_monitor_events','SELECT')
    or has_table_privilege('authenticated','public.spmb_payment_monitor_events','INSERT') then
    raise exception 'Direct user access exposed';
  end if;
  if has_function_privilege('anon','public.guard_spmb_payment_monitor_history()','EXECUTE') then
    raise exception 'Trigger function exposed';
  end if;
end $$;
set local role service_role;
insert into public.spmb_payment_monitor_events
  (siswa_detail_id,tahun_ajaran_id,departemen_id,gelombang_id,registered_at,jenis,skema,catatan,created_by)
values
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',
   '2026-09-25T00:00:00Z','skema','cicilan','Sesuai surat orang tua','00000000-0000-4000-8000-000000000001');
insert into public.spmb_payment_monitor_events
  (siswa_detail_id,tahun_ajaran_id,departemen_id,gelombang_id,registered_at,jenis,tahap,tenggat,catatan,created_by)
values
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',
   '2026-09-25T00:00:00Z','perpanjangan',1,'2026-10-30','Disetujui oleh keuangan','00000000-0000-4000-8000-000000000001');
reset role;
do $$
begin
  begin
    update public.spmb_payment_monitor_events set catatan = 'Mengubah histori';
    raise exception 'UPDATE unexpectedly allowed';
  exception when raise_exception then
    if sqlerrm not like 'Riwayat monitoring%' then raise; end if;
  end;
  begin
    delete from public.spmb_payment_monitor_events;
    raise exception 'DELETE unexpectedly allowed';
  exception when raise_exception then
    if sqlerrm not like 'Riwayat monitoring%' then raise; end if;
  end;
  begin
    insert into public.spmb_payment_monitor_events
      (siswa_detail_id,tahun_ajaran_id,departemen_id,gelombang_id,registered_at,jenis,catatan,created_by)
    values
      ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',
       '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',
       now(),'skema','Skema tanpa pilihan','00000000-0000-4000-8000-000000000001');
    raise exception 'Invalid scheme unexpectedly allowed';
  exception when check_violation then null;
  end;
  if (select count(*) from public.spmb_payment_monitor_events) <> 2 then
    raise exception 'History count changed';
  end if;
end $$;
set local role authenticated;
do $$
begin
  begin
    perform count(*) from public.spmb_payment_monitor_events;
    raise exception 'Authenticated read unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
select 'SPMB monitor fixture: grants, RLS, insert, constraints, immutable audit passed' as result;
