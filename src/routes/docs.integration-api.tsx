import { createFileRoute } from "@tanstack/react-router";

const BASE_URL = "https://app.hijrah-attauhid.or.id/api/v1";
const milestoneActions = ["tes", "lulus", "tidak_lulus"] as const;

function IntegrationApiDocs() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
          <div className="mb-8 border-b border-slate-200 pb-8">
            <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-blue-700">Hijrah At-Tauhid</p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Integration API v1.1</h1>
            <p className="mt-4 max-w-3xl text-slate-600">
              Dokumentasi resmi API baca, update terbatas status SPMB, serta integrasi data pegawai untuk backend aplikasi pihak ketiga.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800" href="/docs/openapi-integration-v1.yaml" target="_blank" rel="noreferrer">Buka OpenAPI</a>
              <a className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-50" href="/docs/Hijrah-Integration-v1.postman_collection.json" download>Download Postman Collection</a>
              <a className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-50" href="/docs/integration-api.md" target="_blank" rel="noreferrer">Dokumentasi Markdown</a>
            </div>
          </div>

          <section className="space-y-3">
            <h2 className="text-xl font-bold">Mulai menggunakan API</h2>
            <p className="text-slate-600">API ini hanya untuk komunikasi backend-to-backend. Jangan menanam token pada browser, APK, aplikasi mobile, atau source control.</p>
            <div className="rounded-xl bg-slate-950 p-4 text-sm text-slate-100 overflow-x-auto"><code>{BASE_URL}</code></div>
            <p className="text-slate-600">Setiap request menggunakan header <code className="rounded bg-slate-100 px-1.5 py-0.5">Authorization: Bearer &lt;token_integrasi&gt;</code>. Token diterbitkan oleh administrator Hijrah At-Tauhid khusus untuk masing-masing integrasi.</p>
          </section>

          <section className="mt-9">
            <h2 className="text-xl font-bold">Scope akses</h2>
            <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50"><tr><th className="px-4 py-3">Scope</th><th className="px-4 py-3">Akses</th></tr></thead>
                <tbody className="divide-y divide-slate-200">
                  <tr><td className="px-4 py-3 font-mono">pendaftaran:read</td><td className="px-4 py-3">Data dasar SPMB dan status pembayaran pendaftaran</td></tr>
                  <tr><td className="px-4 py-3 font-mono">pendaftaran:identity:read</td><td className="px-4 py-3">Identitas pendaftaran: NISN/NIK/KK/TTL</td></tr>
                  <tr><td className="px-4 py-3 font-mono">pendaftaran:contact:read</td><td className="px-4 py-3">Alamat, telepon/email, dan kontak dasar orang tua</td></tr>
                  <tr><td className="px-4 py-3 font-mono">pendaftaran:sensitive:read</td><td className="px-4 py-3">Legacy compatibility — seluruh blok sensitif v1 lama</td></tr>
                  <tr><td className="px-4 py-3 font-mono">pendaftaran:documents:read</td><td className="px-4 py-3">Metadata dan signed URL dokumen privat</td></tr>
                  <tr><td className="px-4 py-3 font-mono">siswa:read</td><td className="px-4 py-3">Data siswa dan relasi kelas</td></tr>
                  <tr><td className="px-4 py-3 font-mono">kelas:read</td><td className="px-4 py-3">Data kelas</td></tr>
                  <tr><td className="px-4 py-3 font-mono">pegawai:read</td><td className="px-4 py-3">Data operasional pegawai</td></tr>                  <tr className="bg-amber-50"><td className="px-4 py-3 font-mono">pegawai:write</td><td className="px-4 py-3 font-semibold">Bulk import dan update data pegawai</td></tr>
                  <tr className="bg-amber-50"><td className="px-4 py-3 font-mono">pendaftaran:milestone:update</td><td className="px-4 py-3 font-semibold">Update Status SPMB (Tes, Lulus, dan Tidak Lulus)</td></tr>
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-slate-500">Pembatasan unit/departemen dan tahun ajaran diterapkan server-side sesuai konfigurasi token. Untuk pegawai, pembatasan unit tetap berlaku sedangkan tahun ajaran tidak relevan. Token lama dengan scope sensitive tetap kompatibel; integrasi baru dianjurkan memakai scope paling sempit.</p>
          </section>

          <section className="mt-9 rounded-xl border border-blue-200 bg-blue-50 p-5">
            <h2 className="text-xl font-bold text-blue-950">Update Status SPMB</h2>
            <p className="mt-2 text-sm text-blue-900">Token harus memiliki scope <code className="rounded bg-white px-1.5 py-0.5">pendaftaran:milestone:update</code>. Scope ini hanya dapat mengubah milestone SPMB melalui workflow yang sudah ada.</p>
            <div className="mt-4 rounded-xl bg-slate-950 p-4 text-sm text-slate-100 overflow-x-auto"><code>POST {BASE_URL}/pendaftaran/{'{id}'}/milestone</code></div>
            <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-sm text-slate-100">{`Authorization: Bearer TOKEN
Content-Type: application/json

