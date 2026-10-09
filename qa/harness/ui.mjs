// Browser E2E (Chromium only; Firefox/WebKit binaries unavailable in this environment).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { test, expect, RUN_ID, RUN_DIR } from "./lib.mjs";
const PW = process.env.SMA_QA_ADMIN_PASSWORD; const BASE = process.env.SMA_QA_BASE_URL || "http://localhost:5000";
const S = JSON.parse(fs.readFileSync(`${RUN_DIR}/state.json`));
const AXE = fs.readFileSync(process.env.AXE_PATH, "utf8");
const SHOTS = `${RUN_DIR}/evidence/screenshots`; fs.mkdirSync(SHOTS, { recursive: true });
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
const t = (m, f) => (ONLY.length && !ONLY.some((o) => m.id.startsWith(o)) ? null : test({ tenant: "RealTest Construction", mode: "browser E2E (Chromium 141 headless)", ...m }, f));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, tablet: { width: 768, height: 1024 }, phone390: { width: 390, height: 844, isMobile: true, hasTouch: true }, phone360: { width: 360, height: 800, isMobile: true, hasTouch: true } };
async function session(email, vp = "desktop", extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: VIEWPORTS[vp].width, height: VIEWPORTS[vp].height }, isMobile: !!VIEWPORTS[vp].isMobile, hasTouch: !!VIEWPORTS[vp].hasTouch, ...extra });
  const page = await ctx.newPage(); const errors = []; const bad = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 300)));
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 500) bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`); });
  await page.goto(`${BASE}/login`); await page.getByTestId("input-email").fill(email); await page.getByTestId("input-password").fill(PW);
  await page.getByTestId("button-login").click(); await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  return { ctx, page, errors, bad };
}
async function audit(page, name) {
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const f = `${SHOTS}/${name}.png`; await page.screenshot({ path: f, fullPage: false });
  const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  await page.addScriptTag({ content: AXE });
  const ax = await page.evaluate(async () => { const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } }); return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })); });
  const text = (await page.locator("body").innerText()).slice(0, 4000);
  return { shot: path.relative(RUN_DIR, f), overflow: ov.sw > ov.iw + 1 ? `${ov.sw}>${ov.iw}` : null, axe: ax, text };
}
const PAGES = (S) => [
  ["dashboard", "/"], ["projects", "/projects"], ["project-detail", `/projects/${S.projectCode}`], ["project-schedule", `/projects/${S.projectCode}?tab=schedule`],
  ["project-financials", `/projects/${S.projectCode}?tab=project-financials`], ["bid-estimate", `/bids/${S.bidCode}/estimate`], ["progress-billing", "/progress-billing"],
  ["time-clock", "/time-clock"], ["equipment", "/equipment"], ["crm", "/crm"], ["dispatch-board", "/dispatch-board"],
];
const A11Y_F = `${RUN_DIR}/evidence/a11y-axe-summary.json`; const UI = { pages: {}, a11y: fs.existsSync(A11Y_F) ? JSON.parse(fs.readFileSync(A11Y_F)) : {} };
for (const vp of Object.keys(VIEWPORTS)) {
  await t({ id: `UI-SCREENS-${vp.toUpperCase()}`, title: `Key screens render as MANAGER at ${vp} ${VIEWPORTS[vp].width}x${VIEWPORTS[vp].height}`, module: "UI", role: "MANAGER", req: "Prompt §7", expected: "No 5xx API calls, no uncaught page errors, no horizontal overflow; screenshots captured; axe WCAG2 A/AA violations reported" }, async (ctx) => {
    const s = await session("manager@realtest.com", vp);
    const rows = []; const probs = [];
    for (const [name, url] of PAGES(S)) {
      s.errors.length = 0; s.bad.length = 0;
      await s.page.goto(BASE + url); const a = await audit(s.page, `${vp}-${name}`); ctx.evidence.push(a.shot);
      const crit = a.axe.filter((v) => v.impact === "critical" || v.impact === "serious");
      rows.push(`${name}: overflow=${a.overflow || "no"} 5xx=${s.bad.length} pageErrors=${s.errors.filter((e) => e.startsWith("pageerror")).length} axe(serious+)=${crit.map((v) => `${v.id}x${v.nodes}`).join(",") || "0"}`);
      if (a.overflow) probs.push(`${name} horizontal overflow ${a.overflow}`);
      if (s.bad.length) probs.push(`${name} 5xx: ${s.bad.join(" ")}`);
      const pe = s.errors.filter((e) => e.startsWith("pageerror")); if (pe.length) probs.push(`${name} page error: ${pe[0]}`);
      UI.a11y[`${vp}:${name}`] = a.axe;
      if (name === "bid-estimate" && vp === "desktop") { UI.bidEstimateText = a.text; }
    }
    ctx.notes.push(...rows); await s.ctx.close(); fs.writeFileSync(A11Y_F, JSON.stringify(UI.a11y, null, 1));
    expect(!probs.length, probs.join(" | "));
  });
}
await t({ id: "UI-EST-TOTAL-001", title: "Bid estimate screen total shown to the estimator", module: "UI/Estimating", role: "MANAGER", req: "EST-CALC-001; OrgMarkupBreakdownCard.tsx:215", expected: "Displayed estimate total = $782,052.11 (priced lines incl. profit allocation)" }, async (ctx) => {
  const s = await session("estimator@realtest.com", "desktop"); await s.page.goto(`${BASE}/bids/${S.bidCode}/estimate`); const a = await audit(s.page, "desktop-bid-estimate-estimator"); ctx.evidence.push(a.shot);
  const money = [...new Set(a.text.match(/\$[0-9]{1,3}(,[0-9]{3})+(\.[0-9]{2})?/g) || [])];
  ctx.notes.push(`money values on screen: ${money.slice(0, 30).join(" ")}`); await s.ctx.close();
  expect(money.includes("$782,052.11") && !money.includes("$623,942.68"), `screen shows ${money.filter((m) => /782|623|764/.test(m)).join(", ") || "neither total"}`);
});
await t({ id: "UI-IMP-001", title: "Upload original 00420 workbook through Bid Tab Import dialog (real UI)", module: "UI/Estimating/Import", role: "ADMIN (ESTIMATOR cannot read feature flags — SMA-FLAG-001)", req: "Prompt §5 'upload workbook through actual UI'", expected: "Preview lists the 29 priced work items with costs; header/total rows excluded" }, async (ctx) => {
  const s = await session("admin@realtest.com", "desktop");
  const b = await s.page.request.post(`${BASE}/api/bids`, { data: { name: `${RUN_ID} UI import bid`, clientName: `${RUN_ID} Fictional Owner (TEST)` }, headers: { "x-csrf-token": (await s.ctx.cookies()).find((c) => c.name === "csrf_token")?.value || "" } });
  const bid = await b.json(); S.uiImportBid = bid.code;
  await s.page.request.post(`${BASE}/api/bids/${bid.id}/estimate`, { data: {}, headers: { "x-csrf-token": (await s.ctx.cookies()).find((c) => c.name === "csrf_token")?.value || "" } }); fs.writeFileSync(`${RUN_DIR}/state.json`, JSON.stringify(S, null, 1));
  await s.page.goto(`${BASE}/bids/${bid.code}/estimate`); await s.page.waitForLoadState("networkidle").catch(() => {});
  await s.page.getByTestId("button-open-bid-tab-import").click();
  await s.page.getByTestId("input-bid-tab-file").setInputFiles(path.join(RUN_DIR, "fixtures/source/00420_Crane_Logistics_2nd_take_off_with_changes_(2).xlsx"));
  await s.page.waitForTimeout(4000);
  const total = await s.page.getByTestId("badge-rows-total").innerText().catch(() => "n/a"); const importable = await s.page.getByTestId("badge-rows-importable").innerText().catch(() => "n/a");
  const dlgText = (await s.page.getByTestId("dialog-bid-tab-import").innerText()).slice(0, 3000);
  const f = `${SHOTS}/UI-IMP-001-preview.png`; await s.page.screenshot({ path: f, fullPage: true }); ctx.evidence.push(path.relative(RUN_DIR, f));
  ctx.notes.push(`badges: total="${total}" importable="${importable}"`, `has Grand Total row: ${/Grand Total/.test(dlgText)}; shows any $: ${/\$\d/.test(dlgText)}`);
  await s.ctx.close();
  expect(/\b29\b/.test(importable) && !/Grand Total/.test(dlgText), `preview total "${total}", importable "${importable}"; Grand Total row listed: ${/Grand Total/.test(dlgText)}; no cost columns in preview`);
});
await t({ id: "UI-TIME-001", title: "Field worker clocks in/out on phone (390x844) with simulated geolocation", module: "UI/Time Clock", role: "FIELD_WORKER", mode: "browser E2E (emulated mobile, simulated GPS; not physical device)", req: "Prompt §5 Field time", expected: "Clock-in and clock-out controls reachable and work; shift recorded" }, async (ctx) => {
  const s = await session("worker@realtest.com", "phone390", { geolocation: { latitude: 36.434, longitude: -81.499, accuracy: 8 }, permissions: ["geolocation"] });
  await s.page.goto(`${BASE}/time-clock`); await s.page.waitForLoadState("networkidle").catch(() => {});
  const ids = await s.page.$$eval("[data-testid]", (els) => els.map((e) => e.getAttribute("data-testid")).filter((x) => /clock|project/i.test(x)).slice(0, 30));
  ctx.notes.push(`time-clock testids: ${ids.join(",")}`);
  await s.page.getByTestId("select-project").click(); await s.page.waitForTimeout(500);
  const opt = s.page.getByRole("option").filter({ hasText: "Second site project" }).first();
  if (await opt.isVisible().catch(() => false)) await opt.click(); else ctx.notes.push("project option not found: " + (await s.page.getByRole("option").allInnerTexts()).slice(0, 10).join(" | "));
  await s.page.waitForTimeout(1500);
  const inBtn = s.page.getByTestId("button-clock-in");
  const vis = await inBtn.isVisible().catch(() => false);
  let res = "no clock-in control found";
  if (vis) {
    const box = await inBtn.boundingBox(); ctx.notes.push(`clock-in button ${Math.round(box.width)}x${Math.round(box.height)}px`);
    const respIn = s.page.waitForResponse((r) => r.url().includes("/api/time-clock/clock-in"), { timeout: 15000 }).catch(() => null);
    await inBtn.click(); await s.page.waitForTimeout(500);
    const confirm = s.page.locator('[role="dialog"] button:has-text("Clock In"), [data-testid*="confirm-clock-in"]').first(); if (await confirm.isVisible().catch(() => false)) await confirm.click();
    const rIn = await respIn; res = `clock-in API ${rIn ? rIn.status() : "not called"}`;
    await s.page.waitForTimeout(1500); await s.page.screenshot({ path: `${SHOTS}/UI-TIME-001-clocked-in.png` }); ctx.evidence.push("evidence/screenshots/UI-TIME-001-clocked-in.png");
    const outBtn = s.page.getByTestId("button-clock-out");
    if (await outBtn.isVisible().catch(() => false)) { const respOut = s.page.waitForResponse((r) => r.url().includes("/api/time-clock/clock-out"), { timeout: 15000 }).catch(() => null); await outBtn.click(); await s.page.waitForTimeout(500); const c2 = s.page.locator('[role="dialog"] button:has-text("Clock Out")').first(); if (await c2.isVisible().catch(() => false)) await c2.click(); const ro = await respOut; res += `; clock-out API ${ro ? ro.status() : "not called"}`; }
  }
  ctx.notes.push(res); await s.ctx.close();
  expect(/clock-in API 20\d/.test(res) && /clock-out API 200/.test(res), res);
});
await t({ id: "UI-ROLE-001", title: "Field worker direct-URL navigation to financial screens", module: "UI/Authorization", role: "FIELD_WORKER", req: "docs/rbac-audit.md FIELD_WORKER: time clock, daily notes, active projects only", expected: "Financial pages show access-denied/redirect and no financial figures" }, async (ctx) => {
  const s = await session("worker@realtest.com", "desktop"); const rows = []; const leaks = [];
  for (const [name, url] of [["progress-billing", "/progress-billing"], ["bid-estimate", `/bids/${S.bidCode}/estimate`], ["project-financials", `/projects/${S.projectCode}?tab=project-financials`], ["admin", "/admin"]]) {
    await s.page.goto(BASE + url); const a = await audit(s.page, `worker-direct-${name}`); ctx.evidence.push(a.shot);
    const dollars = (a.text.match(/\$[0-9]{1,3}(,[0-9]{3})+/g) || []); rows.push(`${name}: url=${new URL(s.page.url()).pathname} $values=${dollars.length}`); if (dollars.length) leaks.push(`${name}: ${dollars.slice(0, 4).join(" ")}`);
  }
  ctx.notes.push(...rows); await s.ctx.close();
  expect(!leaks.length, "financial figures visible to FIELD_WORKER: " + leaks.join(" | "));
});
fs.writeFileSync(A11Y_F, JSON.stringify(UI.a11y, null, 1));
await browser.close();
