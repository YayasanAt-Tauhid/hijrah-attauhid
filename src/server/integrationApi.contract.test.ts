import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const readRepoFile = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const api = readRepoFile('src/server/integrationApi.ts')
const docs = readRepoFile('docs/integration-api.md')
const openapi = readRepoFile('docs/openapi-integration-v1.yaml')
const postman = readRepoFile('docs/postman/Hijrah-Integration-v1.postman_collection.json')

describe('Integration API v1 contract', () => {
  it('limits third-party milestone writes to tes, lulus, and tidak_lulus', () => {
    const milestone = readRepoFile('src/server/integrationApiMilestone.ts')
    expect(milestone).toContain("!['tes', 'lulus', 'tidak_lulus'].includes(action)")
    expect(milestone).not.toContain("!['tes', 'lulus', 'tidak_lulus', 'daftar_ulang'].includes(action)")
  })

  it('keeps bearer auth, server-side token hashing and rate limiting', () => {
    expect(api).toContain("request.headers.get('authorization')")
    expect(api).toContain('await sha256(token)')
    expect(api).toContain('integration_rate_limit_hit')
    expect(api).toContain("'Retry-After':String(r.retry_after)")
  })

  it('uses signed cursors bound to permissions and filters', () => {
    expect(api).toContain("crypto.subtle.sign('HMAC'")
    expect(api).toContain('scopeFingerprint(ctx)')
    expect(api).toContain('filterFingerprint(u)')
    expect(api).toContain('x.scope!==scopeFingerprint(ctx)')
    expect(api).toContain('x.filters!==filters')
  })

  it('keeps registration and document identities based on pendaftaran_id', () => {
    expect(api).toContain('id:d.pendaftaran_id')
    expect(api).toContain('docs(d.pendaftaran_id,d)')
    expect(api).toContain(".eq('pendaftaran_id',id)")
    expect(api).toContain('download_path:`/api/v1/documents/${pid}.${kind}`')
  })

  it('serializes the SPMB selection decision for read/sync consumers', () => {
    expect(api).toContain('status_kelulusan:d.spmb_status_kelulusan')
    expect(api).toContain('tanggal_keputusan:d.spmb_tanggal_keputusan')
  })

  it('serializes registration payment without exposing provider secrets', () => {
    expect(api).toContain('integration_registration_payment_status')
    expect(api).toContain('pembayaran_pendaftaran:await payment(ctx,s)')
    expect(api).not.toContain('snap_token:')
    expect(api).not.toContain('pmb_payment_token:')
  })

  it('exports latest SPMB wave metadata and keeps NISN in the sensitive block', () => {
    expect(api).toContain('gelombang:d.spmb_gelombang?')
    expect(api).toContain('out.data_sensitif={nisn:s.nisn')
  })

  it('keeps sensitive and document fields behind explicit scopes', () => {
    expect(api).toContain("has(ctx,'pendaftaran:sensitive:read')")
    expect(api).toContain("has(ctx,'pendaftaran:documents:read')")
  })

  it('documents the verified production origin and stable document identity', () => {
    const origin = 'https://app.hijrah-attauhid.or.id'
    expect(docs).toContain(origin)
    expect(openapi).toContain(origin)
    expect(postman).toContain(origin)
    expect(docs).toContain('<pendaftaran_id>.<jenis>')
    expect(openapi).toContain("description: '<pendaftaran_id>.<jenis>'")
  })

  it('documents payment and safe bootstrap ordering', () => {
    expect(docs).toContain('pembayaran_pendaftaran')
    expect(openapi).toContain('pembayaran_pendaftaran')
    expect(docs).toContain('ambil checkpoint awal dari endpoint sync')
    expect(docs).toContain('mulai incremental dari checkpoint tersebut')
    expect(docs).toContain('Jangan mengambil checkpoint baru setelah snapshot')
  })
})
