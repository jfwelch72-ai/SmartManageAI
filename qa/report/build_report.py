"""Build SmartManage_AI_Full_E2E_Issues_Report.md + issues.csv + coverage.csv from machine-readable results.
Usage: python3 -I qa/report/build_report.py <run_dir>"""
import sys, os, json, csv, collections, datetime, re
RUN = sys.argv[1]; RID = os.path.basename(RUN.rstrip('/')); ROOT = os.path.abspath(os.path.join(RUN, '..', '..', '..'))
res = {}
for l in open(os.path.join(RUN, 'results.jsonl')):
    if l.strip(): r = json.loads(l); res[r['id']] = r  # last record per id wins
R = list(res.values())
I = json.load(open(os.path.join(ROOT, 'qa/report/issues.json')))
dbg = sum(1 for l in open(os.path.join(RUN, 'results.harness-debug.jsonl')) if l.strip()) if os.path.exists(os.path.join(RUN, 'results.harness-debug.jsonl')) else 0
cnt = collections.Counter(r['status'] for r in R)
mod = collections.defaultdict(collections.Counter)
for r in R: mod[r.get('module','?').split('/')[0].split(' (')[0]][r['status']] += 1
rec = json.load(open(os.path.join(RUN, 'estimate/final_reconciliation.json')))
load = json.load(open(os.path.join(RUN, 'evidence/load/load-summary.json'))) if os.path.exists(os.path.join(RUN, 'evidence/load/load-summary.json')) else None
loadint = json.load(open(os.path.join(RUN, 'evidence/load/load-integrity.json'))) if os.path.exists(os.path.join(RUN, 'evidence/load/load-integrity.json')) else None
vit = json.load(open(os.path.join(RUN, 'evidence/suites/vitest-results.json')))
man = json.load(open(os.path.join(RUN, 'fixtures/MANIFEST.json')))
S = json.load(open(os.path.join(RUN, 'state.json')))
a11y = json.load(open(os.path.join(RUN, 'evidence/a11y-axe-summary.json'))) if os.path.exists(os.path.join(RUN, 'evidence/a11y-axe-summary.json')) else {}
sev_order = {'Critical':0,'High':1,'Medium':2,'Low':3}
def sevkey(i): return sev_order.get(i['severity'].split(' ')[0], 4)
I.sort(key=sevkey)
sevc = collections.Counter(i['severity'].split(' ')[0] for i in I)
# ---------- CSVs
with open(os.path.join(RUN, 'issues.csv'), 'w', newline='') as f:
    keys = ['id','title','severity','priority','category','module','roles','env','tests','repro','expected','actual','impact','code','cause','fix','accept','evidence']
    w = csv.DictWriter(f, fieldnames=keys, extrasaction='ignore'); w.writeheader(); [w.writerow(i) for i in I]
with open(os.path.join(RUN, 'coverage.csv'), 'w', newline='') as f:
    keys = ['id','title','module','role','tenant','mode','env','req','expected','status','actual','evidence','started','finished']
    w = csv.DictWriter(f, fieldnames=keys, extrasaction='ignore'); w.writeheader()
    for r in sorted(R, key=lambda r: r['id']): rr = dict(r); rr['evidence'] = ' '.join(r.get('evidence', [])); rr['actual'] = (r.get('actual') or '')[:900]; w.writerow(rr)
