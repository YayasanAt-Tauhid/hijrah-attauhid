import { createServerFn } from '@tanstack/react-start'
import { authMiddleware, requireContext, requireRole } from './auth'
import { createAdminClient } from './supabase'

const ALLOWED = [
  'pendaftaran:read',
  'pendaftaran:identity:read',
  'pendaftaran:contact:read',
  'pendaftaran:sensitive:read',
  'pendaftaran:documents:read',
  'siswa:read',
  'siswa:identity:read',
  'kelas:read',
  'pegawai:read',
  'pegawai:contact:read',
  'pegawai:write',
  'pendaftaran:milestone:update',
] as const

const WEBHOOK_EVENTS = ['pendaftaran', 'siswa', 'kelas', 'dokumen'] as const

async function hash(v: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('')
}

function token() {
  const a = new Uint8Array(32)
  crypto.getRandomValues(a)
  return 'hat_live_' + [...a].map(x => x.toString(16).padStart(2, '0')).join('')
}

async function adminCtx(context: unknown) {
  const c = requireContext(context)
  const db = createAdminClient()
  await requireRole(db, c.userId, ['admin'])
  return { c, db }
}

function validateScopes(scopes: string[]) {
  if (scopes.some(x => !(ALLOWED as readonly string[]).includes(x))) throw new Error('Scope tidak valid')
  const registrationReadDependent = [
    'pendaftaran:identity:read',
    'pendaftaran:contact:read',
    'pendaftaran:sensitive:read',
    'pendaftaran:documents:read',
  ]
  if (registrationReadDependent.some(scope => scopes.includes(scope)) && !scopes.includes('pendaftaran:read')) {
    throw new Error('Scope identitas/kontak/sensitif/dokumen memerlukan pendaftaran:read')
  }
  if (scopes.includes('siswa:identity:read') && !scopes.includes('siswa:read')) {
    throw new Error('Scope identitas siswa memerlukan siswa:read')
  }
}

function validateWebhookUrl(raw: string) {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('URL webhook tidak valid')
  }
  if (url.protocol !== 'https:') throw new Error('Webhook wajib menggunakan HTTPS')
  if (url.username || url.password) throw new Error('Webhook tidak boleh memuat username/password pada URL')
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error('Host webhook lokal/private tidak diizinkan')
  }
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) {
    throw new Error('Alamat IPv6 private tidak diizinkan')
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (m) {
    const octets = m.slice(1).map(Number)
    if (octets.some(n => n > 255)) throw new Error('Alamat IP webhook tidak valid')
    const [a, b] = octets
    if (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) throw new Error('Alamat IP private tidak diizinkan')
  }
  return url.toString()
}

function validateWebhookEvents(events: string[]) {
  const unique = [...new Set(events)]
  if (!unique.length || unique.some(x => !(WEBHOOK_EVENTS as readonly string[]).includes(x))) {
    throw new Error('Event webhook tidak valid')
  }
  return unique
}

export const listIntegrationOptions = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { db } = await adminCtx(context)
    const [{ data: departments, error: de }, { data: years, error: ye }] = await Promise.all([
      db.from('departemen').select('id,nama,kode').eq('aktif', true).order('nama'),
      db.from('tahun_ajaran').select('id,nama,aktif').order('nama', { ascending: false }),
    ])
    if (de) throw de
    if (ye) throw ye
    return { departments: departments || [], academicYears: years || [] }
  })

export const listIntegrations = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { db } = await adminCtx(context)
    const { data, error } = await (db.from('integration_apps') as any)
      .select('id,name,active,scopes,department_ids,academic_year_ids,expires_at,created_at,updated_at,last_used_at,integration_tokens(id,token_prefix,expires_at,revoked_at,created_at,last_used_at),integration_webhooks(id,url,active,event_types,last_success_at,last_failure_at,last_error,updated_at)')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data || []
  })

export const listIntegrationUsageSummaries = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { db } = await adminCtx(context)
    const { data: apps, error } = await db.from('integration_apps').select('id')
    if (error) throw error
    const pairs = await Promise.all((apps || []).map(async app => {
      const { data, error: usageError } = await (db.rpc as any)('integration_usage_summary', { p_integration_id: app.id })
      if (usageError) throw usageError
      return [app.id, Array.isArray(data) ? data[0] : data] as const
    }))
    return Object.fromEntries(pairs)
  })

