-- Split aggregated legacy balances by original charge type / source department.
-- Also reclassify cross-department 2026 carry-over SPP balances to their source department.
-- Accounting amounts and posted JPI entries are preserved.

create table if not exists migration.legacy_balance_split_target_20260928 (
  old_tagihan_id uuid primary key,
  siswa_id uuid not null,
  old_jenis_id uuid not null,
  old_nominal numeric not null,
  old_status text not null,
  old_jurnal_piutang_id uuid,
  old_jurnal_keterangan text,
  old_dibatalkan_alasan text,
  old_dibatalkan_at timestamptz,
  old_dibatalkan_oleh uuid,
  applied_at timestamptz not null default now()
);

create table if not exists migration.legacy_balance_split_row_20260928 (
  new_tagihan_id uuid primary key,
  old_tagihan_id uuid not null,
  siswa_id uuid not null,
  new_jenis_id uuid not null,
  new_jenis_nama text not null,
  nominal numeric not null,
  source_groups jsonb not null,
  applied_at timestamptz not null default now()
);

create table if not exists migration.legacy_balance_split_source_20260928 (
  source_key text primary key,
  old_tagihan_id uuid not null,
  new_tagihan_id uuid not null,
  applied_at timestamptz not null default now()
);

create table if not exists migration.legacy_crossdept_spp_reclass_20260928 (
  tagihan_id uuid primary key,
  siswa_id uuid not null,
  old_jenis_id uuid not null,
  old_jenis_nama text not null,
  new_jenis_id uuid not null,
  new_jenis_nama text not null,
  nominal numeric not null,
  jurnal_piutang_id uuid,
  old_jurnal_keterangan text,
  source_departemen text not null,
  applied_at timestamptz not null default now()
);

do $$
begin
  if exists (select 1 from migration.legacy_balance_split_target_20260928)
     or exists (select 1 from migration.legacy_crossdept_spp_reclass_20260928) then
    raise exception 'legacy balance split 20260928 already applied';
  end if;
end $$;

create temp table tmp_legacy_jenis_cfg (
  nama text primary key,
  dept_code text not null,
  akun_code text
) on commit drop;

insert into tmp_legacy_jenis_cfg(nama,dept_code,akun_code) values
  ('SALDO ABY LAMA SMP','SMP','4304'),
  ('SALDO BUKU DINIYAH LAMA MTA','MTA','4304'),
  ('SALDO BUKU DINIYAH LAMA SD','SD','4304'),
  ('SALDO BUKU LAMA SD','SD','4304'),
  ('SALDO DAFTAR ULANG LAMA TK','TK','4302'),
  ('SALDO DAFTAR ULANG LAMA SD','SD','4302'),
  ('SALDO DAFTAR ULANG LAMA SMP','SMP','4302'),
  ('SALDO DAFTAR ULANG LAMA MTA','MTA','4302'),
  ('SALDO SPP LAMA TK','TK','4101'),
  ('SALDO SPP LAMA SD','SD','4101'),
  ('SALDO SPP LAMA SMP','SMP','4101'),
  ('SALDO SPP LAMA SMP NON ASRAMA','SMP','4103'),
  ('SALDO SPP LAMA MTA ASRAMA','MTA','4102'),
  ('SALDO UANG PANGKAL LAMA SD','SD','4307'),
  ('SALDO UANG PANGKAL LAMA SMP ASRAMA','SMP','4308'),
  ('SALDO UANG PANGKAL LAMA SMP NON ASRAMA','SMP','4309'),
  ('SALDO UANG PANGKAL LAMA MTA ASRAMA','MTA','4308'),
  ('SALDO UANG PANGKAL LAMA MTA NON ASRAMA','MTA','4309'),
  ('SALDO UANG PEMBANGUNAN LAMA SD','SD','4305'),
  ('SALDO SARANA PRASARANA LAMA SD','SD','4310'),
  ('SALDO SERAGAM LAMA SD','SD','4301'),
  ('SALDO SPP LEMBAGA SEBELUMNYA 2026 TK','TK','4101'),
  ('SALDO SPP LEMBAGA SEBELUMNYA 2026 MTA','MTA','4101');