# ---------- markdown
o = []; P = o.append
P(f'# SmartManage AI — Full E2E Test Campaign: Issues Report\n')
P(f'**Run ID:** `{RID}` · **Generated:** {datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")} · **Repository commit:** `1378776` on branch `claude/brave-brahmagupta-mx5ti1` (identical to `main`) · **Environment tested:** local container only (see §1.3)\n')
P('> All people, companies, dates, quantities, rates and documents created by this run are **synthetic test fixtures** unless labelled as coming from the supplied workbook. No real customers, employees, subcontractors or agencies were contacted; no money moved; nothing was pushed to accounting systems.\n')
P('## 1. Executive assessment\n')
P('### 1.1 Release blockers observed\n')
P('1. **SMA-SEC-001 — the repository is compromised.** Commit `1378776` hid an obfuscated blockchain-command-and-control loader inside `postcss.config.js` (line 10, padded far off-screen). Every `npm run dev`, `build`, `vitest` and Playwright run, and the Amplify build, loads this file. Treat as an active security incident: stop deploys from `main`, rotate secrets and investigate the contributor workstation. It did not execute in this container (the module failed to parse), but that cannot be assumed elsewhere.')
P('2. **SMA-TEN-001 — cross-tenant data corruption.** A user from one organization can write production progress into another organization\'s project. Confirmed in the database with `STRICT_TENANT_RLS=true`.')
P('3. **SMA-AUTH-001 — anonymous SUPER_ADMIN session in development mode.** Any deployment running with `NODE_ENV=development` hands a platform-admin session to anonymous callers, because the `ENABLE_DEV_SEED=false` switch is ignored. Whether the hosted dev site runs in that mode could not be verified.')
P('4. **The core money path is broken:**')
P('   - Owner progress cannot be entered: SOV line update returns 500 (SMA-BILL-001).')
P('   - Duplicate pay apps permanently block final retainage (SMA-BILL-002); overbilling is accepted (SMA-BILL-003).')
P('   - The award pushes profit into the cost budget (SMA-BUD-001).')
P('   - Approved labor vanishes from job cost once materials are received (SMA-JC-001).')
P('   - The contract, SOV and pay apps disagree after change orders (SMA-CO-001).')
P('5. **The supplied estimate cannot be imported with its costs** (SMA-EST-001). The estimate screen\'s grand total also omits profit (SMA-EST-003).\n')
P('**Release recommendation: NOT READY.** Fix the security issues first: SMA-SEC-001, SMA-TEN-001, SMA-AUTH-001 and SMA-AUTH-002. Critical coverage is also BLOCKED: hosted environment, cross-browser engines, attachments/object storage, live integrations and live AI. Even after these fixes, release status cannot be called green until that coverage has run.\n')
P('### 1.2 Lifecycle endpoint reached (primary project)\n')
P(f'The primary project went from customer through closeout. Each stage, in order:\n')
P(f'1. CRM customer, contact and opportunity created.')
P(f'2. Bid `{S.get("bidCode")}` created.')
P(f'3. Estimate loaded: 29 lines, $782,052.11. This used the API with an explicit mapping; the UI import cannot carry costs.')
P(f'4. Alternate and proposal PDFs generated.')
P(f'5. Estimate approved.')
P(f'6. Award: one project, `{S.get("projectCode")}`, even under concurrent double-click.')
P(f'7. Contract executed.')
P(f'8. Schedule with CPM verified.')
P(f'9. Crew and equipment assignment, with the date-based crew assignment failing.')
P(f'10. Time clock and approval.')
P(f'11. Production.')
P(f'12. Subcontract and sub pay app.')
P(f'13. PO, receipt, invoice and match.')
P(f'14. RFI and submittal.')
P(f'15. Change orders.')
P(f'16. **Owner billing: BLOCKED on the primary project** (SMA-BILL-001). It was tested on a separate fallback project with 3 sequential pay apps; the math matched the independent G702 calculation exactly.')
P(f'17. Punch list and closeout checklist.')
P(f'18. Project marked **COMPLETE**.')
P(f'19. Final retainage release: **BLOCKED** (SMA-BILL-002).')
P(f'20. Turnover package export: **BLOCKED**, because no object storage is available locally.\n')
P(f'**This is not an uninterrupted E2E pass.** It is a stage-by-stage run with one fallback seed (`{S.get("fb",{}).get("code")}` FALLBACK-BILLING), clearly labelled.\n')
P('### 1.3 Scope, environment and limitations\n')
P('**Hosted environment:** NOT TESTED.')
P('- `https://main.d12aeb39ons832.amplifyapp.com/` is denied by this container\'s network policy: proxy CONNECT 403, 3 attempts.')
P('- The hosted backend, database, storage, auth tenant and queues could not be identified.')
P('- Every result below comes from a **local** instance of the same commit. Local results do not prove hosted behaviour.\n')
P('**Local stack used for every result:**')
P('- `tsx server/index.ts` with `NODE_ENV=development`, `STRICT_TENANT_RLS=true`, `EMAIL_TRANSPORT=noop`, schedulers off.')
P('- PostgreSQL 16.15 with the schema applied by `drizzle-kit push`. That path does not run the SQL migrations, so local RLS covers 289 of 609 tables; production RLS coverage may differ.')
P('- Seeded with the repo\'s own `scripts/seed-test-company.ts`: tenants RealTest Construction and RealTest Subcontractors, 21 users, shared password supplied privately.')
P('- Timezone UTC.')
P('- `postcss.config.js` replaced in the working tree, **uncommitted**, by the clean `a77912a` version. User-approved, to avoid loading the malicious code.\n')
P('**Accounts and roles:**')
P('- `admin@realtest.com` was verified to be **ADMIN of RealTest Construction**, not Super Admin.')
P('- Super Admin was exercised as `superadmin@realtest.com`, a seeded SUPER_ADMIN.\n')
P('**Browsers:**')
P('- Chromium 141 only.')
P('- Firefox and WebKit are BLOCKED: binaries are absent and installation is prohibited in this environment.')
P('- Phone and tablet runs are emulation, not physical devices.\n')
P(f'**Test dates:** 2026-10-09, 11:59–about 14:00 UTC.\n')
P('## 2. Coverage\n')
P(f'**Denominator:** {len(R)} executed or explicitly accounted test cases in `coverage.csv`, one latest record per test ID.')
P(f'- {dbg} harness-debug attempts were superseded after I fixed *my* harness (wrong field names and similar). They are kept in `results.harness-debug.jsonl` and are not counted.')
P('- Discovered features, planned cases, executed cases and code coverage are different measures and are not equated.\n')
P('| Status | Count |\n|---|---|')
for s in ['PASS','FAIL','BLOCKED','NOT RUN','NOT APPLICABLE']: P(f'| {s} | {cnt.get(s,0)} |')
P(f'| **Total** | **{len(R)}** |\n')
P('**Inventory (static, from repository):**')
P('- 211 frontend routes.')
P('- 209 backend router mounts, about 3,090 endpoints.')
P('- 64 cron jobs, 13 other schedulers, 7 pg-boss queues, 7 inbound webhooks.')
P('- 54 feature flags, 8 user roles.')
P('- Full inventory in `inventory.md`. Most of those endpoints were **not** exercised: coverage targets the construction lifecycle, authorization and tenant boundaries.\n')
P('**Module coverage (this run):**\n')
P('| Module | PASS | FAIL | BLOCKED | NOT RUN |\n|---|---|---|---|---|')
for m, c in sorted(mod.items()): P(f'| {m} | {c.get("PASS",0)} | {c.get("FAIL",0)} | {c.get("BLOCKED",0)} | {c.get("NOT RUN",0)} |')
P('\n**Roles covered by real sessions:**')
P('- SUPER_ADMIN, ADMIN, HUSTLER, MANAGER, SUPERINTENDENT, ESTIMATOR, FIELD_WORKER, VENDOR, plus anonymous.')
P('- Cross-tenant ADMIN from a second organization.')
P('- Office manager, sales, marketing and equipment manager are **not distinct roles** in code: the seed maps them to MANAGER or FIELD_WORKER. `docs/ACCOUNT_ROLES_RBAC.md` still describes 18 roles.\n')
P('**Existing repository test suites** (run against `sma_qa_test`):')
P('- `npm run check` (tsc): **exit 0**.')
P(f'- `vitest run`: **exit 1**: {vit["numFailedTests"]} failed / {vit["numPassedTests"]} passed / {vit["numPendingTests"]} skipped tests in {vit["numTotalTests"]} total, across 498 files (116 failed files).')
P('- About 41 of the failed files are vi.mock export mismatches, i.e. test-harness rot. The rest are value and HTTP assertions; categories are in `evidence/suites/vitest-failure-categories.json`.')
P('- Two deterministic failures map to product defects: SMA-JOB-001 and SMA-ROUTE-001.')
P('- CI status of `main` could not be verified from here.')
P('- Skipped tests are not counted as passes.\n')
P('## 3. Findings by business impact\n')
P(f'**Confirmed application or repository defects:** {len(I)}')
P(f'- Critical: {sevc.get("Critical",0)}')
P(f'- High: {sevc.get("High",0)}')
P(f'- Medium: {sevc.get("Medium",0)}')
P(f'- Low: {sevc.get("Low",0)}\n')
P('| ID | Severity | Title | Tests |\n|---|---|---|---|')
for i in I: P(f'| {i["id"]} | {i["severity"]} | {i["title"]} | {i["tests"]} |')
P('\n### 3.1 Source-data observations (workbook — not importer behaviour)\n')
P('Independent recomputation reproduces every cached total: O120 $623,942.68; P120 $782,052.0975 (shown as $782,052.10); Q120 $158,109.42; margin 20.21725%. These observations are about the workbook itself and are **not** corrected:\n')
for s in ['**SRC-01 P23** is a literal `3` instead of the row formula. Q23 = −$38,217.00. If the row template was intended, P23 would be $44,964.71 and P120 would be $827,013.81. The intended value is unresolved.',
 '**SRC-02 J120/S120** sum rows 111–119 rather than 11–112. Every J value is currently 0, so there is no current-dollar effect. The range is suspect.',
 '**SRC-03 Q120** sums Q11:Q113 (includes the SALES TAX label row). No current effect.',
 '**SRC-04 A27/B27:** 5.44 yd/pad × 162 = 881.28 yd, versus B27 = 1,014 yd (6.259 yd/pad); a 7×7×2 ft pad is 3.63 yd. Requires clarification (synthetic RFI-001 raised).',
 '**SRC-05 A30** note "$589,826.00 / $3,640.90" (= 589,826 / 162) does not match the current pads-section price.',
 '**SRC-06 A48** note "$25,355.71 = $67.80/sf" versus computed rows 42–47 = $25,335.71 (a $20 difference).',
 '**SRC-07** Equipment-like rows 15, 38 and 45 ($33,500) are priced in Other at 0% margin. Equipment J is empty and column I is hidden. Preserved as-is; no remap.',
 '**SRC-08** Alternate rows 55–57 ($17,074.29 price) are inside the P11:P112 grand total. Inclusion is preserved, and the customer\'s acceptance is unknown.',
 '**SRC-09/10** Labor rows use days × $3,000 with D (header "HOURS") = 1. They were **not** converted to employee hours or wages.',
 '**SRC-11 A12** exclusion: "GC responsible for layout." The app has no place to carry it (SMA-EST-004).',
 '**SRC-12** SALES TAX, OVERHEAD & PROFIT and SUBCONTRACTOR MARK UP rows have no values.',
 '**SRC-13 A7** "5/19/26 bids Thursday am": 19 May 2026 is a Tuesday.']: P(f'- {s}')
