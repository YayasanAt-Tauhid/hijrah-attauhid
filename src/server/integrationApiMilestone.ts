import { createAdminClient } from './supabase'
import { authenticateIntegration } from './integrationApi'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  })
}

function error(code: string, message: string, status: number, requestId: string) {
  return json({ error: { code, message, request_id: requestId } }, status)
}

export async function handleMilestoneUpdate(request: Request, pendaftaranId: string) {
  const auth = await authenticateIntegration(request)
  if (auth instanceof Response) return auth

  const ctx = auth
  const requestId = ctx.requestId

  if (!(ctx.integration.scopes || []).includes('pendaftaran:milestone:update')) {
    return error('forbidden', 'Scope pendaftaran:milestone:update diperlukan', 403, requestId)
  }

  if (!pendaftaranId) {
    return error('invalid_parameter', 'ID pendaftaran diperlukan', 400, requestId)
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return error('invalid_body', 'Payload JSON tidak valid', 400, requestId)
  }

  const action = body?.action
  if (!['tes', 'lulus', 'daftar_ulang'].includes(action)) {
    return error('invalid_action', 'Action SPMB tidak valid', 400, requestId)
  }

  const admin = createAdminClient()
  const { data: detail } = await admin
    .from('siswa_detail')
    .select('siswa_id,departemen_id,tahun_ajaran_id')
    .eq('pendaftaran_id', pendaftaranId)
    .maybeSingle()

  if (!detail) {
    return error('not_found', 'Pendaftaran tidak ditemukan', 404, requestId)
  }

  const { data, error: rpcError } = await admin.rpc('spmb_mark_milestone', {
    p_siswa_id: detail.siswa_id,
    p_action: action,
  })

  if (rpcError) {
    return error('business_rule_failed', rpcError.message, 400, requestId)
  }

  return json({
    data: {
      pendaftaran_id: pendaftaranId,
      action,
      marked_at: data,
    },
    request_id: requestId,
  })
}
