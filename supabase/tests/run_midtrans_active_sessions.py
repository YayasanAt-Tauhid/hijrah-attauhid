
#!/usr/bin/env python3
"""Run isolated PostgreSQL session/payment race tests (requires Docker)."""
from pathlib import Path
import json
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
container = "hijrah-payment-test-" + uuid.uuid4().hex[:10]

def sql(query, check=True):
    result = subprocess.run(
        ["docker", "exec", "-i", container, "psql", "-U", "postgres", "-At", "-v", "ON_ERROR_STOP=1"],
        input=query, text=True, capture_output=True,
    )
    if check and result.returncode:
        raise RuntimeError(result.stderr)
    return result

try:
    subprocess.run(["docker", "run", "--rm", "-d", "--name", container, "--network", "none",
                    "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17"],
                   check=True, capture_output=True, text=True)
    for attempt in range(30):
        ready = subprocess.run(["docker", "exec", container, "pg_isready", "-U", "postgres"],
                               capture_output=True)
        if ready.returncode == 0:
            break
        time.sleep(0.2)
    else:
        raise RuntimeError("Isolated PostgreSQL did not become ready")
    fixture = (ROOT / "supabase/tests/fixtures/midtrans_session_schema.sql").read_text()
    prior = (ROOT / "supabase/migrations/20261005030256_uang_pangkal_cicilan_dimuka.sql").read_text()
    start = prior.index("CREATE OR REPLACE FUNCTION public.proses_pembayaran_midtrans_atomik(")
    end = prior.index("$function$;", prior.index("AS $function$", start)) + len("$function$;")
    core = prior[start:end]
    migration = (ROOT / "supabase/migrations/20261009000000_midtrans_active_bill_sessions.sql").read_text()
    assertions = (ROOT / "supabase/tests/midtrans_active_sessions.sql").read_text()
    sql(fixture + "\n" + core + "\n" + migration + "\n" + assertions)
    user, student, kind, year, bill = [str(uuid.uuid4()) for _ in range(5)]
    sql(f"INSERT INTO ortu_siswa VALUES('{user}','{student}'); "
        f"INSERT INTO tagihan(id,siswa_id,jenis_id,tahun_ajaran_id,nominal,status) "
        f"VALUES('{bill}','{student}','{kind}','{year}',4200000,'sebagian');")
    items = json.dumps([dict(tagihan_id=bill, siswa_id=student, jenis_id=kind,
                            tahun_ajaran_id=year, bulan=0, jumlah=2000000, nama_item="Race test")])
    def checkout(order):
        return f"SELECT create_midtrans_checkout_atomik('{user}','{order}','{items}'::jsonb,now()+interval '24 hours');"
    def launch(query):
        return subprocess.Popen(
            ["docker", "exec", container, "psql", "-U", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-c", query],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
    first = launch("BEGIN; " + checkout("HAT-RACE-A") + " SELECT pg_sleep(2); COMMIT;")
    time.sleep(0.5)
    second = sql(checkout("HAT-RACE-B"), False)
    _, error = first.communicate(timeout=10)
    assert first.returncode == 0, error
    assert second.returncode != 0 and "Masih ada transaksi online" in second.stderr, second.stderr
    assert sql("SELECT count(*) FROM transaksi_midtrans WHERE order_id LIKE 'HAT-RACE-%';").stdout.strip() == "1"
    sql("UPDATE transaksi_midtrans SET status='expired',gateway_closed_at=now() WHERE order_id='HAT-RACE-A';")
    cashier = launch(f"BEGIN; SELECT id FROM tagihan WHERE id='{bill}' FOR UPDATE; "
                     f"INSERT INTO pembayaran(tagihan_id,siswa_id,jenis_id,jumlah) "
                     f"VALUES('{bill}','{student}','{kind}',3200000); SELECT pg_sleep(2); COMMIT;")
    time.sleep(0.5)
    third = sql(checkout("HAT-RACE-C"), False)
    _, error = cashier.communicate(timeout=10)
    assert cashier.returncode == 0, error
    assert third.returncode != 0 and "Saldo tagihan berubah" in third.stderr, third.stderr
    print("PASS: atomic checkout, cashier guard, settlement retries, final statuses, balance and concurrency.")
finally:
    subprocess.run(["docker", "rm", "-f", container], capture_output=True)