P('\nCell-level mapping, the classification of all 110 rows (11–120), and the expected-results file are in `fixtures/estimate_reconciliation.xlsx` and `fixtures/expected_results.json`.\n')
P('### 3.2 Static concerns (code evidence; not runtime-confirmed)\n')
for s in ['`POST /api/auth/init` is unauthenticated. On an empty users table it creates `admin@tfrllc.com` / `admin123` (`server/workforceRoutes.ts:977`).',
 'TOTP 2FA exists but is never checked at password login (`server/authProfileRoutes.ts:586-713`), although docs say an org policy enforces it.',
 '`verifyBidOrgAccess` grants access when the caller has no organization (`server/orgFilter.ts:238`). A freshly registered ADMIN with no org might read bids by id. Not runtime-tested.',
 'The cost ledger passes `contractAmount` (revenue) as the project budget (`server/costLedgerRoutes.ts:263`).',
 'Pay-app create treats `sov.contractValue` as the original contract, while sync-totals treats it as contract-plus-COs (`server/aiaBillingRoutes.ts:340` vs `:692`).',
 'Twilio voice webhook and SAML callback are not CSRF-exempt (`server/csrf.ts:33-71`). The SendGrid event webhook has no signature verification and is a stub.',
 '`requireFeature` plan gating covers only 18 routes; 8 feature flags have no server reference.',
 '`loadtests/budgets.json` expects `scenarios/mutations.js`, which does not exist. The nightly load run should fail; not verified.',
 'Estimator self-approval of estimates is allowed (`server/estimateRoutes.ts:3310`). No segregation-of-duties requirement was found, so this is unresolved.',
 'Dev-mode 500 responses include stack traces and SQL (`server/index.ts:473`). Production strips them.',
 'Lists `/api/sov` and `/api/aia-billing/pay-applications` ignore `?projectId=` and return all of the org\'s records. The UI filters client-side (`client/src/components/project-tabs/SovTab.tsx:78`). This is a performance and over-fetch concern.']: P(f'- {s}')