insert into public.jenis_pembayaran (
  nama, nominal, keterangan, aktif, departemen_id,
  akun_pendapatan_id, tipe, perlu_dimuka
)
select
  c.nama,
  null,
  'Jenis historis hasil koreksi migrasi legacy 2026-09-28. Hanya untuk saldo/tagihan lama; jangan digunakan untuk generate tagihan baru.',
  true,
  d.id,
  a.id,
  'sekali',
  false
from tmp_legacy_jenis_cfg c
join public.departemen d on d.kode=c.dept_code
left join public.akun_rekening a on a.kode=c.akun_code
where not exists (
  select 1 from public.jenis_pembayaran jp where jp.nama=c.nama
);

do $$
declare
  v_missing int;
begin
  select count(*) into v_missing
  from tmp_legacy_jenis_cfg c
  left join public.jenis_pembayaran jp on jp.nama=c.nama
  left join public.departemen d on d.id=jp.departemen_id
  where jp.id is null or d.kode is distinct from c.dept_code or jp.tipe is distinct from 'sekali';

  if v_missing <> 0 then
    raise exception 'legacy jenis config mismatch: % rows', v_missing;
  end if;
end $$;

create temp table tmp_legacy_base on commit drop as
with latest as (
  select max(snapshot_date) d from migration.legacy_tagihan_snapshot
)
select
  l.source_key,
  l.siswa_id,
  s.nama,
  l.target_tagihan_id,
  t.jenis_id as old_jenis_id,
  jp.nama as old_target_jenis,
  t.nominal as old_target_nominal,
  t.tahun_ajaran_id,
  t.kelas_id,
  t.jatuh_tempo,
  t.jurnal_piutang_id,
  t.created_by,
  regexp_replace(
    l.source_name,
    '[[:space:]]*\([[:space:]]*[^()]*[0-9]{4}[[:space:]]*\)[[:space:]]*$',
    '',
    'i'
  ) as source_group,
  l.remaining,
  dcur.kode as current_dept,
  case
    when l.source_name ilike '%MTA%' then 'MTA'
    when l.source_name ilike '%TKITA%' or l.source_name ilike '% TK %' then 'TK'
    when l.source_name ilike '%SDITA%' or l.source_name ilike '% SD %' then 'SD'
    when l.source_name ilike '%SMPITA%' or l.source_name ilike '% SMP %' then 'SMP'
    when l.source_name ilike '%SMAITA%' or l.source_name ilike '% SMA %' then 'SMA'
    else null
  end as source_dept
from migration.legacy_tagihan_snapshot l
join latest z on z.d=l.snapshot_date
join public.siswa s on s.id=l.siswa_id
join public.tagihan t on t.id=l.target_tagihan_id
join public.jenis_pembayaran jp on jp.id=t.jenis_id
left join public.departemen dcur on dcur.id=s.departemen_id
where l.category in ('tertunggak','berjalan')
  and t.status='belum_bayar'
  and jp.nama ilike 'SALDO PIUTANG LAMA%';

create temp table tmp_legacy_stats on commit drop as
select
  siswa_id,
  target_tagihan_id,
  count(distinct source_group) as source_group_count,
  bool_or(
    source_dept is not null and current_dept is not null and source_dept<>current_dept
  ) as cross_dept
from tmp_legacy_base
group by siswa_id,target_tagihan_id;

create temp table tmp_legacy_selected on commit drop as
select b.*
from tmp_legacy_base b
join tmp_legacy_stats s using(siswa_id,target_tagihan_id)
where s.source_group_count>1 or s.cross_dept;

