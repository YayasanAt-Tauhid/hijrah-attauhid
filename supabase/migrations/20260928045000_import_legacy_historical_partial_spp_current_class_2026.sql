-- Import partial Jan-Jun 2026 SPP when the legacy gross exactly matches
-- the student's current 2026 tariff. Current class is used for collection routing.
create or replace function migration.import_legacy_historical_partial_spp_current_class_2026(
  p_snapshot_date date,
  p_expected_count integer,
  p_expected_net numeric,
  p_expected_gross numeric,
  p_expected_discount numeric,
  p_expected_paid numeric
) returns jsonb
language plpgsql
set search_path to 'pg_catalog','public','migration'
as $fn$
declare
  v_row record;
  v_count integer;
  v_net numeric;
  v_gross numeric;
  v_discount numeric;
  v_paid numeric;
  v_piutang uuid;
  v_jurnal uuid;
  v_tagihan uuid;
  v_nomor text;
  v_date date := (now() at time zone 'Asia/Jakarta')::date;
  v_imported integer := 0;
begin
  if p_snapshot_date is distinct from date '2026-09-27'
     or p_expected_count<=0 or p_expected_net<=0 or p_expected_gross<=0
     or p_expected_discount<0 or p_expected_paid<=0
     or p_expected_gross-p_expected_discount-p_expected_paid<>p_expected_net then
    raise exception 'Import boundaries invalid';
  end if;

  perform pg_advisory_xact_lock(hashtext('migration.import_legacy_historical_partial_spp_current_class_2026'));

  select akun_id into strict v_piutang
  from public.pengaturan_akun
  where kode_setting='piutang_siswa';

  with mapped as (
    select l.source_key,l.siswa_id,l.period_month,l.remaining,l.gross,l.discount,
           l.gross-l.discount-l.remaining as paid,
           d.id dept_id,d.kode dept,j.id jenis_id,j.akun_pendapatan_id,
           tb.id book_id,ks.kelas_id,s.angkatan_id,
           public.get_tarif_siswa(j.id,l.siswa_id,ks.kelas_id,tb.id,s.angkatan_id) as tarif
    from migration.legacy_tagihan_snapshot l
    join public.siswa s on s.id=l.siswa_id and s.status='aktif'
    join public.departemen d on d.id=s.departemen_id
    join public.jenis_pembayaran j on j.departemen_id=d.id
      and j.aktif and j.nama='SPP '||d.kode
      and j.akun_pendapatan_id is not null
    join public.tahun_buku tb on tb.nama='Tahun 2026' and not tb.ditutup
    join public.tahun_ajaran ta_cur on ta_cur.aktif
    join public.kelas_siswa ks on ks.siswa_id=s.id
      and ks.tahun_ajaran_id=ta_cur.id and ks.aktif
    join public.kelas k on k.id=ks.kelas_id and k.departemen_id=d.id
    where l.snapshot_date=p_snapshot_date
      and l.target_tagihan_id is null
      and l.disposition='hold_historical'
      and l.period_month between date '2026-01-01' and date '2026-06-01'
      and upper(l.source_name) like '%SPP%'
      and upper(l.source_name) like '%'||d.kode||'%'
      and l.gross-l.discount>l.remaining
      and l.remaining>0
      and l.gross=public.get_tarif_siswa(j.id,l.siswa_id,ks.kelas_id,tb.id,s.angkatan_id)
      and not exists (
        select 1 from public.tagihan t
        where t.siswa_id=l.siswa_id and t.jenis_id=j.id
          and t.tahun_ajaran_id=tb.id
          and t.bulan=extract(month from l.period_month)::integer
      )
  )
  select count(*),coalesce(sum(remaining),0),coalesce(sum(gross),0),
         coalesce(sum(discount),0),coalesce(sum(paid),0)
  into v_count,v_net,v_gross,v_discount,v_paid
  from mapped;

  if (v_count,v_net,v_gross,v_discount,v_paid) is distinct from
     (p_expected_count,p_expected_net,p_expected_gross,p_expected_discount,p_expected_paid) then
    raise exception 'Candidate totals changed: count %, net %, gross %, discount %, paid %',
      v_count,v_net,v_gross,v_discount,v_paid;
  end if;

  for v_row in
    select l.source_key,l.siswa_id,l.period_month,l.remaining,l.gross,l.discount,
           l.gross-l.discount-l.remaining as paid,
           d.id dept_id,d.kode dept,j.id jenis_id,j.akun_pendapatan_id,
           tb.id book_id,ks.kelas_id,s.angkatan_id
    from migration.legacy_tagihan_snapshot l
    join public.siswa s on s.id=l.siswa_id and s.status='aktif'
    join public.departemen d on d.id=s.departemen_id
    join public.jenis_pembayaran j on j.departemen_id=d.id
      and j.aktif and j.nama='SPP '||d.kode
      and j.akun_pendapatan_id is not null
    join public.tahun_buku tb on tb.nama='Tahun 2026' and not tb.ditutup
    join public.tahun_ajaran ta_cur on ta_cur.aktif
    join public.kelas_siswa ks on ks.siswa_id=s.id
      and ks.tahun_ajaran_id=ta_cur.id and ks.aktif
    join public.kelas k on k.id=ks.kelas_id and k.departemen_id=d.id
    where l.snapshot_date=p_snapshot_date
      and l.target_tagihan_id is null
      and l.disposition='hold_historical'
      and l.period_month between date '2026-01-01' and date '2026-06-01'
      and upper(l.source_name) like '%SPP%'
      and upper(l.source_name) like '%'||d.kode||'%'
      and l.gross-l.discount>l.remaining
      and l.remaining>0
      and l.gross=public.get_tarif_siswa(j.id,l.siswa_id,ks.kelas_id,tb.id,s.angkatan_id)
      and not exists (
        select 1 from public.tagihan t
        where t.siswa_id=l.siswa_id and t.jenis_id=j.id
          and t.tahun_ajaran_id=tb.id
          and t.bulan=extract(month from l.period_month)::integer
      )
    order by l.source_key
    for update of l
  loop
    v_nomor:=public.generate_nomor_jurnal('JPI',extract(year from v_date)::integer);

    insert into public.jurnal
      (nomor,tanggal,keterangan,referensi,departemen_id,total_debit,total_kredit,status)
    values(
      v_nomor,v_date,
      'Piutang SPP historis parsial '||v_row.period_month||' siswa '||v_row.siswa_id,
      'MIGR-LEGACY-HIST-SPP-'||v_row.source_key,
      v_row.dept_id,v_row.remaining,v_row.remaining,'posted'
    )
    returning id into v_jurnal;

    insert into public.jurnal_detail
      (jurnal_id,akun_id,keterangan,debit,kredit,urutan)
    values
      (v_jurnal,v_piutang,'Sisa piutang SPP historis',v_row.remaining,0,1),
      (v_jurnal,v_row.akun_pendapatan_id,'Sisa pendapatan SPP historis',0,v_row.remaining,2);

    insert into public.tagihan
      (siswa_id,jenis_id,tahun_ajaran_id,kelas_id,bulan,nominal,status,
       jatuh_tempo,nominal_bruto,nominal_diskon,jurnal_piutang_id,
       legacy_source_key,legacy_original_gross,legacy_original_discount,legacy_paid_amount)
    values(
      v_row.siswa_id,v_row.jenis_id,v_row.book_id,v_row.kelas_id,
      extract(month from v_row.period_month)::integer,
      v_row.remaining,'belum_bayar',
      make_date(2026,extract(month from v_row.period_month)::integer,10),
      v_row.remaining,0,v_jurnal,
      v_row.source_key,v_row.gross,v_row.discount,v_row.paid
    )
    returning id into v_tagihan;

    update public.jurnal
    set keterangan=replace(
      migration.legacy_journal_keterangan(
        v_row.siswa_id,v_row.kelas_id,v_row.jenis_id,v_row.period_month
      ),
      ' — Kelas ',' — Kelas saat migrasi '
    )
    where id=v_jurnal;

    update migration.legacy_tagihan_snapshot
    set target_tagihan_id=v_tagihan,
        disposition='imported_historical_partial_spp_current_class_2026',
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

  return jsonb_build_object(
    'count',v_imported,'net',v_net,'gross',v_gross,
    'discount',v_discount,'paid',v_paid,'journal_date',v_date
  );
end;
$fn$;

revoke all on function migration.import_legacy_historical_partial_spp_current_class_2026(date,integer,numeric,numeric,numeric,numeric)
from public,anon,authenticated;