P('\n### 3.3 Environment blockers\n')
for r in sorted([r for r in R if r['status'] in ('BLOCKED','NOT RUN')], key=lambda r: r['id']): P(f'- **{r["id"]}** ({r["status"]}): {r["title"]}. {r["actual"][:300]}')
P('\n### 3.4 Missing requested capabilities\n')
for s in ['No full-cost spreadsheet estimate import (SMA-EST-001). No estimate notes or exclusions after creation (SMA-EST-004).',
 'No margin-based pricing: org factors are compounding markups. Per-line profitAllocation was used to preserve source prices.',
 'No timesheet *submit* step and no break/meal tracking (static). No equipment downtime entity (static). No project ARCHIVED status.',
 'No completion gate. COMPLETE is allowed with open punch items, pending COs, unpaid invoices and draft pay apps (CLOSE-002). Whether a gate is required is unresolved.',
 'No user-facing API to create daily reports; they arrive only via mobile sync (static).',
 'No optimistic-concurrency control on edits: concurrent CO edits are last-write-wins (CONC-EDIT-001). Whether that is required is unresolved.']: P(f'- {s}')
P('\n### 3.5 Optional improvements\n')
P('- Show both "base bid" and "base + accepted alternates" totals on the proposal; today only subtotals print.')
P('- Map unique-violation and multer errors to 4xx globally.')
P('- Align RBAC docs (18 roles) with code (8 roles).')
P('- Treat the ~41 vitest files with mock drift as test debt.\n')
P('## 4. Detailed issues\n')
for i in I:
    P(f'### {i["id"]} — {i["title"]}\n')
    P(f'**Overview**\n')
    P(f'- Category: {i["category"]}')
    P(f'- Severity: **{i["severity"]}**')
    P(f'- Priority: {i["priority"]}')
    P(f'- Module: {i["module"]}')
    P(f'- Roles: {i["roles"]}')
    P(f'- Environment/version: {i["env"]}, commit 1378776\n')
    P(f'**Reproduction**\n')
    P(f'- Tests: {i["tests"]}')
    P(f'- Reproducibility: {i["repro"]}')
    P(f'- Preconditions: {i["pre"] or "—"}')
    P(f'- Steps: {i["steps"]}\n')
    P(f'**Behavior**\n')
    P(f'- Expected (and authority): {i["expected"]}')
    P(f'- Actual: {i["actual"]}')
    P(f'- Business impact: {i["impact"]}\n')
    P(f'**Diagnosis and fix**\n')
    P(f'- Evidence: `{i["evidence"]}`')
    P(f'- Code references: `{i["code"]}`')
    P(f'- Cause: {i["cause"]}')
    P(f'- Proposed fix: {i["fix"]}')
    P(f'- Workaround tested: {i["workaround"] or "—"}')
    P(f'- Regression acceptance: {i["accept"]}\n')
