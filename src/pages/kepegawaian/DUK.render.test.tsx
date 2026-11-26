// Uji render DUK: urutan golongan memakai asc/desc saja (Rustbase tidak mengenali "nullslast"/"nullsfirst",
// dianggap nama kolom sehingga daftar kosong; galat produksi 26 Nov 2026) dan pegawai tanpa golongan
// tetap di urutan akhir.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ calls: [] as unknown[][], rows: [] as Record<string, unknown>[] }));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (tabel: string) => {
    const b: Record<string, unknown> = {};
    for (const k of ["select", "order", "eq", "is", "limit"]) {
      b[k] = (...a: unknown[]) => {
        m.calls.push([tabel, k, ...a]);
        return b;
      };
    }
    b.then = (res: (v: unknown) => unknown) => res({ data: m.rows, error: null });
    return b;
  };
  return { supabase: { from: (t: string) => builder(t) } };
});
vi.mock("@/hooks/useKeuangan", () => ({ useLembaga: () => ({ data: [] }) }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: () => null, SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: () => null,
}));

import DUK from "./DUK";

const pegawai = (nama: string, golongan: string | null) => ({
  id: nama, nama, nip: null, jabatan: null, golongan_terakhir: golongan, status: "aktif",
  tanggal_masuk: null, tanggal_lahir: null, tanggal_pensiun: null, departemen: null,
});

const tampil = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DUK />
    </QueryClientProvider>,
  );

beforeEach(() => {
  m.calls = [];
  // Urutan seperti dari Postgres untuk ORDER BY golongan DESC: NULL lebih dulu.
  m.rows = [pegawai("Ani", null), pegawai("Budi", "IV/b"), pegawai("Cici", null), pegawai("Dedi", "III/a")];
});
afterEach(cleanup);

describe("DUK", () => {
  it("mengurutkan golongan dengan opsi persis { ascending: false } (tanpa nullsFirst/nullslast)", async () => {
    tampil();
    await screen.findByText("Budi");
    const urut = m.calls.filter((c) => c[1] === "order");
    expect(urut).toEqual([["pegawai", "order", "golongan_terakhir", { ascending: false }]]);
  });

  it("pegawai tanpa golongan di akhir; yang bergolongan tetap urut golongan; nomor berurutan", async () => {
    tampil();
    await screen.findByText("Budi");
    await waitFor(() => {
      const baris = within(screen.getByRole("table")).getAllByRole("row").slice(1);
      const isi = baris.map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
      expect(isi.map((c) => [c[0], c[1]])).toEqual([["1", "Budi"], ["2", "Dedi"], ["3", "Ani"], ["4", "Cici"]]);
    });
  });
});
