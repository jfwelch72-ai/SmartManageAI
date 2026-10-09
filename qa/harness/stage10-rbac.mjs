import fs from "node:fs";
import { Client, test, expect, RUN_ID, RUN_DIR, money } from "./lib.mjs";
const PW = process.env.SMA_QA_ADMIN_PASSWORD;
const S = JSON.parse(fs.readFileSync(`${RUN_DIR}/state.json`));
const save = () => fs.writeFileSync(`${RUN_DIR}/state.json`, JSON.stringify(S, null, 1));
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
const t = (m, f) => (ONLY.length && !ONLY.some((o) => m.id.startsWith(o)) ? null : test(m, f));
const ROLES = { SUPER_ADMIN: "superadmin", ADMIN: "admin", HUSTLER: "hustler", MANAGER: "manager", SUPERINTENDENT: "super", ESTIMATOR: "estimator", FIELD_WORKER: "worker", VENDOR: "vendor" };
const C = {}; for (const [r, e] of Object.entries(ROLES)) { C[r] = new Client(`${e}@(${r})`); await C[r].login(`${e}@realtest.com`, PW); }
const sub = new Client("subadmin@(ADMIN, RealTest Subcontractors)"); await sub.login("subadmin@realtest.com", PW);
const anon = new Client("anonymous");
const allowed = (s) => s >= 200 && s < 300; const denied = (s) => s === 401 || s === 403 || s === 404;
const html = (r) => String(r.headers.get("content-type")).includes("text/html");
// Expected authority: docs/rbac-audit.md role definitions (+ ACCOUNT_ROLES_RBAC.md); A=allow D=deny
const FIN = { SUPER_ADMIN: "A", ADMIN: "A", HUSTLER: "?", MANAGER: "A", SUPERINTENDENT: "A", ESTIMATOR: "A", FIELD_WORKER: "D", VENDOR: "D" };
const MATRIX = [
  ["Read project", "GET", () => `/api/projects/${S.projectCode}`, { SUPER_ADMIN: "A", ADMIN: "A", HUSTLER: "?", MANAGER: "A", SUPERINTENDENT: "A", ESTIMATOR: "A", FIELD_WORKER: "A", VENDOR: "D" }],
  ["Read SOV list (financial)", "GET", () => `/api/sov`, FIN],
  ["Read cost ledger (financial)", "GET", () => `/api/projects/${S.projectCode}/cost-ledger`, FIN],
  ["Read pay app G702 (financial)", "GET", () => `/api/aia-billing/pay-applications/${S.fb.apps[1]}/g702-pdf`, FIN],
  ["Read prime contract list", "GET", () => `/api/contracts?projectId=${S.projectId}`, { SUPER_ADMIN: "A", ADMIN: "A", HUSTLER: "?", MANAGER: "A", SUPERINTENDENT: "?", ESTIMATOR: "?", FIELD_WORKER: "D", VENDOR: "D" }],
  ["Read estimate/bid", "GET", () => `/api/bids/${S.bidId}/estimate`, { SUPER_ADMIN: "A", ADMIN: "A", HUSTLER: "?", MANAGER: "A", SUPERINTENDENT: "?", ESTIMATOR: "A", FIELD_WORKER: "D", VENDOR: "D" }],
  ["Export proposal PDF", "GET", () => `/api/estimates/${S.estimateId}/export/proposal-pdf`, { SUPER_ADMIN: "A", ADMIN: "A", HUSTLER: "?", MANAGER: "A", SUPERINTENDENT: "?", ESTIMATOR: "A", FIELD_WORKER: "D", VENDOR: "D" }],
  ["List org users", "GET", () => `/api/users`, { SUPER_ADMIN: "A", ADMIN: "A", HUSTLER: "?", MANAGER: "?", SUPERINTENDENT: "?", ESTIMATOR: "?", FIELD_WORKER: "D", VENDOR: "D" }],
  ["Platform org list", "GET", () => `/api/platform/organizations`, { SUPER_ADMIN: "A", ADMIN: "D", HUSTLER: "D", MANAGER: "D", SUPERINTENDENT: "D", ESTIMATOR: "D", FIELD_WORKER: "D", VENDOR: "D" }],
  ["Create change order", "POST", () => `/api/change-orders`, { SUPER_ADMIN: "?", ADMIN: "A", HUSTLER: "?", MANAGER: "A", SUPERINTENDENT: "A", ESTIMATOR: "D", FIELD_WORKER: "D", VENDOR: "D" }, () => ({ projectId: S.otherProjectId, title: "RBAC probe", description: `${RUN_ID} RBAC probe`, amount: "1" })],
  ["Create pay application", "POST", () => `/api/aia-billing/pay-applications`, { SUPER_ADMIN: "A", ADMIN: "A", HUSTLER: "?", MANAGER: "A", SUPERINTENDENT: "D", ESTIMATOR: "D", FIELD_WORKER: "D", VENDOR: "D" }, () => ({ projectId: "00000000-0000-0000-0000-000000000000", sovId: "00000000-0000-0000-0000-000000000000" }), true],
  ["Create user", "POST", () => `/api/users`, { SUPER_ADMIN: "A", ADMIN: "A", HUSTLER: "?", MANAGER: "D", SUPERINTENDENT: "D", ESTIMATOR: "D", FIELD_WORKER: "D", VENDOR: "D" }, () => ({ firstName: "x", lastName: "y", email: "not-an-email", role: "FIELD_WORKER", password: "x" }), true],
  ["Create equipment", "POST", () => `/api/equipment`, { SUPER_ADMIN: "?", ADMIN: "A", HUSTLER: "?", MANAGER: "A", SUPERINTENDENT: "A", ESTIMATOR: "?", FIELD_WORKER: "D", VENDOR: "D" }, () => ({ name: "", equipmentCode: "", type: "X" }), true],
];
// validationOnly=true: bodies are deliberately invalid; an authorized role should get 400 (passed authz), unauthorized 401/403.
S.rbac = [];
for (const [label, method, url, exp, body, validationOnly] of MATRIX) {
  await t({ id: `RBAC-${label.replace(/[^A-Za-z]+/g, "-").replace(/-$/, "").toUpperCase()}`, title: `Role matrix: ${label}`, module: "Authorization", role: "all 8 roles + anonymous", tenant: "RealTest Construction", req: "docs/rbac-audit.md §1 role definitions; route guards", expected: Object.entries(exp).map(([r, e]) => `${r}:${e}`).join(" ") + " anon:D" }, async (ctx) => {
    const row = {}; const probs = [];
    for (const r of [...Object.keys(ROLES), "ANON"]) {
      const c = r === "ANON" ? anon : C[r]; ctx.clients.push(c);
      const res = await c.req(method, url(), body ? body() : undefined, { raw: method === "GET" });
      const s = res.status; const isHtml = html(res);
      const authzPass = validationOnly ? s !== 401 && s !== 403 : allowed(s) && !isHtml;
      row[r] = `${s}${isHtml ? "h" : ""}`;
      const e = r === "ANON" ? "D" : exp[r];
      if (e === "A" && !authzPass) probs.push(`${r} expected allow got ${s}`);
      if (e === "D" && (validationOnly ? !(s === 401 || s === 403) : !(denied(s) || isHtml))) probs.push(`${r} expected deny got ${s}`);
      if (allowed(s) && method === "POST" && !validationOnly) { /* created probe records are QA-owned */ }
    }
    S.rbac.push({ label, row }); save();
    ctx.notes.push(JSON.stringify(row));
    expect(!probs.length, probs.join("; ") + " | " + JSON.stringify(row));
    return { actual: JSON.stringify(row) };
  });
}

