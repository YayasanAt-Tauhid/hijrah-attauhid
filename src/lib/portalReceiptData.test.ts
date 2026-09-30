import { describe, it, expect } from "vitest";
import { portalReceiptIdentity } from "./portalReceiptData";
import { canDownloadReceipt } from "./receiptDownload";
describe("Receipt data", () => {
  it("allows receipts only for paid transactions", () => {
    expect(canDownloadReceipt("paid")).toBe(true);
    for (const status of ["pending", "failed", "expired", "unknown", "sebagian", ""]) expect(canDownloadReceipt(status)).toBe(false);
  });
  it("includes all students without duplicate identities and prefers the active class", () => {
    const a = { siswa: { nama: "Anak A", nis: "123", nisn: "001", kelas_siswa: [{ aktif: false, kelas: { nama: "8C" } }, { aktif: true, kelas: { nama: "9C" } }] }, departemen: { nama: "SMP" } };
    const b = { siswa: { nama: "Anak B", nis: "456", kelas_siswa: [{ aktif: true, kelas: { nama: "5C" } }] }, departemen: { nama: "SD" } };
    expect(portalReceiptIdentity([a,a,b])).toEqual({ siswa: { nama: "Anak A, Anak B", nis: "123, 456", nisn: "001" }, kelasNama: "9C, 5C", lembagaNama: "SMP, SD" });
  });
});
