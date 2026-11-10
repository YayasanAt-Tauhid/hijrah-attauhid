import { describe, expect, it } from "vitest";
import { getErrorMessage } from "./errorMessage";

describe("getErrorMessage", () => {
  it("memakai message dari instance Error", () => {
    expect(getErrorMessage(new Error("Koneksi putus"), "Gagal")).toBe("Koneksi putus");
  });

  it("memakai message dari objek biasa (galat Supabase/PostgREST bukan instance Error)", () => {
    const postgrestLike = { message: "duplicate key value", code: "23505", details: null };
    expect(getErrorMessage(postgrestLike, "Gagal")).toBe("duplicate key value");
  });

  it("jatuh ke fallback bila message kosong, seperti `err?.message || fallback` sebelumnya", () => {
    expect(getErrorMessage(new Error(""), "Gagal")).toBe("Gagal");
    expect(getErrorMessage({ message: "" }, "Gagal")).toBe("Gagal");
  });

  it("jatuh ke fallback bila objek tidak punya message", () => {
    expect(getErrorMessage({ code: "42501" }, "Gagal")).toBe("Gagal");
    expect(getErrorMessage({}, "Gagal")).toBe("Gagal");
  });

  it("jatuh ke fallback untuk nilai bukan objek (null, undefined, string, angka)", () => {
    expect(getErrorMessage(null, "Gagal")).toBe("Gagal");
    expect(getErrorMessage(undefined, "Gagal")).toBe("Gagal");
    expect(getErrorMessage("teks mentah", "Gagal")).toBe("Gagal");
    expect(getErrorMessage(500, "Gagal")).toBe("Gagal");
  });

  it("mengubah message non-string menjadi string, seperti String(...) pada helper lama", () => {
    expect(getErrorMessage({ message: 42 }, "Gagal")).toBe("42");
  });

  it("fallback bawaan bila tidak diberikan", () => {
    expect(getErrorMessage(undefined)).toBe("Terjadi kesalahan");
  });
});
