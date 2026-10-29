import { describe, expect, it } from "vitest";
import {
  SEQUENCE_OVERRIDE_MAX_REASON,
  SEQUENCE_OVERRIDE_MIN_REASON,
  SEQUENCE_OVERRIDE_ROLES,
  formatSequenceOverrideNote,
  resolveSequenceOverride,
} from "./sequenceOverride";

const ALASAN = "Orang tua berkomitmen melunasi sebelum Januari";

describe("dispensasi urutan pembayaran", () => {
  it("hanya admin, kepala_sekolah, dan keuangan yang berwenang", () => {
    expect([...SEQUENCE_OVERRIDE_ROLES].sort()).toEqual([
      "admin",
      "kepala_sekolah",
      "keuangan",
    ]);
  });

  it.each(["admin", "kepala_sekolah", "keuangan"])(
    "mengizinkan peran %s dengan alasan yang cukup",
    (role) => {
      const result = resolveSequenceOverride({ role, alasan: ALASAN });
      expect(result).toEqual({ status: "ok", alasan: ALASAN });
    },
  );

  it("menolak peran kasir meskipun alasan diisi", () => {
    const result = resolveSequenceOverride({ role: "kasir", alasan: ALASAN });
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.error).toMatch(/tidak berwenang/i);
  });

  it("menolak peran yang tidak dikenal atau kosong", () => {
    expect(resolveSequenceOverride({ role: "ortu", alasan: ALASAN }).status).toBe("error");
    expect(resolveSequenceOverride({ role: null, alasan: ALASAN }).status).toBe("error");
    expect(resolveSequenceOverride({ role: undefined, alasan: ALASAN }).status).toBe("error");
  });

  it("menolak alasan kosong atau hanya spasi", () => {
    for (const alasan of [undefined, null, "", "   ", "\n\t"]) {
      const result = resolveSequenceOverride({ role: "admin", alasan });
      expect(result.status).toBe("error");
      if (result.status === "error") expect(result.error).toMatch(/alasan/i);
    }
  });

  it("menolak alasan yang lebih pendek dari batas minimum setelah dirapikan", () => {
    const pendek = "x".repeat(SEQUENCE_OVERRIDE_MIN_REASON - 1);
    const result = resolveSequenceOverride({ role: "keuangan", alasan: `  ${pendek}  ` });
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.error).toContain(String(SEQUENCE_OVERRIDE_MIN_REASON));
  });

  it("menerima alasan tepat sebesar batas minimum dan merapikan spasi", () => {
    const pas = "x".repeat(SEQUENCE_OVERRIDE_MIN_REASON);
    const result = resolveSequenceOverride({ role: "keuangan", alasan: `  ${pas}  ` });
    expect(result).toEqual({ status: "ok", alasan: pas });
  });

  it("memadatkan spasi berlebih di dalam alasan", () => {
    const result = resolveSequenceOverride({
      role: "admin",
      alasan: "Komitmen   orang tua\n melunasi   Januari",
    });
    expect(result).toEqual({
      status: "ok",
      alasan: "Komitmen orang tua melunasi Januari",
    });
  });

  it("menolak alasan yang melebihi batas maksimum", () => {
    const panjang = "x".repeat(SEQUENCE_OVERRIDE_MAX_REASON + 1);
    const result = resolveSequenceOverride({ role: "admin", alasan: panjang });
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.error).toContain(String(SEQUENCE_OVERRIDE_MAX_REASON));
  });

  it("memformat catatan dispensasi untuk keterangan pembayaran", () => {
    expect(formatSequenceOverrideNote(ALASAN)).toBe(`[DISPENSASI URUTAN] ${ALASAN}`);
  });
});
