import { Link } from "wouter";
import { useEffect, useState } from "react";
import { Shield, Lock, Database, Cloud, AlertTriangle, FileText, CheckCircle2, ExternalLink, Mail, Clock, AlertCircle, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

function PageShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  useEffect(() => {
    document.title = `${title} | SmartManageAI`;
    const meta = document.querySelector('meta[name="description"]') || (() => {
      const m = document.createElement("meta");
      m.setAttribute("name", "description");
      document.head.appendChild(m);
      return m;
    })();
    meta.setAttribute("content", description);
  }, [title, description]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <Link href="/" className="font-semibold text-lg" data-testid="link-trust-home">
            SmartManageAI
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/trust" className="hover:underline" data-testid="link-trust-trust">Trust</Link>
            <Link href="/sub-processors" className="hover:underline" data-testid="link-trust-subprocessors">Sub-processors</Link>
            <Link href="/status" className="hover:underline" data-testid="link-trust-status">Status</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
      <footer className="border-t border-border mt-16">
        <div className="mx-auto max-w-5xl px-6 py-6 text-sm text-muted-foreground flex flex-wrap items-center justify-between gap-3">
          <span>© {new Date().getFullYear()} SmartManageAI, Inc.</span>
          <span className="flex items-center gap-3">
            <a href="mailto:security@smartmanage.ai" className="hover:underline" data-testid="link-trust-security-email">security@smartmanage.ai</a>
            <a href="mailto:privacy@smartmanage.ai" className="hover:underline" data-testid="link-trust-privacy-email">privacy@smartmanage.ai</a>
          </span>
        </div>
      </footer>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium bg-muted text-foreground">
      {children}
    </span>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof Shield; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8 rounded-lg border border-border bg-card p-6">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold" data-testid={`heading-${title.toLowerCase().replace(/\s+/g, "-")}`}>{title}</h2>
      </div>
      <div className="text-sm leading-relaxed text-foreground/90 space-y-2">{children}</div>
    </section>
  );
}

export function TrustPage() {
  return (
    <PageShell
      title="Trust & Security"
      description="SmartManageAI security overview, certifications, sub-processors, and how to report a security issue."
    >
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2" data-testid="heading-trust-title">Trust at SmartManageAI</h1>
        <p className="text-muted-foreground" data-testid="text-trust-tagline">
          We are the system of record for construction businesses. We treat your bids, financials, payroll, contracts,
          and field documentation with the seriousness they deserve.
        </p>
        <div className="flex flex-wrap gap-2 mt-4">
          <Pill><CheckCircle2 className="w-3 h-3" /> SOC 2 Type II — in observation</Pill>
          <Pill><Lock className="w-3 h-3" /> TLS 1.2+ / AES-256</Pill>
          <Pill><Shield className="w-3 h-3" /> Passkeys + SAML SSO</Pill>
          <Pill><Database className="w-3 h-3" /> US-hosted</Pill>
        </div>
      </div>

      <Section icon={Shield} title="Authentication & access">
        <ul className="list-disc pl-5 space-y-1">
          <li>WebAuthn passkeys for phishing-resistant login.</li>
          <li>SAML 2.0 single sign-on for enterprise customers, with optional enforcement.</li>
          <li>Multi-factor authentication required for all SmartManageAI staff.</li>
          <li>Role-based access enforced server-side; tenant isolation by organization on every query.</li>
          <li>Per-object access controls for uploaded files (plans, photos, documents).</li>
        </ul>
      </Section>

      <Section icon={Lock} title="Encryption">
        <ul className="list-disc pl-5 space-y-1">
          <li>TLS 1.2 or higher for all client traffic. HSTS enabled.</li>
          <li>AES-256 at rest for the application database and all customer files.</li>
          <li>Passwords hashed with bcrypt. Session tokens are signed and short-lived.</li>
          <li>Secrets stored in a managed vault — never in source code.</li>
        </ul>
      </Section>

      <Section icon={FileText} title="Auditability">
        <ul className="list-disc pl-5 space-y-1">
          <li>Every change that affects customer data or security state is recorded in a tamper-evident audit log.</li>
          <li>Customer admins can search and export their own audit trail.</li>
          <li>Audit log retained for at least one year.</li>
        </ul>
      </Section>

      <Section icon={Cloud} title="Resilience">
        <ul className="list-disc pl-5 space-y-1">
          <li>Postgres point-in-time recovery with a 7-day window.</li>
          <li>Daily off-account logical backups with 30-day object-locked retention.</li>
          <li>Customer file storage cross-region replicated.</li>
          <li>Tier-1 systems target a 4-hour recovery time and 15-minute recovery point.</li>
          <li>Quarterly restore drills. Annual disaster-recovery exercise.</li>
        </ul>
      </Section>

      <Section icon={AlertTriangle} title="Vulnerability & change management">
        <ul className="list-disc pl-5 space-y-1">
          <li>Dependency audit, SAST, secret scan, and IaC scan run on every pull request and block merge on critical findings.</li>
          <li>Branch protection on production code: mandatory peer review and CI checks.</li>
          <li>Annual third-party penetration test; results summarized for customers under NDA.</li>
        </ul>
      </Section>

      <Section icon={Database} title="Privacy & data handling">
        <ul className="list-disc pl-5 space-y-1">
          <li>Hosted in the United States. Standard Contractual Clauses available for EU customers.</li>
          <li>Sub-processors are listed publicly at <Link href="/sub-processors" className="underline" data-testid="link-trust-subprocessor-list">/sub-processors</Link>; 30-day notice on any addition.</li>
          <li>AI features are opt-in at the organization level. Customer data is not used to train models.</li>
          <li>Data subject access and deletion requests fulfilled within 30 days. Account deletion: soft-delete immediately, hard-delete within 30 days.</li>
        </ul>
      </Section>

      <Section icon={FileText} title="Documents available on request">
        <ul className="list-disc pl-5 space-y-1">
          <li>SOC 2 Type I report and bridge letter (under NDA).</li>
          <li>Data Processing Agreement (DPA).</li>
          <li>Standard security questionnaire responses (CAIQ-Lite / SIG-Lite).</li>
          <li>Penetration test summary (under NDA).</li>
        </ul>
        <p className="mt-3">
          Email <a href="mailto:security@smartmanage.ai" className="underline" data-testid="link-trust-request-docs">security@smartmanage.ai</a> to request any of these.
        </p>
      </Section>

      <Section icon={Mail} title="Reporting a security issue">
        <p>
          We welcome reports from security researchers. Email{" "}
          <a href="mailto:security@smartmanage.ai" className="underline" data-testid="link-trust-disclosure-email">
            security@smartmanage.ai
          </a>{" "}
          with details and how to reach you.
        </p>
        <p className="mt-2">
          We will acknowledge within 2 business days and work in good faith to triage and fix. We will not pursue legal
          action against research conducted in good faith against your own test account that does not exfiltrate
          customer data, disrupt the service, or social-engineer staff.
        </p>
      </Section>

      <div className="text-xs text-muted-foreground mt-8" data-testid="text-trust-last-reviewed">
        Last reviewed: {new Date().toISOString().slice(0, 10)}
      </div>
    </PageShell>
  );
}