P('## 5. Estimate → contract → billing → closeout reconciliation\n')
P('| Quantity | Source / independent | App | Variance |\n|---|---|---|---|')
for row in [('Direct cost', '$623,942.68 (O120)', '$623,942.68 (project.budget; appliedTotals.grandTotal)', '0.00'),
            ('Price incl. ALT-1', '$782,052.0975 → $782,052.10 (P120)', '$782,052.11 (Σ per-line cents)', '+0.01 rounding policy'),
            ('Base ex-alternate', '$764,977.81', '$764,977.82', '+0.01 rounding'),
            ('Budget lines total', '$623,942.68', f'${rec["jobCostLedgerTotals"]["budgetedTotal"]:,.2f}', '+$158,109.43 (SMA-BUD-001)'),
            ('Approved CO net', '+$21,000.00 (4 approved incl. pre-execution pair)', f'${rec["changeOrders"]["approvedNet"]:,.2f}', '0'),
            ('Contract after COs', '$803,052.11 (782,052.11 + 21,000)', f'${rec["contract"]["value"]:,.2f}', f'{rec["contract"]["value"]-803052.11:+,.2f} (SMA-CO-001)'),
            ('SOV-001 Σ lines', '$803,052.11', f'${[s for s in rec["sov"] if s["period"]==1][0]["linesSum"]:,.2f}; SOV.contractValue ${[s for s in rec["sov"] if s["period"]==1][0]["contractValue"]:,.2f}', 'contractValue stale'),
            ('Primary billing to date', 'n/a', '$0 (SMA-BILL-001 blocks progress entry)', 'BLOCKED'),
            ('Fallback: completed & stored (3 apps)', '$609,378.19', '$609,378.19', '0.00'),
            ('Fallback: retainage held', '$60,937.82', '$60,937.82', '0.00 (final release BLOCKED, SMA-BILL-002)'),
            ('Fallback: certified & paid (fixture receipts)', '$548,440.37', '$548,440.37', '0.00'),
            ('Labor actual (8 h × $45)', '$360.00', f'${rec["jobCostLedgerTotals"]["actualLabor"]:,.2f}', '−$360 (SMA-JC-001)'),
            ('Material actual (PO receipt 50%)', '$13,335.84', f'${rec["jobCostLedgerTotals"]["actualMaterial"]:,.2f}', '0.00'),
            ('Production R27', '700 + over-entries', '1,150 / 1,014 yd completed', 'over-complete accepted (SMA-PROD-001)')]:
    P('| ' + ' | '.join(row) + ' |')
