import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { HelpCircle, ChevronLeft, Loader2, BookOpen, ExternalLink, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";

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

function ArticleBody({ slug, onBack }: { slug: string; onBack?: () => void }) {
  const { data, isLoading, isError } = useQuery<HelpArticle>({
    queryKey: ["/api/support/help/articles", slug],
    queryFn: () =>
      apiRequest("GET", `/api/support/help/articles/${slug}`).then((r) => r.json()),
  });

  return (
    <div className="space-y-4" data-testid={`contextual-help-article-${slug}`}>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          data-testid="button-contextual-help-back"
        >
          <ChevronLeft className="h-4 w-4" /> Back to articles
        </button>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading article…
        </div>
      ) : isError || !data ? (
        <div className="flex items-center gap-2 text-sm text-destructive py-8 justify-center">
          <AlertCircle className="h-4 w-4" /> Could not load article.
        </div>
      ) : (
        <article className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold leading-snug">{data.title}</h2>
            <Badge variant="secondary" className="text-xs">{data.module}</Badge>
          </div>
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed bg-transparent p-0">
              {data.body}
            </pre>
          </div>
          <div className="pt-2 border-t border-border">
            <a
              href="/help"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              data-testid="link-contextual-help-center"
            >
              Open full help center <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </article>
      )}
    </div>
  );
}

interface Props {
  label?: string;
  /** When provided, shows exactly these article slugs instead of route-matching. Useful for tab-level help. */
  slugs?: string[];
}

/**
 * Renders a small "?" / "Help" button that opens a slide-over listing help
 * articles whose `routes` field (from docs/help/manifest.json) matches the
 * current page path.  Pass explicit `slugs` to override route-matching (e.g.
 * for tab-specific help inside a shared-URL page like project detail).
 */
export function ContextualHelpButton({ label = "Help", slugs }: Props) {
  const [open, setOpen] = useState(false);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [location] = useLocation();

  const articlesQuery = useQuery<{ articles: HelpSummary[] }>({
    queryKey: ["/api/support/help/articles", { route: location }],
    enabled: open,
  });

  const contextual = useMemo(() => {
    const all = articlesQuery.data?.articles ?? [];
    if (slugs && slugs.length > 0) {
      return all.filter((a) => slugs.includes(a.slug));
    }
    return all.filter((a) =>
      a.routes.some((r) => location.toLowerCase().startsWith(r.toLowerCase())),
    );
  }, [articlesQuery.data, location, slugs]);

  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (!v) setActiveSlug(null);
  };

  if (contextual.length === 0 && !open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5 text-muted-foreground hover:text-foreground"
        data-testid="button-contextual-help"
        aria-label={`Open help: ${label}`}
      >
        <HelpCircle className="h-4 w-4" />
        <span className="hidden sm:inline">{label}</span>
      </Button>
    );
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5 text-muted-foreground hover:text-foreground"
        data-testid="button-contextual-help"
        aria-label={`Open help: ${label}`}
      >
        <HelpCircle className="h-4 w-4" />
        <span className="hidden sm:inline">{label}</span>
      </Button>

      <SheetContent side="right" className="w-[420px] sm:max-w-[420px] overflow-y-auto">
        <SheetHeader className="pb-4 border-b border-border">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            <SheetTitle>Help Articles</SheetTitle>
          </div>
          <SheetDescription>
            Relevant documentation for this page
          </SheetDescription>
        </SheetHeader>

        <div className="pt-4">
          {activeSlug ? (
            <ArticleBody slug={activeSlug} onBack={() => setActiveSlug(null)} />
          ) : (
            <div className="space-y-2" data-testid="contextual-help-article-list">
              {articlesQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : contextual.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-8">
                  No articles found for this page.
                </div>
              ) : contextual.length === 1 ? (
                <ArticleBody slug={contextual[0].slug} />
              ) : (
                contextual.map((article) => (
                  <button
                    key={article.slug}
                    type="button"
                    onClick={() => setActiveSlug(article.slug)}
                    className="w-full text-left rounded-lg border border-border p-3 hover:bg-muted/60 transition-colors space-y-1 group"
                    data-testid={`contextual-help-article-item-${article.slug}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium group-hover:text-primary transition-colors leading-snug">
                        {article.title}
                      </span>
                      <ChevronLeft className="h-4 w-4 rotate-180 text-muted-foreground shrink-0 mt-0.5" />
                    </div>
                    <div className="text-xs text-muted-foreground">{article.excerpt}</div>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                      {article.module}
                    </Badge>
                  </button>
                ))
              )}

              {!articlesQuery.isLoading && contextual.length > 0 && (
                <div className="pt-3 border-t border-border mt-3">
                  <a
                    href="/help"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    data-testid="link-contextual-help-center-list"
                  >
                    Open full help center <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
