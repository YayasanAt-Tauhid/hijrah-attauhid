import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
const state=vi.hoisted(()=>({role:"keuangan",rpc:vi.fn(),process:vi.fn()}));
vi.mock("./supabase",()=>({createAdminClient:()=>({rpc:state.rpc})}));
vi.mock("./auth",()=>({
  authMiddleware:{},requireContext:(context:any)=>context,
  requireRole:async(_db:any,_actor:string,roles:string[])=>{if(!roles.includes(state.role))throw new Error("Forbidden");return state.role;},
}));
vi.mock("./dataDeletion",()=>({processDeletion:state.process}));
vi.mock("@tanstack/react-start",()=>({
  createServerFn:()=>{const chain={middleware:()=>chain,inputValidator:()=>chain,handler:(fn:any)=>fn};return chain;},
}));
import { batalkanTagihan,batalkanTagihanBatch } from "./tagihan";
import { batalkanPembayaran } from "./pembayaran";
type Handler=(args:{context:{userId:string};data:any})=>Promise<any>;
const cancelBill=batalkanTagihan as unknown as Handler;
const cancelBatch=batalkanTagihanBatch as unknown as Handler;
const cancelPayment=batalkanPembayaran as unknown as Handler;
beforeEach(()=>{
  state.role="keuangan";state.rpc.mockReset();state.process.mockReset();
  state.process.mockResolvedValue({pending:true,request_id:"request"});
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-20T22:00:00Z"));
});
afterEach(()=>vi.useRealTimers());
describe("accounting request flows",()=>{
  it("finance cancellation queues a bill without invoking the destructive RPC",async()=>{
    const result=await cancelBill({context:{userId:"staff"},data:{tagihan_id:"bill",mode:"batal",alasan:"Wrong billing"}});
    expect(result).toMatchObject({pending:true,tagihan_id:"bill",jurnal_pembalik_id:null});
    expect(state.process).toHaveBeenCalledWith(expect.anything(),"staff","tagihan","bill","Wrong billing","cancel_bill",{
      tanggal:"2026-10-21",nominal_baru:undefined,
    });
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("nominal correction requires approval too",async()=>{
    await cancelBill({context:{userId:"staff"},data:{tagihan_id:"bill",mode:"koreksi_nominal",nominal_baru:200000,alasan:"Wrong amount"}});
    expect(state.process.mock.calls[0][5]).toBe("correct_bill");
    expect(state.process.mock.calls[0][6].nominal_baru).toBe(200000);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("payment cancellation queues while preserving the receipt and uses Jakarta date",async()=>{
    const result=await cancelPayment({context:{userId:"staff"},data:{pembayaran_id:"payment",alasan:"Wrong receipt"}});
    expect(result.pending).toBe(true);
    expect(state.process).toHaveBeenCalledWith(expect.anything(),"staff","pembayaran","payment","Wrong receipt","cancel_payment",{
      tanggal:"2026-10-21",
    });
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("batch requests use one RPC and report queued counts separately from completed deletions",async()=>{
    state.rpc.mockResolvedValue({data:[{tagihan_id:"one",berhasil:true},{tagihan_id:"two",berhasil:false,error_message:"Already pending"}],error:null});
    const result=await cancelBatch({context:{userId:"staff"},data:{tagihan_ids:["one","two"],alasan:"Wrong class bills"}});
    expect(result).toMatchObject({pending:true,berhasil:0,diajukan:1,gagal:[{tagihan_id:"two",error:"Already pending"}]});
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.rpc.mock.calls[0][0]).toBe("queue_bill_deletion_batch");
    expect(state.process).not.toHaveBeenCalled();
  });
  it("does not grant a cashier cancellation privileges",async()=>{
    state.role="kasir";
    await expect(cancelPayment({context:{userId:"cashier"},data:{pembayaran_id:"payment",alasan:"Wrong receipt"}})).rejects.toThrow("Forbidden");
    expect(state.process).not.toHaveBeenCalled();
  });
});
