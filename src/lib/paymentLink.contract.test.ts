import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20261027010000_payment_link_orang_tua.sql");
const server = read("src/server/paymentLink.ts");
const kasirPage = read("src/pages/keuangan/InputPembayaran.tsx");
const dialog = read("src/components/keuangan/DialogLinkPembayaran.tsx");
const publicRoute = read("src/routes/bayar.tsx");
const publicPage = read("src/pages/portal/BayarLink.tsx");
const staffPage = read("src/pages/keuangan/LinkPembayaran.tsx");
const sidebar = read("src/components/layout/AppSidebar.tsx");

describe("Payment link contract", () => {
  it("keeps the link table closed to browsers and stores only hashes", () => {
    expect(migration).toContain("ALTER TABLE public.payment_link ENABLE ROW LEVEL SECURITY;");
    expect(migration).toContain("REVOKE ALL ON public.payment_link FROM PUBLIC, anon, authenticated;");
    expect(migration).toContain("token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$')");
    expect(migration).not.toMatch(/CREATE POLICY[^;]*payment_link/i);
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.create_midtrans_link_checkout_atomik(uuid,text,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;");
    expect(migration).toContain("CHECK (user_id IS NULL OR payment_link_id IS NULL)");
  });

  it("lets only admin, keuangan and kasir manage links, cashiers only their own", () => {
    expect(server).toContain('const STAFF_ROLES = ["admin", "keuangan", "kasir"];');
    expect(server).toContain('if (role === "kasir") query = query.eq("created_by", userId);');
    expect(server).toContain("Kasir hanya dapat membatalkan link buatan sendiri");
    expect(staffPage).toContain('!["admin", "keuangan", "kasir"].includes(role)');
    expect(sidebar).toContain('{ title: "Link Pembayaran", url: "/keuangan/link-pembayaran", roles: ["admin", "keuangan", "kasir"] }');
  });

  it("offers the link next to bill printing in the cashier page", () => {
    expect(kasirPage).toContain("handleOpenLinkPembayaran");
    expect(kasirPage).toContain("<DialogLinkPembayaran");
    expect(dialog).toContain("createPaymentLink");
    expect(dialog).toContain("Kirim via WhatsApp");
    expect(dialog).toContain('rel="noopener noreferrer"');
  });

  it("keeps the public page unindexed and the token out of servers and referrers", () => {
    expect(publicRoute).toContain('createFileRoute("/bayar")');
    expect(publicRoute).toContain('{ name: "robots", content: "noindex, nofollow" }');
    expect(publicRoute).toContain('{ name: "referrer", content: "no-referrer" }');
    expect(publicPage).toContain("readPaymentLinkTokenFromHash(window.location.hash)");
    expect(publicPage).toContain("sessionStorage");
    expect(server).toContain("Token sengaja tidak disertakan di URL callback");
    // Server functions publik tidak memakai authMiddleware, tetapi selalu lewat token.
    for (const fn of ["getPublicPaymentLink", "checkoutPublicPaymentLink", "resumePublicPaymentLinkSession", "cancelPublicPaymentLinkSession"]) {
      const block = server.slice(server.indexOf(`export const ${fn}`), server.indexOf(`export const ${fn}`) + 400);
      expect(block).toContain("data?.token");
    }
  });
});
