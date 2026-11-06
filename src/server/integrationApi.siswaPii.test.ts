import { beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Kontrak data pribadi siswa pada detail dan sinkronisasi incremental:
// - siswa:read saja TIDAK menerima NISN, NIK, alamat, telepon, email, tempat/tanggal lahir, agama.
// - siswa:read + siswa:identity:read menerima semuanya persis seperti sebelum perbaikan (tanpa perubahan).
// Klien Supabase tiruan sama dengan integrationApi.idSantri.test.ts: memproyeksikan kolom
// sesuai string select, sehingga yang tampil hanya kolom yang diminta oleh API.
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

// Nilai pribadi di fixture sengaja khas agar mudah dicari bila bocor ke respons.
const PRIVATE = {
  nisn: 'private-nisn',
  tempat_lahir: 'private-kota',
  tanggal_lahir: '2010-01-02',
  agama: 'private-agama',
  alamat: 'private-alamat',
  telepon: 'private-telepon',
  email: 'private@example.test',
}
const NIK = { nik_hijrah: 'private-nik', nik_dapodik: 'private-dapodik' }
const PRIVATE_VALUES = [...Object.values(PRIVATE), ...Object.values(NIK)]

// Field yang boleh dilihat klien siswa:read saja (detail menambah kelas_aktif).
const PUBLIC_KEYS = [
  'id', 'nis', 'id_santri_pihak3', 'nama', 'jenis_kelamin', 'status', 'angkatan_id',
  'created_at', 'departemen_id', 'terverifikasi', 'status_asrama',
]
// Tambahan untuk klien yang juga punya siswa:identity:read: identik dengan keadaan sebelum perbaikan.
const IDENTITY_KEYS = [
  'nisn', 'nik_hijrah', 'nik_dapodik', 'tempat_lahir', 'tanggal_lahir', 'agama', 'alamat', 'telepon', 'email',
]
const sorted = (keys: string[]) => [...keys].sort()

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  state.scopes = ['siswa:read', 'kelas:read']
  state.tables = {
    integration_tokens: [{ id: id(90), integration_id: id(91), token_hash: createHash('sha256').update('test-token').digest('hex') }],
    integration_apps: [{ id: id(91), active: true, scopes: state.scopes, department_ids: [], academic_year_ids: [] }],
    siswa: [{
      id: id(1), nis: '1', id_santri_pihak3: '21.01.001', nama: 'Student 1', jenis_kelamin: 'L', status: 'aktif',
      angkatan_id: id(13), created_at: '2026-01-01T00:00:00Z', departemen_id: id(10), terverifikasi: true, ...PRIVATE,
    }],
    siswa_detail: [{ siswa_id: id(1), pendaftaran_id: id(21), tahun_ajaran_id: id(11), status_asrama: null, nik: NIK.nik_hijrah, nik_dapodik: NIK.nik_dapodik }],
    kelas: [{ id: id(12), nama: '7A', departemen_id: id(10), aktif: true }],
    kelas_siswa: [{ siswa_id: id(1), kelas_id: id(12), tahun_ajaran_id: id(11), aktif: true }],
    integration_change_log: [{ seq: 1, object_type: 'siswa', object_id: id(1), change_type: 'upsert', department_id: id(10), academic_year_id: id(11), changed_at: new Date().toISOString() }],
  }
})

const useScopes = (...scopes: string[]) => { state.scopes.splice(0, state.scopes.length, ...scopes) }
const detail = async () => {
  const r = await handleDetail(req('siswa/' + id(1)), 'siswa', id(1)); expect(r.status).toBe(200)
  return { body: await r.json() }
}
const sync = async () => {
  const r = await handleSync(req('sync/siswa'), 'siswa'); expect(r.status).toBe(200)
  return (await r.json()).data[0].data as Record<string, unknown>
}

describe('Detail siswa: data pribadi hanya dengan siswa:identity:read', () => {
  it('siswa:read saja: hanya field publik yang diizinkan (set persis)', async () => {
    const { body } = await detail()
    expect(sorted(Object.keys(body.data))).toEqual(sorted([...PUBLIC_KEYS, 'kelas_aktif']))
  })

  it('siswa:read saja: tidak ada nilai pribadi di mana pun dalam respons', async () => {
    const r = await handleDetail(req('siswa/' + id(1)), 'siswa', id(1))
    const text = JSON.stringify(await r.json())
    for (const v of PRIVATE_VALUES) expect(text).not.toContain(v)
  })

  it('siswa:read saja: field publik tetap benar nilainya', async () => {
    const { body } = await detail()
    expect(body.data).toMatchObject({ id: id(1), nis: '1', id_santri_pihak3: '21.01.001', nama: 'Student 1', jenis_kelamin: 'L', status: 'aktif', status_asrama: null })
    expect(body.data.kelas_aktif).toHaveLength(1)
  })

  it('dengan siswa:identity:read: semua field seperti sebelum perbaikan (tanpa perubahan)', async () => {
    useScopes('siswa:read', 'siswa:identity:read', 'kelas:read')
    const { body } = await detail()
    expect(sorted(Object.keys(body.data))).toEqual(sorted([...PUBLIC_KEYS, ...IDENTITY_KEYS, 'kelas_aktif']))
    expect(body.data).toMatchObject({ ...PRIVATE, ...NIK })
  })
})

