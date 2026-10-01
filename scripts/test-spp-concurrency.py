"""Hanya database fixture lokal disposable. Jalankan setelah schema + migration dipasang."""
import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

db = sys.argv[1] if len(sys.argv) == 2 else ""
if not db.startswith("hijrah_spp_test_"):
    raise SystemExit("Nama database harus hijrah_spp_test_ (fixture lokal, bukan produksi)")

def query(sql):
    result = subprocess.run(
        ["sudo", "-n", "-u", "postgres", "psql", "-h", "/var/run/postgresql",
         "-v", "ON_ERROR_STOP=1", "-At", "-d", db, "-c", sql],
        capture_output=True, text=True, check=True,
    )
    return result.stdout.strip()

query("""
INSERT INTO akun_rekening(kode,nama,jenis,saldo_normal) VALUES
 ('2111','PD SPP','liabilitas','K'),('4101','Pendapatan SPP','pendapatan','K');
INSERT INTO jenis_pembayaran(nama,tipe,nominal,hari_jatuh_tempo,perlu_dimuka,akun_dimuka_id,akun_pendapatan_id)
 SELECT 'SPP TK','bulanan',450000,10,true,a.id,b.id FROM akun_rekening a,akun_rekening b
 WHERE a.kode='2111' AND b.kode='4101';
DO $fixture$
DECLARE g record; t tagihan; jp uuid; kas uuid; rev uuid; r jsonb;
BEGIN
 SELECT id INTO jp FROM jenis_pembayaran WHERE nama='SPP TK';
 SELECT id INTO kas FROM akun_rekening WHERE kode='1101';
 SELECT id INTO rev FROM akun_rekening WHERE kode='4101';
 SELECT * INTO g FROM generate_tagihan_batch(jp,'00000000-0000-0000-0000-000000002027',2,NULL,
   '[{"siswa_id":"00000000-0000-0000-0000-000000000001","kelas_id":null}]',NULL);
 SELECT * INTO t FROM tagihan WHERE jenis_id=jp;
 -- Override kalender hanya dalam fixture untuk menguji balapan pada hari nyata.
 UPDATE tagihan SET jatuh_tempo=(now() AT TIME ZONE 'Asia/Jakarta')::date,
   tanggal_pengakuan=(now() AT TIME ZONE 'Asia/Jakarta')::date+1,
   nominal_bruto=500000,nominal_diskon=50000,status='sebagian' WHERE id=t.id;
 r:=proses_pembayaran_atomik(t.siswa_id,jp,2,100000,
  (now() AT TIME ZONE 'Asia/Jakarta')::date,'Cicilan A',NULL,
  '00000000-0000-0000-0000-000000002026',false,t.id,kas,rev,'Pendapatan','JP',NULL,'SPP TK');
 r:=proses_pembayaran_atomik(t.siswa_id,jp,2,200000,
  (now() AT TIME ZONE 'Asia/Jakarta')::date,'Cicilan B',NULL,
  '00000000-0000-0000-0000-000000002026',false,t.id,kas,rev,'Pendapatan','JP',NULL,'SPP TK');
UPDATE tagihan SET tanggal_pengakuan=(now() AT TIME ZONE 'Asia/Jakarta')::date WHERE id=t.id;
END; $fixture$;
""")
ids=query("SELECT id FROM pendapatan_dimuka ORDER BY created_at,id").splitlines()
assert len(ids)==2, ids
def recognize(identifier):
    return json.loads(query("SELECT akui_pendapatan_dimuka_atomik('"+identifier+"')"))
with ThreadPoolExecutor(max_workers=3) as pool:
    results=list(pool.map(recognize,[ids[0],ids[0],ids[1]]))
assert sorted(item["diakui"] for item in results)==[False,True,True],results
assert results[0]["jurnal_id"]==results[1]["jurnal_id"],results
assert query("SELECT count(*) FROM jurnal WHERE nomor LIKE 'JPI-%'")=="1"
assert query("SELECT count(*) FROM jurnal WHERE nomor LIKE 'PD-%'")=="2"
assert float(query("SELECT sum(kredit-debit) FROM jurnal_detail d JOIN akun_rekening a ON a.id=d.akun_id WHERE a.kode='4101'"))==500000
assert float(query("SELECT sum(debit-kredit) FROM jurnal_detail d JOIN akun_rekening a ON a.id=d.akun_id WHERE a.kode='1300'"))==150000
assert float(query("SELECT sum(kredit-debit) FROM jurnal_detail d JOIN akun_rekening a ON a.id=d.akun_id WHERE a.kode='2111'"))==0
assert query("SELECT count(*) FROM (SELECT jurnal_id FROM jurnal_detail GROUP BY jurnal_id HAVING sum(debit)<>sum(kredit)) invalid")=="0"
print("PASS concurrency: 3 calls, 2 installments recognized once each, 1 discount/receivable journal")