P('\nSynthetic overrides used:')
P('- The contract amount equals the app\'s priced estimate ($782,052.11, including ALT-1); acceptance of the source alternate was assumed for the lifecycle only.')
P('- Billing percentages: `fixtures/billing_expected.json`.')
P('- Schedule durations: `fixtures/schedule_expected_cpm.json`.')
P('- Worker cost rate: $45/h.')
P('- Every variance is reported rather than forced to zero. Full JSON: `estimate/final_reconciliation.json`.\n')
P('## 6. UI, authorization, integration/AI and performance\n')
P('**UI (Chromium 141 emulation):**\n')
for r in sorted([r for r in R if r['id'].startswith('UI-')], key=lambda r: r['id']): P(f'- **{r["id"]} {r["status"]}** — {r["title"]}: {r["actual"][:400]}')
if a11y:
    agg = collections.Counter()
    for k, v in a11y.items():
        for x in v: agg[(x['id'], x['impact'])] += x['nodes']
    P('\nAutomated accessibility (axe-core 4.10.2, WCAG 2 A/AA; scanner results only, not a conformance claim). Top violations by node count:\n')
    P('| Rule | Impact | Nodes |\n|---|---|---|')
    for (rid, imp), n in agg.most_common(10): P(f'| {rid} | {imp} | {n} |')
    P('\nManual keyboard and focus review was **NOT RUN**. Screenshots are in `evidence/screenshots/`.\n')
