import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Kontrak scripts/qa/compare-lint.py: membandingkan keluaran `eslint -f json`
// antara commit dasar PR dan PR, tanpa nomor baris, dan gagal hanya bila ada
// error baru (meniru scripts/qa/compare-typecheck.py untuk TypeScript).

type Msg = { ruleId: string | null; severity: 1 | 2; message: string; line?: number; fatal?: boolean };
type FileResult = { file: string; messages: Msg[] };

const SCRIPT = path.resolve(process.cwd(), "scripts/qa/compare-lint.py");
const ANY: Omit<Msg, "line"> = {
  ruleId: "@typescript-eslint/no-explicit-any",
  severity: 2,
  message: "Unexpected any. Specify a different type.",
};
const CONST: Omit<Msg, "line"> = {
  ruleId: "prefer-const",
  severity: 2,
  message: "'x' is never reassigned. Use 'const' instead.",
};
const HOOK: Omit<Msg, "line"> = {
  ruleId: "react-hooks/exhaustive-deps",
  severity: 1,
  message: "React Hook useEffect has a missing dependency: 'x'.",
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "compare-lint-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function record(name: string, root: string, files: FileResult[], exit: number) {
  mkdirSync(root, { recursive: true });
  const json = files.map((f) => ({
    filePath: path.join(root, f.file),
    messages: f.messages,
    errorCount: f.messages.filter((m) => m.severity === 2).length,
    warningCount: f.messages.filter((m) => m.severity === 1).length,
  }));
  const target = path.join(dir, `${name}.json`);
  writeFileSync(target, JSON.stringify(json));
  writeFileSync(path.join(dir, `${name}.exit`), `${exit}\n`);
  return target;
}

function run(base: FileResult[], current: FileResult[], opts: { baseExit?: number; currentExit?: number } = {}) {
  const baseRoot = path.join(dir, "base-worktree");
  const currentRoot = path.join(dir, "current-worktree");
  const hasErrors = (files: FileResult[]) => files.some((f) => f.messages.some((m) => m.severity === 2));
  const baseFile = record("base", baseRoot, base, opts.baseExit ?? (hasErrors(base) ? 1 : 0));
  const currentFile = record("current", currentRoot, current, opts.currentExit ?? (hasErrors(current) ? 1 : 0));
  const result = spawnSync(
    "python3",
    [SCRIPT, "--base", baseFile, "--current", currentFile, "--base-root", baseRoot, "--current-root", currentRoot, "--label", "uji"],
    { encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: "" } },
  );
  return result;
}

function report(stdout: string) {
  return JSON.parse(stdout);
}

