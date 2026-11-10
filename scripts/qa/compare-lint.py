"""Compare ESLint results (eslint -f json) while retaining existing baseline failures.

Meniru compare-typecheck.py: masalah dicocokkan menurut (file, aturan, tingkat, pesan)
tanpa nomor baris (termasuk "at line N" di dalam teks pesan), sehingga pergeseran baris tidak dihitung baru. Gagal hanya bila ada
ERROR baru; peringatan baru dilaporkan tetapi tidak menggagalkan.
"""
import argparse
from collections import Counter
import json
import os
from pathlib import Path
import re

parser = argparse.ArgumentParser()
parser.add_argument("--base", type=Path, required=True, help="eslint -f json untuk commit dasar")
parser.add_argument("--current", type=Path, required=True, help="eslint -f json untuk PR")
parser.add_argument("--base-root", type=Path, required=True, help="root worktree commit dasar")
parser.add_argument("--current-root", type=Path, required=True, help="root worktree PR")
parser.add_argument("--label", required=True)
args = parser.parse_args()

SEVERITY = {1: "warning", 2: "error"}


# Beberapa pesan ESLint memuat nomor baris di dalam teksnya (mis. react-hooks/exhaustive-deps:
# "... useEffect Hook (at line 330) ..."). Nomor itu bergeser bila baris lain berubah, jadi
# dinormalkan; bagian pesan lainnya tetap dibandingkan apa adanya.
LINE_REFERENCE = re.compile(r"\bat line \d+")


def normalize(message):
    return LINE_REFERENCE.sub("at line N", message)


def relative(file_path, root):
    return Path(os.path.relpath(file_path, root)).as_posix()


def problems(path, root):
    status = int(path.with_suffix(".exit").read_text().strip())
    results = json.loads(path.read_text())
    found = Counter()
    for result in results:
        file = relative(result["filePath"], root)
        for message in result["messages"]:
            key = (
                file,
                message.get("ruleId") or "(parse)",
                SEVERITY[message["severity"]],
                normalize(message["message"]),
            )
            found[key] += 1
    errors = sum(count for key, count in found.items() if key[2] == "error")
    # ESLint: 0 = tanpa error, 1 = ada error lint, 2 = galat konfigurasi/fatal.
    if status not in (0, 1) or (status == 1 and not errors):
        raise SystemExit("Incomplete ESLint check: " + str(path) + ", exit " + str(status))
    return found, errors, sum(found.values()) - errors, status


base, base_errors, base_warnings, _ = problems(args.base, args.base_root)
current, current_errors, current_warnings, current_status = problems(args.current, args.current_root)
new = current - base
new_errors = sum(count for key, count in new.items() if key[2] == "error")
new_warnings = new.total() - new_errors
report = {
    "label": args.label,
    "baseline_errors": base_errors,
    "baseline_warnings": base_warnings,
    "current_errors": current_errors,
    "current_warnings": current_warnings,
    "new_errors": new_errors,
    "new_warnings": new_warnings,
    "lint_passed": current_status == 0,
    "new": [
        {"file": key[0], "rule": key[1], "severity": key[2], "message": key[3], "count": count}
        for key, count in sorted(new.items(), key=lambda item: (item[0][2] != "error", item[0]))
    ],
}
args.current.with_suffix(".report.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
summary = os.environ.get("GITHUB_STEP_SUMMARY")
if summary:
    with open(summary, "a") as out:
        out.write(
            f"### ESLint: {args.label}\n\n"
            f"Baseline: {base_errors} errors, {base_warnings} warnings. "
            f"Current: {current_errors} errors, {current_warnings} warnings. "
            f"New: {new_errors} errors, {new_warnings} warnings.\n\n"
            f"Lint passed: {current_status == 0}.\n\n"
        )
raise SystemExit(1 if new_errors else 0)
