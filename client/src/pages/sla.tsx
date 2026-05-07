import { useEffect } from "react";
import { Link } from "wouter";

export default function SlaPage() {
  useEffect(() => {
    document.title = "Service Level Agreement | SmartManageAI";
    const meta =
      document.querySelector('meta[name="description"]') ||
      (() => {
        const m = document.createElement("meta");
        m.setAttribute("name", "description");
        document.head.appendChild(m);
        return m;
      })();
    meta.setAttribute(
      "content",
      "SmartManageAI uptime, first-response time, and resolution time targets per plan tier.",
    );
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <Link href="/" className="font-semibold text-lg" data-testid="link-sla-home">
            SmartManageAI
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/help" className="hover:underline" data-testid="link-sla-help">Help</Link>
            <Link href="/sla" className="hover:underline" data-testid="link-sla-sla">SLA</Link>
            <Link href="/status" className="hover:underline" data-testid="link-sla-status">Status</Link>
            <Link href="/trust" className="hover:underline" data-testid="link-sla-trust">Trust</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10 space-y-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">Service Level Agreement</h1>
          <p className="text-muted-foreground">
            What you can expect from SmartManageAI for uptime, support response times, and incident
            communication. Live status is at{" "}
            <Link href="/status" className="underline">/status</Link>.
          </p>
        </div>

        <section>
          <h2 className="text-xl font-semibold mb-3">Plan tiers at a glance</h2>
          <div className="overflow-x-auto border border-border rounded-md">
            <table className="w-full text-sm" data-testid="table-sla-tiers">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3">Target</th>
                  <th className="text-left p-3">Starter</th>
                  <th className="text-left p-3">Pro</th>
                  <th className="text-left p-3">Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Monthly uptime", "99.5%", "99.9%", "99.95%"],
                  ["First response (urgent)", "1 business day", "4 business hours", "30 minutes (24×7)"],
                  ["First response (normal)", "2 business days", "1 business day", "4 business hours"],
                  ["Target resolution (Sev 1)", "5 business days", "2 calendar days", "8 hours"],
                  ["Channels", "In-app + email", "In-app + email + Slack", "In-app + email + Slack + CSM"],
                  ["Status updates", "Best effort", "≤ 60 min cadence", "≤ 30 min cadence"],
                ].map(([k, a, b, c]) => (
                  <tr key={k} className="border-t border-border">
                    <td className="p-3 font-medium">{k}</td>
                    <td className="p-3">{a}</td>
                    <td className="p-3">{b}</td>
                    <td className="p-3">{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Business hours are 09:00–18:00 in your billing time zone, Mon–Fri excluding US federal
            holidays. Enterprise urgent tickets are 24×7.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Severity definitions</h2>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong>Sev 1 / Urgent.</strong> Production down, suspected data loss, or active security incident.</li>
            <li><strong>Sev 2 / High.</strong> A core workflow is unavailable for a meaningful subset of users; no workaround.</li>
            <li><strong>Sev 3 / Normal.</strong> Non-blocking defect, question, or feature request with a workaround.</li>
            <li><strong>Sev 4 / Low.</strong> Cosmetic, documentation, or scheduling-only.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">How to reach us</h2>
          <p className="text-sm">
            Click the <strong>Help</strong> button at the bottom-right of any in-app page to search the docs or open
            a ticket. Tickets carry your user, organization, route, and plan tier automatically so we can
            route them straight to the right responder.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Service credits</h2>
          <p className="text-sm">
            If we miss the monthly uptime target for your tier, request a service credit by opening a ticket
            within 30 days of the affected month. Starter / Pro: 5% of the affected month per 0.1% below
            target, capped at 25%. Enterprise: as negotiated; the table above is the default floor.
          </p>
        </section>

        <p className="text-xs text-muted-foreground">
          Canonical version: <code>docs/sla.md</code>. The in-app SLA enforcement in{" "}
          <code>server/support/slaPolicy.ts</code> mirrors these targets.
        </p>
      </main>
    </div>
  );
}
