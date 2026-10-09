import { describe, expect, it } from "vitest";
import { service, admin, parent, outsider, ok, f, type, subject, readFixture } from "./spmb139-common.mjs";

const online = readFixture("spmb139-online-fixture.json");
const fee = type("UANG PANGKAL SMP");
const spp = type("SPP SMP");
const ids = [...f.subjects.map((s: any) => s.id), online.id];
const generation = {
  p_tarif_rows: [{
    jenis_id: fee.id, siswa_id: online.id, kelas_id: null, angkatan_id: null,
    tahun_ajaran_id: f.book27, nominal: 4_200_000, keterangan: "QA139 rejection verification",
  }],
  p_tahun_akademik_id: f.academic27,
  p_jenis_id: fee.id,
  p_generate_groups: [{ tahun_buku_id: f.book27, bulan_list: [null] }],
  p_departemen_id: f.dept,
  p_siswa_id: online.id,
};

describe("PR139 persisted staging evidence and access guards", () => {
  it("rejects an origin department or class and prevents an unrelated parent from issuing bills", async () => {
    const before = await ok(service.from("tarif_tagihan").select("id").in("siswa_id", ids), "tariffs before");
    const badDept = await admin.rpc("simpan_tarif_dan_generate_atomik", {
      ...generation, p_departemen_id: f.oldDept,
    });
    expect(badDept.error?.message).toMatch(/Lembaga tagihan tidak sesuai/);
    const badClass = await admin.rpc("simpan_tarif_dan_generate_atomik", {
      ...generation, p_kelas_id: f.oldClass,
    });
    expect(badClass.error?.message).toMatch(/Kelas tagihan tidak sesuai/);
    const unauthorized = await outsider.rpc("simpan_tarif_generate_dan_rencana_atomik", generation);
    expect(unauthorized.error?.message).toMatch(/tidak memiliki akses/);
    const after = await ok(service.from("tarif_tagihan").select("id").in("siswa_id", ids), "tariffs after");
    expect(after.map((x: any) => x.id).sort()).toEqual(before.map((x: any) => x.id).sort());
  });

  it("rejects target SPP before activation and preserves all invoice counts", async () => {
    const student = subject("external");
    const before = await ok(service.from("tagihan").select("id").eq("siswa_id", student.id), "invoices before");
    const rejected = await admin.rpc("simpan_tarif_generate_dan_rencana_atomik", {
      ...generation,
      p_siswa_id: student.id, p_jenis_id: spp.id,
      p_tarif_rows: [{
        jenis_id: spp.id, siswa_id: student.id, kelas_id: null, angkatan_id: null,
        tahun_ajaran_id: f.book27, nominal: 450_000, keterangan: "QA139 must roll back",
      }],
      p_generate_groups: [{ tahun_buku_id: f.book27, bulan_list: [7] }],
    });
    expect(rejected.error?.message).toMatch(/SPP SPMB memerlukan aktivasi/);
    const after = await ok(service.from("tagihan").select("id").eq("siswa_id", student.id), "invoices after");
    expect(after.map((x: any) => x.id).sort()).toEqual(before.map((x: any) => x.id).sort());
  });

  it("preserves balanced journals, target department and both actual payment books", async () => {
    const bills = await ok(service.from("tagihan").select("id,siswa_id,jenis_id").in("siswa_id", ids), "bills");
    const payments = await ok(service.from("pembayaran").select("*").in("tagihan_id", bills.map((b: any) => b.id)), "payments");
    expect(payments.length).toBeGreaterThanOrEqual(8);
    const journals = await ok(service.from("jurnal").select("id,departemen_id,total_debit,total_kredit")
      .in("id", payments.map((p: any) => p.jurnal_id)), "journals");
    for (const p of payments) expect(p.departemen_id).toBe(f.dept);
    for (const j of journals) {
      expect(j.departemen_id).toBe(f.dept);
      expect(Number(j.total_debit)).toBe(Number(j.total_kredit));
    }
    const extBill = bills.find((b: any) => b.siswa_id === subject("external").id && b.jenis_id === fee.id);
    const extPayments = payments.filter((p: any) => p.tagihan_id === extBill.id);
    expect(extPayments).toHaveLength(2);
    expect(extPayments.reduce((n: number, p: any) => n + Number(p.jumlah), 0)).toBe(4_200_000);
    expect(extPayments.map((p: any) => p.tahun_ajaran_id).sort()).toEqual([f.book26, f.book27].sort());
    const onlinePayments = payments.filter((p: any) => p.tagihan_id === online.bill.id);
    expect(onlinePayments).toHaveLength(2);
    expect(onlinePayments.reduce((n: number, p: any) => n + Number(p.jumlah), 0)).toBe(4_200_000);
  });

  it("keeps parent invoices isolated and excludes the internal origin class", async () => {
    const own = await ok(parent.from("v_tagihan_belum_bayar").select("*").eq("tagihan_id", online.bill.id), "own portal");
    expect(own).toHaveLength(1);
    expect(own[0].sudah_bayar).toBe(true);
    expect(own[0].nominal).toBe(0);
    expect(own[0].kelas_nama).toBeNull();
    expect(own[0].departemen_id).toBe(f.dept);
    const foreign = await ok(outsider.from("v_tagihan_belum_bayar").select("tagihan_id").in("siswa_id", ids), "unrelated parent");
    expect(foreign).toHaveLength(0);
    const internal = await ok(service.from("v_tagihan_belum_bayar").select("kelas_nama,departemen_id")
      .eq("siswa_id", subject("internal").id), "internal target invoice");
    expect(internal[0].kelas_nama).toBeNull();
    expect(internal[0].departemen_id).toBe(f.dept);
  });
});
