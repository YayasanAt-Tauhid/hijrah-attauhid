import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DataPegawai from "./DataPegawai";

const mocks = vi.hoisted(() => ({ role: "admin", nikReads: vi.fn(), error: vi.fn(), insert: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: mocks.role }) }));
vi.mock("@/hooks/useKeuangan", () => ({ useLembaga: () => ({ data: [] }) }));
vi.mock("@/lib/router-compat", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/pages/kepegawaian/ImportPegawaiDialog", () => ({ ImportPegawaiDialog: () => null }));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: vi.fn() } }));
vi.mock("@/components/shared/DataTable", () => ({
  DataTable: ({ columns, data }: { columns: { key: string; label: string; render?: (value: unknown, row: Record<string, unknown>) => React.ReactNode }[]; data: Record<string, unknown>[] }) =>
    <table><thead><tr>{columns.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead>
      <tbody>{data.map(row => <tr key={String(row.id)}>{columns.map(c => <td key={c.key}>{c.render ? c.render(row[c.key], row) : String(row[c.key] || "")}</td>)}</tr>)}</tbody></table>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "pegawai_nik") mocks.nikReads();
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: async () => ({ data: [{ id: "fixture-id", nama: "Fixture Pegawai", nip: "fixture", jabatan: "Guru", status: "aktif" }], error: null }),
        maybeSingle: async () => ({ data: { nik: "3".repeat(16) }, error: null }),
        insert: (payload: unknown) => { mocks.insert(payload); return chain; },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({
          data: table === "pegawai_nik" ? [{ pegawai_id: "fixture-id", nik: "3".repeat(16) }] : [], error: null,
        }).then(resolve),
      };
      return chain;
    },
  },
}));

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><DataPegawai /></QueryClientProvider>);
}

describe("NIK pada halaman pegawai", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.role = "admin"; });

  it("admin melihat hanya empat digit terakhir di daftar", async () => {
    mount();
    await screen.findByText("•••• •••• •••• 3333");
    expect(screen.queryByText("3".repeat(16))).not.toBeInTheDocument();
  });

  it("guru tidak membaca NIK dan tidak mendapat kolom atau form NIK", async () => {
    mocks.role = "guru";
    mount();
    await screen.findByText("Fixture Pegawai");
    expect(mocks.nikReads).not.toHaveBeenCalled();
    expect(screen.queryByText("NIK")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tambah Pegawai" })).not.toBeInTheDocument();
  });

  it("NIK tidak valid menghentikan penyimpanan sebelum menulis pegawai", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Tambah Pegawai" }));
    fireEvent.change(screen.getByText("Nama *").parentElement!.querySelector("input")!, { target: { value: "Fixture Baru" } });
    fireEvent.change(screen.getByLabelText("NIK"), { target: { value: "123" } });
    const jobLabel = screen.getByText("Jabatan *");
    fireEvent.change(jobLabel.parentElement!.querySelector("input")!, { target: { value: "Guru" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }));
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("16 digit"));
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
