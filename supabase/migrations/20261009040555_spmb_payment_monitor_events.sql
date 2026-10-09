-- Monitoring only: no changes to tagihan, pembayaran, journals or admission status.
create table public.spmb_payment_monitor_events (
  id bigint generated always as identity primary key,
  siswa_detail_id uuid not null references public.siswa_detail(id),
  tahun_ajaran_id uuid not null references public.tahun_ajaran(id),
  departemen_id uuid not null references public.departemen(id),
  gelombang_id uuid not null references public.spmb_gelombang(id),
  registered_at timestamptz not null,
  jenis text not null check (jenis in ('skema','tindak_lanjut','perpanjangan')),
  skema text check (skema in ('lunas','cicilan')),
  tahap integer check (tahap between 1 and 3),
  tenggat date,
  catatan text not null check (char_length(btrim(catatan)) between 5 and 2000),
  created_by uuid not null references public.users_profile(id),
  created_at timestamptz not null default now(),
  constraint spmb_payment_monitor_event_shape check (
    (jenis = 'skema' and skema is not null and tahap is null and tenggat is null)
    or (jenis = 'tindak_lanjut' and skema is null and tahap is null and tenggat is null)
    or (jenis = 'perpanjangan' and skema is null and tahap is not null and tenggat is not null)
  )
);
create index spmb_payment_monitor_cycle_idx on public.spmb_payment_monitor_events
  (siswa_detail_id,tahun_ajaran_id,departemen_id,gelombang_id,registered_at,id desc);

alter table public.spmb_payment_monitor_events enable row level security;
-- All user access goes through verified server functions and active finance role checks.
revoke all on public.spmb_payment_monitor_events from public, anon, authenticated;
revoke all on sequence public.spmb_payment_monitor_events_id_seq from public, anon, authenticated;
grant select, insert on public.spmb_payment_monitor_events to service_role;
grant usage, select on sequence public.spmb_payment_monitor_events_id_seq to service_role;

create function public.guard_spmb_payment_monitor_history()
returns trigger language plpgsql security invoker set search_path = pg_catalog
as $$
begin
  raise exception 'Riwayat monitoring SPMB tidak boleh diubah atau dihapus';
end;
$$;
revoke all on function public.guard_spmb_payment_monitor_history() from public, anon, authenticated;
create trigger spmb_payment_monitor_history_guard
  before update or delete on public.spmb_payment_monitor_events
  for each row execute function public.guard_spmb_payment_monitor_history();
comment on table public.spmb_payment_monitor_events is
  'Append-only SPMB payment scheme, follow-up and deadline-extension history. No accounting mutations.';