await t({ id: "TEN-001", title: "Cross-tenant reads by another org's ADMIN using primary project IDs", module: "Tenant isolation", role: "ADMIN (RealTest Subcontractors)", tenant: "RealTest Subcontractors -> RealTest Construction", req: "docs/architecture/tenant-isolation.md; STRICT_TENANT_RLS=true", expected: "Every request denied (401/403/404) or empty; no foreign data in body" }, async (ctx) => {
  ctx.clients.push(sub);
  const urls = [`/api/projects/${S.projectCode}`, `/api/bids/${S.bidCode}`, `/api/bids/${S.bidId}/estimate`, `/api/estimates/${S.estimateId}/export/proposal-pdf`, `/api/projects/${S.projectCode}/cost-ledger`, `/api/projects/${S.projectCode}/budget-lines`, `/api/projects/${S.projectCode}/scope`, `/api/contracts?projectId=${S.projectId}`, `/api/aia-billing/pay-applications/${S.fb.apps[1]}`, `/api/aia-billing/pay-applications/${S.fb.apps[1]}/g702-pdf`, `/api/rfi/${S.rfiId}`, `/api/change-orders/${S.cos.co1}`, `/api/projects/${S.projectCode}/schedule`, `/api/subcontracts/${S.subcontractId}`, `/api/procurement-module/orders/${S.poId}`, `/api/equipment/${S.equipId}`, `/api/crm/organisations/${S.crmOrgId}`, `/api/crm/opportunities/${S.oppId}`];
  const leaks = []; const rows = [];
  for (const u of urls) { const r = await sub.get(u, { raw: true }); const b = r.data.toString(); const leak = r.status < 300 && !html(r) && (b.includes(S.projectId) || b.includes(RUN_ID) || b.includes(S.bidId) || b.startsWith("%PDF")); rows.push(`${r.status}${html(r) ? "h" : ""} ${u}`); if (leak) leaks.push(`${u} -> ${r.status} (${b.length}B)`); }
  const lists = []; for (const u of ["/api/sov", "/api/aia-billing/pay-applications", "/api/projects?limit=200", "/api/change-orders", "/api/bids"]) { const r = await sub.get(u, { raw: true }); const b = r.data.toString(); if (b.includes(RUN_ID) || b.includes(S.projectId)) leaks.push(`list ${u} contains primary-tenant data`); lists.push(`${r.status} ${u} ${b.length}B`); }
  ctx.notes.push(...rows, ...lists);
  expect(!leaks.length, "CROSS-TENANT EXPOSURE: " + leaks.join("; "));
  return { actual: `${urls.length} object reads + ${lists.length} lists: no foreign data returned` };
});

