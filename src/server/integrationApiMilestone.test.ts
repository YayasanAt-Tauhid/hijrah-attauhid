import { beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { handleMilestoneUpdate } from './integrationApiMilestone'

const { createAdminClient } = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('./supabase', () => ({ createAdminClient }))
const pid = '00000000-0000-4000-8000-000000000001'
const sid = '00000000-0000-4000-8000-000000000002'
let app: any, token: any, detail: any, student: any, db: any
let auditError: any, queryError: any, workflowError: any
let audits: any[]
const markedAt = '2026-09-17T00:00:00Z'
function request(body: unknown = { action: 'tes' }, authorization = 'Bearer test-token') {
  return new Request(`https://example.test/api/v1/pendaftaran/${pid}/milestone`, {
    method: 'POST', headers: { authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  app = { id: 'integration-id', active: true, scopes: ['pendaftaran:milestone:update'], department_ids: ['dept'], academic_year_ids: ['year'] }
  token = { id: 'token-id', integration_id: app.id }
  detail = { siswa_id: sid, tahun_ajaran_id: 'year' }
  student = { departemen_id: 'dept' }
  auditError = queryError = workflowError = null
  audits = []
  db = {
    from: vi.fn((table: string) => {
      const q: any = {
        select: vi.fn(() => q), eq: vi.fn(() => q), update: vi.fn(() => q),
        maybeSingle: vi.fn(async () => ({ data: ({ integration_apps: app, integration_tokens: token, siswa_detail: detail, siswa: student } as any)[table], error: table === 'siswa_detail' ? queryError : null })),
        insert: vi.fn(async (row: any) => { if (table === 'integration_audit_log') audits.push(row); return { error: table === 'integration_audit_log' ? auditError : null } }),
      }
      return q
    }),
    rpc: vi.fn(async (name: string) => name === 'integration_rate_limit_hit'
      ? { data: [{ allowed: true }] } : { data: workflowError ? null : markedAt, error: workflowError }),
  }
  createAdminClient.mockReturnValue(db)
})
const mutations = () => db.rpc.mock.calls.filter(([name]: string[]) => name === 'spmb_mark_milestone')
describe('SPMB milestone write authorization and workflow', () => {
  it('rejects a valid read-only token with 403 before accessing student data', async () => {
    app.scopes = ['pendaftaran:read']
    const res = await handleMilestoneUpdate(request(), pid)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('forbidden')
    expect(mutations()).toHaveLength(0)
    expect(db.from).not.toHaveBeenCalledWith('siswa_detail')
  })
  it.each(['missing', 'revoked', 'expired', 'inactive'])('rejects %s credentials', async (kind) => {
    if (kind === 'revoked') token.revoked_at = markedAt
    if (kind === 'expired') token.expires_at = '2020-01-01'
    if (kind === 'inactive') app.active = false
    expect((await handleMilestoneUpdate(request(undefined, kind === 'missing' ? '' : 'Bearer test-token'), pid)).status).toBe(401)
    expect(mutations()).toHaveLength(0)
  })
  it.each(['unit', 'year', 'null-unit', 'null-year'])('rejects records outside %s restrictions', async (kind) => {
    if (kind === 'unit') student.departemen_id = 'other'
    if (kind === 'year') detail.tahun_ajaran_id = 'other'
    if (kind === 'null-unit') student.departemen_id = null
    if (kind === 'null-year') detail.tahun_ajaran_id = null
    expect((await handleMilestoneUpdate(request(), pid)).status).toBe(404)
    expect(mutations()).toHaveLength(0)
  })
  it.each(['tes', 'lulus', 'tidak_lulus'])('delegates %s to the existing workflow and records audit', async (action) => {
    const res = await handleMilestoneUpdate(request({ action }), pid)
    expect(res.status).toBe(200)
    expect(mutations()).toEqual([['spmb_mark_milestone', { p_siswa_id: sid, p_action: action }]])
    expect((await res.json()).data).toEqual({ pendaftaran_id: pid, action, marked_at: markedAt })
    expect(audits.map(x => x.action)).toEqual(['milestone_requested', 'milestone_updated'])
    expect(audits[1].metadata).toMatchObject({ token_id: token.id, pendaftaran_id: pid, milestone: action, marked_at: markedAt })
    expect(res.headers.get('X-Request-ID')).toBeTruthy()
  })
  it.each(['lulus', 'tidak_lulus'])('propagates workflow rejection for premature %s', async (action) => {
    workflowError = { code: 'P0001', message: 'Prasyarat belum terpenuhi' }
    const res = await handleMilestoneUpdate(request({ action }), pid)
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('business_rule_failed')
    expect(audits.at(-1).action).toBe('milestone_failed')
  })
  it('returns the existing timestamp unchanged on repeated requests', async () => {
    const first = await (await handleMilestoneUpdate(request(), pid)).json()
    const repeated = await (await handleMilestoneUpdate(request(), pid)).json()
    expect(repeated.data).toEqual(first.data)
  })
  it.each([null, [], {}, { action: 'daftar_ulang' }, { action: 'hapus' }, { action: 'tes', nik: '123' }, { action: 'tes', kelas_id: sid }])('rejects invalid or expanded payload %j', async (body) => {
    expect((await handleMilestoneUpdate(request(body), pid)).status).toBe(400)
    expect(mutations()).toHaveLength(0)
  })
  it('rejects malformed JSON and invalid IDs', async () => {
    expect((await handleMilestoneUpdate(new Request('https://example.test', { method: 'POST', headers: { authorization: 'Bearer test-token' }, body: '{' }), pid)).status).toBe(400)
    expect((await handleMilestoneUpdate(request(), 'not-a-uuid')).status).toBe(400)
    expect(mutations()).toHaveLength(0)
  })
  it('does not write when initial audit storage fails', async () => {
    auditError = { message: 'database unavailable' }
    expect((await handleMilestoneUpdate(request(), pid)).status).toBe(503)
    expect(mutations()).toHaveLength(0)
  })
  it('does not disguise a database lookup failure as not found', async () => {
    queryError = { message: 'private SQL error' }
    const res = await handleMilestoneUpdate(request(), pid)
    expect(res.status).toBe(503)
    expect(await res.text()).not.toContain('private SQL')
    expect(mutations()).toHaveLength(0)
  })
})
