import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Search, Loader2, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";

interface HelpSummary {
  slug: string;
  title: string;
  module: string;
  tags: string[];
  routes: string[];
  excerpt: string;
}

interface HelpArticle extends HelpSummary {
  body: string;
}

export default function HelpCenterPage() {
  const [query, setQuery] = useState("");
  const [activeSlug, setActiveSlug] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Help Center | SmartManageAI";
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
      "Search SmartManageAI documentation, browse the top how-to articles, and open a support ticket.",
    );
  }, []);

  const list = useQuery<{ articles: HelpSummary[] }>({
    queryKey: ["/api/support/help/articles", { q: query }],
  });

  const article = useQuery<HelpArticle>({
    queryKey: ["/api/support/help/articles", activeSlug],
    enabled: Boolean(activeSlug),
  });

  const grouped = useMemo(() => {
    const map = new Map<string, HelpSummary[]>();
    for (const a of list.data?.articles ?? []) {
      const key = a.module || "Other";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [list.data]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <Link href="/" className="font-semibold text-lg" data-testid="link-help-home">
            SmartManageAI
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/help" className="hover:underline" data-testid="link-help-help">Help</Link>
            <Link href="/sla" className="hover:underline" data-testid="link-help-sla">SLA</Link>
            <Link href="/status" className="hover:underline" data-testid="link-help-status">Status</Link>
            <Link href="/trust" className="hover:underline" data-testid="link-help-trust">Trust</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="space-y-2 mb-6">
          <h1 className="text-3xl font-bold">Help Center</h1>
          <p className="text-muted-foreground">
            Search the docs, browse by module, or{" "}
            <Link href="/sla" className="underline" data-testid="link-help-readsla">read the SLA</Link>.
          </p>
        </div>

        <div className="relative max-w-xl mb-8">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search articles…"
            className="pl-9 h-11"
            data-testid="input-help-center-search"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <aside className="lg:col-span-1 space-y-6">
            {list.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading articles…
              </div>
            ) : (
              grouped.map(([module, items]) => (
                <section key={module}>
                  <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{module}</h2>
                  <ul className="space-y-1">
                    {items.map((a) => (
                      <li key={a.slug}>
                        <button
                          type="button"
                          onClick={() => setActiveSlug(a.slug)}
                          className={`text-left text-sm hover:underline ${activeSlug === a.slug ? "font-semibold text-primary" : ""}`}
                          data-testid={`link-help-center-article-${a.slug}`}
                        >
                          {a.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </aside>

          <article className="lg:col-span-2 border border-border rounded-md p-6 bg-card">
            {!activeSlug ? (
              <div className="text-muted-foreground">
                <p className="mb-3">Pick an article on the left, or use search to jump straight to an answer.</p>
                <p className="text-sm">
                  Need a human? Click the <strong>Help</strong> button at the bottom-right of any in-app page to open a
                  ticket. Tickets are answered within the SLA window for your plan tier.
                </p>
              </div>
            ) : article.isLoading || !article.data ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : (
              <div data-testid="help-center-article">
                <h2 className="text-2xl font-semibold mb-4">{article.data.title}</h2>
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed bg-transparent p-0">
                  {article.data.body}
                </pre>
                {article.data.routes?.length > 0 && (
                  <div className="mt-6 pt-4 border-t border-border text-sm">
                    <span className="text-muted-foreground">Try it: </span>
                    {article.data.routes.map((r) => (
                      <a
                        key={r}
                        href={r}
                        className="text-primary hover:underline mr-3 inline-flex items-center gap-1"
                      >
                        {r}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </article>
        </div>
      </main>
    </div>
  );
}