await t({ id: "TEN-002", title: "Cross-tenant writes by another org's ADMIN", module: "Tenant isolation", role: "ADMIN (RealTest Subcontractors)", tenant: "RealTest Subcontractors -> RealTest Construction", req: "tenant isolation", expected: "All denied; target records unchanged" }, async (ctx) => {
  ctx.clients.push(sub, C.MANAGER);
  const before = (await C.MANAGER.get(`/api/projects/${S.gateProbe}`)).data;
  const w = [];
  w.push(["PATCH project", await sub.patch(`/api/projects/${S.gateProbe}`, { description: "TENANT ATTACK" })]);
  w.push(["POST CO on foreign project", await sub.post("/api/change-orders", { projectId: S.otherProjectId, title: "x", description: "TENANT ATTACK", amount: "1" })]);
  w.push(["approve foreign CO", await sub.post(`/api/change-orders/${S.cos.co2}/approve`, {})]);
  w.push(["foreign pay app status", await sub.patch(`/api/aia-billing/pay-applications/${S.fb.apps[3]}/status`, { status: "DRAFT" })]);
  w.push(["convert foreign bid", await sub.post(`/api/bids/${S.sodBid}/convert`, {})]);
  w.push(["foreign estimate bulk lines", await sub.post(`/api/estimates/${S.estimateId}/line-items/bulk`, { lineItems: [{ category: "GENERAL", description: "TENANT ATTACK", quantity: "1", unit: "EA", materialCost: "1", laborCost: "0", laborHours: "0", equipmentCost: "0", equipmentHours: "0", consumablesCost: "0", subcontractCost: "0", overheadAllocation: "0", profitAllocation: "0" }] })]);
  w.push(["foreign scope progress", await sub.post(`/api/scope-items/${S.scope["29"].id}/progress`, { workDate: "2026-07-01", quantityCompleted: "1" })]);
  w.push(["clock in to foreign project", await sub.post("/api/time-clock/clock-in", { projectId: S.otherProjectId })]);
  await sub.post("/api/time-clock/clock-out", {});
  const after = (await C.MANAGER.get(`/api/projects/${S.gateProbe}`)).data;
  const rows = w.map(([k, r]) => `${k}: ${r.status}${html(r) ? "h" : ""} ${JSON.stringify(r.data).slice(0, 100)}`); ctx.notes.push(...rows);
  const bad = w.filter(([, r]) => r.status < 300 && !html(r)).map(([k, r]) => `${k} -> ${r.status}`);
  if (after.description !== before.description) bad.push("project description changed");
  expect(!bad.length, "CROSS-TENANT WRITE: " + bad.join("; "));
});