describe("compare-lint.py", () => {
  it("lulus bila hasil lint sama persis dengan commit dasar", () => {
    const files: FileResult[] = [{ file: "src/a.ts", messages: [{ ...ANY, line: 3 }, { ...CONST, line: 9 }] }];
    const result = run(files, files);
    expect(result.status).toBe(0);
    const json = report(result.stdout);
    expect(json.baseline_errors).toBe(2);
    expect(json.current_errors).toBe(2);
    expect(json.new_errors).toBe(0);
  });

  it("mengabaikan perubahan nomor baris saja", () => {
    const base: FileResult[] = [{ file: "src/a.ts", messages: [{ ...ANY, line: 3 }] }];
    const current: FileResult[] = [{ file: "src/a.ts", messages: [{ ...ANY, line: 40 }] }];
    expect(run(base, current).status).toBe(0);
  });

  it("mengabaikan nomor baris yang tertulis di dalam teks pesan (mis. exhaustive-deps)", () => {
    const withLine = (n: number): Omit<Msg, "line"> => ({
      ...HOOK,
      message: `The 'xs' logical expression could make the dependencies of useEffect Hook (at line ${n}) change on every render. To fix this, wrap the initialization of 'xs' in its own useMemo() Hook.`,
    });
    const base: FileResult[] = [{ file: "src/a.tsx", messages: [{ ...withLine(330), line: 12 }] }];
    const current: FileResult[] = [{ file: "src/a.tsx", messages: [{ ...withLine(331), line: 13 }] }];
    const result = run(base, current);
    expect(result.status).toBe(0);
    const json = report(result.stdout);
    expect(json.new_warnings).toBe(0);
    expect(json.new).toEqual([]);
  });

  it("tetap melaporkan peringatan baru yang berbeda pesannya, bukan hanya nomor baris", () => {
    const hook = (name: string): Omit<Msg, "line"> => ({
      ...HOOK,
      message: `The '${name}' conditional could make the dependencies of useMemo Hook (at line 10) change on every render.`,
    });
    const base: FileResult[] = [{ file: "src/a.tsx", messages: [{ ...hook("a"), line: 1 }] }];
    const current: FileResult[] = [{ file: "src/a.tsx", messages: [{ ...hook("a"), line: 1 }, { ...hook("b"), line: 2 }] }];
    expect(report(run(base, current).stdout).new_warnings).toBe(1);
  });

  it("gagal bila error baru berbeda hanya pada nomor baris tetapi jumlahnya bertambah", () => {
    const err = (n: number): Omit<Msg, "line"> => ({ ...CONST, message: `'x' is assigned at line ${n} but never reassigned.` });
    const base: FileResult[] = [{ file: "src/a.ts", messages: [{ ...err(5), line: 5 }] }];
    const current: FileResult[] = [{ file: "src/a.ts", messages: [{ ...err(9), line: 9 }, { ...err(20), line: 20 }] }];
    const result = run(base, current);
    expect(result.status).toBe(1);
    expect(report(result.stdout).new_errors).toBe(1);
  });

  it("memperlakukan root worktree yang berbeda sebagai file yang sama", () => {
    const base: FileResult[] = [{ file: "src/pages/B.tsx", messages: [{ ...ANY, line: 1 }] }];
    const result = run(base, base);
    expect(result.status).toBe(0);
    expect(report(result.stdout).new_errors).toBe(0);
  });

  it("gagal bila satu `any` baru muncul di file yang sudah punya error", () => {
    const base: FileResult[] = [{ file: "src/a.ts", messages: [{ ...ANY, line: 3 }] }];
    const current: FileResult[] = [{ file: "src/a.ts", messages: [{ ...ANY, line: 3 }, { ...ANY, line: 7 }] }];
    const result = run(base, current);
    expect(result.status).toBe(1);
    const json = report(result.stdout);
    expect(json.new_errors).toBe(1);
    expect(json.new[0]).toMatchObject({ file: "src/a.ts", rule: ANY.ruleId, severity: "error", count: 1 });
  });

  it("gagal bila error baru muncul di file baru", () => {
    const base: FileResult[] = [{ file: "src/a.ts", messages: [{ ...ANY, line: 3 }] }];
    const current: FileResult[] = [
      { file: "src/a.ts", messages: [{ ...ANY, line: 3 }] },
      { file: "src/baru.ts", messages: [{ ...CONST, line: 1 }] },
    ];
    const result = run(base, current);
    expect(result.status).toBe(1);
    expect(report(result.stdout).new[0].file).toBe("src/baru.ts");
  });

  it("tidak menutupi error baru dengan error lama yang dibereskan di file lain", () => {
    const base: FileResult[] = [
      { file: "src/a.ts", messages: [{ ...ANY, line: 3 }] },
      { file: "src/b.ts", messages: [{ ...ANY, line: 5 }] },
    ];
    const current: FileResult[] = [
      { file: "src/a.ts", messages: [{ ...ANY, line: 3 }, { ...ANY, line: 4 }] },
      { file: "src/b.ts", messages: [] },
    ];
    expect(run(base, current).status).toBe(1);
  });

  it("lulus dan melaporkan penurunan bila error berkurang", () => {
    const base: FileResult[] = [{ file: "src/a.ts", messages: [{ ...ANY, line: 3 }, { ...CONST, line: 8 }] }];
    const current: FileResult[] = [{ file: "src/a.ts", messages: [{ ...ANY, line: 3 }] }];
    const result = run(base, current);
    expect(result.status).toBe(0);
    const json = report(result.stdout);
    expect(json.baseline_errors).toBe(2);
    expect(json.current_errors).toBe(1);
    expect(json.new_errors).toBe(0);
  });

  it("peringatan baru dilaporkan tetapi tidak menggagalkan", () => {
    const base: FileResult[] = [{ file: "src/a.ts", messages: [{ ...ANY, line: 3 }] }];
    const current: FileResult[] = [{ file: "src/a.ts", messages: [{ ...ANY, line: 3 }, { ...HOOK, line: 12 }] }];
    const result = run(base, current);
    expect(result.status).toBe(0);
    const json = report(result.stdout);
    expect(json.new_errors).toBe(0);
    expect(json.new_warnings).toBe(1);
  });

  it("galat parsing (tanpa ruleId) dihitung sebagai error", () => {
    const parse: Msg = { ruleId: null, severity: 2, message: "Parsing error: Unexpected token", fatal: true };
    const result = run([{ file: "src/a.ts", messages: [] }], [{ file: "src/a.ts", messages: [{ ...parse, line: 2 }] }]);
    expect(result.status).toBe(1);
    expect(report(result.stdout).new[0].rule).toBe("(parse)");
  });

  it("menolak eksekusi eslint yang tidak lengkap (exit 2)", () => {
    const files: FileResult[] = [{ file: "src/a.ts", messages: [{ ...ANY, line: 3 }] }];
    const result = run(files, files, { currentExit: 2 });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Incomplete ESLint check/);
  });

  it("menolak exit 1 tanpa satu pun error di keluaran JSON", () => {
    const files: FileResult[] = [{ file: "src/a.ts", messages: [] }];
    const result = run(files, files, { baseExit: 1 });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Incomplete ESLint check/);
  });
});
