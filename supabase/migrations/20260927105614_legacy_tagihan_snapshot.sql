create schema if not exists migration;
revoke all on schema migration from public, anon, authenticated;

create table if not exists migration.legacy_tagihan_snapshot (
  source_key text primary key,
  snapshot_date date not null,
  siswa_id uuid not null references public.siswa(id),
  source_name text not null,
  period_month date not null,
  category text not null check (category in ('tertunggak','berjalan','mendatang')),
  gross numeric(14,2) not null check (gross >= 0),
  discount numeric(14,2) not null check (discount >= 0),
  remaining numeric(14,2) not null check (remaining > 0),
  source_ordinal integer not null,
  target_tagihan_id uuid references public.tagihan(id),
  disposition text not null default 'pending',
  imported_at timestamptz not null default now(),
  unique (snapshot_date, siswa_id, source_ordinal)
);

alter table migration.legacy_tagihan_snapshot enable row level security;
revoke all on all tables in schema migration from public, anon, authenticated;