await t({ id: "AUTH-001", title: "Anonymous access to dev login endpoint (NODE_ENV=development)", module: "Authentication", role: "anonymous", tenant: "n/a", req: "authProfileRoutes.ts:813; utils/devSeedFlag.ts:4 (checks NODE_ENV only; ENABLE_DEV_SEED unused)", expected: "Disabled unless explicitly enabled by ENABLE_DEV_SEED (set false in this run)" }, async (ctx) => {
  const a = new Client("anonymous"); ctx.clients.push(a);
  const r = await a.post("/api/dev/test-login", { role: "SUPER_ADMIN" });
  const me = await a.get("/api/auth/me");
  ctx.notes.push(`test-login ${r.status}; /me as ${me.data?.user?.role} ${me.data?.user?.email}`);
  expect(!(r.status < 300 && me.data?.user?.role === "SUPER_ADMIN"), `Anonymous caller obtained a SUPER_ADMIN session via POST /api/dev/test-login (${r.status}) with ENABLE_DEV_SEED=false; gate depends only on NODE_ENV=development. Hosted dev NODE_ENV UNVERIFIED.`);
});

await t({ id: "AUTH-002", title: "Logout invalidates the session token", module: "Authentication", role: "ESTIMATOR", tenant: "RealTest Construction", req: "authProfileRoutes.ts:716; RUNBOOK_TOKEN_REVOCATION.md", expected: "Re-presenting the pre-logout auth cookie returns 401" }, async (ctx) => {
  const c = new Client("estimator(session)"); ctx.clients.push(c); await c.login("estimator@realtest.com", PW);
  const saved = c.jar.auth_token; const lo = await c.post("/api/auth/logout", {});
  const r = new Client("replay-old-cookie"); ctx.clients.push(r); r.jar.auth_token = saved;
  const me = await r.get("/api/auth/me");
  ctx.notes.push(`logout ${lo.status}; replayed cookie /me -> ${me.status}`);
  expect(me.status === 401, `pre-logout token still valid after logout (/api/auth/me ${me.status})`);
});

await t({ id: "AUTH-003", title: "Disabled user and role change take effect on existing sessions", module: "Authentication/Users", role: "ADMIN + new MANAGER", tenant: "RealTest Construction", req: "auth.ts tokenVersion check; dashboardRoutes.ts:2941,3007", expected: "Downgrade MANAGER->FIELD_WORKER blocks manager action on next request; deactivation -> 401 and login refused" }, async (ctx) => {
  ctx.clients.push(C.ADMIN);
  const email = `qa-${RUN_ID.toLowerCase()}-pm@example.test`;
  const pw = `Qa!${Math.random().toString(36).slice(2, 10)}A1`;
  const u = await C.ADMIN.post("/api/users", { firstName: "QA", lastName: "Temp PM (SYNTHETIC)", email, role: "MANAGER", password: pw });
  expect(u.status < 300, `create user ${u.status} ${JSON.stringify(u.data).slice(0, 200)}`); const uid = u.data.id ?? u.data.user?.id; S.tempUserId = uid; save();
  const c = new Client("temp-pm"); ctx.clients.push(c); await c.login(email, pw);
  const before = await c.get("/api/sov");
  await C.ADMIN.patch(`/api/users/${uid}`, { role: "FIELD_WORKER" }); await new Promise((r) => setTimeout(r, 6000));
  const after = await c.get("/api/sov");
  const de = await C.ADMIN.patch(`/api/users/${uid}`, { isActive: false }); await new Promise((r) => setTimeout(r, 6000));
  const me = await c.get("/api/auth/me");
  const relog = await new Client("temp-pm-relogin").post("/api/auth/login", { email, password: pw });
  ctx.notes.push(`SOV as MANAGER ${before.status}; after downgrade ${after.status}; deactivate ${de.status}; existing session /me ${me.status}; fresh login ${relog.status}`);
  expect(before.status === 200 && after.status === 403 && me.status === 401 && relog.status >= 400, ctx.notes.at(-1));
});

