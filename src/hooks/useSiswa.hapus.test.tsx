import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  hapusSiswa: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/server/siswaDeletion", () => ({ hapusSiswa: mocks.hapusSiswa }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/fetchAll", () => ({ fetchAllPages: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, profile: null, role: null }) }));
vi.mock("@/lib/akademikScope", () => ({ getAkademikManagedDepartemenIds: vi.fn() }));

import { useDeleteSiswa } from "./useSiswa";
import { SiswaPunyaRiwayatError } from "@/lib/siswaDeletion";

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useDeleteSiswa(), { wrapper });
  return { result, invalidate };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("useDeleteSiswa", () => {
  it("memanggil server function dengan id siswa lalu menyegarkan daftar", async () => {
    mocks.hapusSiswa.mockResolvedValue({ ok: true });
    const { result, invalidate } = setup();

    await result.current.mutateAsync("abc");

    expect(mocks.hapusSiswa).toHaveBeenCalledWith({ data: { siswa_id: "abc" } });
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith("Siswa berhasil dihapus"));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["siswa"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["statistik_siswa"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["siswa_detail"] });
  });

  it("melempar SiswaPunyaRiwayatError tanpa toast galat dan tanpa menyegarkan daftar bila siswa punya riwayat", async () => {
    const riwayat = [{ tabel: "tagihan", jumlah: 3 }];
    mocks.hapusSiswa.mockResolvedValue({ ok: false, alasan: "punya_riwayat", riwayat });
    const { result, invalidate } = setup();

    const err = await result.current.mutateAsync("abc").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SiswaPunyaRiwayatError);
    expect((err as SiswaPunyaRiwayatError).riwayat).toEqual(riwayat);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("menampilkan galat lain lewat toast", async () => {
    mocks.hapusSiswa.mockRejectedValue(new Error("koneksi putus"));
    const { result } = setup();

    await expect(result.current.mutateAsync("abc")).rejects.toThrow("koneksi putus");

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Gagal menghapus siswa: koneksi putus"),
    );
  });
});
