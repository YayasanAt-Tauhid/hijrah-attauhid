-- Hapus siswa dengan penjaga riwayat.
--
-- Masalah: tombol hapus di Data Siswa langsung menjalankan DELETE pada `siswa`.
-- Tabel dengan FK NO ACTION (mis. transaksi_midtrans_item) menolak dengan galat
-- mentah, sedangkan tabel dengan ON DELETE CASCADE (tagihan, tabungan, dst.)
-- ikut terhapus diam-diam: siswa yang punya tagihan tetapi belum bayar bisa
-- hilang beserta tagihannya.
--
-- Prinsip:
--  * Hapus permanen hanya untuk data salah input: siswa yang tidak punya baris
--    apa pun di tabel manapun yang merujuknya, selain tabel pendamping profil
--    (siswa_detail, ortu_siswa, siswa_tahun_masuk_departemen).
--  * Tabel yang merujuk `siswa` ditemukan dari katalog FK (pg_constraint),
--    bukan daftar tetap, sehingga tabel baru di masa depan otomatis ikut
--    melindungi siswa. Tabel CASCADE dan SET NULL ikut dihitung sebagai riwayat.
--  * Bila ada riwayat, tidak ada yang dihapus; RPC mengembalikan daftar tabel
--    dan jumlah barisnya. Siswa seperti itu diproses lewat perubahan status
--    (keluar, alumni, pindah, mengundurkan diri), bukan dihapus.
--  * Atomik dan terkunci: baris siswa dikunci (FOR UPDATE) selama pemeriksaan
--    sehingga riwayat baru tidak bisa menyelip di antara hitung dan hapus.
--
-- Hanya service_role yang boleh memanggil; otorisasi lembaga dilakukan server
-- function `hapusSiswa`, peran dicek ulang di sini.
--
-- Tidak diterapkan otomatis ke produksi: terapkan manual setelah konfirmasi.

CREATE OR REPLACE FUNCTION public.hapus_siswa(
  p_siswa_id uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  s public.siswa;
  fk record;
  v_pendamping constant text[] := ARRAY['siswa_detail','ortu_siswa','siswa_tahun_masuk_departemen'];
  v_count bigint;
  v_nama text;
  v_riwayat jsonb := '[]'::jsonb;
BEGIN
  -- Otorisasi lembaga dilakukan server function; peran dicek ulang di sini.
  IF p_actor_id IS NULL OR NOT (
    public.has_role(p_actor_id,'admin') OR public.has_role(p_actor_id,'admin_tu')
  ) THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;

  SELECT * INTO s FROM public.siswa WHERE id = p_siswa_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'alasan', 'tidak_ditemukan');
  END IF;

  IF NOT public.has_role(p_actor_id,'admin')
     AND NOT COALESCE(public.can_manage_akademik_departemen(p_actor_id, s.departemen_id), false) THEN
    RETURN jsonb_build_object('ok', false, 'alasan', 'tidak_berwenang');
  END IF;

  -- Hitung baris di setiap tabel yang merujuk siswa (kecuali tabel pendamping).
  FOR fk IN
    SELECT n.nspname,
           cl.relname,
           c.conname,
           array_length(c.conkey, 1) AS jumlah_kolom,
           (SELECT a.attname FROM pg_attribute a
             WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) AS kolom,
           (SELECT a.attname FROM pg_attribute a
             WHERE a.attrelid = c.confrelid AND a.attnum = c.confkey[1]) AS kolom_acuan
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.siswa'::regclass
      AND c.conparentid = 0
    ORDER BY n.nspname, cl.relname, c.conname
  LOOP
    IF fk.jumlah_kolom <> 1 THEN
      RAISE EXCEPTION 'FK komposit ke siswa belum didukung: %.% (%)', fk.nspname, fk.relname, fk.conname;
    END IF;

    IF fk.nspname = 'public' AND fk.relname = ANY (v_pendamping) THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'SELECT count(*) FROM %I.%I t WHERE t.%I = (SELECT r.%I FROM public.siswa r WHERE r.id = $1)',
      fk.nspname, fk.relname, fk.kolom, fk.kolom_acuan
    ) INTO v_count USING p_siswa_id;

    IF v_count > 0 THEN
      v_nama := CASE WHEN fk.nspname = 'public' THEN fk.relname ELSE fk.nspname || '.' || fk.relname END;
      -- Satu tabel bisa punya beberapa FK ke siswa: jumlahkan per tabel.
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_riwayat) e WHERE e->>'tabel' = v_nama) THEN
        SELECT COALESCE(jsonb_agg(
                 CASE WHEN e->>'tabel' = v_nama
                      THEN jsonb_build_object('tabel', v_nama, 'jumlah', (e->>'jumlah')::bigint + v_count)
                      ELSE e END), '[]'::jsonb)
          INTO v_riwayat
          FROM jsonb_array_elements(v_riwayat) e;
      ELSE
        v_riwayat := v_riwayat || jsonb_build_array(jsonb_build_object('tabel', v_nama, 'jumlah', v_count));
      END IF;
    END IF;
  END LOOP;

  IF jsonb_array_length(v_riwayat) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'alasan', 'punya_riwayat', 'riwayat', v_riwayat);
  END IF;

  -- Tanpa riwayat: lepaskan tabel pendamping secara eksplisit (tidak semua FK-nya CASCADE).
  FOR fk IN
    SELECT n.nspname,
           cl.relname,
           (SELECT a.attname FROM pg_attribute a
             WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) AS kolom,
           (SELECT a.attname FROM pg_attribute a
             WHERE a.attrelid = c.confrelid AND a.attnum = c.confkey[1]) AS kolom_acuan
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.siswa'::regclass
      AND c.conparentid = 0
      AND array_length(c.conkey, 1) = 1
      AND n.nspname = 'public'
      AND cl.relname = ANY (v_pendamping)
  LOOP
    EXECUTE format(
      'DELETE FROM %I.%I t WHERE t.%I = (SELECT r.%I FROM public.siswa r WHERE r.id = $1)',
      fk.nspname, fk.relname, fk.kolom, fk.kolom_acuan
    ) USING p_siswa_id;
  END LOOP;

  DELETE FROM public.siswa WHERE id = p_siswa_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.hapus_siswa(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hapus_siswa(uuid, uuid)
  TO service_role;
