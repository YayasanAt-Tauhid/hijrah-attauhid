import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  configureIntegrationWebhook,
  createIntegration,
  listIntegrationOptions,
  listIntegrations,
  listIntegrationUsageSummaries,
  revokeIntegrationTokens,
  rotateIntegrationToken,
  testIntegrationWebhook,
  updateIntegration,
} from '@/server/integrationsAdmin'
import { toast } from 'sonner'

const scopes = [
  'pendaftaran:read',
  'pendaftaran:identity:read',
  'pendaftaran:contact:read',
  'pendaftaran:sensitive:read',
  'pendaftaran:documents:read',
  'siswa:read',
  'kelas:read',
  'pegawai:read',
  'pegawai:write',
  'pendaftaran:milestone:update',
]

const scopeLabels: Record<string, string> = {
  'pendaftaran:read': 'Baca pendaftaran & status SPMB',
  'pendaftaran:identity:read': 'Identitas pendaftaran (NISN/NIK/KK/TTL)',
  'pendaftaran:contact:read': 'Kontak pendaftaran & orang tua',
  'pendaftaran:sensitive:read': 'Legacy — seluruh data sensitif pendaftaran',
  'pendaftaran:documents:read': 'Dokumen pendaftaran',
  'siswa:read': 'Baca data siswa',
  'kelas:read': 'Baca data kelas',
  'pegawai:read': 'Baca data dasar pegawai',
  'pegawai:write': 'Import dan update data pegawai',
  'pendaftaran:milestone:update': 'Update Status SPMB (Tes, Lulus, Tidak Lulus)',
}

const dependentRegistrationScopes = [
  'pendaftaran:identity:read',
  'pendaftaran:contact:read',
  'pendaftaran:sensitive:read',
  'pendaftaran:documents:read',
]


const webhookEvents = ['pendaftaran', 'siswa', 'kelas', 'dokumen']

const toggle = (xs: string[], id: string, on: boolean) =>
  on ? [...new Set([...xs, id])] : xs.filter(x => x !== id)

function toggleScope(xs: string[], id: string, on: boolean) {
  let next = toggle(xs, id, on)
  if (on && dependentRegistrationScopes.includes(id) && !next.includes('pendaftaran:read')) {
    next = ['pendaftaran:read', ...next]
  }
  if (!on && id === 'pendaftaran:read') {
    next = next.filter(x => !dependentRegistrationScopes.includes(x))
  }
  return [...new Set(next)]
}

function existingWebhook(row: any) {
  return Array.isArray(row?.integration_webhooks)
    ? row.integration_webhooks[0] || null
    : row?.integration_webhooks || null
}

