import { beforeEach,describe,expect,it,vi } from "vitest";
const { db }=vi.hoisted(()=>({db:{rpc:vi.fn(),from:vi.fn()}}));
vi.mock("./supabase",()=>({createAdminClient:()=>db}));
vi.mock("./auth",()=>({
  authMiddleware:{},
  requireContext:(context:any)=>{if(!context?.userId)throw new Error("Unauthorized");return context;},
}));
vi.mock("@tanstack/react-start",()=>({
  createServerFn:()=>{
    let validate=(data:unknown)=>data;
    const chain={
      middleware:()=>chain,
      inputValidator:(fn:typeof validate)=>{validate=fn;return chain;},
      handler:(fn:any)=>async(args:any)=>fn({...args,data:validate(args.data)}),
    };return chain;
  },
}));
import { deleteData,reviewDeletionRequest,listDeletionRequests } from "./dataDeletion";
const id="00000000-0000-4000-8000-000000000001";
const actor="00000000-0000-4000-8000-000000000002";
type Handler=(args:{context?:{userId:string};data:unknown})=>Promise<any>;
const remove=deleteData as unknown as Handler;
const review=reviewDeletionRequest as unknown as Handler;
const list=listDeletionRequests as unknown as Handler;
beforeEach(()=>{
  db.rpc.mockReset();db.from.mockReset();
  db.rpc.mockResolvedValue({data:{pending:true,request_id:id},error:null});
});
describe("deletion server boundary",()=>{
  it("requires a session before invoking the service RPC",async()=>{
    await expect(remove({data:{table:"siswa",id,reason:"Wrong record"}})).rejects.toThrow("Unauthorized");
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("ignores a forged actor and action supplied by the client",async()=>{
    const result=await remove({context:{userId:actor},data:{table:"siswa",id,reason:"Wrong record",p_actor:id,action:"cancel_payment"}});
    expect(result.pending).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith("process_data_deletion",{
      p_actor:actor,p_table:"siswa",p_id:id,p_reason:"Wrong record",p_action:"delete",p_payload:{},
    });
  });
  it("rejects invalid IDs and short reasons without a database mutation",async()=>{
    await expect(remove({context:{userId:actor},data:{table:"siswa",id:"invalid",reason:"x"}})).rejects.toThrow();
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("propagates the database permission decision",async()=>{
    db.rpc.mockResolvedValue({data:null,error:{message:"Data di luar kewenangan akun"}});
    await expect(remove({context:{userId:actor},data:{table:"siswa",id,reason:"Wrong record"}})).rejects.toThrow("di luar kewenangan");
  });
  it("review uses the session actor and requires an explicit decision and note",async()=>{
    await review({context:{userId:actor},data:{id,approve:false,note:"Keep this record",p_actor:id}});
    expect(db.rpc).toHaveBeenCalledWith("review_data_deletion",{
      p_actor:actor,p_request:id,p_approve:false,p_note:"Keep this record",
    });
    db.rpc.mockClear();
    await expect(review({context:{userId:actor},data:{id,note:"Keep this record"}})).rejects.toThrow();
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("scopes a staff list to its owner before querying requests",async()=>{
    const filters:any[]=[];
    db.from.mockImplementation((table:string)=>{
      const q={
        select:()=>q,order:()=>q,range:()=>q,neq:()=>q,in:()=>q,
        eq:(column:string,value:string)=>{filters.push([table,column,value]);return q;},
        single:async()=>({data:{role:"keuangan",aktif:true},error:null}),
        then:(resolve:any)=>resolve({data:[],error:null}),
      };return q;
    });
    await expect(list({context:{userId:actor},data:{status:"pending",requested_by:id}})).resolves.toEqual({items:[],hasMore:false});
    expect(filters).toContainEqual(["data_deletion_requests","requested_by",actor]);
  });
  it("denies an inactive account before reading request snapshots",async()=>{
    db.from.mockReturnValue({select:()=>({eq:()=>({single:async()=>({data:{role:"admin",aktif:false},error:null})})})});
    await expect(list({context:{userId:actor},data:{status:"pending"}})).rejects.toThrow("tidak aktif");
    expect(db.from).toHaveBeenCalledTimes(1);
  });
});
