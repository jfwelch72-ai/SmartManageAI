import fs from "node:fs";
import { Client, test, expect, RUN_ID, RUN_DIR, money } from "./lib.mjs";
const PW = process.env.SMA_QA_ADMIN_PASSWORD;
const S = JSON.parse(fs.readFileSync(`${RUN_DIR}/state.json`));
const save = () => fs.writeFileSync(`${RUN_DIR}/state.json`, JSON.stringify(S, null, 1));
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
const t = (m, f) => (ONLY.length && !ONLY.some((o) => m.id.startsWith(o)) ? null : test({ tenant: "RealTest Construction", ...m }, f));
const mgr = new Client("manager(MANAGER)"); await mgr.login("manager@realtest.com", PW);
const admin = new Client("admin(ADMIN)"); await admin.login("admin@realtest.com", PW);
const sup = new Client("super(SUPERINTENDENT)"); await sup.login("super@realtest.com", PW);
const proc = new Client("procurement@(MANAGER)"); await proc.login("procurement@realtest.com", PW);
const wkr = new Client("worker(FIELD_WORKER)"); await wkr.login("worker@realtest.com", PW);
const ok = (r) => r.status >= 200 && r.status < 300;
const j = (r) => JSON.stringify(r.data).slice(0, 250);
const contractVal = async () => Number((await mgr.get(`/api/projects/${S.projectCode}`)).data.contractAmount);

await t({ id: "CTR-EXEC-001", title: "Prime contract workflow DRAFT -> IN_REVIEW -> PENDING_APPROVAL -> APPROVED -> EXECUTED", module: "Contracts", role: "MANAGER + ADMIN", req: "contractRoutes.ts:383 transitions", expected: "Each transition 200; final EXECUTED" }, async (ctx) => {
  ctx.clients.push(mgr, admin);
  const id = S.contractId; const steps = [];
  steps.push(["IN_REVIEW", (await mgr.post(`/api/contracts/${id}/transition`, { newStatus: "IN_REVIEW" })).status]);
  const adminId = (await admin.get("/api/auth/me")).data.user.id;
  steps.push(["request-approval", (await mgr.post(`/api/contracts/${id}/request-approval`, { reviewerIds: [adminId] })).status]);
  steps.push(["approve", (await admin.post(`/api/contracts/${id}/approve`, {})).status]);
  steps.push(["EXECUTED", (await admin.post(`/api/contracts/${id}/transition`, { newStatus: "EXECUTED", signatureDate: "2026-05-28", signatoryNames: "TEST ONLY signatories (SYNTHETIC)" })).status]);
  const c = (await mgr.get(`/api/contracts?projectId=${S.projectId}`)).data[0];
  ctx.notes.push(JSON.stringify(steps), `final ${c.status}`);
  expect(c.status === "EXECUTED", `steps ${JSON.stringify(steps)} final ${c.status}`);
});

