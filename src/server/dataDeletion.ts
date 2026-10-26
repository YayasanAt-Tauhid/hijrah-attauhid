import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware, requireContext } from "./auth";
import { createAdminClient } from "./supabase";

export interface DeletionResult {
  pending: boolean;
  request_id: string;
  result?: { action?: "deleted" | "deactivated"; jurnal_pembalik_id?: string | null; jurnal_baru_id?: string | null; warn_no_jurnal?: boolean };
}
const deletionInput = z.object({
  table: z.string().min(1).max(64),
  id: z.string().uuid(),
  reason: z.string().trim().min(5, "Alasan minimal 5 karakter").max(2000),
});
/** p_actor is always the authenticated user, never an input from the browser. */
export async function processDeletion(admin: ReturnType<typeof createAdminClient>, userId: string,
  table: string, id: string, reason: string, action = "delete", payload: Record<string, unknown> = {}): Promise<DeletionResult> {
  const { data, error } = await (admin as any).rpc("process_data_deletion", {
    p_actor: userId, p_table: table, p_id: id, p_reason: reason, p_action: action, p_payload: payload,
  });
  if (error) throw new Error(error.code === "23503"
    ? "Data masih digunakan oleh catatan lain. Periksa keterkaitannya atau gunakan status nonaktif."
    : error.message);
  return data as DeletionResult;
}
export const deleteData = createServerFn({ method: "POST" })
  .middleware([authMiddleware]).inputValidator((data: unknown) => deletionInput.parse(data))
  .handler(async ({ data, context }): Promise<DeletionResult> => {
    return processDeletion(createAdminClient(), requireContext(context).userId, data.table, data.id, data.reason);
  });

export const listDeletionRequests = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => z.object({ status: z.enum(["pending","history"]).default("pending"), page: z.number().int().min(0).max(10000).default(0) }).parse(data))
  .handler(async ({ data, context }) => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    const { data: profile, error: profileError } = await admin.from("users_profile").select("role,aktif").eq("id", userId).single();
    if (profileError || !profile?.aktif) throw new Error("Akun tidak aktif");
    let query = (admin as any).from("data_deletion_requests").select("*").order("requested_at", { ascending: false }).order("id", { ascending: false }).range(data.page * 50, data.page * 50 + 50);
    if (profile.role !== "admin") query = query.eq("requested_by", userId);
    query = data.status === "pending" ? query.eq("status","pending") : query.neq("status","pending");
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    const items = (rows || []).slice(0, 50);
    const ids = [...new Set(items.flatMap((r: any) => [r.requested_by,r.reviewed_by]).filter(Boolean))] as string[];
    const { data: profiles, error: peopleError } = ids.length
      ? await admin.from("users_profile").select("id,email,role").in("id",ids)
      : { data: [], error: null };
    if (peopleError) throw new Error(peopleError.message);
    const people = new Map((profiles || []).map(p => [p.id,p]));
    return { items: items.map((r: any) => ({ ...r, requester: people.get(r.requested_by), reviewer: people.get(r.reviewed_by) })), hasMore: (rows || []).length > 50 };
  });

export const reviewDeletionRequest = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => z.object({
    id: z.string().uuid(), approve: z.boolean(), note: z.string().trim().min(5).max(2000),
  }).parse(data))
  .handler(async ({ data, context }): Promise<{ status: "approved" | "rejected" | "changed" }> => {
    const { data: result, error } = await (createAdminClient() as any).rpc("review_data_deletion", {
      p_actor: requireContext(context).userId, p_request: data.id, p_approve: data.approve, p_note: data.note,
    });
    if (error) throw new Error(error.message);
    return result;
  });
