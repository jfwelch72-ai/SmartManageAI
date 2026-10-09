import fs from "node:fs";
import { Client, test, expect, RUN_ID, RUN_DIR, money } from "./lib.mjs";
const PW = process.env.SMA_QA_ADMIN_PASSWORD;
const S = JSON.parse(fs.readFileSync(`${RUN_DIR}/state.json`));
const save = () => fs.writeFileSync(`${RUN_DIR}/state.json`, JSON.stringify(S, null, 1));
const est = new Client("estimator(ESTIMATOR)"); await est.login("estimator@realtest.com", PW);
const mgr = new Client("manager(MANAGER)"); await mgr.login("manager@realtest.com", PW);
const admin = new Client("admin(ADMIN)"); await admin.login("admin@realtest.com", PW);
async function maybe(meta, fn) { if (ONLY.length && !ONLY.includes(meta.id)) return; return test(meta, fn); }
const newBid = async (c, label, extra = {}) => { const b = await c.post("/api/bids", { name: `${RUN_ID} ${label}`, clientName: `${RUN_ID} Fictional Owner (TEST)`, ...extra }); if (b.status !== 201) throw new Error(`bid ${b.status} ${JSON.stringify(b.data)}`); return b.data; };
const PRICE = 782052.11;
const SINK = "qa-sink@example.test"; // EMAIL_TRANSPORT=noop captures to in-memory outbox; nothing leaves the host
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean); // app per-line rounded; workbook P120 782052.0975

await maybe({ id: "BID-SUB-001", title: "Set bid amount to proposal total, approve estimate, submit primary bid", module: "Bids", role: "ESTIMATOR + MANAGER", tenant: "RealTest Construction", req: "bidRoutes.ts:488,2207; estimateRoutes.ts:3310", expected: "bidAmount persisted 782052.11; estimate APPROVED; bid SUBMITTED" }, async (ctx) => {
  ctx.clients.push(est, mgr);
  const p = await est.patch(`/api/bids/${S.bidCode}`, { bidAmount: String(PRICE) }); expect(p.status === 200, `patch amount ${p.status} ${JSON.stringify(p.data).slice(0, 200)}`);
  const a = await mgr.post(`/api/estimates/${S.estimateId}/approve`, {}); expect(a.status === 200, `approve ${a.status} ${JSON.stringify(a.data).slice(0, 200)}`);
  const a2 = await mgr.post(`/api/estimates/${S.estimateId}/approve`, {}); ctx.notes.push(`re-approve -> ${a2.status}`);
  const s = await est.post(`/api/bids/${S.bidCode}/submit`, {}); expect([200, 201].includes(s.status), `submit ${s.status} ${JSON.stringify(s.data).slice(0, 300)}`);
  const g = await est.get(`/api/bids/${S.bidCode}`); const bid = g.data.bid ?? g.data;
  expect(bid.status === "SUBMITTED" && Number(bid.bidAmount) === PRICE, `status ${bid.status} amount ${bid.bidAmount}`);
  expect(a2.status === 400, `second approve returned ${a2.status} (expected 400 already approved)`);
});

await maybe({ id: "EST-APR-SOD-001", title: "Estimator can approve an estimate (segregation-of-duties check)", module: "Estimating/Approval", role: "ESTIMATOR", tenant: "RealTest Construction", req: "estimateRoutes.ts:3310 requireRole ADMIN/MANAGER/ESTIMATOR; no documented SoD requirement found", expected: "UNRESOLVED requirement: record behavior only", mode: "API integration" }, async (ctx) => {
  ctx.clients.push(est);
  const b = await newBid(est, "SoD probe bid"); const e = await est.post(`/api/bids/${b.id}/estimate`, {}); const eid = (e.data.estimate ?? e.data).id;
  await est.post(`/api/estimates/${eid}/line-items/bulk`, { lineItems: [{ category: "GENERAL", description: "QA probe", quantity: "1", unit: "LS", materialCost: "100", laborCost: "0", laborHours: "0", equipmentCost: "0", equipmentHours: "0", consumablesCost: "0", subcontractCost: "0", overheadAllocation: "0", profitAllocation: "0" }] });
  const a = await est.post(`/api/estimates/${eid}/approve`, {});
  S.sodBid = b.code; save();
  return { status: "PASS", actual: `ESTIMATOR self-approval returned ${a.status}. No approval-separation requirement found in docs; recorded as observation (see report).` };
});

