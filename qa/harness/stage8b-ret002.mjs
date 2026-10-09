import fs from "node:fs";
import { Client, test, expect, RUN_DIR } from "/home/user/SmartManageAI/qa/harness/lib.mjs";
const S = JSON.parse(fs.readFileSync(`${RUN_DIR}/state.json`));
const mgr = new Client("manager(MANAGER)"); await mgr.login("manager@realtest.com", process.env.SMA_QA_ADMIN_PASSWORD);
const admin = new Client("admin(ADMIN)"); await admin.login("admin@realtest.com", process.env.SMA_QA_ADMIN_PASSWORD);
await test({ id: "RET-002", title: "Duplicate DRAFT pay app (from PAY-FB-NEG-001) cannot be voided and blocks FINAL retainage release", module: "Progress Billing/Retainage", role: "MANAGER + ADMIN", tenant: "RealTest Construction", mode: "API integration (fallback seed)", req: "aiaBillingRoutes.ts:200 status map; :1476 final-release gate", expected: "Some authorized path voids/archives an erroneous pay application so the final retainage release can proceed" }, async (ctx) => {
  ctx.clients.push(mgr, admin);
  const id = (await psqlId());
  const steps = [];
  steps.push(`submit ${(await mgr.patch(`/api/aia-billing/pay-applications/${id}/status`, { status: "SUBMITTED" })).status}`);
  steps.push(`approve ${(await admin.patch(`/api/aia-billing/pay-applications/${id}/status`, { status: "APPROVED" })).status}`);
  const p = await mgr.post(`/api/aia-billing/pay-applications/${id}/record-payment`, { amount: 0.01, paymentReference: "QA probe" }); steps.push(`pay 0.01 ${p.status} ${JSON.stringify(p.data).slice(0, 120)}`);
  steps.push(`archive ${(await admin.patch(`/api/aia-billing/pay-applications/${id}/status`, { status: "ARCHIVED" })).status}`);
  const rel = await mgr.post("/api/aia-billing/retention-releases", { projectId: S.fb.projectId, releaseType: "FINAL", amount: "60937.82", reason: "Final completion (SYNTHETIC)" });
  steps.push(`final release ${rel.status} ${JSON.stringify(rel.data).slice(0, 160)}`);
  if (rel.status < 300) { const rid = rel.data.id ?? rel.data.release?.id; steps.push(`approve release ${(await admin.patch(`/api/aia-billing/retention-releases/${rid}/status`, { status: "APPROVED" })).status}`); S.fb.retentionReleaseId = rid; fs.writeFileSync(`${RUN_DIR}/state.json`, JSON.stringify(S, null, 1)); }
  ctx.notes.push(...steps);
  expect(rel.status < 300 && !/0\.01 2/.test(steps[2]), steps.join(" | "));
});
async function psqlId() { const { execFileSync } = await import("node:child_process"); return execFileSync("psql", ["postgres://sma_qa:sma_qa_local@127.0.0.1:5432/sma_qa_dev", "-tAc", `select id from pay_applications where project_id='${S.fb.projectId}' and status='DRAFT' limit 1`]).toString().trim(); }
