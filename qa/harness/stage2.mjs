import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { Client, test, expect, RUN_ID, RUN_DIR, money } from "./lib.mjs";
import { loadRows, mapItems } from "./estimate-map.mjs";
const PW = process.env.SMA_QA_ADMIN_PASSWORD;
const S = JSON.parse(fs.readFileSync(`${RUN_DIR}/state.json`));
const save = () => fs.writeFileSync(`${RUN_DIR}/state.json`, JSON.stringify(S, null, 1));
const est = new Client("estimator(ESTIMATOR)"); await est.login("estimator@realtest.com", PW);
const admin = new Client("admin(ADMIN)"); await admin.login("admin@realtest.com", PW);
const OUT = `${RUN_DIR}/evidence/docs`; fs.mkdirSync(OUT, { recursive: true });
const d = loadRows(RUN_DIR); const { items, notes } = mapItems(d);
const EXP = { labor: 151800, material: 281329.68, equipment: 0, sub: 98850, other: 91963, cost: 623942.68, price: 782052.11, profit: 158109.43 /* sum of per-line cent-rounded values; workbook unrounded P120=782052.0975 */,
  altCost: 11952, altPrice: money(11931.43 + 5142.86) };

await test({ id: "EST-IMP-001", title: "Import original workbook through Bid Tab Import path (product parser + dialog payload)", module: "Estimating/Import", role: "ESTIMATOR", tenant: "RealTest Construction", mode: "API integration (product client parser executed in Node) ", req: "Prompt §3/§5: import workbook; validate mapping, category costs, totals, notes", expected: "Only real work items imported with their costs; header/note/total rows not imported as priced items; totals reconcile to O120 $623,942.68 / P120 $782,052.10" }, async (ctx) => {
  ctx.clients.push(est);
  const b = await est.post("/api/bids", { name: `${RUN_ID} 00420 AS-SUPPLIED import`, clientName: `${RUN_ID} Fictional Owner (TEST)` });
  expect(b.status === 201, `bid ${b.status}`); S.bidAsSupplied = { id: b.data.id, code: b.data.code };
  const e = await est.post(`/api/bids/${b.data.id}/estimate`, {}); const eid = (e.data.estimate ?? e.data).id; S.bidAsSupplied.estimateId = eid;
  const parsed = JSON.parse(fs.readFileSync(`${RUN_DIR}/estimate/bidtab_parser_output.json`));
  const payload = parsed.map((r) => ({ category: "GENERAL", description: r.description, quantity: r.quantity, unit: r.unit || "EA", materialCost: 0, laborCost: 0, laborHours: 0, equipmentCost: 0, equipmentHours: 0, consumablesCost: 0, subcontractCost: 0, overheadAllocation: 0, profitAllocation: 0 }));
  const r = await est.post(`/api/estimates/${eid}/line-items/bulk`, { lineItems: payload });
  expect(r.status === 201, `bulk ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);
  const g = await est.get(`/api/bids/${b.data.id}/estimate`);
  const li = (g.data.estimate ?? g.data).lineItems ?? []; const tot = li.reduce((a, x) => a + Number(x.totalCost), 0);
  const junk = li.filter((x) => /Grand Total|SALES TAX|OVERHEAD & PROFIT|SUBCONTRACTOR MARK UP|WORK ITEMS|TFR Construction|Job #|Job Name|Date:/.test(x.description));
  ctx.notes.push(`persisted ${li.length} lines; total=${tot}; non-item rows imported: ${junk.map((x) => x.description).join(" | ")}`);
  save();
  expect(li.length === 29 && Math.abs(tot - EXP.price) < 0.01, `Imported ${li.length} lines (29 priced work items expected), estimate total $${tot.toFixed(2)} (expected $782,052.10). ${junk.length} header/note/total rows imported as qty-1 line items incl. "Grand Total"; all labor/material/sub/other costs dropped (payload hard-codes 0, BidTabImportDialog.tsx:407-434; parser keeps only description/qty/unit, bidTabParser.ts:53-110).`);
});

await test({ id: "EST-IMP-002", title: "Load mapped full-cost estimate via bulk line-item API", module: "Estimating", role: "ESTIMATOR", tenant: "RealTest Construction", req: "estimateRoutes.ts:2012; mapping in qa/harness/estimate-map.mjs", expected: "29 items persisted; category sums equal F/H/J/L/N120; sum(totalCost) = P120 $782,052.10" }, async (ctx) => {
  ctx.clients.push(est);
  const payload = items.map(({ sourceRow, ...x }) => x);
  const pre = await est.get(`/api/bids/${S.bidId}/estimate`);
  if ((pre.data.estimate.lineItems || []).length === 0) {
    const r = await est.post(`/api/estimates/${S.estimateId}/line-items/bulk`, { lineItems: payload });
    expect(r.status === 201, `bulk ${r.status} ${JSON.stringify(r.data).slice(0, 400)}`);
  } else ctx.notes.push("idempotent re-run: lines already imported; verifying persisted state only");
  const g = await est.get(`/api/bids/${S.bidId}/estimate`);
  fs.writeFileSync(`${RUN_DIR}/estimate/app_estimate_after_import.json`, JSON.stringify(g.data, null, 1));
  const li = (g.data.estimate ?? g.data).lineItems; const sum = (k) => money(li.reduce((a, x) => a + Number(x[k] || 0), 0));
  const got = { labor: sum("laborCost"), material: sum("materialCost"), equipment: sum("equipmentCost"), sub: sum("subcontractCost"), other: sum("consumablesCost"), price: sum("totalCost"), profit: sum("profitAllocation") };
  S.lineItemIds = Object.fromEntries(li.map((x) => { let m = x.metadata; try { if (typeof m === 'string') m = JSON.parse(m); } catch {} return [m?.sourceRow ?? x.description, x.id]; })); save();
  ctx.notes.push(JSON.stringify({ got, totalsBlock: g.data.totals ?? null, appliedTotals: g.data.appliedTotals ?? g.data.factoredTotals ?? null }));
  expect(li.length === 29, `count ${li.length}`);
  for (const k of ["labor", "material", "equipment", "sub", "other", "price", "profit"]) expect(Math.abs(got[k] - EXP[k]) < 0.011, `${k}: got ${got[k]} expected ${EXP[k]}`);
  return { actual: `29 lines; ${JSON.stringify(got)}` };
});

await test({ id: "EST-CALC-001", title: "Estimate roll-up shown to users does not re-apply markup on top of margin-priced totals", module: "Estimating", role: "ESTIMATOR", tenant: "RealTest Construction", req: "Prompt §3: do not apply margins twice; estimateRoutes.ts:578-620 applyOrgFactors", expected: "Displayed grand total equals $782,052.10 (sum of priced lines) unless org factors are explicitly configured and disclosed" }, async (ctx) => {
  ctx.clients.push(est);
  const g = await est.get(`/api/bids/${S.bidId}/estimate`);
  const keys = Object.keys(g.data); ctx.notes.push("response keys: " + keys.join(","));
  const cand = JSON.stringify(g.data, (k, v) => (k === "lineItems" ? undefined : v));
  ctx.notes.push(cand.slice(0, 3000));
  const gt = g.data.appliedTotals?.grandTotal ?? g.data.totals?.grandTotal ?? g.data.grandTotal ?? g.data.estimate?.appliedTotals?.grandTotal;
  ctx.notes.push("top-level: " + JSON.stringify(Object.fromEntries(Object.entries(g.data).filter(([k])=>k!=="estimate"))).slice(0,3000));
  expect(gt !== undefined, "no grandTotal field found in response: " + keys.join(","));
  expect(Math.abs(Number(gt) - EXP.price) < 0.011, `grandTotal ${gt} != ${EXP.price} (diff ${(Number(gt) - EXP.price).toFixed(2)})`);
  return { actual: `grandTotal=${gt}` };
});

await test({ id: "EST-ALT-001", title: "Alternate group: mark rows 56-57 as ALTERNATE, verify base vs alternate roll-up", module: "Estimating/Alternates", role: "ESTIMATOR", tenant: "RealTest Construction", req: "Prompt §3 alternate rows 55-57; estimatePricingRoutes.ts:84,159,386", expected: "Base = $782,052.10 - $17,074.29 = $764,977.81; Alternate = $17,074.29 (source currently INCLUDES alternate in P120)" }, async (ctx) => {
  ctx.clients.push(est);
  const ex = await est.get(`/api/estimates/${S.estimateId}/alternate-groups`);
  const exList = Array.isArray(ex.data) ? ex.data : (ex.data.groups ?? []);
  let g1 = exList.find((x) => x.code === "ALT-1");
  if (!g1) { const gr = await est.post(`/api/estimates/${S.estimateId}/alternate-groups`, { code: "ALT-1", name: "Crackbond CSR self-leveling (src rows 55-57)", defaultIncluded: true });
    expect([200, 201].includes(gr.status), `group ${gr.status} ${JSON.stringify(gr.data)}`); g1 = gr.data.group ?? gr.data; }
  S.altGroupId = g1.id;
  for (const row of [56, 57]) {
    const r = await est.patch(`/api/estimates/${S.estimateId}/line-items/${S.lineItemIds[row]}/line-type`, { lineType: "ALTERNATE", alternateGroupId: S.altGroupId });
    expect(r.status === 200, `line-type ${row} ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  }
  save();
  const ro = await est.get(`/api/estimates/${S.estimateId}/rollup-by-line-type`);
  fs.writeFileSync(`${RUN_DIR}/estimate/app_rollup_by_line_type.json`, JSON.stringify(ro.data, null, 1));
  ctx.notes.push(JSON.stringify(ro.data).slice(0, 2000));
  expect(ro.status === 200, `rollup ${ro.status}`);
  const s = JSON.stringify(ro.data);
  expect(Math.abs(ro.data.baseSubtotal - 764977.82) < 0.011, `baseSubtotal ${ro.data.baseSubtotal}`);
  expect(Math.abs(ro.data.alternates?.[0]?.subtotal - 17074.29) < 0.011, `alt subtotal ${ro.data.alternates?.[0]?.subtotal}`);
  expect(Math.abs(ro.data.totalWithDefaultAlternates - 782052.11) < 0.011, `totalWithDefaultAlternates ${ro.data.totalWithDefaultAlternates}`);
});

