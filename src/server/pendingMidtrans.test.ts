import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), close: vi.fn() }));
vi.mock("./supabase", () => ({ createAdminClient: () => ({from:mocks.from}), readEnv: () => "key" }));
vi.mock("./midtransSessions", () => ({ closeStoredSession: mocks.close, processGatewayPayment: vi.fn() }));
import { findReusablePaymentForBills } from "./pendingMidtrans";
const items = [{tagihan_id:"bill",jumlah:100}];
const expired = { id:"old",order_id:"HAT-OLD",user_id:"another-parent",status:"pending",snap_token:"old-token",
  gateway_closed_at:null,created_at:"2026-01-01T00:00:00Z",expired_at:"2026-01-02T00:00:00Z",metadata:{} };
function rows(transactions: object[]) {
  const q = {select:()=>q,in:()=>q,then:(resolve:any)=>resolve({data:transactions.map(transaksi=>({transaksi})),error:null})};
  mocks.from.mockReturnValue(q);
}
beforeEach(()=>{vi.clearAllMocks();mocks.close.mockReset();mocks.close.mockResolvedValue(undefined);});
describe("checkout expired blockers",()=>{
  it("closes expired sessions from another linked parent before starting a new payment",async()=>{
    rows([expired]);
    await expect(findReusablePaymentForBills("parent",items)).resolves.toBeNull();
    expect(mocks.close).toHaveBeenCalledWith(expired,"expired_session_at_checkout");
  });
  it("holds the bill if expiry cannot be confirmed by the gateway",async()=>{
    rows([expired]);mocks.close.mockRejectedValue(new Error("gateway timeout"));
    await expect(findReusablePaymentForBills("parent",items)).rejects.toThrow("timeout");
  });
  it("leaves an active session owned by another parent intact",async()=>{
    rows([{...expired,expired_at:new Date(Date.now()+3600000).toISOString()}]);
    await expect(findReusablePaymentForBills("parent",items)).rejects.toThrow("online lain");
    expect(mocks.close).not.toHaveBeenCalled();
  });
  it("never closes paid sessions with incomplete bookkeeping",async()=>{
    rows([{...expired,user_id:"parent",status:"paid"}]);
    await expect(findReusablePaymentForBills("parent",items)).rejects.toThrow("sedang dibukukan");
    expect(mocks.close).not.toHaveBeenCalled();
  });
  it("never treats a public session without owner (PMB) as owned by a payment link",async()=>{
    rows([{...expired,user_id:null,payment_link_id:null,expired_at:new Date(Date.now()+3600000).toISOString()}]);
    await expect(findReusablePaymentForBills({paymentLinkId:"link-1"},items)).rejects.toThrow("online lain");
  });
  it("keeps sessions of one payment link away from another link and from parents",async()=>{
    const active={...expired,user_id:null,payment_link_id:"link-1",expired_at:new Date(Date.now()+3600000).toISOString()};
    rows([active]);
    await expect(findReusablePaymentForBills({paymentLinkId:"link-2"},items)).rejects.toThrow("online lain");
    rows([active]);
    await expect(findReusablePaymentForBills("parent",items)).rejects.toThrow("online lain");
  });
  it("recognizes an active session created through the same payment link",async()=>{
    const active={...expired,user_id:null,payment_link_id:"link-1",expired_at:new Date(Date.now()+3600000).toISOString()};
    const blockersQuery={select:()=>blockersQuery,in:()=>blockersQuery,
      then:(resolve:any)=>resolve({data:[{transaksi:active}],error:null})};
    const itemsQuery={select:()=>itemsQuery,eq:()=>itemsQuery,
      then:(resolve:any)=>resolve({data:[{tagihan_id:"other-bill",jumlah:100}],error:null})};
    mocks.from.mockImplementationOnce(()=>blockersQuery).mockImplementationOnce(()=>itemsQuery);
    // Owned by this link → reaches the "same items" comparison instead of "online lain".
    await expect(findReusablePaymentForBills({paymentLinkId:"link-1"},items)).rejects.toThrow("sebagian tagihan");
  });
  it("closes each expired blocker once even if it has multiple bill items",async()=>{
    rows([expired,expired]);
    await expect(findReusablePaymentForBills("parent",items)).resolves.toBeNull();
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
});
