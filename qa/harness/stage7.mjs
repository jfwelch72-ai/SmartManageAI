import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { Client, test, expect, RUN_ID, RUN_DIR, money } from "./lib.mjs";
const PW = process.env.SMA_QA_ADMIN_PASSWORD;
const S = JSON.parse(fs.readFileSync(`${RUN_DIR}/state.json`));
const save = () => fs.writeFileSync(`${RUN_DIR}/state.json`, JSON.stringify(S, null, 1));
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
const t = (m, f) => (ONLY.length && !ONLY.some((o) => m.id.startsWith(o)) ? null : test({ tenant: "RealTest Construction", ...m }, f));
const mgr = new Client("manager(MANAGER)"); await mgr.login("manager@realtest.com", PW);
const admin = new Client("admin(ADMIN)"); await admin.login("admin@realtest.com", PW);
const ok = (r) => r.status >= 200 && r.status < 300; const j = (r) => JSON.stringify(r.data).slice(0, 300);
const OUT = `${RUN_DIR}/evidence/docs`; fs.mkdirSync(OUT, { recursive: true });
// SYNTHETIC billing fixture: dollars of work completed per source row per period (independent of app math)
const PERIODS = [
  { n: 1, periodTo: "2026-06-30", work: { 11: 58463.00, 13: 17723.53, 28: 58285.72, 16: 1714.29 }, stored: {} },
  { n: 2, periodTo: "2026-07-31", work: { 13: 17723.53, 28: 58285.72, 24: 38102.40, 27: 159342.86 }, stored: { 25: 1822.86 } },
  { n: 3, periodTo: "2026-08-31", work: { 27: 159342.85, 29: 38571.43, 25: 1822.86 }, stored: { 25: 0 } },
];
const RET = 0.10;
// independent expected (AIA G702: completed & stored to date, retainage on that, earned less retainage, less previous certificates)
const exp = []; let prevCompleted = 0, prevEarned = 0;
for (const p of PERIODS) { const thisP = money(Object.values(p.work).reduce((a, b) => a + b, 0)); const stored = money(Object.values(p.stored).reduce((a, b) => a + b, 0));
  const cs = money(prevCompleted + thisP + stored); const ret = money(cs * RET); const earned = money(cs - ret); const due = money(earned - prevEarned);
  exp.push({ n: p.n, thisPeriod: thisP, storedToDate: stored, completedAndStored: cs, retainage: ret, earnedLessRetainage: earned, lessPrevious: prevEarned, currentDue: due }); prevCompleted = money(prevCompleted + thisP); prevEarned = earned; }
fs.writeFileSync(`${RUN_DIR}/fixtures/billing_expected.json`, JSON.stringify({ synthetic: true, retainage: "10% on completed & stored (no reduction)", rounding: "cents, half-up per field", periods: PERIODS, expected: exp }, null, 1));
const sovFor = async (n) => (await mgr.get(`/api/sov?projectId=${S.projectId}`)).data.find((s) => s.periodNumber === n);
const lineForRow = (sov, row) => sov.lineItems.find((l) => l.description?.startsWith(`[R${row}]`));
S.payApps = S.payApps || {};

