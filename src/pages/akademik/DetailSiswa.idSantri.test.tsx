import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ siswa: null as Record<string, unknown> | null }));

vi.mock("@/lib/router-compat", () => ({ useParams: () => ({ id: "s1" }), useNavigate: () => vi.fn() }));
vi.mock("@/hooks/useSiswa", () => ({
  useSiswaDetail: () => ({ data: mocks.siswa, isLoading: false }),
  useSiswaDetailOrangtua: () => ({ data: null }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [] }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/nisHistory", () => ({ nisHistoryClient: {} }));
vi.mock("@/components/akademik/SiswaSpmbDetail", () => ({ SiswaSpmbDetail: () => null }));

import DetailSiswa from "./DetailSiswa";

const siswa = (over: Record<string, unknown>) => ({
  id: "s1", nama: "Siswa Uji", nis: "2538001125", nisn: "3151677917", foto_url: null, status: "aktif",
  jenis_kelamin: "L", tempat_lahir: null, tanggal_lahir: null, departemen_id: null,
  kelas_siswa: [], angkatan: null, id_santri_pihak3: null, ...over,
});

beforeEach(() => { mocks.siswa = siswa({ id_santri_pihak3: "21.01.001" }); });
afterEach(cleanup);

describe("Detail Siswa: ID Santri", () => {
  it("menampilkan ID Santri (SiPaksa) di Data Pribadi", () => {
    render(<DetailSiswa />);
    const label = screen.getByText("ID Santri (SiPaksa)");
    expect(label.nextElementSibling).toHaveTextContent("21.01.001");
  });

  it("menampilkan tanda strip bila siswa belum punya ID Santri", () => {
    mocks.siswa = siswa({ id_santri_pihak3: null });
    render(<DetailSiswa />);
    expect(screen.getByText("ID Santri (SiPaksa)").nextElementSibling).toHaveTextContent("-");
  });

  it("letaknya tepat setelah NISN", () => {
    render(<DetailSiswa />);
    const nisn = screen.getByText("NISN").parentElement as HTMLElement;
    expect(nisn.nextElementSibling).toBe(screen.getByText("ID Santri (SiPaksa)").parentElement);
  });
});