describe('Sinkronisasi siswa: data pribadi hanya dengan siswa:identity:read', () => {
  it('siswa:read saja: hanya field publik yang diizinkan (set persis)', async () => {
    const data = await sync()
    expect(sorted(Object.keys(data))).toEqual(sorted(PUBLIC_KEYS))
  })

  it('siswa:read saja: tidak ada nilai pribadi di mana pun dalam respons', async () => {
    const r = await handleSync(req('sync/siswa'), 'siswa')
    const text = JSON.stringify(await r.json())
    for (const v of PRIVATE_VALUES) expect(text).not.toContain(v)
  })

  it('dengan siswa:identity:read: semua field seperti sebelum perbaikan (tanpa perubahan)', async () => {
    useScopes('siswa:read', 'siswa:identity:read', 'kelas:read')
    const data = await sync()
    expect(sorted(Object.keys(data))).toEqual(sorted([...PUBLIC_KEYS, ...IDENTITY_KEYS]))
    expect(data).toMatchObject({ ...PRIVATE, ...NIK })
  })

  it('perubahan yang keluar scope tetap scope_exit, bukan bocor data', async () => {
    state.tables.siswa[0].status = 'calon'
    const r = await handleSync(req('sync/siswa'), 'siswa')
    const body = await r.json()
    expect(body.data[0].change).toBe('scope_exit')
    expect(body.data[0].data).toBeNull()
  })
})

describe('Daftar dan anggota kelas tidak berubah', () => {
  it.each([
    ['siswa:read saja', ['siswa:read', 'kelas:read']],
    ['dengan siswa:identity:read', ['siswa:read', 'siswa:identity:read', 'kelas:read']],
  ])('daftar siswa tidak memuat tempat/tanggal lahir, agama, alamat, telepon, email (%s)', async (_label, scopes) => {
    useScopes(...(scopes as string[]))
    const { data } = await (await handleList(req('siswa'), 'siswa')).json()
    for (const x of data) for (const k of ['tempat_lahir', 'tanggal_lahir', 'agama', 'alamat', 'telepon', 'email']) expect(x).not.toHaveProperty(k)
  })

  it('anggota kelas dengan siswa:read saja tidak memuat nisn maupun data pribadi', async () => {
    const r = await handleClassStudents(req('kelas/' + id(12) + '/siswa'), id(12)); expect(r.status).toBe(200)
    const text = JSON.stringify(await r.json())
    for (const v of PRIVATE_VALUES) expect(text).not.toContain(v)
  })
})

describe('Dokumentasi menjelaskan data pribadi siswa di balik siswa:identity:read', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
  const files = ['integration-api.md', 'openapi-integration-v1.yaml']
  const FIELDS = ['alamat', 'telepon', 'email', 'tempat_lahir', 'tanggal_lahir', 'agama']

  it('markdown: baris scope siswa:identity:read menyebut data pribadi dan penerapannya di detail/sync', () => {
    const baris = read('docs/integration-api.md').split('\n').find((l) => l.startsWith('| `siswa:identity:read`')) ?? ''
    for (const f of ['NISN', 'alamat', 'telepon', 'email', 'tempat', 'agama']) expect(baris.toLowerCase()).toContain(f.toLowerCase())
  })

  it('markdown: menyatakan bahwa siswa:read saja tidak menerima data pribadi tersebut', () => {
    expect(read('docs/integration-api.md')).toMatch(/siswa:read.{0,80}tidak.{0,120}(alamat|data pribadi)/is)
  })

  it('OpenAPI: skema Student mendeskripsikan setiap field pribadi hanya dengan siswa:identity:read', () => {
    const openapi = read('docs/openapi-integration-v1.yaml')
    for (const f of FIELDS) {
      expect(openapi, `field ${f}`).toMatch(new RegExp(`^\\s+${f}: \\{[^\\n]*siswa:identity:read`, 'm'))
    }
  })

  it.each(files)('salinan public/docs/%s identik dengan docs/', (name) => {
    expect(read('public/docs/' + name)).toBe(read('docs/' + name))
  })

  it('versi API tetap 1.1 (koreksi terhadap kontrak yang sudah terdokumentasi)', () => {
    expect(read('docs/openapi-integration-v1.yaml')).toContain('version: 1.1.0')
  })
})