await t({ id: "SUB-001", title: "Subcontract with SOV, approval and progress claim with retention; overbilling blocked", module: "Subcontracts", role: "MANAGER", req: "subcontractRoutes.ts:348; subcontractManagementRoutes.ts:566,627", expected: "Subcontract 201; SOV lines; pay app; line overbilling 400; approve" }, async (ctx) => {
  ctx.clients.push(mgr);
  const so = await mgr.post("/api/crm/organisations", { name: `${RUN_ID} Fictional Saw-Cut Sub LLC (TEST)`, type: "SUBCONTRACTOR", email: "qa-sub-sink@example.test" });
  expect(ok(so), `sub org ${so.status} ${j(so)}`); S.subOrgId = so.data.id;
  const sc = await mgr.post("/api/subcontracts", { subcontractorId: S.subOrgId, projectId: S.projectId, scopeOfWork: "Saw cut & demo per src R13/R19 (TEST ONLY — NOT VALID FOR BUSINESS USE)", contractAmount: "58680.00", retentionPercent: "10", costCode: "01-002" });
  expect(ok(sc), `subcontract ${sc.status} ${j(sc)}`); S.subcontractId = (sc.data.contract ?? sc.data).id; save();
  for (const [d, v] of [["Saw cut revised pricing (src R13)", "30130.00"], ["4 openings + 3x3 piers (src R19)", "28550.00"]]) {
    const r = await mgr.post(`/api/subcontracts/${S.subcontractId}/sov`, { description: d, scheduledValue: v }); expect(ok(r), `sub sov ${r.status} ${j(r)}`);
  }
  const pa = await mgr.post(`/api/subcontracts/${S.subcontractId}/pay-applications`, { periodTo: "2026-06-30" });
  expect(ok(pa), `sub pay app ${pa.status} ${j(pa)}`); const paId = (pa.data.payApplication ?? pa.data).id; S.subPayAppId = paId; save();
  const det = await mgr.get(`/api/subcontracts/${S.subcontractId}/pay-applications/${paId}`);
  const lines = det.data.lineItems ?? det.data.payApplication?.lineItems ?? [];
  ctx.notes.push(`pay app detail ${det.status} lines ${lines.length} ${j(det)}`);
  if (lines.length) {
    const over = await mgr.patch(`/api/subcontracts/${S.subcontractId}/pay-applications/${paId}/line-items`, { lineItems: [{ id: lines[0].id, completedThisPeriod: "40000.00", materialsStored: "0" }] });
    const good = await mgr.patch(`/api/subcontracts/${S.subcontractId}/pay-applications/${paId}/line-items`, { lineItems: [{ id: lines[0].id, completedThisPeriod: "15065.00", materialsStored: "0" }] });
    ctx.notes.push(`overbill ${over.status} ${j(over)}; 50% ${good.status}`);
    expect(over.status === 400 && ok(good), `overbill ${over.status} / valid ${good.status} ${j(good)}`);
  } else expect(false, "no pay app line items returned to update");
  const sub = await mgr.patch(`/api/subcontracts/${S.subcontractId}/pay-applications/${paId}/status`, { status: "SUBMITTED" });
  const apv = await mgr.patch(`/api/subcontracts/${S.subcontractId}/pay-applications/${paId}/status`, { status: "APPROVED" });
  ctx.notes.push(`submit ${sub.status} approve ${apv.status} ${j(apv)}`);
  expect(ok(sub) && ok(apv), `status ${sub.status}/${apv.status}`);
});

await t({ id: "PROC-001", title: "PO -> approve -> partial receipt -> invoice -> 3-way match -> payment; duplicate invoice #; overpayment", module: "Procurement", role: "MANAGER (procurement@)", req: "procurementModuleRoutes.ts:1040-2391", expected: "PO approved; MATCHED for received qty; duplicate invoice number rejected; payment > invoice rejected" }, async (ctx) => {
  ctx.clients.push(proc);
  const v = await proc.post("/api/crm/organisations", { name: `${RUN_ID} Fictional Rebar Supply Co (TEST)`, type: "SUPPLIER" }); expect(ok(v), `vendor ${v.status} ${j(v)}`); S.vendorId = v.data.id;
  const po = await proc.post("/api/procurement-module/orders", { projectId: S.projectId, vendorId: S.vendorId, neededByDate: "2026-07-01", notes: `${RUN_ID} TEST ONLY`, items: [{ description: "Rebar #5/#6 (src R24: 31,752 lbs @ $0.84)", quantity: "31752", unit: "lbs", unitCost: "0.84", costCode: "03-001" }] });
  expect(ok(po), `po ${po.status} ${j(po)}`); const P = po.data.order ?? po.data; S.poId = P.id; save();
  const sub = await proc.post(`/api/procurement-module/orders/${S.poId}/submit`, {}); const ap = await proc.post(`/api/procurement-module/orders/${S.poId}/approve`, {});
  ctx.notes.push(`submit ${sub.status} ${j(sub)} approve ${ap.status} ${j(ap)}`);
  const g = await proc.get(`/api/procurement-module/orders/${S.poId}`); const items = g.data.items ?? g.data.order?.items ?? [];
  ctx.notes.push(`po status ${(g.data.order ?? g.data).status} items ${items.length}`);
  const rc = await proc.post(`/api/procurement-module/orders/${S.poId}/receipts`, { items: [{ poItemId: items[0]?.id, quantityReceived: "15876", condition: "GOOD" }], notes: "Delivery ticket DT-QA-0001 (SYNTHETIC)" });
  ctx.notes.push(`receipt ${rc.status} ${j(rc)}`);
  const inv = await proc.post("/api/procurement-module/invoices", { poId: S.poId, invoiceNumber: `INV-${RUN_ID}-1`, invoiceDate: "2026-06-20", totalAmount: "13335.84" });
  const dup = await proc.post("/api/procurement-module/invoices", { poId: S.poId, invoiceNumber: `INV-${RUN_ID}-1`, invoiceDate: "2026-06-21", totalAmount: "13335.84" });
  const invId = (inv.data.invoice ?? inv.data).id; S.invoiceId = invId; save();
  const m = await proc.post(`/api/procurement-module/invoices/${invId}/match`, {});
  const pay = await proc.post(`/api/procurement-module/invoices/${invId}/payments`, { amount: "99999.00", paymentDate: "2026-06-30", method: "ACH", reference: "QA-NO-MONEY-MOVED" });
  ctx.notes.push(`invoice ${inv.status}; dup ${dup.status}; match ${m.status} ${j(m)}; overpay ${pay.status} ${j(pay)}`);
  const probs = [];
  if (!ok(ap)) probs.push(`PO approve ${ap.status}`); if (!ok(rc)) probs.push(`receipt ${rc.status}`); if (!ok(inv)) probs.push(`invoice ${inv.status}`);
  if (ok(dup)) probs.push(`duplicate invoice number accepted (${dup.status})`);
  if (!/MATCHED/.test(JSON.stringify(m.data))) probs.push(`match result not MATCHED: ${j(m)}`);
  if (ok(pay)) probs.push(`payment $99,999 against $13,335.84 invoice accepted (${pay.status})`);
  expect(!probs.length, probs.join("; "));
});

