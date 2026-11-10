"""Tambahkan tabel/RPC yang BELUM ada ke src/integrations/supabase/types.ts dari katalog skema.

Masukan : keluaran scripts/db-types/katalog.sql (JSON) dari database Rustbase produksi.
Keluaran: types.ts dengan entri baru disisipkan di akhir blok Tables/Views/Functions.
          Ringkasan JSON (yang ditambah, dilewati, tipe tak dikenal) dicetak ke stdout.

Aturan:
- Hanya menambah. Entri yang sudah ada TIDAK diubah, bahkan bila bentuknya beda dari DB.
- Fungsi ber-overload dilewati (union tipe harus ditulis manual); tidak ditebak.
- Tipe Postgres yang tidak dikenal menjadi `unknown` dan dilaporkan.
- Idempoten: menjalankan ulang dengan katalog yang sama tidak menambah apa pun.
"""
import argparse
import json
from pathlib import Path
import re
import sys

parser = argparse.ArgumentParser()
parser.add_argument("--catalog", type=Path, required=True, help="JSON dari katalog.sql")
parser.add_argument("--types", type=Path, required=True, help="src/integrations/supabase/types.ts")
parser.add_argument("--wanted-tables", default="", help="nama tabel yang diminta, dipisah koma (untuk laporan tidak ditemukan)")
parser.add_argument("--wanted-rpcs", default="", help="nama RPC yang diminta, dipisah koma")
args = parser.parse_args()

NUMBER_TYPES = {"smallint", "integer", "bigint", "real", "double precision", "numeric", "oid"}
STRING_TYPES = {
    "text", "character varying", "character", "name", "citext", "uuid", "date", "interval", "bytea", "inet",
    "timestamp with time zone", "timestamp without time zone", "time with time zone", "time without time zone",
}
JSON_TYPES = {"json", "jsonb"}
INPUT_MODES = {"i", "b", "v"}
OUTPUT_MODES = {"t", "o"}
IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

unknown_types = []


def key(name):
    return name if IDENTIFIER.match(name) else json.dumps(name)


def ts_type(pg_type, where):
    if pg_type.endswith("[]"):
        return ts_type(pg_type[:-2], where) + "[]"
    if pg_type in NUMBER_TYPES:
        return "number"
    if pg_type in STRING_TYPES:
        return "string"
    if pg_type == "boolean":
        return "boolean"
    if pg_type in JSON_TYPES:
        return "Json"
    unknown_types.append({"where": where, "type": pg_type})
    return "unknown"


def section_bounds(text, name, next_name, start=0):
    """Posisi awal baris penutup `    }` dari blok `name` (sebelum blok `next_name`)."""
    header = text.find("\n    " + name + ": {\n", start)
    if header < 0:
        sys.exit("types.ts tidak punya blok " + name)
    following = text.find("\n    " + next_name + ": {\n", header)
    if following < 0:
        sys.exit("types.ts tidak punya blok " + next_name + " setelah " + name)
    closing = following - len("    }")
    if text[closing:following] != "    }" or text[closing - 1] != "\n":
        sys.exit("Bentuk akhir blok " + name + " di types.ts tidak dikenali")
    return header, closing


def names_in(text, name, next_name):
    header, closing = section_bounds(text, name, next_name)
    return set(re.findall(r"^      (\w+): \{", text[header:closing], re.M))


def insert(text, name, next_name, block):
    _, closing = section_bounds(text, name, next_name)
    return text[:closing] + block + text[closing:]


def table_entry(table):
    cols = table["columns"]
    where = table["name"]

    # Tipe dihitung sekali per kolom supaya laporan tipe tak dikenal tidak ganda.
    typed = {c["name"]: ts_type(c["type"], where + "." + c["name"]) + (" | null" if c["nullable"] else "") for c in cols}

    def field(col, optional, never=False):
        return "          " + key(col["name"]) + ("?" if optional or never else "") + ": " + ("never" if never else typed[col["name"]])

    row = [field(c, False) for c in cols]
    insert_lines = []
    update_lines = []
    for c in cols:
        always = c.get("identity") == "a" or bool(c.get("generated"))
        optional_insert = c["nullable"] or c.get("has_default") or c.get("identity") == "d"
        insert_lines.append(field(c, optional_insert, never=always))
        update_lines.append(field(c, True, never=always))
    lines = ["      " + key(table["name"]) + ": {", "        Row: {"]
    lines += row
    lines += ["        }"]
    if table.get("kind", "r") in ("r", "p"):
        lines += ["        Insert: {"] + insert_lines + ["        }", "        Update: {"] + update_lines + ["        }"]
    fks = table.get("fks") or []
    if fks:
        lines.append("        Relationships: [")
        for fk in fks:
            lines += [
                "          {",
                "            foreignKeyName: " + json.dumps(fk["name"]),
                "            columns: " + json.dumps(fk["columns"]),
                "            isOneToOne: " + ("true" if fk.get("one_to_one") else "false"),
                "            referencedRelation: " + json.dumps(fk["ref_table"]),
                "            referencedColumns: " + json.dumps(fk["ref_columns"]),
                "          },",
            ]
        lines.append("        ]")
    else:
        lines.append("        Relationships: []")
    lines.append("      }")
    return "\n".join(lines) + "\n"