create temp table tmp_legacy_mapped on commit drop as
select
  s.*,
  case
    when source_group ilike 'ABY %' then 'SALDO ABY LAMA SMP'
    when source_group ilike '%BUKU DINIYAH%' and source_group ilike '%MTA%' then 'SALDO BUKU DINIYAH LAMA MTA'
    when source_group ilike '%BUKU DINIYAH%' and (source_group ilike '%SD%' or source_group ilike '%SDITA%') then 'SALDO BUKU DINIYAH LAMA SD'
    when source_group ilike '%UANG BUKU%' and (source_group ilike '%SD%' or source_group ilike '%SDITA%') then 'SALDO BUKU LAMA SD'
    when source_group ilike '%DAFTAR ULANG%' and source_group ilike '%TKITA%' then 'SALDO DAFTAR ULANG LAMA TK'
    when source_group ilike '%DAFTAR ULANG%' and (source_group ilike '%SD%' or source_group ilike '%SDITA%') then 'SALDO DAFTAR ULANG LAMA SD'
    when source_group ilike '%DAFTAR ULANG%' and (source_group ilike '%SMP%' or source_group ilike '%SMPITA%') then 'SALDO DAFTAR ULANG LAMA SMP'
    when source_group ilike '%DAFTAR ULANG%' and source_group ilike '%MTA%' then 'SALDO DAFTAR ULANG LAMA MTA'
    when source_group ilike 'SPP%' and source_group ilike '%MTA%' and source_group ilike '%ASRAMA%' then 'SALDO SPP LAMA MTA ASRAMA'
    when source_group ilike 'SPP%' and source_group ilike '%TKITA%' then 'SALDO SPP LAMA TK'
    when source_group ilike 'SPP%' and (source_group ilike '%SD%' or source_group ilike '%SDITA%') then 'SALDO SPP LAMA SD'
    when source_group ilike 'SPP%' and (source_group ilike '%SMP%' or source_group ilike '%SMPITA%') and source_group ilike '%NON ASRAMA%' then 'SALDO SPP LAMA SMP NON ASRAMA'
    when source_group ilike 'SPP%' and (source_group ilike '%SMP%' or source_group ilike '%SMPITA%') then 'SALDO SPP LAMA SMP'
    when source_group ilike '%UANG PANGKAL%' and source_group ilike '%MTA%' and source_group ilike '%NON ASRAMA%' then 'SALDO UANG PANGKAL LAMA MTA NON ASRAMA'
    when source_group ilike '%UANG PANGKAL%' and source_group ilike '%MTA%' and source_group ilike '%ASRAMA%' then 'SALDO UANG PANGKAL LAMA MTA ASRAMA'
    when source_group ilike '%UANG PANGKAL%' and (source_group ilike '%SMP%' or source_group ilike '%SMPITA%') and source_group ilike '%NON ASRAMA%' then 'SALDO UANG PANGKAL LAMA SMP NON ASRAMA'
    when source_group ilike '%UANG PANGKAL%' and (source_group ilike '%SMP%' or source_group ilike '%SMPITA%') and source_group ilike '%ASRAMA%' then 'SALDO UANG PANGKAL LAMA SMP ASRAMA'
    when source_group ilike '%UANG PANGKAL%' and (source_group ilike '%SD%' or source_group ilike '%SDITA%') then 'SALDO UANG PANGKAL LAMA SD'
    when source_group ilike '%PEMBANGUNAN%' and (source_group ilike '%SD%' or source_group ilike '%SDITA%') then 'SALDO UANG PEMBANGUNAN LAMA SD'
    when source_group ilike '%SARANA%PRASARANA%' and (source_group ilike '%SD%' or source_group ilike '%SDITA%') then 'SALDO SARANA PRASARANA LAMA SD'
    when source_group ilike '%SERAGAM%' and (source_group ilike '%SD%' or source_group ilike '%SDITA%') then 'SALDO SERAGAM LAMA SD'
    else null
  end as new_jenis_nama
from tmp_legacy_selected s;

create temp table tmp_legacy_rollup on commit drop as
select
  gen_random_uuid() as new_tagihan_id,
  m.siswa_id,
  m.nama,
  m.target_tagihan_id as old_tagihan_id,
  m.old_jenis_id,
  m.old_target_jenis,
  max(m.old_target_nominal) as old_target_nominal,
  m.tahun_ajaran_id,
  m.kelas_id,
  m.jatuh_tempo,
  m.jurnal_piutang_id,
  m.created_by,
  m.new_jenis_nama,
  sum(m.remaining)::numeric as new_nominal,
  jsonb_agg(distinct m.source_group order by m.source_group) as source_groups
