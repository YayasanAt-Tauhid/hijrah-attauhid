import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PortalNilai from "./PortalNilai";

const mocks = vi.hoisted(() => ({
  anak: [] as unknown[],
  nilai: {} as Record<string, unknown[]>,
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "parent" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) =>
    queryKey[0] === "portal-anak-nilai"
      ? { data: mocks.anak }
      : { data: mocks.nilai[queryKey[1]] ?? [], isLoading: false },
}));

const anak = (id: string, nama: string) => ({ siswa_id: id, siswa: { id, nama, nis: "1" } });
const nilai = (id: string, mapel: string, jenis: string, angka: number | null, ket: string | null, ta: string, sem: string) => ({
  id, nilai: angka, jenis_ujian: jenis, keterangan: ket,
  mapel: { nama: mapel }, tahun_ajaran: { nama: ta }, semester: { nama: sem },
});

beforeEach(() => {
  mocks.anak = [anak("a", "Ahmad Fauzi"), anak("b", "Siti Aisyah")];
  mocks.nilai = {
    a: [
      nilai("1", "Matematika", "UTS", 88, "Sangat baik", "2026/2027", "Ganjil"),
      nilai("2", "Bahasa Indonesia", "UTS", 82, null, "2026/2027", "Ganjil"),
      nilai("3", "Bahasa Arab", "UTS", 76, "Perbanyak kosakata", "2026/2027", "Ganjil"),
      nilai("4", "IPA", "UTS", 91, null, "2026/2027", "Ganjil"),
      nilai("5", "Tahfidz", "Setoran", 65, "Perlu pengulangan", "2026/2027", "Ganjil"),
      nilai("6", "Matematika", "UAS", 90, null, "2025/2026", "Genap"),
    ],
    b: [nilai("7", "IPS", "UTS", 70, null, "2026/2027", "Ganjil")],
  };
});
afterEach(cleanup);

describe("Nilai anak", () => {
  it("memakai judul dan subjudul yang jelas", () => {
    render(<PortalNilai />);
    expect(screen.getByRole("heading", { level: 1, name: "Nilai Anak" })).toBeInTheDocument();
    expect(screen.getByText("Nilai akademik anak per semester.")).toBeInTheDocument();
  });

  it("mengelompokkan per periode dan menampilkan rata-rata berformat Indonesia", () => {
    render(<PortalNilai />);
    expect(screen.getByText("2026/2027 — Ganjil")).toBeInTheDocument();
    expect(screen.getByText("Rata-rata 80,4")).toBeInTheDocument();
    expect(screen.getByText("2025/2026 — Genap")).toBeInTheDocument();
    expect(screen.getByText("Rata-rata 90,0")).toBeInTheDocument();
  });

  it("periode pertama terbuka dan periode berikutnya tertutup", () => {
    const { container } = render(<PortalNilai />);
    const periode = Array.from(container.querySelectorAll("details"));
    expect(periode).toHaveLength(2);
    expect(periode[0].open).toBe(true);
    expect(periode[1].open).toBe(false);
  });

  it("setiap nilai menyebut mata pelajaran, jenis ujian, dan keterangan bila ada", () => {
    render(<PortalNilai />);
    const baris = screen.getByText("Bahasa Arab").closest("li") as HTMLElement;
    expect(within(baris).getByText("UTS")).toBeInTheDocument();
    expect(within(baris).getByText("Perbanyak kosakata")).toBeInTheDocument();
    expect(within(baris).getByLabelText("Nilai 76")).toHaveTextContent("76");
  });

  it("nilai di bawah 70 diberi keterangan teks, tidak hanya warna merah", () => {
    render(<PortalNilai />);
    expect(screen.getByLabelText("Nilai 65, di bawah 70")).toHaveTextContent("65");
    expect(screen.getByLabelText("Nilai 88")).toBeInTheDocument();
  });

  it("anak dipilih lewat chip dan mengganti nilai yang tampil", () => {
    render(<PortalNilai />);
    fireEvent.click(screen.getByRole("button", { name: /Siti Aisyah/ }));
    expect(screen.getByText("IPS")).toBeInTheDocument();
    expect(screen.queryByText("Matematika")).not.toBeInTheDocument();
    expect(screen.getByText("Rata-rata 70,0")).toBeInTheDocument();
  });

  it("menampilkan pesan kosong bila belum ada nilai", () => {
    mocks.nilai = { a: [], b: [] };
    render(<PortalNilai />);
    expect(screen.getByText("Belum ada data nilai")).toBeInTheDocument();
  });
});