await maybe({ id: "BID-LOST-001", title: "Loss path: submitted bid marked LOST cannot be converted", module: "Bids", role: "ESTIMATOR + MANAGER", tenant: "RealTest Construction", req: "bidRoutes.ts:207-214, 697-778", expected: "LOST persisted; convert -> 409/400; no project created" }, async (ctx) => {
  ctx.clients.push(est, mgr);
  const b = await newBid(est, "LOSS path bid", { bidAmount: "1000" });
  expect((await est.post(`/api/bids/${b.code}/submit`, { recipientEmail: SINK })).status < 300, "submit");
  const l = await est.patch(`/api/bids/${b.code}`, { status: "LOST" }); expect(l.status === 200, `lost ${l.status}`);
  const c = await mgr.post(`/api/bids/${b.code}/convert`, {});
  S.lostBid = b.code; save();
  expect([400, 409, 422].includes(c.status), `convert of LOST bid -> ${c.status} ${JSON.stringify(c.data).slice(0, 200)}`);
  return { actual: `LOST ok; convert -> ${c.status}` };
});

await maybe({ id: "BID-AWD-NEG-001", title: "Bid set AWARDED via PATCH (estimator) without conversion", module: "Bids/Award", role: "ESTIMATOR then MANAGER", tenant: "RealTest Construction", req: "convert requires ADMIN/MANAGER (bidRoutes.ts:697-700); status map allows SUBMITTED->AWARDED via PATCH (bidRoutes.ts:207-210)", expected: "Either ESTIMATOR cannot set AWARDED directly, or an AWARDED bid can still be converted; never an AWARDED bid with no project and no path to create one" }, async (ctx) => {
  ctx.clients.push(est, mgr);
  const b = await newBid(est, "PATCH-AWARDED probe", { bidAmount: "1000" });
  await est.post(`/api/bids/${b.code}/submit`, { recipientEmail: SINK });
  const p = await est.patch(`/api/bids/${b.code}`, { status: "AWARDED" });
  const c = await mgr.post(`/api/bids/${b.code}/convert`, {});
  S.patchAwardBid = b.code; save();
  ctx.notes.push(`estimator PATCH AWARDED -> ${p.status}; manager convert -> ${c.status} ${JSON.stringify(c.data).slice(0, 200)}`);
  expect(!(p.status === 200 && c.status >= 400), `Estimator set status AWARDED (${p.status}); subsequent convert by MANAGER rejected (${c.status}: ${JSON.stringify(c.data).slice(0, 160)}) -> bid stranded AWARDED with no project`);
});

await maybe({ id: "BID-AWD-001", title: "Award primary bid: two concurrent convert requests create exactly one project", module: "Bids/Award", role: "MANAGER", tenant: "RealTest Construction", req: "Prompt §5 'double-click/retry award -> exactly one project'; bidRoutes.ts:697-778", expected: "One 201, one 409; exactly one project linked to bid" }, async (ctx) => {
  ctx.clients.push(mgr);
  const body = { startStatus: "ACTIVE", startDate: "2026-06-01", endDate: "2026-09-30" };
  const [r1, r2] = await Promise.all([mgr.post(`/api/bids/${S.bidCode}/convert`, body), mgr.post(`/api/bids/${S.bidCode}/convert`, body)]);
  const st = [r1.status, r2.status].sort(); ctx.notes.push(`statuses ${st}`, JSON.stringify(r1.data).slice(0, 500), JSON.stringify(r2.data).slice(0, 500));
  const ok = [r1, r2].find((r) => r.status === 201); if (ok) { S.projectId = ok.data.id; S.projectCode = ok.data.code; save(); }
  const r3 = await mgr.post(`/api/bids/${S.bidCode}/convert`, body); ctx.notes.push(`retry -> ${r3.status}`);
  const list = await mgr.get(`/api/projects?search=${encodeURIComponent(RUN_ID)}&limit=200`);
  const arr = Array.isArray(list.data) ? list.data : (list.data.data ?? list.data.projects ?? list.data.items ?? []);
  const linked = arr.filter((p) => p.name?.includes("Crane Logistics West Jefferson"));
  ctx.notes.push(`projects matching name: ${linked.map((p) => p.code).join(",")}`);
  expect(st[0] === 201 && st[1] === 409, `concurrent statuses ${st}`);
  expect(r3.status === 409, `retry ${r3.status}`);
  expect(linked.length === 1, `projects for bid: ${linked.length}`);
  return { actual: `statuses ${st}; retry ${r3.status}; project ${S.projectCode}` };
});
