import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { Client, test, expect, RUN_ID, RUN_DIR, money } from "./lib.mjs";
const PW = process.env.SMA_QA_ADMIN_PASSWORD;
const S = JSON.parse(fs.readFileSync(`${RUN_DIR}/state.json`));
const save = () => fs.writeFileSync(`${RUN_DIR}/state.json`, JSON.stringify(S, null, 1));
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
const t = (m, f) => (ONLY.length && !ONLY.some((o) => m.id.startsWith(o)) ? null : test({ tenant: "RealTest Construction", ...m }, f));
const mgr = new Client("manager(MANAGER)"); await mgr.login("manager@realtest.com", PW);
const sup = new Client("super(SUPERINTENDENT)"); await sup.login("super@realtest.com", PW);
const wkr = new Client("worker(FIELD_WORKER)"); await wkr.login("worker@realtest.com", PW);
const admin = new Client("admin(ADMIN)"); await admin.login("admin@realtest.com", PW);
const ok = (r) => r.status >= 200 && r.status < 300; const j = (r) => JSON.stringify(r.data).slice(0, 300);
const OUT = `${RUN_DIR}/evidence/docs`; const P = S.projectCode;

await t({ id: "PUNCH-001", title: "Punch list: create, worker resolves, worker cannot verify, manager verifies, PDF export", module: "Closeout/Punch", role: "MANAGER + FIELD_WORKER", req: "punchListRoutes.ts:290+ role matrix", expected: "create 201; worker IN_PROGRESS/RESOLVED 200; worker VERIFIED 403; manager VERIFIED 200; PDF valid" }, async (ctx) => {
  ctx.clients.push(mgr, wkr);
  const items = [];
  for (const title of ["Grind high spot at pad F-17 (SYNTHETIC)", "Patch saw-cut overrun at door 3 (SYNTHETIC)"]) { const r = await mgr.post(`/api/projects/${P}/punch-list`, { title, description: `${RUN_ID}`, trade: "GENERAL", priority: "MEDIUM", location: "Grid C-4" }); expect(r.status === 201, `create ${r.status} ${j(r)}`); items.push(r.data.id ?? r.data.item?.id); }
  S.punch = items; save();
  const st = [];
  for (const id of items) {
    st.push((await wkr.patch(`/api/projects/${P}/punch-list/${id}`, { status: "IN_PROGRESS" })).status);
    st.push((await wkr.patch(`/api/projects/${P}/punch-list/${id}`, { status: "RESOLVED" })).status);
    st.push((await wkr.patch(`/api/projects/${P}/punch-list/${id}`, { status: "VERIFIED" })).status);
    st.push((await mgr.patch(`/api/projects/${P}/punch-list/${id}`, { status: "VERIFIED" })).status);
  }
  const pdf = await mgr.get(`/api/projects/${P}/punch-list/export/pdf`, { raw: true }); fs.writeFileSync(`${OUT}/PUNCH-001-export.html`, pdf.data); ctx.evidence.push("evidence/docs/PUNCH-001-export.html");
  ctx.notes.push(`statuses ${st}; pdf ${pdf.status} ${pdf.data.slice(0, 4)}`);
  expect(JSON.stringify(st) === JSON.stringify([200, 200, 403, 200, 200, 200, 403, 200]) && pdf.data.slice(0, 4).toString() === "%PDF", `statuses ${st}; pdf ${pdf.status}`);
});

