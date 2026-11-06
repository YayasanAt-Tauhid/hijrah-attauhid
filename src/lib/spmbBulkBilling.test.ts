import { describe, expect, it, vi } from "vitest";
import type { SpmbBillingCandidate } from "@/server/spmbBilling";
import { createBulkDraft, prepareBulkRow, runBulkBilling, type BulkPaymentType, type BulkBillingDraft, type BulkRpc } from "./spmbBulkBilling";

const student = (id = "a", extra: Partial<SpmbBillingCandidate> = {}): SpmbBillingCandidate => ({
  id, nama: id, target_departemen_id: "smp", target_departemen_kode: "SMP", status_asrama: "asrama",
  tahun_ajaran_id: "academic", tahun_ajaran_mulai: "2027-07-01", tahun_ajaran_selesai: "2028-06-30",
  ready_for_billing: true, ready_for_spp: false, rencana_spp: null,
  spp_awal: { status: "belum_diinput", nominal: 0, dibatalkan: 0, tagihan: [], dibatalkan_tagihan: [] },
  uang_pangkal: { status: "belum_diinput", nominal: 0, dibatalkan: 0, tagihan: [], dibatalkan_tagihan: [] },
  ...extra,
} as SpmbBillingCandidate);
const jenis: BulkPaymentType[] = [
  { id: "boarding", departemen_id: "smp", nama: "SPP Asrama SMP", tipe: "bulanan", nominal: 600000 },
  { id: "day", departemen_id: "smp", nama: "SPP Non Asrama SMP", tipe: "bulanan", nominal: 300000 },
  { id: "other", departemen_id: "sd", nama: "SPP SD", tipe: "bulanan", nominal: 200000 },
];
const books = [{ id: "book27", tanggal_mulai: "2027-01-01", tanggal_selesai: "2027-12-31" },
  { id: "book28", tanggal_mulai: "2028-01-01", tanggal_selesai: "2028-12-31" }];
const preview = { preview_hash: "verified-input-hash", bruto_acuan: 10000000, keringanan_alumni: 0, verifikasi: null, tagihan: null };
const rpc = () => vi.fn<BulkRpc>(async name => ({ data: name === "preview_uang_pangkal_spmb" ? preview
  : name === "verifikasi_uang_pangkal_spmb" ? { success: true, tagihan_id: "fee" }
  : name === "simpan_tarif_generate_dan_rencana_fleksibel_atomik" ? { generated: 12, rencana: { rencana_id: "plan" } } : { generated: 1 }, error: null }));
const draft = (extra: Partial<BulkBillingDraft> = {}) => ({ ...createBulkDraft(student(), jenis), ...extra });

