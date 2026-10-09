// Bounded exploratory load test (prompt §9). LOCAL verified-isolated backend ONLY (refuses non-localhost).
// Stages: smoke(1) -> 5 -> 10 -> 25 VUs x STAGE_SEC each; global ceiling MAX_RPS; think 1-3s; optional soak.
import fs from "node:fs";
import { Client, RUN_ID, RUN_DIR, BASE, money } from "./lib.mjs";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error(`Refusing to load-test non-local backend ${BASE}`);
const PW = process.env.SMA_QA_ADMIN_PASSWORD; const STAGE_SEC = Number(process.env.STAGE_SEC || 120); const MAX_RPS = Number(process.env.MAX_RPS || 20); const SOAK_SEC = Number(process.env.SOAK_SEC || 900);
const STAGES = (process.env.STAGES || "1,5,10,25").split(",").map(Number);
const OUT = `${RUN_DIR}/evidence/load`; fs.mkdirSync(OUT, { recursive: true });
const S = JSON.parse(fs.readFileSync(`${RUN_DIR}/state.json`));
// ---- fixtures (idempotent) ----
const admin = new Client("load-admin"); await admin.login("admin@realtest.com", PW);
const mgr = new Client("load-mgr"); await mgr.login("manager@realtest.com", PW);
if (!S.load) {
  const p = (await mgr.post("/api/projects", { name: `${RUN_ID} LOAD-TEST project (disposable)`, clientName: "QA load", status: "ACTIVE" })).data;
  const scope = []; for (let i = 0; i < 25; i++) { const r = await mgr.post(`/api/projects/${p.code}/scope`, { description: `${RUN_ID} load item ${i}`, unit: "EA", totalQuantity: "100000" }); scope.push(r.data.id ?? r.data.item?.id); }
  const users = []; for (let i = 0; i < 25; i++) { const email = `qa-load-${String(i).padStart(2, "0")}-${RUN_ID.toLowerCase()}@example.test`; const pw = `QaLoad!${i}Aa${RUN_ID.slice(-6)}`; const r = await admin.post("/api/users", { firstName: "QA", lastName: `Load ${i} (SYNTHETIC)`, email, role: "FIELD_WORKER", password: pw }); users.push({ email, pw, id: r.data.id ?? r.data.user?.id, status: r.status }); }
  S.load = { projectId: p.id, code: p.code, scope, users }; fs.writeFileSync(`${RUN_DIR}/state.json`, JSON.stringify(S, null, 1));
}
const L = S.load; console.log(`load fixtures: project ${L.code}, users ok ${L.users.filter((u) => u.status < 300).length}/25`);
// ---- global token bucket ----
let tokens = MAX_RPS; setInterval(() => { tokens = MAX_RPS; }, 1000).unref();
const take = async () => { while (tokens <= 0) await new Promise((r) => setTimeout(r, 25)); tokens--; };
const samples = []; // {stage, op, ms, status, t}
const OPS = [ // weight, name, fn(client, i)
  [25, "project_read", (c) => c.get(`/api/projects/${S.projectCode}`)],
  [15, "project_search", (c) => c.get(`/api/projects?search=${encodeURIComponent("Crane")}&limit=25`)],
  [15, "schedule_read", (c) => c.get(`/api/projects/${S.projectCode}/schedule`)],
  [10, "scope_read", (c) => c.get(`/api/projects/${L.code}/scope`)],
  [10, "production_write", (c, i) => c.post(`/api/scope-items/${L.scope[i % 25]}/progress`, { workDate: "2026-10-01", quantityCompleted: "1", notes: `${RUN_ID} load` })],
  [10, "timeclock_cycle", async (c) => { const a = await c.post("/api/time-clock/clock-in", { projectId: L.projectId, latitude: 36.43, longitude: -81.49 }); await take(); const b = await c.post("/api/time-clock/clock-out", {}); return { status: a.status >= 300 ? a.status : b.status, ms: a.ms + b.ms }; }],
  [10, "cost_ledger_read", (c) => c.get(`/api/projects/${S.projectCode}/cost-ledger`)],
  [5, "file_g702_pdf", (c) => c.get(`/api/aia-billing/pay-applications/${S.fb.apps[1]}/g702-pdf`, { raw: true })],
];
const W = OPS.reduce((a, o) => a + o[0], 0);
const pick = () => { let r = Math.random() * W; for (const o of OPS) { if ((r -= o[0]) < 0) return o; } return OPS[0]; };
async function vu(i, stage, until, stop) {
  const u = L.users[i % 25]; const c = new Client(`vu${i}`); c.log = { push() {} };
  try { await c.login(u.email, u.pw); } catch (e) { samples.push({ stage, op: "login", ms: 0, status: 0, t: Date.now(), err: String(e).slice(0, 120) }); return; }
  const rm = new Client(`vu${i}-mgr`); rm.log = { push() {} }; await rm.login("manager@realtest.com", PW); // financial reads need a financial role
  while (Date.now() < until && !stop.v) {
    const [, name, fn] = pick(); const client = ["cost_ledger_read", "file_g702_pdf", "project_search", "schedule_read"].includes(name) ? rm : c;
    await take(); const t0 = performance.now(); let st = 0;
    try { const r = await fn(client, i); st = r.status; } catch (e) { st = -1; }
    samples.push({ stage, op: name, ms: Math.round(performance.now() - t0), status: st, t: Date.now() });
    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
  }
}
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
function summarize(stage, from, to) {
  const ss = samples.filter((s) => s.stage === stage); const byOp = {};
  for (const s of ss) (byOp[s.op] ||= []).push(s);
  const dur = (to - from) / 1000; const errs = ss.filter((s) => s.status >= 500 || s.status <= 0).length;
  const r = { stage, durationSec: Math.round(dur), samples: ss.length, achievedRps: +(ss.length / dur).toFixed(2), err5xxOrNet: errs, errRate: ss.length ? +(errs / ss.length).toFixed(4) : 0, status4xx: ss.filter((s) => s.status >= 400 && s.status < 500).length, p50: pct(ss.map((s) => s.ms), 50), p95: pct(ss.map((s) => s.ms), 95), p99: pct(ss.map((s) => s.ms), 99), ops: {} };
  for (const [k, v] of Object.entries(byOp)) r.ops[k] = { n: v.length, p50: pct(v.map((s) => s.ms), 50), p95: pct(v.map((s) => s.ms), 95), p99: pct(v.map((s) => s.ms), 99), statuses: v.reduce((a, s) => ((a[s.status] = (a[s.status] || 0) + 1), a), {}) };
  return r;
}
function windowCheck(stage) { const now = Date.now(); const w = samples.filter((s) => s.stage === stage && s.t > now - 60000); if (w.length < 20) return null; const e = w.filter((s) => s.status >= 500 || s.status <= 0).length / w.length; return { e, p95: pct(w.map((s) => s.ms), 95) }; }
const results = []; let highestStable = 0;
const mem0 = await fetch(`${BASE}/api/health`).then((r) => r.status).catch(() => 0);
for (const n of [...STAGES, ...(SOAK_SEC > 0 ? ["soak"] : [])]) {
  const vus = n === "soak" ? highestStable : n; const secs = n === "soak" ? SOAK_SEC : n === 1 ? Math.min(60, STAGE_SEC) : STAGE_SEC;
  if (!vus) break; const stage = n === "soak" ? `soak-${vus}` : `vu-${vus}`; const from = Date.now(), until = from + secs * 1000;
  let aborted = null; let badWindows = 0;
  const guard = setInterval(() => { const w = windowCheck(stage); if (!w) return; if (w.e > 0.05) aborted = `5xx/net error rate ${(w.e * 100).toFixed(1)}% > 5% over 60s`; if (w.p95 > 10000) { if (++badWindows >= 2) aborted = `p95 ${w.p95}ms > 10s for 2 windows`; } else badWindows = 0; }, 60000);
  console.log(`stage ${stage} start ${new Date(from).toISOString()} (${secs}s)`);
  const stop = { v: false }; const watcher = setInterval(() => { if (aborted) stop.v = true; }, 500);
  await Promise.all(Array.from({ length: vus }, (_, i) => vu(i, stage, until, stop)));
  clearInterval(guard); clearInterval(watcher);
  const r = summarize(stage, from, Date.now()); r.aborted = aborted; results.push(r); console.log(JSON.stringify({ stage, rps: r.achievedRps, p95: r.p95, errRate: r.errRate, aborted }));
  fs.writeFileSync(`${OUT}/load-summary.json`, JSON.stringify({ runId: RUN_ID, base: BASE, maxRps: MAX_RPS, thinkMs: "1000-3000", stages: results }, null, 1));
  if (aborted) break; if (n !== "soak" && r.errRate <= 0.05 && r.p95 < 10000) highestStable = vus;
}
fs.writeFileSync(`${OUT}/load-samples.jsonl`, samples.map((s) => JSON.stringify(s)).join("\n"));
// post-load integrity: duplicate open shifts, progress row counts
const sc = (await mgr.get(`/api/projects/${L.code}/scope`)).data; const wrote = samples.filter((s) => s.op === "production_write" && s.status === 201).length;
const persisted = sc.reduce((a, x) => a + Number(x.completedQuantity), 0);
fs.writeFileSync(`${OUT}/load-integrity.json`, JSON.stringify({ productionWrites201: wrote, persistedCompletedQuantitySum: persisted, match: wrote === persisted, health: mem0 }, null, 1));
console.log(`integrity: production 201s=${wrote} persisted qty sum=${persisted}`);
process.exit(0);
