import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CetakRekapKasir } from "./CetakRekapKasir";
import type { RekapKasirItem } from "@/lib/rekapKasirSummary";

const item = (overrides: Partial<RekapKasirItem>): RekapKasirItem => ({
  id: "p",
  jumlah: 450000,
  tanggal_bayar: "2026-11-11",
  bulan: null,
  keterangan: null,
  siswa_nama: "Nailah Rasiyah Fauzi",
  siswa_nis: "2570012126075",
  siswa_nisn: "0125455470",
  siswa_status: "aktif",
  kelas_nama: "8C",
  jenis_nama: "SPP SMP",
  departemen_nama: "SMP",
  departemen_kode: "SMP",
  jurnal_nomor: "JU-1",
  receipt_number: "KWT-2026-11-0439",
  payment_method: "Tunai",
  periode_label: "Oktober 2026",
  ...overrides,
});

const items = [
  item({ id: "a" }),
  item({ id: "b", periode_label: "November 2026" }),
  item({ id: "c", tanggal_bayar: "2026-11-12", departemen_nama: "SD", jenis_nama: "SPP SD", jumlah: 350000,
    payment_method: "bank_transfer", receipt_number: "KWT-2026-11-0440", siswa_nama: "Ahmad Fadil" }),
];

const renderPrint = (props: Partial<Parameters<typeof CetakRekapKasir>[0]> = {}) =>
  render(
    <CetakRekapKasir
      items={items}
      petugasNama="Fitri Yanto, S.Si"
      bendaharaNama="Hj. Siti Aminah"
      dari="2026-11-11"
      sampai="2026-11-12"
      dicetakPada={new Date("2026-11-12T16:30:00")}
      {...props}
    />,
  );

