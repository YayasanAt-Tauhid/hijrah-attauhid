import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  create: vi.fn(async () => undefined),
  update: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
}));

vi.mock("@/hooks/useJurnal", () => ({
  useAllAkunRekening: () => ({ data: mocks.rows, isLoading: false }),
  useCreateAkunRekening: () => ({ mutateAsync: mocks.create }),
  useUpdateAkunRekening: () => ({ mutateAsync: mocks.update }),
  useDeleteAkunRekening: () => ({ mutateAsync: mocks.remove }),
}));
vi.mock("@/hooks/useKeuangan", () => ({
  useLembaga: () => ({ data: [] }),
  formatRupiah: (value: number) => `Rp ${value}`,
}));
vi.mock("@/components/shared/SearchableSelect", () => ({ SearchableSelect: () => <div data-testid="lembaga" /> }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: { children: ReactNode; value: string; onValueChange: (value: string) => void }) => (
    <select value={value} onChange={(event) => onValueChange(event.target.value)}>{children}</select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => <option value={value}>{children}</option>,
}));
vi.mock("@/components/shared/DataTable", () => ({
  DataTable: ({ columns, data, actions }: { columns: { key: string; label: string; render?: (value: unknown, row: unknown) => ReactNode }[]; data: Record<string, unknown>[]; actions?: ReactNode }) => (
    <div>
      {actions}
      <table>
        <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
        <tbody>
          {data.map((row) => (
            <tr key={String(row.id)}>
              {columns.map((c) => <td key={c.key}>{c.render ? c.render(row[c.key], row) : String(row[c.key] ?? "")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ),
}));

import TabAkunRekening from "./TabAkunRekening";

const baseRow = { saldo_normal: "D", saldo_awal: 0, aktif: true, departemen: null, departemen_id: null, keterangan: null };
const BANK = { ...baseRow, id: "a1", kode: "1201", nama: "BANK OPERASIONAL", jenis: "aset", pos_isak35: "aset_lancar" };
const PDP = { ...baseRow, id: "a2", kode: "1806", nama: "PEKERJAAN DALAM PELAKSANAAN GEDUNG SD", jenis: "aset", pos_isak35: null };
const BEBAN = { ...baseRow, id: "a3", kode: "5900", nama: "BEBAN KHUSUS", jenis: "beban", pos_isak35: "beban_terbatas" };

afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.rows = []; });

const dialog = () => screen.getByRole("dialog");
const input = (label: string) => within(dialog()).getByText(label).parentElement!.querySelector("input") as HTMLInputElement;
const select = (label: string) => within(dialog()).getByText(label).parentElement!.querySelector("select") as HTMLSelectElement;
const rowButtons = (kode: string) => within(screen.getByText(kode).closest("tr") as HTMLElement).getAllByRole("button");
const save = () => fireEvent.click(within(dialog()).getByRole("button", { name: "Simpan" }));
function openAdd() {
  render(<TabAkunRekening />);
  fireEvent.click(screen.getByRole("button", { name: /Tambah/ }));
}
const NOT_MAPPED_WARNING = /tidak akan muncul di laporan ISAK 35/;

describe("form akun rekening: Pos ISAK 35 agar akun baru ikut laporan ISAK 35", () => {
  it("akun aset baru otomatis dipetakan ke Aset Lancar dan ikut tersimpan", async () => {
    openAdd();
    expect(select("Pos ISAK 35").value).toBe("aset_lancar");
    expect(screen.queryByText(NOT_MAPPED_WARNING)).not.toBeInTheDocument();
    fireEvent.change(input("Kode *"), { target: { value: "1214" } });
    fireEvent.change(input("Nama *"), { target: { value: "E-WALLET DANA" } });
    save();
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      kode: "1214", nama: "E-WALLET DANA", jenis: "aset", saldo_normal: "D", pos_isak35: "aset_lancar",
    }));
  });

  it("mengganti jenis akun menyesuaikan pos ISAK 35 ke nilai awal jenis itu", () => {
    openAdd();
    fireEvent.change(select("Jenis"), { target: { value: "beban" } });
    expect(select("Pos ISAK 35").value).toBe("beban_program");
    fireEvent.change(select("Jenis"), { target: { value: "liabilitas" } });
    expect(select("Pos ISAK 35").value).toBe("kewajiban_jangka_pendek");
    fireEvent.change(select("Jenis"), { target: { value: "pendapatan" } });
    expect(select("Pos ISAK 35").value).toBe("pendapatan_tidak_terikat");
  });

  it("pilihan pos yang masih cocok dipertahankan saat jenis diganti", () => {
    openAdd();
    fireEvent.change(select("Jenis"), { target: { value: "beban" } });
    fireEvent.change(select("Pos ISAK 35"), { target: { value: "beban_penunjang" } });
    fireEvent.change(select("Jenis"), { target: { value: "beban" } });
    expect(select("Pos ISAK 35").value).toBe("beban_penunjang");
  });

  it("dikosongkan sengaja: muncul peringatan dan akun disimpan tanpa pos (null)", async () => {
    openAdd();
    fireEvent.change(select("Pos ISAK 35"), { target: { value: "__none__" } });
    expect(screen.getByText(NOT_MAPPED_WARNING)).toBeInTheDocument();
    fireEvent.change(input("Kode *"), { target: { value: "1999" } });
    fireEvent.change(input("Nama *"), { target: { value: "AKUN UJI" } });
    save();
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ kode: "1999", pos_isak35: null }));
  });

  it("edit akun lama yang belum dipetakan tidak diisi diam-diam; setelah dipilih, tersimpan", async () => {
    mocks.rows = [PDP];
    render(<TabAkunRekening />);
    fireEvent.click(rowButtons("1806")[0]);
    expect(select("Pos ISAK 35").value).toBe("__none__");
    expect(screen.getByText(NOT_MAPPED_WARNING)).toBeInTheDocument();
    fireEvent.change(select("Pos ISAK 35"), { target: { value: "aset_tidak_lancar" } });
    expect(screen.queryByText(NOT_MAPPED_WARNING)).not.toBeInTheDocument();
    save();
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ id: "a2", pos_isak35: "aset_tidak_lancar" }));
  });

  it("edit tanpa menyentuh pos pada akun yang sudah dipetakan tidak mengubah pos", async () => {
    mocks.rows = [BANK];
    render(<TabAkunRekening />);
    fireEvent.click(rowButtons("1201")[0]);
    expect(select("Pos ISAK 35").value).toBe("aset_lancar");
    save();
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ id: "a1", pos_isak35: "aset_lancar" }));
  });

  it("nilai pos lama di luar daftar tetap tampil dan tersimpan apa adanya", async () => {
    mocks.rows = [BEBAN];
    render(<TabAkunRekening />);
    fireEvent.click(rowButtons("5900")[0]);
    expect(select("Pos ISAK 35").value).toBe("beban_terbatas");
    save();
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ id: "a3", pos_isak35: "beban_terbatas" }));
  });

  it("tabel menampilkan kolom Pos ISAK 35 dan menandai akun yang belum dipetakan", () => {
    mocks.rows = [BANK, PDP, BEBAN];
    render(<TabAkunRekening />);
    expect(screen.getByRole("columnheader", { name: "Pos ISAK 35" })).toBeInTheDocument();
    expect(within(screen.getByText("1201").closest("tr") as HTMLElement).getByText("Aset Lancar")).toBeInTheDocument();
    expect(within(screen.getByText("1806").closest("tr") as HTMLElement).getByText("Belum dipetakan")).toBeInTheDocument();
    expect(within(screen.getByText("5900").closest("tr") as HTMLElement).getByText("beban_terbatas")).toBeInTheDocument();
  });
});