describe("SPMB input massal", () => {
  it("memilih tarif sesuai jenjang dan asrama, tanpa menebak pilihan ambigu", () => {
    expect(draft().jenisId).toBe("boarding");
    expect(createBulkDraft(student("b", { status_asrama: "non_asrama" }), jenis).jenisId).toBe("day");
    expect(createBulkDraft(student("b", { status_asrama: null }), jenis).jenisId).toBe("");
    expect(createBulkDraft(student(), [...jenis, { ...jenis[0], id: "duplicate" }]).jenisId).toBe("");
  });
  it("memeriksa isian tanpa mutasi; SPP awal membawa TA tujuan dan satu bulan tanpa kelas asal", async () => {
    const call = rpc(); const row = await prepareBulkRow(draft(), jenis, books, call);
    expect(row.error).toBeNull(); expect(call).not.toHaveBeenCalled();
    await runBulkBilling([row], [student()], call, vi.fn());
    expect(call).toHaveBeenCalledExactlyOnceWith("terbitkan_spp_awal_spmb", {
      p_siswa_id: "a", p_tahun_akademik_id: "academic", p_jenis_id: "boarding", p_bulan_mulai: "2027-07-01", p_nominal: 600000,
    });
  });
  it.each([
    { nominal: "NaN" }, { nominal: "0" }, { nominal: "-1" }, { nominal: "Infinity" },
    { jenisId: "other" }, { mulai: "2026-07-01" }, { mulai: "2027-07-02" }, { sppMode: "none" as const },
    { sppMode: "rencana" as const },
  ])("menolak isian tidak sah sebelum menulis: %j", async extra => {
    const call = rpc(); const row = await prepareBulkRow(draft(extra), jenis, books, call);
    expect(row.error).toBeTruthy(); await expect(runBulkBilling([row], [student()], call, vi.fn())).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });
  it("rencana memakai dua tahun buku yang sesuai dan kelas tujuan; tahun buku hilang menolak batch", async () => {
    const siswa = student("a", { ready_for_spp: true, kelas_id: "7a" });
    const d = draft({ siswa, sppMode: "rencana" }); const call = rpc();
    const row = await prepareBulkRow(d, jenis, books, call);
    expect(row.error).toBeNull();
    expect(row.sppPayload?.p_generate_groups).toEqual([
      { tahun_buku_id: "book27", bulan_list: [7, 8, 9, 10, 11, 12] }, { tahun_buku_id: "book28", bulan_list: [1, 2, 3, 4, 5, 6] },
    ]);
    expect(row.sppPayload?.p_kelas_id).toBe("7a");
    expect((await prepareBulkRow(d, jenis, books.slice(0, 1), call)).error).toMatch(/Tahun Buku/);
  });
  it("memerlukan status alumni dan fase MTA eksplisit, bukan menyimpulkan dari internal", async () => {
    const call = rpc();
    expect((await prepareBulkRow(draft({ siswa: student("a", { target_departemen_kode: "SMA", spmb_internal: true }), sppMode: "none", pangkal: true, alumni: "" }), jenis, books, call)).error).toMatch(/alumni/);
    expect((await prepareBulkRow(draft({ siswa: student("a", { target_departemen_kode: "MTA" }), sppMode: "none", pangkal: true }), jenis, books, call)).error).toMatch(/fase/);
    expect(call).not.toHaveBeenCalled();
  });
  it("menyimpan bruto penuh, hash pratinjau, dan keringanan alumni melalui RPC persetujuan yang ada", async () => {
    const call = rpc(); call.mockResolvedValueOnce({ data: { ...preview, keringanan_alumni: 4000000 }, error: null });
    const d = draft({ sppMode: "none", pangkal: true, alumni: "asrama", siswa: student("a", { target_departemen_kode: "SMA" }) });
    const row = await prepareBulkRow(d, jenis, books, call);
    expect(row.error).toBeNull(); await runBulkBilling([row], [d.siswa], call, vi.fn());
    expect(call).toHaveBeenLastCalledWith("verifikasi_uang_pangkal_spmb", expect.objectContaining({
      p_nominal_bruto: 10000000, p_alumni_asrama: "asrama", p_preview_hash: preview.preview_hash, p_confirmed: true,
    }));
    expect((await prepareBulkRow({ ...d, bruto: "6000000", catatan: "Potongan tidak boleh dari bruto" }, jenis, books,
      async () => ({ data: { ...preview, keringanan_alumni: 4000000 }, error: null }))).error).toMatch(/bruto penuh/);
  });
  it("bruto khusus memerlukan alasan dan tidak memakai nominal neto sebagai bruto", async () => {
    const call = rpc(); const d = draft({ sppMode: "none", pangkal: true, bruto: "11000000" });
    expect((await prepareBulkRow(d, jenis, books, call)).error).toMatch(/10 karakter/);
    expect((await prepareBulkRow({ ...d, catatan: "Keputusan bruto khusus yayasan" }, jenis, books, call)).error).toBeNull();
  });
  it("melewati SPP bulan yang sudah ada meskipun jenisnya berbeda dan melewati rencana aktif", async () => {
    const call = rpc(); const row = await prepareBulkRow(draft(), jenis, books, call);
    const s = student("a", { spp_awal: { status: "sudah_diinput", nominal: 300000, dibatalkan: 0, dibatalkan_tagihan: [],
      tagihan: [{ id: "paid", jenis_id: "day", nama: "SPP", nominal: 300000, status: "lunas", periode: "2027-07-01" }] } });
    expect((await runBulkBilling([row], [s], call, vi.fn()))[0].spp?.status).toBe("skipped");
    const d = draft({ siswa: student("a", { ready_for_spp: true, kelas_id: "7a" }), sppMode: "rencana" });
    const planRow = await prepareBulkRow(d, jenis, books, call);
    const fresh = { ...d.siswa, rencana_spp: { id: "new-plan" } } as SpmbBillingCandidate;
    expect((await runBulkBilling([planRow], [fresh], call, vi.fn()))[0].spp?.status).toBe("skipped"); expect(call).not.toHaveBeenCalled();
  });
  it("menghentikan baris yang target/asramanya berubah sejak pemeriksaan", async () => {
    const call = rpc(); const row = await prepareBulkRow(draft(), jenis, books, call);
    const results = await runBulkBilling([row], [student("a", { status_asrama: "non_asrama" })], call, vi.fn());
    expect(results[0].spp?.status).toBe("failed"); expect(call).not.toHaveBeenCalled();
  });
  it("mencatat sukses parsial; kegagalan satu tindakan tidak menyembunyikan yang berhasil", async () => {
    const call = rpc(); const a = draft({ pangkal: true });
    const b = draft({ siswa: student("b"), nominal: "450000" });
    const rows = await Promise.all([prepareBulkRow(a, jenis, books, call), prepareBulkRow(b, jenis, books, call)]);
    call.mockImplementation(async (name, args) => name === "verifikasi_uang_pangkal_spmb"
      ? { data: null, error: { message: "Data berubah; periksa ulang" } } : { data: { generated: args.p_siswa_id === "a" ? 1 : 1 }, error: null });
    const results = await runBulkBilling(rows, [a.siswa, b.siswa], call, vi.fn());
    expect(results[0].spp?.status).toBe("saved"); expect(results[0].pangkal?.status).toBe("failed");
    expect(results[1].spp?.status).toBe("saved");
    expect(call).toHaveBeenLastCalledWith("terbitkan_spp_awal_spmb", expect.objectContaining({ p_siswa_id: "b", p_nominal: 450000 }));
  });
  it("tidak menerbitkan ulang uang pangkal terverifikasi dan menolak preview yang gagal", async () => {
    const call = rpc(); call.mockResolvedValueOnce({ data: { ...preview, verifikasi: { id: "verified" } }, error: null });
    const row = await prepareBulkRow(draft({ sppMode: "none", pangkal: true }), jenis, books, call);
    const results = await runBulkBilling([row], [student()], call, vi.fn());
    expect(results[0].pangkal?.status).toBe("skipped"); expect(call).toHaveBeenCalledTimes(1);
    call.mockResolvedValueOnce({ data: null, error: { message: "Akses ditolak" } });
    expect((await prepareBulkRow(draft({ sppMode: "none", pangkal: true }), jenis, books, call)).error).toBe("Akses ditolak");
  });
  it("hasil RPC kosong atau error generator tidak ditampilkan sebagai sukses", async () => {
    const call = rpc(); const row = await prepareBulkRow(draft(), jenis, books, call);
    call.mockResolvedValue({ data: null, error: null });
    expect((await runBulkBilling([row], [student()], call, vi.fn()))[0].spp?.status).toBe("failed");
    call.mockResolvedValue({ data: { errors: ["Generator gagal"] }, error: null });
    expect((await runBulkBilling([row], [student()], call, vi.fn()))[0].spp?.message).toBe("Generator gagal");
  });
  it("menolak siswa duplikat dalam satu batch sebelum melakukan mutasi", async () => {
    const call = rpc(); const row = await prepareBulkRow(draft(), jenis, books, call);
    await expect(runBulkBilling([row, row], [student()], call, vi.fn())).rejects.toThrow(); expect(call).not.toHaveBeenCalled();
  });
});
