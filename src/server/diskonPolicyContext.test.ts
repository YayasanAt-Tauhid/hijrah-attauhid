import { beforeEach, describe, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({
 from:vi.fn(), target:"7A" as string|null, placement:null as string|null, fail:false,
}));
vi.mock("@tanstack/react-start",()=>({
 createServerFn:()=>{const q={middleware:()=>q,inputValidator:()=>q,handler:(fn:unknown)=>fn};return q;}
}));
vi.mock("./supabase",()=>({createAdminClient:()=>({from:m.from})}));
vi.mock("./auth",()=>({authMiddleware:{},requireContext:()=>({userId:"admin"}),requireRole:async()=>{}}));
import { cariKebijakanKeringananAktif } from "./diskon";
beforeEach(()=>{
 vi.clearAllMocks();m.target="7A";m.placement=null;m.fail=false;
 m.from.mockImplementation((table:string)=>{
   const filters:Record<string,unknown>={};
   const q={
    select:()=>q,eq:(key:string,value:unknown)=>{filters[key]=value;return q;},not:()=>q,
    order:()=>q,limit:()=>q,maybeSingle:()=>q,lte:()=>q,or:()=>q,
    then:(resolve:(v:unknown)=>void)=>{
      let data:unknown=[];
      if(table==="siswa_detail") data={spmb_kelas_tujuan_id:m.target?"target-class":null,spmb_departemen_tujuan_id:"smp",tahun_ajaran_id:"2027"};
      if(table==="kelas_siswa") data=filters.tahun_ajaran_id
        ? [{kelas:{nama:"6A",departemen_id:"sd",aktif:true}},...(m.placement?[{kelas:{nama:m.placement,departemen_id:"smp",aktif:true}}]:[])]
        : [{kelas:{nama:"6A"}}];
      if(table==="kelas") data=m.target?{nama:m.target}:null;
      if(table==="kebijakan_keringanan") data=[
        {id:"kelas-asal",kelas_regex:"^6"},
        {id:"kelas-7",kelas_regex:"^7"},
        {id:"kelas-8",kelas_regex:"^8"},
        {id:"umum",kelas_regex:null},
      ];
      resolve({data,error:m.fail&&table==="siswa_detail"?{message:"unavailable"}:null});
    }
   };return q;
 });
});
const run=(spmb=true)=>(cariKebijakanKeringananAktif as unknown as (v:unknown)=>Promise<{item:{id:string}}>)({
 data:{siswa_id:"internal",skema_diskon_id:"skema",jenis_id:"spp-smp",periode_mulai:"2027-07-01",konteks_spmb:spmb},context:{},
});
describe("kebijakan keringanan sesuai kelas tujuan SPMB",()=>{
 it("memakai kelas tujuan, bukan kelas aktif asal siswa internal",async()=>{
  expect((await run()).item.id).toBe("kelas-7");
 });
 it("menunda kebijakan khusus kelas jika tujuan belum ditentukan",async()=>{
  m.target=null;expect((await run()).item.id).toBe("umum");
 });
 it("mengutamakan penempatan aktif pada tahun dan lembaga tujuan",async()=>{
  m.placement="8A";expect((await run()).item.id).toBe("kelas-8");
 });
 it("mempertahankan pencarian kelas aktif pada formulir umum",async()=>{
  expect((await run(false)).item.id).toBe("kelas-asal");
 });
 it("menghentikan pencarian bila pembacaan tujuan SPMB gagal",async()=>{
  m.fail=true;await expect(run()).rejects.toThrow("Gagal membaca tujuan SPMB");
 });
});