P('**Authorization and tenant isolation:**\n')
for r in sorted([r for r in R if r['id'].startswith(('RBAC','TEN','AUTH','SA-'))], key=lambda r: r['id']): P(f'- **{r["id"]} {r["status"]}**: {r["title"]}. {r["actual"][:260]}')
P('\n**Integrations and AI:** see §3.3.')
P('- Delivery was only verified to the in-memory email sink.')
P('- The AI prompt-injection guard was executed directly.')
P('- No live provider calls were made, so no model, latency or accuracy claims are made.\n')
P('**Performance (bounded, LOCAL ONLY):**\n')
if load:
    P(f'- Harness: `qa/harness/load.mjs`, global ceiling {load["maxRps"]} req/s, think time {load["thinkMs"]} ms.')
    P('- Mix: project read/search, schedule, scope read, production write, time-clock cycle, cost ledger, G702 PDF.')
    P('- Abort limits: >5% 5xx over 60 s, or p95 >10 s for 2 windows.\n')
    P('| Stage | Duration s | Requests | Achieved rps | 5xx/net err | 4xx | p50 ms | p95 ms | p99 ms | Aborted |\n|---|---|---|---|---|---|---|---|---|---|')
    for s in load['stages']: P(f'| {s["stage"]} | {s["durationSec"]} | {s["samples"]} | {s["achievedRps"]} | {s["err5xxOrNet"]} ({s["errRate"]*100:.2f}%) | {s["status4xx"]} | {s["p50"]} | {s["p95"]} | {s["p99"]} | {s["aborted"] or "no"} |')
    last = load['stages'][-1]
    P('\nPer-operation latency for the last stage (ms):\n')
    P('| Operation | n | p50 | p95 | p99 | Statuses |\n|---|---|---|---|---|---|')
    for k, v in sorted(last['ops'].items()): P(f'| {k} | {v["n"]} | {v["p50"]} | {v["p95"]} | {v["p99"]} | {v["statuses"]} |')
    if loadint: P(f'\nPost-load integrity: {loadint["productionWrites201"]} production writes returned 201, against a persisted quantity sum of {loadint["persistedCompletedQuantitySum"]} (match: {loadint["match"]}).\n')
    P('- These are measurements on a single local container, not a capacity statement.')
    P('- No product SLA exists for these operations. `loadtests/budgets.json` sets p95 2 s / 1% error, so **capacity acceptance criteria are not established**.')
    P('- Saturation was not claimed.')
    P('- Resource, queue and DB-pool telemetry was not collected.\n')