describe("CetakRekapKasir", () => {
  it("renders into body as a print-only A4 report with the foundation letterhead", () => {
    renderPrint();
    const root = document.getElementById("rekap-kasir-print")!;
    expect(root.parentElement).toBe(document.body);
    expect(root.className).toContain("hidden");
    expect(root.className).toContain("print:!block");
    expect(root.querySelector("img")?.getAttribute("src")).toBe("/branding/yayasan-at-tauhid.png");
    expect(root.textContent).toContain("YAYASAN AT-TAUHID AL ISLAMY BANGKA BELITUNG");
    expect(root.textContent).toContain("LAPORAN REKAPITULASI PENERIMAAN KASIR");
    expect(root.textContent).toContain("Petugas : Fitri Yanto, S.Si");
    expect(root.textContent).toContain("Periode : 11 November 2026 s.d. 12 November 2026");
  });

  it("shows the same summary numbers as the Excel report, in Indonesian number format", () => {
    renderPrint();
    const lembaga = screen.getByRole("table", { name: "Rekap per Lembaga dan Jenis Pembayaran" });
    expect(within(lembaga).getByText("Subtotal SMP").closest("tr")?.textContent).toContain("900.000");
    expect(within(lembaga).getByText("Subtotal SD").closest("tr")?.textContent).toContain("350.000");

    const metode = screen.getByRole("table", { name: "Rekap per Metode Bayar" });
    expect(within(metode).getByText("Tunai").closest("tr")?.textContent).toContain("900.000");
    expect(within(metode).getByText("Transfer").closest("tr")?.textContent).toContain("350.000");

    const tanggal = screen.getByRole("table", { name: "Rekap per Tanggal" });
    expect(within(tanggal).getAllByRole("columnheader").map((th) => th.textContent))
      .toEqual(["No", "Tanggal", "Jumlah Transaksi", "Tunai", "Transfer", "Total (Rp)"]);

    expect(screen.getByText("TOTAL PENERIMAAN").closest("tr")?.textContent).toContain("1.250.000");
  });

  it("lists every transaction on its own page in Rincian", () => {
    renderPrint();
    const rincian = screen.getByRole("table", { name: "Rincian Penerimaan" });
    expect(rincian.closest(".rekap-page-break")).not.toBeNull();
    const bodyRows = within(rincian).getAllByRole("row").filter((row) => row.closest("tbody"));
    // 3 transaksi + baris TOTAL
    expect(bodyRows).toHaveLength(4);
    expect(bodyRows[2].textContent).toContain("Ahmad Fadil");
    expect(bodyRows[2].textContent).toContain("Transfer");
    expect(bodyRows[3].textContent).toContain("1.250.000");
  });

  it("signs with Kasir, Staf Keuangan and Mengetahui Bendahara", () => {
    renderPrint();
    const ttd = screen.getByTestId("rekap-kasir-ttd");
    expect(ttd.textContent).toContain("Kasir,");
    expect(ttd.textContent).toContain("Staf Keuangan,");
    expect(ttd.textContent).toContain("Mengetahui, Bendahara,");
    expect(ttd.textContent).toContain("Fitri Yanto, S.Si");
    expect(ttd.textContent).toContain("Hj. Siti Aminah");
  });

  it("leaves the Bendahara line blank when the profile has no name", () => {
    renderPrint({ bendaharaNama: null });
    expect(screen.getByTestId("rekap-kasir-ttd").textContent).not.toContain("Hj. Siti Aminah");
  });

  it("reports readiness once the logo has loaded or failed", () => {
    const onReady = vi.fn();
    renderPrint({ onReady });
    const img = document.querySelector("#rekap-kasir-print img")!;
    img.dispatchEvent(new Event("load"));
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});

describe("kontrak cetak rekap kasir", () => {
  const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
  const page = readFileSync(resolve(process.cwd(), "src/pages/keuangan/RekapKasirSaya.tsx"), "utf8");

  it("prints on its own A4 landscape page with colours kept", () => {
    expect(css).toContain("@page rekap-kasir");
    expect(css).toMatch(/@page rekap-kasir\s*\{[^}]*size: A4 landscape/);
    expect(css).toContain("print-color-adjust: exact");
    expect(css).toContain("body:has(> #rekap-kasir-print) > *:not(#rekap-kasir-print)");
  });

  it("exposes a Cetak / PDF button on the cashier recap page", () => {
    expect(page).toContain("Cetak / PDF");
    expect(page).toContain("<CetakRekapKasir");
    expect(page).toContain("bendaharaNama={data.bendahara_nama}");
  });
});

describe("CetakRekapKasir dengan filter lembaga", () => {
  it("menyebut lembaga di kop bila difilter", () => {
    renderPrint({ lembagaLabel: "SD — Sekolah Dasar" });
    const root = document.getElementById("rekap-kasir-print")!;
    expect(root.textContent).toContain("Lembaga : SD — Sekolah Dasar");
  });

  it("tidak menyebut baris Lembaga di kop tanpa filter", () => {
    renderPrint();
    const root = document.getElementById("rekap-kasir-print")!;
    expect(root.textContent).not.toContain("Lembaga :");
  });
});

describe("CetakRekapKasir dengan filter jenis pembayaran", () => {
  it("menyebut jenis di kop bila difilter", () => {
    renderPrint({ jenisLabel: "SPP SMP" });
    const root = document.getElementById("rekap-kasir-print")!;
    expect(root.textContent).toContain("Jenis : SPP SMP");
  });

  it("menyebut lembaga dan jenis berdampingan", () => {
    renderPrint({ lembagaLabel: "SD — Sekolah Dasar", jenisLabel: "SPP SD" });
    const root = document.getElementById("rekap-kasir-print")!;
    expect(root.textContent).toContain("Lembaga : SD — Sekolah Dasar·Jenis : SPP SD");
  });

  it("tidak menyebut Jenis di kop tanpa filter", () => {
    renderPrint();
    const root = document.getElementById("rekap-kasir-print")!;
    expect(root.textContent).not.toContain("Jenis :");
  });
});
