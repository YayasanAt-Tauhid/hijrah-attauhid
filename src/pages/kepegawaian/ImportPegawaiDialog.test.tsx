import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as XLSX from "xlsx";
import { ImportPegawaiDialog, makeTemplateWorkbook } from "./ImportPegawaiDialog";

const mocks = vi.hoisted(() => ({
  role: "admin",
  insert: vi.fn(),
  update: vi.fn(),
  existing: [] as { id: string; nip: string | null; nama: string }[],
  upsert: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: mocks.role }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "admin-id" } }, error: null }) },
    from: (table: string) => {
      let written = false;
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: async () => ({ data: mocks.existing, error: null }),
        insert: (payload: unknown) => { mocks.insert(payload); written = true; return chain; },
        update: (payload: unknown) => { mocks.update(payload); return chain; },
        upsert: (payload: unknown) => { mocks.upsert(payload); written = true; return chain; },
        single: async () => ({ data: table === "pegawai" ? { id: "new-id" } : { pegawai_id: "new-id" }, error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: written ? [{ id: "new-id" }] : [], error: null }).then(resolve),
      };
      return chain;
    },
  },
}));

describe("import pegawai dengan NIK", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.role = "admin"; mocks.existing = []; });

  it("template menyertakan NIK kosong dan petunjuk format teks", () => {
    const workbook = makeTemplateWorkbook();
    const template = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Template, { defval: "" });
    expect(template[0]).toHaveProperty("nik", "");
    const instructions = XLSX.utils.sheet_to_json(workbook.Sheets.Petunjuk, { header: 1 });
    expect(JSON.stringify(instructions)).toContain("Text");
  });

  it("nonadmin tidak melihat dialog dan tidak membaca NIK", () => {
    mocks.role = "guru";
    render(<ImportPegawaiDialog open onOpenChange={vi.fn()} lembagaList={[]} onImported={vi.fn()} />);
    expect(screen.queryByText("Import Data Pegawai")).not.toBeInTheDocument();
  });

  it("update NIK saja tidak mengirim update profil kosong", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    mocks.existing = [{ id, nip: null, nama: "Fixture Existing" }];
    render(<ImportPegawaiDialog open onOpenChange={vi.fn()} lembagaList={[]} onImported={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox"));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ pegawai_id: id, nik: "4".repeat(16) }]), "Template");
    const file = new File([XLSX.write(workbook, { type: "array", bookType: "xlsx" })], "fixture.xlsx");
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [file] } });
    await screen.findByText("Siap diproses");
    fireEvent.click(screen.getByRole("button", { name: "Import Pegawai" }));
    await screen.findByText("Berhasil diperbarui");
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ pegawai_id: id }));
  });

  it("baris NIK salah dilaporkan; baris valid tetap tersimpan ke tabel terpisah", async () => {
    const { container } = render(<ImportPegawaiDialog open onOpenChange={vi.fn()} lembagaList={[]} onImported={vi.fn()} />);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
      { nama: "Fixture Salah", jabatan: "Guru", nik: "123" },
      { nama: "Fixture Valid", jabatan: "Guru", nik: "2".repeat(16) },
    ]), "Template");
    const file = new File([XLSX.write(workbook, { type: "array", bookType: "xlsx" })], "fixture.xlsx");
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { files: [file] } });
    await screen.findByText(/NIK harus tepat 16 digit/);
    await waitFor(() => expect(screen.getByRole("button", { name: "Import Pegawai" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Import Pegawai" }));
    await screen.findByText("Berhasil ditambahkan");
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.insert.mock.calls[0][0]).toMatchObject({ nama: "Fixture Valid" });
    expect(mocks.insert.mock.calls[0][0]).not.toHaveProperty("nik");
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ pegawai_id: "new-id", nik: "2".repeat(16), updated_by: "admin-id" }));
  });
});