# Paksa pembatalan menunggu lock tagihan yang sedang diakui oleh proses lain.
query("""
DO $fixture$
DECLARE g record; t tagihan; jp uuid; kas uuid; rev uuid; r jsonb;
BEGIN
 SELECT id INTO jp FROM jenis_pembayaran WHERE nama='SPP TK';
 SELECT id INTO kas FROM akun_rekening WHERE kode='1101';
 SELECT id INTO rev FROM akun_rekening WHERE kode='4101';
 SELECT * INTO g FROM generate_tagihan_batch(jp,'00000000-0000-0000-0000-000000002027',2,NULL,
   '[{"siswa_id":"00000000-0000-0000-0000-000000000002","kelas_id":null}]',NULL);
 SELECT * INTO t FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000000002' AND jenis_id=jp;
 UPDATE tagihan SET jatuh_tempo=(now() AT TIME ZONE 'Asia/Jakarta')::date,
   tanggal_pengakuan=(now() AT TIME ZONE 'Asia/Jakarta')::date+1,
   nominal_bruto=500000,nominal_diskon=50000,status='sebagian' WHERE id=t.id;
 PERFORM proses_pembayaran_atomik(t.siswa_id,jp,2,100000,
   (now() AT TIME ZONE 'Asia/Jakarta')::date,'Race A',NULL,
   '00000000-0000-0000-0000-000000002026',false,t.id,kas,rev,'Pendapatan','JP',NULL,'SPP TK');
 PERFORM proses_pembayaran_atomik(t.siswa_id,jp,2,200000,
   (now() AT TIME ZONE 'Asia/Jakarta')::date,'Race B',NULL,
   '00000000-0000-0000-0000-000000002026',false,t.id,kas,rev,'Pendapatan','JP',NULL,'SPP TK');
UPDATE tagihan SET tanggal_pengakuan=(now() AT TIME ZONE 'Asia/Jakarta')::date WHERE id=t.id;
END; $fixture$;
""")
bill=query("SELECT id FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000000002'")
cancel_id=query("SELECT id FROM pembayaran WHERE tagihan_id='"+bill+"' AND jumlah=100000")
pending_id=query("SELECT pd.id FROM pendapatan_dimuka pd JOIN pembayaran p ON p.id=pd.pembayaran_id WHERE p.tagihan_id='"+bill+"' AND p.jumlah=200000")
revenue_before=float(query("SELECT sum(kredit-debit) FROM jurnal_detail d JOIN akun_rekening a ON a.id=d.akun_id WHERE a.kode='4101'"))
with ThreadPoolExecutor(max_workers=1) as pool:
    job=pool.submit(query,"BEGIN; SET application_name='spp_helper_race'; SELECT posting_spp_tagihan_atomik('"+bill+"'); SELECT pg_sleep(1); COMMIT;")
    ready=False
    for _ in range(100):
        ready=query("SELECT count(*) FROM pg_stat_activity WHERE application_name='spp_helper_race' AND wait_event='PgSleep'")=="1"
        if ready:
            break
        time.sleep(0.01)
    assert ready, "Proses helper tidak mencapai barrier lock"
    query("SELECT batalkan_pembayaran_atomik('"+cancel_id+"','Race test',(now() AT TIME ZONE 'Asia/Jakarta')::date,NULL)")
    job.result()
assert query("SELECT count(*) FROM pembayaran WHERE tagihan_id='"+bill+"'")=="1"
assert float(query("SELECT sum(debit-kredit) FROM jurnal_detail d JOIN jurnal j ON j.id=d.jurnal_id JOIN akun_rekening a ON a.id=d.akun_id WHERE a.kode='1300' AND j.referensi='"+bill+"'"))==250000
recognize(pending_id)
assert float(query("SELECT sum(kredit-debit) FROM jurnal_detail d JOIN akun_rekening a ON a.id=d.akun_id WHERE a.kode='4101'"))==revenue_before+500000
assert float(query("SELECT sum(kredit-debit) FROM jurnal_detail d JOIN akun_rekening a ON a.id=d.akun_id WHERE a.kode='2111'"))==0
print("PASS concurrency cancellation: bill lock barrier, receivable restored 250000, service revenue retained")
