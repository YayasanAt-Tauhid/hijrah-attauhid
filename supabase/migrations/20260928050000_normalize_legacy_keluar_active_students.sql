-- Normalize legacy-imported siswa status. In the current academic model an actual
-- exit uses status pindah/alumni and deactivates kelas_siswa. These five rows are
-- legacy artifacts: they still have an active 2026/2027 class, a September 2026
-- SPP balance, and nine future SPP balances in the verified legacy snapshot.

create table if not exists migration.legacy_status_normalization_audit (
  id uuid primary key default gen_random_uuid(),
  siswa_id uuid not null references public.siswa(id) on delete cascade,
  old_status text not null,
  new_status text not null,
  reason text not null,
  evidence_snapshot_date date not null,
  changed_at timestamptz not null default now()
);

create unique index if not exists legacy_status_normalization_audit_unique
  on migration.legacy_status_normalization_audit(siswa_id,evidence_snapshot_date);

do $$
declare
  v_count integer;
begin
  with candidates as (
    select s.id
    from public.siswa s
    join public.tahun_ajaran ta on ta.aktif
    join public.kelas_siswa ks on ks.siswa_id=s.id
      and ks.tahun_ajaran_id=ta.id and ks.aktif
    where s.status='keluar'
      and exists (
        select 1 from migration.legacy_tagihan_snapshot l
        where l.siswa_id=s.id
          and l.snapshot_date=date '2026-09-27'
          and l.period_month=date '2026-09-01'
          and upper(l.source_name) like '%SPP%'
          and l.remaining>0
      )
      and (
        select count(*) from migration.legacy_tagihan_snapshot l
        where l.siswa_id=s.id
          and l.snapshot_date=date '2026-09-27'
          and l.period_month>date '2026-09-01'
          and upper(l.source_name) like '%SPP%'
          and l.remaining>0
      )=9
      and not exists (
        select 1 from migration.legacy_status_normalization_audit a
        where a.siswa_id=s.id
          and a.evidence_snapshot_date=date '2026-09-27'
      )
  )
  select count(*) into v_count from candidates;

  if v_count<>5 then
    raise exception 'Legacy status normalization candidates changed: %',v_count;
  end if;

  insert into migration.legacy_status_normalization_audit
    (siswa_id,old_status,new_status,reason,evidence_snapshot_date)
  select s.id,'keluar','aktif',
    'Rekonsiliasi migrasi: kelas 2026/2027 masih aktif, SPP September 2026 masih berjalan, dan terdapat 9 SPP mendatang pada snapshot legacy.',
    date '2026-09-27'
  from public.siswa s
  join public.tahun_ajaran ta on ta.aktif
  join public.kelas_siswa ks on ks.siswa_id=s.id
    and ks.tahun_ajaran_id=ta.id and ks.aktif
  where s.status='keluar'
    and exists (
      select 1 from migration.legacy_tagihan_snapshot l
      where l.siswa_id=s.id
        and l.snapshot_date=date '2026-09-27'
        and l.period_month=date '2026-09-01'
        and upper(l.source_name) like '%SPP%'
        and l.remaining>0
    )
    and (
      select count(*) from migration.legacy_tagihan_snapshot l
      where l.siswa_id=s.id
        and l.snapshot_date=date '2026-09-27'
        and l.period_month>date '2026-09-01'
        and upper(l.source_name) like '%SPP%'
        and l.remaining>0
    )=9
    and not exists (
      select 1 from migration.legacy_status_normalization_audit a
      where a.siswa_id=s.id
        and a.evidence_snapshot_date=date '2026-09-27'
    );

  update public.siswa s
  set status='aktif'
  where s.status='keluar'
    and exists (
      select 1
      from public.tahun_ajaran ta
      join public.kelas_siswa ks on ks.tahun_ajaran_id=ta.id
      where ta.aktif and ks.siswa_id=s.id and ks.aktif
    )
    and exists (
      select 1 from migration.legacy_tagihan_snapshot l
      where l.siswa_id=s.id
        and l.snapshot_date=date '2026-09-27'
        and l.period_month=date '2026-09-01'
        and upper(l.source_name) like '%SPP%'
        and l.remaining>0
    )
    and (
      select count(*) from migration.legacy_tagihan_snapshot l
      where l.siswa_id=s.id
        and l.snapshot_date=date '2026-09-27'
        and l.period_month>date '2026-09-01'
        and upper(l.source_name) like '%SPP%'
        and l.remaining>0
    )=9;
end $$;