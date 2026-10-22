# Security hardening review — 23 October 2026

Scope: Hijrah At-Tauhid; based on reported Nuclei informational findings. Raw scan output was not supplied, so the 17 results and WAF coverage have not been independently validated. Direct live requests from the VPS received HTTP 403; this does not establish which WAF rules or other access controls are enabled.

## Verified in source

- Public API integration guides, OpenAPI and Postman files are intentionally linked by the API documentation page. The Postman token variable contains an uppercase placeholder; examples use placeholders. Documentation availability alone does not prove sensitive-data exposure. This check is not a comprehensive secret or PII audit.
- robots.txt previously listed individual documentation filenames; it now lists only /docs/. robots.txt and noindex are crawler hints, not access controls. Documentation remains public for third-party integrations; making it private is a separate product decision requiring server-side authorization.
- The root document loaded a Google Fonts stylesheet. Font CSS and all four WOFF2 subsets are now served locally, retaining the SIL OFL license and source/checksum manifest. No external font CSS remains in the document.

## Header behavior

A Nitro fetch wrapper applies security defaults to final SSR/API responses, including framework error responses that bypass route-rule headers. Existing stricter policies, cookies, status, redirects and body streams are preserved. Route rules share the same defaults. Nitro also generates .output/public/_headers from these same rules for Cloudflare static assets. Documentation responses also receive X-Robots-Tag: noindex, nofollow, noarchive. Same-origin frames remain supported for application print flows. HSTS applies to this host only, with no preload or includeSubDomains.

The baseline CSP enforces frame-ancestors, object-src, base-uri and HTTPS upgrades. It deliberately does not yet restrict scripts, styles, frames or connections; it is not full XSS protection. A stricter nonce/hash policy must first inventory and test SSR hydration, inline styles, Google OAuth, Midtrans Snap and Supabase/realtime traffic. Merely adding a CSP header does not close every CSP-related risk.

## Validation completed

- Existing application suite: 95 files / 625 tests passed.
- New response-header suite: 6 tests passed, covering success/errors, immutable redirects, multiple cookies, existing stricter policies and documentation crawler hints.
- Cloudflare module build passed using Bun 1.4.2.
- Local Wrangler 4.152.0 with Node 22: header checks passed on 10 paths (home, staff/parent sign-in, HTML/OpenAPI docs, robots, CSS/WOFF2, 404 and API error). All normal pages/assets returned 200, the unknown page returned 404, and the API returned 500 because runtime backend settings were intentionally absent. This checks headers on error responses, not API functionality.
- Preview used inert build-time placeholders (preview.invalid); it had no production credentials. Login, payments and authenticated API behavior were not tested against a real backend.
- Font checksums, WOFF2 signatures, all 5 weights and 4 subsets passed.

## Before production

Validate generated Cloudflare output and preview responses, run application tests/build, then merge/deploy only after approval. After deployment, check public responses for HTML, redirects/errors, static assets and documentation; verify Google login, parent portal, print receipts and Midtrans checkout. Re-run the original Nuclei templates and compare individual results.
