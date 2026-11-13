#!/bin/bash
# Menjalankan tes SQL potongan kakak-adik di salinan database (BUKAN produksi).
# Tiap berkas dibungkus BEGIN ... ROLLBACK sehingga data uji tidak tersisa.
#
# Pakai:
#   DB=nama_database_salinan ./jalankan_uji.sh uji_01_aktif_per_bulan.sql uji_02_akhiri_siswa.sql
#   DB=nama_database_salinan ./jalankan_uji.sh uji_03_cabut_potongan.sql
#   DB=nama_database_salinan ./jalankan_uji.sh uji_04_c2b.sql
#
# Variabel opsional: CONTAINER (default rustbase-deploy-postgres-1), PGUSER_DB (default rustbase).
# Jalankan uji_03 dan uji_04 di transaksi TERPISAH (fixture memakai awalan UUID yang sama).
# Prasyarat: migrasi 20261113031900 s.d. 20261113031903 sudah ada di salinan database.
set -euo pipefail

DB=${DB:?isi DB dengan nama database SALINAN, jangan database produksi}
CONTAINER=${CONTAINER:-rustbase-deploy-postgres-1}
PGUSER_DB=${PGUSER_DB:-rustbase}

if [ "$DB" = "proj_kqylkreswang" ]; then
  echo "Menolak: $DB adalah database produksi." >&2
  exit 2
fi

for f in "$@"; do
  echo "##### $f"
  { echo 'BEGIN;'; cat "$f"; echo 'ROLLBACK;'; } \
    | sudo docker exec -i "$CONTAINER" psql -U "$PGUSER_DB" -X -P pager=off -v ON_ERROR_STOP=1 -d "$DB" 2>&1 \
    | grep -vE '^(BEGIN|ROLLBACK|CREATE TABLE|CREATE FUNCTION|INSERT [0-9]+ [0-9]+|DO)$'
done
