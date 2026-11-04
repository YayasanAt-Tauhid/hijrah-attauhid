import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/portal/SPMBDaftarOnlineV2.tsx", "utf8");

describe("halaman /spmb: pembayaran pending", () => {
  it("menawarkan ganti metode hanya saat pembayaran pending dan masih boleh bayar", () => {
    expect(page).toMatch(/canPay && isPending && gatewayToken && <SpmbChangeMethodButton/);
  });

  it("kembali dari Midtrans dengan status pending tidak lagi disebut 'sedang dikonfirmasi'", () => {
    expect(page).not.toMatch(/isProcessing = status === "processing" \|\| returnedFinishPending/);
    expect(page).toMatch(/isPending = status === "pending";/);
  });
});
