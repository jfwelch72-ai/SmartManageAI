import { Link } from "wouter";
import { useEffect, useState } from "react";
import { Shield, Lock, Database, Cloud, AlertTriangle, FileText, CheckCircle2, ExternalLink, Mail, Clock } from "lucide-react";

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

type StatusLevel = "operational" | "degraded" | "outage" | "maintenance";

const COMPONENTS: Array<{ name: string; level: StatusLevel; note?: string }> = [
  { name: "Web application", level: "operational" },
  { name: "API", level: "operational" },
  { name: "Database", level: "operational" },
  { name: "File uploads & downloads", level: "operational" },
  { name: "Email & notifications", level: "operational" },
  { name: "AI features", level: "operational" },
];

const STATUS_STYLES: Record<StatusLevel, { label: string; cls: string }> = {
  operational: { label: "Operational", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" },
  degraded:    { label: "Degraded",    cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30" },
  outage:      { label: "Outage",      cls: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30" },
  maintenance: { label: "Maintenance", cls: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30" },
};

export function StatusPage() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const overall: StatusLevel = COMPONENTS.some((c) => c.level === "outage")
    ? "outage"
    : COMPONENTS.some((c) => c.level === "degraded")
    ? "degraded"
    : COMPONENTS.some((c) => c.level === "maintenance")
    ? "maintenance"
    : "operational";

  return (
    <PageShell
      title="Status"
      description="Current SmartManageAI service status, recent incidents, and uptime."
    >
      <h1 className="text-3xl font-bold mb-2" data-testid="heading-status-title">Service Status</h1>

      <div className={`mt-2 mb-8 rounded-lg border px-4 py-3 ${STATUS_STYLES[overall].cls}`} data-testid="status-overall">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5" />
          <span className="font-semibold">All systems {STATUS_STYLES[overall].label.toLowerCase()}</span>
        </div>
        <div className="text-xs mt-1 opacity-80 flex items-center gap-1">
          <Clock className="w-3 h-3" /> As of {now.toLocaleString()}
        </div>
      </div>

      <div className="rounded-lg border border-border divide-y divide-border">
        {COMPONENTS.map((c) => (
          <div key={c.name} className="flex items-center justify-between px-4 py-3" data-testid={`status-component-${c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
            <div>
              <div className="font-medium text-sm">{c.name}</div>
              {c.note && <div className="text-xs text-muted-foreground">{c.note}</div>}
            </div>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[c.level].cls}`}>
              {STATUS_STYLES[c.level].label}
            </span>
          </div>
        ))}
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-semibold mb-2" data-testid="heading-uptime">Uptime target</h2>
        <p className="text-sm text-muted-foreground">
          Our target uptime is 99.9% measured monthly, excluding announced maintenance. Incidents are posted here and
          updated at least every 60 minutes until resolved. Customers are notified by email for any incident affecting
          their organization.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold mb-2" data-testid="heading-incidents">Recent incidents</h2>
        <div className="rounded-lg border border-border px-4 py-6 text-sm text-muted-foreground" data-testid="text-no-incidents">
          No incidents reported in the last 30 days.
        </div>
      </section>

      <div className="mt-8 text-xs text-muted-foreground">
        For a real-time programmatic feed of status, contact{" "}
        <a href="mailto:support@smartmanage.ai" className="underline" data-testid="link-status-support">support@smartmanage.ai</a>.
      </div>
    </PageShell>
  );
}

export default TrustPage;
