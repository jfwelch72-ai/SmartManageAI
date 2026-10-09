import fs from "node:fs";
import path from "node:path";
import { Client, test, expect, RUN_ID, RUN_DIR } from "./lib.mjs";
const PW = process.env.SMA_QA_ADMIN_PASSWORD;
const S = JSON.parse(fs.readFileSync(`${RUN_DIR}/state.json`));
const mgr = new Client("manager(MANAGER)"); await mgr.login("manager@realtest.com", PW);
const FX = `${RUN_DIR}/fixtures`;
const up = async (file, mime, name) => { const fd = new FormData(); fd.append("file", new Blob([fs.readFileSync(file)], { type: mime }), name ?? path.basename(file)); fd.append("projectId", S.projectId); return mgr.post("/api/labor-rates/prevailing-wage-rates/import-preview", fd); };
await test({ id: "CONC-TIME-001", title: "Concurrent duplicate clock-in taps create one shift", module: "Time Clock/Concurrency", role: "FIELD_WORKER (maintenance@)", tenant: "RealTest Construction", req: "Prompt §5/§9 duplicate taps, time-clock retries", expected: "Exactly one 2xx and one 400; one open shift" }, async (ctx) => {
  const w = new Client("worker"); ctx.clients.push(w); await w.login("maintenance@realtest.com", PW); await w.post("/api/time-clock/clock-out", {});
  const rs = await Promise.all([1, 2, 3].map(() => w.post("/api/time-clock/clock-in", { notes: `${RUN_ID} race probe (no project)` })));
  const st = rs.map((r) => r.status); const outs = []; for (let i = 0; i < 3; i++) { const o = await w.post("/api/time-clock/clock-out", {}); outs.push(o.status); if (o.status !== 200) break; }
  ctx.notes.push(`clock-in statuses ${st}; clock-outs ${outs}`);
  expect(st.filter((s) => s < 300).length === 1, `parallel clock-ins succeeded ${st.filter((s) => s < 300).length}x -> ${outs.filter((s) => s === 200).length} open shifts closed`);
});
