#!/usr/bin/env python3
"""Read old POS student arrears one student at a time; never writes payments.

Input CSV columns: siswa_id,nama,nik (optional nisn). Run from a private
terminal: python3 legacy_tagihan_extract.py --roster roster.csv --out result.jsonl
Credentials are prompted on the terminal and are never written to disk.
"""

import argparse
import csv
import getpass
import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from lxml import html


BASE = "https://attauhid.kreasinternasional.com"
def encode_login(value, secret, salt, iv, iterations):
    key = hashlib.pbkdf2_hmac("sha256", secret.encode(), salt.encode(), iterations, 32)
    data = value.encode("utf-8")
    data += bytes([16 - len(data) % 16]) * (16 - len(data) % 16)
    encryptor = Cipher(algorithms.AES(key), modes.CBC(iv.encode())).encryptor()
    cipher_hex = (encryptor.update(data) + encryptor.finalize()).hex()
    return cipher_hex.encode("ascii").hex()  # site's bin2hex(ciphertext hex)


def login(session, username, password):
    page = session.get(BASE + "/login", timeout=30)
    page.raise_for_status()
    def required(pattern):
        match = re.search(pattern, page.text)
        if not match:
            raise RuntimeError("Parameter login aplikasi lama berubah")
        return match.group(1)
    salt = required(r"var\s+salt\s*=\s*'([^']+)'\s*;")
    iv = required(r"var\s+iv\s*=\s*'([^']+)'\s*;")
    iterations = int(required(r"var\s+iterations\s*=\s*'([0-9]+)'\s*;"))
    secret = required(r'CryptoJSAesEncrypt\("([^"]+)",b\)')
    payload = {
        "user-id_": encode_login(username, secret, salt, iv, iterations),
        "password_": encode_login(hashlib.md5(password.encode()).hexdigest(),
                                  secret, salt, iv, iterations),
    }
    response = session.post(BASE + "/login/check", data=payload, timeout=30)
    response.raise_for_status()
    # A returned login form indicates a failed login, even if HTTP status is 200.
    path = urlparse(response.url).path
    if path != "/home":
        raise RuntimeError(
            f"Login belum masuk ke /home (respons: {path}, HTTP {response.status_code}). "
            "Periksa User ID dan sandi di terminal; jangan kirim sandi ke chat."
        )


def old_student(session, nik, name, alternate_nik=""):
    # The autocomplete is name-oriented; searching a NIK can return unrelated
    # suggestions. Match the returned NIK exactly before reading any bills.
    allowed = {value.strip() for value in (nik, alternate_nik)\n               if (value or "").strip().isdigit()}
    words = name.split()
    queries = [name, " ".join(words[:2]), " ".join(words[-2:])]
    seen = set()
    for query in queries:
        query = query.strip()
        if not query or query.casefold() in seen:
            continue
        seen.add(query.casefold())
        response = session.post(BASE + "/general/auto_murid", data={"query": query}, timeout=30)
        response.raise_for_status()
        suggestions = response.json()
        if not isinstance(suggestions, str):
            raise RuntimeError("Format pencarian siswa berubah")
        root = html.fromstring(suggestions or "<div></div>")
        matches = [" ".join(li.text_content().split()) for li in root.xpath("//li")]
        matches = [item for item in matches if item.split(":", 1)[0].strip() in allowed]
        if matches:
            return list(dict.fromkeys(matches))
    return []


