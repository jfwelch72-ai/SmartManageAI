import fs from "node:fs";
import { Client, test, expect, RUN_ID, RUN_DIR, money } from "./lib.mjs";
import { loadRows, mapItems } from "./estimate-map.mjs";
const PW = process.env.SMA_QA_ADMIN_PASSWORD; if (!PW) throw new Error("SMA_QA_ADMIN_PASSWORD required");
const S = fs.existsSync(`${RUN_DIR}/state.json`) ? JSON.parse(fs.readFileSync(`${RUN_DIR}/state.json`)) : {};
const save = () => fs.writeFileSync(`${RUN_DIR}/state.json`, JSON.stringify(S, null, 1));
const tag = RUN_ID;
const sales = new Client("sales(MANAGER)"); await sales.login("sales@realtest.com", PW);
const est = new Client("estimator(ESTIMATOR)"); await est.login("estimator@realtest.com", PW);
const admin = new Client("admin(ADMIN)"); await admin.login("admin@realtest.com", PW);

await test({ id: "LC-CRM-001", title: "Create synthetic customer org/contact/opportunity", module: "CRM", role: "MANAGER (sales@)", tenant: "RealTest Construction", req: "Prompt §5 Customer and bid; crmRoutes.ts:783,1700,2416", expected: "201s; records persisted and retrievable" }, async (ctx) => {
  ctx.clients.push(sales);
  const o = await sales.post("/api/crm/organisations", { name: `${tag} Fictional Owner GC LLC (TEST)`, type: "CONTRACTOR" });
  expect([200, 201].includes(o.status), `org ${o.status} ${JSON.stringify(o.data)}`); S.crmOrgId = o.data.id ?? o.data.organisation?.id;
  const c = await sales.post("/api/crm/contacts", { organisationId: S.crmOrgId, firstName: "Test", lastName: `Contact ${tag}`, email: `qa+${tag.toLowerCase()}@example.test` });
  expect([200, 201].includes(c.status), `contact ${c.status} ${JSON.stringify(c.data)}`); S.crmContactId = c.data.id ?? c.data.contact?.id;
  const op = await sales.post("/api/crm/opportunities", { name: `${tag} Crane Logistics demo/pads (SYNTHETIC)`, crmOrganisationId: S.crmOrgId, contactId: S.crmContactId, dealValue: "782052.10" });
  expect([200, 201].includes(op.status), `opp ${op.status} ${JSON.stringify(op.data)}`); S.oppId = op.data.id ?? op.data.opportunity?.id;
  const g = await sales.get(`/api/crm/opportunities/${S.oppId}`);
  expect(g.status === 200, `get opp ${g.status}`);
  save(); return { actual: `org=${S.crmOrgId} contact=${S.crmContactId} opp=${S.oppId}` };
});

await test({ id: "LC-BID-001", title: "Create bid from opportunity", module: "Bids", role: "MANAGER (sales@)", tenant: "RealTest Construction", req: "crmRoutes.ts:3011", expected: "Bid created DRAFT, linked to opportunity" }, async (ctx) => {
  ctx.clients.push(sales);
  const b = await sales.post(`/api/crm/opportunities/${S.oppId}/create-bid`, { name: `${tag} Crane Logistics West Jefferson (00420)`, description: "QA run; source workbook 00420" });
  expect([200, 201].includes(b.status), `create-bid ${b.status} ${JSON.stringify(b.data).slice(0, 300)}`);
  const bid = b.data.bid ?? b.data; S.bidId = bid.id; S.bidCode = bid.code;
  expect(bid.status === "DRAFT", `status ${bid.status}`);
  save(); return { actual: `bid ${S.bidCode} (${S.bidId}) status=${bid.status}` };
});

await test({ id: "LC-EST-001", title: "Create estimate for bid", module: "Estimating", role: "ESTIMATOR", tenant: "RealTest Construction", req: "estimateRoutes.ts:659", expected: "Estimate created/returned for bid" }, async (ctx) => {
  ctx.clients.push(est);
  const e = await est.post(`/api/bids/${S.bidId}/estimate`, {});
  expect([200, 201].includes(e.status), `estimate ${e.status} ${JSON.stringify(e.data).slice(0, 300)}`);
  S.estimateId = (e.data.estimate ?? e.data).id; save();
  return { actual: `estimate ${S.estimateId}` };
});
fs.writeFileSync(`${RUN_DIR}/state.json`, JSON.stringify(S, null, 1));
