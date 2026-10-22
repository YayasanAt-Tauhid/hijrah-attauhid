
import { describe, expect, it, vi } from "vitest";
import { closeGatewaySession, paymentExpiry, readGatewayStatus } from "./midtransGateway";
const session = { order_id: "HAT-TEST-ONE", snap_token: "token", created_at: new Date().toISOString() };
const noCore = { status_code: "404" };
const success = { canceled_at: new Date().toISOString() };
function mockGateway(responses: Array<[number, object]>) {
  return vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("Unexpected gateway request");
    return new Response(JSON.stringify(next[1]), { status: next[0] });
  }) as unknown as typeof fetch;
}
describe("Gateway closure", () => {
  it("treats Core 404 as an uncharged session, not a closed checkout", async () => {
    expect(await readGatewayStatus(session.order_id, "key", mockGateway([[404, noCore]]))).toBeNull();
    await expect(closeGatewaySession(session, "key", vi.fn(), mockGateway([
      [404, noCore], [500, { error_messages: ["gateway unavailable"] }],
    ]))).rejects.toThrow("ditahan");
  });
  it("requires Snap cancellation even if no payment method was selected", async () => {
    const fetcher = mockGateway([[404, noCore], [200, success], [404, noCore]]);
    await closeGatewaySession(session, "key", vi.fn(), fetcher);
    expect(vi.mocked(fetcher).mock.calls[1][0]).toContain("/token/cancel");
  });
  it("also expires an issued payment code", async () => {
    const pending = { transaction_status: "pending" };
    const fetcher = mockGateway([[200,pending], [200,success], [200,pending],
      [200,{transaction_status:"expire"}], [200,{transaction_status:"expire"}]]);
    await closeGatewaySession(session, "key", vi.fn(), fetcher);
    expect(vi.mocked(fetcher).mock.calls[3][0]).toContain("/expire");
  });
  it("expires an in-progress transaction before retrying Snap cancellation", async () => {
    const pending = {transaction_status:"pending"};
    await closeGatewaySession(session, "key", vi.fn(), mockGateway([
      [200,pending], [400,{error_messages:["Transaction is on progress"]}], [200,pending],
      [200,{transaction_status:"expire"}], [200,success], [200,{transaction_status:"expire"}],
    ]));
  });
  it("does not ignore failure to cancel an in-progress page", async () => {
    const pending = {transaction_status:"pending"};
    await expect(closeGatewaySession(session,"key",vi.fn(),mockGateway([
      [200,pending],[400,{error_messages:["Transaction is on progress"]}],[200,pending],
      [200,{transaction_status:"expire"}],[400,{error_messages:["Transaction is on progress"]}],
    ]))).rejects.toThrow("ditahan");
  });
  it.each(["before cancellation", "during cancellation"])("reconciles settlement %s and blocks another payment", async (when) => {
    const settled = {transaction_status:"settlement"};
    const process = vi.fn();
    const responses: Array<[number,object]> = when === "before cancellation"
      ? [[200,settled]] : [[404,noCore],[200,success],[200,settled]];
    await expect(closeGatewaySession(session,"key",process,mockGateway(responses))).rejects.toThrow("sudah berhasil");
    expect(process).toHaveBeenCalledWith(settled);
  });
  it("accepts a confirmed already-canceled token", async () => {
    await closeGatewaySession(session,"key",vi.fn(),mockGateway([
      [404,noCore],[400,{error_messages:["token already canceled"]}],[404,noCore],
    ]));
  });
  it("does not release a missing recent token", async () => {
    await expect(closeGatewaySession(session,"key",vi.fn(),mockGateway([
      [404,noCore],[404,{error_messages:["token not found"]}],
    ]))).rejects.toThrow("ditahan");
  });
  it("fails closed when the session creation is still in progress", async () => {
    await expect(closeGatewaySession({...session,snap_token:null},"key",vi.fn(),
      mockGateway([[404,noCore]]))).rejects.toThrow("sedang dibuat");
  });
  it("fails closed on network errors", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network timeout"));
    await expect(closeGatewaySession(session,"key",vi.fn(),fetcher)).rejects.toThrow("timeout");
  });
  it("does not accept an ambiguous status error as Core 404", async () => {
    await expect(readGatewayStatus(session.order_id,"key",mockGateway([[404,{message:"Not found"}]]))).rejects.toThrow("dipastikan");
  });
  it("sets an absolute expiry from checkout creation", () => {
    expect(paymentExpiry(new Date("2026-10-09T00:00:00Z"))).toEqual({
      start_time:"2026-10-09 00:00:00 +0000",duration:24,unit:"hours",
    });
  });
});

