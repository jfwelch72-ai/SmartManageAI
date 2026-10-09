# SmartManage AI — QA campaign harness

This folder holds the evidence-based E2E/QA campaign. Each run writes to `qa/runs/<run-id>/`.

**Open the report first:** `qa/runs/SMA-QA-20261009T120012Z/SmartManage_AI_Full_E2E_Issues_Report.md`. A `.pdf` and a `.docx` copy sit next to it.

> **Security notice.** Commit `1378776` added malicious code to `postcss.config.js` (see `SECURITY_INCIDENT_SMA-SEC-001.md`). Do **not** run `npm run dev`, `build`, `vitest` or Playwright against that file. This campaign restored the clean `a77912a` version locally and **did not commit it**:
>
> ```bash
> git show a77912a:postcss.config.js > postcss.config.js
> ```

## Prerequisites (local, isolated)

- Node 22.
- PostgreSQL 16 on 127.0.0.1.
- Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Any Chromium works; pass `CHROME_PATH`.
- `pdftotext` (poppler) and Python 3 with `openpyxl`, `reportlab` and `Pillow`.
- `axe-core` installed **outside** the repo. Pass its path with `AXE_PATH`.

### Environment variables

Set these in `qa/.local.env`, which is gitignored. **Never commit values.**

| Variable | Value / meaning |
|---|---|
| `DATABASE_URL` | Local, disposable database. |
| `SESSION_SECRET` | Random string, e.g. from `openssl rand -hex 32`. |
| `NODE_ENV` | `development` |
| `STRICT_TENANT_RLS` | `true` |
| `ENABLE_SCHEDULERS` | `false` |
| `EMAIL_TRANSPORT` | `noop` (test mail sink). |
| `RATE_LIMIT_USE_MEMORY_STORE` | `1` |
| `INTEGRATION_ENCRYPTION_KEY` | Random string. |
| `SMA_QA_ADMIN_PASSWORD` | Seeded test password, supplied privately. |
| `SMA_QA_RUN_ID` | e.g. `SMA-QA-20261009T120012Z` |
| `SMA_QA_BASE_URL` | Default `http://localhost:5000`. The load harness refuses non-localhost URLs. |

## Bootstrap

```bash
npm ci
set -a; . qa/.local.env; set +a
npx drizzle-kit push --force
npx tsx scripts/seed-test-company.ts   # RealTest tenants + 21 users (local only)
npx tsx server/index.ts                # in another shell
```

Copy the source workbook to the run folder and make it read-only:

```bash
mkdir -p qa/runs/$SMA_QA_RUN_ID/fixtures/source
cp '<workbook>' "qa/runs/$SMA_QA_RUN_ID/fixtures/source/00420_Crane_Logistics_2nd_take_off_with_changes_(2).xlsx"
chmod 444 qa/runs/$SMA_QA_RUN_ID/fixtures/source/*.xlsx
```

## Estimate inspection

The analysis scripts are kept in the run's `estimate/` outputs; their sources are in this harness.

```bash
python3 -I qa/harness/analyze_workbook.py <xlsx> qa/runs/$SMA_QA_RUN_ID/estimate/row_analysis.json
npx tsx qa/harness/run-bidtab-parser.ts <xlsx> qa/runs/$SMA_QA_RUN_ID/estimate/bidtab_parser_output.json
```

## Lifecycle, role and security stages

Run these in order. Each stage appends to `results.jsonl` and writes `evidence/api/<TEST-ID>.json`.

```bash
for s in stage1 stage2 stage3 stage4 stage5 stage6 stage7 stage7b stage8 stage8b-ret002 stage9-reconcile stage10-rbac stage11-ai stage12-files-conc stage12b-race; do
  node qa/harness/$s.mjs || true
done
npx tsx qa/harness/ai-guard.ts qa/runs/$SMA_QA_RUN_ID/evidence/ai-guard-results.json   # run before stage11
```

To re-run a subset, prefix any stage with `ONLY=<ID prefix,...>`.

## Fixtures

```bash
python3 -I qa/harness/fixtures_gen.py qa/runs/$SMA_QA_RUN_ID
```

## UI (Chromium) and bounded load (local only)

UI harness:

```bash
AXE_PATH=<axe.min.js> CHROME_PATH=<chrome> node qa/harness/ui.mjs
```

Load harness (local only):

```bash
STAGES=1,5,10,25 STAGE_SEC=120 SOAK_SEC=900 MAX_RPS=20 node qa/harness/load.mjs
```

## Repository suites

Typecheck:

```bash
npm run check
```

Vitest, against a separate database whose name contains `test`:

```bash
DATABASE_URL=postgres://.../sma_qa_test SESSION_SECRET=x AUTO_PROVISION_TEST_DB=0 RATE_LIMIT_USE_MEMORY_STORE=1 \
  npx vitest run --reporter=json --outputFile=qa/runs/$SMA_QA_RUN_ID/evidence/suites/vitest-results.json
```

## Build the report

```bash
python3 -I qa/report/build_report.py qa/runs/$SMA_QA_RUN_ID
cd qa/runs/$SMA_QA_RUN_ID
pandoc SmartManage_AI_Full_E2E_Issues_Report.md -f gfm -o SmartManage_AI_Full_E2E_Issues_Report.docx
pandoc SmartManage_AI_Full_E2E_Issues_Report.md -f gfm -s --css ../../report/report.css --embed-resources -o /tmp/report.html
cd -; CHROME_PATH=<chrome> node qa/report/html2pdf.mjs /tmp/report.html qa/runs/$SMA_QA_RUN_ID/SmartManage_AI_Full_E2E_Issues_Report.pdf
```

## Rules this harness follows

- QA-owned records only. Every name is prefixed with the run ID.
- No product code changes.
- No direct database writes. Read-only SQL was used for verification only.
- Harness mistakes are not hidden. Superseded attempts stay in `results.harness-debug.jsonl` and are not counted.
