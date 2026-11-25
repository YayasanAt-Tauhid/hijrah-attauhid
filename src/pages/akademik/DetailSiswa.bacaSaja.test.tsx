import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ role: "keuangan" as string | null }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: mocks.role }) }));
vi.mock("@/lib/router-compat", () => ({ useParams: () => ({ id: "s1" }), useNavigate: () => vi.fn() }));
vi.mock("@/hooks/useSiswa", () => ({
  useSiswaDetail: () => ({
    data: {
      id: "s1", nama: "Siswa Uji", nis: "2538001125", nisn: null, foto_url: null, status: "aktif", jenis_kelamin: "L",
      tempat_lahir: null, tanggal_lahir: null, departemen_id: null, kelas_siswa: [], angkatan: null, id_santri_pihak3: null,
    },
    isLoading: false,
  }),
  useSiswaDetailOrangtua: () => ({ data: null }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [] }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/nisHistory", () => ({ nisHistoryClient: {} }));
vi.mock("@/components/akademik/SiswaSpmbDetail", () => ({ SiswaSpmbDetail: () => null }));

import DetailSiswa from "./DetailSiswa";

beforeEach(() => { mocks.role = "keuangan"; });
afterEach(cleanup);

describe("Detail Siswa: mode baca saja untuk keuangan", () => {
  it("tidak menampilkan tombol Edit Data Lengkap, tetapi tetap bisa dicetak", () => {
    render(<DetailSiswa />);
    expect(screen.getByRole("heading", { name: "Siswa Uji" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Print/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit Data Lengkap/ })).not.toBeInTheDocument();
  });

  it.each(["admin", "admin_tu", "kepala_sekolah"])("%s tetap melihat tombol Edit Data Lengkap", role => {
    mocks.role = role;
    render(<DetailSiswa />);
    expect(screen.getByRole("button", { name: /Edit Data Lengkap/ })).toBeInTheDocument();
  });
});
