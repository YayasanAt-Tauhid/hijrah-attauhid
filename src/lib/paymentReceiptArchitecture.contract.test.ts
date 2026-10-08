import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readRepoFile = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const migration = readRepoFile(
  "supabase/migrations/20261002090000_payment_receipt_architecture.sql",
);
const paymentServer = readRepoFile("src/server/pembayaran.ts");
const cashier = readRepoFile("src/pages/keuangan/InputPembayaran.tsx");
const cashierRecap = readRepoFile("src/pages/keuangan/RekapKasirSaya.tsx");
const webhook = readRepoFile("src/server/midtransNotification.ts");
const spmb = readRepoFile("src/pages/keuangan/PembayaranPMB.tsx");
const singleReceipt = readRepoFile("src/components/shared/PrintKuitansi.tsx");
const combinedReceipt = readRepoFile(
  "src/components/shared/PrintKuitansiGabungan.tsx",
);

describe("permanent payment receipt architecture", () => {
  it("keeps an immutable receipt header and item snapshot model", () => {
    expect(migration).toContain("CREATE TABLE public.payment_receipts");
    expect(migration).toContain("CREATE TABLE public.payment_receipt_items");
    expect(migration).toContain("payment_id uuid UNIQUE REFERENCES public.pembayaran(id) ON DELETE SET NULL");
    expect(migration).toContain("status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'void'))");
  });

  it("routes cashier payments and cancellations through receipt-aware atomic wrappers", () => {
    expect(paymentServer).toContain('"proses_pembayaran_dengan_kuitansi_atomik"');
    expect(paymentServer).toContain("p_receipt_id: receipt_id ?? null");
    expect(paymentServer).toContain('p_source: role === "kasir" ? "cashier" : "manual"');
    expect(paymentServer).toContain('"batalkan_pembayaran_dengan_kuitansi_atomik"');
    expect(paymentServer).toContain("receipt_number: r.receipt_number");
  });

  it("uses one receipt id for all successful items in the same cashier cart", () => {
    expect(cashier).toContain("let receiptId: string | undefined");
    expect(cashier).toContain("receipt_id: receiptId");
    expect(cashier).toContain("receiptId = receiptId || result.receipt_id");
    expect(cashier).toContain("nomorBukti={lastCartPayment.receiptNumber}");
  });

  it("reprints the whole stored receipt group from payment history and cashier recap", () => {
    expect(cashier).toContain("getPaymentReceiptGroups");
    expect(cashier).toContain("riwayatPrintTarget.receiptGroup.items.map");
    expect(cashier).toContain("receiptStatus={riwayatPrintTarget.receiptGroup.status}");
    expect(cashierRecap).toContain("getPaymentReceiptGroups");
    expect(cashierRecap).toContain("printReceipt.items.map");
  });

  it("groups settled Midtrans items by order id into one permanent receipt", () => {
    expect(webhook).toContain('"proses_pembayaran_midtrans_dengan_kuitansi_atomik"');
    expect(migration).toContain("'midtrans'");
    expect(migration).toContain("p_order_id");
    expect(migration).toContain("source_reference");
  });

  it("prints the permanent receipt number and preserves cancellation status", () => {
    expect(singleReceipt).toContain("payment.nomorKuitansi ||");
    expect(spmb).toContain("nomorKuitansi: result.receipt_number");
    expect(combinedReceipt).toContain('receiptStatus === "void" ? "DIBATALKAN"');
    expect(combinedReceipt).toContain('"SEBAGIAN DIBATALKAN"');
    expect(combinedReceipt).toContain('item.status === "void" ? " — DIBATALKAN"');
  });
});
