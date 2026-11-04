import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_ROLE_PERMISSIONS } from "./permissions";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const pembayaranServer = read("src/server/pembayaran.ts");
const direct = pembayaranServer.slice(pembayaranServer.indexOf("export const batalkanPembayaran"));

describe("pembatalan pembayaran: akses", () => {
  it("pembatalan langsung hanya untuk izin `keuangan.pembatalan.langsung` (admin implisit), tidak untuk kasir/keuangan", () => {
    expect(direct).toContain('requirePermission(admin, userId, "keuangan.pembatalan.langsung")');
    for (const keys of Object.values(DEFAULT_ROLE_PERMISSIONS)) expect(keys).not.toContain("keuangan.pembatalan.langsung");
  });

  it("pengajuan yang masih menunggu ditutup otomatis saat admin membatalkan langsung (tidak jadi yatim)", () => {
    expect(direct).toContain('.from("pembatalan_pembayaran_pengajuan")');
    expect(direct).toContain('.eq("pembayaran_id", pembayaran_id)');
    expect(direct).toContain('.eq("status", "menunggu")');
    expect(direct).toContain("Pembayaran dibatalkan langsung oleh admin");
  });
});