from tmp_legacy_mapped m
group by
  m.siswa_id,m.nama,m.target_tagihan_id,m.old_jenis_id,m.old_target_jenis,
  m.tahun_ajaran_id,m.kelas_id,m.jatuh_tempo,m.jurnal_piutang_id,m.created_by,m.new_jenis_nama;

do $$
declare
  v_old_count int;
  v_new_count int;
  v_unmapped int;
  v_before numeric;
  v_after numeric;
  v_bad int;
  v_paid int;
begin
  select count(distinct target_tagihan_id) into v_old_count from tmp_legacy_selected;
  select count(*) into v_new_count from tmp_legacy_rollup;
  select count(*) into v_unmapped from tmp_legacy_mapped where new_jenis_nama is null;

  select coalesce(sum(v),0) into v_before
  from (
    select target_tagihan_id,max(old_target_nominal) v
    from tmp_legacy_selected
    group by target_tagihan_id
  ) q;

  select coalesce(sum(new_nominal),0) into v_after from tmp_legacy_rollup;

  select count(*) into v_bad
  from (
    select
      target_tagihan_id,
      max(old_target_nominal) old_total,
      sum(remaining) new_total
    from tmp_legacy_selected
    group by target_tagihan_id
  ) q
  where abs(old_total-new_total)>=0.01;

  select count(*) into v_paid
  from (
    select distinct siswa_id,old_jenis_id,tahun_ajaran_id
    from tmp_legacy_selected
  ) x
  join public.pembayaran p
    on p.siswa_id=x.siswa_id
   and p.jenis_id=x.old_jenis_id
   and p.tahun_ajaran_id=x.tahun_ajaran_id;

  if v_old_count<>22 then raise exception 'expected 22 old legacy targets, got %',v_old_count; end if;
  if v_new_count<>49 then raise exception 'expected 49 split targets, got %',v_new_count; end if;
  if v_unmapped<>0 then raise exception 'unmapped legacy rows: %',v_unmapped; end if;
  if abs(v_before-76580000)>=0.01 or abs(v_after-v_before)>=0.01 then
    raise exception 'legacy split total mismatch: before %, after %',v_before,v_after;
  end if;
  if v_bad<>0 then raise exception 'legacy per-target balance mismatch: %',v_bad; end if;
  if v_paid<>0 then raise exception 'legacy target received payment during cutover: % payment rows',v_paid; end if;
end $$;

do $$
declare
  v_conflicts int;
begin
  select count(*) into v_conflicts
  from tmp_legacy_rollup r
  join public.jenis_pembayaran jp on jp.nama=r.new_jenis_nama
  join public.tagihan t
    on t.siswa_id=r.siswa_id
   and t.jenis_id=jp.id
   and t.tahun_ajaran_id=r.tahun_ajaran_id
   and coalesce(t.bulan,0)=0
   and t.id<>r.old_tagihan_id;

  if v_conflicts<>0 then
    raise exception 'new legacy tagihan unique conflicts: %',v_conflicts;
  end if;
end $$;

insert into migration.legacy_balance_split_target_20260928 (
  old_tagihan_id,siswa_id,old_jenis_id,old_nominal,old_status,
  old_jurnal_piutang_id,old_jurnal_keterangan,
  old_dibatalkan_alasan,old_dibatalkan_at,old_dibatalkan_oleh
)
select distinct
  t.id,t.siswa_id,t.jenis_id,t.nominal,t.status,
  t.jurnal_piutang_id,j.keterangan,
  t.dibatalkan_alasan,t.dibatalkan_at,t.dibatalkan_oleh
from public.tagihan t
join (select distinct old_tagihan_id from tmp_legacy_rollup) r on r.old_tagihan_id=t.id
left join public.jurnal j on j.id=t.jurnal_piutang_id;

insert into public.tagihan (
  id,siswa_id,jenis_id,tahun_ajaran_id,kelas_id,bulan,
  nominal,status,jurnal_piutang_id,created_at,created_by,
  jatuh_tempo,nominal_bruto,nominal_diskon
)
select
  r.new_tagihan_id,
  r.siswa_id,
  jp.id,
  r.tahun_ajaran_id,
  r.kelas_id,
  null,
  r.new_nominal,
  'belum_bayar',
  r.jurnal_piutang_id,
  now(),
  r.created_by,
  r.jatuh_tempo,
  r.new_nominal,
  0
