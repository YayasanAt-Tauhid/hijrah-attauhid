import { createFileRoute } from "@tanstack/react-router";

const BASE_URL = "https://app.hijrah-attauhid.or.id/api/v1";

function IntegrationApiDocs() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
          <div className="mb-8 border-b border-slate-200 pb-8">
            <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-blue-700">Hijrah At-Tauhid</p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Integration API v1</h1>
            <p className="mt-4 max-w-3xl text-slate-600">
              Dokumentasi resmi API read-only untuk sinkronisasi data Hijrah At-Tauhid ke backend aplikasi pihak ketiga.
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
                  <tr><td className="px-4 py-3 font-mono">pendaftaran:sensitive:read</td><td className="px-4 py-3">Data sensitif pendaftaran sesuai izin</td></tr>
                  <tr><td className="px-4 py-3 font-mono">pendaftaran:documents:read</td><td className="px-4 py-3">Metadata dan signed URL dokumen privat</td></tr>
                  <tr><td className="px-4 py-3 font-mono">siswa:read</td><td className="px-4 py-3">Data siswa dan relasi kelas</td></tr>
                  <tr><td className="px-4 py-3 font-mono">kelas:read</td><td className="px-4 py-3">Data kelas</td></tr>
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-slate-500">Pembatasan unit/departemen dan tahun ajaran diterapkan server-side sesuai konfigurasi token.</p>
          </section>

          <section className="mt-9">
            <h2 className="text-xl font-bold">Endpoint utama</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {["GET /pendaftaran", "GET /pendaftaran/{pendaftaran_id}", "GET /siswa", "GET /siswa/{siswa_id}", "GET /kelas", "GET /kelas/{kelas_id}/siswa", "GET /sync/pendaftaran", "GET /sync/siswa", "GET /sync/kelas", "GET /documents/{pendaftaran_id}.{jenis}"].map((endpoint) => <code key={endpoint} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{endpoint}</code>)}
            </div>
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

          <footer className="mt-10 border-t border-slate-200 pt-6 text-sm text-slate-500">Integration API v1 · Read-only · Backend-to-backend</footer>
        </div>
      </div>
    </main>
  );
}

export const Route = createFileRoute("/docs/integration-api")({
  component: IntegrationApiDocs,
});
