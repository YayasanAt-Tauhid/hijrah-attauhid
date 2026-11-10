import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Kontrak scripts/db-types/generate.py: menambahkan tabel/RPC yang BELUM ada di
// src/integrations/supabase/types.ts dari katalog skema (keluaran katalog.sql),
// tanpa mengubah satu pun entri yang sudah ada.

const SCRIPT = path.resolve(process.cwd(), "scripts/db-types/generate.py");

const TYPES_TEMPLATE = `export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      siswa: {
        Row: { id: string }
        Insert: { id?: string }
        Update: { id?: string }
        Relationships: []
      }
    }
    Views: {
      v_ada: {
        Row: { x: string | null }
        Relationships: []
      }
    }
    Functions: {
      fungsi_lama: {
        Args: { a: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
`;

type Col = { name: string; type: string; nullable: boolean; has_default?: boolean; generated?: string; identity?: string };
type Fk = { name: string; columns: string[]; ref_table: string; ref_columns: string[]; one_to_one?: boolean };
type Table = { name: string; kind?: string; columns: Col[]; fks?: Fk[] };
type Fn = {
  name: string;
  overloads?: number;
  n_defaults?: number;
  returns_set?: boolean;
  returns_type: string;
  arg_names?: string[] | null;
  arg_modes?: string[] | null;
  arg_types?: string[] | null;
  n_in_args?: number;
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "gen-db-types-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const col = (name: string, type: string, extra: Partial<Col> = {}): Col => ({
  name,
  type,
  nullable: false,
  has_default: false,
  generated: "",
  identity: "",
  ...extra,
});

function run(
  catalog: { tables?: Table[]; functions?: Fn[] },
  opts: { types?: string; wantedTables?: string; wantedRpcs?: string } = {},
) {
  const typesPath = path.join(dir, "types.ts");
  const catalogPath = path.join(dir, "katalog.json");
  writeFileSync(typesPath, opts.types ?? TYPES_TEMPLATE);
  writeFileSync(catalogPath, JSON.stringify({ tables: catalog.tables ?? [], functions: catalog.functions ?? [] }));
  const args = [SCRIPT, "--catalog", catalogPath, "--types", typesPath];
  if (opts.wantedTables) args.push("--wanted-tables", opts.wantedTables);
  if (opts.wantedRpcs) args.push("--wanted-rpcs", opts.wantedRpcs);
  const result = spawnSync("python3", args, { encoding: "utf8" });
  return { ...result, output: readFileSync(typesPath, "utf8"), summary: result.stdout ? JSON.parse(result.stdout) : null };
}

const fn = (name: string, extra: Partial<Fn> = {}): Fn => ({
  name,
  overloads: 1,
  n_defaults: 0,
  returns_set: false,
  returns_type: "jsonb",
  arg_names: null,
  arg_modes: null,
  arg_types: null,
  n_in_args: 0,
  ...extra,
});

describe("generate.py: tabel", () => {
  it("menambahkan tabel baru dengan Row, Insert, Update dan Relationships", () => {
    const { status, output } = run({
      tables: [
        {
          name: "spmb_gelombang",
          columns: [
            col("id", "uuid", { has_default: true }),
            col("nama", "text"),
            col("tanggal_selesai", "timestamp with time zone", { nullable: true }),
            col("urutan", "integer", { has_default: true }),
          ],
          fks: [],
        },
      ],
    });
    expect(status).toBe(0);
    expect(output).toContain("      spmb_gelombang: {");
    expect(output).toMatch(/Row: \{\s+id: string\s+nama: string\s+tanggal_selesai: string \| null\s+urutan: number\s+\}/);
    // Insert: kolom dengan default atau nullable opsional; kolom wajib tetap wajib.
    expect(output).toMatch(/Insert: \{\s+id\?: string\s+nama: string\s+tanggal_selesai\?: string \| null\s+urutan\?: number\s+\}/);
    // Update: semuanya opsional.
    expect(output).toMatch(/Update: \{\s+id\?: string\s+nama\?: string\s+tanggal_selesai\?: string \| null\s+urutan\?: number\s+\}/);
  });

  it("memetakan tipe Postgres ke TypeScript (array, jsonb, numeric, boolean, date)", () => {
    const { output } = run({
      tables: [
        {
          name: "tipe_uji",
          columns: [
            col("a", "uuid[]"),
            col("b", "text[]", { nullable: true }),
            col("c", "jsonb"),
            col("d", "numeric"),
            col("e", "boolean"),
            col("f", "date"),
            col("g", "bigint"),
            col("h", "smallint"),
          ],
        },
      ],
    });
    expect(output).toMatch(/Row: \{\s+a: string\[\]\s+b: string\[\] \| null\s+c: Json\s+d: number\s+e: boolean\s+f: string\s+g: number\s+h: number\s+\}/);
  });

  it("kolom identity `always` tidak boleh diisi (never), `by default` opsional", () => {
    const { output } = run({
      tables: [
        {
          name: "log_uji",
          columns: [col("id", "bigint", { identity: "a" }), col("seq", "bigint", { identity: "d" }), col("isi", "text")],
        },
      ],
    });
    expect(output).toMatch(/Insert: \{\s+id\?: never\s+seq\?: number\s+isi: string\s+\}/);
    expect(output).toMatch(/Update: \{\s+id\?: never\s+seq\?: number\s+isi\?: string\s+\}/);
  });

  it("menulis foreign key sebagai Relationships (termasuk isOneToOne)", () => {
    const { output } = run({
      tables: [
        {
          name: "anak",
          columns: [col("id", "uuid"), col("siswa_id", "uuid")],
          fks: [{ name: "anak_siswa_id_fkey", columns: ["siswa_id"], ref_table: "siswa", ref_columns: ["id"], one_to_one: true }],
        },
      ],
    });
    expect(output).toContain('foreignKeyName: "anak_siswa_id_fkey"');
    expect(output).toContain('columns: ["siswa_id"]');
    expect(output).toContain("isOneToOne: true");
    expect(output).toContain('referencedRelation: "siswa"');
    expect(output).toContain('referencedColumns: ["id"]');
  });

  it("tabel tanpa foreign key memakai `Relationships: []`", () => {
    const { output } = run({ tables: [{ name: "polos", columns: [col("id", "uuid")], fks: [] }] });
    const block = output.slice(output.indexOf("      polos: {"));
    expect(block.slice(0, block.indexOf("\n      }\n"))).toContain("Relationships: []");
  });
});