await t({ id: "AUTH-004", title: "Password reset via captured test sink", module: "Authentication", role: "FIELD_WORKER (equipment@)", tenant: "RealTest Construction", mode: "API integration (EMAIL_TRANSPORT=noop outbox)", req: "workforceRoutes.ts:1010-1150", expected: "Reset email captured; token works once; old password rejected; new password works; token reuse rejected" }, async (ctx) => {
  const a = new Client("anon-reset"); ctx.clients.push(a);
  const email = "dispatcher@realtest.com";
  await a.del("/api/dev/email-outbox");
  const f = await a.post("/api/auth/forgot-password", { email });
  const ob = await a.get("/api/dev/email-outbox"); const msgs = Array.isArray(ob.data) ? ob.data : ob.data?.outbox ?? ob.data?.messages ?? [];
  const body = JSON.stringify(msgs); const tok = (body.match(/token=([A-Za-z0-9_\-\.]+)/) || [])[1];
  ctx.notes.push(`forgot ${f.status}; outbox ${ob.status} ${msgs.length} msgs; token ${tok ? "found" : "missing"}`);
  expect(tok, "reset token not captured: " + body.slice(0, 200));
  const np = `QaReset!${Date.now() % 1e6}Aa`;
  const r1 = await a.post("/api/auth/reset-password", { token: tok, password: np });
  const r2 = await a.post("/api/auth/reset-password", { token: tok, password: np + "x" });
  const old = await new Client("x").post("/api/auth/login", { email, password: PW });
  const neu = await new Client("y").post("/api/auth/login", { email, password: np });
  S.dispatcherPasswordChanged = true; save();
  ctx.notes.push(`reset ${r1.status}; reuse ${r2.status}; old pw login ${old.status}; new pw login ${neu.status}. NOTE: dispatcher@realtest.com password changed by this test (local only).`);
  expect(r1.status === 200 && r2.status >= 400 && old.status === 401 && neu.status === 200, ctx.notes.at(-1));
});

await t({ id: "SA-001", title: "Super Admin: create test tenant, list orgs, audit log records privileged action; impersonation audited", module: "Super Admin/Platform", role: "SUPER_ADMIN", tenant: "platform", req: "platformRoutes.ts:159,288,1107; auditLogger", expected: "Org created; appears in list; audit entry for create; impersonation (if available) logged" }, async (ctx) => {
  const sa = C.SUPER_ADMIN; ctx.clients.push(sa);
  const o = await sa.post("/api/platform/organizations", { name: `${RUN_ID} QA Tenant B (TEST)`, email: "qa-tenant-b@example.test", subscriptionTier: "starter", plan: "starter" });
  ctx.notes.push(`create org ${o.status} ${JSON.stringify(o.data).slice(0, 200)}`);
  const l = await sa.get("/api/platform/organizations"); const ls = JSON.stringify(l.data);
  const larr = Array.isArray(l.data) ? l.data : l.data.organizations ?? l.data.data ?? [];
  const orgId = o.data?.id ?? larr.find((x) => x.name?.startsWith(`${RUN_ID} QA Tenant B`))?.id; S.tenantB = orgId; save();
  const al2 = await sa.get("/api/audit-logs?limit=100");
  const als = JSON.stringify(al2.data);
  ctx.notes.push(`list ${l.status} contains: ${ls.includes(RUN_ID)}; audit ${al2.status} mentions org: ${orgId ? als.includes(orgId) : "n/a"}`);
  expect((o.status < 300 || o.status === 409) && ls.includes(RUN_ID), ctx.notes.join(" | "));
  expect(orgId && als.includes(orgId), `audit log does not show tenant creation (audit endpoint ${al2.status}; ${als.length}B)`);
});

await t({ id: "SA-002", title: "Super Admin impersonation is restricted to SUPER_ADMIN and audited", module: "Super Admin/Support", role: "SUPER_ADMIN + ADMIN", tenant: "platform", req: "platformRoutes.ts:1107-1150", expected: "ADMIN 403; SUPER_ADMIN 200 with short-lived code; audit_log entry created" }, async (ctx) => {
  ctx.clients.push(C.ADMIN, C.SUPER_ADMIN);
  const target = (await C.FIELD_WORKER.get("/api/auth/me")).data.user.id;
  const a = await C.ADMIN.post(`/api/platform/users/${target}/impersonate`, {});
  const s = await C.SUPER_ADMIN.post(`/api/platform/users/${target}/impersonate`, {});
  const al = await C.SUPER_ADMIN.get("/api/audit-logs?limit=100"); const has = JSON.stringify(al.data).includes(target);
  ctx.notes.push(`ADMIN ${a.status}; SUPER_ADMIN ${s.status} keys=${Object.keys(s.data || {})}; audit mentions target: ${has}`);
  expect(a.status === 403 && s.status < 300 && has, ctx.notes.at(-1));
});
