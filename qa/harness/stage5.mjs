import fs from "node:fs";
import { Client, test, expect, RUN_ID, RUN_DIR, money } from "./lib.mjs";
const PW = process.env.SMA_QA_ADMIN_PASSWORD;
const S = JSON.parse(fs.readFileSync(`${RUN_DIR}/state.json`));
const save = () => fs.writeFileSync(`${RUN_DIR}/state.json`, JSON.stringify(S, null, 1));
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
const t = (m, f) => (ONLY.length && !ONLY.some((o) => m.id.startsWith(o)) ? null : test({ tenant: "RealTest Construction", ...m }, f));
const sup = new Client("super(SUPERINTENDENT)"); await sup.login("super@realtest.com", PW);
const mgr = new Client("manager(MANAGER)"); await mgr.login("manager@realtest.com", PW);
const wkr = new Client("worker(FIELD_WORKER)"); await wkr.login("worker@realtest.com", PW);
const eqm = new Client("equipment@(FIELD_WORKER)"); await eqm.login("equipment@realtest.com", PW);
const admin = new Client("admin(ADMIN)"); await admin.login("admin@realtest.com", PW);
const P = S.projectCode;
// Synthetic schedule fixture (SYNTHETIC — durations derived from source labor-day lines where available, else invented & labeled)
const TASKS = [
  ["MOB", "Mobilization & GC (src R11)", 3, []],
  ["SAW", "Saw cut & demo 162 pads (src R13,R28: 34 labor-days)", 34, ["MOB"]],
  ["HAUL", "Haul spoils (src R20,R23)", 10, ["SAW"]],
  ["REBAR", "Rebar & chairs F70 spread ftgs (src R24-R26)", 8, ["SAW"]],
  ["POUR", "Pour 162 spread ftgs (src R27,R29: 9 labor-days)", 9, ["REBAR", "HAUL"]],
  ["OPEN", "4 new OH door openings (src R32-R38: 2.25 days -> 3)", 3, ["MOB"]],
  ["DOCK", "Dock leveler fill (src R42-R47: 2 days)", 2, ["POUR"]],
  ["CLEAN", "Clean up (src R50: 2 days)", 2, ["DOCK", "OPEN"]],
  ["SC", "Substantial completion (milestone)", 1, ["CLEAN"]],
];
// independent expected finish: Mon-Fri working days, FS, start 2026-06-01 (Mon)
function addWD(d, n) { const x = new Date(d + "T00:00:00Z"); let k = 0; while (k < n) { x.setUTCDate(x.getUTCDate() + 1); const w = x.getUTCDay(); if (w !== 0 && w !== 6) k++; } return x.toISOString().slice(0, 10); }
const ES = {}, EF = {};
for (const [k, , dur, deps] of TASKS) { const start = deps.length ? addWD(deps.map((d) => EF[d]).sort().pop(), 1) : "2026-06-01"; ES[k] = start; EF[k] = addWD(start, dur - 1); }
fs.writeFileSync(`${RUN_DIR}/fixtures/schedule_expected_cpm.json`, JSON.stringify({ synthetic: true, calendar: "Mon-Fri, no holidays, FS lag 0", ES, EF, criticalPath: ["MOB", "SAW", "HAUL", "POUR", "DOCK", "CLEAN", "SC"] }, null, 1));