await t({ id: "RFI-001", title: "RFI create -> submit -> answer -> close with audit", module: "RFIs", role: "SUPERINTENDENT + MANAGER", req: "rfiRoutes.ts:582", expected: "RFI-NNN numbered; statuses progress; answer persisted" }, async (ctx) => {
  ctx.clients.push(sup, mgr);
  const r = await sup.post("/api/rfi", { projectId: S.projectId, subject: `${RUN_ID} Pad volume: 5.44 CY/pad x162 = 881.28 vs takeoff 1,014 CY (src A27/B27)`, question: "Please confirm spread footing dimensions/quantity. SYNTHETIC QA RFI.", priority: "HIGH" });
  expect(ok(r), `rfi ${r.status} ${j(r)}`); const id = (r.data.rfi ?? r.data).id; S.rfiId = id; save();
  const s = await sup.post(`/api/rfi/${id}/submit`, {}); const a = await mgr.post(`/api/rfi/${id}/answer`, { answer: "SYNTHETIC answer: use 1,014 CY pending engineer confirmation." }); const c = await mgr.post(`/api/rfi/${id}/close`, {});
  const g = await mgr.get(`/api/rfi/${id}`); const rf = g.data.rfi ?? g.data;
  ctx.notes.push(`submit ${s.status} answer ${a.status} ${j(a)} close ${c.status}; number ${rf.rfiNumber} status ${rf.status}`);
  expect(ok(s) && ok(a) && ok(c) && /CLOSED/i.test(rf.status), ctx.notes.at(-1));
});

await t({ id: "SUBM-001", title: "Submittal submit -> reject -> revise -> resubmit -> approve", module: "Submittals", role: "SUPERINTENDENT + MANAGER", req: "Submittal state machine", expected: "All transitions succeed; revision number increments" }, async (ctx) => {
  ctx.clients.push(sup, mgr);
  const r = await mgr.post("/api/submittals", { projectId: S.projectId, subject: `${RUN_ID} Crackbond CSR product data (alternate ALT-1) SYNTHETIC`, specSection: "03 01 30" });
  expect(ok(r), `create ${r.status} ${j(r)}`); const id = (r.data.submittal ?? r.data).id;
  const steps = [];
  let cur = id;
  for (const [who, path, body] of [[mgr, "submit", {}], [mgr, "review", {}], [mgr, "reject", { reviewComments: "QA: missing SDS" }], [mgr, "resubmit", {}], [mgr, "submit", {}], [mgr, "review", {}], [mgr, "approve", { reviewComments: "QA approved (SYNTHETIC)" }]]) {
    const x = await who.post(`/api/submittals/${cur}/${path}`, body); steps.push(`${path}:${x.status}${ok(x) ? "" : " " + j(x)}`);
    if (path === "resubmit" && ok(x)) { const nid = (x.data.submittal ?? x.data).id; if (nid && nid !== cur) { steps.push(`new revision record ${nid}`); cur = nid; } }
  }
  const g = await mgr.get(`/api/submittals/${cur}`); const sm = g.data.submittal ?? g.data;
  const orig = (await mgr.get(`/api/submittals/${id}`)).data; ctx.notes.push(`original status ${(orig.submittal ?? orig).status}`);
  ctx.notes.push(steps.join(" | "), `final ${sm.status} rev ${sm.revisionNumber ?? sm.revision}`);
  expect(steps.filter((x) => !x.startsWith("new")).every((x) => /:2\d\d$/.test(x)) && /APPROVED/.test(sm.status), steps.join(" | ") + ` final ${sm.status}`);
});