const expiredSession = {
  ...session, created_at: "2026-01-01T00:00:00Z",
  metadata: { snap_request: {
    transaction_details: { order_id: session.order_id, gross_amount: 1_150_000 },
    expiry: { start_time: "2026-01-01 00:00:00 +0000", unit: "hours", duration: 24 },
    page_expiry: { unit: "hours", duration: 24 },
  } },
};
const expiredCancel = { error_messages: ["expiry must be greater than the current time"] };
describe("expired uncharged Snap sessions", () => {
  it("invalidates the original token and revokes a persisted replacement with fresh short expiry", async () => {
    const persist = vi.fn();
    const fetcher = mockGateway([
      [200,noCore],[400,expiredCancel],[200,noCore],
      [201,{token:"replacement"}],[200,success],[200,noCore],
    ]);
    await closeGatewaySession(expiredSession,"key",vi.fn(),fetcher,persist);
    const calls = vi.mocked(fetcher).mock.calls;
    const payload = JSON.parse(calls[3][1]!.body as string);
    expect(payload.transaction_details).toEqual(expiredSession.metadata.snap_request.transaction_details);
    expect(payload.expiry).toMatchObject({unit:"minutes",duration:5});
    expect(Date.parse(payload.expiry.start_time)).toBeGreaterThan(Date.now()-5000);
    expect(payload.page_expiry).toEqual({unit:"minutes",duration:5});
    expect(expiredSession.metadata.snap_request.expiry.start_time).toBe("2026-01-01 00:00:00 +0000");
    expect(persist).toHaveBeenCalledWith("replacement",payload,expect.any(String));
    expect(persist.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(fetcher).mock.invocationCallOrder[4]);
    expect(calls[4][0]).toContain("/replacement/cancel");
  });
  it("recovers a lost token without replaying an expired creation request", async () => {
    const persist = vi.fn();
    await closeGatewaySession({...expiredSession,snap_token:null},"key",vi.fn(),mockGateway([
      [200,noCore],[200,noCore],[201,{token:"recovered"}],[200,success],[200,noCore],
    ]),persist);
    expect(persist).toHaveBeenCalledWith("recovered",expect.objectContaining({expiry:expect.objectContaining({duration:5})}),expect.any(String));
  });
  it("recovers after a previous replacement invalidated a token before persistence", async () => {
    const persist = vi.fn();
    await closeGatewaySession(expiredSession,"key",vi.fn(),mockGateway([
      [200,noCore],[404,{error_messages:["token not found"]}],[200,noCore],
      [201,{token:"recovered-after-crash"}],[200,success],[200,noCore],
    ]),persist);
    expect(persist).toHaveBeenCalledWith("recovered-after-crash",expect.any(Object),expect.any(String));
  });
  it("does not release the bill when replacement revocation fails", async () => {
    await expect(closeGatewaySession(expiredSession,"key",vi.fn(),mockGateway([
      [200,noCore],[400,expiredCancel],[200,noCore],[201,{token:"replacement"}],
      [500,{error_messages:["unavailable"]}],
    ]),vi.fn())).rejects.toThrow("ditahan");
  });
  it("does not cancel an unpersisted replacement after a database race", async () => {
    const fetcher = mockGateway([
      [200,noCore],[400,expiredCancel],[200,noCore],[201,{token:"replacement"}],
    ]);
    await expect(closeGatewaySession(expiredSession,"key",vi.fn(),fetcher,
      vi.fn().mockRejectedValue(new Error("Status sesi berubah")))).rejects.toThrow("Status sesi berubah");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("does not rotate an order with an issued payment code", async () => {
    const persist = vi.fn();
    await expect(closeGatewaySession(expiredSession,"key",vi.fn(),mockGateway([
      [200,noCore],[400,expiredCancel],[200,{transaction_status:"pending"}],
    ]),persist)).rejects.toThrow("ditahan");
    expect(persist).not.toHaveBeenCalled();
  });
  it("records a payment that settles before replacement and blocks a new checkout", async () => {
    const process = vi.fn(), persist = vi.fn();
    await expect(closeGatewaySession(expiredSession,"key",process,mockGateway([
      [200,noCore],[400,expiredCancel],[200,{transaction_status:"settlement"}],
    ]),persist)).rejects.toThrow("sudah berhasil");
    expect(process).toHaveBeenCalledOnce();
    expect(persist).not.toHaveBeenCalled();
  });
  it("records a payment that settles during replacement cancellation", async () => {
    const process = vi.fn();
    await expect(closeGatewaySession(expiredSession,"key",process,mockGateway([
      [200,noCore],[400,expiredCancel],[200,noCore],[201,{token:"replacement"}],
      [200,success],[200,{transaction_status:"settlement"}],
    ]),vi.fn())).rejects.toThrow("sudah berhasil");
    expect(process).toHaveBeenCalledOnce();
  });
  it("keeps holding when the original request belongs to another order", async () => {
    const mismatched = {...expiredSession,metadata:{snap_request:{transaction_details:{order_id:"OTHER"}}}};
    await expect(closeGatewaySession(mismatched,"key",vi.fn(),mockGateway([
      [200,noCore],[400,expiredCancel],[200,noCore],
    ]),vi.fn())).rejects.toThrow("ditahan");
  });
  it("does not use an old row age to release a newly recovered missing token", async () => {
    await expect(closeGatewaySession(expiredSession,"key",vi.fn(),mockGateway([
      [200,noCore],[400,expiredCancel],[200,noCore],[201,{token:"replacement"}],
      [404,{error_messages:["token not found"]}],
    ]),vi.fn())).rejects.toThrow("ditahan");
  });
});