export const createIntegration = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((x: { name: string; scopes: string[]; department_ids?: string[]; academic_year_ids?: string[]; expires_at?: string | null }) => x)
  .handler(async ({ data, context }) => {
    const { c, db } = await adminCtx(context)
    const scopes = [...new Set(data.scopes || [])]
    if (!data.name?.trim()) throw new Error('Nama integrasi wajib diisi')
    validateScopes(scopes)
    const { data: i, error } = await (db.from('integration_apps') as any)
      .insert({
        name: data.name.trim(),
        scopes,
        department_ids: data.department_ids || [],
        academic_year_ids: data.academic_year_ids || [],
        expires_at: data.expires_at || null,
        created_by: c.userId,
      })
      .select('id')
      .single()
    if (error) throw error
    const raw = token()
    const prefix = raw.slice(0, 16)
    const { error: tokenError } = await (db.from('integration_tokens') as any).insert({
      integration_id: i.id,
      token_prefix: prefix,
      token_hash: await hash(raw),
      expires_at: data.expires_at || null,
      created_by: c.userId,
    })
    if (tokenError) throw tokenError
    await (db.from('integration_audit_log') as any).insert({
      integration_id: i.id,
      actor_id: c.userId,
      action: 'created',
      metadata: {
        scopes,
        department_ids: data.department_ids || [],
        academic_year_ids: data.academic_year_ids || [],
        expires_at: data.expires_at || null,
      },
    })
    return { id: i.id, token: raw, prefix }
  })

export const updateIntegration = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((x: { id: string; active?: boolean; scopes?: string[]; department_ids?: string[]; academic_year_ids?: string[]; expires_at?: string | null }) => x)
  .handler(async ({ data, context }) => {
    const { c, db } = await adminCtx(context)
    if (data.scopes) validateScopes(data.scopes)
    const { data: before } = await (db.from('integration_apps') as any)
      .select('active,scopes,department_ids,academic_year_ids,expires_at')
      .eq('id', data.id)
      .maybeSingle()
    if (!before) throw new Error('Integrasi tidak ditemukan')
    const patch: any = { updated_at: new Date().toISOString() }
    for (const k of ['active', 'scopes', 'department_ids', 'academic_year_ids', 'expires_at'] as const) {
      if (data[k] !== undefined) patch[k] = data[k]
    }
    const { error } = await (db.from('integration_apps') as any).update(patch).eq('id', data.id)
    if (error) throw error
    await (db.from('integration_audit_log') as any).insert({
      integration_id: data.id,
      actor_id: c.userId,
      action: 'updated',
      metadata: { before, after: { ...before, ...patch } },
    })
    return { success: true }
  })

export const rotateIntegrationToken = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((x: { id: string }) => x)
  .handler(async ({ data, context }) => {
    const { c, db } = await adminCtx(context)
    const { data: i } = await (db.from('integration_apps') as any)
      .select('id,expires_at')
      .eq('id', data.id)
      .single()
    if (!i) throw new Error('Integrasi tidak ditemukan')
    await (db.from('integration_tokens') as any)
      .update({ revoked_at: new Date().toISOString() })
      .eq('integration_id', data.id)
      .is('revoked_at', null)
    const raw = token()
    await (db.from('integration_tokens') as any).insert({
      integration_id: data.id,
      token_prefix: raw.slice(0, 16),
      token_hash: await hash(raw),
      expires_at: i.expires_at,
      created_by: c.userId,
    })
    await (db.from('integration_audit_log') as any).insert({
      integration_id: data.id,
      actor_id: c.userId,
      action: 'token_rotated',
    })
    return { token: raw, prefix: raw.slice(0, 16) }
  })

export const revokeIntegrationTokens = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((x: { id: string }) => x)
  .handler(async ({ data, context }) => {
    const { c, db } = await adminCtx(context)
    await (db.from('integration_tokens') as any)
      .update({ revoked_at: new Date().toISOString() })
      .eq('integration_id', data.id)
      .is('revoked_at', null)
    await (db.from('integration_audit_log') as any).insert({
      integration_id: data.id,
      actor_id: c.userId,
      action: 'tokens_revoked',
    })
    return { success: true }
  })

export const configureIntegrationWebhook = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((x: { id: string; url: string; active: boolean; event_types: string[]; rotate_secret?: boolean }) => x)
  .handler(async ({ data, context }) => {
    const { c, db } = await adminCtx(context)
    const url = validateWebhookUrl(data.url)
    const eventTypes = validateWebhookEvents(data.event_types)
    const { data: result, error } = await (db.rpc as any)('integration_configure_webhook', {
      p_integration_id: data.id,
      p_url: url,
      p_event_types: eventTypes,
      p_active: !!data.active,
      p_rotate_secret: !!data.rotate_secret,
    })
    if (error) throw error
    const row = Array.isArray(result) ? result[0] : result
    await (db.from('integration_audit_log') as any).insert({
      integration_id: data.id,
      actor_id: c.userId,
      action: data.rotate_secret ? 'webhook_secret_rotated' : 'webhook_configured',
      metadata: { url, active: !!data.active, event_types: eventTypes },
    })
    return row || { webhook_id: null, signing_secret: null }
  })

export const testIntegrationWebhook = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((x: { id: string }) => x)
  .handler(async ({ data, context }) => {
    const { c, db } = await adminCtx(context)
    const { data: eventId, error } = await (db.rpc as any)('integration_enqueue_webhook_test', {
      p_integration_id: data.id,
    })
    if (error) throw error
    await (db.from('integration_audit_log') as any).insert({
      integration_id: data.id,
      actor_id: c.userId,
      action: 'webhook_test_queued',
      metadata: { event_id: eventId },
    })
    return { event_id: eventId }
  })
