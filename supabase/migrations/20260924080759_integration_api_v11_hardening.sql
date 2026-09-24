-- Integration API v1.1 hardening: monitoring, granular scopes support, and async webhook delivery.
-- Additive only: existing API tokens, scopes, and v1 contracts remain valid.

create extension if not exists pg_net;
create extension if not exists pg_cron with schema pg_catalog;

-- pg_net lives in the Supabase-managed net schema. Keep that schema out of Data API Exposed schemas.

create or replace function public.integration_usage_summary(p_integration_id uuid)
returns table(
  requests_24h bigint,
  errors_24h bigint,
  requests_7d bigint,
  errors_7d bigint,
  avg_duration_ms_24h numeric,
  last_request_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*) filter (where u.created_at >= now() - interval '24 hours')::bigint,
    count(*) filter (where u.created_at >= now() - interval '24 hours' and u.status >= 400)::bigint,
    count(*) filter (where u.created_at >= now() - interval '7 days')::bigint,
    count(*) filter (where u.created_at >= now() - interval '7 days' and u.status >= 400)::bigint,
    round(avg(u.duration_ms) filter (where u.created_at >= now() - interval '24 hours'), 1),
    max(u.created_at)
  from public.integration_api_usage u
  where u.integration_id = p_integration_id
$$;

revoke all on function public.integration_usage_summary(uuid) from public, anon, authenticated;
grant execute on function public.integration_usage_summary(uuid) to service_role;

create table if not exists public.integration_webhooks (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null unique references public.integration_apps(id) on delete cascade,
  url text not null check (url ~* '^https://[^[:space:]]+$'),
  active boolean not null default true,
  event_types text[] not null default array['pendaftaran','siswa','kelas','dokumen']::text[],
  secret_id uuid not null,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_webhooks_event_types_chk check (
    cardinality(event_types) > 0
    and event_types <@ array['pendaftaran','siswa','kelas','dokumen']::text[]
  )
);

create table if not exists public.integration_webhook_outbox (
  id bigint generated always as identity primary key,
  webhook_id uuid not null references public.integration_webhooks(id) on delete cascade,
  event_id text not null,
  change_seq bigint references public.integration_change_log(seq) on delete set null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending','inflight','retry','delivered','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  request_id bigint,
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  last_http_status integer,
  last_error text,
  created_at timestamptz not null default now(),
  unique(webhook_id, event_id)
);

create index if not exists idx_integration_webhook_outbox_due
  on public.integration_webhook_outbox(status, next_attempt_at, id)
  where status in ('pending','retry');
create index if not exists idx_integration_webhook_outbox_request
  on public.integration_webhook_outbox(request_id)
  where request_id is not null;

alter table public.integration_webhooks enable row level security;
alter table public.integration_webhook_outbox enable row level security;
revoke all on public.integration_webhooks, public.integration_webhook_outbox from anon, authenticated;

create or replace function public.integration_configure_webhook(
  p_integration_id uuid,
  p_url text,
  p_event_types text[],
  p_active boolean default true,
  p_rotate_secret boolean default false
)
returns table(webhook_id uuid, signing_secret text)
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_id uuid;
  v_secret_id uuid;
  v_secret text := null;
  v_events text[] := coalesce(p_event_types, array['pendaftaran','siswa','kelas','dokumen']::text[]);
  v_name text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.integration_apps where id = p_integration_id) then
    raise exception 'integrasi tidak ditemukan';
  end if;
  if p_url is null or p_url !~* '^https://[^[:space:]]+$' then
    raise exception 'webhook wajib menggunakan HTTPS';
  end if;
  if cardinality(v_events) = 0
     or not (v_events <@ array['pendaftaran','siswa','kelas','dokumen']::text[]) then
    raise exception 'event webhook tidak valid';
  end if;

  select w.id, w.secret_id into v_id, v_secret_id
  from public.integration_webhooks w
  where w.integration_id = p_integration_id;

  if v_id is null then
    v_secret := 'hwh_' || encode(extensions.gen_random_bytes(32), 'hex');
    v_name := 'hijrah_integration_webhook_' || replace(p_integration_id::text, '-', '_');
    v_secret_id := vault.create_secret(
      v_secret,
      v_name,
      'Signing secret webhook Integration API Hijrah'
    );
    insert into public.integration_webhooks(integration_id,url,active,event_types,secret_id)
    values(p_integration_id,p_url,p_active,v_events,v_secret_id)
    returning id into v_id;
  else
    if p_rotate_secret then
      v_secret := 'hwh_' || encode(extensions.gen_random_bytes(32), 'hex');
      perform vault.update_secret(v_secret_id, v_secret);
    end if;
    update public.integration_webhooks
    set url=p_url, active=p_active, event_types=v_events, updated_at=now()
    where id=v_id;
  end if;

  return query select v_id, v_secret;
end
$$;

revoke all on function public.integration_configure_webhook(uuid,text,text[],boolean,boolean)
  from public, anon, authenticated;
grant execute on function public.integration_configure_webhook(uuid,text,text[],boolean,boolean)
  to service_role;

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

drop trigger if exists trg_integration_webhook_enqueue on public.integration_change_log;
create trigger trg_integration_webhook_enqueue
after insert on public.integration_change_log
for each row execute function public.integration_webhook_enqueue_change();

create or replace function public.integration_webhook_reconcile()
returns integer
language plpgsql
security definer
set search_path = public, net
as $$
declare
  r record;
  v_done integer := 0;
  v_retry_seconds integer;
  v_message text;
