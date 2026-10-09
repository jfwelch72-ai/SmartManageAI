import fs from "node:fs";
import { Client, test, expect, RUN_ID, RUN_DIR, money } from "./lib.mjs";
const PW = process.env.SMA_QA_ADMIN_PASSWORD;
const S = JSON.parse(fs.readFileSync(`${RUN_DIR}/state.json`));
const mgr = new Client("manager(MANAGER)"); await mgr.login("manager@realtest.com", PW);
const sum = (a, k) => money(a.reduce((x, r) => x + Number(r[k] || 0), 0));
const SRC = { labor: 151800, material: 281329.68, equipment: 0, sub: 98850, other: 91963, cost: 623942.68, price: 782052.11 };

await test({ id: "PRJ-SET-001", title: "Awarded project carries customer, contract amount and approved estimate", module: "Projects", role: "MANAGER", tenant: "RealTest Construction", req: "Prompt §5 Project setup", expected: `clientName = CRM customer org; contractAmount = ${SRC.price}; budget = direct cost ${SRC.cost}` }, async (ctx) => {
  ctx.clients.push(mgr);
  const p = (await mgr.get(`/api/projects/${S.projectCode}`)).data;
  fs.writeFileSync(`${RUN_DIR}/evidence/api/project-260001-snapshot.json`, JSON.stringify(p, null, 1));
  const probs = [];
  if (Number(p.contractAmount) !== SRC.price) probs.push(`contractAmount ${p.contractAmount}`);
  if (Number(p.budget) !== SRC.cost) probs.push(`budget ${p.budget}`);
  if (!/Fictional Owner GC LLC/.test(p.clientName)) probs.push(`clientName is "${p.clientName}" (the opportunity name), not the CRM customer organisation (crmRoutes.ts:3038 sets clientName: opp.name)`);
  expect(!probs.length, probs.join("; "));
});

await test({ id: "PRJ-SOV-001", title: "Initial SOV reconciles to contract", module: "Billing/SOV", role: "MANAGER", tenant: "RealTest Construction", req: "storage.drizzle.ts:1107-1165", expected: "29 SOV lines; sum scheduledValue = contractValue = 782052.11; alternate lines identifiable" }, async (ctx) => {
  ctx.clients.push(mgr);
  const sov = (await mgr.get(`/api/sov?projectId=${S.projectId}`)).data[0]; S.sovId = sov.id;
  fs.writeFileSync(`${RUN_DIR}/state.json`, JSON.stringify(S, null, 1));
  const li = sov.lineItems; const tot = sum(li, "scheduledValue");
  ctx.notes.push(`lines=${li.length} sum=${tot} contractValue=${sov.contractValue} retainage%=${sov.retainagePercent}`);
  expect(li.length === 29 && tot === SRC.price && Number(sov.contractValue) === SRC.price, `lines ${li.length} sum ${tot} contract ${sov.contractValue}`);
  return { actual: `29 lines, sum ${tot}` };
});

await test({ id: "PRJ-BUD-001", title: "Budget lines reconcile to source cost categories without double counting", module: "Job Cost/Budget", role: "MANAGER", tenant: "RealTest Construction", req: "Prompt §5 'budget to source categories without double counting'; project.budget = direct cost", expected: `labor ${SRC.labor}, material ${SRC.material}, equip ${SRC.equipment}, sub ${SRC.sub}, other ${SRC.other}; total = ${SRC.cost} = project.budget` }, async (ctx) => {
  ctx.clients.push(mgr);
  const bl = (await mgr.get(`/api/projects/${S.projectCode}/budget-lines`)).data.lines;
  fs.writeFileSync(`${RUN_DIR}/evidence/api/project-260001-budget-lines.json`, JSON.stringify(bl, null, 1));
  const got = { labor: sum(bl, "laborBudget"), material: sum(bl, "materialBudget"), equipment: sum(bl, "equipmentBudget"), sub: sum(bl, "subcontractorBudget"), other: sum(bl, "otherBudget"), total: sum(bl, "totalBudget") };
  ctx.notes.push(JSON.stringify(got));
  const diffs = Object.entries({ labor: SRC.labor, material: SRC.material, equipment: SRC.equipment, sub: SRC.sub, other: SRC.other, total: SRC.cost }).filter(([k, v]) => Math.abs(got[k] - v) > 0.011).map(([k, v]) => `${k} ${got[k]} vs ${v} (Δ ${money(got[k] - v)})`);
  expect(!diffs.length, `Budget lines: ${diffs.join("; ")}. Profit allocation appears seeded into otherBudget, so total budget equals contract price, not direct cost; project.budget field says ${SRC.cost}.`);
});

await test({ id: "PRJ-CTR-001", title: "Draft prime contract created at award", module: "Contracts", role: "MANAGER", tenant: "RealTest Construction", req: "storage.drizzle.ts:1806-1830", expected: "One DRAFT PRIME contract CTR-<code>-001 value = 782052.11; parties = customer" }, async (ctx) => {
  ctx.clients.push(mgr);
  const cs = (await mgr.get(`/api/contracts?projectId=${S.projectId}`)).data; S.contractId = cs[0]?.id; fs.writeFileSync(`${RUN_DIR}/state.json`, JSON.stringify(S, null, 1));
  expect(cs.length === 1 && cs[0].status === "DRAFT" && Number(cs[0].contractValue) === SRC.price, JSON.stringify(cs.map((c) => [c.contractNumber, c.status, c.contractValue])));
  return { actual: `${cs[0].contractNumber} ${cs[0].status} ${cs[0].contractValue}; parties="${cs[0].parties}" (opportunity name, see PRJ-SET-001)` };
});

await test({ id: "PRJ-SCOPE-001", title: "Scope items created per estimate line with quantities/units", module: "Production/Scope", role: "MANAGER", tenant: "RealTest Construction", req: "storage.drizzle.ts:1046-1103", expected: "29 scope items; quantities equal source B column" }, async (ctx) => {
  ctx.clients.push(mgr);
  const sc = (await mgr.get(`/api/projects/${S.projectCode}/scope`)).data;
  S.scope = Object.fromEntries(sc.map((x) => [x.description.match(/^\[R(\d+)\]/)?.[1], { id: x.id, qty: Number(x.totalQuantity), unit: x.unit, unitPrice: Number(x.unitPrice) }]));
  fs.writeFileSync(`${RUN_DIR}/state.json`, JSON.stringify(S, null, 1));
  const r27 = S.scope["27"];
  expect(sc.length === 29 && r27.qty === 1014 && r27.unit === "yards", `count ${sc.length} r27 ${JSON.stringify(r27)}`);
  return { actual: `29 scope items; R27 qty ${r27.qty} ${r27.unit}, unitPrice ${r27.unitPrice}` };
});
