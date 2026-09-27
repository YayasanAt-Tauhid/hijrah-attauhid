-- Kunci RPC keuangan/diskon yang hanya dipanggil melalui server admin client.
-- Menutup grant lama ke anon/authenticated tanpa mengubah logika bisnis.

REVOKE ALL ON FUNCTION public.batalkan_tagihan_atomik(uuid,text,text,date,uuid,numeric)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.batalkan_tagihan_batch(uuid[],text,date,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.batalkan_tagihan_atomik(uuid,text,text,date,uuid,numeric)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.batalkan_tagihan_batch(uuid[],text,date,uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.saran_kelompok_keluarga(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.konfirmasi_kelompok_keluarga(text,uuid[],uuid,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.terapkan_diskon_siswa(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.putuskan_diskon_siswa(uuid,boolean,uuid,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hitung_bulan_periode_tagihan(uuid,integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hitung_diskon_tagihan(uuid,uuid,uuid,integer,numeric)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.saran_kelompok_keluarga(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.konfirmasi_kelompok_keluarga(text,uuid[],uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.terapkan_diskon_siswa(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.putuskan_diskon_siswa(uuid,boolean,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hitung_bulan_periode_tagihan(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.hitung_diskon_tagihan(uuid,uuid,uuid,integer,numeric) TO service_role;