await test({ id: "EST-ALT-NEG-001", title: "Duplicate alternate group code is rejected cleanly", module: "Estimating/Alternates", role: "ESTIMATOR", tenant: "RealTest Construction", req: "Defensible API contract: duplicate unique key -> 4xx with message, no internals", expected: "409/400 with readable error; no stack trace or SQL detail in response" }, async (ctx) => {
  ctx.clients.push(est);
  const r = await est.post(`/api/estimates/${S.estimateId}/alternate-groups`, { code: "ALT-1", name: "dup", defaultIncluded: false });
  const body = JSON.stringify(r.data);
  expect(r.status >= 400 && r.status < 500, `status ${r.status}`);
  expect(!/stack|constraint|node_modules/.test(body), "internals leaked: " + body.slice(0, 200));
});

const BASE_EXP = "764,977.82", ALT_EXP = "17,074.29"; // per-line cent-rounded app values; independent unrounded base = 764,977.81 (see expected_results.json)
for (const [id, inc] of [["EST-PROP-001", true], ["EST-PROP-002", false]]) {
  await test({ id, title: `Generate proposal PDF with alternate ALT-1 ${inc ? "INCLUDED (source state)" : "EXCLUDED"}`, module: "Estimating/Proposal", role: "ESTIMATOR", tenant: "RealTest Construction", req: "estimatePricingRoutes.ts:662; proposalPdf.ts:78,164", expected: `Valid PDF; base subtotal $${BASE_EXP}; ALT-1 subtotal $${ALT_EXP} marked ${inc ? "INCLUDED" : "EXCLUDED"}; line items present` }, async (ctx) => {
    ctx.clients.push(est);
    if (!inc) { const p = await est.patch(`/api/estimates/${S.estimateId}/alternate-groups/${S.altGroupId}`, { defaultIncluded: false }); expect(p.status === 200, `patch group ${p.status}`); }
    const r = await est.get(`/api/estimates/${S.estimateId}/export/proposal-pdf`, { raw: true });
    if (!inc) await est.patch(`/api/estimates/${S.estimateId}/alternate-groups/${S.altGroupId}`, { defaultIncluded: true }); // restore source inclusion
    expect(r.status === 200, `status ${r.status}`);
    const f = `${OUT}/${id}-proposal.pdf`; fs.writeFileSync(f, r.data); ctx.evidence.push(f.replace(RUN_DIR + "/", ""));
    expect(r.data.slice(0, 4).toString() === "%PDF", "not a PDF");
    const txt = execFileSync("pdftotext", ["-layout", f, "-"]).toString(); fs.writeFileSync(f + ".txt", txt);
    const probs = [];
    if (!txt.includes(BASE_EXP)) probs.push(`base ${BASE_EXP} missing`);
    if (!txt.includes(ALT_EXP)) probs.push(`alt ${ALT_EXP} missing`);
    if (!txt.includes(inc ? "[INCLUDED]" : "[EXCLUDED]")) probs.push(`alt not marked ${inc ? "INCLUDED" : "EXCLUDED"}`);
    if (!/total/i.test(txt.replace(/Subtotal/gi, ""))) probs.push("no bid/contract total line (only subtotals)");
    ctx.notes.push(txt.slice(0, 1500));
    expect(probs.length === 0, probs.join("; "));
  });
}

