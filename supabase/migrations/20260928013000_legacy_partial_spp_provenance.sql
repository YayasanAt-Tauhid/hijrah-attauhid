-- Preserve the original bill and payment estimate for legacy partial SPP.
-- The operational tagihan nominal is only the unpaid balance. The source
-- snapshot remains the authoritative detail of prior payments and discounts.
alter table public.tagihan
  add column if not exists legacy_source_key text
    references migration.legacy_tagihan_snapshot(source_key),
  add column if not exists legacy_original_gross numeric(14,2),
  add column if not exists legacy_original_discount numeric(14,2),
  add column if not exists legacy_paid_amount numeric(14,2);

create unique index if not exists tagihan_legacy_source_key_unique
  on public.tagihan(legacy_source_key) where legacy_source_key is not null;

alter table public.tagihan
  add constraint tagihan_legacy_partial_metadata_check
  check (
    (legacy_source_key is null and legacy_original_gross is null
       and legacy_original_discount is null and legacy_paid_amount is null)
    or
    (legacy_source_key is not null and legacy_original_gross > 0
       and legacy_original_discount >= 0 and legacy_paid_amount > 0
       and legacy_original_gross - legacy_original_discount - legacy_paid_amount >= nominal)
  ) not valid;

create or replace function public.guard_tagihan_spp_tarif()
returns trigger
language plpgsql
set search_path to 'public'
as $fn$
declare
  v_jenis record;
  v_siswa record;
  v_tarif numeric;
  v_bruto numeric;
  v_legacy record;
begin
  select nama,tipe,departemen_id into v_jenis
  from public.jenis_pembayaran where id=NEW.jenis_id;
  if not found or v_jenis.tipe is distinct from 'bulanan'
     or lower(btrim(v_jenis.nama)) !~ '^spp([[:space:]-]|$)' then
    if NEW.legacy_source_key is not null then
      raise exception 'Legacy source is restricted to SPP';
    end if;
    return NEW;
  end if;

  select nama,departemen_id,angkatan_id into v_siswa
  from public.siswa where id=NEW.siswa_id;
  if not found then raise exception 'Siswa tagihan SPP tidak ditemukan'; end if;
  if v_jenis.departemen_id is distinct from v_siswa.departemen_id then
    raise exception 'Jenis SPP tidak sesuai lembaga siswa %',v_siswa.nama;
  end if;

  v_tarif := public.get_tarif_siswa(
    NEW.jenis_id,NEW.siswa_id,NEW.kelas_id,NEW.tahun_ajaran_id,v_siswa.angkatan_id
  );
  if v_tarif is null or v_tarif<=0 then
    raise exception 'Tarif SPP belum dikonfigurasi untuk %. Tetapkan tarif terlebih dahulu.',
      v_siswa.nama;
  end if;

  if NEW.legacy_source_key is not null then
    select l.siswa_id,l.period_month,l.gross,l.discount,l.remaining,
           l.gross-l.discount-l.remaining as paid
    into v_legacy
    from migration.legacy_tagihan_snapshot l
    where l.source_key=NEW.legacy_source_key
      and l.snapshot_date=date '2026-09-27'
      and l.disposition in ('hold_historical','hold_current')
      and l.target_tagihan_id is null
      and extract(year from l.period_month)=2026
      and upper(l.source_name) like '%SPP%';
    if not found
      or v_legacy.siswa_id is distinct from NEW.siswa_id
      or v_legacy.gross is distinct from v_tarif
      or v_legacy.paid<=0
      or v_legacy.remaining is distinct from NEW.nominal
      or NEW.nominal_bruto is distinct from NEW.nominal
      or NEW.nominal_diskon is distinct from 0
      or NEW.legacy_original_gross is distinct from v_legacy.gross
      or NEW.legacy_original_discount is distinct from v_legacy.discount
      or NEW.legacy_paid_amount is distinct from v_legacy.paid
      or NEW.status is distinct from 'belum_bayar'
      or NEW.jurnal_piutang_id is null
      or NEW.bulan is distinct from extract(month from v_legacy.period_month)::integer
      or not exists(
        select 1 from public.tahun_buku tb
        where tb.id=NEW.tahun_ajaran_id
          and v_legacy.period_month between tb.tanggal_mulai and tb.tanggal_selesai
      )
    then
      raise exception 'Legacy partial SPP validation failed';
    end if;
    return NEW;
  end if;

  v_bruto := coalesce(NEW.nominal_bruto,NEW.nominal);
  if round(v_bruto,2) is distinct from round(v_tarif,2) then
    raise exception 'Nominal bruto SPP % tidak sesuai tarif efektif % untuk %',
      v_bruto,v_tarif,v_siswa.nama;
  end if;
  return NEW;
end;
$fn$;