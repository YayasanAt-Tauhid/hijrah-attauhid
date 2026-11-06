import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Kasus nyata 6 Nov 2026: akun potongan 4600/4601/4602 (kontra-pendapatan, saldo normal debit)
// dijumlahkan sebagai pendapatan positif sehingga neraca ISAK 35 selisih 2 x total potongan.
const db = vi.hoisted(() => ({
  akun: [] as Array<Record<string, unknown>>,
  saldoAwal: [] as Array<Record<string, unknown>>,
  mutasi: [] as Array<Record<string, unknown>>,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => {
  const hasil = (table: string) => {
    const data = table === "akun_rekening" ? db.akun : table === "saldo_awal_isak35" ? db.saldoAwal : [];
    const chain: object = new Proxy(() => {}, {
      get: (_t, prop) =>
        prop === "then"
          ? (resolve: (v: unknown) => void) => resolve({ data, error: null })
          : () => chain,
    });
    return chain;
  };
  return {
    supabase: {
      from: (table: string) => hasil(table),
      rpc: async () => ({ data: db.mutasi, error: null }),
    },
  };
});

import { useLaporanKomprehensif, useLaporanPosisiKeuangan } from "./useISAK35";

const akun = (id: string, kode: string, pos: string, saldo_normal: "D" | "K") => ({
  id, kode, nama: `Akun ${kode}`, pos_isak35: pos, saldo_normal, urutan_isak35: Number(kode), saldo_awal: 0,
});

// J1: D Kas 800, D Potongan 200, K Pendapatan 1000
// J2: D Beban 300, K Kas 300
// J3: D Kas 100, K Utang 100
beforeEach(() => {
  db.akun = [
    akun("kas", "1100", "aset_lancar", "D"),
    akun("utang", "2100", "kewajiban_jangka_pendek", "K"),
    akun("neto", "3100", "aset_neto_tidak_terikat", "K"),
    akun("spp", "4100", "pendapatan_tidak_terikat", "K"),
    akun("potongan", "4601", "pendapatan_tidak_terikat", "D"),
    akun("beban", "5100", "beban_program", "D"),
  ];
  db.saldoAwal = [];
  db.mutasi = [
    { akun_id: "kas", total_debit: 900, total_kredit: 300 },
    { akun_id: "utang", total_debit: 0, total_kredit: 100 },
    { akun_id: "spp", total_debit: 0, total_kredit: 1000 },
    { akun_id: "potongan", total_debit: 200, total_kredit: 0 },
    { akun_id: "beban", total_debit: 300, total_kredit: 0 },
  ];
});
afterEach(cleanup);

function pasang<T>(hook: () => T) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(hook, { wrapper });
}

describe("neraca ISAK 35 dengan akun kontra-pendapatan", () => {
  it("seimbang: potongan mengurangi surplus, bukan menambahnya", async () => {
    const { result } = pasang(() => useLaporanPosisiKeuangan({ type: "tahun", tahun: 2026 }));
    await waitFor(() => expect(result.current.data).toBeDefined());
    const d = result.current.data!;

    expect(d.totalAset).toBe(600);
    expect(d.totalLiabilitas).toBe(100);
    expect(d.surplusBerjalan).toBe(500); // 1000 - 200 potongan - 300 beban
    expect(d.totalAsetNeto).toBe(500);
    expect(d.selisih).toBe(0);
  });

  it("laporan penghasilan komprehensif menyajikan pendapatan neto (setelah potongan)", async () => {
    const { result } = pasang(() => useLaporanKomprehensif({ type: "tahun", tahun: 2026 }));
    await waitFor(() => expect(result.current.data).toBeDefined());
    const d = result.current.data!;

    expect(d.totalPendapatan).toBe(800);
    expect(d.surplusDefisit).toBe(500);
    const potongan = d.pendapatan.find((a) => a.kode === "4601");
    expect(potongan?.saldo).toBe(-200);
  });
});