describe("generate.py: tidak mengubah yang sudah ada", () => {
  it("melewati tabel yang sudah ada di types.ts dan melaporkannya", () => {
    const { output, summary } = run({ tables: [{ name: "siswa", columns: [col("id", "uuid"), col("nama_baru", "text")] }] });
    expect(output).toBe(TYPES_TEMPLATE);
    expect(summary.skipped).toContainEqual({ name: "siswa", kind: "table", reason: "sudah ada di types.ts" });
  });

  it("melewati view yang sudah ada dan fungsi yang sudah ada", () => {
    const { output, summary } = run({
      tables: [{ name: "v_ada", kind: "v", columns: [col("x", "text")] }],
      functions: [fn("fungsi_lama")],
    });
    expect(output).toBe(TYPES_TEMPLATE);
    expect(summary.added_tables).toEqual([]);
    expect(summary.added_functions).toEqual([]);
  });

  it("hanya menambah: semua teks asli tetap ada utuh dan urutannya sama", () => {
    const { output } = run({
      tables: [{ name: "baru", columns: [col("id", "uuid")] }],
      functions: [fn("fungsi_baru")],
    });
    expect(output).toContain("      baru: {");
    expect(output).toContain("      fungsi_baru: {");
    const stripped = output.replace(/ {6}baru: \{[\s\S]*?\n {6}\}\n/, "").replace(/ {6}fungsi_baru: \{[\s\S]*?\n {6}\}\n/, "");
    expect(stripped).toBe(TYPES_TEMPLATE);
  });

  it("idempotent: menjalankan dua kali tidak menambah apa pun lagi", () => {
    const cat = { tables: [{ name: "baru", columns: [col("id", "uuid")] }], functions: [fn("fungsi_baru")] };
    const first = run(cat);
    const second = run(cat, { types: first.output });
    expect(second.output).toBe(first.output);
    expect(second.summary.added_tables).toEqual([]);
    expect(second.summary.added_functions).toEqual([]);
  });

  it("menyisipkan di akhir blok yang benar (Tables, Functions) dan blok lain tetap ada", () => {
    const { output } = run({
      tables: [{ name: "baru", columns: [col("id", "uuid")] }],
      functions: [fn("fungsi_baru")],
    });
    const iTables = output.indexOf("    Tables: {");
    const iViews = output.indexOf("    Views: {");
    const iFunctions = output.indexOf("    Functions: {");
    const iEnums = output.indexOf("    Enums: {");
    expect(iTables).toBeLessThan(output.indexOf("      baru: {"));
    expect(output.indexOf("      baru: {")).toBeLessThan(iViews);
    expect(iFunctions).toBeLessThan(output.indexOf("      fungsi_baru: {"));
    expect(output.indexOf("      fungsi_baru: {")).toBeLessThan(iEnums);
  });
});

