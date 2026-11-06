import { describe, expect, it } from "vitest";
import type { BillingSequenceBill } from "./billingSequence";
import { evaluateOneTimeGate, evaluateSelfServiceOneTimeGate } from "./oneTimePrerequisiteGate";

const bill = (
  id: string,
  nama: string,
  start: string,
  extra: Partial<BillingSequenceBill> = {},
): BillingSequenceBill => ({
  id,
  siswa_id: "siswa-1",
  jenis_id: "uang-pangkal",
  bulan: null,
  tahun_ajaran: { nama, tanggal_mulai: start },
  ...extra,
});

const lama = bill("lama", "2025/2026", "2025-07-01");
const baru = bill("baru", "2026/2027", "2026-07-01");
const ALASAN = "Orang tua berkomitmen melunasi sebelum Januari";

const gate = (
  role: string | null,
  alasan?: string,
  openBills: BillingSequenceBill[] = [lama, baru],
  target: BillingSequenceBill = baru,
) =>
  evaluateOneTimeGate({
    role,
    jenisNama: "Uang Pangkal",
    target,
    openBills,
    alasan,
  });

describe("gerbang prasyarat sekali bayar", () => {
  it("lolos bila tidak ada tagihan tahun sebelumnya yang terbuka", () => {
    expect(gate("kasir", undefined, [baru])).toEqual({ status: "clear" });
    expect(gate("admin", undefined, [baru])).toEqual({ status: "clear" });
  });

  it("mengabaikan alasan bila tidak ada yang menghalangi", () => {
    expect(gate("admin", ALASAN, [baru])).toEqual({ status: "clear" });
  });

  it("memblokir kasir tanpa alasan dan mengarahkan ke admin atau keuangan", () => {
    const result = gate("kasir");
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.message).toContain(
        "Selesaikan Uang Pangkal tahun ajaran 2025/2026 terlebih dahulu sebelum membayar tahun ajaran 2026/2027.",
      );
      expect(result.message).toMatch(/minta admin atau keuangan/i);
    }
  });

  it("memblokir admin tanpa alasan dan meminta alasan dispensasi", () => {
    const result = gate("admin");
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.message).toContain("Selesaikan Uang Pangkal tahun ajaran 2025/2026");
      expect(result.message).toMatch(/isi alasan dispensasi/i);
    }
  });

  it("memblokir bila alasan hanya spasi", () => {
    expect(gate("keuangan", "   ").status).toBe("blocked");
  });

  it.each(["admin", "keuangan", "kepala_sekolah"])(
    "mengizinkan dispensasi dari peran %s dengan alasan cukup",
    (role) => {
      expect(gate(role, ALASAN)).toEqual({
        status: "override",
        alasan: ALASAN,
        prerequisiteId: "lama",
      });
    },
  );

  it("merapikan spasi pada alasan yang dicatat", () => {
    expect(gate("admin", `  ${ALASAN}  \n`)).toEqual({
      status: "override",
      alasan: ALASAN,
      prerequisiteId: "lama",
    });
  });

  it("menolak kasir meskipun alasan diisi", () => {
    const result = gate("kasir", ALASAN);
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.message).toMatch(/tidak berwenang/i);
    }
  });

  it("menolak alasan yang terlalu pendek dengan pesan alasan", () => {
    const result = gate("admin", "singkat");
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.message).toMatch(/alasan dispensasi minimal/i);
    }
  });

  it("mencatat tagihan terlama sebagai prasyarat yang dilewati", () => {
    const palingLama = bill("paling-lama", "2024/2025", "2024-07-01");
    expect(gate("admin", ALASAN, [lama, baru, palingLama])).toEqual({
      status: "override",
      alasan: ALASAN,
      prerequisiteId: "paling-lama",
    });
  });

  it("tidak memblokir tagihan tahun ajaran lama oleh yang lebih baru", () => {
    expect(gate("kasir", undefined, [lama, baru], lama)).toEqual({ status: "clear" });
  });
});

describe("gerbang sekali bayar untuk orang tua (portal & link pembayaran)", () => {
  const selfService = (
    target: BillingSequenceBill = baru,
    openBills: BillingSequenceBill[] = [lama, baru],
    fullyPaidBillIds?: Set<string>,
  ) =>
    evaluateSelfServiceOneTimeGate({
      jenisNama: "Uang Pangkal",
      target,
      openBills,
      fullyPaidBillIds,
    });

  it("lolos bila tidak ada tagihan tahun sebelumnya yang terbuka", () => {
    expect(selfService(baru, [baru])).toEqual({ status: "clear" });
  });

  it("lolos untuk tagihan tahun ajaran tertua", () => {
    expect(selfService(lama)).toEqual({ status: "clear" });
  });

  it("memblokir tagihan baru dan mengarahkan ke pihak keuangan sekolah, tanpa jalur dispensasi", () => {
    const result = selfService();
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.message).toContain(
        "Selesaikan Uang Pangkal tahun ajaran 2025/2026 terlebih dahulu sebelum membayar tahun ajaran 2026/2027.",
      );
      expect(result.message).toMatch(/hubungi.*keuangan/i);
      expect(result.message).not.toMatch(/alasan dispensasi/i);
    }
  });

  it("lolos bila tagihan tahun lama ikut dibayar penuh dalam transaksi yang sama", () => {
    expect(selfService(baru, [lama, baru], new Set(["lama"]))).toEqual({ status: "clear" });
  });

  it("tetap memblokir bila tagihan tahun lama hanya dicicil (tidak dibayar penuh)", () => {
    expect(selfService(baru, [lama, baru], new Set()).status).toBe("blocked");
  });

  it("tidak memblokir jenis atau siswa lain", () => {
    const lain = bill("lain", "2025/2026", "2025-07-01", { jenis_id: "seragam" });
    const siswaLain = bill("siswa-lain", "2025/2026", "2025-07-01", { siswa_id: "siswa-2" });
    expect(selfService(baru, [lain, siswaLain, baru])).toEqual({ status: "clear" });
  });

  it("tidak memblokir tagihan bulanan", () => {
    const bulanan = bill("spp", "2026/2027", "2026-07-01", { bulan: 8, jenis_id: "spp" });
    expect(selfService(bulanan, [lama, bulanan])).toEqual({ status: "clear" });
  });
});
