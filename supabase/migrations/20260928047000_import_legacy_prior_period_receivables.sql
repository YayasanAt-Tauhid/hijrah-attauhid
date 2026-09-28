-- Aggregate all verified active-student balances dated before 2026 into one
-- collectible opening-balance tagihan per student. Original source detail remains
-- in migration.legacy_tagihan_snapshot and is linked to the aggregate tagihan.
create or replace function migration.import_legacy_prior_period_receivables(
  p_snapshot_date date,
  p_expected_source_rows integer,
  p_expected_students integer,
  p_expected_balance numeric
) returns jsonb
language plpgsql
set search_path to 'pg_catalog','public','migration'
as $fn$
declare
  v_row record;
  v_source_rows integer;
  v_students integer;
  v_balance numeric;
  v_piutang uuid;
  v_equity uuid;
  v_book uuid;
  v_jurnal uuid;
  v_tagihan uuid;
  v_nomor text;
  v_date date := (now() at time zone 'Asia/Jakarta')::date;
  v_imported_students integer := 0;
  v_linked_rows integer := 0;
  v_rowcount integer;
begin
  if p_snapshot_date is distinct from date '2026-09-27'
     or p_expected_source_rows<=0
     or p_expected_students<=0
     or p_expected_balance<=0 then
    raise exception 'Import boundaries invalid';
  end if;

  perform pg_advisory_xact_lock(hashtext('migration.import_legacy_prior_period_receivables'));

  select akun_id into strict v_piutang
  from public.pengaturan_akun
  where kode_setting='piutang_siswa';

  select id into strict v_equity
  from public.akun_rekening
  where kode='3101' and aktif and jenis='ekuitas';

  select id into strict v_book
  from public.tahun_buku
  where v_date between tanggal_mulai and tanggal_selesai
    and not ditutup;

  with source as (
    select l.source_key,l.siswa_id,l.remaining,
           s.departemen_id,d.kode as dept,
           ks.kelas_id
    from migration.legacy_tagihan_snapshot l
    join public.siswa s on s.id=l.siswa_id and s.status='aktif'
    join public.departemen d on d.id=s.departemen_id
    join public.tahun_ajaran ta on ta.aktif
    join public.kelas_siswa ks on ks.siswa_id=s.id
      and ks.tahun_ajaran_id=ta.id and ks.aktif
    join public.kelas k on k.id=ks.kelas_id and k.departemen_id=d.id
    join public.jenis_pembayaran jp on jp.departemen_id=d.id
      and jp.nama='SALDO PIUTANG LAMA '||d.kode
      and jp.tipe='sekali'
    where l.snapshot_date=p_snapshot_date
      and l.target_tagihan_id is null
      and l.disposition='hold_historical'
      and l.remaining>0
      and l.period_month<date '2026-01-01'
  )
  select count(*),count(distinct siswa_id),coalesce(sum(remaining),0)
  into v_source_rows,v_students,v_balance
  from source;

  if (v_source_rows,v_students,v_balance) is distinct from
     (p_expected_source_rows,p_expected_students,p_expected_balance) then
    raise exception 'Candidate totals changed: rows %, students %, balance %',
      v_source_rows,v_students,v_balance;
  end if;

  for v_row in
    select l.siswa_id,s.nama,d.id as dept_id,d.kode as dept,
           ks.kelas_id,k.nama as kelas,
           jp.id as jenis_id,
           count(*) as source_rows,
           sum(l.remaining) as balance,
           min(l.period_month) as first_period,
           max(l.period_month) as last_period
    from migration.legacy_tagihan_snapshot l
    join public.siswa s on s.id=l.siswa_id and s.status='aktif'
    join public.departemen d on d.id=s.departemen_id
    join public.tahun_ajaran ta on ta.aktif
    join public.kelas_siswa ks on ks.siswa_id=s.id
      and ks.tahun_ajaran_id=ta.id and ks.aktif
    join public.kelas k on k.id=ks.kelas_id and k.departemen_id=d.id
    join public.jenis_pembayaran jp on jp.departemen_id=d.id
      and jp.nama='SALDO PIUTANG LAMA '||d.kode
      and jp.tipe='sekali'
    where l.snapshot_date=p_snapshot_date
      and l.target_tagihan_id is null
      and l.disposition='hold_historical'
      and l.remaining>0
      and l.period_month<date '2026-01-01'
      and not exists (
        select 1 from public.tagihan t
        where t.siswa_id=l.siswa_id
          and t.jenis_id=jp.id
          and t.tahun_ajaran_id=v_book
          and t.bulan is null
      )
    group by l.siswa_id,s.nama,d.id,d.kode,ks.kelas_id,k.nama,jp.id
    order by s.nama
  loop
    v_nomor:=public.generate_nomor_jurnal('JPI',extract(year from v_date)::integer);

    insert into public.jurnal
      (nomor,tanggal,keterangan,referensi,departemen_id,total_debit,total_kredit,status)
    values(
      v_nomor,v_date,
      'Saldo piutang lama s.d. 31 Desember 2025 — '||v_row.nama||
        ' — Kelas saat migrasi '||v_row.kelas,
      'MIGR-LEGACY-PRIOR-'||v_row.siswa_id,
      v_row.dept_id,v_row.balance,v_row.balance,'posted'
    )
    returning id into v_jurnal;

    insert into public.jurnal_detail
      (jurnal_id,akun_id,keterangan,debit,kredit,urutan)
    values
      (v_jurnal,v_piutang,
       'Saldo piutang siswa sebelum 2026 ('||v_row.source_rows||' sumber)',v_row.balance,0,1),
      (v_jurnal,v_equity,
       'Saldo awal piutang lama — Asset Netto (Modal)',0,v_row.balance,2);

    insert into public.tagihan
      (siswa_id,jenis_id,tahun_ajaran_id,kelas_id,bulan,nominal,status,
       jatuh_tempo,nominal_bruto,nominal_diskon,jurnal_piutang_id)
    values(
      v_row.siswa_id,v_row.jenis_id,v_book,v_row.kelas_id,null,
      v_row.balance,'belum_bayar',date '2026-01-01',
      v_row.balance,0,v_jurnal
    )
    returning id into v_tagihan;

    -- The generic legacy label trigger runs on tagihan insert; restore the
    -- opening-balance wording after the tagihan exists.
    update public.jurnal
    set keterangan='Saldo piutang lama s.d. 31 Desember 2025 — '||v_row.nama||
      ' — Kelas saat migrasi '||v_row.kelas
    where id=v_jurnal;

    update migration.legacy_tagihan_snapshot l
    set target_tagihan_id=v_tagihan,
        disposition='imported_prior_period_opening',
        imported_at=now()
    where l.snapshot_date=p_snapshot_date
      and l.siswa_id=v_row.siswa_id
      and l.target_tagihan_id is null
      and l.disposition='hold_historical'
      and l.remaining>0
      and l.period_month<date '2026-01-01';

    get diagnostics v_rowcount = row_count;
    if v_rowcount<>v_row.source_rows then
      raise exception 'Linked % source rows for %, expected %',
        v_rowcount,v_row.nama,v_row.source_rows;
    end if;

    v_linked_rows:=v_linked_rows+v_rowcount;
    v_imported_students:=v_imported_students+1;
  end loop;

  if v_imported_students<>p_expected_students
     or v_linked_rows<>p_expected_source_rows then
    raise exception 'Imported students %/%; linked rows %/%',
      v_imported_students,p_expected_students,v_linked_rows,p_expected_source_rows;
  end if;

  return jsonb_build_object(
    'source_rows',v_linked_rows,
    'students',v_imported_students,
    'balance',v_balance,
    'journal_date',v_date,
    'offset_account','3101'
  );
end;
$fn$;

revoke all on function migration.import_legacy_prior_period_receivables(date,integer,integer,numeric)
from public,anon,authenticated;