import { beforeEach, describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({
 status:"diterima", internal:false,
 activeClasses:[] as any[], targetClass:null as any,
 activeAt:null as string|null,
}));
const id="11111111-1111-4111-8111-111111111111";
const targetDept="22222222-2222-4222-8222-222222222222";
const oldDept="33333333-3333-4333-8333-333333333333";
const academicYear="44444444-4444-4444-8444-444444444444";
const classId="55555555-5555-4555-8555-555555555555";
const db=vi.hoisted(()=>({from:vi.fn()}));
vi.mock("@tanstack/react-start",()=>({
 createServerFn:()=>{const q={middleware:()=>q,inputValidator:()=>q,handler:(fn:any)=>(args:any)=>fn(args)};return q;}
}));
vi.mock("./supabase",()=>({createAdminClient:()=>db}));
vi.mock("./auth",()=>({authMiddleware:{},requireContext:()=>({userId:"test"}),requireRole:async()=>{}}));
import {getSpmbBillingCandidates} from "./spmbBilling";
const classRow=(dept=targetDept,year=academicYear,klass=classId,aktif=true)=>({
 siswa_id:id,kelas_id:klass,tahun_ajaran_id:year,
 kelas:{id:klass,nama:"7A",departemen_id:dept,aktif},
});
function records(table:string){
 switch(table){
 case "siswa_detail":return [{siswa_id:id,tahun_ajaran_id:academicYear,
 spmb_status_kelulusan:"lulus",spmb_status_pendaftaran:"diterima",spmb_departemen_tujuan_id:targetDept,
 spmb_kelas_tujuan_id:data.targetClass?.id??null,spmb_siswa_internal:data.internal,
 spmb_tanggal_aktivasi:data.activeAt,spmb_gelombang_id:"wave"}];
 case "siswa":return [{id,nama:"Calon diterima",nis:null,status:data.status,departemen_id:data.internal?oldDept:targetDept}];
 case "kelas_siswa":return data.activeClasses;
 case "rencana_tagihan_siswa":return [];
 case "departemen":return [{id:targetDept,nama:"SMP",kode:"SMP"}];
 case "tahun_ajaran":return [{id:academicYear,nama:"2027/2028",tanggal_mulai:"2027-07-01",tanggal_selesai:"2028-06-30"}];
 case "kelas":return data.targetClass?[data.targetClass]:[];
 default:return [];
 }
}
const run=async()=>(await (getSpmbBillingCandidates as any)({})).items[0];
beforeEach(()=>{
 data.status="diterima";data.internal=false;data.activeClasses=[];data.targetClass=null;data.activeAt=null;
 db.from.mockImplementation((table:string)=>{
 const q={select:()=>q,eq:()=>q,not:()=>q,order:()=>q,limit:()=>q,in:()=>q,
 then:(resolve:any)=>resolve({data:records(table),error:null})};return q;
 });
});
describe("penagihan SPMB sebelum penempatan kelas",()=>{
 it("menerbitkan biaya awal untuk siswa diterima tanpa kelas dan menunda SPP",async()=>{
 expect(await run()).toMatchObject({status:"diterima",kelas_id:null,ready_for_billing:true,ready_for_spp:false,target_departemen_id:targetDept});
 });
 it("tidak memakai kelas asal siswa internal",async()=>{
 data.status="aktif";data.internal=true;data.activeClasses=[classRow(oldDept)];
 expect(await run()).toMatchObject({kelas_id:null,ready_for_billing:true,ready_for_spp:false});
 });
 it("mengizinkan SPP setelah aktivasi dengan kelas tujuan yang aktif",async()=>{
 data.status="aktif";data.internal=true;data.activeAt="2027-07-01T00:00:00Z";data.activeClasses=[classRow()];
 expect(await run()).toMatchObject({kelas_id:classId,ready_for_spp:true});
 });
 it("pilihan kelas tujuan tanpa penempatan aktif belum mengizinkan SPP",async()=>{
 data.status="aktif";data.targetClass=classRow().kelas;
 expect(await run()).toMatchObject({kelas_id:classId,ready_for_spp:false});
 });
 it("melewati kelas tahun lama sebelum memilih penempatan tujuan",async()=>{
 data.status="aktif";data.activeClasses=[classRow(targetDept,"old-year","old-class"),classRow(oldDept),classRow()];
 expect(await run()).toMatchObject({kelas_id:classId,ready_for_spp:true});
 });
 it("kelas yang dinonaktifkan tidak mengizinkan SPP",async()=>{
 data.status="aktif";data.activeClasses=[classRow(targetDept,academicYear,classId,false)];
 expect(await run()).toMatchObject({kelas_id:null,ready_for_spp:false});
 });
 it("memakai penempatan aktif walau pilihan kelas tersimpan berbeda",async()=>{
 data.status="aktif";data.activeClasses=[classRow()];data.targetClass=classRow(targetDept,academicYear,"selected-only").kelas;
 expect(await run()).toMatchObject({kelas_id:classId,ready_for_spp:true});
 });
});