for (const p of PERIODS) {
  const e = exp[p.n - 1];
  await t({ id: `PAY-00${p.n}`, title: `Pay application #${p.n} (period to ${p.periodTo}) computed and approved`, module: "Progress Billing", role: "MANAGER", req: "aiaBillingRoutes.ts:293-400; sovRoutes.ts line PATCH; fixtures/billing_expected.json", expected: `completed&stored ${e.completedAndStored}; retainage ${e.retainage}; less previous ${e.lessPrevious}; current due ${e.currentDue}` }, async (ctx) => {
    ctx.clients.push(mgr);
    let sov = await sovFor(p.n);
    if (!sov && p.n > 1) { const rf = await mgr.post("/api/aia-billing/pay-applications/roll-forward", { sovId: (await sovFor(p.n - 1)).id, periodTo: p.periodTo }); ctx.notes.push(`roll-forward ${rf.status} ${j(rf)}`); sov = await sovFor(p.n); }
    expect(sov, `no SOV for period ${p.n}`);
    for (const [row, amt] of Object.entries(p.work)) { const li = lineForRow(sov, row); const body = { thisPeriodCompleted: String(amt) }; if (p.stored[row] !== undefined) body.materialsStored = String(p.stored[row]); const r = await mgr.patch(`/api/sov/${sov.id}/line-items/${li.id}`, body); if (!ok(r)) throw new Error(`line R${row} ${r.status} ${j(r)}`); }
    for (const [row, amt] of Object.entries(p.stored)) { if (p.work[row] !== undefined) continue; const li = lineForRow(sov, row); const r = await mgr.patch(`/api/sov/${sov.id}/line-items/${li.id}`, { materialsStored: String(amt) }); if (!ok(r)) throw new Error(`stored R${row} ${r.status} ${j(r)}`); }
    const pa = await mgr.post("/api/aia-billing/pay-applications", { projectId: S.projectId, sovId: sov.id, periodTo: p.periodTo, ownerName: "Fictional Owner (TEST)", contractorName: "RealTest Construction (QA tenant)" });
    expect(pa.status === 201, `create ${pa.status} ${j(pa)}`); const app = pa.data; S.payApps[p.n] = app.id; save();
    const got = { completedAndStored: money(app.totalCompletedAndStored ?? app.totalCompletedToDate), retainage: money(app.totalRetainage ?? app.retainageAmount), earned: money(app.totalEarnedLessRetainage), lessPrev: money(app.lessPreviousCertificates), due: money(app.currentPaymentDue), contractSum: money(app.contractSumToDate) };
    ctx.notes.push(`app fields: ${JSON.stringify(got)}`, `expected: ${JSON.stringify(e)}`);
    fs.writeFileSync(`${RUN_DIR}/evidence/api/payapp-${p.n}-created.json`, JSON.stringify(app, null, 1));
    if (p.n === 2) { // rejection & revision path
      const s1 = await mgr.patch(`/api/aia-billing/pay-applications/${app.id}/status`, { status: "SUBMITTED" });
      const rj = await admin.patch(`/api/aia-billing/pay-applications/${app.id}/status`, { status: "REJECTED", rejectionReason: "QA: owner requests backup for R27 quantities (SYNTHETIC)" });
      const dr = await mgr.patch(`/api/aia-billing/pay-applications/${app.id}/status`, { status: "DRAFT" });
      ctx.notes.push(`reject path: submit ${s1.status} reject ${rj.status} back-to-draft ${dr.status}`);
    }
    const s = await mgr.patch(`/api/aia-billing/pay-applications/${app.id}/status`, { status: "SUBMITTED" });
    const a = await admin.patch(`/api/aia-billing/pay-applications/${app.id}/status`, { status: "APPROVED" });
    ctx.notes.push(`submit ${s.status} approve ${a.status} ${ok(a) ? "" : j(a)}`);
    for (const k of ["g702", "g703"]) { const r = await mgr.get(`/api/aia-billing/pay-applications/${app.id}/${k}-pdf`, { raw: true }); const f = `${OUT}/PAY-00${p.n}-${k}.pdf`; fs.writeFileSync(f, r.data); ctx.evidence.push(f.replace(RUN_DIR + "/", "")); if (r.status === 200 && r.data.slice(0, 4).toString() === "%PDF") { const txt = execFileSync("pdftotext", ["-layout", f, "-"]).toString(); fs.writeFileSync(f + ".txt", txt); ctx.notes.push(`${k} PDF ok; has due ${e.currentDue.toLocaleString("en-US", { minimumFractionDigits: 2 })}: ${txt.includes(e.currentDue.toLocaleString("en-US", { minimumFractionDigits: 2 }))}`); } else ctx.notes.push(`${k} PDF status ${r.status}`); }
    const diffs = [["completedAndStored", got.completedAndStored, e.completedAndStored], ["retainage", got.retainage, e.retainage], ["lessPrevious", got.lessPrev, e.lessPrevious], ["currentDue", got.due, e.currentDue]].filter(([, g, x]) => Math.abs(g - x) > 0.011).map(([k, g, x]) => `${k} app ${g} vs expected ${x}`);
    expect(ok(s) && ok(a), `status submit ${s.status} approve ${a.status} ${j(a)}`);
    expect(!diffs.length, diffs.join("; "));
    return { actual: `#${app.applicationNumber}: ${JSON.stringify(got)}` };
  });
  if (p.n < 3) {
    // record payment for approved app (fixture: payment receipt record only, no money moved)
  }
}

