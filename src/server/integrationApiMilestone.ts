import { allowed, authenticateIntegration, done, need, uuid } from './integrationApi'

const route = '/api/v1/pendaftaran/:id/milestone'

export async function handleMilestoneUpdate(request: Request, pendaftaranId: string) {
  const ctx = await authenticateIntegration(request)
  if (ctx instanceof Response) return ctx
  const finish = (body: unknown, status = 200) => done(ctx, route, new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  }))
  const fail = (code: string, message: string, status: number) =>
    finish({ error: { code, message, request_id: ctx.requestId } }, status)
  const denied = need(ctx, 'pendaftaran:milestone:update')
  if (denied) return done(ctx, route, denied)
  if (!uuid(pendaftaranId)) return fail('invalid_id', 'ID pendaftaran tidak valid', 400)

  let body: unknown
  try { body = await request.json() } catch {
    return fail('invalid_body', 'Payload JSON tidak valid', 400)
  }
  // Reject additional fields: this endpoint is never a generic student update.
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 1 || !('action' in body)) {
    return fail('invalid_body', 'Payload hanya boleh berisi action', 400)
  }
  const action = (body as { action: unknown }).action
  if (typeof action !== 'string' || !['tes', 'lulus', 'daftar_ulang'].includes(action)) {
    return fail('invalid_action', 'Action harus tes, lulus, atau daftar_ulang', 400)
  }

  try {
    const { data: detail, error: detailError } = await ctx.admin.from('siswa_detail')
      .select('siswa_id,tahun_ajaran_id').eq('pendaftaran_id', pendaftaranId).maybeSingle()
    if (detailError) throw detailError
    if (!detail) return fail('not_found', 'Pendaftaran tidak ditemukan atau di luar cakupan', 404)
    const { data: siswa, error: siswaError } = await ctx.admin.from('siswa')
      .select('departemen_id').eq('id', detail.siswa_id).maybeSingle()
    if (siswaError) throw siswaError
    if (!siswa || !allowed(ctx, siswa.departemen_id, detail.tahun_ajaran_id)) {
      return fail('not_found', 'Pendaftaran tidak ditemukan atau di luar cakupan', 404)
    }

    const metadata = { request_id: ctx.requestId, token_id: ctx.token.id,
      pendaftaran_id: pendaftaranId, milestone: action }
    const audit = async (event: string, extra: Record<string, unknown> = {}) => {
      const { error } = await ctx.admin.from('integration_audit_log').insert({
        integration_id: ctx.integration.id, action: event, metadata: { ...metadata, ...extra },
      })
      if (error) throw error
    }
    // Persist intent before mutation so even a lost response has an audit trail.
    // Refuse the write when audit storage is unavailable.
    await audit('milestone_requested')
    const { data, error: rpcError } = await ctx.admin.rpc('spmb_mark_milestone', {
      p_siswa_id: detail.siswa_id, p_action: action,
    })
    if (rpcError) {
      await audit('milestone_failed', { code: rpcError.code })
      if (rpcError.code === 'P0001') return fail('business_rule_failed', rpcError.message, 400)
      throw rpcError
    }
    await audit('milestone_updated', { marked_at: data })
    return finish({ data: { pendaftaran_id: pendaftaranId, action, marked_at: data }, request_id: ctx.requestId })
  } catch {
    // Do not expose SQL details or internals. Retrying the same action is safe.
    return fail('temporary_failure', 'Permintaan belum dapat dikonfirmasi. Ulangi action yang sama.', 503)
  }
}
