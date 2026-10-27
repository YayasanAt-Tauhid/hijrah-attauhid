import { beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Klien Supabase tiruan yang sama dengan integrationApi.asrama.test.ts: memproyeksikan kolom
// sesuai string select, sehingga kolom yang tidak diminta oleh API tidak akan muncul di hasil.
type Cell = string | number | boolean | null | undefined | string[]
type Row = Record<string, Cell>
interface FakeQuery {
  select(c: string): FakeQuery
  eq(k: string, v: Cell): FakeQuery
  neq(k: string, v: Cell): FakeQuery
  in(k: string, vs: Cell[]): FakeQuery
  not(k: string, op: string, v: Cell): FakeQuery
  is(k: string, v: Cell): FakeQuery
  gt(k: string, v: Cell): FakeQuery
  gte(k: string, v: Cell): FakeQuery
  lte(k: string, v: Cell): FakeQuery
  order(k: string, opts?: { ascending?: boolean }): FakeQuery
  limit(n: number): FakeQuery
  maybeSingle(): FakeQuery
  update(): FakeQuery
  insert(): FakeQuery
  then(onOk?: (v: unknown) => unknown, onErr?: (e: unknown) => unknown): Promise<unknown>
}
const state = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, scopes: [] as string[] }))
vi.mock('./supabase', () => ({
  createAdminClient: () => ({
    rpc: async (name: string) => ({ data: name === 'integration_rate_limit_hit' ? [{ allowed: true }] : [{ status: 'paid' }], error: null }),
    from: (table: string) => {
      let rows = [...(state.tables[table] || [])], columns = '*', single = false
      const num = (x: Cell) => x as number
      const q: FakeQuery = {
        select(c) { columns = c; return q },
        eq(k, v) { rows = rows.filter(r => r[k] === v); return q },
        neq(k, v) { rows = rows.filter(r => r[k] !== v); return q },
        in(k, vs) { rows = rows.filter(r => vs.includes(r[k])); return q },
        not(k, _op, v) { rows = rows.filter(r => r[k] != v); return q },
        is(k, v) { rows = rows.filter(r => r[k] == v); return q },
        gt(k, v) { rows = rows.filter(r => num(r[k]) > num(v)); return q },
        gte(k, v) { rows = rows.filter(r => num(r[k]) >= num(v)); return q },
        lte(k, v) { rows = rows.filter(r => num(r[k]) <= num(v)); return q },
        order(k, opts) { rows.sort((a, b) => String(a[k]).localeCompare(String(b[k])) * (opts?.ascending === false ? -1 : 1)); return q },
        limit(n) { rows = rows.slice(0, n); return q },
        maybeSingle() { single = true; return q },
        update() { return q }, insert() { return q },
        then(onOk, onErr) {
          const data = rows.map(r => columns === '*' ? r : Object.fromEntries(columns.split(',').map(k => [k, r[k]])))
          return Promise.resolve({ data: single ? data[0] || null : data, error: null }).then(onOk, onErr)
        },
      }
      return q
    },
  }),
}))
import { handleClassStudents, handleDetail, handleList, handleSync } from './integrationApi'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const req = (path: string) => new Request('https://example.test/api/v1/' + path, { headers: { Authorization: 'Bearer test-token' } })
// Siswa 1 dan 4 punya ID Santri; siswa 2 berisi null; siswa 3 tidak memuat kuncinya sama sekali.
const ID_SANTRI: Record<number, string | null | undefined> = { 1: '21.01.001', 2: null, 3: undefined, 4: '21.01.004' }
const EXPECTED = ['21.01.001', null, null, '21.01.004']

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  state.scopes = ['siswa:read', 'kelas:read', 'pendaftaran:read']
  state.tables = {
    integration_tokens: [{ id: id(90), integration_id: id(91), token_hash: createHash('sha256').update('test-token').digest('hex') }],
    integration_apps: [{ id: id(91), active: true, scopes: state.scopes, department_ids: [], academic_year_ids: [] }],
    siswa: [1, 2, 3, 4].map(n => ({
      id: id(n), nis: String(n), nisn: 'private-nisn', nama: 'Student ' + n, status: 'aktif', departemen_id: id(10),
      ...(ID_SANTRI[n] === undefined ? {} : { id_santri_pihak3: ID_SANTRI[n] }),
    })),
    siswa_detail: [1, 2, 3].map(n => ({ siswa_id: id(n), pendaftaran_id: id(n + 20), tahun_ajaran_id: id(11), status_asrama: null, nik: 'private-nik', nik_dapodik: 'private-dapodik' })),
    kelas: [{ id: id(12), nama: '7A', departemen_id: id(10), aktif: true }],
    kelas_siswa: [1, 2, 3, 4].map(n => ({ siswa_id: id(n), kelas_id: id(12), tahun_ajaran_id: id(11), aktif: true })),
    integration_change_log: [1, 2, 3, 4].map(n => ({ seq: n, object_type: 'siswa', object_id: id(n), change_type: 'upsert', department_id: id(10), academic_year_id: id(11), changed_at: new Date().toISOString() })),
  }
})