await t({ id: "PAY-NEG-001", title: "Duplicate pay application for the same SOV period", module: "Progress Billing", role: "MANAGER", req: "Prompt §5 'duplicate submission'; aiaBillingRoutes.ts:293 (no uniqueness check found statically)", expected: "4xx: a second application for an SOV that already has one is rejected" }, async (ctx) => {
  ctx.clients.push(mgr);
  const sov = await sovFor(3);
  const r = await mgr.post("/api/aia-billing/pay-applications", { projectId: S.projectId, sovId: sov.id, periodTo: "2026-08-31" });
  if (r.status === 201) { S.dupPayApp = r.data.id; save(); ctx.notes.push(`duplicate created app #${r.data.applicationNumber}, currentDue ${r.data.currentPaymentDue}`); }
  expect(r.status >= 400, `duplicate pay app for period 3 SOV -> ${r.status} (app #${r.data.applicationNumber}, due ${r.data.currentPaymentDue})`);
});

await t({ id: "PAY-NEG-002", title: "Overbilling: line billed beyond 100% of scheduled value", module: "Progress Billing", role: "MANAGER", req: "Prompt §5 'attempted overbilling'; sovRoutes.ts line PATCH clamps percent only", expected: "4xx; or line completed amount capped at scheduled value" }, async (ctx) => {
  ctx.clients.push(mgr);
  const rf = await mgr.post("/api/aia-billing/pay-applications/roll-forward", { sovId: (await sovFor(3)).id, periodTo: "2026-09-30" });
  ctx.notes.push(`roll-forward ${rf.status}`);
  const sov = await sovFor(4); const li = lineForRow(sov, 11);
  const r = await mgr.patch(`/api/sov/${sov.id}/line-items/${li.id}`, { thisPeriodCompleted: "10000" });
  const after = (await sovFor(4)); const l2 = lineForRow(after, 11);
  ctx.notes.push(`patch ${r.status}; line R11 scheduled ${l2.scheduledValue} previous ${l2.previouslyCompleted} this ${l2.thisPeriodCompleted} pct ${l2.percentComplete} balance ${l2.balanceToFinish}`);
  S.sov4 = sov.id; save();
  const billed = Number(l2.previouslyCompleted) + Number(l2.thisPeriodCompleted);
  // restore to 0 to keep the primary project's period-4 SOV clean
  await mgr.patch(`/api/sov/${sov.id}/line-items/${li.id}`, { thisPeriodCompleted: "0" });
  expect(r.status >= 400 || billed <= Number(l2.scheduledValue), `accepted (${r.status}): line billed ${billed} vs scheduled ${l2.scheduledValue}; percentComplete shown ${l2.percentComplete}%, balance ${l2.balanceToFinish}`);
});

await t({ id: "PAY-PMT-001", title: "Record payment receipt on approved pay app #1 (fixture only, no money moved); overpayment rejected", module: "Progress Billing/AR", role: "MANAGER", req: "aiaBillingRoutes.ts:539-600", expected: "Payment = currentDue accepted, status PAID; second payment 400" }, async (ctx) => {
  ctx.clients.push(mgr);
  const id = S.payApps[1]; const app = (await mgr.get(`/api/aia-billing/pay-applications/${id}`)).data; const due = Number((app.payApplication ?? app).currentPaymentDue);
  const p1 = await mgr.post(`/api/aia-billing/pay-applications/${id}/record-payment`, { amount: due, paymentReference: "QA-RECEIPT-0001 (SYNTHETIC, no funds)", paymentMethod: "OTHER" });
  const p2 = await mgr.post(`/api/aia-billing/pay-applications/${id}/record-payment`, { amount: 1, paymentReference: "QA overpay probe" });
  ctx.notes.push(`pay ${p1.status} ${j(p1)}; overpay ${p2.status} ${j(p2)}`);
  expect(ok(p1) && p2.status >= 400, `payment ${p1.status}; overpayment ${p2.status}`);
});