def function_entry(fn, known_rows):
    name = fn["name"]
    types = fn.get("arg_types") or []
    names = fn.get("arg_names") or []
    modes = fn.get("arg_modes") or ["i"] * len(types)
    inputs, outputs = [], []
    for index, pg_type in enumerate(types):
        arg_name = names[index] if index < len(names) and names[index] else "arg" + str(index + 1)
        if modes[index] in INPUT_MODES:
            inputs.append((arg_name, pg_type))
        elif modes[index] in OUTPUT_MODES:
            outputs.append((arg_name, pg_type))
    first_optional = len(inputs) - int(fn.get("n_defaults") or 0)
    lines = ["      " + key(name) + ": {"]
    if inputs:
        lines.append("        Args: {")
        for index, (arg_name, pg_type) in enumerate(inputs):
            lines.append("          " + key(arg_name) + ("?" if index >= first_optional else "") + ": " + ts_type(pg_type, name + "(" + arg_name + ")"))
        lines.append("        }")
    else:
        lines.append("        Args: Record<PropertyKey, never>")
    returns_set = bool(fn.get("returns_set"))
    suffix = "[]" if returns_set else ""
    if outputs:
        lines.append("        Returns: {")
        for out_name, pg_type in outputs:
            lines.append("          " + key(out_name) + ": " + ts_type(pg_type, name + " -> " + out_name))
        lines.append("        }" + suffix)
    else:
        returns = fn["returns_type"]
        if returns == "void":
            lines.append("        Returns: undefined")
        elif returns in known_rows:
            lines.append('        Returns: Database["public"]["Tables"][' + json.dumps(returns) + ']["Row"]' + suffix)
        else:
            lines.append("        Returns: " + ts_type(returns, name + " -> " + returns) + suffix)
    lines.append("      }")
    return "\n".join(lines) + "\n"


catalog = json.loads(args.catalog.read_text())
text = args.types.read_text()
original = text

existing_tables = names_in(text, "Tables", "Views")
existing_views = names_in(text, "Views", "Functions")
existing_functions = names_in(text, "Functions", "Enums")

skipped = []
added_tables, added_views, added_functions = [], [], []
known_rows = set(existing_tables)

table_blocks, view_blocks = [], []
for table in catalog.get("tables", []):
    name = table["name"]
    is_view = table.get("kind", "r") in ("v", "m")
    if name in existing_tables or name in existing_views:
        skipped.append({"name": name, "kind": "view" if is_view else "table", "reason": "sudah ada di types.ts"})
        continue
    if is_view:
        view_blocks.append(table_entry(table))
        added_views.append(name)
    else:
        table_blocks.append(table_entry(table))
        added_tables.append(name)
        known_rows.add(name)

function_blocks = []
for fn in catalog.get("functions", []):
    name = fn["name"]
    if name in existing_functions:
        skipped.append({"name": name, "kind": "function", "reason": "sudah ada di types.ts"})
        continue
    if int(fn.get("overloads") or 1) > 1:
        skipped.append({"name": name, "kind": "function", "reason": "overload (" + str(fn["overloads"]) + " definisi), ditulis manual"})
        continue
    function_blocks.append(function_entry(fn, known_rows))
    added_functions.append(name)

if table_blocks:
    text = insert(text, "Tables", "Views", "".join(table_blocks))
if view_blocks:
    text = insert(text, "Views", "Functions", "".join(view_blocks))
if function_blocks:
    text = insert(text, "Functions", "Enums", "".join(function_blocks))
if text != original:
    args.types.write_text(text)


def wanted(value):
    return [item for item in value.split(",") if item]


found_tables = {t["name"] for t in catalog.get("tables", [])}
found_functions = {f["name"] for f in catalog.get("functions", [])}
print(json.dumps({
    "added_tables": added_tables,
    "added_views": added_views,
    "added_functions": added_functions,
    "skipped": skipped,
    "unknown_types": unknown_types,
    "not_found_tables": [n for n in wanted(args.wanted_tables) if n not in found_tables],
    "not_found_functions": [n for n in wanted(args.wanted_rpcs) if n not in found_functions],
}, indent=2, ensure_ascii=False))
