
import { createFileRoute } from "@tanstack/react-router";
import { createAdminClient } from "@/server/supabase";
import { reconcileOnlineSessions } from "@/server/midtransSessions";

export async function handleReconciliation(request: Request) {
  try {
    const { timestamp, signature } = await request.json();
    if (!Number.isSafeInteger(timestamp) || typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)) {
      return new Response("Unauthorized", { status: 401 });
    }
    const admin = createAdminClient() as any;
    const { data: allowed, error } = await admin.rpc("claim_midtrans_reconciliation", {
      p_timestamp: timestamp, p_signature: signature,
    });
    if (error) throw error;
    if (!allowed) return new Response("Unauthorized or already running", { status: 401 });
    return Response.json(await reconcileOnlineSessions());
  } catch {
    return Response.json({ error: "Reconciliation failed" }, { status: 500 });
  }
}
export const Route = createFileRoute("/api/midtrans-reconcile")({
  server: { handlers: { POST: ({ request }) => handleReconciliation(request) } },
});
