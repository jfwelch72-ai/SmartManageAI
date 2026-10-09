import fs from "node:fs";
import { Client, test, expect, RUN_ID, RUN_DIR, money } from "./lib.mjs";
const PW = process.env.SMA_QA_ADMIN_PASSWORD;
const S = JSON.parse(fs.readFileSync(`${RUN_DIR}/state.json`));
const mgr = new Client("manager(MANAGER)"); await mgr.login("manager@realtest.com", PW);
await test({ id: "LC-COMPLETE-001", title: "Primary project marked COMPLETE and final reconciliation captured", module: "Projects/Reconciliation", role: "MANAGER", tenant: "RealTest Construction", req: "Prompt §5 Completion + Final reconciliation", expected: "Project COMPLETE; reconciliation file written; unresolved variances listed, not forced to zero" }, async (ctx) => {
  ctx.clients.push(mgr);
  const c = await mgr.patch(`/api/projects/${S.projectCode}`, { status: "COMPLETE" });
  const p = (await mgr.get(`/api/projects/${S.projectCode}`)).data;
  const sovs = (await mgr.get(`/api/sov?projectId=${S.projectId}`)).data.filter((s) => s.projectId === S.projectId); // list ignores projectId (client filters, SovTab.tsx:78)
  const contract = (await mgr.get(`/api/contracts?projectId=${S.projectId}`)).data[0];
  const led = (await mgr.get(`/api/projects/${S.projectCode}/cost-ledger`)).data.totals;
  const cos = (await mgr.get(`/api/change-orders?projectId=${S.projectId}`)).data; const coList = (Array.isArray(cos) ? cos : cos.changeOrders ?? cos.data ?? []).map((x) => ({ number: x.changeOrderNumber, status: x.status, amount: Number(x.amount) }));
  const rec = {
    runId: RUN_ID, generatedAt: new Date().toISOString(), note: "Values read from the running local app; independent expectations in brackets. Variances are reported, not forced to zero.",
    estimate: { workbookP120: 782052.0975, appSumOfRoundedLines: 782052.11, appAppliedTotalsGrandTotal: 623942.68, directCostO120: 623942.68 },
    award: { projectCode: S.projectCode, status: p.status, contractAmount: Number(p.contractAmount), budgetField: Number(p.budget) },
    changeOrders: { list: coList, approvedNet: money(coList.filter((x) => x.status === "APPROVED").reduce((a, x) => a + x.amount, 0)) },
    contract: { number: contract.contractNumber, status: contract.status, value: Number(contract.contractValue), expected: "782052.11 + approved COs" },
    sov: sovs.map((s) => ({ number: s.sovNumber, period: s.periodNumber, contractValue: Number(s.contractValue), linesSum: money(s.lineItems.reduce((a, x) => a + Number(x.scheduledValue), 0)), completedToDate: Number(s.totalCompletedToDate || 0) })),
    billingPrimary: "BLOCKED (SOV-PROG-001): no progress could be recorded; 4 DRAFT pay apps with $0 due exist from roll-forward/duplicate probes",
    billingFallback: { project: S.fb.code, apps: "3 approved & paid; completed&stored 609,378.19; retainage held 60,937.82; FINAL release BLOCKED by RET-002" },
    jobCostLedgerTotals: led,
  };
  rec.variances = [
    `Budget lines total ${led.budgetedTotal} vs direct cost 623942.68 (PRJ-BUD-001)`,
    `Contract ${rec.contract.value} vs 782052.11 + approved COs ${rec.changeOrders.approvedNet} = ${money(782052.11 + rec.changeOrders.approvedNet)} (CO-003)`,
    `SOV-001 lines ${rec.sov.find((s) => s.period === 1)?.linesSum} vs SOV.contractValue ${rec.sov.find((s) => s.period === 1)?.contractValue} vs contract ${rec.contract.value} (CO-003)`,
    `Approved labor 8h@$45 not in ledger actualLabor=${led.actualLabor} (JC-001)`,
  ];
  fs.writeFileSync(`${RUN_DIR}/estimate/final_reconciliation.json`, JSON.stringify(rec, null, 1));
  ctx.evidence.push("estimate/final_reconciliation.json");
  expect(c.status === 200 && p.status === "COMPLETE", `complete ${c.status} ${p.status}`);
  return { actual: `Project ${S.projectCode} COMPLETE; ${rec.variances.length} unresolved variances recorded` };
});
