import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const migration = read("supabase/migrations/20261005030256_uang_pangkal_cicilan_dimuka.sql");
const portal = read("src/pages/portal/PortalTagihan.tsx");
const checkout = read("src/server/payment.ts");
const webhook = read("src/routes/api.midtrans-notification.ts");
const cashier = read("src/pages/keuangan/InputPembayaran.tsx");

describe("Uang Pangkal installment-before-due contract", () => {
  it("limits the exception to official Uang Pangkal payment types", () => {
    const regex = "^UANG PANGKAL (TK|SD|SMP|SMA|MTA)$";
    expect(migration).toContain(regex);
    expect(portal).toContain("isUangPangkalPaymentName");
    expect(checkout).toContain("isUangPangkalPaymentName");
    expect(webhook).toContain("isUangPangkalPaymentName");
    expect(cashier).toContain("isUangPangkalPaymentName");
  });

  it("keeps a partial advance Uang Pangkal bill scheduled until maturity", () => {
    expect(migration).toContain(
      "WHEN p_is_bayar_dimuka AND v_is_uang_pangkal AND v_tagihan.status = 'terjadwal' THEN 'terjadwal'",
    );
    expect(migration).toContain(
      "WHEN v_dimuka AND v_is_uang_pangkal AND v_tagihan.status = 'terjadwal' THEN 'terjadwal'",
    );
  });

  it("posts only the remaining Uang Pangkal receivable at maturity", () => {
    expect(migration).toContain("v_sisa_netto := CASE WHEN v_is_uang_pangkal");
    expect(migration).toContain(
      "VALUES (v_jurnal_id, v_piutang_akun_id, 'Piutang ' || v_row.jenis_nama, v_sisa_netto, 0, v_urutan);",
    );
    expect(migration).toContain("v_bruto_post := v_sisa_netto + v_diskon;");
  });

  it("restores receivable when an already-recognized advance installment is cancelled", () => {
    expect(migration).toContain("v_dimuka.jurnal_pengakuan_id IS NOT NULL");
    expect(migration).toContain(
      "'Piutang atas pembatalan pembayaran yang telah diakui'",
    );
  });
});
