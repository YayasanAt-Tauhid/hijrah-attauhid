import { describe, expect, it } from "vitest";
import {
  PAYMENT_LINK_TTL_DAYS,
  buildPaymentLinkUrl,
  buildWhatsappShareUrl,
  generatePaymentLinkToken,
  hashPaymentLinkToken,
  isPaymentLinkTokenFormat,
  normalizeWhatsappPhone,
  paymentLinkExpiry,
  paymentLinkMessage,
  paymentLinkState,
  readPaymentLinkTokenFromHash,
  toggleLinkBillSelection,
  validateLinkSelection,
} from "./paymentLink";

describe("payment link token", () => {
  it("generates 256-bit url-safe tokens that never repeat", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generatePaymentLinkToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(isPaymentLinkTokenFormat(token)).toBe(true);
    }
  });

  it("rejects malformed tokens before touching the database", () => {
    for (const bad of ["", "abc", "x".repeat(42), "x".repeat(44), "a".repeat(42) + "=", "../../etc", null, undefined, 12]) {
      expect(isPaymentLinkTokenFormat(bad)).toBe(false);
    }
  });

  it("stores only a deterministic sha-256 hash, never the token", async () => {
    const token = generatePaymentLinkToken();
    const hash = await hashPaymentLinkToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(await hashPaymentLinkToken(token)).toBe(hash);
    expect(await hashPaymentLinkToken(generatePaymentLinkToken())).not.toBe(hash);
  });

  it("keeps the token in the URL fragment so it is not sent to servers or referrers", () => {
    const token = generatePaymentLinkToken();
    expect(buildPaymentLinkUrl("https://hijrah.example", token)).toBe(`https://hijrah.example/bayar#${token}`);
    expect(readPaymentLinkTokenFromHash(`#${token}`)).toBe(token);
    expect(readPaymentLinkTokenFromHash(token)).toBe(token);
    expect(readPaymentLinkTokenFromHash("#bukan-token")).toBeNull();
    expect(readPaymentLinkTokenFromHash("")).toBeNull();
  });
});

describe("payment link lifetime", () => {
  const now = new Date("2026-10-27T00:00:00.000Z");

  it("expires seven days after creation", () => {
    expect(PAYMENT_LINK_TTL_DAYS).toBe(7);
    expect(paymentLinkExpiry(now).toISOString()).toBe("2026-11-03T00:00:00.000Z");
  });

  it("reports the state staff and parents should see", () => {
    const base = { expires_at: "2026-11-03T00:00:00.000Z", canceled_at: null };
    expect(paymentLinkState(base, 2, now)).toBe("aktif");
    expect(paymentLinkState(base, 0, now)).toBe("lunas");
    expect(paymentLinkState({ ...base, canceled_at: "2026-10-28T00:00:00Z" }, 2, now)).toBe("dibatalkan");
    expect(paymentLinkState(base, 2, new Date("2026-11-03T00:00:00.000Z"))).toBe("kedaluwarsa");
    // Lunas tetap ditampilkan lunas walau link sudah lewat masa berlaku.
    expect(paymentLinkState(base, 0, new Date("2026-12-01T00:00:00.000Z"))).toBe("lunas");
  });
});

describe("whatsapp sharing", () => {
  it("normalizes Indonesian numbers", () => {
    expect(normalizeWhatsappPhone("0812-3456-7890")).toBe("6281234567890");
    expect(normalizeWhatsappPhone("+62 812 3456 7890")).toBe("6281234567890");
    expect(normalizeWhatsappPhone("6281234567890")).toBe("6281234567890");
    expect(normalizeWhatsappPhone("81234567890")).toBe("6281234567890");
    expect(normalizeWhatsappPhone("12345")).toBeNull();
    expect(normalizeWhatsappPhone("")).toBeNull();
    expect(normalizeWhatsappPhone(null)).toBeNull();
  });

  it("builds a prefilled wa.me link with or without a number", () => {
    expect(buildWhatsappShareUrl("6281234567890", "Halo & salam")).toBe("https://wa.me/6281234567890?text=Halo%20%26%20salam");
    expect(buildWhatsappShareUrl(null, "Halo")).toBe("https://wa.me/?text=Halo");
  });

  it("writes a message with the student, total, link and deadline", () => {
    const message = paymentLinkMessage({
      namaSiswa: "Ahmad",
      total: 350000,
      url: "https://hijrah.example/bayar#tok",
      expiresAt: "2026-11-03T00:00:00.000Z",
    });
    expect(message).toContain("Ahmad");
    expect(message).toContain("Rp");
    expect(message).toContain("350.000");
    expect(message).toContain("https://hijrah.example/bayar#tok");
    expect(message).toContain("3 November 2026");
  });
});

describe("validateLinkSelection", () => {
  const scope = ["a", "b", "c"];

  it("accepts a deduplicated subset of the link scope", () => {
    expect(validateLinkSelection(scope, ["b", "a", "b"])).toEqual(["b", "a"]);
  });

  it("rejects empty selections and bills outside the link", () => {
    expect(() => validateLinkSelection(scope, [])).toThrow("Pilih minimal satu tagihan");
    expect(() => validateLinkSelection(scope, ["a", "z"])).toThrow("tidak termasuk dalam link");
    expect(() => validateLinkSelection(scope, "a" as unknown as string[])).toThrow("Pilih minimal satu tagihan");
  });

  it("caps the number of bills per link", () => {
    const many = Array.from({ length: 51 }, (_, i) => `t${i}`);
    expect(() => validateLinkSelection(many, many)).toThrow("maksimal 50");
  });
});

describe("toggleLinkBillSelection", () => {
  // Urutan sudah dari terlama (server mengurutkan).
  const bills = [
    { id: "spp-jul", jenis_nama: "SPP", bulan: 7 },
    { id: "spp-agu", jenis_nama: "SPP", bulan: 8 },
    { id: "spp-sep", jenis_nama: "SPP", bulan: 9 },
    { id: "makan-jul", jenis_nama: "Makan", bulan: 7 },
    { id: "gedung", jenis_nama: "Infaq Gedung", bulan: null },
  ];

  it("checking a later month also checks earlier months of the same kind", () => {
    expect([...toggleLinkBillSelection(bills, new Set(), "spp-sep", true)].sort()).toEqual(["spp-agu", "spp-jul", "spp-sep"]);
  });

  it("unchecking a month also unchecks later months of the same kind only", () => {
    const all = new Set(bills.map((b) => b.id));
    expect([...toggleLinkBillSelection(bills, all, "spp-agu", false)].sort()).toEqual(["gedung", "makan-jul", "spp-jul"]);
  });

  it("one-time bills toggle independently", () => {
    expect([...toggleLinkBillSelection(bills, new Set(["spp-jul"]), "gedung", true)].sort()).toEqual(["gedung", "spp-jul"]);
  });
});
