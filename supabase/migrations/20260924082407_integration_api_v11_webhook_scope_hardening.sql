-- Follow-up for production databases that already applied the v1.1 base migration.
-- Document-change webhooks require both registration read and document read scopes.
create or replace function public.integration_webhook_enqueue_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id text := 'chg_' || new.seq::text;
begin
  insert into public.integration_webhook_outbox(webhook_id,event_id,change_seq,payload)
  select
    w.id,
    v_event_id,
    new.seq,
    jsonb_build_object(
      'event_id', v_event_id,
      'type', 'integration.change',
      'api_version', '1.1',
      'object_type', new.object_type,
      'object_id', new.object_id,
      'change', new.change_type,
      'version', new.seq,
      'changed_at', new.changed_at
    )
  from public.integration_webhooks w
  join public.integration_apps a on a.id=w.integration_id
  where w.active
    and a.active
    and new.object_type = any(w.event_types)
    and (
      (new.object_type='pendaftaran' and 'pendaftaran:read'=any(a.scopes))
      or (new.object_type='dokumen' and 'pendaftaran:read'=any(a.scopes) and 'pendaftaran:documents:read'=any(a.scopes))
      or (new.object_type='siswa' and 'siswa:read'=any(a.scopes))
      or (new.object_type='kelas' and 'kelas:read'=any(a.scopes))
    )
    and (
      cardinality(a.department_ids)=0
      or new.department_id=any(a.department_ids)
      or new.previous_department_id=any(a.department_ids)
    )
    and (
      cardinality(a.academic_year_ids)=0
      or new.academic_year_id=any(a.academic_year_ids)
      or new.previous_academic_year_id=any(a.academic_year_ids)
    )
  on conflict(webhook_id,event_id) do nothing;
  return new;
end
$$;

revoke all on function public.integration_webhook_enqueue_change() from public, anon, authenticated;
