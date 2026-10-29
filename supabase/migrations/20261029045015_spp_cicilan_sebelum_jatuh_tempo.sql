-- Cicilan SPP sebelum tanggal pengakuan (status terjadwal).
--
-- Sebelumnya proses_pembayaran_atomik menolak pembayaran sebagian untuk SPP yang
-- belum sampai tanggal pengakuannya ("Tagihan yang belum jatuh tempo harus
-- dibayar penuh"). Keputusan pemilik 29 Oktober 2026: SPP boleh dicicil sebelum
-- jatuh tempo. Pembayaran tetap masuk ke Pendapatan Diterima di Muka (akun
-- ditentukan fungsi dari ada/tidaknya jurnal piutang) dan pengakuan SPP
-- menghitung sisa dari total terbayar, sehingga hanya guard ini yang diubah.
--
-- Perubahan ditambal dari definisi fungsi yang sedang berjalan (bukan salinan
-- ulang seluruh badan fungsi) dan dibatalkan bila pola guard tidak ditemukan
-- tepat satu kali. Owner, ACL, SECURITY DEFINER, dan search_path tetap karena
-- memakai CREATE OR REPLACE dari definisi yang sama.
DO $migrasi$
DECLARE
  v_oid regprocedure := 'public.proses_pembayaran_atomik(uuid,uuid,integer,numeric,date,text,uuid,uuid,boolean,uuid,uuid,uuid,text,text,uuid,text)'::regprocedure;
  v_def text;
  v_old constant text := 'AND NOT (v_is_spp AND COALESCE(public.tanggal_pengakuan_tagihan(v_tagihan.id) <= p_tanggal_bayar,false))';
  v_new constant text := 'AND NOT v_is_spp';
BEGIN
  v_def := pg_get_functiondef(v_oid);
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'Pola guard cicilan SPP tidak ditemukan tepat satu kali; migrasi dibatalkan';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$migrasi$;
