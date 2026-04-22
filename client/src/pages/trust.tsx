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

type RegionStatus = {
  region: string;
  ok: boolean;
  lastCheckedAt: string;
  lastError: string | null;
  responseMs: number | null;
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
  affectedComponents: string[];
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
          Affected: {incident.affectedComponents.join(", ")}
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
    return inc.affectedComponents.some((ac) => ac === component.key || ac === component.name || ac === component.id);
  });
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
                  <div className="mt-2 flex flex-wrap gap-1.5" data-testid={`regions-${c.key}`}>
                    {c.regions.map((r) => (
                      <span
                        key={r.region}
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

export default TrustPage;