begin
  for r in
    select
      o.id, o.webhook_id, o.attempts, o.last_attempt_at, o.request_id,
      h.status_code, h.timed_out, h.error_msg
    from public.integration_webhook_outbox o
    left join lateral (
      select x.status_code, x.timed_out, x.error_msg
      from net._http_response x
      where x.id=o.request_id
      order by x.created desc
      limit 1
    ) h on true
    where o.status='inflight'
    order by o.id
    limit 500
    for update of o skip locked
  loop
    if r.status_code between 200 and 299 and coalesce(r.timed_out,false)=false and r.error_msg is null then
      update public.integration_webhook_outbox
      set status='delivered', delivered_at=now(), last_http_status=r.status_code, last_error=null
      where id=r.id;
      update public.integration_webhooks
      set last_success_at=now(), last_error=null, updated_at=now()
      where id=r.webhook_id;
      v_done := v_done + 1;
    elsif r.status_code is not null or coalesce(r.timed_out,false) or r.error_msg is not null
          or r.last_attempt_at < now()-interval '10 minutes' then
      v_message := coalesce(r.error_msg, case when r.timed_out then 'timeout' else 'HTTP '||coalesce(r.status_code::text,'tanpa respons') end);
      if r.attempts >= 8 then
        update public.integration_webhook_outbox
        set status='failed', last_http_status=r.status_code, last_error=v_message
        where id=r.id;
      else
        v_retry_seconds := least(3600, (15 * power(2, greatest(r.attempts-1,0)))::integer);
        update public.integration_webhook_outbox
        set status='retry', request_id=null, next_attempt_at=now()+make_interval(secs=>v_retry_seconds),
            last_http_status=r.status_code, last_error=v_message
        where id=r.id;
      end if;
      update public.integration_webhooks
      set last_failure_at=now(), last_error=v_message, updated_at=now()
      where id=r.webhook_id;
      v_done := v_done + 1;
    end if;
  end loop;
  return v_done;
end
$$;

create or replace function public.integration_webhook_dispatch(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = public, net, extensions, vault
as $$
declare
  r record;
  v_secret text;
  v_signature text;
  v_request_id bigint;
  v_count integer := 0;
begin
  for r in
    select o.id,o.webhook_id,o.event_id,o.payload,w.url,w.secret_id
    from public.integration_webhook_outbox o
    join public.integration_webhooks w on w.id=o.webhook_id
    join public.integration_apps a on a.id=w.integration_id
    where o.status in ('pending','retry')
      and o.next_attempt_at <= now()
      and w.active and a.active
    order by o.id
    limit greatest(1,least(coalesce(p_limit,100),500))
    for update of o skip locked
  loop
    select d.decrypted_secret into v_secret
    from vault.decrypted_secrets d
    where d.id=r.secret_id;

    if v_secret is null then
      update public.integration_webhook_outbox
      set status='failed', last_error='signing secret tidak tersedia'
      where id=r.id;
      continue;
    end if;

    v_signature := encode(extensions.hmac(r.payload::text, v_secret, 'sha256'),'hex');
    begin
      v_request_id := net.http_post(
        url := r.url,
        body := r.payload,
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'User-Agent','Hijrah-Integration-Webhook/1.1',
          'X-Hijrah-Signature','sha256='||v_signature,
          'X-Hijrah-Event-ID',r.event_id,
          'X-Hijrah-API-Version','1.1'
        ),
        timeout_milliseconds := 5000
      );
      update public.integration_webhook_outbox
      set status='inflight', attempts=attempts+1, request_id=v_request_id,
          last_attempt_at=now(), last_error=null
      where id=r.id;
      v_count := v_count + 1;
    exception when others then
      update public.integration_webhook_outbox
      set status='retry', attempts=attempts+1,
          next_attempt_at=now()+interval '1 minute', last_error='gagal mengantre request webhook'
      where id=r.id;
    end;
  end loop;
  return v_count;
end
$$;

create or replace function public.integration_webhook_tick()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reconciled integer;
  v_dispatched integer;
begin
  v_reconciled := public.integration_webhook_reconcile();
  v_dispatched := public.integration_webhook_dispatch(100);
  return coalesce(v_reconciled,0)+coalesce(v_dispatched,0);
end
$$;

create or replace function public.integration_enqueue_webhook_test(p_integration_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_webhook uuid;
  v_event_id text := 'test_' || gen_random_uuid()::text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;
  select w.id into v_webhook
  from public.integration_webhooks w
  where w.integration_id=p_integration_id and w.active;
  if v_webhook is null then
    raise exception 'webhook aktif tidak ditemukan';
  end if;
  insert into public.integration_webhook_outbox(webhook_id,event_id,payload)
  values(
    v_webhook,
    v_event_id,
    jsonb_build_object(
      'event_id',v_event_id,
      'type','integration.test',
      'api_version','1.1',
      'changed_at',now()
    )
  );
  perform public.integration_webhook_dispatch(20);
  return v_event_id;
end
$$;

revoke all on function public.integration_webhook_reconcile() from public, anon, authenticated;
revoke all on function public.integration_webhook_dispatch(integer) from public, anon, authenticated;
revoke all on function public.integration_webhook_tick() from public, anon, authenticated;
revoke all on function public.integration_enqueue_webhook_test(uuid) from public, anon, authenticated;
grant execute on function public.integration_webhook_reconcile() to postgres, service_role;
grant execute on function public.integration_webhook_dispatch(integer) to postgres, service_role;
grant execute on function public.integration_webhook_tick() to postgres, service_role;
grant execute on function public.integration_enqueue_webhook_test(uuid) to service_role;

do $$
begin
  perform cron.unschedule('integration-webhook-v1');
exception when others then
  null;
end
$$;

select cron.schedule(
  'integration-webhook-v1',
  '* * * * *',
  'select public.integration_webhook_tick();'
);
