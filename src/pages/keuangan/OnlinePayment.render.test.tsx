// Uji render Online Payment: kolom Dibuat/Dibayar bersebelahan dan filter tanggal berdasarkan
// created_at atau paid_at (batas hari WIB, urutan mengikuti kolom, paid_at kosong tidak ikut).
// Urutan HANYA asc/desc: Rustbase tidak mengenali "nullslast"/"nullsfirst" dan memperlakukannya sebagai
// nama kolom sehingga daftar kosong (galat produksi 26 Nov 2026).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ calls: [] as unknown[][], rows: [] as Record<string, unknown>[] }));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (tabel: string) => {
    const b: Record<string, unknown> = {};
    for (const k of ["select", "order", "eq", "ilike", "gte", "lte", "not", "limit", "in", "maybeSingle", "single"]) {
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
vi.mock("@/pages/keuangan/LaporanOnlinePaymentJenis", () => ({ default: () => null }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: { children: ReactNode; value: string; onValueChange: (v: string) => void }) =>
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => <option value={value}>{children}</option>,
}));

import OnlinePayment from "./OnlinePayment";

const tampil = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <OnlinePayment />
    </QueryClientProvider>,
  );

const panggilanDaftar = () => m.calls.filter((c) => c[0] === "transaksi_midtrans");
const pilihFilterKolom = () => {
  const s = screen.getAllByRole("combobox").find((el) => within(el).queryByText("Tanggal dibayar"));
  if (!s) throw new Error("pilihan 'Filter berdasarkan' tidak ada");
  return s;
};

beforeEach(() => {
  m.calls = [];
  m.rows = [{
    id: "t1", order_id: "HAT-1", total_amount: 100000, status: "paid", payment_type: "qris",
    created_at: "2026-11-20T03:00:00Z", paid_at: "2026-11-25T05:30:00Z",
  }];
});
afterEach(cleanup);

describe("Online Payment: kolom tanggal", () => {
  it("menampilkan kolom Dibuat lalu Dibayar bersebelahan, tanpa kolom 'Tanggal' yang ambigu", async () => {
    tampil();
    await screen.findByText("HAT-1");
    const kepala = within(screen.getByRole("table")).getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(kepala).not.toContain("Tanggal");
    const i = kepala.findIndex((h) => h?.startsWith("Dibuat"));
    expect(i).toBeGreaterThan(-1);
    expect(kepala[i + 1]?.startsWith("Dibayar")).toBe(true);
  });
});

describe("Online Payment: filter tanggal", () => {
  it("bawaan: urut dan filter memakai created_at (perilaku lama), paid_at kosong tetap tampil", async () => {
    tampil();
    await screen.findByText("HAT-1");
    const daftar = panggilanDaftar();
    expect(daftar).toContainEqual(["transaksi_midtrans", "order", "created_at", { ascending: false }]);
    expect(daftar.some((c) => c[1] === "not")).toBe(false);
  });

  it("created_at: Dari/Sampai dikirim dengan batas WIB", async () => {
    const { container } = tampil();
    await screen.findByText("HAT-1");
    const [dari, sampai] = Array.from(container.querySelectorAll('input[type="date"]'));
    m.calls = [];
    fireEvent.change(dari, { target: { value: "2026-11-25" } });
    fireEvent.change(sampai, { target: { value: "2026-11-26" } });
    await waitFor(() => {
      const d = panggilanDaftar();
      expect(d).toContainEqual(["transaksi_midtrans", "gte", "created_at", "2026-11-25T00:00:00+07:00"]);
      expect(d).toContainEqual(["transaksi_midtrans", "lte", "created_at", "2026-11-26T23:59:59.999+07:00"]);
    });
  });

  it("tanggal dibayar: filter, urutan, dan penyaring paid_at kosong memakai paid_at", async () => {
    const { container } = tampil();
    await screen.findByText("HAT-1");
    const [dari, sampai] = Array.from(container.querySelectorAll('input[type="date"]'));
    fireEvent.change(dari, { target: { value: "2026-11-25" } });
    fireEvent.change(sampai, { target: { value: "2026-11-26" } });
    m.calls = [];
    fireEvent.change(pilihFilterKolom(), { target: { value: "paid_at" } });
    await waitFor(() => {
      const d = panggilanDaftar();
      expect(d).toContainEqual(["transaksi_midtrans", "gte", "paid_at", "2026-11-25T00:00:00+07:00"]);
      expect(d).toContainEqual(["transaksi_midtrans", "lte", "paid_at", "2026-11-26T23:59:59.999+07:00"]);
      expect(d).toContainEqual(["transaksi_midtrans", "not", "paid_at", "is", null]);
      expect(d).toContainEqual(["transaksi_midtrans", "order", "paid_at", { ascending: false }]);
      expect(d.some((c) => c[1] === "gte" && c[2] === "created_at")).toBe(false);
    });
  });
});