describe("generate.py: fungsi (RPC)", () => {
  it("menulis Args dengan nama parameter dan Returns skalar", () => {
    const { output } = run({
      functions: [
        fn("hitung", {
          arg_names: ["p_id", "p_catatan", "p_jumlah"],
          arg_types: ["uuid", "text", "integer"],
          n_in_args: 3,
          returns_type: "integer",
        }),
      ],
    });
    expect(output).toMatch(/hitung: \{\s+Args: \{\s+p_id: string\s+p_catatan: string\s+p_jumlah: number\s+\}\s+Returns: number\s+\}/);
  });

  it("parameter dengan nilai bawaan (di ujung) menjadi opsional", () => {
    const { output } = run({
      functions: [
        fn("dengan_default", {
          arg_names: ["a", "b", "c"],
          arg_types: ["uuid", "text", "boolean"],
          n_in_args: 3,
          n_defaults: 2,
        }),
      ],
    });
    expect(output).toMatch(/Args: \{\s+a: string\s+b\?: string\s+c\?: boolean\s+\}/);
  });

  it("fungsi tanpa argumen memakai Record<PropertyKey, never>", () => {
    const { output } = run({ functions: [fn("tanpa_arg")] });
    expect(output).toContain("Args: Record<PropertyKey, never>");
  });

  it("memetakan Returns: void, jsonb, setof skalar, dan array", () => {
    const { output } = run({
      functions: [
        fn("f_void", { returns_type: "void" }),
        fn("f_json", { returns_type: "jsonb" }),
        fn("f_set", { returns_type: "uuid", returns_set: true }),
        fn("f_arr", { returns_type: "uuid[]" }),
      ],
    });
    const block = (name: string) => {
      const start = output.indexOf(`      ${name}: {`);
      return output.slice(start, output.indexOf("\n      }\n", start));
    };
    expect(block("f_void")).toContain("Returns: undefined");
    expect(block("f_json")).toContain("Returns: Json");
    expect(block("f_set")).toContain("Returns: string[]");
    expect(block("f_arr")).toContain("Returns: string[]");
  });

  it("RETURNS TABLE: kolom keluaran (mode t) menjadi tipe objek, bukan argumen", () => {
    const { output } = run({
      functions: [
        fn("daftar", {
          returns_type: "record",
          returns_set: true,
          arg_names: ["p_id", "id", "nama", "aktif"],
          arg_modes: ["i", "t", "t", "t"],
          arg_types: ["uuid", "uuid", "text", "boolean"],
          n_in_args: 1,
        }),
      ],
    });
    const start = output.indexOf("      daftar: {");
    const block = output.slice(start, output.indexOf("\n      }\n", start));
    expect(block).toMatch(/Args: \{\s+p_id: string\s+\}/);
    expect(block).toMatch(/Returns: \{\s+id: string\s+nama: string\s+aktif: boolean\s+\}\[\]/);
  });

  it("RETURNS TABLE tanpa argumen masukan memakai Record<PropertyKey, never>", () => {
    const { output } = run({
      functions: [
        fn("ids", {
          returns_type: "uuid",
          returns_set: true,
          arg_names: ["departemen_id"],
          arg_modes: ["t"],
          arg_types: ["uuid"],
          n_in_args: 0,
        }),
      ],
    });
    const start = output.indexOf("      ids: {");
    const block = output.slice(start, output.indexOf("\n      }\n", start));
    expect(block).toContain("Args: Record<PropertyKey, never>");
    expect(block).toMatch(/Returns: \{\s+departemen_id: string\s+\}\[\]/);
  });

  it("Returns tipe baris tabel yang dikenal merujuk ke Row tabel itu", () => {
    const { output } = run({
      functions: [fn("ambil_siswa", { returns_type: "siswa" }), fn("daftar_siswa", { returns_type: "siswa", returns_set: true })],
    });
    expect(output).toContain('Returns: Database["public"]["Tables"]["siswa"]["Row"]\n');
    expect(output).toContain('Returns: Database["public"]["Tables"]["siswa"]["Row"][]');
  });

  it("fungsi dengan overload (nama sama, argumen beda) dilewati dan dilaporkan, tidak ditebak", () => {
    const { output, summary } = run({ functions: [fn("ganda", { overloads: 2 })] });
    expect(output).not.toContain("      ganda: {");
    expect(summary.skipped).toContainEqual({ name: "ganda", kind: "function", reason: "overload (2 definisi), ditulis manual" });
  });
});

describe("generate.py: pelaporan", () => {
  it("tipe Postgres yang tidak dikenal menjadi unknown dan dilaporkan", () => {
    const { output, summary } = run({ tables: [{ name: "aneh", columns: [col("peta", "geometry")] }] });
    expect(output).toMatch(/Row: \{\s+peta: unknown\s+\}/);
    expect(summary.unknown_types).toContainEqual({ where: "aneh.peta", type: "geometry" });
  });

  it("melaporkan nama yang diminta tetapi tidak ada di katalog", () => {
    const { summary } = run(
      { tables: [{ name: "ada", columns: [col("id", "uuid")] }] },
      { wantedTables: "ada,tidak_ada", wantedRpcs: "rpc_hilang" },
    );
    expect(summary.not_found_tables).toEqual(["tidak_ada"]);
    expect(summary.not_found_functions).toEqual(["rpc_hilang"]);
  });

  it("gagal dengan pesan jelas bila blok Tables/Functions tidak ditemukan di types.ts", () => {
    const result = run({ tables: [{ name: "x", columns: [col("id", "uuid")] }] }, { types: "export type Database = {}\n" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Tables/);
  });
});
