import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({from:vi.fn(), writes:[] as any[], rejectReplacement:false, rejectClosure:false}));
vi.mock("./supabase",()=>({createAdminClient:()=>db,readEnv:()=>"SB-fixture"}));
import {closeStoredSession} from "./midtransSessions";
const tx = {id:"tx",order_id:"HAT-ONE",status:"pending",snap_token:"old",created_at:"2026-01-01T00:00:00Z",
 metadata:{bill_balances:{bill:100},snap_request:{transaction_details:{order_id:"HAT-ONE",gross_amount:100}}}};
beforeEach(()=>{
 db.writes=[];db.rejectReplacement=false;db.rejectClosure=false;
 db.from.mockImplementation(()=>{
  let values:any;const filters:any[]=[];
  const q={update:(v:any)=>{values=v;db.writes.push({values,filters});return q;},
   eq:(...f:any[])=>{filters.push(["eq",...f]);return q;},neq:(...f:any[])=>{filters.push(["neq",...f]);return q;},
   is:(...f:any[])=>{filters.push(["is",...f]);return q;},select:()=>q,
   then:(resolve:any)=>resolve({data:(values?.snap_token&&db.rejectReplacement)||(values?.status&&db.rejectClosure)?[]:[{id:"tx"}],error:null})};
  return q;
 });
 const responses=[{status_code:"404"},{error_messages:["expiry must be greater than the current time"]},
  {status_code:"404"},{token:"replacement"},{canceled_at:new Date().toISOString()},{status_code:"404"}];
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json(responses.shift())));
});
afterEach(()=>vi.unstubAllGlobals());
describe("persisting recovered session closure",()=>{
 it("persists the replacement then closes only that unpaid session, preserving bill metadata",async()=>{
  await closeStoredSession(tx,"periodic_reconciliation");
  expect(db.writes).toHaveLength(2);
  expect(db.writes[0].values).toMatchObject({snap_token:"replacement",metadata:{bill_balances:{bill:100},snap_recovered_at:expect.any(String)}});
  expect(db.writes[0].filters).toContainEqual(["eq","snap_token","old"]);
  expect(db.writes[1].values).toMatchObject({status:"expired",metadata:{bill_balances:{bill:100},session_closure:{reason:"periodic_reconciliation"}}});
  for(const write of db.writes){
   expect(write.filters).toContainEqual(["neq","status","paid"]);
   expect(write.filters).toContainEqual(["is","paid_at",null]);
   expect(write.filters).toContainEqual(["is","gateway_closed_at",null]);
  }
  expect(db.writes[1].filters).toContainEqual(["eq","snap_token","replacement"]);
 });
 it("does not mark a session closed if replacement persistence loses a race",async()=>{
  db.rejectReplacement=true;
  await expect(closeStoredSession(tx,"parent_canceled_payment")).rejects.toThrow("Status sesi berubah");
  expect(db.writes.some(w=>w.values.status)).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(4);
 });
 it("reports a closure race instead of pretending a newly paid session was closed",async()=>{
  db.rejectClosure=true;
  await expect(closeStoredSession(tx,"periodic_reconciliation")).rejects.toThrow("Status transaksi online berubah");
  expect(db.writes.at(-1).values.reconciliation_error).toContain("Status transaksi online berubah");
 });
});