await test({ id: "EST-VER-001", title: "Edit a line, verify version snapshot history", module: "Estimating", role: "ESTIMATOR", tenant: "RealTest Construction", req: "estimateRoutes.ts:2177 (PUT line), 246-270 snapshot, 3225 versions", expected: "Edit persisted; version count increments; earlier version retains prior value" }, async (ctx) => {
  ctx.clients.push(est);
  const v = (x) => (Array.isArray(x.data) ? x.data : x.data?.versions ?? []);
  const url = `/api/bids/${S.bidCode}/estimates/${S.estimateId}/versions`;
  const before = await est.get(url); expect(before.status === 200, `versions ${before.status}`);
  const lid = S.lineItemIds[52];
  const p = await est.put(`/api/estimates/${S.estimateId}/line-items/${lid}`, { notes: `${RUN_ID} QA edit (no value change)` });
  expect(p.status === 200, `PUT line ${p.status} ${JSON.stringify(p.data).slice(0, 300)}`);
  const after = await est.get(url);
  ctx.notes.push(`versions before=${v(before).length} after=${v(after).length}`);
  expect(v(after).length > v(before).length, `version count ${v(before).length} -> ${v(after).length}`);
  const g = await est.get(`/api/bids/${S.bidId}/estimate`);
  const li = g.data.estimate.lineItems.find((x) => x.id === lid);
  expect(li.notes?.includes("QA edit") && Number(li.totalCost) === 2428.57, `persisted ${li.notes} ${li.totalCost}`);
  return { actual: `versions ${v(before).length} -> ${v(after).length}; edit persisted` };
});
await test({ id: "EST-VER-RESTORE", title: "QA restore of line 52 after EST-VER-001 (full-body PUT)", module: "Estimating", role: "ESTIMATOR", tenant: "RealTest Construction", mode: "API integration (fixture restore)", req: "Fixture hygiene", expected: "Line 52 totalCost back to 2428.57" }, async (ctx) => {
  ctx.clients.push(est);
  const lid = S.lineItemIds[52];
  const r = await est.put(`/api/estimates/${S.estimateId}/line-items/${lid}`, { category: "GENERAL", description: "[R52] concrete washout containment rental", quantity: "2", unit: "months", materialCost: "1700", laborCost: "0", laborHours: "0", equipmentCost: "0", equipmentHours: "0", consumablesCost: "0", subcontractCost: "0", overheadAllocation: "0", profitAllocation: "728.57", notes: null });
  const g = await est.get(`/api/bids/${S.bidId}/estimate`);
  const li = g.data.estimate.lineItems.find((x) => x.id === lid);
  expect(Number(li.totalCost) === 2428.57, `after restore ${li.totalCost} (PUT ${r.status})`);
});

