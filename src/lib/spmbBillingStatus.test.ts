
import { describe, expect, it } from "vitest";
import { summarizeSpmbBillingInputs, type SpmbInputBill } from "./spmbBillingStatus";
const target={id:"student",target_departemen_id:"smp",tahun_ajaran_id:"academic-2027",tahun_ajaran_mulai:"2027-07-01",tahun_ajaran_selesai:"2028-06-30"};
const bill=(changes: Partial<SpmbInputBill>={}):SpmbInputBill=>({
 id:"bill",siswa_id:"student",jenis_id:"spp",tahun_ajaran_id:"book-2027",tahun_akademik_id:"academic-2027",bulan:7,nominal:500000,status:"terjadwal",
 jenis:{nama:"SPP SMP",tipe:"bulanan",departemen_id:"smp"},tahun_buku:{tanggal_mulai:"2027-01-01",tanggal_selesai:"2027-12-31"},...changes,
});
const pangkal=(changes:Partial<SpmbInputBill>={})=>bill({id:"pangkal",jenis_id:"pangkal",bulan:null,nominal:10000000,jenis:{nama:"UANG PANGKAL SMP",tipe:"sekali",departemen_id:"smp"},...changes});
describe("status input biaya SPMB",()=>{
 it("menganggap tagihan terjadwal sudah diinput sebelum jatuh tempo dan tanpa kelas",()=>{
  const result=summarizeSpmbBillingInputs(target,[bill(),pangkal()]);
  expect(result.spp_awal).toMatchObject({status:"sudah_diinput",nominal:500000,tagihan:[{periode:"2027-07-01"}]});
  expect(result.uang_pangkal).toMatchObject({status:"sudah_diinput",nominal:10000000});
 });
 it("membedakan belum diinput dari dibatalkan/dihapusbuku",()=>{
  expect(summarizeSpmbBillingInputs(target,[]).spp_awal.status).toBe("belum_diinput");
  const result=summarizeSpmbBillingInputs(target,[bill({status:"dibatalkan"}),pangkal({status:"dihapusbuku"})]);
  expect(result.spp_awal).toMatchObject({status:"perlu_diperiksa",nominal:0,dibatalkan:1,tagihan:[]});
  expect(result.uang_pangkal.status).toBe("perlu_diperiksa");
 });
 it("menyertakan daftar tagihan dibatalkan (id, periode, status) agar dapat diterbitkan ulang",()=>{
  const result=summarizeSpmbBillingInputs(target,[bill({id:"s1",status:"dibatalkan",nominal:1350000}),bill({id:"s2",bulan:8,status:"dihapusbuku"}),pangkal({id:"p1",status:"dibatalkan",nominal:13100000})]);
  expect(result.spp_awal.dibatalkan_tagihan).toEqual([
   {id:"s1",jenis_id:"spp",nama:"SPP SMP",nominal:1350000,status:"dibatalkan",periode:"2027-07-01"},
   {id:"s2",jenis_id:"spp",nama:"SPP SMP",nominal:500000,status:"dihapusbuku",periode:"2027-08-01"},
  ]);
  expect(result.uang_pangkal.dibatalkan_tagihan).toMatchObject([{id:"p1",status:"dibatalkan",nominal:13100000,periode:null}]);
 });
 it("daftar dibatalkan kosong bila ada tagihan aktif atau tidak ada tagihan",()=>{
  expect(summarizeSpmbBillingInputs(target,[]).spp_awal.dibatalkan_tagihan).toEqual([]);
  const result=summarizeSpmbBillingInputs(target,[bill({id:"aktif"}),bill({id:"lama",bulan:8,status:"dibatalkan"})]);
  expect(result.spp_awal.status).toBe("sudah_diinput");
  expect(result.spp_awal.dibatalkan_tagihan.map(x=>x.id)).toEqual(["lama"]);
 });
 it("tidak mencampur siswa, lembaga asal, tahun ajaran lama, atau SPP di luar periode",()=>{
  const result=summarizeSpmbBillingInputs(target,[
   bill({siswa_id:"other"}),bill({tahun_akademik_id:"academic-old"}),
   bill({jenis:{nama:"SPP SD",tipe:"bulanan",departemen_id:"sd"}}),
   bill({bulan:6}),pangkal({tahun_akademik_id:"old"}),
   pangkal({jenis:{nama:"UANG PANGKAL SD",tipe:"sekali",departemen_id:"sd"}}),
  ]);
  expect(result.spp_awal.status).toBe("belum_diinput");
  expect(result.uang_pangkal.status).toBe("belum_diinput");
 });
 it("mengenali input manual tanpa metadata akademik pada tahun buku yang tepat",()=>{
  const result=summarizeSpmbBillingInputs(target,[bill({tahun_akademik_id:null}),pangkal({tahun_akademik_id:null})]);
  expect(result.spp_awal.status).toBe("sudah_diinput");
  expect(result.uang_pangkal.status).toBe("sudah_diinput");
  expect(summarizeSpmbBillingInputs(target,[pangkal({tahun_akademik_id:null,tahun_buku:{tanggal_mulai:"2026-01-01",tanggal_selesai:"2026-12-31"}})]).uang_pangkal.status).toBe("belum_diinput");
 });
 it("memetakan Januari pada tahun buku lintas tahun tanpa tertukar dengan tahun sebelumnya",()=>{
  const result=summarizeSpmbBillingInputs(target,[bill({bulan:1,tahun_buku:{tanggal_mulai:"2027-07-01",tanggal_selesai:"2028-06-30"}})]);
  expect(result.spp_awal.tagihan[0].periode).toBe("2028-01-01");
 });
 it("mempertahankan tagihan lunas dan nol, serta memisahkan pembatalan dari total aktif",()=>{
  const result=summarizeSpmbBillingInputs(target,[bill({nominal:0,status:"lunas"}),bill({id:"cancelled",status:"dibatalkan"})]);
  expect(result.spp_awal).toMatchObject({status:"sudah_diinput",nominal:0,dibatalkan:1});
 });
});