describe('Integration API: id_santri_pihak3 pada data siswa', () => {
  it('muncul di daftar siswa dengan scope siswa:read saja; null bila kosong atau tidak ada', async () => {
    const r = await handleList(req('siswa'), 'siswa'); expect(r.status).toBe(200)
    const { data } = await r.json()
    expect(data.map((x: { id_santri_pihak3?: unknown }) => x.id_santri_pihak3)).toEqual(EXPECTED)
    for (const x of data) expect(x).toHaveProperty('id_santri_pihak3')
  })

  it.each([[1, '21.01.001'], [2, null], [3, null], [4, '21.01.004']])('muncul di detail siswa %s', async (n, expected) => {
    const r = await handleDetail(req('siswa/' + id(n as number)), 'siswa', id(n as number))
    expect(r.status).toBe(200)
    const { data } = await r.json()
    expect(data).toHaveProperty('id_santri_pihak3')
    expect(data.id_santri_pihak3).toBe(expected)
  })

  it('muncul di anggota kelas', async () => {
    const r = await handleClassStudents(req('kelas/' + id(12) + '/siswa'), id(12)); expect(r.status).toBe(200)
    const { data } = await r.json()
    expect(data.map((x: { id_santri_pihak3?: unknown }) => x.id_santri_pihak3)).toEqual(EXPECTED)
    for (const x of data) expect(x).toHaveProperty('id_santri_pihak3')
  })

  it('muncul di sinkronisasi incremental siswa', async () => {
    const r = await handleSync(req('sync/siswa'), 'siswa'); expect(r.status).toBe(200)
    const { data } = await r.json()
    expect(data.map((x: { data: { id_santri_pihak3?: unknown } }) => x.data.id_santri_pihak3)).toEqual(EXPECTED)
    for (const x of data) expect(x.data).toHaveProperty('id_santri_pihak3')
  })

  it('tidak menambah field identitas lain dan tidak membuka NISN/NIK tanpa scope identitas pada daftar', async () => {
    const { data } = await (await handleList(req('siswa'), 'siswa')).json()
    for (const x of data) { expect(x).not.toHaveProperty('nisn'); expect(x).not.toHaveProperty('nik_hijrah'); expect(x).not.toHaveProperty('nik_dapodik') }
  })

  it('tidak muncul pada payload pendaftaran (calon siswa)', async () => {
    const r = await handleList(req('pendaftaran'), 'pendaftaran'); expect(r.status).toBe(200)
    const { data } = await r.json()
    expect(data.length).toBeGreaterThan(0)
    for (const x of data) { expect(x).not.toHaveProperty('id_santri_pihak3'); expect(JSON.stringify(x)).not.toContain('21.01.001') }
  })

  it('tetap 403 tanpa scope siswa:read', async () => {
    state.scopes.splice(0, state.scopes.length, 'pendaftaran:read')
    expect((await handleList(req('siswa'), 'siswa')).status).toBe(403)
  })
})

describe('Dokumentasi API memuat id_santri_pihak3', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
  const files = ['integration-api.md', 'openapi-integration-v1.yaml']

  it('dijelaskan di markdown dan OpenAPI, bukan sebagai id_santri', () => {
    expect(read('docs/integration-api.md')).toContain('id_santri_pihak3')
    const openapi = read('docs/openapi-integration-v1.yaml')
    expect(openapi).toMatch(/^\s+id_santri_pihak3: \{/m)
    expect(openapi).not.toMatch(/^\s+id_santri: /m)
  })

  it.each(files)('salinan public/docs/%s identik dengan docs/', (name) => {
    expect(read('public/docs/' + name)).toBe(read('docs/' + name))
  })
})