export default function IntegrasiApi() {
  const [rows, setRows] = useState<any[]>([])
  const [opts, setOpts] = useState<any>({ departments: [], academicYears: [] })
  const [usage, setUsage] = useState<Record<string, any>>({})
  const [name, setName] = useState('')
  const [sel, setSel] = useState<string[]>(['pendaftaran:read'])
  const [deps, setDeps] = useState<string[]>([])
  const [years, setYears] = useState<string[]>([])
  const [expires, setExpires] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [edit, setEdit] = useState<any>(null)
  const [webhookEdit, setWebhookEdit] = useState<any>(null)

  const load = async () => {
    try {
      const [r, o, u] = await Promise.all([
        listIntegrations(),
        listIntegrationOptions(),
        listIntegrationUsageSummaries(),
      ])
      setRows(r)
      setOpts(o)
      setUsage(u || {})
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function create() {
    setBusy(true)
    try {
      const r = await createIntegration({
        data: {
          name,
          scopes: sel,
          department_ids: deps,
          academic_year_ids: years,
          expires_at: expires ? new Date(expires).toISOString() : null,
        },
      })
      setToken(r.token)
      setName('')
      setDeps([])
      setYears([])
      setExpires('')
      setSel(['pendaftaran:read'])
      await load()
      toast.success('Integrasi dibuat. Salin token sekarang; token tidak dapat dilihat lagi.')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function rotate(id: string) {
    if (!confirm('Token lama akan langsung dicabut. Lanjutkan rotasi?')) return
    try {
      const r = await rotateIntegrationToken({ data: { id } })
      setToken(r.token)
      await load()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  function begin(row: any) {
    const webhook = existingWebhook(row)
    setEditing(row.id)
    setEdit({
      scopes: [...row.scopes],
      department_ids: [...(row.department_ids || [])],
      academic_year_ids: [...(row.academic_year_ids || [])],
      expires_at: row.expires_at ? row.expires_at.slice(0, 16) : '',
    })
    setWebhookEdit({
      url: webhook?.url || '',
      active: webhook?.active ?? true,
      event_types: [...(webhook?.event_types || webhookEvents)],
      exists: !!webhook,
    })
  }

  async function save(id: string) {
    try {
      await updateIntegration({
        data: {
          id,
          scopes: edit.scopes,
          department_ids: edit.department_ids,
          academic_year_ids: edit.academic_year_ids,
          expires_at: edit.expires_at ? new Date(edit.expires_at).toISOString() : null,
        },
      })
      await load()
      toast.success('Izin integrasi diperbarui')
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  async function saveWebhook(id: string, rotateSecret = false) {
    if (!webhookEdit?.url?.trim()) {
      toast.error('URL webhook wajib diisi')
      return
    }
    if (rotateSecret && !confirm('Signing secret webhook lama akan diganti. Lanjutkan?')) return
    try {
      const r = await configureIntegrationWebhook({
        data: {
          id,
          url: webhookEdit.url.trim(),
          active: !!webhookEdit.active,
          event_types: webhookEdit.event_types,
          rotate_secret: rotateSecret,
        },
      })
      if (r?.signing_secret) setWebhookSecret(r.signing_secret)
      await load()
      setWebhookEdit({ ...webhookEdit, exists: true })
      toast.success(rotateSecret ? 'Signing secret webhook dirotasi' : 'Webhook disimpan')
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  async function testWebhook(id: string) {
    try {
      const r = await testIntegrationWebhook({ data: { id } })
      toast.success(`Webhook test diantrikan: ${r.event_id}`)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const checks = (
    values: string[],
    set: (v: string[]) => void,
    items: any[],
    label: (x: any) => string,
  ) => (
    <div className="grid gap-2 md:grid-cols-2">
      {items.map(x => (
        <label key={x.id} className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={values.includes(x.id)}
            onCheckedChange={v => set(toggle(values, x.id, !!v))}
          />
          {label(x)}
        </label>
      ))}
    </div>
  )

  const scopeChecks = (values: string[], set: (v: string[]) => void) => (
    <div className="grid gap-2 md:grid-cols-2">
      {scopes.map(scope => (
        <label key={scope} className="flex items-start gap-2 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={values.includes(scope)}
            onCheckedChange={v => set(toggleScope(values, scope, !!v))}
          />
          <span>
            <span className="block">{scopeLabels[scope]}</span>
            <code className="text-xs text-muted-foreground">{scope}</code>
          </span>
        </label>
      ))}
    </div>
  )

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Integrasi API</h1>
        <p className="text-sm text-muted-foreground">
          API v1.1 tetap kompatibel dengan token v1 lama. Atur akses backend pihak ketiga,
          monitoring penggunaan, data pegawai, dan webhook event SPMB.
        </p>
      </div>

      {token && (
        <Card className="border-amber-300">
          <CardHeader><CardTitle>Token baru — salin sekarang</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <code className="block break-all rounded bg-muted p-3">{token}</code>
            <div className="flex gap-2">
              <Button onClick={() => navigator.clipboard.writeText(token)}>Salin token</Button>
              <Button variant="outline" onClick={() => setToken(null)}>Saya sudah menyimpan</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {webhookSecret && (
        <Card className="border-amber-300">
          <CardHeader><CardTitle>Signing secret webhook — salin sekarang</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Secret ini dipakai penerima untuk memverifikasi header X-Hijrah-Signature dan tidak ditampilkan lagi.
            </p>
            <code className="block break-all rounded bg-muted p-3">{webhookSecret}</code>
            <div className="flex gap-2">
              <Button onClick={() => navigator.clipboard.writeText(webhookSecret)}>Salin secret</Button>
              <Button variant="outline" onClick={() => setWebhookSecret(null)}>Saya sudah menyimpan</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Buat integrasi</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Input placeholder="Nama aplikasi" value={name} onChange={e => setName(e.target.value)} />
          <div>
            <div className="mb-2 text-sm font-medium">Scope</div>
            {scopeChecks(sel, setSel)}
          </div>
          <div>
            <div className="mb-2 text-sm font-medium">
              Unit sekolah <span className="font-normal text-muted-foreground">(kosong = semua)</span>
            </div>
            {checks(deps, setDeps, opts.departments, (x: any) => `${x.nama}${x.kode ? ` (${x.kode})` : ''}`)}
          </div>
          <div>
            <div className="mb-2 text-sm font-medium">
              Tahun ajaran <span className="font-normal text-muted-foreground">(kosong = semua)</span>
            </div>
            {checks(years, setYears, opts.academicYears, (x: any) => `${x.nama}${x.aktif ? ' — aktif' : ''}`)}
          </div>
          <label className="block text-sm font-medium">
            Kedaluwarsa <span className="font-normal text-muted-foreground">(opsional)</span>
            <Input className="mt-2" type="datetime-local" value={expires} onChange={e => setExpires(e.target.value)} />
          </label>
          <p className="text-xs text-muted-foreground">
            Gunakan cakupan paling sempit. API pegawai mengekspos data operasional termasuk email; alamat, telepon, TTL, agama, dan foto pegawai tetap tidak tersedia melalui API pihak ketiga. Akses tulis pegawai juga tidak memberikan akses role/login pengguna.
          </p>
          <Button disabled={busy || name.trim().length < 2} onClick={create}>
            Buat dan terbitkan token
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {rows.map(row => {
          const metrics = usage[row.id] || {}
          const webhook = existingWebhook(row)
          return (
            <Card key={row.id}>
              <CardContent className="space-y-4 pt-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-1">
                    <div className="font-semibold">{row.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.active ? 'Aktif' : 'Nonaktif'} · dibuat {new Date(row.created_at).toLocaleString('id-ID')}
                      {' · '}terakhir dipakai {row.last_used_at ? new Date(row.last_used_at).toLocaleString('id-ID') : 'belum pernah'}
                      {' · '}kedaluwarsa {row.expires_at ? new Date(row.expires_at).toLocaleString('id-ID') : 'tidak dibatasi'}
                    </div>
                    <div className="text-xs">{row.scopes.join(', ')}</div>
                    <div className="text-xs text-muted-foreground">
                      Unit: {(row.department_ids || []).length || 'semua'} · Tahun ajaran: {(row.academic_year_ids || []).length || 'semua'}
                      {' · '}Prefix: {row.integration_tokens?.filter((t: any) => !t.revoked_at).map((t: any) => t.token_prefix).join(', ') || 'tidak ada token aktif'}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => editing === row.id ? setEditing(null) : begin(row)}>
                      {editing === row.id ? 'Tutup' : 'Ubah izin'}
                    </Button>
                    <Button variant="outline" onClick={() => rotate(row.id)}>Rotasi token</Button>
                    <Button
                      variant="outline"
                      onClick={async () => {
                        if (!confirm('Cabut seluruh token aktif integrasi ini?')) return
                        await revokeIntegrationTokens({ data: { id: row.id } })
                        await load()
                      }}
                    >
                      Cabut token
                    </Button>
                    <Button
                      variant={row.active ? 'destructive' : 'default'}
                      onClick={async () => {
                        await updateIntegration({ data: { id: row.id, active: !row.active } })
                        await load()
                      }}
                    >
                      {row.active ? 'Nonaktifkan' : 'Aktifkan'}
                    </Button>
                    <Button variant="link" asChild>
                      <a href="/docs/integration-api" target="_blank" rel="noreferrer">Dokumentasi</a>
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Request 24 jam</div>
                    <div className="text-lg font-semibold">{metrics.requests_24h ?? 0}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Error 24 jam</div>
                    <div className="text-lg font-semibold">{metrics.errors_24h ?? 0}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Rata-rata 24 jam</div>
                    <div className="text-lg font-semibold">
                      {metrics.avg_duration_ms_24h == null ? '-' : `${metrics.avg_duration_ms_24h} ms`}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Request 7 hari</div>
                    <div className="text-lg font-semibold">{metrics.requests_7d ?? 0}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Error 7 hari</div>
                    <div className="text-lg font-semibold">{metrics.errors_7d ?? 0}</div>
                  </div>
                </div>

                {webhook && (
                  <div className="text-xs text-muted-foreground">
                    Webhook: {webhook.active ? 'aktif' : 'nonaktif'}
                    {' · '}sukses terakhir {webhook.last_success_at ? new Date(webhook.last_success_at).toLocaleString('id-ID') : 'belum ada'}
                    {' · '}gagal terakhir {webhook.last_failure_at ? new Date(webhook.last_failure_at).toLocaleString('id-ID') : 'belum ada'}
                    {webhook.last_error ? ` · ${webhook.last_error}` : ''}
                  </div>
                )}

                {editing === row.id && edit && webhookEdit && (
                  <div className="space-y-5 rounded-md border p-4">
                    <div>
                      <div className="mb-3 text-sm font-semibold">Ubah izin dan cakupan</div>
                      {scopeChecks(edit.scopes, (v) => setEdit({ ...edit, scopes: v }))}
                    </div>
                    <div>
                      <div className="mb-2 text-sm font-medium">Unit sekolah (kosong = semua)</div>
                      {checks(edit.department_ids, (v) => setEdit({ ...edit, department_ids: v }), opts.departments, (x: any) => x.nama)}
                    </div>
                    <div>
                      <div className="mb-2 text-sm font-medium">Tahun ajaran (kosong = semua)</div>
                      {checks(edit.academic_year_ids, (v) => setEdit({ ...edit, academic_year_ids: v }), opts.academicYears, (x: any) => x.nama)}
                    </div>
                    <Input
                      type="datetime-local"
                      value={edit.expires_at}
                      onChange={e => setEdit({ ...edit, expires_at: e.target.value })}
                    />
                    <Button onClick={() => save(row.id)}>Simpan perubahan izin</Button>

                    <div className="space-y-3 border-t pt-4">
                      <div>
                        <div className="text-sm font-semibold">Webhook event</div>
                        <p className="text-xs text-muted-foreground">
                          Event hanya mengirim ID dan metadata perubahan; data detail tetap dibaca melalui API sesuai scope.
                          Pengiriman asinkron dan otomatis retry.
                        </p>
                      </div>
                      <Input
                        placeholder="https://backend-mitra.example/webhooks/hijrah"
                        value={webhookEdit.url}
                        onChange={e => setWebhookEdit({ ...webhookEdit, url: e.target.value })}
                      />
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={!!webhookEdit.active}
                          onCheckedChange={v => setWebhookEdit({ ...webhookEdit, active: !!v })}
                        />
                        Webhook aktif
                      </label>
                      <div>
                        <div className="mb-2 text-sm font-medium">Event</div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          {webhookEvents.map(event => (
                            <label key={event} className="flex items-center gap-2 text-sm">
                              <Checkbox
                                checked={webhookEdit.event_types.includes(event)}
                                onCheckedChange={v => setWebhookEdit({
                                  ...webhookEdit,
                                  event_types: toggle(webhookEdit.event_types, event, !!v),
                                })}
                              />
                              {event}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" onClick={() => saveWebhook(row.id)}>
                          Simpan webhook
                        </Button>
                        {webhookEdit.exists && (
                          <>
                            <Button variant="outline" onClick={() => testWebhook(row.id)}>Kirim tes</Button>
                            <Button variant="outline" onClick={() => saveWebhook(row.id, true)}>Rotasi signing secret</Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
