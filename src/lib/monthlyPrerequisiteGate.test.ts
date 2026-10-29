import { describe, expect, it } from "vitest";
import type { BillingSequenceBill } from "./billingSequence";
import { evaluateMonthlyGate, orderWithinSlots } from "./monthlyPrerequisiteGate";

const bill = (
  id: string,
  bulan: number,
  jatuhTempo: string,
  extra: Partial<BillingSequenceBill> = {},
): BillingSequenceBill => ({
  id,
  siswa_id: "siswa-1",
  jenis_id: "spp",
  bulan,
  jatuh_tempo: jatuhTempo,
  tahun_ajaran: { nama: "2026/2027", tanggal_mulai: "2026-07-01" },
  ...extra,
});

const agustus = bill("agt", 8, "2026-08-10");
const september = bill("sep", 9, "2026-09-10");
const oktober = bill("okt", 10, "2026-10-10");
const ALASAN = "Orang tua berkomitmen melunasi bulan lalu minggu depan";

const gate = (
  role: string | null,
  alasan?: string,
  target: BillingSequenceBill = oktober,
  openBills: BillingSequenceBill[] = [agustus, september, oktober],
  selected?: Set<string>,
) =>
  evaluateMonthlyGate({
    role,
    jenisNama: "SPP",
    target,
    openBills,
    alasan,
    selectedBillIds: selected,
  });

describe("gerbang prasyarat tagihan bulanan", () => {
  it("lolos untuk tagihan bulanan tertua", () => {
    expect(gate("admin", undefined, agustus)).toEqual({ status: "clear" });
  });

  it("lolos bila bulan sebelumnya ikut dibayar penuh di keranjang yang sama", () => {
    expect(gate("keuangan", undefined, oktober, undefined, new Set(["agt", "sep"]))).toEqual({
      status: "clear",
    });
  });

  it("mengabaikan alasan bila tidak ada yang menghalangi", () => {
    expect(gate("admin", ALASAN, agustus)).toEqual({ status: "clear" });
  });

  it("memblokir admin tanpa alasan dan meminta alasan dispensasi", () => {
    const result = gate("admin");
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.message).toContain("Selesaikan SPP Agustus 2026 terlebih dahulu sebelum membayar Oktober 2026.");
      expect(result.message).toMatch(/alasan dispensasi/i);
    }
  });

  it("memblokir keuangan yang hanya mengisi spasi", () => {
    expect(gate("keuangan", "     ").status).toBe("blocked");
  });

  it("memblokir kasir walau ada alasan", () => {
    const result = gate("kasir", ALASAN);
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.message).toMatch(/minta admin atau keuangan/i);
      expect(result.message).not.toMatch(/isi alasan/i);
    }
  });

  it("memblokir kasir tanpa alasan dan mengarahkan ke admin atau keuangan", () => {
    const result = gate("kasir");
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.message).toMatch(/minta admin atau keuangan/i);
    }
  });

  it("memblokir alasan yang terlalu pendek", () => {
    const result = gate("admin", "nanti");
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") expect(result.message).toMatch(/minimal 10/i);
  });

  it("mengizinkan admin dengan alasan dan mencatat tagihan prasyarat tertua", () => {
    expect(gate("admin", `  ${ALASAN}  `)).toEqual({
      status: "override",
      alasan: ALASAN,
      prerequisiteId: "agt",
    });
  });

  it("tidak membocorkan dispensasi ke jenis atau siswa lain", () => {
    const lain = bill("spp-lain", 8, "2026-08-10", { jenis_id: "gedung" });
    const siswaLain = bill("siswa-lain", 8, "2026-08-10", { siswa_id: "siswa-2" });
    expect(gate("admin", undefined, oktober, [lain, siswaLain, oktober])).toEqual({
      status: "clear",
    });
  });

  it("lintas tahun ajaran: bulan Juli tahun baru menunggu Juni tahun lama", () => {
    const juni = bill("jun", 6, "2026-06-10", {
      tahun_ajaran: { nama: "2025/2026", tanggal_mulai: "2025-07-01" },
    });
    const juli = bill("jul", 7, "2026-07-10");
    const result = gate("admin", undefined, juli, [juni, juli]);
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") expect(result.message).toContain("Juni 2026");
  });
});

describe("urutan item keranjang", () => {
  const items = [
    { key: "okt", kind: "bulanan", order: "2026-10-10" },
    { key: "pangkal", kind: "sekali", order: "" },
    { key: "agt", kind: "bulanan", order: "2026-08-10" },
    { key: "sep", kind: "bulanan", order: "2026-09-10" },
  ];

  it("mengurutkan item dalam lingkup tanpa menggeser posisi item lain", () => {
    const result = orderWithinSlots(
      items,
      (item) => item.kind === "bulanan",
      (a, b) => a.order.localeCompare(b.order),
    );
    expect(result.map((item) => item.key)).toEqual(["agt", "pangkal", "sep", "okt"]);
  });

  it("tidak mengubah array asli dan stabil untuk nilai yang sama", () => {
    const same = [
      { key: "a", kind: "bulanan", order: "x" },
      { key: "b", kind: "bulanan", order: "x" },
    ];
    const copy = [...same];
    const result = orderWithinSlots(same, () => true, (a, b) => a.order.localeCompare(b.order));
    expect(same).toEqual(copy);
    expect(result.map((item) => item.key)).toEqual(["a", "b"]);
  });

  it("mengembalikan item apa adanya bila tidak ada yang masuk lingkup", () => {
    expect(orderWithinSlots(items, () => false, () => 0)).toEqual(items);
  });
});
