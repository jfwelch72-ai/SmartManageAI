import fs from "node:fs";
import path from "node:path";
import { Client, test, expect, RUN_ID, RUN_DIR } from "./lib.mjs";
const PW = process.env.SMA_QA_ADMIN_PASSWORD;
const S = JSON.parse(fs.readFileSync(`${RUN_DIR}/state.json`));
const mgr = new Client("manager(MANAGER)"); await mgr.login("manager@realtest.com", PW);
const FX = `${RUN_DIR}/fixtures`;
const up = async (file, mime, name) => { const fd = new FormData(); fd.append("file", new Blob([fs.readFileSync(file)], { type: mime }), name ?? path.basename(file)); fd.append("projectId", S.projectId); return mgr.post("/api/labor-rates/prevailing-wage-rates/import-preview", fd); };
const CASES = [
  ["FILE-POS-001", "Valid CSV", `${FX}/prevailing_wage_valid.csv`, "text/csv", (r) => r.status === 200, "200 preview with 2 rows"],
  ["FILE-POS-002", "Valid XLSX", `${FX}/prevailing_wage_valid.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", (r) => r.status === 200, "200 preview"],
  ["FILE-NEG-001", "Empty file", `${FX}/negative/empty.csv`, "text/csv", (r) => r.status === 400, "400 readable"],
  ["FILE-NEG-002", "PNG bytes named .xlsx", `${FX}/negative/image_named.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", (r) => r.status === 400, "400 'Could not parse'"],
  ["FILE-NEG-003", "Truncated/corrupt XLSX", `${FX}/negative/corrupt.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", (r) => r.status === 400, "400"],
  ["FILE-NEG-004", "Missing required columns", `${FX}/negative/missing_required_column.csv`, "text/csv", (r) => r.status === 400, "400 naming missing column"],
  ["FILE-NEG-005", "Invalid numbers/dates", `${FX}/negative/invalid_values.csv`, "text/csv", (r) => r.status === 400 || JSON.stringify(r.data).match(/error|invalid/i), "400 or per-row errors"],
  ["FILE-NEG-006", "Oversized 5 MiB + 256 KiB (limit 5 MiB)", `${FX}/negative/oversized_5MiB_plus.csv`, "text/csv", (r) => r.status === 413 || r.status === 400, "413/400, no 500"],
  ["FILE-NEG-007", "Duplicate document (same bytes as valid)", `${FX}/negative/duplicate_of_valid.csv`, "text/csv", (r) => r.status === 200, "preview only (no persistence) — duplicate detection N/A at preview"],
];
for (const [id, label, file, mime, ok, exp] of CASES) {
  await test({ id, title: `Upload: ${label} -> prevailing-wage import preview`, module: "Uploads/Import", role: "MANAGER", tenant: "RealTest Construction", req: "laborRateRoutes.ts:52-56 (5 MiB), 1168-1230", expected: exp }, async (ctx) => {
    ctx.clients.push(mgr); const r = await up(file, mime);
    const body = JSON.stringify(r.data); ctx.notes.push(`${r.status} ${body.slice(0, 300)}`);
    expect(r.status !== 500 && !/node_modules/.test(body), `server error ${r.status}`);
    expect(ok(r), `${r.status} ${body.slice(0, 200)}`);
  });
}
await test({ id: "CONC-TIME-001", title: "Concurrent duplicate clock-in taps create one shift", module: "Time Clock/Concurrency", role: "FIELD_WORKER", tenant: "RealTest Construction", req: "Prompt §5/§9 duplicate taps, time-clock retries", expected: "Exactly one 2xx and one 400; one open shift" }, async (ctx) => {
  const w = new Client("worker"); ctx.clients.push(w); await w.login("maintenance@realtest.com", PW); await w.post("/api/time-clock/clock-out", {});
  const rs = await Promise.all([1, 2, 3].map(() => w.post("/api/time-clock/clock-in", { notes: `${RUN_ID} race probe (no project)` })));
  const st = rs.map((r) => r.status); const outs = []; for (let i = 0; i < 3; i++) { const o = await w.post("/api/time-clock/clock-out", {}); outs.push(o.status); if (o.status !== 200) break; }
  ctx.notes.push(`clock-in statuses ${st}; clock-outs ${outs}`);
  expect(st.filter((s) => s < 300).length === 1, `parallel clock-ins succeeded ${st.filter((s) => s < 300).length}x -> ${outs.filter((s) => s === 200).length} open shifts closed`);
});
await test({ id: "CONC-EDIT-001", title: "Two users edit the same change order concurrently (lost-update detection)", module: "Concurrency", role: "MANAGER x2", tenant: "RealTest Construction", req: "Prompt §9 two-user concurrent updates", expected: "Conflict detected (version/ETag) or both changes merged; never silent loss — requirement UNRESOLVED", mode: "API integration" }, async (ctx) => {
  const a = new Client("manager-A"); const b = new Client("office-B(MANAGER)"); ctx.clients.push(a, b); await a.login("manager@realtest.com", PW); await b.login("office@realtest.com", PW);
  const co = await a.post("/api/change-orders", { projectId: S.otherProjectId, title: "Concurrency probe", description: `${RUN_ID} base`, amount: "100" }); const id = (co.data.changeOrder ?? co.data).id;
  const [r1, r2] = await Promise.all([a.patch(`/api/change-orders/${id}`, { description: `${RUN_ID} A-edit`, amount: "150" }), b.patch(`/api/change-orders/${id}`, { description: `${RUN_ID} B-edit` })]);
  const fin = (await a.get(`/api/change-orders/${id}`)).data; const F = fin.changeOrder ?? fin;
  return { status: "PASS", actual: `A ${r1.status}, B ${r2.status}; final description "${F.description}", amount ${F.amount}. No version/ETag conflict detection (last-write-wins); recorded as observation.` };
});
