import { describe, expect, it } from "vitest";
import { CART_FAILURE_TITLE, describeCartFailures } from "./cartPaymentFailure";

describe("describeCartFailures", () => {
  it("memakai judul tetap dan menampilkan pesan asli item yang gagal", () => {
    const msg = "UANG PANGKAL SMP: Sesi pembayaran lama belum dapat ditutup di Midtrans.";
    const result = describeCartFailures([msg]);
    expect(result.title).toBe(CART_FAILURE_TITLE);
    expect(result.description).toBe(msg);
  });

  it("menggabungkan dua pesan pertama dengan pemisah ' | '", () => {
    const result = describeCartFailures(["SPP SMP Juli: A", "UANG PANGKAL SMP: B"]);
    expect(result.description).toBe("SPP SMP Juli: A | UANG PANGKAL SMP: B");
  });

  it("menandai jumlah item lain yang tidak ditampilkan", () => {
    const result = describeCartFailures(["a: 1", "b: 2", "c: 3", "d: 4", "e: 5"]);
    expect(result.description).toBe("a: 1 | b: 2 (+3 lainnya)");
  });

  it("tidak membuat deskripsi kosong dari daftar kosong atau pesan kosong", () => {
    expect(describeCartFailures([]).description).toBeUndefined();
    expect(describeCartFailures(["", "   "]).description).toBeUndefined();
    expect(describeCartFailures([]).title).toBe(CART_FAILURE_TITLE);
  });

  it("mengabaikan pesan kosong saat menghitung sisa item", () => {
    const result = describeCartFailures(["", "a: 1", "  ", "b: 2", "c: 3"]);
    expect(result.description).toBe("a: 1 | b: 2 (+1 lainnya)");
  });

  it("memotong pesan yang sangat panjang agar toast tetap terbaca", () => {
    const result = describeCartFailures(["x".repeat(500)]);
    expect(result.description).toHaveLength(240);
    expect(result.description?.endsWith("…")).toBe(true);
  });

  it("tidak memotong pesan yang masih dalam batas", () => {
    const msg = "y".repeat(240);
    expect(describeCartFailures([msg]).description).toBe(msg);
  });

  it("memberi durasi lebih lama dari bawaan sonner (4 detik) agar sempat dibaca", () => {
    expect(describeCartFailures(["a: 1"]).duration).toBeGreaterThanOrEqual(8000);
  });
});
