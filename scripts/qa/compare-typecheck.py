"""Compare complete tsc diagnostics while retaining existing baseline failures."""
import argparse
from collections import Counter
import json
import os
from pathlib import Path
import re

parser = argparse.ArgumentParser()
parser.add_argument("--base", type=Path, required=True)
parser.add_argument("--current", type=Path, required=True)
parser.add_argument("--label", required=True)
args = parser.parse_args()
pattern = re.compile(r"^(.+?)\(\d+,\d+\): error (TS\d+): (.*)$")


def diagnostics(path):
    status = int(path.with_suffix(".exit").read_text().strip())
    lines = path.read_text().splitlines()
    errors = Counter(
        (match[1], match[2], match[3])
        for line in lines
        if (match := pattern.match(line))
    )
    if status not in (0, 2) or (status != 0 and not errors):
        raise SystemExit("Incomplete TypeScript check: " + str(path) + ", exit " + str(status))
    return errors, status


base, base_status = diagnostics(args.base)
current, current_status = diagnostics(args.current)
new = current - base
report = {
    "label": args.label,
    "baseline_diagnostics": base.total(),
    "current_diagnostics": current.total(),
    "new_diagnostics": new.total(),
    "full_typecheck_passed": current_status == 0,
    "new": [
        {"file": key[0], "code": key[1], "message": key[2], "count": count}
        for key, count in sorted(new.items())
    ],
}
args.current.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
summary = os.environ.get("GITHUB_STEP_SUMMARY")
if summary:
    with open(summary, "a") as out:
        out.write(
            f"### TypeScript: {args.label}\n\n"
            f"Baseline diagnostics: {base.total()}. Current diagnostics: {current.total()}. "
            f"New diagnostics: {new.total()}.\n\n"
            f"Full typecheck passed: {current_status == 0}.\n\n"
        )
raise SystemExit(1 if new else 0)