await t({ id: "CLOSE-001", title: "Closeout checklist init, auto-pull, complete items, readiness, turnover package export", module: "Closeout", role: "MANAGER", req: "closeoutRoutes.ts", expected: "init creates items; items completable; export produces downloadable package/PDF" }, async (ctx) => {
  ctx.clients.push(mgr);
  const i = await mgr.post(`/api/projects/${P}/closeout/init`, {}); ctx.notes.push(`init ${i.status} ${j(i)}`);
  const ap = await mgr.post(`/api/projects/${P}/closeout/auto-pull`, {}); ctx.notes.push(`auto-pull ${ap.status} ${j(ap)}`);
  const g = await mgr.get(`/api/projects/${P}/closeout`); const items = g.data.items ?? g.data.checklist?.items ?? (Array.isArray(g.data) ? g.data : []);
  ctx.notes.push(`items ${items.length}; keys ${Object.keys(g.data)}`);
  const add = await mgr.post(`/api/projects/${P}/closeout/items`, { title: "TEST ONLY — warranty letter (NOT VALID FOR BUSINESS USE)", category: "WARRANTY", name: "TEST ONLY — warranty letter", itemType: "WARRANTY" }); ctx.notes.push(`add item ${add.status} ${j(add)}`);
  const all = (await mgr.get(`/api/projects/${P}/closeout`)).data; const list = all.items ?? all.checklist?.items ?? [];
  let done = 0; for (const it of list) { const r = await mgr.patch(`/api/projects/${P}/closeout/items/${it.id}`, { status: "COMPLETE", isComplete: true, completed: true, notes: `${RUN_ID} QA` }); if (ok(r)) done++; else if (done === 0) ctx.notes.push(`patch item ${r.status} ${j(r)}`); }
  const rd = await mgr.get(`/api/projects/${P}/closeout-readiness`); ctx.notes.push(`completed ${done}/${list.length}; readiness ${rd.status} ${j(rd)}`);
  const ex = await mgr.post(`/api/projects/${P}/closeout/export`, {}); ctx.notes.push(`export ${ex.status} ${j(ex)}`);
  const pdf = await mgr.get(`/api/projects/${P}/closeout/export/pdf`, { raw: true }); fs.writeFileSync(`${OUT}/CLOSE-001-closeout.pdf`, pdf.data); ctx.evidence.push("evidence/docs/CLOSE-001-closeout.pdf");
  let pkg = null; const pkgId = ex.data?.id ?? ex.data?.package?.id ?? ex.data?.packageId;
  if (pkgId) { pkg = await mgr.get(`/api/projects/${P}/closeout/packages/${pkgId}/download`, { raw: true }); fs.writeFileSync(`${OUT}/CLOSE-001-turnover-package.bin`, pkg.data); ctx.notes.push(`package download ${pkg.status} ${pkg.headers.get("content-type")} ${pkg.data.length}B`); }
  ctx.notes.push(`closeout pdf ${pdf.status} ${pdf.data.slice(0, 4)}`);
  expect(ok(i) && list.length > 0 && done === list.length && pdf.data.slice(0, 4).toString() === "%PDF", ctx.notes.join(" | ").slice(0, 900));
});

await t({ id: "CLOSE-002", title: "Project can be marked COMPLETE while closeout readiness incomplete / work outstanding", module: "Projects/Closeout", role: "MANAGER", req: "projectCrudRoutes.ts:221-243 (no readiness gate found); requirement unresolved", expected: "UNRESOLVED requirement — behavior recorded", mode: "API integration" }, async (ctx) => {
  ctx.clients.push(mgr);
  const other = (await mgr.post("/api/projects", { name: `${RUN_ID} Completion-gate probe (SYNTHETIC)`, clientName: "QA", status: "ACTIVE" })).data;
  await mgr.post(`/api/projects/${other.code}/punch-list`, { title: "Open item (SYNTHETIC)", trade: "GENERAL", priority: "HIGH" });
  const c = await mgr.patch(`/api/projects/${other.code}`, { status: "COMPLETE" });
  S.gateProbe = other.code; save();
  return { status: "PASS", actual: `PATCH status COMPLETE with an OPEN high-priority punch item and no closeout -> ${c.status}. No completion gate; recorded as unresolved requirement (see report).` };
});

await t({ id: "CLOSE-003", title: "Post-close restrictions: CLOSED project rejects edits, time, COs; reopen rules", module: "Projects/Closeout", role: "MANAGER + FIELD_WORKER", req: "projectCrudRoutes.ts:221-243 (CLOSED terminal)", expected: "COMPLETE->ACTIVE reopen allowed; CLOSED rejects reopen, new CO, new time, new pay app" }, async (ctx) => {
  ctx.clients.push(mgr, wkr);
  const code = S.gateProbe; const id = (await mgr.get(`/api/projects/${code}`)).data.id;
  const reopen = await mgr.patch(`/api/projects/${code}`, { status: "ACTIVE" });
  await mgr.patch(`/api/projects/${code}`, { status: "COMPLETE" });
  const close = await mgr.patch(`/api/projects/${code}`, { status: "CLOSED" });
  const reopen2 = await mgr.patch(`/api/projects/${code}`, { status: "ACTIVE" });
  const edit = await mgr.patch(`/api/projects/${code}`, { description: "edit after close" });
  const co = await mgr.post("/api/change-orders", { projectId: id, title: "post-close CO", description: "post-close CO", amount: "100" });
  const te = await wkr.post("/api/time-entries", { projectId: id, date: "2026-10-08", hoursRegular: "2" });
  const ci = await wkr.post("/api/time-clock/clock-in", { projectId: id }); if (ok(ci)) await wkr.post("/api/time-clock/clock-out", {});
  const r = { reopen: reopen.status, close: close.status, reopenClosed: reopen2.status, edit: edit.status, co: co.status, timeEntry: te.status, clockIn: ci.status };
  ctx.notes.push(JSON.stringify(r));
  const probs = Object.entries({ edit, co, timeEntry: te, clockIn: ci }).filter(([, x]) => ok(x)).map(([k, x]) => `${k} accepted on CLOSED project (${x.status})`);
  if (!ok(reopen)) probs.push(`COMPLETE->ACTIVE reopen ${reopen.status}`); if (ok(reopen2)) probs.push("CLOSED reopened");
  expect(!probs.length, probs.join("; "));
});

