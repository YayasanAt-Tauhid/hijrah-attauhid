import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const readRepoFile = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const api = readRepoFile('src/server/integrationApi.ts')
const docs = readRepoFile('docs/integration-api.md')
const openapi = readRepoFile('docs/openapi-integration-v1.yaml')
const postman = readRepoFile('docs/postman/Hijrah-Integration-v1.postman_collection.json')
const admin = readRepoFile('src/server/integrationsAdmin.ts')
const migration = readRepoFile('supabase/migrations/20260924080759_integration_api_v11_hardening.sql')

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
    expect(api).toContain('pembayaran_pendaftaran:await payment(ctx,s,d)')
    expect(api).toContain('d.spmb_departemen_tujuan_id||s.departemen_id')
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
  it('keeps v1 backward compatible while exposing the v1.1 response version', () => {
    expect(api).toContain("response.headers.set('X-Hijrah-API-Version','1.1')")
    expect(api).toContain("response.headers.set('X-Hijrah-API-Major','1')")
    expect(openapi).toContain('version: 1.1.0')
    expect(docs).toContain('Prefix tetap `/api/v1`')
  })

  it('supports granular registration scopes without removing the legacy sensitive scope', () => {
    expect(api).toContain("'pendaftaran:identity:read'")
    expect(api).toContain("'pendaftaran:contact:read'")
    expect(api).toContain("'pendaftaran:sensitive:read'")
    expect(admin).toContain("'pendaftaran:identity:read'")
    expect(admin).toContain("'pendaftaran:contact:read'")
    expect(admin).toContain("'pendaftaran:sensitive:read'")
    expect(api).toContain("legacySensitive=has(ctx,'pendaftaran:sensitive:read')")
  })

  it('serializes explicit test and verification statuses while retaining legacy timestamps', () => {
    expect(api).toContain("statusTes=d.spmb_tanggal_tes?'sudah_tes':'belum_tes'")
    expect(api).toContain('status_tes:statusTes')
    expect(api).toContain('tanggal_tes:d.spmb_tanggal_tes')
    expect(api).toContain('status_verifikasi:d.spmb_verifikasi_status')
    expect(openapi).toContain('status_tes:')
    expect(openapi).toContain('status_verifikasi:')
  })

  it('implements every documented v1.1 list filter', () => {
    for (const filter of [
      "u.searchParams.get('departemen_id')",
      "u.searchParams.get('tahun_ajaran_id')",
      "u.searchParams.get('status_tes')",
      "u.searchParams.get('status_kelulusan')",
      "u.searchParams.get('gelombang_id')",
      "u.searchParams.get('status_verifikasi')",
      "u.searchParams.get('kelas_id')",
    ]) expect(api).toContain(filter)
    expect(api).toContain("rq=rq.eq('tahun_ajaran_id',year)")
    expect(api).toContain("rq=rq.eq('kelas_id',classId)")
    expect(api).toContain("const u=new URL(request.url),year=u.searchParams.get('tahun_ajaran_id')")
    expect(api).toContain("if(year)q=q.eq('tahun_ajaran_id',year)")
    expect(docs).toContain('## Filter list v1.1')
  })

  it('adds monitored asynchronous webhooks without exposing PII in the event payload', () => {
    expect(migration).toContain('create table if not exists public.integration_webhook_outbox')
    expect(migration).toContain("vault.create_secret(")
    expect(migration).toContain("net.http_post(")
    expect(migration).toContain("'select public.integration_webhook_tick();'")
    expect(migration).toContain("'object_id', new.object_id")
    expect(migration).toContain("new.object_type='dokumen' and 'pendaftaran:read'=any(a.scopes) and 'pendaftaran:documents:read'=any(a.scopes)")
    expect(migration).not.toContain("'nik', new.")
    expect(openapi).toContain('webhooks:')
    expect(openapi).toContain('X-Hijrah-Signature')
    expect(docs).toContain('Webhook sengaja tidak membawa biodata/PII')
  })

  it('documents the v1.1 filters in Postman', () => {
    expect(postman).toContain('Hijrah Integration API v1.1')
    expect(postman).toContain('List - Filter SPMB')
    expect(postman).toContain('status_tes=belum_tes')
    expect(postman).toContain('List - Filter Kelas')
    expect(postman).toContain('/kelas/{{kelasId}}/siswa?tahun_ajaran_id={{tahunAjaranId}}')
  })


  it('exposes employee read/import behind explicit scopes without role or finance writes', () => {
    const employeeListRoute = readRepoFile('src/routes/api.v1.pegawai.ts')
    const employeeDetailRoute = readRepoFile('src/routes/api.v1.pegawai.$id.ts')
    const employeeImportRoute = readRepoFile('src/routes/api.v1.pegawai.import.ts')

    expect(api).toContain("'pegawai:read'")
    expect(api).toContain("'pegawai:write'")
    expect(admin).toContain("'pegawai:read'")
    expect(admin).toContain("'pegawai:write'")
    expect(api).toContain("need(ctx,'pegawai:read')")
    expect(api).toContain("need(ctx,'pegawai:write')")
    expect(api).toContain("const allowedFields=new Set(['pegawai_id','nip','nama','jenis_kelamin','jabatan','departemen_id','status','tanggal_masuk','tanggal_pensiun','golongan_terakhir'])")
    expect(api).toContain("const PEGAWAI_BASE='id,nip,nama,jenis_kelamin,jabatan,departemen_id,status,tanggal_masuk,tanggal_pensiun,golongan_terakhir,created_at'")
    expect(api).not.toContain("const PEGAWAI_BASE='id,nip,nama,jenis_kelamin,tempat_lahir")
    expect(api).not.toContain("allowedFields=new Set(['pegawai_id','nip','nama','jenis_kelamin','tempat_lahir")
    expect(api).not.toContain("out.data_pribadi=")
    expect(api).not.toContain("allowedFields=new Set(['role'")
    expect(api).toContain("integration:${ctx.integration.id}:pegawai-write")
    expect(employeeListRoute).toContain("handlePegawaiList")
    expect(employeeDetailRoute).toContain("handlePegawaiDetail")
    expect(employeeImportRoute).toContain("handlePegawaiImport")
    expect(openapi).toContain('/api/v1/pegawai/import:')
    expect(openapi).toContain('pegawaI:write'.replace('I', 'i'))
    expect(postman).toContain('Import / Update')
    expect(postman).toContain('/api/v1/pegawai/import')
    expect(docs).toContain('## Integrasi data pegawai')
    expect(docs).toContain('role/login')
    expect(docs).toContain('Alamat, telepon, email, tempat/tanggal lahir, agama, foto')
    expect(openapi).not.toContain('Omitted unless token has pegawai:contact:read')
    expect(postman).toContain('Private/contact data is never included')
  })

})
