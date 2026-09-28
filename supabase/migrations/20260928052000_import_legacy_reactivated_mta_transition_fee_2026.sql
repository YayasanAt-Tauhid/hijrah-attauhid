-- Import verified July 2026 MTA internal-level transition uang pangkal for
-- students normalized from legacy status 'keluar' to active.
create or replace function migration.import_legacy_reactivated_mta_transition_fee_2026(
  p_snapshot_date date,
  p_expected_count integer,
  p_expected_net numeric
) returns jsonb
language plpgsql
set search_path to 'pg_catalog','public','migration'
as $fn$
declare
  v_row record;
  v_count integer;
  v_net numeric;
  v_piutang uuid;
  v_jurnal uuid;
  v_tagihan uuid;
  v_nomor text;
  v_date date := (now() at time zone 'Asia/Jakarta')::date;
  v_imported integer := 0;
begin
  if p_snapshot_date is distinct from date '2026-09-27'
     or p_expected_count<=0 or p_expected_net<=0 then
    raise exception 'Import boundaries invalid';
  end if;

  perform pg_advisory_xact_lock(hashtext('migration.import_legacy_reactivated_mta_transition_fee_2026'));

  select akun_id into strict v_piutang
  from public.pengaturan_akun
  where kode_setting='piutang_siswa';

  with mapped as (
    select l.source_key,l.siswa_id,l.period_month,l.remaining,
           d.id dept_id,j.id jenis_id,j.akun_pendapatan_id,
           tb.id book_id,ks.kelas_id
    from migration.legacy_tagihan_snapshot l
    join migration.legacy_status_normalization_audit a
      on a.siswa_id=l.siswa_id and a.evidence_snapshot_date=p_snapshot_date
    join public.siswa s on s.id=l.siswa_id and s.status='aktif'
    join public.departemen d on d.id=s.departemen_id and d.kode='MTA'
    join public.jenis_pembayaran j on j.departemen_id=d.id
      and j.nama='UANG PANGKAL MTA' and j.aktif and j.tipe='sekali'
      and j.akun_pendapatan_id=(select id from public.akun_rekening where kode='4307' and aktif)
    join public.tahun_buku tb
      on l.period_month between tb.tanggal_mulai and tb.tanggal_selesai and not tb.ditutup
    join public.tahun_ajaran ta
      on l.period_month between ta.tanggal_mulai and ta.tanggal_selesai
    join public.kelas_siswa ks
      on ks.siswa_id=l.siswa_id and ks.tahun_ajaran_id=ta.id and ks.aktif
    where l.snapshot_date=p_snapshot_date
      and l.period_month=date '2026-07-01'
      and l.disposition='hold_historical'
      and l.target_tagihan_id is null
      and l.source_name ilike 'UP SISWA MTA%'
      and l.gross=l.remaining
      and l.discount=0
      and l.remaining>0
      and not exists (
        select 1 from public.tagihan t
        where t.siswa_id=l.siswa_id
          and t.jenis_id=j.id
          and t.tahun_ajaran_id=tb.id
      )
  )
  select count(*),coalesce(sum(remaining),0)
  into v_count,v_net
  from mapped;

  if (v_count,v_net) is distinct from (p_expected_count,p_expected_net) then
    raise exception 'Candidate totals changed: count %, net %',v_count,v_net;
  end if;

  for v_row in
    select l.source_key,l.siswa_id,l.period_month,l.remaining,
           s.nama,d.id dept_id,j.id jenis_id,j.akun_pendapatan_id,
           tb.id book_id,ks.kelas_id,k.nama as kelas
    from migration.legacy_tagihan_snapshot l
    join migration.legacy_status_normalization_audit a
      on a.siswa_id=l.siswa_id and a.evidence_snapshot_date=p_snapshot_date
    join public.siswa s on s.id=l.siswa_id and s.status='aktif'
    join public.departemen d on d.id=s.departemen_id and d.kode='MTA'
    join public.jenis_pembayaran j on j.departemen_id=d.id
      and j.nama='UANG PANGKAL MTA' and j.aktif and j.tipe='sekali'
      and j.akun_pendapatan_id=(select id from public.akun_rekening where kode='4307' and aktif)
    join public.tahun_buku tb
      on l.period_month between tb.tanggal_mulai and tb.tanggal_selesai and not tb.ditutup
    join public.tahun_ajaran ta
      on l.period_month between ta.tanggal_mulai and ta.tanggal_selesai
    join public.kelas_siswa ks
      on ks.siswa_id=l.siswa_id and ks.tahun_ajaran_id=ta.id and ks.aktif
    join public.kelas k on k.id=ks.kelas_id
    where l.snapshot_date=p_snapshot_date
      and l.period_month=date '2026-07-01'
      and l.disposition='hold_historical'
      and l.target_tagihan_id is null
      and l.source_name ilike 'UP SISWA MTA%'
      and l.gross=l.remaining
      and l.discount=0
      and l.remaining>0
      and not exists (
        select 1 from public.tagihan t
        where t.siswa_id=l.siswa_id
          and t.jenis_id=j.id
          and t.tahun_ajaran_id=tb.id
      )
    order by s.nama
    for update of l
  loop
    v_nomor:=public.generate_nomor_jurnal('JPI',extract(year from v_date)::integer);

    insert into public.jurnal
      (nomor,tanggal,keterangan,referensi,departemen_id,total_debit,total_kredit,status)
    values(
      v_nomor,v_date,
      'Piutang uang pangkal transisi MTA Juli 2026 — '||v_row.nama||
        ' — Kelas '||v_row.kelas,
      'MIGR-LEGACY-FEE-'||v_row.source_key,
      v_row.dept_id,v_row.remaining,v_row.remaining,'posted'
    )
    returning id into v_jurnal;

    insert into public.jurnal_detail
      (jurnal_id,akun_id,keterangan,debit,kredit,urutan)
    values
      (v_jurnal,v_piutang,'Piutang uang pangkal transisi MTA',v_row.remaining,0,1),
      (v_jurnal,v_row.akun_pendapatan_id,'Pendapatan uang pangkal MTA',0,v_row.remaining,2);

    insert into public.tagihan
      (siswa_id,jenis_id,tahun_ajaran_id,kelas_id,bulan,nominal,status,
       jatuh_tempo,nominal_bruto,nominal_diskon,jurnal_piutang_id)
    values(
      v_row.siswa_id,v_row.jenis_id,v_row.book_id,v_row.kelas_id,null,
      v_row.remaining,'belum_bayar',date '2026-07-10',
      v_row.remaining,0,v_jurnal
    )
    returning id into v_tagihan;

    update public.jurnal
    set keterangan='Piutang UANG PANGKAL MTA migrasi Juli 2026 — '||
      v_row.nama||' — Kelas '||v_row.kelas
    where id=v_jurnal;

    update migration.legacy_tagihan_snapshot
    set target_tagihan_id=v_tagihan,
        disposition='imported_reactivated_mta_transition_fee_2026',
        imported_at=now()
    where source_key=v_row.source_key
      and target_tagihan_id is null
      and disposition='hold_historical';

    if not found then
      raise exception 'Snapshot link failed: %',v_row.source_key;
    end if;

    v_imported:=v_imported+1;
  end loop;

  if v_imported<>p_expected_count then
    raise exception 'Imported % but expected %',v_imported,p_expected_count;
  end if;

  return jsonb_build_object('count',v_imported,'net',v_net,'journal_date',v_date);
end;
$fn$;

revoke all on function migration.import_legacy_reactivated_mta_transition_fee_2026(date,integer,numeric)
from public,anon,authenticated;