import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GraduationCap } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnakChips, AnakInfo } from "./AnakChips";
import { PortalHero } from "./PortalHero";

afterEach(cleanup);

describe("PortalHero", () => {
  it("menampilkan judul, subjudul, dan teks pembuka", () => {
    render(
      <PortalHero
        icon={GraduationCap}
        eyebrow="Assalamu'alaikum,"
        title="Ahmad Sulaiman"
        subtitle="Portal Orang Tua Hijrah At-Tauhid"
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Ahmad Sulaiman" })).toBeInTheDocument();
    expect(screen.getByText("Assalamu'alaikum,")).toBeInTheDocument();
    expect(screen.getByText("Portal Orang Tua Hijrah At-Tauhid")).toBeInTheDocument();
  });

  it("menyembunyikan ikon dekoratif dari pembaca layar", () => {
    const { container } = render(<PortalHero icon={GraduationCap} title="Nilai Anak" />);
    expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("AnakChips", () => {
  const anak = [
    { id: "a", nama: "Ahmad Fauzi" },
    { id: "b", nama: "Siti Aisyah Nurul" },
  ];

  it("tidak tampil bila hanya ada satu anak atau kurang", () => {
    const { container, rerender } = render(
      <AnakChips anak={[anak[0]]} selectedId="a" onSelect={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<AnakChips anak={[]} selectedId="" onSelect={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("menandai anak terpilih dengan aria-pressed dan memanggil onSelect", () => {
    const onSelect = vi.fn();
    render(<AnakChips anak={anak} selectedId="a" onSelect={onSelect} />);
    const group = screen.getByRole("group", { name: "Pilih anak" });
    expect(group).toBeInTheDocument();

    const pertama = screen.getByRole("button", { name: /Ahmad Fauzi/ });
    const kedua = screen.getByRole("button", { name: /Siti Aisyah Nurul/ });
    expect(pertama).toHaveAttribute("aria-pressed", "true");
    expect(kedua).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(kedua);
    expect(onSelect).toHaveBeenCalledWith("b");
  });
});

describe("AnakInfo", () => {
  it("menampilkan nama dan NIS anak tunggal", () => {
    render(<AnakInfo nama="Ahmad Fauzi" nis="20240117" />);
    expect(screen.getByText("Ahmad Fauzi")).toBeInTheDocument();
    expect(screen.getByText("NIS 20240117")).toBeInTheDocument();
  });

  it("memakai tanda hubung bila NIS kosong", () => {
    render(<AnakInfo nama="Ahmad Fauzi" nis={null} />);
    expect(screen.getByText("NIS -")).toBeInTheDocument();
  });
});
