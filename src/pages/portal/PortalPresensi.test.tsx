import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PortalPresensi from "./PortalPresensi";

const mocks = vi.hoisted(() => ({
  anak: [] as unknown[],
  presensi: {} as Record<string, unknown[]>,
  loading: false,
  queries: [] as string[][],
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "parent" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    mocks.queries.push(queryKey);
    if (queryKey[0] === "portal-anak-presensi") return { data: mocks.anak };
    return { data: mocks.presensi[queryKey[1]] ?? [], isLoading: mocks.loading };
  },
}));

const anak = (id: string, nama: string) => ({ siswa_id: id, siswa: { id, nama, nis: "1" } });
const baris = (id: string, status: string, tanggal: string, keterangan: string | null = null) => ({
  id, status, tanggal, keterangan,
});

beforeEach(() => {
  mocks.loading = false;
  mocks.queries = [];
  mocks.anak = [anak("a", "Ahmad Fauzi"), anak("b", "Siti Aisyah")];
  mocks.presensi = {
    a: [
      ...Array.from({ length: 18 }, (_, i) => baris(`h${i}`, "H", "2026-11-27")),
      baris("i1", "I", "2026-11-24", "Acara keluarga"),
      baris("i2", "I", "2026-11-17"),
      baris("s1", "S", "2026-11-25", "Demam"),
      baris("a1", "A", "2026-11-19"),
    ],
    b: [baris("b1", "H", "2026-11-26"), baris("b2", "A", "2026-11-25")],
  };
});
afterEach(cleanup);

describe("Presensi anak", () => {
  it("memakai judul dan subjudul yang jelas", () => {
    render(<PortalPresensi />);
    expect(screen.getByRole("heading", { level: 1, name: "Presensi Anak" })).toBeInTheDocument();
    expect(screen.getByText("Rekap kehadiran anak di sekolah.")).toBeInTheDocument();
  });

  it("ringkasan menampilkan persentase hadir dan jumlah tiap status", () => {
    render(<PortalPresensi />);
    const ringkasan = screen.getByRole("region", { name: "Ringkasan presensi" });
    expect(within(ringkasan).getByText("82%")).toBeInTheDocument();
    expect(within(ringkasan).getByText("Dari 22 presensi terakhir")).toBeInTheDocument();
    const nilai = (label: string) =>
      within(ringkasan).getByText(label).parentElement?.textContent;
    expect(nilai("Hadir")).toContain("18");
    expect(nilai("Izin")).toContain("2");
    expect(nilai("Sakit")).toContain("1");
    expect(nilai("Alpha")).toContain("1");
  });

  it("anak dipilih lewat chip dan mengganti data yang ditampilkan", () => {
    render(<PortalPresensi />);
    expect(screen.getByRole("button", { name: /Ahmad Fauzi/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /Siti Aisyah/ }));
    expect(screen.getByRole("button", { name: /Siti Aisyah/ })).toHaveAttribute("aria-pressed", "true");
    const ringkasan = screen.getByRole("region", { name: "Ringkasan presensi" });
    expect(within(ringkasan).getByText("50%")).toBeInTheDocument();
    expect(within(ringkasan).getByText("Dari 2 presensi terakhir")).toBeInTheDocument();
  });

  it("tidak menampilkan chip bila hanya ada satu anak", () => {
    mocks.anak = [anak("a", "Ahmad Fauzi")];
    render(<PortalPresensi />);
    expect(screen.queryByRole("group", { name: "Pilih anak" })).not.toBeInTheDocument();
  });

  it("riwayat memuat tanggal berbahasa Indonesia, status berupa teks, dan keterangan", () => {
    render(<PortalPresensi />);
    const riwayat = screen.getByRole("region", { name: "Riwayat presensi" });
    expect(within(riwayat).getAllByText("Jumat, 27 November 2026").length).toBeGreaterThan(0);
    expect(within(riwayat).getByText("Acara keluarga")).toBeInTheDocument();
    expect(within(riwayat).getByText("Demam")).toBeInTheDocument();
    expect(within(riwayat).getAllByText("Alpha")).toHaveLength(1);
    expect(within(riwayat).getAllByText("Sakit")).toHaveLength(1);
  });

  it("menampilkan pesan kosong bila belum ada presensi", () => {
    mocks.presensi = { a: [], b: [] };
    render(<PortalPresensi />);
    expect(screen.getByText("Belum ada data presensi")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Ringkasan presensi" })).getByText("0%")).toBeInTheDocument();
  });
});
