create or replace function migration.import_legacy_historical_spp_aggregate_2026(
  p_snapshot_date date,
  p_expected_rows integer,
  p_expected_students integer,
  p_expected_receivable numeric,
  p_expected_discount_debit numeric,
  p_expected_revenue_credit numeric,
  p_expected_legacy_paid numeric
) returns jsonb
language plpgsql
set search_path to 'pg_catalog','public','migration'
as $fn$
declare
  v_row record;
  v_rows integer;
  v_students integer;
  v_receivable numeric;
  v_discount_debit numeric;
  v_revenue_credit numeric;
  v_legacy_paid numeric;
  v_piutang uuid;
  v_discount_account uuid;
  v_revenue uuid;
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
     or p_expected_rows<=0 or p_expected_students<=0
     or p_expected_receivable<=0 or p_expected_revenue_credit<=0
     or p_expected_discount_debit<0 or p_expected_legacy_paid<0
     or p_expected_receivable+p_expected_discount_debit<>p_expected_revenue_credit then
    raise exception 'Import boundaries invalid';
  end if;

  perform pg_advisory_xact_lock(hashtext('migration.import_legacy_historical_spp_aggregate_2026'));

  select akun_id into strict v_piutang
  from public.pengaturan_akun
  where kode_setting='piutang_siswa';

  select id into strict v_discount_account
  from public.akun_rekening
  where kode='4601' and aktif;

  select id into strict v_revenue
  from public.akun_rekening
  where kode='4101' and aktif;

  select id into strict v_book
  from public.tahun_buku
  where v_date between tanggal_mulai and tanggal_selesai
    and not ditutup;

  with source as (
    select l.*,d.kode as dept,
           l.gross-l.discount-l.remaining as paid
    from migration.legacy_tagihan_snapshot l
    join public.siswa s on s.id=l.siswa_id and s.status='aktif'
    join public.departemen d on d.id=s.departemen_id
    join public.jenis_pembayaran jp on jp.departemen_id=d.id
      and jp.nama='SALDO SPP HISTORIS 2026 '||d.kode
      and jp.tipe='sekali'
    where l.snapshot_date=p_snapshot_date
      and l.target_tagihan_id is null
      and l.disposition='hold_historical'
      and l.period_month between date '2026-01-01' and date '2026-06-01'
      and upper(l.source_name) like '%SPP%'
      and (
        (d.kode='MTA' and upper(l.source_name) like '%MTA%') or
        (d.kode='SMA' and upper(l.source_name) like '%SMAITA%') or
        (d.kode='SMP' and upper(l.source_name) like '%SMPITA%') or
        (d.kode='SD' and upper(l.source_name) like '%SDITA%') or
        (d.kode='TK' and upper(l.source_name) like '%TKITA%')
      )
  )
  select count(*),count(distinct siswa_id),coalesce(sum(remaining),0),
         coalesce(sum(case when paid=0 then discount else 0 end),0),
         coalesce(sum(case when paid=0 then gross else remaining end),0),
         coalesce(sum(paid),0)
  into v_rows,v_students,v_receivable,v_discount_debit,v_revenue_credit,v_legacy_paid
  from source;

  if (v_rows,v_students,v_receivable,v_discount_debit,v_revenue_credit,v_legacy_paid)
     is distinct from
     (p_expected_rows,p_expected_students,p_expected_receivable,
      p_expected_discount_debit,p_expected_revenue_credit,p_expected_legacy_paid) then
    raise exception 'Candidate totals changed: rows %, students %, receivable %, discount %, revenue %, paid %',
      v_rows,v_students,v_receivable,v_discount_debit,v_revenue_credit,v_legacy_paid;
  end if;

  for v_row in
    select l.siswa_id,s.nama,d.id as dept_id,d.kode as dept,
           ks.kelas_id,k.nama as kelas,jp.id as jenis_id,
           count(*) as source_rows,
           sum(l.remaining) as receivable,
           sum(case when l.gross-l.discount-l.remaining=0 then l.discount else 0 end) as discount_debit,
           sum(case when l.gross-l.discount-l.remaining=0 then l.gross else l.remaining end) as revenue_credit,
           sum(l.gross-l.discount-l.remaining) as legacy_paid,
           min(l.period_month) as first_period,
           max(l.period_month) as last_period
    from migration.legacy_tagihan_snapshot l
    join public.siswa s on s.id=l.siswa_id and s.status='aktif'
    join public.departemen d on d.id=s.departemen_id
    join public.tahun_ajaran ta on ta.aktif
    join public.kelas_siswa ks on ks.siswa_id=s.id and ks.tahun_ajaran_id=ta.id and ks.aktif
    join public.kelas k on k.id=ks.kelas_id and k.departemen_id=d.id
    join public.jenis_pembayaran jp on jp.departemen_id=d.id
      and jp.nama='SALDO SPP HISTORIS 2026 '||d.kode
      and jp.tipe='sekali'
    where l.snapshot_date=p_snapshot_date
      and l.target_tagihan_id is null
      and l.disposition='hold_historical'
      and l.period_month between date '2026-01-01' and date '2026-06-01'
      and upper(l.source_name) like '%SPP%'
      and (
        (d.kode='MTA' and upper(l.source_name) like '%MTA%') or
        (d.kode='SMA' and upper(l.source_name) like '%SMAITA%') or
        (d.kode='SMP' and upper(l.source_name) like '%SMPITA%') or
        (d.kode='SD' and upper(l.source_name) like '%SDITA%') or
        (d.kode='TK' and upper(l.source_name) like '%TKITA%')
      )
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
    if v_row.receivable+v_row.discount_debit<>v_row.revenue_credit then
      raise exception 'Journal does not balance for %',v_row.nama;
    end if;

    v_nomor:=public.generate_nomor_jurnal('JPI',extract(year from v_date)::integer);

    insert into public.jurnal
      (nomor,tanggal,keterangan,referensi,departemen_id,total_debit,total_kredit,status)
    values(
      v_nomor,v_date,
      'Saldo SPP historis Jan-Jun 2026 — '||v_row.nama||
        ' — Kelas saat migrasi '||v_row.kelas,
      'MIGR-LEGACY-HIST-SPP-AGG-'||v_row.siswa_id,
      v_row.dept_id,v_row.revenue_credit,v_row.revenue_credit,'posted'
    )
    returning id into v_jurnal;

    insert into public.jurnal_detail
      (jurnal_id,akun_id,keterangan,debit,kredit,urutan)
    values
      (v_jurnal,v_piutang,
       'Sisa piutang SPP historis ('||v_row.source_rows||' sumber)',v_row.receivable,0,1);

    if v_row.discount_debit>0 then
      insert into public.jurnal_detail
        (jurnal_id,akun_id,keterangan,debit,kredit,urutan)
      values
        (v_jurnal,v_discount_account,
         'Potongan SPP historis yang belum pernah dibayar',v_row.discount_debit,0,2);
    end if;

    insert into public.jurnal_detail
      (jurnal_id,akun_id,keterangan,debit,kredit,urutan)
    values
      (v_jurnal,v_revenue,
       'Pendapatan SPP historis; bagian yang sudah dibayar tidak dijurnal ulang',
       0,v_row.revenue_credit,3);

    insert into public.tagihan
      (siswa_id,jenis_id,tahun_ajaran_id,kelas_id,bulan,nominal,status,
       jatuh_tempo,nominal_bruto,nominal_diskon,jurnal_piutang_id)
    values(
      v_row.siswa_id,v_row.jenis_id,v_book,v_row.kelas_id,null,
      v_row.receivable,'belum_bayar',v_row.last_period,
      v_row.receivable,0,v_jurnal
    )
    returning id into v_tagihan;

    update public.jurnal
    set keterangan='Saldo SPP historis Jan-Jun 2026 — '||v_row.nama||
      ' — Kelas saat migrasi '||v_row.kelas
    where id=v_jurnal;

    update migration.legacy_tagihan_snapshot l
    set target_tagihan_id=v_tagihan,
        disposition='imported_historical_spp_aggregate_2026',
        imported_at=now()
    where l.snapshot_date=p_snapshot_date
      and l.siswa_id=v_row.siswa_id
      and l.target_tagihan_id is null
      and l.disposition='hold_historical'
      and l.period_month between date '2026-01-01' and date '2026-06-01'
      and upper(l.source_name) like '%SPP%'
      and (
        (v_row.dept='MTA' and upper(l.source_name) like '%MTA%') or
        (v_row.dept='SMA' and upper(l.source_name) like '%SMAITA%') or
        (v_row.dept='SMP' and upper(l.source_name) like '%SMPITA%') or
        (v_row.dept='SD' and upper(l.source_name) like '%SDITA%') or
        (v_row.dept='TK' and upper(l.source_name) like '%TKITA%')
      );

    get diagnostics v_rowcount = row_count;
    if v_rowcount<>v_row.source_rows then
      raise exception 'Linked % rows for %, expected %',
        v_rowcount,v_row.nama,v_row.source_rows;
    end if;

    v_linked_rows:=v_linked_rows+v_rowcount;
    v_imported_students:=v_imported_students+1;
  end loop;

  if v_linked_rows<>p_expected_rows or v_imported_students<>p_expected_students then
    raise exception 'Imported students %/%; linked rows %/%',
      v_imported_students,p_expected_students,v_linked_rows,p_expected_rows;
  end if;

  return jsonb_build_object(
    'rows',v_linked_rows,'students',v_imported_students,
    'receivable',v_receivable,'discount_debit',v_discount_debit,
    'revenue_credit',v_revenue_credit,'legacy_paid',v_legacy_paid,
    'journal_date',v_date
  );
end;
$fn$;

revoke all on function migration.import_legacy_historical_spp_aggregate_2026(date,integer,integer,numeric,numeric,numeric,numeric)
from public,anon,authenticated;