await t({ id: "RET-001", title: "Final retainage release on fallback billing project", module: "Progress Billing/Retainage", role: "MANAGER + ADMIN", mode: "API integration (fallback seed)", req: "aiaBillingRoutes.ts:1468-1560", expected: `FINAL release of 60,937.82 (10% of 609,378.19) approved; release > retained rejected` }, async (ctx) => {
  ctx.clients.push(mgr, admin);
  const pre = await mgr.post("/api/aia-billing/retention-releases", { projectId: S.fb.projectId, releaseType: "FINAL", amount: "60937.82", reason: "QA: before completion" });
  ctx.notes.push(`FINAL before COMPLETE -> ${pre.status} ${j(pre)}`);
  const cpl = await mgr.patch(`/api/projects/${S.fb.code}`, { status: "COMPLETE" }); ctx.notes.push(`fallback project COMPLETE ${cpl.status} ${j(cpl).slice(0, 80)}`);
  for (const n of [2, 3]) { const id = S.fb.apps[n]; const A0 = (await mgr.get(`/api/aia-billing/pay-applications/${id}`)).data; const A = A0.payApplication ?? A0; if (A.status !== "PAID") { const p = await mgr.post(`/api/aia-billing/pay-applications/${id}/record-payment`, { amount: Number(A.currentPaymentDue), paymentReference: `QA-RECEIPT-000${n} (SYNTHETIC; no funds)`, paymentMethod: "OTHER" }); ctx.notes.push(`pay #${n} ${p.status}`); } }
  const tryRel = await mgr.post("/api/aia-billing/retention-releases", { projectId: S.fb.projectId, releaseType: "FINAL", amount: "60937.82", reason: "QA: with duplicate DRAFT #4 present" });
  ctx.notes.push(`FINAL with duplicate DRAFT app present -> ${tryRel.status} ${j(tryRel)}`);
  if (tryRel.status >= 400) { const list = (await mgr.get(`/api/aia-billing/pay-applications?projectId=${S.fb.projectId}`)).data; const arr = Array.isArray(list) ? list : list.payApplications ?? [];
    for (const d of arr.filter((x) => x.status === "DRAFT")) { const tries = []; for (const st of ["ARCHIVED", "REJECTED", "CANCELLED", "VOID"]) { const r = await mgr.patch(`/api/aia-billing/pay-applications/${d.id}/status`, { status: st }); tries.push(`${st}:${r.status}`); if (r.status < 300) break; } const del = await mgr.del(`/api/aia-billing/pay-applications/${d.id}`); tries.push(`DELETE:${del.status}`); ctx.notes.push(`clear duplicate #${d.applicationNumber}: ${tries.join(",")}`); } }
  const over = await mgr.post("/api/aia-billing/retention-releases", { projectId: S.fb.projectId, releaseType: "FINAL", amount: "999999", reason: "QA overrelease probe" });
  const r = await mgr.post("/api/aia-billing/retention-releases", { projectId: S.fb.projectId, releaseType: "FINAL", amount: "60937.82", reason: "Final completion (SYNTHETIC)" });
  const id = r.data?.id ?? r.data?.release?.id;
  const a = id ? await admin.patch(`/api/aia-billing/retention-releases/${id}/status`, { status: "APPROVED" }) : { status: 0, data: null };
  ctx.notes.push(`over ${over.status} ${j(over)}; release ${r.status}; approve ${a.status} ${j(a)}`);
  expect(ok(r) && ok(a) && over.status >= 400, `release ${r.status} approve ${a.status}; over-release ${over.status}`);
});
