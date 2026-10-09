# PR #139 — SPMB billing before class placement

Verified in staging: October 9–10, 2026, Asia/Jakarta.
Repository: YayasanAt-Tauhid/hijrah-attauhid.
Staging: flxbrbnyzclcthjwynsh.
Production: cmvzcpeiuompqgdvflky.

## Result

Acceptance, initial fees, payments, monitoring, academic activation, and monthly SPP were tested against real staging tables/RPCs. Financial test transactions were never created in production.

The feature requires both migrations in this PR. Production migration, merge, and deployment require the owner's explicit approval after verification. The existing application does not receive these changes merely because this PR or its tests exist.

## Coverage and evidence

| Check | Result |
| --- | --- |
| Regular Vitest suite | 437 tests passed, 67 files; maxWorkers=2 |
| Staging cashier/server-handler scenarios | 6 passed |
| Staging online bookkeeping scenarios | 4 passed; simulated Midtrans |
| Final staging access/ledger guards | 4 passed |
| Production function comparison | Changed bodies match the intended acceptance/class/department/duplicate-fee behavior; internal activation RPC unchanged |
| SQL definition compilation | All six function definitions accepted in BEGIN/ROLLBACK transactions; trigger and portal view replacement accepted together in BEGIN/ROLLBACK |
| Build | Vite/Nitro Cloudflare build passed |
| Full application TypeScript check | Added to PR CI; VPS attempt exhausted its default Node heap |

The cashier scenarios include full and installment payments, payment books 2026 and 2027 for one target invoice, concurrent final-payment attempts with one successful transaction, receipt creation, target SMP accounting while an internal student remains enrolled in SD, and nine monthly SPP invoices after activation without duplicating the initial fee.

The online scenarios cover an unrelated parent being rejected, canonical fee names and departments overriding client values, invalid webhook signatures, duplicate settlement callbacks, two installments totaling Rp4,200,000, a balanced bank/deferred-income journal, and the correct remaining parent balance.

Database preparation also verified:
- Four students, external/internal and current/future academic years, accepted without a target class.
- NIS must be generated before saving acceptance.
- Initial fees issued without target classes; sequential and simultaneous retries produce one invoice and tariff.
- External activation without a target class and target SPP before activation fail.
- Future internal academic activation is rejected before July 1, 2027.
- A 14-day SPMB administrative payment deadline remains distinct from a future invoice's official due date.
- Parent access remains isolated by RLS and the portal view uses security_invoker=true.
- A wrong origin department or class is rejected before tariffs are written.
- Final staging journals and payments use the target department and remain balanced.

The stateful integration suites and fixture requirements are documented in scripts/qa/README.md. Raw logs and private fixture data remain outside Git on the VPS.

## Limits

No real Midtrans sandbox credentials were supplied for these tests. Snap responses and signed gateway notifications are simulated, while application handlers and database bookkeeping are real. This does not prove actual QRIS/VA settlement or sandbox connectivity. Existing production gateway credentials are not reused for test transactions.

The staging checks exercise server handlers and database access. They are not browser click-through tests of every UI page.

Staging security advisors were reviewed. The changed billing entry points revoke anonymous execution, payment mutation remains service-role-only, and staff RPCs retain role checks. Existing advisor findings for other transplanted functions and unrelated staging tables are outside this PR's scope; this report is not a full project security audit.

## Required rollout order after approval

1. Recheck main/head and database definitions for drift.
2. Apply 20261009084606_spmb_acceptance_without_class.sql.
3. Apply 20261009104546_spmb_preplacement_billing_guards.sql.
4. Merge the reviewed PR and verify the Cloudflare deployment.
5. Read-only production checks: readiness, accepted-student bill visibility, access isolation, and existing invoice/payment/journal counts.

Neither migration changes historical payments, invoices, or ledger entries. The new payment department field is populated for new payments only.
