# PR #139: staging integration checks

These suites call the actual server handler functions with a real Supabase staging database. Only the TanStack wrapper, push transport, and Midtrans gateway are replaced. They are separate from the regular unit test suite.

The common loader rejects every Supabase URL except `https://flxbrbnyzclcthjwynsh.supabase.co`. Credentials and sessions stay outside Git. Use Node.js 22 or later.

## Fixtures

Set `SPMB139_FIXTURE_DIR` to a private directory containing:

- `spmb139-credentials.json`: staging URL, API key, test account IDs and passwords.
- `spmb139-sessions.json`: staging test account sessions.
- `spmb139-fixture.json`: four staging students, department/class/cohort IDs, and academic/accounting year IDs.
- `spmb139-master-seed.json`: fee types and accounting settings copied from production.
- `spmb139-online-fixture.json`: a fifth staging student and its initial fee invoice.

The October 9 test fixtures and raw evidence logs are preserved on the VPS in `/home/attauhid/private/hijrah-spmb139`. Set `SPMB139_FIXTURE_DIR` to that directory before running the verification suite. The loader refreshes test sessions if needed. No credential values belong in reports, logs, or commits.

## Running

Run each suite separately, in the order below:

```bash
npx vitest run --config scripts/qa/vitest.config.ts scripts/qa/spmb139-live.e2e.ts
npx vitest run --config scripts/qa/vitest.config.ts scripts/qa/spmb139-online.e2e.ts
npx vitest run --config scripts/qa/vitest.config.ts scripts/qa/spmb139-verify.e2e.ts
```

The first two suites create payments and change the fresh fixture students. They are single-pass scenarios: do not rerun them against already-paid invoices or already-activated students. To repeat them, create another isolated fixture set in staging, retain the prior test records, and update the private fixture files. The original date-dependent scenarios use October 9, 2026 as their business date.

The verification suite can be rerun against the completed October 9 fixtures. It reads persisted payments/journals and submits requests that must be rejected without leaving tariffs or invoices.

## Gateway scope

The online suite simulates Snap and status responses and generates a test SHA-512 webhook signature. Real Midtrans requests are blocked. It verifies ownership, canonical fee/department data, installment amounts, ledger entries, duplicate webhook handling, and parent invoice balances. It does not verify Midtrans sandbox connectivity, actual QRIS/VA settlement, or a browser checkout interaction.

## Source typechecks

PR CI builds generated routes, runs complete application/config TypeScript checks for both the PR and its base commit, and compares diagnostic counts/messages without source line offsets. It fails on new diagnostics or an incomplete compiler run. Full results are published as the typescript-baseline-comparison artifact; passing this regression check does not mean pre-existing repository type errors are absent.