await test({ id: "API-404-001", title: "Unknown /api routes return JSON 404 (not SPA HTML 200)", module: "Platform/API", role: "ESTIMATOR", tenant: "RealTest Construction", req: "Defensible REST contract; clients rely on status codes", expected: "404 JSON for GET and PATCH to non-existent /api paths" }, async (ctx) => {
  ctx.clients.push(est);
  const a = await est.get(`/api/estimates/${S.estimateId}/versions`);
  const b = await est.patch(`/api/estimates/${S.estimateId}/line-items/${S.lineItemIds[52]}`, { notes: "x" });
  const c = await est.get(`/api/this-route-does-not-exist-${RUN_ID}`);
  const res = [a, b, c].map((r) => `${r.entry.method} ${r.entry.url} -> ${r.status} ${String(r.headers.get("content-type"))}`);
  ctx.notes.push(...res);
  expect([a, b, c].every((r) => r.status === 404), res.join(" | "));
});

await test({ id: "EST-NOTE-001", title: "Record estimate-level scope notes/exclusions (row 12 GC layout responsibility) so they reach the proposal", module: "Estimating/Proposal", role: "ESTIMATOR", tenant: "RealTest Construction", mode: "API integration + static inspection", req: "Prompt §3 'Preserve notes and exclusions, including row 12'; proposalPdf renders est.notes (estimatePricingRoutes.ts:713)", expected: "An authorized user can set estimate notes/exclusions after creation and they print on the proposal" }, async (ctx) => {
  ctx.clients.push(est);
  const tries = [["PATCH", `/api/estimates/${S.estimateId}`], ["PUT", `/api/estimates/${S.estimateId}`], ["PATCH", `/api/bids/${S.bidId}/estimate`]];
  const out = [];
  for (const [m, u] of tries) { const r = await est.req(m, u, { notes: "Row 12: GC Responsible for layout of new 162 ea 7x7 spread ftgs by other not TFR" }); out.push(`${m} ${u} -> ${r.status} ${String(r.headers.get("content-type")).split(";")[0]}`); }
  ctx.notes.push(...out, "grep: no PATCH/PUT /api/estimates/:id route exists in server/*.ts; estimates.notes only written at creation or by AI paths (aiEstimatorRoutes.ts:855, estimateRoutes.ts:3348 approve)");
  const pdf = fs.readFileSync(`${OUT}/EST-PROP-001-proposal.pdf.txt`, "utf8");
  expect(/layout/i.test(pdf), "No estimate-notes write path found (" + out.join("; ") + "); proposal PDF lacks the row-12 exclusion");
});
