-- API Integrasi v1: kredensial per aplikasi, audit, rate limit terdistribusi, dan change log sinkronisasi.
-- Tidak mengubah RLS tabel akademik. Semua tabel di bawah hanya diakses server service-role.
create table if not exists public.integration_apps (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  active boolean not null default true,
  scopes text[] not null default '{}',
  department_ids uuid[] not null default '{}',
  academic_year_ids uuid[] not null default '{}',
  expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists public.integration_tokens (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integration_apps(id) on delete cascade,
  token_prefix text not null,
  token_hash text not null unique,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists idx_integration_tokens_prefix on public.integration_tokens(token_prefix);
create index if not exists idx_integration_tokens_integration on public.integration_tokens(integration_id) where revoked_at is null;

create table if not exists public.integration_audit_log (
  id bigint generated always as identity primary key,
  integration_id uuid references public.integration_apps(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_integration_audit_integration_created on public.integration_audit_log(integration_id, created_at desc);

create table if not exists public.integration_api_usage (
  id bigint generated always as identity primary key,
  integration_id uuid references public.integration_apps(id) on delete set null,
  route text not null,
  request_id uuid not null,
  status integer not null,
  duration_ms integer not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_integration_usage_integration_created on public.integration_api_usage(integration_id, created_at desc);

create table if not exists public.integration_rate_windows (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key(bucket, window_start)
);

create or replace function public.integration_rate_limit_hit(p_bucket text, p_limit integer, p_window_seconds integer)
returns table(allowed boolean, remaining integer, retry_after integer)
language plpgsql security definer set search_path=public as $$
declare
  v_start timestamptz;
  v_hits integer;
begin
  v_start := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);
  insert into public.integration_rate_windows(bucket, window_start, hits)
  values (p_bucket, v_start, 1)
  on conflict (bucket, window_start) do update set hits = public.integration_rate_windows.hits + 1
  returning hits into v_hits;
  return query select v_hits <= p_limit, greatest(p_limit-v_hits,0), greatest(1, ceil(extract(epoch from (v_start + make_interval(secs=>p_window_seconds) - clock_timestamp())))::integer);
end $$;
revoke all on function public.integration_rate_limit_hit(text,integer,integer) from public, anon, authenticated;

create table if not exists public.integration_change_log (
  seq bigint generated always as identity primary key,
  object_type text not null check (object_type in ('pendaftaran','siswa','kelas','dokumen')),
  object_id uuid not null,
  change_type text not null check (change_type in ('upsert','delete')),
  department_id uuid,
  academic_year_id uuid,
  previous_department_id uuid,
  previous_academic_year_id uuid,
  changed_at timestamptz not null default clock_timestamp()
);
create index if not exists idx_integration_change_object on public.integration_change_log(object_type, seq);
create index if not exists idx_integration_change_scope on public.integration_change_log(department_id, academic_year_id, seq);

-- Generic change capture. Payload bisnis tidak disimpan di log agar PII tidak diduplikasi.
create or replace function public.integration_capture_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_new jsonb := case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_old jsonb := case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_id uuid;
  v_student uuid;
  v_class uuid;
  v_type text;
  v_dept uuid;
  v_year uuid;
  v_prev_dept uuid;
  v_prev_year uuid;
begin
  if tg_table_name='siswa' then
    v_type := case when coalesce(v_new->>'status',v_old->>'status')='calon' then 'pendaftaran' else 'siswa' end;
    v_id := coalesce((v_new->>'id')::uuid,(v_old->>'id')::uuid);
    v_dept := nullif(v_new->>'departemen_id','')::uuid;
    v_prev_dept := nullif(v_old->>'departemen_id','')::uuid;
  elsif tg_table_name='siswa_detail' then
    v_student := coalesce(nullif(v_new->>'siswa_id','')::uuid,nullif(v_old->>'siswa_id','')::uuid);
    v_id := v_student;
    select case when s.status='calon' then 'pendaftaran' else 'siswa' end, s.departemen_id into v_type,v_dept from public.siswa s where s.id=v_student;
    v_year := nullif(v_new->>'tahun_ajaran_id','')::uuid;
    v_prev_year := nullif(v_old->>'tahun_ajaran_id','')::uuid;
  elsif tg_table_name='kelas' then
    v_type := 'kelas'; v_id := coalesce((v_new->>'id')::uuid,(v_old->>'id')::uuid);
    v_dept := nullif(v_new->>'departemen_id','')::uuid; v_prev_dept := nullif(v_old->>'departemen_id','')::uuid;
  elsif tg_table_name='kelas_siswa' then
    v_student := coalesce(nullif(v_new->>'siswa_id','')::uuid,nullif(v_old->>'siswa_id','')::uuid);
    v_class := coalesce(nullif(v_new->>'kelas_id','')::uuid,nullif(v_old->>'kelas_id','')::uuid);
    v_year := nullif(v_new->>'tahun_ajaran_id','')::uuid; v_prev_year := nullif(v_old->>'tahun_ajaran_id','')::uuid;
    if v_student is not null then
      select s.departemen_id into v_dept from public.siswa s where s.id=v_student;
      insert into public.integration_change_log(object_type,object_id,change_type,department_id,academic_year_id,previous_academic_year_id)
      values('siswa',v_student,'upsert',v_dept,v_year,v_prev_year);
    end if;
    if v_class is not null then
      select k.departemen_id into v_dept from public.kelas k where k.id=v_class;
      insert into public.integration_change_log(object_type,object_id,change_type,department_id,academic_year_id,previous_academic_year_id)
      values('kelas',v_class,'upsert',v_dept,v_year,v_prev_year);
    end if;
    return coalesce(new,old);
  end if;
  if v_type is not null and v_id is not null then
    insert into public.integration_change_log(object_type,object_id,change_type,department_id,academic_year_id,previous_department_id,previous_academic_year_id)
    values(v_type,v_id,case when tg_op='DELETE' then 'delete' else 'upsert' end,v_dept,v_year,v_prev_dept,v_prev_year);
    -- Dokumen mengikuti siswa_detail; consumer membandingkan metadata dokumen berdasarkan versi seq.
    if tg_table_name='siswa_detail' and (v_new->'dokumen_kk_path' is distinct from v_old->'dokumen_kk_path' or v_new->'dokumen_akta_path' is distinct from v_old->'dokumen_akta_path' or v_new->'dokumen_rapor_path' is distinct from v_old->'dokumen_rapor_path' or v_new->'dokumen_ijazah_path' is distinct from v_old->'dokumen_ijazah_path') then
      insert into public.integration_change_log(object_type,object_id,change_type,department_id,academic_year_id)
      values('dokumen',v_id,'upsert',v_dept,v_year);
    end if;
  end if;
  return coalesce(new,old);
end $$;
revoke all on function public.integration_capture_change() from public, anon, authenticated;

drop trigger if exists trg_integration_change_siswa on public.siswa;
create trigger trg_integration_change_siswa after insert or update or delete on public.siswa for each row execute function public.integration_capture_change();
drop trigger if exists trg_integration_change_siswa_detail on public.siswa_detail;
create trigger trg_integration_change_siswa_detail after insert or update or delete on public.siswa_detail for each row execute function public.integration_capture_change();
drop trigger if exists trg_integration_change_kelas on public.kelas;
create trigger trg_integration_change_kelas after insert or update or delete on public.kelas for each row execute function public.integration_capture_change();
drop trigger if exists trg_integration_change_kelas_siswa on public.kelas_siswa;
create trigger trg_integration_change_kelas_siswa after insert or update or delete on public.kelas_siswa for each row execute function public.integration_capture_change();

alter table public.integration_apps enable row level security;
alter table public.integration_tokens enable row level security;
alter table public.integration_audit_log enable row level security;
alter table public.integration_api_usage enable row level security;
alter table public.integration_rate_windows enable row level security;
alter table public.integration_change_log enable row level security;
revoke all on public.integration_apps, public.integration_tokens, public.integration_audit_log, public.integration_api_usage, public.integration_rate_windows, public.integration_change_log from anon, authenticated;

comment on table public.integration_change_log is 'Change log API v1. Retensi minimum operasional 90 hari; cleanup harus mempertahankan checkpoint aktif atau memaksa resync.';