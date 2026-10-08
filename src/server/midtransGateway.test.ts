
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
