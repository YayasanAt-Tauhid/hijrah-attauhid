import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const dashboard = readFileSync(
  resolve(process.cwd(), "src/pages/portal/PortalDashboard.tsx"),
  "utf8",
);

describe("portal dashboard tunggakan card", () => {
  it("counts only overdue bills so parents are not confused by upcoming ones", () => {
    expect(dashboard).toContain('.eq("menunggak", true)');
  });

  it("labels the card as Tunggakan, not Tagihan Belum Bayar", () => {
    expect(dashboard).toContain(">Tunggakan<");
    expect(dashboard).not.toContain("Tagihan Belum Bayar");
  });
});