else: P('Load test results not available.\n')
P('## 7. Remediation order, open questions, residual risk, re-test\n')
P('**Order:**\n')
P('1. Security incident SMA-SEC-001: Security + DevOps.')
P('2. Tenant isolation and auth: SMA-TEN-001, SMA-AUTH-001, SMA-AUTH-002, SMA-RBAC-001 (Backend/security). Add org-isolation tests for every `:id` route lacking org scoping, and complete RLS coverage.')
P('3. Billing integrity: SMA-BILL-001/002/003 and SMA-CO-001 (Backend/finance).')
P('4. Job cost and budget: SMA-BUD-001, SMA-JC-001, SMA-EST-002/003 (Backend).')
P('5. Workflow state: SMA-BID-001/002, SMA-CLOSE-001/002, SMA-TIME-001/002, SMA-RES-001 (Backend).')
P('6. Import capability: SMA-EST-001/004 (Frontend + Backend).')
P('7. Remaining Medium and Low issues: SMA-UI-001 (Frontend); test-suite repair (QA/Eng).\n')
P('**Open questions for the product owner:**')
P('- Intended P23 value and the row-27 quantity.')
P('- Customer acceptance of ALT-1.')
P('- Should completion be gated on readiness?')
P('- Segregation of duties for estimate approval.')
P('- Is optimistic concurrency required?')
P('- Which NODE_ENV and dependencies does the hosted Amplify dev site use?')
P('- Should SUPER_ADMIN read tenant financials?\n')
P('**Residual risk:** hosted behaviour, Firefox/WebKit, physical devices, attachments, integrations, AI quality, scheduled jobs and about 90% of the endpoint inventory remain untested.\n')
P(f'**Re-test:** follow `qa/README.md`. Run the stage scripts in order, then the UI and load harnesses, then `python3 -I qa/report/build_report.py qa/runs/<run-id>`.\n')
P('## 8. Records, documents and cleanup\n')
P(f'**Primary QA project, retained for review:**')
P(f'- Project `{S.get("projectCode")}` (id `{S.get("projectId")}`)')
P(f'- Bid `{S.get("bidCode")}`, estimate `{S.get("estimateId")}`')
P(f'- Contract `{S.get("contractId")}`, SOV `{S.get("sovId")}`\n')
P(f'**Other QA records:**')
P(f'- Fallback billing project `{S.get("fb",{}).get("code")}`')
P(f'- Second-site project `{S.get("otherProjectCode")}`')
P(f'- Completion-gate project `{S.get("gateProbe")}` (CLOSED)')
P(f'- Load project `{S.get("load",{}).get("code","(not created)")}`')
P(f'- Platform test tenant `{S.get("tenantB")}`')
P(f'- All IDs are in `state.json`; all names start with `{RID}`.\n')
P('**Account changes:**')
P('- `dispatcher@realtest.com` password was changed by AUTH-004 (local DB only).')
P('- The temp PM user was deactivated by AUTH-003.')
P('- 25 synthetic `qa-load-*` users were created for the load test.\n')
P('**Cleanup status:**')
P('- No records were deleted. The DELETE calls in RET-001 matched no route and changed nothing.')
P('- Load data is retained. It is test-owned and can be removed from the manifest if wanted.')
P('- The local database is disposable (container). Nothing touched the hosted environment.\n')
P(f'**Fixture documents:** {len(man)} files with SHA-256 in `fixtures/MANIFEST.csv`. Every synthetic PDF carries the "TEST ONLY — NOT VALID FOR BUSINESS USE" banner.\n')
P('| File | Purpose | Provenance | Tests |\n|---|---|---|---|')
for m in man: P(f'| `{m["file"]}` | {m["purpose"]} | {m["provenance"]} | {m["test_ids"]} |')
P('\n**App-generated documents**, all in `evidence/docs/`:')
P('- Proposal PDFs (`EST-PROP-001/002`)')
P('- G702/G703 PDFs (`PAY-FB-00x-*`)')
P('- Punch and closeout HTML exports\n')
P('**Run commands** (secrets via env vars only):\n')
P('```bash\nexport SMA_QA_ADMIN_PASSWORD=...   # supplied privately; never committed\nexport SMA_QA_RUN_ID=SMA-QA-<UTC>\nset -a; . qa/.local.env; set +a   # gitignored; see qa/README.md for variables\nnode qa/harness/stage1.mjs && node qa/harness/stage2.mjs && ...   # see README for full order\n```\n')
P('\n*End of report.*')
open(os.path.join(RUN, 'SmartManage_AI_Full_E2E_Issues_Report.md'), 'w').write('\n'.join(o))
print('report lines', len(o), 'results', len(R), dict(cnt), 'issues', len(I), dict(sevc))