{"action":"tes"}`}</pre>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">{milestoneActions.map(action => <code key={action} className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm">action: {action}</code>)}</div>
            <p className="mt-3 text-sm text-blue-900">Lulus maupun Tidak Lulus wajib setelah Tes, dan request ulang action yang sama idempotent. Payload hanya boleh berisi <code className="rounded bg-white px-1">action</code>; biodata, NIK, orang tua, pembayaran, dan kelas tidak dapat diubah.</p>
          </section>

          <section className="mt-9 rounded-xl border border-violet-200 bg-violet-50 p-5">
            <h2 className="text-xl font-bold text-violet-950">Integrasi Data Pegawai</h2>
            <p className="mt-2 text-sm text-violet-900">Baca data operasional pegawai menggunakan <code className="rounded bg-white px-1">pegawai:read</code>, termasuk email pegawai. Alamat, telepon, TTL, agama, foto, dokumen pribadi, dan data keluarga tetap tidak tersedia melalui API. Import/update operasional termasuk email membutuhkan <code className="rounded bg-white px-1">pegawai:write</code>.</p>
            <div className="mt-4 grid gap-2">
              <code className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm">GET {BASE_URL}/pegawai</code>
              <code className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm">GET {BASE_URL}/pegawai/{'{pegawai_id}'}</code>
              <code className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm">POST {BASE_URL}/pegawai/import</code>
            </div>
            <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-sm text-slate-100">{`{
  "update_existing": true,
  "rows": [{
    "pegawai_id": "UUID",
    "nip": "19870001",
    "nama": "Ahmad Fulan",
    "email": "ahmad.fulan@example.com",
    "jabatan": "Guru",
    "departemen_id": "UUID",
    "status": "aktif"
  }]
}`}</pre>
            <p className="mt-3 text-sm text-violet-900">Update dicocokkan berdasarkan <code className="rounded bg-white px-1">pegawai_id</code> lalu NIP. Nama tidak dijadikan kunci otomatis. Endpoint ini dapat membaca dan mengubah email pegawai, tetapi tidak dapat membaca atau mengubah alamat, telepon, TTL, agama, foto, dokumen pribadi, data keluarga, role/login, presensi, tabungan, jurnal, pembayaran, atau tabel keuangan.</p>
          </section>

          <section className="mt-9">
            <h2 className="text-xl font-bold">Endpoint utama</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {["POST /pendaftaran/{id}/milestone", "GET /pendaftaran", "GET /pendaftaran/{pendaftaran_id}", "GET /siswa", "GET /siswa/{siswa_id}", "GET /kelas", "GET /kelas/{kelas_id}/siswa", "GET /pegawai", "GET /pegawai/{pegawai_id}", "POST /pegawai/import", "GET /sync/pendaftaran", "GET /sync/siswa", "GET /sync/kelas", "GET /documents/{pendaftaran_id}.{jenis}"].map((endpoint) => <code key={endpoint} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{endpoint}</code>)}
            </div>
          </section>

          <section className="mt-9 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
            <h2 className="font-bold text-emerald-950">Filter & webhook v1.1</h2>
            <p className="mt-2 text-sm text-emerald-900">
              Pendaftaran dapat difilter berdasarkan lembaga, tahun ajaran, status, status tes, status kelulusan, gelombang, dan verifikasi.
              Siswa mendukung filter lembaga, tahun ajaran, status, dan kelas. Webhook opsional mengirim event minimal tanpa PII dan ditandatangani HMAC-SHA256.
            </p>
            <p className="mt-2 text-sm text-emerald-900">
              Respons tetap memakai path <code className="rounded bg-white px-1">/api/v1</code> dan menambahkan header <code className="rounded bg-white px-1">X-Hijrah-API-Version: 1.1</code>.
            </p>
          </section>

          <section className="mt-9 rounded-xl border border-amber-200 bg-amber-50 p-5">
            <h2 className="font-bold text-amber-950">Keamanan token</h2>
            <p className="mt-2 text-sm text-amber-900">Token bersifat rahasia dan hanya ditampilkan saat diterbitkan. Jangan kirim token melalui dokumentasi publik. Simpan sebagai secret/environment variable pada backend penerima. Jika token terpapar, minta administrator melakukan revoke/rotate.</p>
          </section>

          <section className="mt-9">
            <h2 className="text-xl font-bold">Pagination, dokumen & sinkronisasi</h2>
            <p className="mt-3 text-slate-600">Endpoint list menggunakan cursor opaque dengan <code className="rounded bg-slate-100 px-1">limit</code> default 100 dan maksimum 200. Gunakan ID stabil dari API sebagai kunci sinkronisasi, bukan nama, NIK, atau NISN.</p>
            <p className="mt-3 text-slate-600">Dokumen privat diakses melalui endpoint dokumen dan menghasilkan signed URL sementara. Untuk sinkronisasi berkelanjutan gunakan endpoint <code className="rounded bg-slate-100 px-1">/sync/*</code> dan simpan checkpoint terakhir di backend penerima.</p>
          </section>

          <footer className="mt-10 border-t border-slate-200 pt-6 text-sm text-slate-500">Integration API v1.1 · Backward-compatible /api/v1 · Scoped read + SPMB milestone write + employee import/update + optional webhook</footer>
        </div>
      </div>
    </main>
  );
}

export const Route = createFileRoute("/docs/integration-api")({
  head: () => ({
    meta: [
      { title: "Integration API v1.1 | Hijrah At-Tauhid" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
  component: IntegrationApiDocs,
});