from tmp_legacy_rollup r
join public.jenis_pembayaran jp on jp.nama=r.new_jenis_nama;

insert into migration.legacy_balance_split_row_20260928 (
  new_tagihan_id,old_tagihan_id,siswa_id,new_jenis_id,new_jenis_nama,nominal,source_groups
)
select
  r.new_tagihan_id,r.old_tagihan_id,r.siswa_id,jp.id,r.new_jenis_nama,r.new_nominal,r.source_groups
from tmp_legacy_rollup r
join public.jenis_pembayaran jp on jp.nama=r.new_jenis_nama;

insert into migration.legacy_balance_split_source_20260928 (
  source_key,old_tagihan_id,new_tagihan_id
)
select
  m.source_key,
  m.target_tagihan_id,
  r.new_tagihan_id
from tmp_legacy_mapped m
join tmp_legacy_rollup r
  on r.old_tagihan_id=m.target_tagihan_id
 and r.new_jenis_nama=m.new_jenis_nama;

update migration.legacy_tagihan_snapshot l
set target_tagihan_id=s.new_tagihan_id
from migration.legacy_balance_split_source_20260928 s
where l.source_key=s.source_key;

update public.tagihan t
set
  status='dibatalkan',
  dibatalkan_alasan='[MIGRASI] Saldo gabungan dipecah berdasarkan jenis dan jenjang sumber legacy pada 2026-09-28.',
  dibatalkan_at=now(),
  dibatalkan_oleh=null
where t.id in (
  select old_tagihan_id from migration.legacy_balance_split_target_20260928
);

-- Reclassify 2026 cross-department SPP carry-over balances.
create temp table tmp_crossdept_spp on commit drop as
with latest as (select max(snapshot_date) d from migration.legacy_tagihan_snapshot),
x as (
  select
    l.siswa_id,s.nama,l.target_tagihan_id,
    t.jenis_id as old_jenis_id,jp.nama as old_jenis_nama,
    dtarget.kode as target_dept,
    case
      when l.source_name ilike '%MTA%' then 'MTA'
      when l.source_name ilike '%TKITA%' or l.source_name ilike '% TK %' then 'TK'
      when l.source_name ilike '%SDITA%' or l.source_name ilike '% SD %' then 'SD'
      when l.source_name ilike '%SMPITA%' or l.source_name ilike '% SMP %' then 'SMP'
      when l.source_name ilike '%SMAITA%' or l.source_name ilike '% SMA %' then 'SMA'
      else null
    end as source_dept,
    t.nominal,t.tahun_ajaran_id,t.jurnal_piutang_id
  from migration.legacy_tagihan_snapshot l
  join latest z on z.d=l.snapshot_date
  join public.siswa s on s.id=l.siswa_id
  join public.tagihan t on t.id=l.target_tagihan_id
  join public.jenis_pembayaran jp on jp.id=t.jenis_id
  left join public.departemen dtarget on dtarget.id=jp.departemen_id
  where l.category in ('tertunggak','berjalan')
    and t.status='belum_bayar'
    and jp.nama ilike 'SALDO SPP LEMBAGA SEBELUMNYA 2026%'
)
select distinct
  siswa_id,nama,target_tagihan_id,old_jenis_id,old_jenis_nama,
  target_dept,source_dept,nominal,tahun_ajaran_id,jurnal_piutang_id,
  ('SALDO SPP LEMBAGA SEBELUMNYA 2026 '||source_dept)::text as new_jenis_nama
from x
where source_dept is not null and target_dept is not null and source_dept<>target_dept;

do $$
declare
  v_count int;
  v_total numeric;
  v_paid int;
  v_missing int;
