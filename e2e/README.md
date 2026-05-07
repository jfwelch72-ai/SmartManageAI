# SmartManageAI end-to-end tests

Playwright specs that exercise the live Express + Postgres stack through
real HTTP. Specs run against the dev server (`npm run dev`) on port 5000
unless `BASE_URL` is set.

## Money-path pack (Task #2483)

The "money-path" suite exercises the financial flows whose failure
would directly cost a customer money. Each spec is self-contained and
seeds its own data through the dev factories in `helpers/`.

| Spec | Flow |
| ---- | ---- |
| `money-bid-to-payapp.spec.ts` | Bid → award → convert → SOV → AIA pay app → owner approves → G702 PDF export. |
| `money-change-order-flow.spec.ts` | Change order create → submit → approve → reflected in pay app contract sum + SOV CO tie-out. |
| `money-procurement-3way-match.spec.ts` | PR → submit/approve → convert to PO → Receipt → vendor invoice → 3-way match flips invoice to MATCHED → AP records full payment → invoice lands on PAID (bill posted). DISCREPANCY when the vendor over-bills. |
| `money-time-clock-payroll.spec.ts` | Worker clock in/out → manager approves shift (+ creates time entry) → time entry approved → admin creates pay run → WH-347 certified-payroll PDF downloads with valid PDF magic bytes. |
| `money-accounting-sync.spec.ts` | QBO + Sage Intacct sync. **Unconditionally skipped** (`test.skip(true, …)`) — explicitly scoped out of Task #2483 because the provider modules under `server/integrations/providers/{qbo,sage-intacct}` do not exist yet, so there is nothing for the spec to drive even when sandbox credentials are available. Follow-up #2506 will replace the hard skip with a credential-gated real round-trip once the providers land. |
| `tenant-isolation-api.spec.ts` | API-level negative tests: an authenticated user in Org B cannot read or mutate any of Org A's bid, project, SOV, pay app, or change order — even when given the UUID. Listing endpoints must not enumerate Org A's records. Complements the DB-level RLS coverage in `server/__tests__/tenant-rls.test.ts`. |

### Helpers

- `helpers/auth.ts` — `devLogin(page, role, { linkOrg })` and the
  request-context twin `devLoginRequest(request, role, …)`. Both hit
  `POST /api/dev/test-login` (gated by `ENABLE_DEV_SEED`).
- `helpers/factories.ts` — thin REST wrappers for every entity the
  money-path specs need:
  - **Bid / project / billing**: `createBid`, `awardBidAndConvert`,
    `createProject`, `createSOV`, `createPayApp`, `setPayAppStatus`
  - **Change orders**: `createChangeOrder`, `submitChangeOrder`,
    `approveChangeOrder`
  - **Time / payroll**: `clockIn`, `clockOut`, `approveShift`
    (with `createTimeEntry`), `approveTimeEntry`, `createPayRun`
  - **Procurement**: `createPurchaseRequest`, `submitPurchaseRequest`,
    `approvePurchaseRequest`, `convertPrToPo`, `receivePO`,
    `createVendorInvoice`, `runThreeWayMatch`, `recordInvoicePayment`

  Each factory accepts either a `Page` or any object with a
  `.request: APIRequestContext` field, so multi-org specs can drive
  Org B from a fresh `browser.newContext()`.
- `helpers/csrf.ts` — `installCsrf(page)` (already present) primes the
  CSRF cookie + header pair the API requires for write requests.

### Running locally

```bash
# In one shell:
ENABLE_DEV_SEED=true npm run dev

# In another:
npm run test:e2e -- e2e/money-bid-to-payapp.spec.ts
```

To run only the money-path pack:

```bash
npm run test:e2e -- e2e/money-*.spec.ts e2e/tenant-isolation-api.spec.ts
```

### CI

The repo's existing `e2e` job in `.github/workflows/ci.yml` runs
`npm run test:e2e`, which picks up everything under `e2e/**/*.spec.ts`,
so the new money-path specs are picked up automatically. The
`money-accounting-sync.spec.ts` cases skip themselves when the
sandbox credentials aren't wired into the workflow's secrets.

### Adding a new money-path flow

1. Add a thin factory to `helpers/factories.ts` (one POST per entity,
   return the parsed JSON).
2. Create `e2e/money-<flow>.spec.ts` and start each test with
   `installCsrf(page)` + `devLogin(page, "ADMIN")`.
3. Drive the flow through the factories and assert on the
   business-state side-effects (totals, status transitions, generated
   PDFs / exports) rather than UI text — UI strings churn, money
   numbers shouldn't.
4. If the flow crosses an org boundary, add a negative case to
   `tenant-isolation-api.spec.ts` covering the new entity.
