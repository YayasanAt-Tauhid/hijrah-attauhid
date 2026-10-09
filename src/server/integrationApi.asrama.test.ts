import { beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto, createHash } from 'node:crypto'
const state = vi.hoisted(() => ({ tables: {} as Record<string, any[]>, scopes: [] as string[], departments: [] as string[], years: [] as string[], detailError: false }))
vi.mock('./supabase', () => ({
  createAdminClient: () => ({
    rpc: async (name: string) => ({ data: name === 'integration_rate_limit_hit' ? [{ allowed: true }] : [{ status: 'paid' }], error: null }),
    from: (table: string) => {
      let rows = [...(state.tables[table] || [])], columns = '*', single = false
      const q: any = {
        select(c: string) { columns = c; return q },
        eq(k: string, v: any) { rows = rows.filter(r => r[k] === v); return q },
        neq(k: string, v: any) { rows = rows.filter(r => r[k] !== v); return q },
        in(k: string, vs: any[]) { rows = rows.filter(r => vs.includes(r[k])); return q },
        not(k: string, _op: string, v: any) { rows = rows.filter(r => r[k] != v); return q },
        is(k: string, v: any) { rows = rows.filter(r => r[k] == v); return q },
        gt(k: string, v: any) { rows = rows.filter(r => r[k] > v); return q },
        gte(k: string, v: any) { rows = rows.filter(r => r[k] >= v); return q },
        lte(k: string, v: any) { rows = rows.filter(r => r[k] <= v); return q },
        order(k: string, opts?: any) { rows.sort((a, b) => String(a[k]).localeCompare(String(b[k])) * (opts?.ascending === false ? -1 : 1)); return q },
        limit(n: number) { rows = rows.slice(0, n); return q },
        maybeSingle() { single = true; return q },
        update() { return q }, insert() { return q },
        then(resolve: any, reject: any) {
          const data = rows.map(r => columns === '*' ? r : Object.fromEntries(columns.split(',').map(k => [k, r[k]])))
          return Promise.resolve({ data: single ? data[0] || null : data, error: table === 'siswa_detail' && state.detailError ? { message: 'unavailable' } : null }).then(resolve, reject)
        },
      }
      return q
    },
  }),
}))
import { handleClassStudents, handleDetail, handleList, handleSync } from './integrationApi'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const req = (path: string) => new Request('https://example.test/api/v1/' + path, { headers: { Authorization: 'Bearer test-token' } })
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  state.scopes = ['siswa:read', 'kelas:read', 'pendaftaran:read']
  state.departments = []; state.years = []; state.detailError = false
  state.tables = {
    integration_tokens: [{ id: id(90), integration_id: id(91), token_hash: createHash('sha256').update('test-token').digest('hex') }],
    integration_apps: [{ id: id(91), active: true, scopes: state.scopes, department_ids: state.departments, academic_year_ids: state.years }],
    siswa: [1, 2, 3, 4].map(n => ({ id: id(n), nis: String(n), nisn: 'private-nisn', nama: 'Student ' + n, status: 'aktif', departemen_id: id(10) })),
    siswa_detail: [1, 2, 3].map((n, i) => ({ siswa_id: id(n), pendaftaran_id: id(n + 20), tahun_ajaran_id: id(11), status_asrama: ['asrama', 'non_asrama', null][i], nik: 'private-nik', nik_dapodik: 'private-dapodik' })),
    kelas: [{ id: id(12), nama: '7A', departemen_id: id(10), aktif: true }],
    kelas_siswa: [1, 2, 3, 4].map(n => ({ siswa_id: id(n), kelas_id: id(12), tahun_ajaran_id: id(11), aktif: true })),
    integration_change_log: [1, 2, 3, 4].map(n => ({ seq: n, object_type: 'siswa', object_id: id(n), change_type: 'upsert', department_id: id(10), academic_year_id: id(11), changed_at: new Date().toISOString() })),
  }
})
describe('Integration boarding status responses', () => {
  it('lists all boarding states without requiring identity scope', async () => {
    const r = await handleList(req('siswa'), 'siswa'); expect(r.status).toBe(200)
    const { data } = await r.json()
    expect(data.map((x: any) => x.status_asrama)).toEqual(['Asrama', 'Non Asrama', null, null])
    for (const x of data) { expect(x).not.toHaveProperty('nik_hijrah'); expect(x).not.toHaveProperty('nisn') }
  })
  it.each([[1, 'Asrama'], [2, 'Non Asrama'], [3, null], [4, null]])('returns boarding state for student %s', async (n, status) => {
    const r = await handleDetail(req('siswa/' + id(n as number)), 'siswa', id(n as number))
    expect(r.status).toBe(200); expect((await r.json()).data.status_asrama).toBe(status)
  })
  it('returns class members with boarding status and preserves scoped identity', async () => {
    let r = await handleClassStudents(req('kelas/' + id(12) + '/siswa'), id(12))
    expect((await r.json()).data.map((x: any) => x.status_asrama)).toEqual(['Asrama', 'Non Asrama', null, null])
    state.scopes.push('siswa:identity:read')
    r = await handleClassStudents(req('kelas/' + id(12) + '/siswa'), id(12))
    expect((await r.json()).data[0]).toMatchObject({ status_asrama: 'Asrama', nik_hijrah: 'private-nik', nisn: 'private-nisn' })
  })
  it.each([[21, 'Asrama'], [22, 'Non Asrama'], [23, null]])('uses the same enum for registration %s', async (n, status) => {
    const r = await handleDetail(req('pendaftaran/' + id(n as number)), 'pendaftaran', id(n as number))
    expect(r.status).toBe(200); expect((await r.json()).data.status_asrama).toBe(status)
  })
  it('uses the new enum on registration lists', async () => {
    const r = await handleList(req('pendaftaran'), 'pendaftaran')
    expect(r.status).toBe(200); expect((await r.json()).data.map((x: any) => x.status_asrama)).toEqual(['Asrama', 'Non Asrama', null])
  })
  it('includes boarding status in student incremental sync', async () => {
    const r = await handleSync(req('sync/siswa'), 'siswa')
    expect(r.status).toBe(200); expect((await r.json()).data.map((x: any) => x.data.status_asrama)).toEqual(['Asrama', 'Non Asrama', null, null])
  })
  it('keeps department and year restrictions for student and class reads', async () => {
    state.departments.push(id(99))
    expect((await handleDetail(req('siswa/' + id(1)), 'siswa', id(1))).status).toBe(404)
    expect((await handleClassStudents(req('kelas/' + id(12) + '/siswa'), id(12))).status).toBe(404)
    expect((await (await handleList(req('siswa'), 'siswa')).json()).data).toEqual([])
    state.departments.pop(); state.years.push(id(99))
    expect((await handleDetail(req('siswa/' + id(1)), 'siswa', id(1))).status).toBe(404)
    expect((await (await handleClassStudents(req('kelas/' + id(12) + '/siswa'), id(12))).json()).data).toEqual([])
  })
  it('does not report null asrama on failed database lookups', async () => {
    state.detailError = true
    expect((await handleDetail(req('siswa/' + id(1)), 'siswa', id(1))).status).toBe(503)
    expect((await handleClassStudents(req('kelas/' + id(12) + '/siswa'), id(12))).status).toBe(503)
  })
  it('keeps student reads behind explicit scopes', async () => {
    state.scopes.splice(0, state.scopes.length, 'pendaftaran:read')
    expect((await handleList(req('siswa'), 'siswa')).status).toBe(403)
    expect((await handleClassStudents(req('kelas/' + id(12) + '/siswa'), id(12))).status).toBe(403)
  })
})