await t({ id: "CO-001", title: "Change orders: approve (+), reject, negative (deduct) approve; propagation to contract/SOV/budget exactly once", module: "Change Orders", role: "SUPERINTENDENT + MANAGER", req: "changeOrderCrudRoutes.ts:405,480-600; aiaBillingRoutes.ts:1751", expected: "Approved +$12,500 and -$2,000 raise contract by exactly $10,500 (to 792,552.11); rejected CO changes nothing; SOV gains CO lines; re-approve rejected" }, async (ctx) => {
  ctx.clients.push(sup, mgr);
  const before = await contractVal();
  const sovBefore = (await mgr.get(`/api/sov?projectId=${S.projectId}`)).data[0];
  const mk = async (amount, desc) => { const r = await sup.post("/api/change-orders", { projectId: S.projectId, contractId: S.contractId, title: desc, description: `${RUN_ID} ${desc} (SYNTHETIC)`, amount: String(amount) }); if (!ok(r)) throw new Error(`create CO ${r.status} ${j(r)}`); return (r.data.changeOrder ?? r.data).id; };
  const co1 = await mk(12500, "Add 2 dock-door piers"), co2 = await mk(5000, "Owner requested polish (to be rejected)"), co3 = await mk(-2000, "Delete forming material credit");
  S.cos = { co1, co2, co3 }; save();
  const res = {};
  for (const [k, id] of Object.entries(S.cos)) res[k + "submit"] = (await sup.post(`/api/change-orders/${id}/submit`, {})).status;
  res.co1approve = (await mgr.post(`/api/change-orders/${co1}/approve`, {})).status;
  res.co2reject = (await mgr.post(`/api/change-orders/${co2}/reject`, { rejectionReason: "QA rejection: owner declined (SYNTHETIC)" })).status;
  res.co3approve = (await mgr.post(`/api/change-orders/${co3}/approve`, {})).status;
  res.co1reapprove = (await mgr.post(`/api/change-orders/${co1}/approve`, {})).status;
  const after = await contractVal();
  const sovAfter = (await mgr.get(`/api/sov?projectId=${S.projectId}`)).data[0];
  const bl = (await mgr.get(`/api/projects/${S.projectCode}/budget-lines`)).data.lines; const budTot = money(bl.reduce((a, x) => a + Number(x.totalBudget), 0));
  ctx.notes.push(JSON.stringify(res), `contract ${before} -> ${after}`, `SOV lines ${sovBefore.lineItems.length} -> ${sovAfter.lineItems.length}; SOV contractValue ${sovBefore.contractValue} -> ${sovAfter.contractValue}; scheduled sum ${money(sovAfter.lineItems.reduce((a, x) => a + Number(x.scheduledValue), 0))}`, `budget lines total now ${budTot}`);
  S.coResult = { before, after, budTot, sovLines: sovAfter.lineItems.length, sovContract: sovAfter.contractValue }; save();
  const probs = [];
  if (money(after - before) !== 10500) probs.push(`contract delta ${money(after - before)} (expected 10500)`);
  if (res.co2reject >= 300) probs.push(`reject ${res.co2reject}`);
  if (res.co1reapprove < 400) probs.push(`re-approve returned ${res.co1reapprove}`);
  if (sovAfter.lineItems.length !== sovBefore.lineItems.length + 2) probs.push(`SOV lines ${sovBefore.lineItems.length}->${sovAfter.lineItems.length} (expected +2)`);
  expect(!probs.length, probs.join("; ") + " | " + JSON.stringify(res));
});

