import { describe, expect, it } from "vitest";
import type { PaymentProgress } from "@/lib/spmbPaymentMonitor";
import { uangPangkalFromMonitor, uangPangkalKeterangan, canViewUangPangkal } from "./seragamUangPangkal";

const progress = (over: Partial<PaymentProgress>): PaymentProgress => ({
  total: 0, paid: 0, remaining: 0, minimum: 0, target: 0, shortage: 0, stage: 1, due: null, originalDue: null,
  overdueDays: 0, nearDue: false, firstFulfilledAt: null, secondFulfilledAt: null, status: "belum_diatur", ...over,
});

describe("uang pangkal pada daftar seragam", () => {
  it("memetakan nominal, dibayar, sisa, dan status dari data monitoring pembayaran SPMB", () => {
    const map = uangPangkalFromMonitor([
      { siswa_id: "a", progress: progress({ total: 10_100_000, paid: 2_525_000, remaining: 7_575_000 }) },
      { siswa_id: "b", progress: progress({ total: 10_100_000, paid: 10_100_000, remaining: 0 }) },
      { siswa_id: "c", progress: progress({ total: 10_100_000, paid: 0, remaining: 10_100_000 }) },
      { siswa_id: "d", progress: progress({ status: "belum_ada_tagihan" }) },
      { siswa_id: "e", progress: progress({ status: "perlu_verifikasi", total: 5, remaining: 5 }) },
    ]);
    expect(map.get("a")).toEqual({ total: 10_100_000, paid: 2_525_000, remaining: 7_575_000, status: "sebagian" });
    expect(map.get("b")).toMatchObject({ remaining: 0, status: "lunas" });
    expect(map.get("c")).toMatchObject({ paid: 0, status: "belum_bayar" });
    expect(map.get("d")).toMatchObject({ total: 0, status: "belum_ada_tagihan" });
    expect(map.get("e")).toMatchObject({ status: "perlu_verifikasi" });
  });

  it("keterangan otomatis memakai label yang sama dengan monitoring; tanpa data berarti belum ada tagihan", () => {
    expect(uangPangkalKeterangan({ total: 1, paid: 0, remaining: 1, status: "sebagian" })).toBe("Dibayar sebagian");
    expect(uangPangkalKeterangan({ total: 1, paid: 1, remaining: 0, status: "lunas" })).toBe("Lunas");
    expect(uangPangkalKeterangan(null)).toBe("Belum ada tagihan");
  });

  it("hanya peran keuangan yang boleh melihat: izin pembayaran atau Admin TU", () => {
    expect(canViewUangPangkal("admin_tu", false)).toBe(true);
    expect(canViewUangPangkal("keuangan", true)).toBe(true);
    expect(canViewUangPangkal("guru", false)).toBe(false);
    expect(canViewUangPangkal(null, false)).toBe(false);
  });
});