def bills(session, selected):
    response = session.post(
        BASE + "/keuangan_pos/pos_penerimaan/siswa/tabel_tagihan",
        data={"id": selected, "all": "1"}, timeout=45,
    )
    response.raise_for_status()
    data = response.json()
    if data.get("status") != "OK":
        raise RuntimeError("Endpoint tagihan menolak permintaan")
    root = html.fromstring(data.get("resp") or "<div></div>")
    rows = root.xpath("//tr[starts-with(@id, 'tbl-')]")
    items = []
    for row in rows:
        cells = [" ".join(td.text_content().split()) for td in row.xpath("./td")]
        if len(cells) < 5:
            raise RuntimeError("Kolom tagihan berubah")
        description = cells[1]
        money = [re.sub(r"[^\d]", "", cells[i]) for i in (2, 3, 4)]
        if any(not value for value in money):
            raise RuntimeError("Nominal tagihan tidak terbaca")
        period = re.search(r"\(\s*([A-Z]+)\s+(20\d\d)\s*\)\s*$", description.upper())
        month_names = {"JANUARI": 1, "FEBRUARI": 2, "MARET": 3, "APRIL": 4,
                       "MEI": 5, "JUNI": 6, "JULI": 7, "AGUSTUS": 8,
                       "SEPTEMBER": 9, "OKTOBER": 10, "NOVEMBER": 11,
                       "DESEMBER": 12}
        year_month = None
        if period and period.group(1) in month_names:
            year_month = f"{period.group(2)}-{month_names[period.group(1)]:02d}"
        now_month = datetime.now().strftime("%Y-%m")
        category = ("perlu_tinjau" if year_month is None else
                    "tertunggak" if year_month < now_month else
                    "berjalan" if year_month == now_month else "mendatang")
        items.append({"nama_biaya_lama": description, "periode": year_month,
                      "kategori_waktu": category, "biaya_dasar": int(money[0]),
                      "diskon_lama": int(money[1]), "sisa_tagihan": int(money[2])})
    return items


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--roster", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--match-name", help="Pilih satu siswa dari roster untuk uji")
    parser.add_argument("--delay", type=float, default=0.5)
    parser.add_argument("--resume", action="store_true", help="Lanjutkan file hasil yang terputus")
    args = parser.parse_args()
    if args.out.exists() and not args.resume:
        parser.error("Output sudah ada; pakai --resume atau gunakan nama baru")
    if args.resume and not args.out.exists():
        parser.error("File hasil untuk --resume tidak ditemukan")
    with args.roster.open(newline="", encoding="utf-8") as source:
        rows = list(csv.DictReader(source))
    if args.match_name:
        rows = [row for row in rows if row.get("nama", "").casefold() == args.match_name.casefold()]
        if len(rows) != 1:
            parser.error(f"Nama uji harus tepat satu siswa; ditemukan {len(rows)}")
    completed = set()
    counters = {"ok": 0, "unmatched": 0, "ambiguous": 0, "error": 0}
    if args.resume:
        with args.out.open(encoding="utf-8") as previous:
            for line in previous:
                record = json.loads(line)
                if record["siswa_id"] in completed:
                    parser.error("File hasil memuat siswa ganda; hentikan untuk pemeriksaan")
                completed.add(record["siswa_id"])
                counters[record["status"]] += 1
    remaining = [row for row in rows[:args.limit or None] if row.get("siswa_id") not in completed]
    if not remaining:
        print("Seluruh siswa pada cakupan ini sudah diproses:", json.dumps(counters))
        return
    username = input("User ID aplikasi lama: ")
    password = getpass.getpass("Password aplikasi lama: ")
    session = requests.Session()
    login(session, username, password)
    del password
    flags = os.O_WRONLY | os.O_APPEND if args.resume else os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(args.out, flags, 0o600)
    with os.fdopen(fd, "a" if args.resume else "w", encoding="utf-8") as output:
        for row in remaining:
            nik = (row.get("nik") or "").strip()
            result = {"siswa_id": row.get("siswa_id"), "nama": row.get("nama"),
                      "nik": nik, "diambil_at": datetime.now(timezone.utc).isoformat()}
            try:
                if not any((v or "").strip().isdigit() for v in
                           (nik, row.get("nik_alternatif", ""))):
                    result["status"] = "unmatched"
                else:
                    matches = old_student(session, nik, row.get("nama") or "",
                                          (row.get("nik_alternatif") or "").strip())
                    if len(matches) == 1:
                        result["status"] = "ok"
                        result["identitas_lama"] = matches[0]
                        result["tagihan"] = bills(session, matches[0])
                    else:
                        result["status"] = "ambiguous" if matches else "unmatched"
                        result["jumlah_kandidat"] = len(matches)
            except (requests.RequestException, ValueError, RuntimeError) as exc:
                result["status"] = "error"
                result["error"] = type(exc).__name__
            counters[result["status"]] += 1
            output.write(json.dumps(result, ensure_ascii=False) + "\n")
            output.flush()
            if sum(counters.values()) % 25 == 0:
                print("Diproses:", sum(counters.values()), "/", len(rows), flush=True)
            time.sleep(max(0, args.delay))
    print(json.dumps(counters))
    print("Hasil privat:", args.out)


if __name__ == "__main__":
    main()