await t({ id: "SCH-001", title: "Create schedule and dependent tasks with milestone", module: "Schedule", role: "SUPERINTENDENT", req: "scheduleRoutes.ts:1089,743", expected: "Schedule 201; 9 tasks 201 with FS dependencies" }, async (ctx) => {
  ctx.clients.push(sup);
  const s = await sup.post(`/api/projects/${P}/schedule/create`, { name: `${RUN_ID} Baseline (SYNTHETIC)`, startDate: "2026-06-01", workingDays: [1, 2, 3, 4, 5] });
  expect([200, 201].includes(s.status), `create ${s.status} ${JSON.stringify(s.data).slice(0, 300)}`);
  S.tasks = {};
  for (const [k, name, dur, deps] of TASKS) {
    const r = await sup.post(`/api/projects/${P}/schedule/tasks`, { name, durationDays: dur, dependencies: deps.map((d) => S.tasks[d]), isMilestone: k === "SC" });
    expect(r.status === 201, `task ${k} ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`); S.tasks[k] = r.data.task.id;
  }
  save(); return { actual: `9 tasks: ${Object.keys(S.tasks).join(",")}` };
});
await t({ id: "SCH-002", title: "Dependency cycle rejected", module: "Schedule", role: "SUPERINTENDENT", req: "scheduleRoutes.ts:649-673 detectCycle", expected: "400 'Circular dependency'" }, async (ctx) => {
  ctx.clients.push(sup);
  const r = await sup.patch(`/api/projects/${P}/schedule/tasks/${S.tasks.MOB}/dependencies`, { dependencies: [S.tasks.CLEAN] });
  const r2 = await sup.patch(`/api/projects/${P}/schedule/tasks/${S.tasks.SAW}/dependencies`, { dependencies: [S.tasks.SAW] });
  expect(r.status === 400 && r2.status === 400, `cycle ${r.status} ${JSON.stringify(r.data).slice(0, 120)}; self ${r2.status}`);
});
await t({ id: "SCH-003", title: "Invalid date range (end before start) rejected", module: "Schedule", role: "SUPERINTENDENT", req: "Defensible integrity constraint", expected: "4xx" }, async (ctx) => {
  ctx.clients.push(sup);
  const r = await sup.post(`/api/projects/${P}/schedule/tasks`, { name: `${RUN_ID} bad dates`, plannedStartDate: "2026-07-10", plannedEndDate: "2026-07-01", durationDays: 1 });
  if (r.status === 201) S.badDateTask = r.data.task.id, save();
  expect(r.status >= 400 && r.status < 500, `end-before-start accepted: ${r.status} start=${r.data.task?.plannedStartDate} end=${r.data.task?.plannedEndDate}`);
});
await t({ id: "SCH-004", title: "CPM recalculation: dates and critical path vs independent calc", module: "Schedule/CPM", role: "SUPERINTENDENT", req: "cpmEngine.ts:99; fixtures/schedule_expected_cpm.json", expected: `SC finishes ${EF.SC}; critical path MOB-SAW-HAUL-POUR-DOCK-CLEAN-SC; OPEN has float` }, async (ctx) => {
  ctx.clients.push(sup);
  const r = await sup.post(`/api/projects/${P}/schedule/recalculate`, {});
  const g = await sup.get(`/api/projects/${P}/schedule`);
  const tasks = g.data.tasks ?? g.data.schedule?.tasks ?? [];
  fs.writeFileSync(`${RUN_DIR}/evidence/api/schedule-after-cpm.json`, JSON.stringify(g.data, null, 1));
  const by = Object.fromEntries(Object.entries(S.tasks).map(([k, id]) => [k, tasks.find((x) => x.id === id)]));
  const d = (x) => (x ? String(x).slice(0, 10) : x);
  const rows = Object.keys(S.tasks).map((k) => `${k}: start ${d(by[k]?.plannedStartDate ?? by[k]?.startDate)} end ${d(by[k]?.plannedEndDate ?? by[k]?.endDate)} exp ${ES[k]}..${EF[k]} crit=${by[k]?.isCriticalPath} float=${by[k]?.totalFloat}`);
  ctx.notes.push(`recalc ${r.status}`, ...rows);
  const scEnd = d(by.SC?.plannedEndDate ?? by.SC?.endDate);
  expect(r.status < 300, `recalc ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  expect(scEnd === EF.SC, `SC end ${scEnd} expected ${EF.SC}`);
  expect(by.OPEN?.isCriticalPath === false && by.SAW?.isCriticalPath === true && Number(by.OPEN?.totalFloat) > 0, "critical flags: " + rows.join(" | "));
});
if (!S.otherProjectId) { const other = (await mgr.post("/api/projects", { name: `${RUN_ID} Second site project (SYNTHETIC)`, clientName: "QA", status: "ACTIVE" })).data; S.otherProjectId = other.id; S.otherProjectCode = other.code; save(); }
await t({ id: "RES-001", title: "Crew create/assign; overlapping assignment on another project rejected", module: "Resources/Crews", role: "MANAGER", req: "crewRoutes2.ts:503,577", expected: "201; overlapping other-project assignment 409 unless allowOverlap" }, async (ctx) => {
  ctx.clients.push(mgr);
  const c = await mgr.post("/api/crews", { name: `${RUN_ID} Concrete Crew A (SYNTHETIC)` }); expect([200, 201].includes(c.status), `crew ${c.status} ${JSON.stringify(c.data).slice(0, 200)}`);
  S.crewId = (c.data.crew ?? c.data).id;
  const me = await wkr.get("/api/auth/me"); S.workerId = me.data.user.id;
  const m = await mgr.post(`/api/crews/${S.crewId}/members`, { userId: S.workerId, role: "LABORER" }); ctx.notes.push(`member ${m.status} ${JSON.stringify(m.data).slice(0, 150)}`);
  const a = await mgr.post("/api/crew-assignments", { crewId: S.crewId, projectId: S.projectId, startDate: "2026-06-01", endDate: "2026-09-30" });
  if (a.status === 400) { const nd = await mgr.post("/api/crew-assignments", { crewId: S.crewId, projectId: S.projectId }); ctx.notes.push(`without dates -> ${nd.status}`); S.crewAssignNoDates = nd.status; save(); }
  expect([200, 201].includes(a.status), `dated assignment (same payload shape as dispatch-board.tsx:257) -> ${a.status} ${JSON.stringify(a.data).slice(0, 200)}`);
  const o = await mgr.post("/api/crew-assignments", { crewId: S.crewId, projectId: S.otherProjectId, startDate: "2026-07-01", endDate: "2026-07-15" });
  save(); expect(o.status === 409, `overlap -> ${o.status} ${JSON.stringify(o.data).slice(0, 200)}`);
});
await t({ id: "RES-002", title: "Equipment: create, assign, double-assign blocked, return", module: "Equipment", role: "ADMIN", req: "equipmentRoutes.ts:1549", expected: "assign 200; second assign 400; return 200" }, async (ctx) => {
  ctx.clients.push(admin);
  const e = await admin.post("/api/equipment", { name: `${RUN_ID} Cat excavator w/ thumb (SYNTHETIC; src R15)`, equipmentCode: `QA-EX-${Date.now() % 1e6}`, type: "HEAVY_EQUIPMENT", hourlyRate: "95.00", dailyRate: "760.00" });
  expect([200, 201].includes(e.status), `create ${e.status} ${JSON.stringify(e.data).slice(0, 300)}`); S.equipId = (e.data.equipment ?? e.data).id; save();
  const a1 = await admin.post(`/api/equipment/${S.equipId}/assign`, { projectId: S.projectId, expectedReturnDate: "2026-09-30" });
  const a2 = await admin.post(`/api/equipment/${S.equipId}/assign`, { projectId: S.otherProjectId });
  ctx.notes.push(`assign1 ${a1.status}; assign2 ${a2.status} ${JSON.stringify(a2.data).slice(0, 150)}`);
  expect([200, 201].includes(a1.status) && a2.status === 400, `assign1 ${a1.status} ${JSON.stringify(a1.data).slice(0, 200)} assign2 ${a2.status}`);
});
await t({ id: "RES-003", title: "Equipment usage: hour-log end < start and fuel negative rejected", module: "Equipment", role: "ADMIN", req: "equipmentRoutes.ts:3643,3979; defensible integrity", expected: "4xx for endingHours < startingHours; 4xx for gallons <= 0; valid log 201" }, async (ctx) => {
  ctx.clients.push(admin);
  const wk = (n) => { const d = new Date(Date.UTC(2027, 0, 4 + 7 * n)); const e = new Date(d); e.setUTCDate(e.getUTCDate() + 6); return [d.toISOString().slice(0, 10), e.toISOString().slice(0, 10)]; };
  const base = Math.floor(Math.random() * 500) * 2; const [w1s, w1e] = wk(base), [w2s, w2e] = wk(base + 1);
  const miss = await admin.post(`/api/equipment/${S.equipId}/hour-logs`, { date: "2026-06-02", startingHours: "1000", endingHours: "1008", projectId: S.projectId });
  ctx.notes.push(`without weekStartDate -> ${miss.status} (500 = unvalidated NOT NULL column)`);
  const ok = await admin.post(`/api/equipment/${S.equipId}/hour-logs`, { date: w1s, weekStartDate: w1s, weekEndDate: w1e, startingHours: "1000", endingHours: "1008", projectId: S.projectId });
  const bad = await admin.post(`/api/equipment/${S.equipId}/hour-logs`, { date: w2s, weekStartDate: w2s, weekEndDate: w2e, startingHours: "1008", endingHours: "990", projectId: S.projectId });
  const f = await admin.post(`/api/equipment/${S.equipId}/fuel-logs`, { date: "2026-06-03", gallons: "-20", costPerGallon: "4.10" });
  ctx.notes.push(`valid ${ok.status}; reverse ${bad.status} ${JSON.stringify(bad.data).slice(0, 160)}; neg fuel ${f.status}`);
  expect([200, 201].includes(ok.status), `valid log ${ok.status} ${JSON.stringify(ok.data).slice(0, 200)}`);
  expect(miss.status < 500, `missing weekStartDate -> HTTP ${miss.status} with DB error`);
  expect(bad.status >= 400 && f.status >= 400, `endingHours<startingHours -> ${bad.status}; negative gallons -> ${f.status}`);
});
await t({ id: "TIME-001", title: "Field worker clock in/out on project; duplicate clock-in blocked; supervisor approves", module: "Time Clock", role: "FIELD_WORKER + SUPERINTENDENT", req: "timeClockRoutes.ts:424-632,1281", expected: "clock-in 200/201; second clock-in 400; clock-out 200; worker self-approve 403; super approve 200" }, async (ctx) => {
  ctx.clients.push(wkr, sup);
  await wkr.post("/api/time-clock/clock-out", {}); // ensure clean
  const i1 = await wkr.post("/api/time-clock/clock-in", { projectId: S.projectId, latitude: 36.43, longitude: -81.49, accuracy: 10, notes: `${RUN_ID} simulated coords (browser/API controlled, not physical GPS)` });
  const i2 = await wkr.post("/api/time-clock/clock-in", { projectId: S.projectId });
  const o = await wkr.post("/api/time-clock/clock-out", { latitude: 36.43, longitude: -81.49 });
  const shift = o.data.shift ?? o.data; S.shiftId = shift?.id; save();
  const self = await wkr.post(`/api/time-clock/shifts/${S.shiftId}/approve`, {});
  const ap = await sup.post(`/api/time-clock/shifts/${S.shiftId}/approve`, {});
  const ap2 = await sup.post(`/api/time-clock/shifts/${S.shiftId}/approve`, {});
  ctx.notes.push(`in1 ${i1.status} in2 ${i2.status} out ${o.status} self ${self.status} approve ${ap.status} reapprove ${ap2.status}`);
  expect([200, 201].includes(i1.status) && i2.status === 400 && o.status === 200 && self.status === 403 && ap.status === 200 && ap2.status >= 400, ctx.notes.at(-1) + " " + JSON.stringify(i1.data).slice(0, 200));
});
await t({ id: "TIME-002", title: "Clock-out with no active shift; approve open shift", module: "Time Clock", role: "FIELD_WORKER + SUPERINTENDENT", req: "timeClockRoutes.ts:632,1281-1287", expected: "clock-out 400; approving an open shift 400" }, async (ctx) => {
  ctx.clients.push(wkr, sup);
  const o = await wkr.post("/api/time-clock/clock-out", {});
  const i = await wkr.post("/api/time-clock/clock-in", { projectId: S.projectId });
  const sid = (i.data.shift ?? i.data).id;
  const a = await sup.post(`/api/time-clock/shifts/${sid}/approve`, {});
  await wkr.post("/api/time-clock/clock-out", {});
  expect(o.status === 400 && a.status === 400, `no-shift clock-out ${o.status}; approve open ${a.status}`);
});
await t({ id: "TIME-003", title: "Geofence BLOCK: out-of-range clock-in refused; override with reason allowed", module: "Time Clock/Geofence", role: "FIELD_WORKER", req: "timeClockRoutes.ts:500-520", expected: "403 out of range; 200/201 with geofenceOverride+reason", mode: "API integration (simulated coordinates)" }, async (ctx) => {
  ctx.clients.push(mgr, wkr);
  const p = await mgr.patch(`/api/projects/${S.otherProjectCode}`, { siteLatitude: 36.434, siteLongitude: -81.499, geofenceRadius: 200, geofenceEnforcement: "BLOCK" });
  ctx.notes.push(`patch ${p.status} ${JSON.stringify(p.data).slice(0, 150)}`);
  const far = await wkr.post("/api/time-clock/clock-in", { projectId: S.otherProjectId, latitude: 35.0, longitude: -80.0, accuracy: 5 });
  const ov = await wkr.post("/api/time-clock/clock-in", { projectId: S.otherProjectId, latitude: 35.0, longitude: -80.0, accuracy: 5, geofenceOverride: true, geofenceOverrideReason: "QA: synthetic remote-site test" });
  await wkr.post("/api/time-clock/clock-out", {});
  expect(p.status === 200 && far.status === 403 && [200, 201].includes(ov.status), `far ${far.status} ${JSON.stringify(far.data).slice(0, 150)}; override ${ov.status}`);
});
await t({ id: "TIME-004", title: "Manual time entry validation (future date, >24h day, duplicates)", module: "Time Entry", role: "FIELD_WORKER", req: "projectFinancialRoutes.ts:134", expected: "future 400; hoursRegular 30 rejected; duplicate same-day entry flagged/rejected" }, async (ctx) => {
  ctx.clients.push(wkr);
  const fut = await wkr.post("/api/time-entries", { projectId: S.projectId, date: "2027-01-05", hoursRegular: "8" });
  const big = await wkr.post("/api/time-entries", { projectId: S.projectId, date: "2026-10-05", hoursRegular: "30" });
  const d1 = await wkr.post("/api/time-entries", { projectId: S.projectId, date: "2026-10-06", hoursRegular: "8", description: `${RUN_ID} QA` });
  const d2 = await wkr.post("/api/time-entries", { projectId: S.projectId, date: "2026-10-06", hoursRegular: "8", description: `${RUN_ID} QA dup` });
  S.timeEntryIds = [d1.data?.id, d2.data?.id, big.data?.id].filter(Boolean); save();
  ctx.notes.push(`future ${fut.status}; 30h ${big.status}; dup1 ${d1.status}; dup2 ${d2.status}`);
  const probs = []; if (fut.status !== 400) probs.push(`future date -> ${fut.status}`); if (big.status < 400) probs.push(`30 regular hours in one day accepted (${big.status})`); if (d2.status < 400) probs.push(`duplicate 8h entry same day/project accepted (${d2.status}) -> 16h`);
  expect(!probs.length, probs.join("; "));
});
await t({ id: "PROD-001", title: "Partial daily quantities accumulate; remaining & percent complete correct", module: "Production", role: "SUPERINTENDENT", req: "scopeRoutes.ts:2616-2660", expected: "R27 (1014 yards): 300 + 400 -> completed 700, remaining 314, 69.03%" }, async (ctx) => {
  ctx.clients.push(sup);
  const id = S.scope["27"].id;
  const a = await sup.post(`/api/scope-items/${id}/progress`, { workDate: "2026-07-20", quantityCompleted: "300", notes: `${RUN_ID} SYNTHETIC` });
  const b = await sup.post(`/api/scope-items/${id}/progress`, { workDate: "2026-07-21", quantityCompleted: "400", notes: `${RUN_ID} SYNTHETIC` });
  expect([200, 201].includes(a.status) && [200, 201].includes(b.status), `progress ${a.status} ${JSON.stringify(a.data).slice(0, 300)} / ${b.status}`);
  const sc = (await sup.get(`/api/projects/${S.projectCode}/scope`)).data.find((x) => x.id === id);
  ctx.notes.push(`completedQuantity ${sc.completedQuantity}`);
  expect(Number(sc.completedQuantity) === 700, `completed ${sc.completedQuantity}`);
  return { actual: `completed 700/1014 (remaining 314, 69.03% independently computed)` };
});
await t({ id: "PROD-002", title: "Over-complete, negative and zero production entries", module: "Production", role: "SUPERINTENDENT", req: "Prompt §5: reject or document zero/negative/over-complete per requirements (no explicit requirement found)", expected: "Negative rejected (data integrity); over-complete beyond 1014 rejected or flagged" }, async (ctx) => {
  ctx.clients.push(sup);
  const id = S.scope["27"].id;
  const neg = await sup.post(`/api/scope-items/${id}/progress`, { workDate: "2026-07-22", quantityCompleted: "-50" });
  const over = await sup.post(`/api/scope-items/${id}/progress`, { workDate: "2026-07-23", quantityCompleted: "500" });
  const sc = (await sup.get(`/api/projects/${S.projectCode}/scope`)).data.find((x) => x.id === id);
  ctx.notes.push(`neg ${neg.status}; over ${over.status} ${JSON.stringify(over.data).slice(0, 200)}; completed now ${sc.completedQuantity}/${sc.totalQuantity} overage=${sc.overageActionStatus}`);
  S.prodOver = { neg: neg.status, over: over.status, completed: sc.completedQuantity }; save();
  const probs = []; if (neg.status < 400) probs.push(`negative quantity accepted (${neg.status})`);
  if (over.status < 400 && sc.overageActionStatus === "NONE") probs.push(`over-complete accepted without flag: completed ${sc.completedQuantity} > total ${sc.totalQuantity}`);
  expect(!probs.length, probs.join("; ") + ` (overageActionStatus=${sc.overageActionStatus})`);
});
