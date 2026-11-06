import { describe, expect, it } from "vitest";
import {
  findOneTimePrerequisite,
  oneTimePeriodLabel,
  type BillingSequenceBill,
} from "./billingSequence";

// Tagihan sekali bayar (mis. Uang Pangkal) tidak punya bulan; periodenya
// ditentukan oleh tahun ajaran.
const oneTime = (
  id: string,
  start: string | null,
  extra: Partial<BillingSequenceBill> = {},
): BillingSequenceBill => ({
  id,
  siswa_id: "siswa-1",
  jenis_id: "uang-pangkal",
  bulan: null,
  tahun_ajaran_mulai: start,
  ...extra,
});

describe("prasyarat tagihan sekali bayar lintas tahun ajaran", () => {
  it("memblokir tagihan tahun berjalan bila tahun ajaran sebelumnya belum lunas", () => {
    const lama = oneTime("lama", "2025-07-01");
    const baru = oneTime("baru", "2026-07-01");

    expect(findOneTimePrerequisite(baru, [lama, baru])?.id).toBe("lama");
  });

  it("tidak memblokir bila tidak ada tagihan tahun sebelumnya (siswa baru)", () => {
    const baru = oneTime("baru", "2026-07-01");

    expect(findOneTimePrerequisite(baru, [baru])).toBeNull();
  });

  it("mengizinkan bila tagihan tahun sebelumnya ikut dibayar penuh pada transaksi yang sama", () => {
    const lama = oneTime("lama", "2025-07-01");
    const baru = oneTime("baru", "2026-07-01");

    expect(
      findOneTimePrerequisite(baru, [lama, baru], new Set(["lama"])),
    ).toBeNull();
  });

  it("tidak memblokir tagihan tahun ajaran yang lebih lama oleh yang lebih baru", () => {
    const lama = oneTime("lama", "2025-07-01");
    const baru = oneTime("baru", "2026-07-01");

    expect(findOneTimePrerequisite(lama, [lama, baru])).toBeNull();
  });

  it("tidak mencampur jenis pembayaran yang berbeda", () => {
    const bukuLama = oneTime("buku-lama", "2025-07-01", { jenis_id: "buku" });
    const pangkalBaru = oneTime("pangkal-baru", "2026-07-01");

    expect(findOneTimePrerequisite(pangkalBaru, [bukuLama, pangkalBaru])).toBeNull();
  });

  it("tidak mencampur siswa yang berbeda", () => {
    const lainLama = oneTime("lain-lama", "2025-07-01", { siswa_id: "siswa-2" });
    const baru = oneTime("baru", "2026-07-01");

    expect(findOneTimePrerequisite(baru, [lainLama, baru])).toBeNull();
  });

  it("mengembalikan tagihan terlama bila ada beberapa tahun ajaran tertunggak", () => {
    const paling = oneTime("paling-lama", "2024-07-01");
    const lama = oneTime("lama", "2025-07-01");
    const baru = oneTime("baru", "2026-07-01");

    expect(findOneTimePrerequisite(baru, [lama, baru, paling])?.id).toBe(
      "paling-lama",
    );
  });

  it("melewati tagihan terlama yang sudah ikut dipilih dan memblokir oleh yang belum", () => {
    const paling = oneTime("paling-lama", "2024-07-01");
    const lama = oneTime("lama", "2025-07-01");
    const baru = oneTime("baru", "2026-07-01");

    expect(
      findOneTimePrerequisite(baru, [paling, lama, baru], new Set(["paling-lama"]))
        ?.id,
    ).toBe("lama");
  });

  it("tidak memblokir bila tahun ajaran target tidak diketahui", () => {
    const lama = oneTime("lama", "2025-07-01");
    const tanpaTahun = oneTime("tanpa-tahun", null);

    expect(findOneTimePrerequisite(tanpaTahun, [lama, tanpaTahun])).toBeNull();
  });

  it("membaca tahun ajaran dari relasi tahun_ajaran bila tahun_ajaran_mulai kosong", () => {
    const lama = oneTime("lama", null, {
      tahun_ajaran: { nama: "2025/2026", tanggal_mulai: "2025-07-01" },
    });
    const baru = oneTime("baru", null, {
      tahun_ajaran: { nama: "2026/2027", tanggal_mulai: "2026-07-01" },
    });

    expect(findOneTimePrerequisite(baru, [lama, baru])?.id).toBe("lama");
  });

  it("tidak berlaku untuk tagihan bulanan", () => {
    const julLama: BillingSequenceBill = {
      id: "jul-lama",
      siswa_id: "siswa-1",
      jenis_id: "spp",
      bulan: 7,
      tahun_ajaran_mulai: "2025-07-01",
    };
    const julBaru: BillingSequenceBill = { ...julLama, id: "jul-baru", tahun_ajaran_mulai: "2026-07-01" };

    expect(findOneTimePrerequisite(julBaru, [julLama, julBaru])).toBeNull();
  });

  it("tagihan bulanan tidak dihitung sebagai prasyarat sekali bayar", () => {
    const sppLama: BillingSequenceBill = {
      id: "spp-lama",
      siswa_id: "siswa-1",
      jenis_id: "uang-pangkal",
      bulan: 7,
      tahun_ajaran_mulai: "2025-07-01",
    };
    const baru = oneTime("baru", "2026-07-01");

    expect(findOneTimePrerequisite(baru, [sppLama, baru])).toBeNull();
  });

  it("memberi label tahun ajaran dari nama bila tersedia", () => {
    const lama = oneTime("lama", "2025-07-01", {
      tahun_ajaran: { nama: "2025/2026", tanggal_mulai: "2025-07-01" },
    });

    expect(oneTimePeriodLabel(lama)).toBe("tahun ajaran 2025/2026");
  });

  it("memberi label dari tahun mulai bila nama tidak tersedia", () => {
    expect(oneTimePeriodLabel(oneTime("lama", "2025-07-01"))).toBe(
      "tahun ajaran 2025",
    );
  });

  it("memberi label umum bila tahun ajaran tidak diketahui", () => {
    expect(oneTimePeriodLabel(oneTime("lama", null))).toBe(
      "tahun ajaran sebelumnya",
    );
  });
});