await t({ id: "CO-002", title: "Approved CO amount (price) added to cost budget", module: "Change Orders/Budget", role: "MANAGER", mode: "API integration + static", req: "changeOrderCrudRoutes.ts:480-505; budget = cost", expected: "Cost budget increases by CO cost (not stated) or not at all; revenue not added as 'other' cost", }, async (ctx) => {
  ctx.clients.push(mgr);
  const bl = (await mgr.get(`/api/projects/${S.projectCode}/budget-lines`)).data.lines;
  const coLines = bl.filter((x) => /change order|CO-/i.test(x.description || "") || x.costCode === "CO");
  ctx.notes.push(`budget total ${S.coResult.budTot}; CO-ish lines: ${JSON.stringify(coLines.map((x) => [x.costCode, x.description, x.otherBudget]))}`);
  expect(money(S.coResult.budTot - 782052.11) === 0, `budget total moved by ${money(S.coResult.budTot - 782052.11)} after approving COs — CO sell amount booked as cost budget`);
});

await t({ id: "JC-001", title: "Approved labor posts to job-cost actuals at the employee cost rate", module: "Job Cost", role: "ADMIN + SUPERINTENDENT", req: "Prompt §5 'Reconcile time and production to job-cost reports'", expected: "After rate $45/h set (SYNTHETIC) and 8h approved, cost-ledger actualLabor increases by $360" }, async (ctx) => {
  ctx.clients.push(admin, wkr, sup, mgr);
  const led = async () => { const r = (await mgr.get(`/api/projects/${S.projectCode}/cost-ledger`)).data; return money((r.rows ?? []).reduce((a, x) => a + Number(x.actualLabor || 0), 0)) + money(Number(r.unallocated?.actualLabor || r.totals?.unallocatedLabor || 0)); };
  const u = await admin.patch(`/api/users/${S.workerId}`, { costRateRegular: "45.00", costRateOvertime: "67.50" });
  ctx.notes.push(`set rate ${u.status} ${j(u)}`);
  const before = await led();
  const te = await wkr.post("/api/time-entries", { projectId: S.projectId, date: "2026-10-07", hoursRegular: "8", costCode: "01-001", description: `${RUN_ID} JC test` });
  const id = te.data?.id ?? te.data?.timeEntry?.id;
  const ap = await sup.post(`/api/time-entries/${id}/approve`, {});
  const after = await led();
  const totals = (await mgr.get(`/api/projects/${S.projectCode}/cost-ledger`)).data.totals;
  ctx.notes.push(`entry ${te.status} approve ${ap.status} ${j(ap)}; actualLabor ${before} -> ${after}; totals ${JSON.stringify(totals).slice(0, 400)}`);
  expect(money(after - before) === 360, `actualLabor delta ${money(after - before)} (expected 360)`);
});

await t({ id: "CO-003", title: "SOV, contract and project contract amount stay reconciled after COs approved before and after contract execution", module: "Change Orders/SOV", role: "MANAGER", req: "Prompt §5 'approved changes propagate once to ... contract ... billing'; aiaBillingRoutes.ts:1751 syncApprovedCOToSOV; changeOrderCrudRoutes.ts:569-600", expected: "sum(SOV scheduledValue) = SOV.contractValue = contract.contractValue = project.contractAmount" }, async (ctx) => {
  ctx.clients.push(mgr);
  const sov = (await mgr.get(`/api/sov?projectId=${S.projectId}`)).data[0];
  const c = (await mgr.get(`/api/contracts?projectId=${S.projectId}`)).data[0];
  const p = (await mgr.get(`/api/projects/${S.projectCode}`)).data;
  const cos = (await mgr.get(`/api/change-orders?projectId=${S.projectId}`)).data; const list = Array.isArray(cos) ? cos : cos.changeOrders ?? cos.data ?? [];
  const sumLines = money(sov.lineItems.reduce((a, x) => a + Number(x.scheduledValue), 0));
  ctx.notes.push(`SOV lines ${sov.lineItems.length} sum ${sumLines}; SOV.contractValue ${sov.contractValue}; contract ${c.contractValue} (${c.status}); project ${p.contractAmount}`, `COs: ${JSON.stringify(list.map((x) => [x.changeOrderNumber, x.status, x.amount]))}`, "Sequence: 2 COs (+12,500, -2,000) approved while prime contract DRAFT (first CO-001 attempt, results.harness-debug.jsonl), then 2 more after EXECUTED.");
  const vals = [sumLines, Number(sov.contractValue), Number(c.contractValue), Number(p.contractAmount)];
  expect(vals.every((v) => Math.abs(v - vals[0]) < 0.01), `values diverge: SOV lines ${sumLines} / SOV.contractValue ${sov.contractValue} / contract ${c.contractValue} / project ${p.contractAmount}`);
});