begin
  select count(*) into v_count from tmp_crossdept_spp;
  select coalesce(sum(nominal),0) into v_total from tmp_crossdept_spp;
  select count(*) into v_paid
  from tmp_crossdept_spp x
  join public.pembayaran p
    on p.siswa_id=x.siswa_id
   and p.jenis_id=x.old_jenis_id
   and p.tahun_ajaran_id=x.tahun_ajaran_id;

  select count(*) into v_missing
  from tmp_crossdept_spp x
  left join public.jenis_pembayaran jp on jp.nama=x.new_jenis_nama
  where jp.id is null;

  if v_count<>4 then raise exception 'expected 4 cross-dept SPP targets, got %',v_count; end if;
  if abs(v_total-4550000)>=0.01 then raise exception 'cross-dept SPP total mismatch: %',v_total; end if;
  if v_paid<>0 then raise exception 'cross-dept SPP target already paid: % rows',v_paid; end if;
  if v_missing<>0 then raise exception 'cross-dept SPP destination kinds missing: %',v_missing; end if;
end $$;

insert into migration.legacy_crossdept_spp_reclass_20260928 (
  tagihan_id,siswa_id,old_jenis_id,old_jenis_nama,new_jenis_id,new_jenis_nama,
  nominal,jurnal_piutang_id,old_jurnal_keterangan,source_departemen
)
select
  x.target_tagihan_id,x.siswa_id,x.old_jenis_id,x.old_jenis_nama,
  jp.id,x.new_jenis_nama,x.nominal,x.jurnal_piutang_id,j.keterangan,x.source_dept
from tmp_crossdept_spp x
join public.jenis_pembayaran jp on jp.nama=x.new_jenis_nama
left join public.jurnal j on j.id=x.jurnal_piutang_id;

update public.tagihan t
set jenis_id=a.new_jenis_id
from migration.legacy_crossdept_spp_reclass_20260928 a
where t.id=a.tagihan_id;

-- Restore posted JPI descriptions changed by the legacy sync trigger.
update public.jurnal j
set keterangan=a.old_jurnal_keterangan
from migration.legacy_balance_split_target_20260928 a
where j.id=a.old_jurnal_piutang_id
  and a.old_jurnal_piutang_id is not null;

update public.jurnal j
set keterangan=a.old_jurnal_keterangan
from migration.legacy_crossdept_spp_reclass_20260928 a
where j.id=a.jurnal_piutang_id
  and a.jurnal_piutang_id is not null;

do $$
declare
  v_old_cancelled int;
  v_new_open int;
  v_new_total numeric;
  v_reclass int;
  v_reclass_total numeric;
  v_bad_snapshot int;
begin
  select count(*) into v_old_cancelled
  from public.tagihan t
  join migration.legacy_balance_split_target_20260928 a on a.old_tagihan_id=t.id
  where t.status='dibatalkan';

  select count(*),coalesce(sum(t.nominal),0)
  into v_new_open,v_new_total
  from public.tagihan t
  join migration.legacy_balance_split_row_20260928 a on a.new_tagihan_id=t.id
  where t.status='belum_bayar';

  select count(*),coalesce(sum(t.nominal),0)
  into v_reclass,v_reclass_total
  from public.tagihan t
  join migration.legacy_crossdept_spp_reclass_20260928 a on a.tagihan_id=t.id
  where t.jenis_id=a.new_jenis_id and t.status='belum_bayar';

  select count(*) into v_bad_snapshot
  from migration.legacy_balance_split_source_20260928 a
  join migration.legacy_tagihan_snapshot l on l.source_key=a.source_key
  where l.target_tagihan_id is distinct from a.new_tagihan_id;

  if v_old_cancelled<>22 then raise exception 'postcheck old cancelled %',v_old_cancelled; end if;
  if v_new_open<>49 or abs(v_new_total-76580000)>=0.01 then
    raise exception 'postcheck split rows %, total %',v_new_open,v_new_total;
  end if;
  if v_reclass<>4 or abs(v_reclass_total-4550000)>=0.01 then
    raise exception 'postcheck reclass rows %, total %',v_reclass,v_reclass_total;
  end if;
  if v_bad_snapshot<>0 then raise exception 'postcheck snapshot relink mismatch %',v_bad_snapshot; end if;
end $$;
