// SmartManage AI QA harness — minimal API client + result recorder.
// No secrets are written to evidence: cookies/tokens/passwords are redacted.
import fs from "node:fs";
import path from "node:path";

export const BASE = process.env.SMA_QA_BASE_URL || "http://localhost:5000";
export const RUN_ID = process.env.SMA_QA_RUN_ID;
if (!RUN_ID) throw new Error("SMA_QA_RUN_ID is required");
export const RUN_DIR = path.resolve(process.cwd(), "qa/runs", RUN_ID);
const EVID = path.join(RUN_DIR, "evidence", "api");
fs.mkdirSync(EVID, { recursive: true });
const RESULTS = path.join(RUN_DIR, "results.jsonl");

const REDACT = /(password|token|secret|cookie|authorization|auth_token|csrf)/i;
export function redact(v) {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = REDACT.test(k) ? "[REDACTED]" : redact(x);
    return o;
  }
  return v;
}

export class Client {
  constructor(label) { this.label = label; this.jar = {}; this.log = []; }
  cookieHeader() { return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join("; "); }
  absorb(res) {
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of sc) { const [kv] = c.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v === "" ) delete this.jar[k]; else this.jar[k] = v; }
  }
  async req(method, url, body, { raw = false, headers = {} } = {}) {
    if (!this.jar.csrf_token && method !== "GET") await this.req("GET", "/api/auth/me");
    const h = { ...headers, cookie: this.cookieHeader() };
    if (this.jar.csrf_token) h["x-csrf-token"] = this.jar.csrf_token;
    let payload = body;
    if (body !== undefined && !(body instanceof FormData) && typeof body !== "string") { h["content-type"] = "application/json"; payload = JSON.stringify(body); }
    const t0 = performance.now();
    const res = await fetch(BASE + url, { method, headers: h, body: payload, redirect: "manual" });
    const ms = performance.now() - t0;
    this.absorb(res);
    let data; const ct = res.headers.get("content-type") || "";
    if (raw) data = Buffer.from(await res.arrayBuffer());
    else if (ct.includes("json")) data = await res.json().catch(() => null);
    else data = await res.text();
    const entry = { at: new Date().toISOString(), actor: this.label, method, url, status: res.status, ms: Math.round(ms), reqBody: body instanceof FormData ? "[multipart]" : redact(body), resBody: raw ? `[binary ${data.length} bytes ${ct}]` : redact(typeof data === "string" ? data.slice(0, 2000) : data), requestId: res.headers.get("x-request-id") };
    this.log.push(entry);
    return { status: res.status, data, ms, headers: res.headers, entry };
  }
  get(u, o) { return this.req("GET", u, undefined, o); }
  post(u, b, o) { return this.req("POST", u, b, o); }
  patch(u, b, o) { return this.req("PATCH", u, b, o); }
  put(u, b, o) { return this.req("PUT", u, b, o); }
  del(u, o) { return this.req("DELETE", u, undefined, o); }
  async login(email, password) {
    const r = await this.post("/api/auth/login", { email, password });
    if (r.status !== 200) throw new Error(`login ${email} -> ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    await this.get("/api/auth/me");
    return r;
  }
}

let current = null;
export function evidenceFile(name) { return path.join(EVID, name); }
export async function test(meta, fn) {
  // meta: {id, module, role, tenant, req, mode, expected}
  const started = new Date().toISOString();
  const ctx = { notes: [], clients: [], actual: "", evidence: [] };
  let status = "PASS", error = null;
  try {
    const r = await fn(ctx);
    if (r && r.status) status = r.status;
    if (r && r.actual) ctx.actual = r.actual;
  } catch (e) {
    status = e.qaStatus || "FAIL"; error = String(e.message || e).slice(0, 1500);
  }
  const evName = `${meta.id}.json`;
  const calls = ctx.clients.flatMap((c) => c.log.splice(0));
  fs.writeFileSync(path.join(EVID, evName), JSON.stringify({ meta, calls, notes: ctx.notes }, null, 1));
  const rec = { ...meta, status, started, finished: new Date().toISOString(), actual: ctx.actual || error || "", notes: ctx.notes, evidence: [`evidence/api/${evName}`, ...ctx.evidence], mode: meta.mode || "API integration", env: "local" };
  fs.appendFileSync(RESULTS, JSON.stringify(rec) + "\n");
  console.log(`${status.padEnd(8)} ${meta.id} ${meta.title || ""}${error ? " :: " + error.slice(0, 300) : ""}`);
  return rec;
}
export function expect(cond, msg) { if (!cond) throw new Error(msg); }
export function blocked(msg) { const e = new Error(msg); e.qaStatus = "BLOCKED"; throw e; }
export const money = (x) => Math.round(Number(x) * 100) / 100;
