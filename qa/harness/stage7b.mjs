// FALLBACK billing chain (prompt §5: upstream bug SOV-PROG-001 blocks primary; fallback tests downstream math independently; NOT an uninterrupted E2E pass)
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { Client, test, expect, RUN_ID, RUN_DIR, money } from "./lib.mjs";
const PW = process.env.SMA_QA_ADMIN_PASSWORD;
const S = JSON.parse(fs.readFileSync(`${RUN_DIR}/state.json`));
const save = () => fs.writeFileSync(`${RUN_DIR}/state.json`, JSON.stringify(S, null, 1));
const mgr = new Client("manager(MANAGER)"); await mgr.login("manager@realtest.com", PW);
const admin = new Client("admin(ADMIN)"); await admin.login("admin@realtest.com", PW);
const ok = (r) => r.status >= 200 && r.status < 300; const j = (r) => JSON.stringify(r.data).slice(0, 300);
const OUT = `${RUN_DIR}/evidence/docs`;
const FX = JSON.parse(fs.readFileSync(`${RUN_DIR}/fixtures/billing_expected.json`));
const base = (await mgr.get(`/api/sov?projectId=${S.projectId}`)).data.find((s) => s.periodNumber === 1).lineItems.filter((l) => /^\[R\d+\]/.test(l.description)).sort((a, b) => a.lineNumber - b.lineNumber);
const rowOf = (l) => Number(l.description.match(/^\[R(\d+)\]/)[1]);
const T = (m, f) => test({ tenant: "RealTest Construction", module: "Progress Billing (FALLBACK)", role: "MANAGER + ADMIN", mode: "API integration (fallback seed)", ...m }, f);
if (!S.fb) {
  const p = await mgr.post("/api/projects", { name: `${RUN_ID} FALLBACK-BILLING (00420 SOV copy; see SOV-PROG-001)`, clientName: `${RUN_ID} Fictional Owner GC LLC (TEST)`, status: "ACTIVE", contractAmount: "782052.11" });
  S.fb = { projectId: p.data.id, code: p.data.code, apps: {} }; save();
}
let prev = {}; let prevEarned = 0;
for (const [i, per] of FX.periods.entries()) {
  const e = FX.expected[i];
  await T({ id: `PAY-FB-00${per.n}`, title: `Fallback pay application #${per.n} (period to ${per.periodTo})`, req: "aiaBillingRoutes.ts:293-400; fixtures/billing_expected.json (independent G702 math)", expected: `completed&stored ${e.completedAndStored}; retainage ${e.retainage}; less previous ${e.lessPrevious}; current due ${e.currentDue}` }, async (ctx) => {
    ctx.clients.push(mgr, admin);
    const lineItems = base.map((l, k) => { const r = rowOf(l); return { lineNumber: k + 1, description: l.description, scheduledValue: l.scheduledValue, previouslyCompleted: String(money(prev[r] || 0)), thisPeriodCompleted: String(per.work[r] || 0), materialsStored: String(per.stored[r] || 0) }; });
    const sv = await mgr.post("/api/sov", { projectId: S.fb.projectId, title: `${RUN_ID} FB period ${per.n}`, contractValue: "782052.11", retainagePercent: "10", periodEnd: per.periodTo, lineItems });
    expect(sv.status === 201, `sov ${sv.status} ${j(sv)}`);
    ctx.notes.push(`SOV totals: completedToDate ${sv.data.totalCompletedToDate} stored ${sv.data.totalMaterialsStored} retainage ${sv.data.totalRetainage}`);
    const pa = await mgr.post("/api/aia-billing/pay-applications", { projectId: S.fb.projectId, sovId: sv.data.id, periodTo: per.periodTo, ownerName: "Fictional Owner (TEST)", contractorName: "RealTest Construction (QA)" });
    expect(pa.status === 201, `create ${pa.status} ${j(pa)}`); const app = pa.data; S.fb.apps[per.n] = app.id; save();
    fs.writeFileSync(`${RUN_DIR}/evidence/api/payapp-FB-${per.n}-created.json`, JSON.stringify(app, null, 1));
    if (per.n === 2) {
      const s1 = await mgr.patch(`/api/aia-billing/pay-applications/${app.id}/status`, { status: "SUBMITTED" });
      const dupSubmit = await mgr.patch(`/api/aia-billing/pay-applications/${app.id}/status`, { status: "SUBMITTED" });
      const rj = await admin.patch(`/api/aia-billing/pay-applications/${app.id}/status`, { status: "REJECTED", rejectionReason: "QA: owner requests backup for R27 quantities (SYNTHETIC)" });
      const dr = await mgr.patch(`/api/aia-billing/pay-applications/${app.id}/status`, { status: "DRAFT" });
      ctx.notes.push(`reject/revise path: submit ${s1.status}, duplicate submit ${dupSubmit.status}, reject ${rj.status}, back-to-draft ${dr.status}`);
    }
    const s = await mgr.patch(`/api/aia-billing/pay-applications/${app.id}/status`, { status: "SUBMITTED" });
    const a = await admin.patch(`/api/aia-billing/pay-applications/${app.id}/status`, { status: "APPROVED" });
    const fin = (await mgr.get(`/api/aia-billing/pay-applications/${app.id}`)).data; const F = fin.payApplication ?? fin;
    const got = { completedAndStored: money(F.totalCompletedAndStored), retainage: money(F.totalRetained ?? F.totalRetainage), earned: money(F.totalEarnedLessRetainage), lessPrev: money(F.lessPreviousCertificates), due: money(F.currentPaymentDue), contractSum: money(F.contractSumToDate), app: F.applicationNumber };
    ctx.notes.push(`submit ${s.status} approve ${a.status}`, `app: ${JSON.stringify(got)}`, `expected: ${JSON.stringify(e)}`);
    const dueStr = e.currentDue.toLocaleString("en-US", { minimumFractionDigits: 2 });
    for (const k of ["g702", "g703"]) { const r = await mgr.get(`/api/aia-billing/pay-applications/${app.id}/${k}-pdf`, { raw: true }); const f = `${OUT}/PAY-FB-00${per.n}-${k}.pdf`; fs.writeFileSync(f, r.data); ctx.evidence.push(f.replace(RUN_DIR + "/", "")); if (r.status === 200 && r.data.slice(0, 4).toString() === "%PDF") { const txt = execFileSync("pdftotext", ["-layout", f, "-"]).toString(); fs.writeFileSync(f + ".txt", txt); ctx.notes.push(`${k}.pdf ok pages=${(txt.match(/\f/g) || []).length}; contains current due ${dueStr}: ${txt.includes(dueStr)}`); } else ctx.notes.push(`${k}.pdf HTTP ${r.status}`); }
    for (const [r, v] of Object.entries(per.work)) prev[r] = money((prev[r] || 0) + v);
    const diffs = [["completedAndStored", got.completedAndStored, e.completedAndStored], ["retainage", got.retainage, e.retainage], ["lessPrevious", got.lessPrev, e.lessPrevious], ["currentDue", got.due, e.currentDue]].filter(([, g, x]) => Math.abs(g - x) > 0.011).map(([k, g, x]) => `${k} app ${g} vs expected ${x} (Δ ${money(g - x)})`);
    expect(ok(s) && ok(a), `submit ${s.status} approve ${a.status} ${j(a)}`);
    expect(!diffs.length, diffs.join("; "));
  });
}
await T({ id: "PAY-FB-NEG-001", title: "Duplicate pay application on an SOV that already has an approved application", req: "Prompt §5 duplicate submission", expected: "4xx" }, async (ctx) => {
  ctx.clients.push(mgr);
  const app3 = (await mgr.get(`/api/aia-billing/pay-applications/${S.fb.apps[3]}`)).data; const A = app3.payApplication ?? app3;
  const r = await mgr.post("/api/aia-billing/pay-applications", { projectId: S.fb.projectId, sovId: A.sovId, periodTo: "2026-08-31" });
  ctx.notes.push(`dup -> ${r.status} #${r.data.applicationNumber} due ${r.data.currentPaymentDue} completed ${r.data.totalCompletedAndStored}`);
  expect(r.status >= 400, `duplicate accepted (${r.status}) as app #${r.data.applicationNumber}, completed&stored ${r.data.totalCompletedAndStored}, current due ${r.data.currentPaymentDue}`);
});
await T({ id: "PAY-FB-NEG-002", title: "Overbilling: SOV line with completed > scheduled value", req: "Prompt §5 attempted overbilling", expected: "4xx or capped at scheduled value" }, async (ctx) => {
  ctx.clients.push(mgr);
  const l = base.find((x) => rowOf(x) === 11);
  const r = await mgr.post("/api/sov", { projectId: S.fb.projectId, title: `${RUN_ID} FB overbill probe`, contractValue: "782052.11", retainagePercent: "10", lineItems: [{ lineNumber: 1, description: l.description, scheduledValue: l.scheduledValue, previouslyCompleted: "58463", thisPeriodCompleted: "10000" }] });
  const li = r.data.lineItems?.[0] ?? {};
  ctx.notes.push(`status ${r.status}; line totalCompletedAndStored ${li.totalCompletedAndStored} pct ${li.percentComplete} balance ${li.balanceToFinish}; sov completedToDate ${r.data.totalCompletedToDate}`);
  expect(r.status >= 400 || Number(r.data.totalCompletedToDate) <= Number(l.scheduledValue), `accepted ${r.status}: completedToDate ${r.data.totalCompletedToDate} > scheduled ${l.scheduledValue} (percent shown ${li.percentComplete})`);
});
await T({ id: "PAY-FB-PMT-001", title: "Record payment receipt on approved app #1 (fixture only, no funds); overpayment rejected", req: "aiaBillingRoutes.ts:539-600", expected: "payment of current due -> PAID; further payment 400" }, async (ctx) => {
  ctx.clients.push(mgr);
  const id = S.fb.apps[1]; const A0 = (await mgr.get(`/api/aia-billing/pay-applications/${id}`)).data; const A = A0.payApplication ?? A0;
  const p1 = await mgr.post(`/api/aia-billing/pay-applications/${id}/record-payment`, { amount: Number(A.currentPaymentDue), paymentReference: "QA-RECEIPT-0001 (SYNTHETIC; no funds moved)", paymentMethod: "OTHER" });
  const p2 = await mgr.post(`/api/aia-billing/pay-applications/${id}/record-payment`, { amount: 1, paymentReference: "QA overpay probe" });
  const after = (await mgr.get(`/api/aia-billing/pay-applications/${id}`)).data; const B = after.payApplication ?? after;
  ctx.notes.push(`pay ${p1.status} ${j(p1)}; overpay ${p2.status} ${j(p2)}; status ${B.status}`);
  expect(ok(p1) && p2.status >= 400 && B.status === "PAID", `payment ${p1.status}; overpay ${p2.status}; status ${B.status}`);
});