const SUBPROCESSORS = [
  { name: "Replit, Inc.", purpose: "Application hosting, secrets, deployment", data: "Customer data in transit; managed secrets", region: "US" },
  { name: "Neon, Inc.", purpose: "Managed Postgres database (primary store)", data: "All customer application data", region: "US" },
  { name: "Google Cloud Storage", purpose: "Customer file uploads (plans, photos, documents)", data: "Files and metadata", region: "US" },
  { name: "OpenAI", purpose: "AI features when opted in (bid analysis, contract analysis, suggestions)", data: "Only data submitted to AI features", region: "US" },
  { name: "SendGrid (Twilio)", purpose: "Transactional and notification email", data: "Email addresses, message contents", region: "US" },
  { name: "Stripe, Inc.", purpose: "Subscription billing and payment processing", data: "Billing contact and payment metadata (no card numbers)", region: "US" },
];

export function SubProcessorsPage() {
  return (
    <PageShell
      title="Sub-processors"
      description="The third-party services SmartManageAI uses to deliver the platform, and what data each handles."
    >
      <h1 className="text-3xl font-bold mb-2" data-testid="heading-subprocessors-title">Sub-processors</h1>
      <p className="text-muted-foreground mb-6">
        These are the third parties that may process customer personal data on our behalf. We give at least 30 days
        advance notice before adding a new sub-processor.
      </p>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Sub-processor</th>
              <th className="text-left px-4 py-3 font-medium">Purpose</th>
              <th className="text-left px-4 py-3 font-medium">Data processed</th>
              <th className="text-left px-4 py-3 font-medium">Region</th>
            </tr>
          </thead>
          <tbody>
            {SUBPROCESSORS.map((sp) => (
              <tr key={sp.name} className="border-t border-border" data-testid={`row-subprocessor-${sp.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                <td className="px-4 py-3 font-medium">{sp.name}</td>
                <td className="px-4 py-3">{sp.purpose}</td>
                <td className="px-4 py-3">{sp.data}</td>
                <td className="px-4 py-3">{sp.region}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 text-sm text-muted-foreground space-y-2">
        <p>
          Card numbers are never handled by SmartManageAI: the Stripe Elements iframe submits card data directly to
          Stripe.
        </p>
        <p>
          AI features are opt-in. If your organization disables them, no customer data is sent to OpenAI.
        </p>
        <p>
          To subscribe to sub-processor change notifications, email{" "}
          <a href="mailto:privacy@smartmanage.ai" className="underline" data-testid="link-subprocessor-subscribe">privacy@smartmanage.ai</a>.
        </p>
      </div>

      <div className="mt-8">
        <Link href="/trust" className="inline-flex items-center gap-1 text-sm underline" data-testid="link-back-to-trust">
          <ExternalLink className="w-3 h-3" /> Back to Trust
        </Link>
      </div>
    </PageShell>
  );
}

type StatusLevel = "operational" | "degraded" | "outage" | "maintenance" | "unknown";

type DailyUptime = { date: string; total: number; ok: number };

type RegionMinute = { minute: string; total: number; ok: number };

type RegionStatus = {
  region: string;
  ok: boolean;
  lastCheckedAt: string;
  lastError: string | null;
  responseMs: number | null;
  history?: RegionMinute[];
};

type StatusComponent = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: StatusLevel;
  uptime24h: number | null;
  uptime30d: number | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  daily: DailyUptime[];
  regions?: RegionStatus[];
};

type IncidentUpdate = { id: string; status: string; body: string; createdAt: string };
type Incident = {
  id: string;
  title: string;
  status: "INVESTIGATING" | "IDENTIFIED" | "MONITORING" | "RESOLVED";
  impact: "NONE" | "MINOR" | "MAJOR" | "CRITICAL";
  affectedComponents: Array<{ id: string; key: string; name: string }>;
  startedAt: string;
  resolvedAt: string | null;
  postmortemUrl: string | null;
  postmortem: string | null;
  updates: IncidentUpdate[];
};

type StatusSummary = {
  overall: StatusLevel;
  components: StatusComponent[];
  incidents: Incident[];
  activeIncident: Incident | null;
  generatedAt: string;
};

const STATUS_STYLES: Record<StatusLevel, { label: string; cls: string }> = {
  operational: { label: "Operational", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" },
  degraded:    { label: "Degraded",    cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30" },
  outage:      { label: "Outage",      cls: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30" },
  maintenance: { label: "Maintenance", cls: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30" },
  unknown:     { label: "Awaiting probe", cls: "bg-muted text-muted-foreground border-border" },
};

const IMPACT_STYLES: Record<Incident["impact"], string> = {
  NONE: "bg-muted text-muted-foreground border-border",
  MINOR: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  MAJOR: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30",
  CRITICAL: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30",
};

function fmtUptime(value: number | null): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function fmtRelative(iso: string | null, now: Date): string {
  if (!iso) return "never";
  const ms = now.getTime() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function SubscribeForm() {
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [state, setState] = useState<"idle" | "submitting" | "ok" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("submitting");
    setMessage("");
    try {
      const res = await fetch("/api/public/status/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, website }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Subscription failed");
      }
      const data = await res.json();
      setState("ok");
      setMessage(data.alreadyConfirmed ? "You're already subscribed." : "Check your email to confirm your subscription.");
      setEmail("");
    } catch (err: any) {
      setState("error");
      setMessage(err?.message || "Subscription failed");
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-border bg-card p-4" data-testid="form-status-subscribe">
      <div className="text-sm font-medium mb-2 flex items-center gap-2">
        <Mail className="w-4 h-4" /> Subscribe to incident notifications
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Get an email when we open, update, or resolve a status incident. No marketing.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="email"
          required
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
          data-testid="input-subscribe-email"
        />
        {/* Honeypot */}
        <input type="text" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} className="hidden" tabIndex={-1} autoComplete="off" />
        <button
          type="submit"
          disabled={state === "submitting"}
          className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          data-testid="button-subscribe-submit"
        >
          {state === "submitting" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Subscribe"}
        </button>
      </div>
      {message && (
        <div
          className={`mt-2 text-xs ${state === "error" ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}
          data-testid="text-subscribe-message"
        >
          {message}
        </div>
      )}
    </form>
  );
}

function IncidentCard({ incident }: { incident: Incident }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4" data-testid={`incident-${incident.id}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-semibold text-sm" data-testid={`text-incident-title-${incident.id}`}>{incident.title}</div>
          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            <Clock className="w-3 h-3" /> Started {new Date(incident.startedAt).toLocaleString()}
            {incident.resolvedAt && <> &middot; Resolved {new Date(incident.resolvedAt).toLocaleString()}</>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${IMPACT_STYLES[incident.impact]}`}>
            {incident.impact}
          </span>
          <span className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-medium bg-muted">
            {incident.status}
          </span>
        </div>
      </div>

      {incident.affectedComponents.length > 0 && (
        <div className="text-xs text-muted-foreground mt-2">
          Affected: {incident.affectedComponents.map((c) => c.name).join(", ")}
        </div>
      )}

      {incident.updates.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          {[...incident.updates].reverse().map((u) => (
            <div key={u.id} className="text-sm" data-testid={`incident-update-${u.id}`}>
              <div className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{u.status}</span> &middot; {new Date(u.createdAt).toLocaleString()}
              </div>
              <div className="whitespace-pre-wrap">{u.body}</div>
            </div>
          ))}
        </div>
      )}

      {(incident.postmortem || incident.postmortemUrl) && (
        <div className="mt-3 border-t border-border pt-3 text-sm">
          <div className="font-medium mb-1">Post-mortem</div>
          {incident.postmortem && <div className="whitespace-pre-wrap text-foreground/90">{incident.postmortem}</div>}
          {incident.postmortemUrl && (
            <a href={incident.postmortemUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline text-xs mt-1" data-testid={`link-postmortem-${incident.id}`}>
              <ExternalLink className="w-3 h-3" /> Read full post-mortem
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function build90DayStrip(daily: DailyUptime[], now: Date): Array<{ date: string; total: number; ok: number }> {
  const map = new Map<string, DailyUptime>();
  for (const d of daily) map.set(d.date, d);
  const days: Array<{ date: string; total: number; ok: number }> = [];
  // Walk the last 90 UTC dates ending today
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let i = 89; i >= 0; i--) {
    const d = new Date(todayUtc);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const entry = map.get(key);
    days.push({ date: key, total: entry?.total ?? 0, ok: entry?.ok ?? 0 });
  }
  return days;
}

function dayBarClass(total: number, uptime: number | null): string {
  if (total === 0 || uptime == null) return "bg-muted/60 dark:bg-muted/40";
  if (uptime >= 0.999) return "bg-emerald-500";
  if (uptime >= 0.95) return "bg-amber-400";
  return "bg-red-500";
}

function formatDateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function incidentsOnDay(component: StatusComponent, dateIso: string, allIncidents: Incident[]): Incident[] {
  const dayStart = new Date(`${dateIso}T00:00:00Z`).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  return allIncidents.filter((inc) => {
    const startedAt = new Date(inc.startedAt).getTime();
    const resolvedAt = inc.resolvedAt ? new Date(inc.resolvedAt).getTime() : Date.now();
    if (resolvedAt <= dayStart || startedAt >= dayEnd) return false;
    if (!inc.affectedComponents || inc.affectedComponents.length === 0) return true;
    return inc.affectedComponents.some((ac) => ac.id === component.id);
  });
}

function buildRegionMinuteStrip(history: RegionMinute[], now: Date): Array<{ minute: string; total: number; ok: number }> {
  const map = new Map<string, RegionMinute>();
  for (const m of history) {
    // Normalize incoming minute to a stable UTC ISO key at minute precision.
    const t = new Date(m.minute);
    if (Number.isNaN(t.getTime())) continue;
    const key = new Date(Date.UTC(
      t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(),
      t.getUTCHours(), t.getUTCMinutes(), 0,
    )).toISOString();
    map.set(key, m);
  }
  const minutes: Array<{ minute: string; total: number; ok: number }> = [];
  const currentMinute = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
    now.getUTCHours(), now.getUTCMinutes(), 0,
  ));
  for (let i = 59; i >= 0; i--) {
    const m = new Date(currentMinute.getTime() - i * 60_000);
    const key = m.toISOString();
    const entry = map.get(key);
    minutes.push({ minute: key, total: entry?.total ?? 0, ok: entry?.ok ?? 0 });
  }
  return minutes;
}

function minuteBoxClass(total: number): string {
  if (total === 0) return "bg-muted/60 dark:bg-muted/40";
  return "bg-emerald-500";
}

function minuteBoxFailClass(): string {
  return "bg-red-500";
}

function RegionHistoryStrip({
  componentKey,
  region,
  history,
  now,
}: {
  componentKey: string;
  region: string;
  history: RegionMinute[];
  now: Date;
}) {
  const minutes = buildRegionMinuteStrip(history, now);
  const totalProbes = minutes.reduce((s, m) => s + m.total, 0);
  const okProbes = minutes.reduce((s, m) => s + m.ok, 0);
  const uptime60 = totalProbes > 0 ? okProbes / totalProbes : null;
  const summary =
    uptime60 == null
      ? `No probe data for ${region} in the last hour`
      : `${region}: ${(uptime60 * 100).toFixed(1)}% over the last 60 minutes (${okProbes}/${totalProbes} probes ok)`;

  return (
    <div
      className="flex items-center gap-1"
      role="img"
      aria-label={summary}
      tabIndex={0}
      data-testid={`region-history-${componentKey}-${region}`}
    >
      <span className="sr-only">{summary}</span>
      <div className="flex items-end gap-[1px] h-3" aria-hidden="true">
        {minutes.map((m) => {
          const cls =
            m.total === 0
              ? minuteBoxClass(m.total)
              : m.ok < m.total
              ? minuteBoxFailClass()
              : minuteBoxClass(m.total);
          const time = new Date(m.minute).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
          const title =
            m.total === 0
              ? `${time} — no probe`
              : m.ok === m.total
              ? `${time} — all ${m.total} probe${m.total === 1 ? "" : "s"} ok`
              : `${time} — ${m.total - m.ok}/${m.total} failing`;
          return (
            <div
              key={m.minute}
              title={title}
              className={`w-[3px] h-full rounded-[1px] ${cls}`}
              data-testid={`region-history-box-${componentKey}-${region}-${m.minute}`}
            />
          );
        })}
      </div>
      <span className="text-[10px] text-muted-foreground" data-testid={`region-history-summary-${componentKey}-${region}`}>
        {uptime60 == null ? "—" : `${(uptime60 * 100).toFixed(1)}% / 60m`}
      </span>
    </div>
  );
}

function UptimeStrip({ component, incidents }: { component: StatusComponent; incidents: Incident[] }) {
  const now = new Date();
  const days = build90DayStrip(component.daily ?? [], now);
  const totalProbes = days.reduce((s, d) => s + d.total, 0);
  const okProbes = days.reduce((s, d) => s + d.ok, 0);
  const overall90 = totalProbes > 0 ? okProbes / totalProbes : null;
  const firstWithData = days.find((d) => d.total > 0);

  return (
    <div className="mt-2" data-testid={`uptime-strip-${component.key}`}>
      <div className="flex items-end gap-[2px] h-7" role="img" aria-label={`90-day uptime history for ${component.name}`}>
        {days.map((d) => {
          const uptime = d.total > 0 ? d.ok / d.total : null;
          const dayIncidents = incidentsOnDay(component, d.date, incidents);
          const uptimeText = uptime == null ? "no data" : `${(uptime * 100).toFixed(2)}% uptime`;
          const incidentText = dayIncidents.length
            ? `\nIncidents: ${dayIncidents.map((i) => `${i.title} (${i.impact})`).join("; ")}`
            : "";
          const title = `${formatDateLabel(d.date)} — ${uptimeText}${incidentText}`;
          return (
            <div
              key={d.date}
              title={title}
              data-testid={`uptime-day-${component.key}-${d.date}`}
              className={`flex-1 min-w-0 h-full rounded-[1px] ${dayBarClass(d.total, uptime)} ${dayIncidents.length ? "ring-1 ring-inset ring-foreground/40" : ""}`}
            />
          );
        })}
      </div>
      <div className="flex items-center justify-between mt-1 text-[11px] text-muted-foreground">
        <span data-testid={`text-uptime-strip-start-${component.key}`}>
          {firstWithData ? `${formatDateLabel(firstWithData.date)}` : "90 days ago"}
        </span>
        <span data-testid={`text-uptime-strip-90d-${component.key}`}>
          {overall90 == null ? "Awaiting probe data" : `${(overall90 * 100).toFixed(2)}% uptime over 90 days`}
        </span>
        <span>Today</span>
      </div>
    </div>
  );
}

export function StatusPage() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const { data, isLoading, isError } = useQuery<StatusSummary>({
    queryKey: ["/api/public/status/summary"],
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const overall: StatusLevel = data?.overall ?? "unknown";
  const components = data?.components ?? [];
  const incidents = data?.incidents ?? [];
  const activeIncident = data?.activeIncident ?? null;

  return (
    <PageShell
      title="Status"
      description="Current SmartManageAI service status, recent incidents, and uptime."
    >
      <h1 className="text-3xl font-bold mb-2" data-testid="heading-status-title">Service Status</h1>

      {isError && (
        <div className="mt-2 mb-6 rounded-lg border border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 text-sm" data-testid="text-status-error">
          Unable to reach the status feed right now. Please refresh in a moment.
        </div>
      )}

      <div className={`mt-2 mb-8 rounded-lg border px-4 py-3 ${STATUS_STYLES[overall].cls}`} data-testid="status-overall">
        <div className="flex items-center gap-2">
          {overall === "operational" ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          <span className="font-semibold">
            {isLoading ? "Loading status…" : overall === "operational" ? "All systems operational" : `Service ${STATUS_STYLES[overall].label.toLowerCase()}`}
          </span>
        </div>
        <div className="text-xs mt-1 opacity-80 flex items-center gap-1">
          <Clock className="w-3 h-3" /> As of {now.toLocaleString()}
          {data?.generatedAt && <span className="opacity-70">&middot; data refreshed {fmtRelative(data.generatedAt, now)}</span>}
        </div>
      </div>

      {activeIncident && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-2" data-testid="heading-active-incident">Active incident</h2>
          <IncidentCard incident={activeIncident} />
        </section>
      )}

      <div className="rounded-lg border border-border divide-y divide-border" data-testid="list-status-components">
        {isLoading && (
          <div className="px-4 py-6 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading component health…
          </div>
        )}
        {!isLoading && components.length === 0 && (
          <div className="px-4 py-6 text-sm text-muted-foreground">No components configured yet.</div>
        )}
        {components.map((c) => (
          <div
            key={c.key}
            className="px-4 py-3"
            data-testid={`status-component-${c.key}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-sm">{c.name}</div>
                <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 mt-0.5">
                  <span>24h uptime: <span className="font-medium text-foreground" data-testid={`text-uptime-24h-${c.key}`}>{fmtUptime(c.uptime24h)}</span></span>
                  <span>30d uptime: <span className="font-medium text-foreground" data-testid={`text-uptime-30d-${c.key}`}>{fmtUptime(c.uptime30d)}</span></span>
                  <span>Last probe: {fmtRelative(c.lastCheckedAt, now)}</span>
                </div>
                {c.lastError && c.status !== "operational" && (
                  <div className="text-xs text-red-600 dark:text-red-400 mt-1" data-testid={`text-component-error-${c.key}`}>
                    {c.lastError}
                  </div>
                )}
                {c.regions && c.regions.length > 1 && (
                  <div className="mt-2 space-y-1.5" data-testid={`regions-${c.key}`}>
                    {c.regions.map((r) => (
                      <div key={r.region} className="flex items-center gap-2 flex-wrap">
                        <span
                          title={
                            r.ok
                              ? `${r.region}: OK${r.responseMs != null ? ` · ${r.responseMs}ms` : ""}`
                              : `${r.region}: ${r.lastError ?? "failing"}`
                          }
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                            r.ok
                              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                              : "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30"
                          }`}
                          data-testid={`region-pill-${c.key}-${r.region}`}
                        >
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${r.ok ? "bg-emerald-500" : "bg-red-500"}`} />
                          {r.region}
                        </span>
                        <RegionHistoryStrip componentKey={c.key} region={r.region} history={r.history ?? []} now={now} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_STYLES[c.status].cls}`} data-testid={`status-pill-${c.key}`}>
                {STATUS_STYLES[c.status].label}
              </span>
            </div>
            <UptimeStrip component={c} incidents={incidents} />
          </div>
        ))}
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-semibold mb-2" data-testid="heading-uptime">Uptime target</h2>
        <p className="text-sm text-muted-foreground">
          Our target uptime is 99.9% measured monthly, excluding announced maintenance. Component health above is
          driven by automated probes that run every minute. Incidents are posted here and updated at least every 60
          minutes until resolved.
        </p>
      </section>

      <section className="mt-8">
        <SubscribeForm />
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold mb-3" data-testid="heading-incidents">Past incidents</h2>
        {isLoading ? (
          <div className="rounded-lg border border-border px-4 py-6 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : incidents.filter((i) => i.id !== activeIncident?.id).length === 0 ? (
          <div className="rounded-lg border border-border px-4 py-6 text-sm text-muted-foreground" data-testid="text-no-incidents">
            No incidents reported in the last 90 days.
          </div>
        ) : (
          <div className="space-y-3" data-testid="list-incidents">
            {incidents
              .filter((i) => i.id !== activeIncident?.id)
              .map((incident) => (
                <IncidentCard key={incident.id} incident={incident} />
              ))}
          </div>
        )}
      </section>

      <div className="mt-8 text-xs text-muted-foreground">
        For a programmatic feed, hit{" "}
        <code className="rounded bg-muted px-1.5 py-0.5">GET /api/public/status/summary</code>. Questions? Email{" "}
        <a href="mailto:support@smartmanage.ai" className="underline" data-testid="link-status-support">support@smartmanage.ai</a>.
      </div>
    </PageShell>
  );
}

const LEGAL_LAST_UPDATED = "2026-04-27";

function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <section className="mb-8" id={id}>
      <h2 className="text-xl font-semibold mb-3" data-testid={`heading-legal-${id}`}>{title}</h2>
      <div className="text-sm leading-relaxed text-foreground/90 space-y-3">{children}</div>
    </section>
  );
}

export function PrivacyPolicyPage() {
  return (
    <PageShell
      title="Privacy Policy"
      description="How SmartManageAI collects, uses, shares, and protects your information."
    >
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2" data-testid="heading-privacy-title">Privacy Policy</h1>
        <p className="text-muted-foreground" data-testid="text-privacy-tagline">
          This Privacy Policy explains how SmartManageAI, Inc. ("SmartManageAI", "we", "us") handles personal
          information when you visit our website or use our construction management platform.
        </p>
        <div className="text-xs text-muted-foreground mt-3" data-testid="text-privacy-last-updated">
          Last updated: {LEGAL_LAST_UPDATED}
        </div>
      </div>

      <LegalSection title="Information we collect">
        <p>We collect information in three ways:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <span className="font-medium">Information you give us.</span> Account details such as your name, work email,
            phone number, company, role, and password; profile and preference settings; bid, project, financial,
            payroll, contract, schedule, and field documentation that your organization uploads to the platform; and
            any messages you send us.
          </li>
          <li>
            <span className="font-medium">Information from your use of the service.</span> Log data (IP address, browser
            and device information, pages viewed, timestamps), actions taken in the app, and diagnostic data needed to
            keep the platform reliable and secure.
          </li>
          <li>
            <span className="font-medium">Information from third parties.</span> Data from your single sign-on identity
            provider when you sign in with SAML or OAuth, billing metadata from our payment processor, and information
            you choose to import from connected services such as e-signature, accounting, or DOT systems.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="How we use information">
        <ul className="list-disc pl-5 space-y-1">
          <li>To provide, maintain, and improve the SmartManageAI platform.</li>
          <li>To authenticate users, enforce role-based access, and protect customer data.</li>
          <li>To respond to support requests and communicate about your account.</li>
          <li>To monitor performance, debug issues, and prevent abuse or fraud.</li>
          <li>To send transactional notifications (status incidents, billing receipts, security alerts).</li>
          <li>To comply with legal obligations and enforce our agreements.</li>
        </ul>
        <p>
          AI features are opt-in at the organization level. When enabled, the data you submit to a specific AI feature
          is sent to our AI sub-processor solely to generate the requested output. Customer data is not used to train
          third-party models.
        </p>
      </LegalSection>

      <LegalSection title="How we share information">
        <p>We do not sell personal information. We share information only in these circumstances:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <span className="font-medium">Within your organization.</span> Information you upload is visible to other
            users in your organization based on the access controls your administrators configure.
          </li>
          <li>
            <span className="font-medium">Sub-processors.</span> Vetted vendors that help us run the platform (hosting,
            database, file storage, email delivery, billing, and opt-in AI). The current list lives at{" "}
            <Link href="/sub-processors" className="underline" data-testid="link-privacy-subprocessors">/sub-processors</Link>.
          </li>
          <li>
            <span className="font-medium">Legal and safety.</span> When required by law, valid legal process, or to
            protect the rights, property, or safety of SmartManageAI, our customers, or the public.
          </li>
          <li>
            <span className="font-medium">Business transfers.</span> In connection with a merger, acquisition, or sale
            of assets, subject to the commitments in this Policy.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Data retention">
        <p>
          We retain customer data for as long as your organization maintains an active account, plus a limited
          recovery window after termination. By default we soft-delete account data immediately on request and
          hard-delete it within 30 days, except where we are required to keep records for tax, legal, or audit
          purposes. Backups are retained for up to 30 days and then cycled out.
        </p>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          We protect customer data with TLS in transit, AES-256 at rest, role-based access enforced server-side,
          phishing-resistant authentication options (passkeys and SAML SSO), audit logging, and an annual third-party
          penetration test. More detail is on our{" "}
          <Link href="/trust" className="underline" data-testid="link-privacy-trust">Trust</Link> page.
        </p>
        <p>
          No system is perfectly secure. If you believe your account has been compromised or you have spotted a
          security issue, email{" "}
          <a href="mailto:security@smartmanage.ai" className="underline" data-testid="link-privacy-security-email">security@smartmanage.ai</a>.
        </p>
      </LegalSection>

      <LegalSection title="Your rights">
        <p>
          Depending on where you live you may have rights to access, correct, export, or delete personal information
          we hold about you, to object to or restrict certain processing, and to withdraw consent. To exercise these
          rights, email{" "}
          <a href="mailto:privacy@smartmanage.ai" className="underline" data-testid="link-privacy-email">privacy@smartmanage.ai</a>{" "}
          from the address associated with your account. We respond within 30 days. If your data was provided to us
          by your employer, we will direct your request to them as the controller of that data.
        </p>
      </LegalSection>

      <LegalSection title="Cookies and similar technologies">
        <p>
          We use a small number of cookies and similar technologies that are necessary to keep you signed in, remember
          your preferences, and measure aggregate platform performance. We do not use third-party advertising cookies
          on the application. Your browser settings let you block or delete cookies, though doing so may break parts
          of the service that depend on staying signed in.
        </p>
      </LegalSection>

      <LegalSection title="Children's privacy">
        <p>
          SmartManageAI is built for businesses and is not directed to children under 16. We do not knowingly collect
          personal information from children. If you believe a child has provided us information, email{" "}
          <a href="mailto:privacy@smartmanage.ai" className="underline" data-testid="link-privacy-children-email">privacy@smartmanage.ai</a>{" "}
          and we will delete it.
        </p>
      </LegalSection>

      <LegalSection title="Changes to this policy">
        <p>
          We may update this Policy from time to time. When we make material changes we will update the "Last updated"
          date above and, where appropriate, notify customer administrators by email or in-app notice. Continued use of
          the service after a change takes effect means you accept the updated Policy.
        </p>
      </LegalSection>

      <LegalSection title="Contact us">
        <p>
          Questions about this Policy? Email{" "}
          <a href="mailto:privacy@smartmanage.ai" className="underline" data-testid="link-privacy-contact-email">privacy@smartmanage.ai</a>{" "}
          or write to SmartManageAI, Inc., Attn: Privacy.
        </p>
      </LegalSection>

      <div className="mt-8">
        <Link href="/" className="inline-flex items-center gap-1 text-sm underline" data-testid="link-privacy-back-home">
          ← Back to home
        </Link>
      </div>
    </PageShell>
  );
}

export function TermsOfServicePage() {
  return (
    <PageShell
      title="Terms of Service"
      description="The terms that govern your use of the SmartManageAI platform."
    >
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2" data-testid="heading-terms-title">Terms of Service</h1>
        <p className="text-muted-foreground" data-testid="text-terms-tagline">
          These Terms of Service ("Terms") form a binding agreement between SmartManageAI, Inc.
          ("SmartManageAI", "we", "us") and the organization or individual ("Customer", "you") that accesses or uses
          our platform.
        </p>
        <div className="text-xs text-muted-foreground mt-3" data-testid="text-terms-last-updated">
          Last updated: {LEGAL_LAST_UPDATED}
        </div>
      </div>

      <LegalSection title="Acceptance of terms">
        <p>
          By creating an account, signing an order form, or otherwise using the SmartManageAI platform you agree to
          these Terms. If you accept these Terms on behalf of an organization you represent that you are authorized to
          bind that organization. If you do not agree, do not use the service.
        </p>
      </LegalSection>

      <LegalSection title="Eligibility">
        <p>
          You must be at least 18 years old and able to form a binding contract to use the service. The service is
          built for businesses; it is not intended for personal, family, or household use.
        </p>
      </LegalSection>

      <LegalSection title="Accounts">
        <p>
          You are responsible for the accuracy of the information in your account, for keeping your credentials
          secure, and for all activity under your account. Notify us promptly at{" "}
          <a href="mailto:security@smartmanage.ai" className="underline" data-testid="link-terms-security-email">security@smartmanage.ai</a>{" "}
          if you suspect unauthorized access. Customer administrators are responsible for managing user roles and
          access within their organization.
        </p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>You agree not to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Use the service to violate any law or third-party right.</li>
          <li>Upload malware or content that is unlawful, infringing, or harmful.</li>
          <li>Probe, scan, or test the vulnerability of the system except as permitted by our responsible disclosure terms.</li>
          <li>Interfere with or disrupt the service, its infrastructure, or other customers.</li>
          <li>Reverse engineer, scrape, or resell the service except as expressly permitted.</li>
          <li>Use the service to build a competing product or to train competing AI models.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Subscriptions and payment">
        <p>
          Paid plans are billed in advance on the cadence stated in your order form or in-app subscription page. Fees
          are non-refundable except as required by law. We may change pricing on renewal with reasonable advance
          notice. Late payments may accrue interest at the lesser of 1.5% per month or the maximum allowed by law and
          may result in suspension of the service.
        </p>
      </LegalSection>

      <LegalSection title="Intellectual property">
        <p>
          We own the SmartManageAI platform, including all software, designs, and trademarks. Subject to these Terms
          we grant you a limited, non-exclusive, non-transferable right to use the service during your subscription.
          We welcome feedback and suggestions; if you provide them, you grant us a perpetual, royalty-free license to
          use them to improve the service.
        </p>
      </LegalSection>

      <LegalSection title="Customer data">
        <p>
          You retain all rights to the data your organization uploads ("Customer Data"). You grant us a limited
          license to host, copy, transmit, display, and process Customer Data solely to provide and improve the
          service for you, to maintain security, and as otherwise instructed by you. Our handling of personal
          information is described in our{" "}
          <Link href="/privacy" className="underline" data-testid="link-terms-privacy">Privacy Policy</Link>.
        </p>
        <p>
          You are responsible for the accuracy, quality, and legality of Customer Data and for having the rights
          necessary to upload it.
        </p>
      </LegalSection>

      <LegalSection title="Third-party services">
        <p>
          The service may integrate with third-party products such as e-signature, accounting, DOT, or AI providers.
          Your use of those products is governed by the third party's terms. We are not responsible for third-party
          services and disabling them may limit functionality.
        </p>
      </LegalSection>

      <LegalSection title="Disclaimers">
        <p>
          Except as expressly stated in a signed agreement, the service is provided "as is" and "as available". We
          disclaim all warranties, express or implied, including merchantability, fitness for a particular purpose,
          and non-infringement. We do not warrant that the service will be uninterrupted or error-free, that it will
          meet every requirement, or that AI-generated outputs will be accurate or appropriate for your project.
          Always have a qualified human review business-critical decisions.
        </p>
      </LegalSection>

      <LegalSection title="Limitation of liability">
        <p>
          To the maximum extent permitted by law, neither party will be liable for indirect, incidental, special,
          consequential, exemplary, or punitive damages, or for lost profits, revenue, data, or goodwill, even if
          advised of the possibility. Our aggregate liability arising out of or related to these Terms will not
          exceed the fees you paid us for the service in the 12 months before the event giving rise to the claim.
        </p>
      </LegalSection>

      <LegalSection title="Indemnification">
        <p>
          You will defend, indemnify, and hold us harmless from third-party claims arising out of your Customer Data,
          your use of the service in violation of these Terms or law, or your breach of any third-party right. We
          will defend, indemnify, and hold you harmless from third-party claims that the service, used as authorized,
          infringes a U.S. patent, copyright, or trademark, subject to the exclusions and remedies customary in
          enterprise SaaS agreements.
        </p>
      </LegalSection>

      <LegalSection title="Termination">
        <p>
          You may stop using the service at any time. Either party may terminate for material breach that is not
          cured within 30 days of written notice. We may suspend the service immediately if your use endangers our
          systems or other customers, or for non-payment after notice. On termination we will, at your request and
          for a reasonable transition period, allow export of Customer Data; thereafter we will delete Customer Data
          on the schedule described in our Privacy Policy.
        </p>
      </LegalSection>

      <LegalSection title="Governing law">
        <p>
          These Terms are governed by the laws of the State of Delaware, without regard to conflict-of-laws rules.
          The parties consent to the exclusive jurisdiction of the state and federal courts located in Delaware for
          any dispute that is not subject to arbitration under your order form. Each party waives any right to a jury
          trial.
        </p>
      </LegalSection>

      <LegalSection title="Changes to these terms">
        <p>
          We may update these Terms from time to time. When we make material changes we will update the "Last updated"
          date above and, where appropriate, notify customer administrators by email or in-app notice. Continued use
          of the service after a change takes effect means you accept the updated Terms.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions about these Terms? Email{" "}
          <a href="mailto:legal@smartmanage.ai" className="underline" data-testid="link-terms-contact-email">legal@smartmanage.ai</a>{" "}
          or write to SmartManageAI, Inc., Attn: Legal.
        </p>
      </LegalSection>

      <div className="mt-8">
        <Link href="/" className="inline-flex items-center gap-1 text-sm underline" data-testid="link-terms-back-home">
          ← Back to home
        </Link>
      </div>
    </PageShell>
  );
}

export function DpaPage() {
  return (
    <PageShell
      title="Data Processing Addendum"
      description="The DPA that governs SmartManageAI's processing of personal data on behalf of customers."
    >
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2" data-testid="heading-dpa-title">Data Processing Addendum</h1>
        <p className="text-muted-foreground" data-testid="text-dpa-tagline">
          This Data Processing Addendum ("DPA") forms part of the agreement between SmartManageAI, Inc.
          ("Processor") and Customer ("Controller") for the provision of the SmartManageAI platform. It applies
          to the Processing of Personal Data on behalf of Controller. A countersigned copy is available on
          request to <a className="underline" href="mailto:legal@smartmanage.ai">legal@smartmanage.ai</a>.
        </p>
        <div className="text-xs text-muted-foreground mt-3" data-testid="text-dpa-last-updated">
          Last updated: {LEGAL_LAST_UPDATED}
        </div>
      </div>

      <LegalSection title="Definitions">
        <p>
          Capitalised terms not defined here have the meaning given in applicable Data Protection Laws
          (including the GDPR, UK GDPR, and CCPA/CPRA). "Personal Data", "Processing", "Data Subject",
          "Controller", and "Processor" have the meanings given in the GDPR.
        </p>
      </LegalSection>

      <LegalSection title="Scope and roles">
        <p>
          Controller appoints Processor to Process Personal Data on its behalf solely to provide the Services
          and as further documented in the Agreement. Each party will comply with its obligations under
          applicable Data Protection Laws.
        </p>
      </LegalSection>

      <LegalSection title="Processing details">
        <ul className="list-disc pl-5 space-y-1">
          <li><span className="font-medium">Subject matter:</span> provision of the SmartManageAI platform.</li>
          <li><span className="font-medium">Duration:</span> the term of the Agreement plus the deletion period below.</li>
          <li><span className="font-medium">Nature & purpose:</span> hosting, storing, securing, transmitting and presenting Customer Data.</li>
          <li><span className="font-medium">Data Subjects:</span> Customer's employees, contractors, vendors, and counterparties.</li>
          <li><span className="font-medium">Personal Data categories:</span> identity (name, work email, phone), employment data, project &amp; bid data, time entries, and Customer-uploaded content.</li>
          <li><span className="font-medium">Special categories:</span> none expected; Customer is responsible for not uploading sensitive categories.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Processor obligations">
        <ul className="list-disc pl-5 space-y-1">
          <li>Process Personal Data only on documented instructions from Controller.</li>
          <li>Ensure persons authorised to Process Personal Data are bound by confidentiality.</li>
          <li>Implement the technical and organisational measures described in the Security Annex.</li>
          <li>Assist Controller in responding to Data Subject Requests and meeting Articles 32–36 GDPR.</li>
          <li>Notify Controller without undue delay (and in any event within 72 hours) of a Personal Data Breach.</li>
          <li>Make available all information necessary to demonstrate compliance and allow for audits as set out below.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Sub-processors">
        <p>
          Controller authorises Processor to engage the sub-processors listed at{" "}
          <Link href="/sub-processors" className="underline" data-testid="link-dpa-subprocessors">/sub-processors</Link>.
          Processor imposes data-protection terms on each sub-processor that are no less protective than this
          DPA, remains liable for their acts and omissions, and notifies Controller at least 30 days before
          adding or replacing a sub-processor. Controller may object on reasonable data-protection grounds.
        </p>
      </LegalSection>

      <LegalSection title="International transfers">
        <p>
          Where Processor transfers Personal Data outside the UK / EEA to a country not recognised as providing
          adequate protection, the parties incorporate the EU Standard Contractual Clauses (Module 2) and,
          where applicable, the UK International Data Transfer Addendum, by reference. Annex I and Annex II of
          the SCCs are completed by reference to the Processing Details and Security Annex of this DPA.
        </p>
      </LegalSection>

      <LegalSection title="Data Subject Requests">
        <p>
          Processor will, where legally permitted, promptly inform Controller of any request received from a
          Data Subject and will not respond except on Controller's documented instructions. The Services
          include self-service controls for export and deletion of Customer Data — see "Return and deletion"
          below and the data-handling whitepaper.
        </p>
      </LegalSection>

      <LegalSection title="Audit rights">
        <p>
          Processor will make available to Controller, on reasonable request and no more than once per
          twelve-month period, the most recent third-party audit reports, security questionnaire responses,
          and a written summary of penetration-test findings. Where these are insufficient, Controller may, on
          30 days' written notice and at its expense, conduct an audit subject to Processor's reasonable
          security and confidentiality controls.
        </p>
      </LegalSection>

      <LegalSection title="Return and deletion of Personal Data">
        <p>
          On termination or at Controller's request, Controller may export Customer Data through the Services
          for up to 30 days. Thereafter Processor will soft-delete Customer Data immediately and hard-delete
          within 30 days, except to the extent retention is required by law. Backups are cycled out within 30
          days. The Services include self-service "Delete my organization" controls in Company Settings →
          Data Management that follow this schedule and write to the audit log.
        </p>
      </LegalSection>

      <LegalSection title="Liability">
        <p>
          Each party's liability arising under or in connection with this DPA is subject to the limitations of
          liability in the Agreement.
        </p>
      </LegalSection>

      <LegalSection title="Governing law and order of precedence">
        <p>
          This DPA is governed by the law and jurisdiction set out in the Agreement, except where mandated
          otherwise by applicable Data Protection Laws. In the event of a conflict, the order of precedence is:
          (1) the SCCs (where applicable), (2) this DPA, (3) the Agreement.
        </p>
      </LegalSection>

      <LegalSection title="Security Annex">
        <p>The technical and organisational measures Processor maintains include, at minimum:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>TLS 1.2+ in transit; AES-256 at rest (database, object storage, backups).</li>
          <li>Postgres Row-Level Security with a fail-closed <code>tenant_isolation</code> policy on every multi-tenant table.</li>
          <li>Append-only audit log with runtime-validated <code>userId</code>.</li>
          <li>Postgres-backed rate limiting that holds across replicas.</li>
          <li>AV scan on every confirmed upload before the ACL policy is written.</li>
          <li>Quarantine envelope and refusal heuristics on all untrusted-document → LLM paths.</li>
          <li>24/7 alerting with status posted to <Link className="underline" href="/trust" data-testid="link-dpa-trust">/trust</Link>; Personal Data Breach notification within 72 hours.</li>
          <li>Documented sub-processors at <Link className="underline" href="/sub-processors" data-testid="link-dpa-subprocessors-2">/sub-processors</Link>; 30-day change notice.</li>
        </ul>
        <p>
          A more detailed description is published in our data-handling whitepaper, available on request to{" "}
          <a className="underline" href="mailto:security@smartmanage.ai">security@smartmanage.ai</a>.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions about this DPA? Email{" "}
          <a href="mailto:legal@smartmanage.ai" className="underline" data-testid="link-dpa-contact-email">legal@smartmanage.ai</a>{" "}
          or write to SmartManageAI, Inc., Attn: Legal.
        </p>
      </LegalSection>

      <div className="mt-8">
        <Link href="/" className="inline-flex items-center gap-1 text-sm underline" data-testid="link-dpa-back-home">
          ← Back to home
        </Link>
      </div>
    </PageShell>
  );
}

export default TrustPage;
