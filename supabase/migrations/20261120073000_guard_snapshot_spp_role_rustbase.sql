-- Izinkan role pemilik fungsi di Rustbase pada guard_snapshot_spp_tagihan.
--
-- Latar: guard ini (versi 20261006040000_spp_period_nominal) hanya mengenali current_user 'postgres'
-- untuk perubahan nominal_bruto/snapshot SPP dari fungsi sistem SECURITY DEFINER. Di Rustbase
-- (proj_kqylkreswang) fungsi aplikasi dimiliki dan dijalankan sebagai 'proj_kqylkreswang_admin',
-- sehingga terbitkan_ulang_tagihan_batal selalu ditolak dengan pesan
-- "Snapshot SPP hanya dapat disesuaikan melalui alur kategori per periode" (uang pangkal maupun SPP).
--
-- Perubahan: 'proj_kqylkreswang_admin' diperlakukan sama dengan 'postgres' di dua pemeriksaan.
-- Protokol otorisasi lain tidak berubah (baris spp_kategori_periode_audit pada transaksi yang sama,
-- larangan mengubah tagihan historis/sudah ditransaksikan).
--
-- Sudah diterapkan manual di produksi Rustbase 20 Nov 2026 (kasus Bariq Khairullah Taufiqurrahman,
-- pindah asrama -> non asrama). Migration ini idempoten: menerima definisi lama maupun yang sudah diperbaiki.

DO $preflight$
DECLARE
  v_md5 text := md5(pg_get_functiondef('public.guard_snapshot_spp_tagihan()'::regprocedure));
BEGIN
  IF v_md5 NOT IN ('2903697d144a3970a684e25f8a200a20', '6f53cb7eb13506032b039955e8528e93') THEN
    RAISE EXCEPTION 'guard_snapshot_spp_tagihan berubah sejak versi yang ditinjau (md5 %); tinjau ulang', v_md5;
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.guard_snapshot_spp_tagihan()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_snapshot record;
  v_authorized boolean:=false;
  v_old_bruto numeric;
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT * INTO v_snapshot FROM public.snapshot_spp_periode(
      NEW.jenis_id,NEW.siswa_id,COALESCE(NEW.tanggal_pengakuan,NEW.jatuh_tempo));
    NEW.spp_kategori:=v_snapshot.kategori;
    NEW.spp_akun_pendapatan_id:=v_snapshot.akun_id;
  ELSE
    IF OLD.spp_kategori IS NOT NULL AND
       (NEW.siswa_id IS DISTINCT FROM OLD.siswa_id OR NEW.jenis_id IS DISTINCT FROM OLD.jenis_id) THEN
      RAISE EXCEPTION 'Identitas tagihan dengan snapshot SPP tidak dapat diubah';
    END IF;

    IF NEW.spp_kategori IS DISTINCT FROM OLD.spp_kategori
       OR NEW.spp_akun_pendapatan_id IS DISTINCT FROM OLD.spp_akun_pendapatan_id
       OR NEW.nominal_bruto IS DISTINCT FROM OLD.nominal_bruto THEN
      v_old_bruto:=COALESCE(OLD.nominal_bruto,OLD.nominal+COALESCE(OLD.nominal_diskon,0));

      IF current_user IN ('postgres','service_role','proj_kqylkreswang_admin') THEN
        SELECT EXISTS(
          SELECT 1
          FROM public.spp_kategori_periode_audit a
          CROSS JOIN LATERAL jsonb_array_elements(a.perubahan) e
          WHERE a.transaction_id=txid_current()
            AND a.siswa_id=OLD.siswa_id
            AND a.jenis_id=OLD.jenis_id
            AND e->>'tagihan_id'=OLD.id::text
            AND e->>'aksi'='ubah_tagihan'
            AND (e->>'kategori_lama') IS NOT DISTINCT FROM OLD.spp_kategori
            AND (e->>'akun_lama') IS NOT DISTINCT FROM OLD.spp_akun_pendapatan_id::text
            AND e->>'kategori_baru'=NEW.spp_kategori
            AND e->>'akun_baru'=NEW.spp_akun_pendapatan_id::text
            AND (e->>'nominal_bruto_lama')::numeric IS NOT DISTINCT FROM v_old_bruto
            AND (e->>'nominal_bruto_baru')::numeric IS NOT DISTINCT FROM NEW.nominal_bruto
            AND (e->>'nominal_diskon_lama')::numeric IS NOT DISTINCT FROM COALESCE(OLD.nominal_diskon,0)
            AND (e->>'nominal_diskon_baru')::numeric IS NOT DISTINCT FROM COALESCE(NEW.nominal_diskon,0)
            AND (e->>'nominal_netto_lama')::numeric IS NOT DISTINCT FROM OLD.nominal
            AND (e->>'nominal_netto_baru')::numeric IS NOT DISTINCT FROM NEW.nominal
            AND (e->>'siswa_diskon_id_lama') IS NOT DISTINCT FROM OLD.siswa_diskon_id::text
            AND (e->>'siswa_diskon_id_baru') IS NOT DISTINCT FROM NEW.siswa_diskon_id::text
        ) INTO v_authorized;
      END IF;

      IF v_authorized THEN
        IF OLD.status NOT IN ('terjadwal','belum_bayar') OR OLD.jurnal_piutang_id IS NOT NULL
           OR OLD.pembayaran_id IS NOT NULL OR OLD.jurnal_pembalik_id IS NOT NULL
           OR OLD.write_off_id IS NOT NULL OR OLD.pengakuan_spp_selesai IS DISTINCT FROM false
           OR COALESCE(OLD.legacy_paid_amount,0)>0
           OR COALESCE(OLD.tanggal_pengakuan,OLD.jatuh_tempo) IS NULL
           OR date_trunc('month',COALESCE(OLD.tanggal_pengakuan,OLD.jatuh_tempo))
              <=date_trunc('month',now() AT TIME ZONE 'Asia/Jakarta')
           OR EXISTS(SELECT 1 FROM public.pembayaran WHERE tagihan_id=OLD.id) THEN
          RAISE EXCEPTION 'Tagihan historis atau sudah ditransaksikan tidak boleh disesuaikan';
        END IF;
      ELSIF current_user NOT IN ('postgres','proj_kqylkreswang_admin')
            OR OLD.spp_kategori IS NOT NULL
            OR OLD.spp_akun_pendapatan_id IS NOT NULL THEN
        RAISE EXCEPTION 'Snapshot SPP hanya dapat disesuaikan melalui alur kategori per periode';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
