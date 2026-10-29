import { describe, expect, it } from "vitest";
import { buildReissueParams, canReissueBill, REISSUE_PREVIEW_REASON, validateReissueInput } from "./reissueCancelledBill";

const bill = (changes = {}) => ({ id: "b1", jenis_id: "j1", nama: "SPP SMP", nominal: 1350000, status: "dibatalkan", periode: "2027-07-01", ...changes });

describe("terbitkan ulang tagihan batal: kelayakan", () => {
  it("hanya tagihan dibatalkan yang dapat diterbitkan ulang", () => {
    expect(canReissueBill(bill())).toBe(true);
    expect(canReissueBill(bill({ status: "dihapusbuku" }))).toBe(false);
    expect(canReissueBill(bill({ status: "belum_bayar" }))).toBe(false);
  });
});

describe("terbitkan ulang tagihan batal: validasi input", () => {
  const ok = { kind: "spp" as const, nominal: 500000, reason: "pindah asrama ke non asrama" };
  it("menerima input SPP yang lengkap", () => expect(validateReissueInput(ok)).toBeNull());
  it("menolak alasan kurang dari 10 karakter", () => expect(validateReissueInput({ ...ok, reason: "pendek" })).toMatch(/10 karakter/));
  it("menolak nominal SPP kosong, nol, atau tak valid", () => {
    for (const nominal of [null, 0, -5, Number.NaN, 100_000_001]) expect(validateReissueInput({ ...ok, nominal })).toMatch(/nominal/i);
  });
  it("uang pangkal boleh tanpa nominal (mengikuti SK), tetapi nominal beda dari SK butuh catatan 10 karakter", () => {
    const pangkal = { kind: "uang_pangkal" as const, nominal: null, reason: "pindah asrama ke non asrama" };
    expect(validateReissueInput(pangkal)).toBeNull();
    expect(validateReissueInput({ ...pangkal, nominal: 9000000, differsFromSk: true, note: "pendek" })).toMatch(/catatan/i);
    expect(validateReissueInput({ ...pangkal, nominal: 9000000, differsFromSk: true, note: "disetujui sekretaris yayasan" })).toBeNull();
  });
  it("menuntut pilihan alumni bila diwajibkan", () => {
    const pangkal = { kind: "uang_pangkal" as const, nominal: null, reason: "pindah asrama ke non asrama", needsAlumni: true };
    expect(validateReissueInput({ ...pangkal, alumni: "" })).toMatch(/alumni/i);
    expect(validateReissueInput({ ...pangkal, alumni: "none" })).toBeNull();
  });
});

describe("terbitkan ulang tagihan batal: parameter RPC", () => {
  it("pratinjau memakai alasan baku dan tanpa hash; hash tidak bergantung pada alasan asli", () => {
    const p = buildReissueParams({ tagihanId: "b1", kind: "spp", nominal: 500000, apply: false });
    expect(p).toEqual({ p_tagihan_id: "b1", p_nominal_bruto: 500000, p_alasan: REISSUE_PREVIEW_REASON, p_apply: false,
      p_preview_hash: null, p_alumni_asrama: "none", p_fase_mta: null, p_catatan: null });
    expect(REISSUE_PREVIEW_REASON.length).toBeGreaterThanOrEqual(10);
  });
  it("penerapan membawa hash pratinjau dan alasan yang sudah dipangkas", () => {
    const p = buildReissueParams({ tagihanId: "b2", kind: "uang_pangkal", nominal: null, apply: true, previewHash: "abc",
      reason: "  pindah asrama ke non asrama  ", alumni: "asrama", fase: "sma", note: " catatan resmi sekretaris " });
    expect(p).toMatchObject({ p_tagihan_id: "b2", p_nominal_bruto: null, p_apply: true, p_preview_hash: "abc",
      p_alasan: "pindah asrama ke non asrama", p_alumni_asrama: "asrama", p_fase_mta: "sma", p_catatan: "catatan resmi sekretaris" });
  });
  it("menolak penerapan tanpa hash pratinjau", () => {
    expect(() => buildReissueParams({ tagihanId: "b1", kind: "spp", nominal: 500000, apply: true, reason: "pindah asrama ke non asrama" })).toThrow(/pratinjau/i);
  });
});

import { describeReissue, type ReissuePreview } from "./reissueCancelledBill";
describe("terbitkan ulang tagihan batal: ringkasan perbandingan", () => {
  const fmt = (n: number) => `Rp ${n}`;
  const base = { tagihan_id: "b", siswa_id: "s", preview_hash: "h", applied: false, nominal_bruto_lama: 1350000, nominal_bruto_baru: 500000 };
  it("SPP: kategori, nominal, dan tarif per siswa", () => {
    const rows = describeReissue({ ...base, jenis: "spp", kategori_lama: "asrama", kategori_baru: "non_asrama", tarif_lama: { id: "t", nominal: 1350000 } } as ReissuePreview, fmt);
    expect(rows).toEqual([
      { label: "Kategori SPP", lama: "asrama", baru: "non_asrama" },
      { label: "Nominal bruto", lama: "Rp 1350000", baru: "Rp 500000" },
      { label: "Tarif per siswa", lama: "Rp 1350000", baru: "Rp 500000" },
    ]);
  });
  it("uang pangkal: menampilkan verifikasi lama dan keringanan hanya bila ada", () => {
    const rows = describeReissue({ ...base, jenis: "uang_pangkal", program_baru: "non_asrama", keringanan_alumni: 2000000, verifikasi_lama_id: "v", tarif_lama: null } as ReissuePreview, fmt);
    expect(rows.map(r => r.label)).toEqual(["Program uang pangkal", "Nominal bruto", "Keringanan alumni (diajukan)", "Verifikasi uang pangkal", "Tarif per siswa"]);
    expect(rows.at(-1)).toEqual({ label: "Tarif per siswa", lama: "-", baru: "Rp 500000" });
    const plain = describeReissue({ ...base, jenis: "uang_pangkal", program_baru: "asrama", keringanan_alumni: 0, verifikasi_lama_id: null } as ReissuePreview, fmt);
    expect(plain.map(r => r.label)).toEqual(["Program uang pangkal", "Nominal bruto", "Tarif per siswa"]);
  });
});
